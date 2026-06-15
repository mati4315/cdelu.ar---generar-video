import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import argparse
import json
import re
import sys
from pathlib import Path

# Add current directory to path so it can import tts_local
sys.path.insert(0, str(Path(__file__).resolve().parent))

from tts_local.engine import XTTSService
from tts_local.mms_engine import MMSService
from tts_local.errors import AppError

def _apply_speed_to_wav(path: Path, speed: float) -> None:
    if abs(speed - 1.0) < 0.01:
        return
    try:
        import librosa
        import numpy as np
        import soundfile as sf
        audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
        if audio.ndim == 1:
            stretched = librosa.effects.time_stretch(audio, rate=speed)
        else:
            stretched_channels = []
            for idx in range(audio.shape[1]):
                stretched_channels.append(librosa.effects.time_stretch(audio[:, idx], rate=speed))
            min_len = min(len(ch) for ch in stretched_channels)
            stretched = np.stack([ch[:min_len] for ch in stretched_channels], axis=1)
        sf.write(str(path), stretched, sample_rate)
    except ImportError:
        print("WARN: librosa or soundfile missing. Speed adjustment skipped.", file=sys.stderr)
        
def _clean_text(text: str) -> str:
    """Omitir enlaces, direcciones web y caracteres especiales innecesarios para el audio."""
    # 1. Eliminar URLs (http://, https://, www.)
    text = re.sub(r'https?://\S+|www\.\S+', '', text)
    # 2. Eliminar correos electronicos
    text = re.sub(r'\S+@\S+', '', text)
    # 3. Reemplazar caracteres especiales que no aportan al audio por espacios
    # (Mantenemos signos de puntuacion normales que ayudan a la entonacion: . , ! ? : ;)
    unwanted_chars = r'[*_~|@#\\/<>^]'
    text = re.sub(unwanted_chars, ' ', text)
    
    # 4. Normalizar espacios en blanco
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def _split_long_sentence_recursive(text: str, max_chars: int = 200) -> list[str]:
    text = text.strip()
    if len(text) <= max_chars:
        return [text]
        
    best_split_idx = -1
    for punct in [';', ':', ',', ' -']:
        idx = text[:max_chars].rfind(punct)
        if idx > best_split_idx:
            if punct == ' -':
                best_split_idx = idx
            else:
                best_split_idx = idx + 1
                
    if best_split_idx != -1 and best_split_idx > 20:
        left = text[:best_split_idx].strip()
        if left[-1] in [',', ';', ':', '-']:
            left = left[:-1].strip()
        if not left[-1] in ['.', '!', '?']:
            left += '.'
        right = text[best_split_idx:].strip()
        return [left] + _split_long_sentence_recursive(right, max_chars)
        
    space_idx = text[:max_chars].rfind(' ')
    if space_idx != -1 and space_idx > 20:
        left = text[:space_idx].strip()
        if not left[-1] in ['.', '!', '?']:
            left += '.'
        right = text[space_idx:].strip()
        return [left] + _split_long_sentence_recursive(right, max_chars)
        
    left = text[:max_chars].strip()
    if not left[-1] in ['.', '!', '?']:
        left += '.'
    right = text[max_chars:].strip()
    return [left] + _split_long_sentence_recursive(right, max_chars)

def _split_text_into_tts_sentences(text: str, max_chars: int = 200) -> str:
    raw_sentences = re.split(r'(?<=[.!?])\s+|\n+', text)
    final_sentences = []
    for sentence in raw_sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_chars:
            final_sentences.append(sentence)
        else:
            parts = _split_long_sentence_recursive(sentence, max_chars)
            for part in parts:
                part = part.strip()
                if part:
                    if not part[-1] in ['.', '!', '?']:
                        part += '.'
                    final_sentences.append(part)
    return ' '.join(final_sentences)

def main():
    parser = argparse.ArgumentParser("generar_tts")
    parser.add_argument("--config", required=True, help="Ruta al tts-config.json")
    parser.add_argument("--input-file", required=True, help="Ruta al archivo txt con el texto")
    parser.add_argument("--output", required=True, help="Ruta de salida (e.g. output.wav)")
    args = parser.parse_args()
    
    with open(args.config, "r", encoding="utf-8") as f:
        config = json.load(f)
        
    with open(args.input_file, "r", encoding="utf-8") as f:
        text = _clean_text(f.read())
        text = _split_text_into_tts_sentences(text, max_chars=200)
        
    os.environ["COQUI_TOS_AGREED"] = "1"
    
    output_path = Path(args.output).resolve()
    model_key = config.get("model", "xtts_v2")
    use_gpu = config.get("use_gpu", True)
    retries = config.get("retries", 1)
    speed = config.get("speed", 1.0)
    
    try:
        if model_key == "xtts_v2":
            service = XTTSService(use_gpu=use_gpu, retries=retries)
            generation_kwargs = {
                "temperature": float(config.get("temperature", 0.75)),
                "length_penalty": float(config.get("length_penalty", 1.0)),
                "repetition_penalty": float(config.get("repetition_penalty", 5.0)),
                "top_k": int(config.get("top_k", 50)),
                "top_p": float(config.get("top_p", 0.85)),
            }
            result = service.synthesize(
                text=text,
                output_path=output_path,
                voice=config.get("voice", "es_female_default"),
                language=config.get("language", "es"),
                split_sentences=config.get("enable_text_splitting", config.get("split_sentences", True)),
                generation_kwargs=generation_kwargs
            )
        else:
            # Fallback to MMS or other models
            actual_model_id = "ylacombe/mms-spa-finetuned-argentinian-monospeaker" if model_key == "mms_ar_mono" else model_key
            service = MMSService(model_id=actual_model_id, use_gpu=use_gpu, retries=retries)
            result = service.synthesize(
                text=text,
                output_path=output_path,
                speaker_id=config.get("mms_speaker_id", 0)
            )
            
        _apply_speed_to_wav(result.output_path, speed=speed)
        print(json.dumps({"success": True, "output_path": str(result.output_path)}))
        sys.exit(0)
    except AppError as e:
        print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Error inesperado: {e}"}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
