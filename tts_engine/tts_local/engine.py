"""Motor de sintesis con Coqui XTTS v2."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import time
from typing import Any

from tts_local.config import (
    DEFAULT_LANGUAGE,
    DEFAULT_MODEL_NAME,
    DEFAULT_VOICE_ALIAS,
    FEMALE_HINT_TOKENS,
    VOICE_ALIASES,
)
from tts_local.errors import RuntimeAppError, ValidationError


@dataclass(slots=True)
class SynthesisResult:
    output_path: Path
    resolved_voice: str


class XTTSService:
    """Encapsula carga de modelo y sintesis."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL_NAME,
        retries: int = 1,
        retry_delay_seconds: float = 3.0,
        use_gpu: bool = False,
    ) -> None:
        self.model_name = model_name
        self.retries = max(retries, 0)
        self.retry_delay_seconds = max(retry_delay_seconds, 0.0)
        self.use_gpu = use_gpu
        self._model = None

    def synthesize(
        self,
        text: str,
        output_path: Path,
        voice: str = DEFAULT_VOICE_ALIAS,
        language: str = DEFAULT_LANGUAGE,
        split_sentences: bool = True,
        generation_kwargs: dict[str, Any] | None = None,
    ) -> SynthesisResult:
        clean_text = text.strip()
        if not clean_text:
            raise ValidationError("El texto de entrada esta vacio. Usa --text o --input-file con contenido.")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        model = self._load_model_with_retry()
        resolved_voice = self._resolve_speaker(model, voice)
        generation_kwargs = generation_kwargs or {}

        try:
            model.tts_to_file(
                text=clean_text,
                file_path=str(output_path),
                speaker=resolved_voice,
                language=language,
                split_sentences=split_sentences,
                **generation_kwargs,
            )
        except Exception as exc:  # pragma: no cover - depende del backend y modelo
            raise RuntimeAppError(
                f"No se pudo generar el audio con XTTS. Verifica modelo, voz e idioma. Detalle: {exc}"
            ) from exc

        if not output_path.exists():
            raise RuntimeAppError(
                "La sintesis finalizo sin archivo de salida. Revisa permisos de escritura y espacio en disco."
            )

        return SynthesisResult(output_path=output_path, resolved_voice=resolved_voice)

    def _load_model_with_retry(self):
        if self._model is not None:
            return self._model

        self._configure_runtime_cache_dirs()
        attempts = self.retries + 1
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                # Import tardio para que los tests no requieran TTS real.
                from TTS.api import TTS  # type: ignore
                import torch

                device_use_gpu = self.use_gpu
                if device_use_gpu and not torch.cuda.is_available():
                    print("WARN: GPU requested but CUDA not available. Falling back to CPU.", file=os.sys.stderr)
                    device_use_gpu = False

                model = TTS(model_name=self.model_name, progress_bar=False, gpu=device_use_gpu)
                self._model = model
                return model
            except Exception as exc:  # pragma: no cover - depende del entorno
                last_error = exc
                if attempt < attempts:
                    time.sleep(self.retry_delay_seconds)

        raise RuntimeAppError(
            "No se pudo cargar el modelo XTTS. "
            "Confirma internet para la primera descarga y dependencias de Python instaladas. "
            f"Detalle: {last_error}"
        )

    def _configure_runtime_cache_dirs(self) -> None:
        temp_root = Path(os.getenv("TEMP", ".")).resolve()
        cache_root = Path(os.getenv("TTS_LOCAL_CACHE_DIR", str(temp_root / "tts_local_cache"))).resolve()
        hf_home = cache_root / "huggingface"
        hf_hub = hf_home / "hub"
        mpl_config = cache_root / "matplotlib"
        tts_home = cache_root / "tts"
        torch_home = cache_root / "torch"
        xdg_data = cache_root / "xdg"

        hf_hub.mkdir(parents=True, exist_ok=True)
        mpl_config.mkdir(parents=True, exist_ok=True)
        tts_home.mkdir(parents=True, exist_ok=True)
        torch_home.mkdir(parents=True, exist_ok=True)
        xdg_data.mkdir(parents=True, exist_ok=True)

        os.environ.setdefault("HF_HOME", str(hf_home))
        os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(hf_hub))
        os.environ.setdefault("MPLCONFIGDIR", str(mpl_config))
        os.environ.setdefault("TTS_HOME", str(tts_home))
        os.environ.setdefault("TORCH_HOME", str(torch_home))
        os.environ.setdefault("XDG_DATA_HOME", str(xdg_data))

    def _resolve_speaker(self, model, voice: str) -> str:
        speakers = list(getattr(model, "speakers", []) or [])
        if not speakers:
            raise RuntimeAppError(
                "El modelo no reporto lista de speakers. No se puede seleccionar voz de forma segura."
            )

        if voice in speakers:
            return voice

        aliases = VOICE_ALIASES.get(voice)
        if aliases:
            for candidate in aliases:
                if candidate in speakers:
                    return candidate

            # Fallback heuristico para preferir una voz femenina.
            for speaker in speakers:
                speaker_lower = speaker.lower()
                if any(token in speaker_lower for token in FEMALE_HINT_TOKENS):
                    return speaker

            return speakers[0]

        available_preview = ", ".join(speakers[:8])
        raise ValidationError(
            f"Voz '{voice}' no valida. Usa una voz disponible del modelo o '{DEFAULT_VOICE_ALIAS}'. "
            f"Speakers detectados (preview): {available_preview}"
        )
