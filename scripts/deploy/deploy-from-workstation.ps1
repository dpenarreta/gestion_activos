<#
.SYNOPSIS
  Despliega la Intranet en el servidor de aplicaciones SER-WEBAI copiando los
  archivos desde esta máquina (el servidor no tiene Git). Ver
  docs/despliegue-iis.md.

.DESCRIPTION
  Adaptado del despliegue de NEXO (mismo servidor y mismo mecanismo), con sus
  lecciones: $ErrorActionPreference = "Continue" (las herramientas escriben en
  stderr aunque terminen bien), cada ejecutable se evalúa por $LASTEXITCODE,
  el éxito remoto se detecta por un marcador y no por la ausencia de errores,
  y nada se reinicia antes de que lo nuevo esté listo.

  Diferencias con NEXO:
  - El frontend es una aplicación de Vite (archivos estáticos): se compila EN
    ESTA MÁQUINA y se copia el resultado. El servidor no necesita Node,
    npm ci ni node_modules para este sistema, e IIS lo sirve directamente.
  - Un solo servicio de Windows: IntranetBackend (Django + waitress).
  - La cuenta de la aplicación (ga_app) no puede cambiar la estructura de la
    base. Las migraciones pendientes se detectan ANTES de reiniciar; para
    aplicarlas se usa -Migrar, que pide la clave de ga_migraciones en esta
    máquina, la usa solo para ese comando y no la guarda (el DBA tiene que
    habilitar ese usuario mientras tanto).

  Qué NO copia: backend\.env (vive solo en el servidor), .venv, logs, media,
  staticfiles ni node_modules.

.PARAMETER CredentialPath
  XML con la credencial del administrador (COURIERUIO\administrador), creado
  con Get-Credential | Export-CliXml. En formato UPN la autenticación falla.

.PARAMETER SkipInstall
  No reinstala las dependencias de Python (más rápido y sin detener la API
  antes de tiempo). Úselo si el cambio no toca backend\requirements.

.PARAMETER Migrar
  Aplica las migraciones pendientes con ga_migraciones. Toma la clave de
  -CredencialMigraciones si existe; si no, la pide.

.PARAMETER CredencialMigraciones
  Archivo cifrado con la credencial de ga_migraciones (por defecto
  $env:USERPROFILE\.deploy\ga-migraciones.cred), creado una vez con:
    Get-Credential ga_migraciones | Export-CliXml "$env:USERPROFILE\.deploy\ga-migraciones.cred"
  Solo funciona en esta máquina y con este usuario de Windows.

.PARAMETER OmitirVerificacionGit
  Despliega aunque la rama no sea main o tenga cambios sin subir. Solo para
  emergencias: lo desplegado tiene que poder reconstruirse desde el repositorio.

.EXAMPLE
  .\scripts\deploy\deploy-from-workstation.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred"
  .\scripts\deploy\deploy-from-workstation.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred" -SkipInstall
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$CredentialPath,

    [string]$ServerHost = "10.0.2.33",
    [string]$RemoteRoot = "C:\intranet",
    [int]$PublicPort = 5080,
    [int]$BackendPort = 8010,
    [string]$ServiceName = "IntranetBackend",
    [string]$AppPool = "Intranet",
    [string]$LocalRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,

    [switch]$SkipInstall,
    [switch]$Migrar,
    [string]$CredencialMigraciones = "$env:USERPROFILE\.deploy\ga-migraciones.cred",
    [switch]$OmitirVerificacionGit
)

$ErrorActionPreference = "Continue"

function Write-Paso {
    param([string]$Texto)
    Write-Host ""
    Write-Host "== $Texto" -ForegroundColor Cyan
}

if (-not (Test-Path $CredentialPath)) {
    throw "No existe el archivo de credenciales '$CredentialPath'."
}
$credencial = Import-CliXml $CredentialPath
if ($credencial.UserName -like "*@*") {
    throw "La credencial es '$($credencial.UserName)' (formato UPN). Por IP hace falta DOMINIO\usuario, ej. COURIERUIO\administrador."
}

# --- 1. Lo que se despliega es exactamente lo que está en main -------------------------
Write-Paso "Verificando el repositorio"
Push-Location $LocalRoot
try {
    $rama = (git rev-parse --abbrev-ref HEAD).Trim()
    $sucio = git status --porcelain
    git fetch origin main --quiet
    $local = (git rev-parse HEAD).Trim()
    $remoto = (git rev-parse origin/main).Trim()
    $commit = (git log -1 --format="%h %s").Trim()
}
finally { Pop-Location }
Write-Host "  Rama $rama · $commit"
if (-not $OmitirVerificacionGit) {
    if ($rama -ne "main") { throw "La rama es '$rama'. Se despliega solo main." }
    if ($sucio) { throw "Hay cambios sin commit. Súbalos (o descártelos) antes de desplegar." }
    if ($local -ne $remoto) { throw "main no está al día con origin/main. Haga pull o push antes de desplegar." }
}

$claveMigraciones = $null
if ($Migrar) {
    # Con -CredencialMigraciones se lee de un archivo cifrado con el usuario de
    # Windows de esta máquina (como la credencial del servidor); si no, se pide.
    if ($CredencialMigraciones -and (Test-Path $CredencialMigraciones)) {
        $cm = Import-CliXml $CredencialMigraciones
    }
    else {
        $cm = Get-Credential -UserName "ga_migraciones" -Message "Clave de ga_migraciones (el DBA debe haberlo habilitado)"
    }
    $claveMigraciones = $cm.GetNetworkCredential().Password
    if (-not $claveMigraciones) { throw "No se obtuvo la clave de ga_migraciones." }
}

# --- 2. Compilar el frontend aquí -------------------------------------------------------------
Write-Paso "Compilando el frontend"
Push-Location (Join-Path $LocalRoot "frontend")
try {
    # Las variables del proceso mandan sobre los .env de Vite: la API va por la
    # misma dirección que el sitio (IIS reenvía /api/ a Django).
    $env:VITE_API_BASE_URL = "/api/v1"
    npm run build
    $codigoBuild = $LASTEXITCODE
}
finally {
    Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}
if ($codigoBuild -ne 0) { throw "El build del frontend falló (código $codigoBuild). No se tocó el servidor." }
$dist = Join-Path $LocalRoot "frontend\dist"
if (-not (Test-Path (Join-Path $dist "index.html"))) { throw "El build no produjo frontend\dist\index.html." }

# --- 3. Copiar al servidor ----------------------------------------------------------------------
Write-Paso "Conectando con $ServerHost"
$identidad = Invoke-Command -ComputerName $ServerHost -Credential $credencial -ErrorAction Stop -ScriptBlock {
    "$env:COMPUTERNAME ($env:USERDOMAIN\$env:USERNAME)"
}
Write-Host "  Conectado a $identidad"

$unidad = "IntranetDeploy"
New-PSDrive -Name $unidad -PSProvider FileSystem -Root "\\$ServerHost\c`$" -Credential $credencial -ErrorAction Stop | Out-Null
try {
    $destinoUNC = "\\$ServerHost\c$" + ($RemoteRoot -replace "^[A-Za-z]:", "")
    $comunes = @("/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1")

    # /MIR para que lo borrado en el repositorio también desaparezca del servidor.
    $carpetas = @(
        @{ Origen = "backend\apps";         Destino = "backend\apps" },
        @{ Origen = "backend\config";       Destino = "backend\config" },
        @{ Origen = "backend\scripts";      Destino = "backend\scripts" },
        @{ Origen = "backend\requirements"; Destino = "backend\requirements" }
    )
    foreach ($c in $carpetas) {
        $origen = Join-Path $LocalRoot $c.Origen
        if (-not (Test-Path $origen)) { continue }
        Write-Paso "Copiando $($c.Origen)"
        robocopy $origen (Join-Path $destinoUNC $c.Destino) /MIR /XD __pycache__ @comunes | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy falló al copiar $($c.Origen) (código $LASTEXITCODE)." }
    }
    $templates = Join-Path $LocalRoot "backend\templates"
    if (Test-Path $templates) {
        robocopy $templates (Join-Path $destinoUNC "backend\templates") /MIR @comunes | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy falló al copiar backend\templates (código $LASTEXITCODE)." }
    }
    Copy-Item (Join-Path $LocalRoot "backend\manage.py") (Join-Path $destinoUNC "backend\manage.py") -Force -ErrorAction Stop

    # El frontend compilado y la configuración del sitio. /MIR sobre web\: los
    # archivos de assets llevan hash y los viejos ya no se usan.
    Write-Paso "Copiando el frontend compilado"
    $webUNC = Join-Path $destinoUNC "web"
    $webNuevo = Join-Path $destinoUNC "web.nuevo"
    robocopy $dist $webNuevo /MIR @comunes | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy falló al copiar el frontend (código $LASTEXITCODE)." }
    Copy-Item (Join-Path $LocalRoot "deploy\iis\web.config") (Join-Path $webNuevo "web.config") -Force -ErrorAction Stop
}
finally {
    Remove-PSDrive $unidad -ErrorAction SilentlyContinue
}

# --- 4. Instalar, verificar y reiniciar en el servidor ---------------------------------------
Write-Paso "Instalando y reiniciando en el servidor"
$MARCADOR_OK = "INTRANET_DESPLIEGUE_OK"
$salidaRemota = Invoke-Command -ComputerName $ServerHost -Credential $credencial -ErrorAction Continue `
    -ArgumentList $RemoteRoot, $SkipInstall.IsPresent, $ServiceName, $BackendPort, $claveMigraciones, $commit, $AppPool `
    -ScriptBlock {
    param($RemoteRoot, $SkipInstall, $ServiceName, $BackendPort, $claveMigraciones, $commit, $AppPool)
    $ErrorActionPreference = "Continue"
    $backend = Join-Path $RemoteRoot "backend"
    $python = Join-Path $backend ".venv\Scripts\python.exe"
    $env:DJANGO_SETTINGS_MODULE = "config.settings.production"
    Set-Location $backend

    $envFile = Join-Path $backend ".env"
    $pendiente = Select-String -Path $envFile -Pattern '^DB_PASSWORD=PENDIENTE$' -Quiet
    $registros = Join-Path $RemoteRoot "logs\despliegue"
    New-Item -ItemType Directory -Force -Path $registros | Out-Null

    # Corre python con su salida en archivos (nunca 2>&1 sobre un ejecutable
    # en PowerShell 5.1) y, si falla, muestra las últimas líneas: sin esto el
    # motivo de un fallo remoto no llegaba a esta consola.
    function Ejecutar([string]$nombre, [string]$argumentos) {
        $out = Join-Path $registros "$nombre.out.log"
        $err = Join-Path $registros "$nombre.err.log"
        $p = Start-Process -FilePath $python -ArgumentList $argumentos -WorkingDirectory $backend `
            -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
        if ($p.ExitCode -ne 0) {
            Write-Host "   ---- últimas líneas de $nombre ----"
            Get-Content $out -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $_" }
            Get-Content $err -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $_" }
        }
        return $p.ExitCode
    }

    if (-not $SkipInstall) {
        # pip no puede reemplazar archivos de paquetes que el servicio tiene
        # abiertos: se detiene antes. La API queda abajo hasta el reinicio.
        Write-Host "-- deteniendo $ServiceName para actualizar dependencias"
        Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
        Write-Host "-- pip install"
        $codigo = Ejecutar "pip" "-m pip install -r requirements\prod-windows.txt --quiet --disable-pip-version-check"
        if ($codigo -ne 0) { throw "pip install falló (código $codigo)." }
    }

    Write-Host "-- manage.py check"
    $codigo = Ejecutar "check" "manage.py check"
    if ($codigo -ne 0) { throw "manage.py check falló (código $codigo). No se reinició nada." }

    Write-Host "-- manage.py collectstatic"
    $codigo = Ejecutar "collectstatic" "manage.py collectstatic --noinput"
    if ($codigo -ne 0) { throw "collectstatic falló (código $codigo)." }

    if ($pendiente) {
        Write-Host "-- DB_PASSWORD todavía está pendiente: no se revisan migraciones ni se inicia la API."
        Write-Host "   Ejecute scripts\deploy\establecer-clave-bd.ps1 y vuelva a desplegar."
    }
    else {
        if ($claveMigraciones) {
            Write-Host "-- manage.py migrate (con ga_migraciones)"
            # Solo para este proceso: el .env sigue con ga_app.
            $env:DB_USER = "ga_migraciones"
            $env:DB_PASSWORD = $claveMigraciones
            $codigo = Ejecutar "migrate" "manage.py migrate --noinput"
            Remove-Item Env:\DB_USER, Env:\DB_PASSWORD -ErrorAction SilentlyContinue
            if ($codigo -ne 0) { throw "Las migraciones fallaron (código $codigo). ¿Está habilitado ga_migraciones?" }
        }
        Write-Host "-- manage.py migrate --check"
        $codigo = Ejecutar "migrate-check" "manage.py migrate --check"
        if ($codigo -ne 0) {
            throw "Hay migraciones pendientes (o no se pudo consultar la base). Si son migraciones: pida al DBA habilitar ga_migraciones y despliegue con -Migrar."
        }
    }

    # El frontend nuevo entra de un solo golpe: se renombra la carpeta.
    Write-Host "-- publicando el frontend"
    $web = Join-Path $RemoteRoot "web"
    $nuevo = Join-Path $RemoteRoot "web.nuevo"
    $viejo = Join-Path $RemoteRoot "web.anterior"
    if (Test-Path $viejo) { Remove-Item $viejo -Recurse -Force -ErrorAction Stop }
    if (Test-Path $web) { Rename-Item $web "web.anterior" -ErrorAction Stop }
    Rename-Item $nuevo "web" -ErrorAction Stop
    # La caché de archivos de IIS (dentro del proceso del sitio, aparte de la
    # de salida que web.config ya apaga para los .html) sigue atada al
    # index.html de la carpeta renombrada a web.anterior: servía el index
    # anterior, que pide un JS que ya no existe, y la página quedaba en blanco
    # (27/10/2026). Reciclar el grupo de aplicaciones la vacía; las peticiones
    # en curso terminan en el proceso viejo.
    $appcmd = Join-Path $env:windir "system32\inetsrv\appcmd.exe"
    & $appcmd recycle apppool /apppool.name:$AppPool | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo reciclar el grupo de aplicaciones $AppPool de IIS." }

    if ($pendiente) {
        "INTRANET_DESPLIEGUE_OK"
        return
    }

    Write-Host "-- reiniciando $ServiceName"
    Restart-Service -Name $ServiceName -ErrorAction Stop
    $listo = $false
    foreach ($intento in 1..30) {
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-WebRequest "http://127.0.0.1:$BackendPort/api/v1/health/ready/" -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $listo = $true; break }
        }
        catch { }
    }
    if (-not $listo) { throw "La API no respondió en 60 s. Revise C:\intranet\logs\$ServiceName.err.log." }
    Write-Host "-- API lista (base de datos conectada)"

    # Las tareas programadas se habilitan cuando la API ya funciona.
    Get-ScheduledTask -TaskPath "\Intranet\" -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Disabled" } | Enable-ScheduledTask | Out-Null
    Set-Content -Path (Join-Path $RemoteRoot "VERSION.txt") -Value "$commit · $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Encoding UTF8

    "INTRANET_DESPLIEGUE_OK"
}
$claveMigraciones = $null

if ($salidaRemota -notcontains $MARCADOR_OK) {
    throw "El despliegue remoto no llegó a terminar. Revise la salida de arriba."
}

# --- 5. Verificar desde la red ------------------------------------------------------------------
Write-Paso "Verificando el sitio"
$sitio = "http://$ServerHost`:$PublicPort"
try {
    $inicio = Invoke-WebRequest "$sitio/" -UseBasicParsing -TimeoutSec 15
    Write-Host "  $sitio/  ->  $($inicio.StatusCode)"
    $api = Invoke-WebRequest "$sitio/api/v1/health/ready/" -UseBasicParsing -TimeoutSec 15
    Write-Host "  $sitio/api/v1/health/ready/  ->  $($api.StatusCode) $($api.Content)"
}
catch {
    Write-Host "  El sitio no respondió como se esperaba: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Paso "Listo: $commit"
Write-Host "Sitio: $sitio"
exit 0
