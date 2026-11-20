@echo off
REM ---------------------------------------------------------------------------
REM  Linyue - diagnostico de conexion (Windows)
REM
REM  Cuando el navegador dice "This page couldn't load" pero el servidor dice
REM  "Ready", hace falta saber QUIEN falla. Este archivo lo mide todo y lo deja
REM  escrito en diagnostico.txt. No toca nada del proyecto.
REM
REM  Uso: con el servidor arrancado (deja la ventana de iniciar_linyue.bat
REM  abierta), doble clic aqui. Al terminar se abre solo el informe.
REM
REM  ASCII puro a proposito (la consola espanola lee CP850, no UTF-8).
REM ---------------------------------------------------------------------------
setlocal
title Linyue - diagnostico
cd /d "%~dp0"
set "PUERTO=4173"
set "SALIDA=%~dp0diagnostico.txt"
set "CUERPO=%TEMP%\ly-cuerpo.txt"

> "%SALIDA%" echo Linyue - diagnostico de conexion
>> "%SALIDA%" echo Fecha: %DATE% %TIME%
>> "%SALIDA%" echo Carpeta: %CD%
>> "%SALIDA%" echo.

echo.
echo  Midiendo... unos 25 segundos.
echo.

>> "%SALIDA%" echo === 1. Sistema y versiones ===
node -v >> "%SALIDA%" 2>&1
npm -v >> "%SALIDA%" 2>&1
powershell -NoProfile -Command "[System.Environment]::OSVersion.VersionString" >> "%SALIDA%" 2>&1
findstr /c:"version" package.json >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 2. Quien escucha en el puerto %PUERTO% ===
netstat -ano | findstr ":%PUERTO%" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 3. Conexion TCP a 127.0.0.1:%PUERTO% (sin HTTP) ===
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PUERTO%);'TCP OK - el puerto acepta conexiones';$c.Close()}catch{'TCP FALLA - ' + $_.Exception.Message}" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 4. HTTP con curl ===
>> "%SALIDA%" echo -- GET /api/health --
curl -s -m 8 -o nul -w "codigo: %%{http_code} | tiempo: %%{time_total}s" "http://127.0.0.1:%PUERTO%/api/health" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.
>> "%SALIDA%" echo -- GET / (a archivo, para no llenar la pantalla) --
curl -s -m 10 -o "%CUERPO%" -w "codigo: %%{http_code} | bytes: %%{size_download} | tipo: %%{content_type}" "http://127.0.0.1:%PUERTO%/" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.
>> "%SALIDA%" echo -- cabeceras de GET / --
curl -s -m 10 -D - -o nul "http://127.0.0.1:%PUERTO%/" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo -- las 5 primeras etiquetas del HTML recibido --
powershell -NoProfile -Command "if(Test-Path '%CUERPO%'){Select-String -Path '%CUERPO%' -Pattern '<' | Select-Object -First 5 | ForEach-Object {$_.Line.Substring(0,[Math]::Min(160,$_.Line.Length))}}else{'(no se recibio cuerpo)'}" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 5. Lo mismo por localhost ===
curl -s -m 8 -o nul -w "codigo: %%{http_code}" "http://localhost:%PUERTO%/api/health" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 6. Control: servidor Node minimo en el 8099 ===
>> "%SALIDA%" echo (si el 4 falla y este funciona, el que falla es el servidor de Next, no la red)
start "" /b node -e "require('http').createServer(function(q,r){r.end('ok')}).listen(8099,'127.0.0.1')"
timeout /t 3 >nul
curl -s -m 5 -o nul -w "codigo: %%{http_code}" "http://127.0.0.1:8099/" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object {$_.CommandLine -like '*8099*'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 7. Direcciones IPv4 del equipo ===
ipconfig | findstr /c:"IPv4" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 8. Proxy del sistema ===
powershell -NoProfile -Command "$p=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'; 'ProxyEnable: ' + $p.ProxyEnable; 'ProxyServer: ' + $p.ProxyServer" >> "%SALIDA%" 2>&1
>> "%SALIDA%" echo.

>> "%SALIDA%" echo === 9. Como leer esto ===
>> "%SALIDA%" echo - Paso 3 TCP OK y paso 4 codigo 200: el servidor esta bien.
>> "%SALIDA%" echo   Entonces el que falla es el navegador (extension, proxy, antivirus).
>> "%SALIDA%" echo - Paso 3 falla: no hay nada escuchando. El servidor no arranco.
>> "%SALIDA%" echo - Paso 6 OK y paso 4 falla: falla el servidor de Next, no la red.
>> "%SALIDA%" echo - ProxyEnable 1: hay un proxy activo en Windows. Apagalo.

echo.
echo  Listo. Abriendo el informe (diagnostico.txt)...
start "" notepad "%SALIDA%"
exit /b 0
