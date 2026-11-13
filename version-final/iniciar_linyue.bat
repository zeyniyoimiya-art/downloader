@echo off
REM Linyue · arranque local: instala, compila y sirve SOLO en 127.0.0.1
title Linyue Studio
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run build || goto :err
set HOSTNAME=127.0.0.1
set PORT=4173
start "" http://127.0.0.1:4173
call npx next start -H 127.0.0.1 -p 4173
goto :eof
:err
echo Error al compilar. Revisa la salida de arriba.
pause
