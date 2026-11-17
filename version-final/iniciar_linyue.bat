@echo off
REM ───────────────────────────────────────────────────────────────────────────
REM  Linyue · arranque local (Windows)
REM
REM  Qué cambió y por qué: antes abría el navegador ANTES de compilar y antes de
REM  que el servidor estuviera escuchando. Si la compilación tardaba o fallaba,
REM  quedaba una pestaña con «This page couldn't load» y la ventana negra se
REM  cerraba sin decir nada. Ahora:
REM    1. comprueba Node
REM    2. instala dependencias si faltan
REM    3. si ya hay algo en el 4173, reutiliza esa ventana en vez de chocar
REM    4. compila y, si falla, se queda abierta con el motivo
REM    5. sirve, y abre el navegador SÓLO cuando /api/health responde 200
REM ───────────────────────────────────────────────────────────────────────────
setlocal
title Linyue Studio
cd /d "%~dp0"
set "PUERTO=4173"

echo.
echo  Linyue Studio
echo  ─────────────
echo.

REM ── 1. Node ────────────────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 goto :err_node

REM ── 2. Dependencias ────────────────────────────────────────────────────────
if not exist node_modules (
  echo  [1/3] Instalando dependencias. La primera vez tarda unos minutos...
  call npm install
  if errorlevel 1 goto :err_instalar
) else (
  echo  [1/3] Dependencias: ya están.
)

REM ── 3. ¿Ya está arrancado? ─────────────────────────────────────────────────
netstat -ano | findstr /r /c:"LISTENING" | findstr ":%PUERTO% " >nul 2>nul
if not errorlevel 1 (
  echo  [2/3] Ya hay algo escuchando en el %PUERTO%: abro esa ventana.
  start "" "http://127.0.0.1:%PUERTO%"
  timeout /t 3 >nul
  exit /b 0
)

REM ── 4. Compilar ────────────────────────────────────────────────────────────
echo  [2/3] Compilando (unos 20-60 s; la primera vez más)...
call npm run build
if errorlevel 1 goto :err_build

REM ── 5. Servir y abrir el navegador cuando responda ─────────────────────────
echo  [3/3] Arrancando en http://127.0.0.1:%PUERTO%
echo        El navegador se abrirá solo cuando el servidor esté listo.
echo        Para parar: cierra esta ventana o pulsa Ctrl+C.
echo.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 120;$i++){try{if((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%PUERTO%/api/health' -TimeoutSec 2).StatusCode -eq 200){Start-Process 'http://127.0.0.1:%PUERTO%';break}}catch{};Start-Sleep -Milliseconds 500}"
call npx next start -H 127.0.0.1 -p %PUERTO%
if errorlevel 1 goto :err_servir
exit /b 0

REM ── Errores: siempre se ve el motivo y la ventana no se cierra sola ────────
:err_node
echo.
echo  [X] No encuentro Node.js.
echo      Instala la version LTS desde https://nodejs.org, reinicia el equipo
echo      y vuelve a ejecutar este archivo.
echo.
pause
exit /b 1

:err_instalar
echo.
echo  [X] Falló "npm install". Suele ser falta de internet o un proxy.
echo      Copia el mensaje de arriba y pásalo tal cual.
echo.
pause
exit /b 1

:err_build
echo.
echo  [X] Falló la compilación. El proyecto NO se ha tocado: lo que hay en disco
echo      sigue siendo lo último que se compiló bien.
echo      Copia las últimas 20 líneas de arriba y pásalas tal cual.
echo.
pause
exit /b 1

:err_servir
echo.
echo  [X] El servidor se cerró. Si el mensaje de arriba dice EADDRINUSE, hay otro
echo      programa usando el puerto %PUERTO%: ciérralo y vuelve a intentarlo.
echo.
pause
exit /b 1
