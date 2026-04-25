@echo off
setlocal enabledelayedexpansion
color 0b

:: Esta linea asegura que aunque el bat esté en "lanzadores", el proceso
:: principal interprete que estás en la carpeta raiz del proyecto.
cd /d "%~dp0.."

echo ==================================================
echo         INICIANDO PANEL ORQUESTADOR DE VIDEOS
echo ==================================================
echo.

:: Detectar si el puerto 3005 ya está ocupado por un proceso (modo escucha)
set "pid="
for /f "tokens=5" %%a in ('netstat -aon ^| find "LISTENING" ^| find ":3005"') do (
    set "pid=%%a"
)

if not "%pid%"=="" (
    if not "%pid%"=="0" (
        echo [!] Se detecto un servidor "fantasma" o previo bloqueando el sistema ^(PID: %pid%^).
        choice /C SN /T 6 /D S /M "¿Deseas forzar su cierre automatico para arrancar este nuevo?"
        if !errorlevel! equ 1 (
            taskkill /F /PID %pid% >nul 2>&1
            echo [ok] Servidor fantasma eliminado exitosamente.
            echo.
            timeout /t 1 /nobreak >nul
        ) else (
            echo Arranque cancelado por el usuario.
            pause
            exit /b
        )
    )
)

echo Comando actuando: node lanzadores/server.js
echo.
echo ==================================================
echo El panel se abrira en tu navegador predeterminado.
echo Para detener el sistema en el futuro, cierra esta ventana X.
echo ==================================================
echo.

start http://localhost:3005
node lanzadores/server.js

pause
