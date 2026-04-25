@echo off
setlocal enabledelayedexpansion
color 0e

cd /d "%~dp0.."

echo ==================================================
echo         EJECUTANDO LOTE DE VIDEOS (CLI)
echo ==================================================
echo:
echo Directorio: %cd%
echo:

for /f "tokens=5" %%a in ('netstat -aon ^| find "LISTENING" ^| find ":3005"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo:
echo Iniciando proceso...
echo:

node lanzadores/server.js --start

if %errorlevel% neq 0 echo [!] Error en el proceso.

echo:
echo ==================================================
pause
