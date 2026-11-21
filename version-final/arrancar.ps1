# Arranque de Linyue Studio para Windows.
#
# Dos cosas que resuelve este archivo, y por que:
#
# 1) SERVIDOR VIEJO. Si queda abierta una ventana de una version anterior, ese
#    servidor sigue escuchando en el puerto y sirviendo el build ANTIGUO: abrir
#    el navegador contra el es ver la app de antes, aunque acabases de compilar
#    la nueva. Aqui se pregunta al servidor que BUILD_ID esta sirviendo y, si no
#    es el de esta carpeta, se cierra y se arranca el nuevo.
#
# 2) PUERTO MARCADO. Se prueba una lista de puertos: se arranca, se comprueba de
#    verdad que responde (/api/health == 200) y, si en 40 s no contesta, se pasa
#    al siguiente. El navegador se abre en el primero que funcione.
#
# Todo queda escrito en arranque.log.
#
# ASCII puro a proposito (Windows PowerShell 5.1 lee el archivo como ANSI).

$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $raiz
$log = Join-Path $raiz "arranque.log"
"=== Linyue - arranque " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " ===" | Out-File -FilePath $log -Encoding UTF8

function Diag([string]$t) {
  Write-Host $t
  $t | Out-File -FilePath $log -Append -Encoding UTF8
}

Write-Host ""
Write-Host "  Linyue Studio  (v1.8.6)"
Write-Host "  ======================"
Write-Host ""

# == 1. Node ==================================================================
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  [X] No encuentro Node.js. Instala la version LTS de https://nodejs.org"
  Write-Host "      y vuelve a ejecutar este archivo."
  Read-Host "  Pulsa Enter para cerrar" | Out-Null
  exit 1
}

# == 2. Dependencias y compilacion ============================================
if (-not (Test-Path (Join-Path $raiz "node_modules"))) {
  Diag "[1/3] Instalando dependencias (la primera vez tarda)..."
  & npm install 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
  if ($LASTEXITCODE -ne 0) {
    Diag "[X] Fallo npm install. Mira arranque.log"
    Read-Host "  Pulsa Enter para cerrar" | Out-Null
    exit 1
  }
}

$versionLocal = ""
try { $versionLocal = (Get-Content (Join-Path $raiz "package.json") -Raw | ConvertFrom-Json).version } catch { }

Diag "[2/3] Compilando (unos 20-60 s)..."
& npm run build 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
if ($LASTEXITCODE -ne 0) {
  Diag "[X] Fallo la compilacion. Mira arranque.log (el proyecto no se ha tocado)."
  Read-Host "  Pulsa Enter para cerrar" | Out-Null
  exit 1
}

$buildLocal = ""
try { $buildLocal = (Get-Content (Join-Path $raiz ".next\BUILD_ID") -Raw).Trim() } catch { }
Diag ("      version " + $versionLocal + " - build " + $buildLocal)

# == 3. Funciones de sondeo ===================================================
$puertos = @(4173, 3000, 8099, 5500, 8080)

function QuienEscucha([int]$p) {
  # Devuelve el objeto .app de /api/diagnostico, o $null si no hay nadie.
  try {
    $r = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $p + "/api/diagnostico") -TimeoutSec 3
    return $r.app
  } catch { return $null }
}

function Responde([int]$p) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $p + "/api/health") -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function MatarEnPuerto([int]$p) {
  # PID que escucha en ese puerto: primero con el cmdlet, si no con netstat.
  $procId = 0
  try {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($c) { $procId = [int]$c.OwningProcess }
  } catch { }
  if ($procId -eq 0) {
    try {
      $linea = netstat -ano | Select-String (":" + $p + "\s") | Select-Object -First 1
      if ($linea) { $procId = [int](($linea.ToString().Trim() -split "\s+")[-1]) }
    } catch { }
  }
  if ($procId -gt 0) {
    Diag ("      cerrando el proceso " + $procId + " (servidor viejo en el puerto " + $p + ")")
    try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch { }
    Start-Sleep -Seconds 2
    return $true
  }
  Diag ("      no pude identificar el proceso del puerto " + $p)
  return $false
}

# == 4. Quitar de en medio servidores viejos ==================================
foreach ($p in $puertos) {
  $app = QuienEscucha $p
  if ($app) {
    if ($buildLocal -and $app.buildId -and ($app.buildId -eq $buildLocal)) {
      Diag ("[3/3] Ya estaba corriendo ESTA compilacion en el puerto " + $p + ". Abro esa ventana.")
      Start-Process ("http://localhost:" + $p)
      Start-Sleep -Seconds 3
      exit 0
    }
    Diag ("[3/3] En el puerto " + $p + " hay un servidor VIEJO (version " + $app.version + "). Lo cierro para arrancar el de ahora.")
    MatarEnPuerto $p | Out-Null
  }
}

# == 5. Arrancar en el primer puerto que responda de verdad ===================
foreach ($p in $puertos) {
  if (Responde $p) {
    Diag ("      el puerto " + $p + " sigue ocupado por algo que no puedo cerrar; pruebo otro.")
    continue
  }
  Diag ("[3/3] Arrancando en el puerto " + $p + "...")
  $out = Join-Path $raiz ("servidor-" + $p + ".log")
  $err = Join-Path $raiz ("servidor-" + $p + ".err")
  $proc = $null
  try {
    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList ("/c npx next start -H 127.0.0.1 -p " + $p) `
      -WorkingDirectory $raiz -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $out -RedirectStandardError $err
  } catch {
    Diag ("      no se pudo lanzar: " + $_.Exception.Message)
    continue
  }

  $ok = $false
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    if (Responde $p) { $ok = $true; break }
    if ($proc.HasExited) { break }
  }

  if ($ok) {
    Diag "      OK: responde."
    Diag ""
    Diag ("      App en marcha:  http://localhost:" + $p)
    Diag ("      Tambien:        http://127.0.0.1:" + $p)
    Diag ""
    Diag "      Para parar: cierra esta ventana."
    Diag ""
    Start-Process ("http://localhost:" + $p)
    Wait-Process -Id $proc.Id
    exit 0
  }

  Diag ("      el puerto " + $p + " no responde; lo cierro y pruebo otro.")
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
  MatarEnPuerto $p | Out-Null
}

# == 6. Nada funciono: informe ================================================
Diag ""
Diag "[X] Ningun puerto responde. Abriendo diagnostico.bat."
$diag = Join-Path $raiz "diagnostico.bat"
if (Test-Path $diag) { Start-Process -FilePath $diag }
Read-Host "  Pulsa Enter para cerrar" | Out-Null
exit 1
