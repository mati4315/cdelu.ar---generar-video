"""Errores de dominio y codigos de salida del CLI."""

from __future__ import annotations

from dataclasses import dataclass


EXIT_OK = 0
EXIT_VALIDATION_ERROR = 2
EXIT_RUNTIME_ERROR = 3


@dataclass(slots=True)
class AppError(Exception):
    """Error de aplicacion con mensaje amigable para CLI."""

    message: str
    exit_code: int

    def __str__(self) -> str:
        return self.message


class ValidationError(AppError):
    def __init__(self, message: str):
        super().__init__(message=message, exit_code=EXIT_VALIDATION_ERROR)


class RuntimeAppError(AppError):
    def __init__(self, message: str):
        super().__init__(message=message, exit_code=EXIT_RUNTIME_ERROR)
