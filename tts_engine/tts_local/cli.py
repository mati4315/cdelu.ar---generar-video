"""CLI principal para generar audio TTS en espanol."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import wave

from tts_local.config import DEFAULT_LANGUAGE, DEFAULT_MODEL_NAME, DEFAULT_VOICE_ALIAS
from tts_local.engine import XTTSService
from tts_local.errors import EXIT_OK, EXIT_RUNTIME_ERROR, AppError, RuntimeAppError, ValidationError

EXPECTED_SAMPLE_RATE_HZ = 24000


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tts-es",
        description="Sintetiza texto a voz en espanol usando Coqui XTTS v2.",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text", help="Texto a sintetizar.")
    source.add_argument("--input-file", help="Ruta a archivo .txt con el contenido a sintetizar.")

    parser.add_argument("--output", required=True, help="Ruta del .wav de salida.")
    parser.add_argument("--voice", default=DEFAULT_VOICE_ALIAS, help="Alias o speaker real del modelo.")
    parser.add_argument("--language", default=DEFAULT_LANGUAGE, help="Codigo de idioma, por defecto 'es'.")
    parser.add_argument("--meta-json", help="Ruta opcional para guardar metadata JSON parseable por bots.")
    parser.add_argument("--model", default=DEFAULT_MODEL_NAME, help="Modelo TTS a cargar.")
    parser.add_argument("--retries", type=int, default=1, help="Reintentos adicionales de carga de modelo.")
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=3.0,
        help="Segundos de espera entre reintentos de carga.",
    )
    parser.add_argument(
        "--agree-coqui-cpml",
        action="store_true",
        help="Confirma no-interactivo de licencia Coqui CPML para descarga de XTTS.",
    )
    parser.add_argument("--use-gpu", action="store_true", help="Intenta usar GPU (CUDA) si esta disponible.")
    return parser


def read_text_from_args(args: argparse.Namespace) -> str:
    if args.text is not None:
        text = args.text.strip()
        if not text:
            raise ValidationError("El valor de --text esta vacio despues de limpiar espacios.")
        return text

    input_path = Path(args.input_file)
    if not input_path.exists():
        raise ValidationError(f"El archivo indicado en --input-file no existe: {input_path}")
    if not input_path.is_file():
        raise ValidationError(f"La ruta indicada en --input-file no es un archivo: {input_path}")

    text = input_path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValidationError(f"El archivo de entrada esta vacio: {input_path}")
    return text


def estimate_duration_seconds(text: str) -> float:
    # Regla simple y explicita para tener una estimacion consistente.
    chars_per_second = 14.0
    return round(max(len(text) / chars_per_second, 0.1), 2)


def read_wav_info(path: Path) -> tuple[float | None, int | None]:
    try:
        with wave.open(str(path), "rb") as wav_file:
            frames = wav_file.getnframes()
            framerate = wav_file.getframerate()
            if framerate <= 0:
                return None, None
            return round(frames / float(framerate), 3), framerate
    except Exception:
        return None, None


def build_metadata(
    output_path: Path,
    language: str,
    voice_alias: str,
    resolved_voice: str,
    model: str,
    text: str,
    status: str,
) -> dict:
    estimated = estimate_duration_seconds(text)
    actual, sample_rate_hz = read_wav_info(output_path)
    return {
        "status": status,
        "output_path": str(output_path.resolve()),
        "language": language,
        "voice_alias": voice_alias,
        "resolved_voice": resolved_voice,
        "model": model,
        "text_characters": len(text),
        "estimated_duration_seconds": estimated,
        "actual_duration_seconds": actual,
        "sample_rate_hz": sample_rate_hz,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }


def write_metadata(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _run(args: argparse.Namespace) -> int:
    if args.agree_coqui_cpml:
        os.environ["COQUI_TOS_AGREED"] = "1"

    text = read_text_from_args(args)
    output_path = Path(args.output)

    service = XTTSService(
        model_name=args.model,
        retries=args.retries,
        retry_delay_seconds=args.retry_delay,
        use_gpu=args.use_gpu,
    )
    result = service.synthesize(
        text=text,
        output_path=output_path,
        voice=args.voice,
        language=args.language,
    )
    _, sample_rate_hz = read_wav_info(result.output_path)
    if sample_rate_hz != EXPECTED_SAMPLE_RATE_HZ:
        raise RuntimeAppError(
            f"Se esperaba WAV a {EXPECTED_SAMPLE_RATE_HZ} Hz pero se obtuvo {sample_rate_hz}. "
            "Verifica configuracion del modelo/salida."
        )

    metadata = build_metadata(
        output_path=result.output_path,
        language=args.language,
        voice_alias=args.voice,
        resolved_voice=result.resolved_voice,
        model=args.model,
        text=text,
        status="ok",
    )
    if args.meta_json:
        write_metadata(Path(args.meta_json), metadata)

    print(f"Audio generado: {result.output_path.resolve()}")
    print(f"Voz usada: {result.resolved_voice}")
    if args.meta_json:
        print(f"Metadata JSON: {Path(args.meta_json).resolve()}")
    return EXIT_OK


def run(argv: list[str] | None = None) -> int:
    parser = build_parser()
    parsed = parser.parse_args(argv)
    try:
        return _run(parsed)
    except AppError as app_error:
        print(f"Error: {app_error}", file=sys.stderr)
        return app_error.exit_code
    except Exception as exc:  # pragma: no cover - proteccion final
        print(f"Error inesperado: {exc}", file=sys.stderr)
        return EXIT_RUNTIME_ERROR


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
