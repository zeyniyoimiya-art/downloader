@echo off
REM ---------------------------------------------------------------------------
REM  Linyue - arranque local (Windows)
REM
REM  ASCII puro a proposito: este archivo se lee con la pagina de codigos de la
REM  consola (CP850 en espanol) y cualquier caracter fuera de ASCII (rayas,
REM  acentos) salia como "0oCu0oCu". Si el texto cabe en ASCII, se lee bien.
REM
REM  Orden: comprobar Node -> instalar si falta -> si ya esta arrancado,
REM  reutilizarlo -> compilar -> servir -> abrir el navegador CUANDO responde.
REM ---------------------------------------------------------------------------
setlocal
title Linyue Studio
cd /d "%~dp0"
set "PUERTO=4173"

echo.
echo  Linyue Studio  (v1.8.2)
echo  ======================
echo.

REM -- 1. Node ---------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :err_node

REM -- 2. Dependencias -------------------------------------------------------
if not exist node_modules (
  echo  [1/3] Instalando dependencias. La primera vez tarda unos minutos...
  call npm install
  if errorlevel 1 goto :err_instalar
) else (
  echo  [1/3] Dependencias: ya estan.
)

REM -- 3. Ya arrancado? ------------------------------------------------------
netstat -ano | findstr /r /c:"LISTENING" | findstr ":%PUERTO% " >nul 2>nul
if not errorlevel 1 (
  echo  [2/3] Ya hay algo escuchando en el %PUERTO%. Abro esa ventana.
  start "" "http://localhost:%PUERTO%"
  timeout /t 3 >nul
  exit /b 0
)

REM -- 4. Compilar -----------------------------------------------------------
echo  [2/3] Compilando (unos 20-60 s; la primera vez mas)...
call npm run build
if errorlevel 1 goto :err_build

REM -- 5. Servir y abrir cuando responda ------------------------------------
echo  [3/3] Arrancando.
echo.
echo        http://localhost:%PUERTO%      ^<- se abre solo
echo        http://127.0.0.1:%PUERTO%
echo.
echo        Para parar: cierra esta ventana o pulsa Ctrl+C.
echo.
REM  Se comprueba con 127.0.0.1 (IPv4, siempre responde) y se abre con
REM  localhost: es otro origen, asi que no hereda un service worker atascado.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 120;$i++){try{if((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%PUERTO%/api/health' -TimeoutSec 2).StatusCode -eq 200){Start-Process 'http://localhost:%PUERTO%';break}}catch{};Start-Sleep -Milliseconds 500}"
call npx next start -H 127.0.0.1 -p %PUERTO%
if errorlevel 1 goto :err_servir
exit /b 0

REM -- Errores: siempre se ve el motivo y la ventana no se cierra sola -------
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
echo  [X] Fallo "npm install". Suele ser falta de internet o un proxy.
echo      Copia el mensaje de arriba y pasalo tal cual.
echo.
pause
exit /b 1

:err_build
echo.
echo  [X] Fallo la compilacion. No se ha tocado nada: en disco sigue lo ultimo
echo      que se compilo bien.
echo      Copia las ultimas 20 lineas de arriba y pasalas tal cual.
echo.
pause
exit /b 1

:err_servir
echo.
echo  [X] El servidor se cerro. Si arriba aparece EADDRINUSE, otro programa
echo      esta usando el puerto %PUERTO%: cierralo y vuelve a intentarlo.
echo.
pause
exit /b 1
