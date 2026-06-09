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

:: Confirmacion con Timeout de 6 segundos
echo El proceso iniciara automaticamente en 6 segundos...
choice /C SN /T 6 /D S /M " > ¿Deseas iniciar el procesamiento por lote ahora? (S/N): "

if errorlevel 2 (
    echo:
    echo [!] Ejecucion cancelada por el usuario.
    timeout /t 3 >nul
    exit /b
)

echo:
echo [OK] Iniciando preparativos...

:: Limpiar puerto 3005 si esta ocupado
for /f "tokens=5" %%a in ('netstat -aon ^| find "LISTENING" ^| find ":3005"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo:
echo Iniciando servidor y proceso de generacion...
echo:

node lanzadores/server.js --start

if %errorlevel% neq 0 (
    echo:
    echo [!] El proceso de Node se detuvo o encontro un error.
)

echo:
echo ==================================================
echo Sesion finalizada.
echo ==================================================
pause
