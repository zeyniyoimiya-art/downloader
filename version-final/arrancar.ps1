# Arranque de Linyue Studio para Windows.
#
# Por que existe este archivo: en algunos equipos el navegador no consigue abrir
# `http://127.0.0.1:4173` aunque el servidor diga "Ready". En vez de discutir con
# el equipo del usuario, aqui se prueba una LISTA de puertos: se arranca el
# servidor en el primero, se comprueba de verdad que responde (`/api/health` con
# codigo 200) y, si no responde en 40 s, se cierra y se pasa al siguiente. El
# navegador se abre en el primero que funcione, y queda escrito en arranque.log.
#
# Asi el arranque se cura solo: si un antivirus, un firewall o el propio
# navegador tienen marcado un puerto, la app aparece en otro y el usuario no
# tiene que escribir ni un comando.

$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $raiz
$log = Join-Path $raiz "arranque.log"
"=== Linyue : arranque " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " ===" | Out-File -FilePath $log -Encoding UTF8

function Diag([string]$t) {
  Write-Host $t
  $t | Out-File -FilePath $log -Append -Encoding UTF8
}

Write-Host ""
Write-Host "  Linyue Studio  (v1.8.5)"
Write-Host "  ======================"
Write-Host ""

# == 1. Node ==
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  [X] No encuentro Node.js. Instala la version LTS de https://nodejs.org"
  Write-Host "      y vuelve a ejecutar este archivo."
  Read-Host "  Pulsa Enter para cerrar" | Out-Null
  exit 1
}
Diag ("Node " + (& node -v))

# == 2. Dependencias y compilacion ==
if (-not (Test-Path (Join-Path $raiz "node_modules"))) {
  Diag "[1/3] Instalando dependencias (la primera vez tarda)..."
  & npm install 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
  if ($LASTEXITCODE -ne 0) {
    Diag "[X] Fallo npm install. Mira arranque.log"
    Read-Host "  Pulsa Enter para cerrar" | Out-Null
    exit 1
  }
}

if (-not (Test-Path (Join-Path $raiz ".next\BUILD_ID"))) {
  Diag "[2/3] Compilando (unos 20-60 s)..."
  & npm run build 2>&1 | Out-File -FilePath $log -Append -Encoding UTF8
  if ($LASTEXITCODE -ne 0) {
    Diag "[X] Fallo la compilacion. Mira arranque.log (el proyecto no se ha tocado)."
    Read-Host "  Pulsa Enter para cerrar" | Out-Null
    exit 1
  }
} else {
  Diag "[2/3] Ya hay compilacion: se reutiliza."
}

# == 3. Ya esta arrancado en alguno de los puertos? ==
$puertos = @(4173, 3000, 8099, 5500, 8080)

foreach ($p in $puertos) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $p + "/api/health") -TimeoutSec 2
    if ($r.StatusCode -eq 200) {
      Diag ("[3/3] Ya estaba arrancado en el puerto " + $p + ". Abro esa ventana.")
      Start-Process ("http://localhost:" + $p)
      Start-Sleep -Seconds 3
      exit 0
    }
  } catch { }
}

# == 4. Arrancar en el primer puerto que responda de verdad ==
foreach ($p in $puertos) {
  Diag ("[3/3] Probando el puerto " + $p + "...")
  $outServidor = Join-Path $raiz ("servidor-" + $p + ".log")
  $errServidor = Join-Path $raiz ("servidor-" + $p + ".err")
  $proc = $null
  try {
    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList ("/c npx next start -H 0.0.0.0 -p " + $p) `
      -WorkingDirectory $raiz -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $outServidor -RedirectStandardError $errServidor
  } catch {
    Diag ("    no se pudo lanzar en " + $p + ": " + $_.Exception.Message)
    continue
  }

  $ok = $false
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $p + "/api/health") -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
    if ($proc.HasExited) { break }
  }

  if ($ok) {
    Diag ("    OK: el puerto " + $p + " responde.")
    Diag ""
    Diag ("    App en marcha:  http://localhost:" + $p)
    Diag ("    Tambien:        http://127.0.0.1:" + $p)
    Diag ""
    Diag "    Si el navegador que se abre no carga, prueba la otra direccion"
    Diag "    o abre la app en Edge. Para parar: cierra esta ventana."
    Diag ""
    Start-Process ("http://localhost:" + $p)
    Wait-Process -Id $proc.Id
    exit 0
  }

  Diag ("    el puerto " + $p + " no responde; lo cierro y pruebo otro.")
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
  Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-4) } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

# == 5. Nada funciono: informe ==
Diag ""
Diag "[X] Ningun puerto responde. Abriendo diagnostico.bat para medir el problema."
$diag = Join-Path $raiz "diagnostico.bat"
if (Test-Path $diag) { Start-Process -FilePath $diag }
Read-Host "  Pulsa Enter para cerrar" | Out-Null
exit 1
