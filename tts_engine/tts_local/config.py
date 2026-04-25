"""Configuracion y defaults del proyecto."""

from __future__ import annotations

DEFAULT_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
DEFAULT_LANGUAGE = "es"
DEFAULT_VOICE_ALIAS = "es_female_default"

# Prioridad de speaker real a usar para el alias de voz por defecto.
DEFAULT_SPEAKER_CANDIDATES = [
    "Ana Florence",
    "Ana",
    "Esmeralda",
    "Carla",
    "Sofia",
    "Marina",
    "female",
]

# Heuristica de nombres para preferir voces femeninas si no hay match exacto.
FEMALE_HINT_TOKENS = [
    "ana",
    "florence",
    "esmeralda",
    "carla",
    "sofia",
    "female",
    "woman",
    "girl",
]

VOICE_ALIASES = {
    DEFAULT_VOICE_ALIAS: DEFAULT_SPEAKER_CANDIDATES,
}
