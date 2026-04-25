"""Motor de sintesis para modelos MMS/VITS desde Hugging Face."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import time

import numpy as np
import soundfile as sf

from tts_local.errors import RuntimeAppError, ValidationError


@dataclass(slots=True)
class MMSSynthesisResult:
    output_path: Path
    resolved_voice: str
    sample_rate_hz: int


class MMSService:
    """Encapsula carga de tokenizer/modelo MMS y sintesis a WAV."""

    def __init__(
        self,
        model_id: str = "ylacombe/mms-spa-finetuned-argentinian-monospeaker",
        retries: int = 1,
        retry_delay_seconds: float = 2.0,
        use_gpu: bool = False,
    ) -> None:
        self.model_id = model_id
        self.retries = max(retries, 0)
        self.retry_delay_seconds = max(retry_delay_seconds, 0.0)
        self.use_gpu = use_gpu
        self._model = None
        self._tokenizer = None
        self._device = "cpu"

    def synthesize(
        self,
        text: str,
        output_path: Path,
        speaker_id: int | None = None,
    ) -> MMSSynthesisResult:
        clean_text = text.strip()
        if not clean_text:
            raise ValidationError("El texto de entrada esta vacio.")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        model, tokenizer = self._load_model_with_retry()

        try:
            import torch

            inputs = tokenizer(clean_text, return_tensors="pt")
            inputs = {key: value.to(self._device) for key, value in inputs.items()}

            with torch.no_grad():
                if speaker_id is not None:
                    try:
                        output = model(**inputs, speaker_id=speaker_id)
                    except Exception:
                        output = model(**inputs)
                else:
                    output = model(**inputs)

            waveform = output.waveform.squeeze().detach().cpu().numpy()
            if waveform.ndim != 1:
                waveform = np.ravel(waveform)

            sample_rate = int(getattr(model.config, "sampling_rate", 16000))
            sf.write(str(output_path), waveform, sample_rate)
        except Exception as exc:  # pragma: no cover - depende de entorno/modelo
            raise RuntimeAppError(
                f"No se pudo generar audio con el modelo MMS '{self.model_id}'. Detalle: {exc}"
            ) from exc

        if not output_path.exists():
            raise RuntimeAppError("La sintesis MMS finalizo sin archivo de salida.")

        resolved_voice = "mms_monospeaker"
        if speaker_id is not None:
            resolved_voice = f"mms_speaker_{speaker_id}"

        return MMSSynthesisResult(
            output_path=output_path,
            resolved_voice=resolved_voice,
            sample_rate_hz=sample_rate,
        )

    def _load_model_with_retry(self):
        if self._model is not None and self._tokenizer is not None:
            return self._model, self._tokenizer

        self._configure_runtime_cache_dirs()
        attempts = self.retries + 1
        last_error: Exception | None = None

        for attempt in range(1, attempts + 1):
            try:
                import torch
                from transformers import AutoTokenizer, VitsModel

                self._device = "cuda" if self.use_gpu and torch.cuda.is_available() else "cpu"
                if self.use_gpu and self._device == "cpu":
                     print("WARN: GPU requested for MMS but CUDA not available. Falling back to CPU.", file=os.sys.stderr)

                try:
                    tokenizer = AutoTokenizer.from_pretrained(self.model_id, local_files_only=True)
                    model = VitsModel.from_pretrained(self.model_id, local_files_only=True).to(self._device)
                except Exception:
                    tokenizer = AutoTokenizer.from_pretrained(self.model_id)
                    model = VitsModel.from_pretrained(self.model_id).to(self._device)
                model.eval()
                self._tokenizer = tokenizer
                self._model = model
                return model, tokenizer
            except Exception as exc:  # pragma: no cover - depende de entorno
                last_error = exc
                if attempt < attempts:
                    time.sleep(self.retry_delay_seconds)

        raise RuntimeAppError(
            f"No se pudo cargar el modelo MMS '{self.model_id}'. "
            "Confirma internet para la primera descarga y dependencias instaladas. "
            f"Detalle: {last_error}"
        )

    def _configure_runtime_cache_dirs(self) -> None:
        # No forzamos HF_HOME/HUGGINGFACE_HUB_CACHE para respetar el cache ya descargado
        # del usuario y evitar redescargas innecesarias del modelo MMS.
        temp_root = Path(os.getenv("TEMP", ".")).resolve()
        mpl_config = temp_root / "tts_local_cache" / "matplotlib"
        mpl_config.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("MPLCONFIGDIR", str(mpl_config))
