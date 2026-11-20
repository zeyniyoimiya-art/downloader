@echo off
REM ---------------------------------------------------------------------------
REM  Linyue Studio - lanzador (Windows)
REM
REM  Este archivo ya solo llama a arrancar.ps1, que hace el trabajo de verdad:
REM  compila si hace falta, prueba varios puertos hasta encontrar uno que
REM  responda y abre el navegador ahi. Si PowerShell fallara por lo que sea,
REM  se sigue con el arranque clasico en el 4173.
REM
REM  ASCII puro a proposito: la consola en espanol lee CP850, no UTF-8.
REM ---------------------------------------------------------------------------
setlocal
title Linyue Studio
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 goto :clasico

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arrancar.ps1"
if errorlevel 1 goto :clasico
exit /b 0

:clasico
echo.
echo  Arranque clasico en el puerto 4173...
set "PUERTO=4173"
if not exist node_modules call npm install
call npm run build
if errorlevel 1 goto :err_build
echo.
echo  http://localhost:%PUERTO%
echo  http://127.0.0.1:%PUERTO%
echo.
call npx next start -H 127.0.0.1 -p %PUERTO%
goto :eof

:err_build
echo.
echo  [X] Fallo la compilacion. Copia las ultimas 20 lineas y pasalas tal cual.
echo.
pause
exit /b 1
