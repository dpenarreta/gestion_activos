<#
.SYNOPSIS
  Instalación inicial de la Intranet en el servidor de aplicaciones (una sola
  vez), desde esta máquina por WinRM. Ver docs/despliegue-iis.md.

.DESCRIPTION
  Crea, solo si no existe todavía:
  - la carpeta C:\intranet (backend, web, media, logs);
  - el entorno de Python (backend\.venv);
  - el backend\.env del servidor, con las claves SECRET_KEY y JWT_SECRET_KEY
    generadas EN el servidor (nunca pasan por esta máquina) y DB_PASSWORD
    pendiente: se escribe aparte con establecer-clave-bd.ps1;
  - el servicio de Windows IntranetBackend (NSSM + waitress en 127.0.0.1);
  - el grupo de aplicaciones y el sitio IIS «Intranet» en el puerto público;
  - la regla de firewall de ese puerto;
  - las tareas programadas (ciclo cada 5 minutos, indicadores y alertas).

  No modifica nada de otros sistemas (Nexo, AsisVen...). Es idempotente: lo
  que ya existe se deja como está, y en particular un .env existente nunca se
  sobrescribe.

.EXAMPLE
  .\scripts\deploy\instalar-servidor.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$CredentialPath,

    [string]$ServerHost = "10.0.2.33",
    [string]$RemoteRoot = "C:\intranet",
    [int]$BackendPort = 8010,
    [int]$PublicPort = 5080,
    [string]$ServiceName = "IntranetBackend",
    [string]$SiteName = "Intranet",
    [string]$NssmPath = "C:\tools\nssm-2.24\win64\nssm.exe",
    [string]$DbHost = "10.0.2.51",
    [string]$DbName = "intranet",
    [string]$DbUser = "ga_app"
)

$ErrorActionPreference = "Continue"

if (-not (Test-Path $CredentialPath)) {
    throw "No existe el archivo de credenciales '$CredentialPath'."
}
$credencial = Import-CliXml $CredentialPath
if ($credencial.UserName -like "*@*") {
    throw "La credencial es '$($credencial.UserName)' (formato UPN). Por IP hace falta DOMINIO\usuario."
}

$MARCADOR_OK = "INTRANET_INSTALACION_OK"
$salida = Invoke-Command -ComputerName $ServerHost -Credential $credencial -ErrorAction Continue `
    -ArgumentList $RemoteRoot, $BackendPort, $PublicPort, $ServiceName, $SiteName, $NssmPath, $ServerHost, $DbHost, $DbName, $DbUser `
    -ScriptBlock {
    param($RemoteRoot, $BackendPort, $PublicPort, $ServiceName, $SiteName, $NssmPath, $ServerHost, $DbHost, $DbName, $DbUser)
    $ErrorActionPreference = "Continue"

    function Paso([string]$texto) { Write-Host "-- $texto" }

    # Lo ocupado por otros sistemas: nunca se toca.
    $ocupados = Get-NetTCPConnection -State Listen | Select-Object -ExpandProperty LocalPort -Unique
    foreach ($puerto in @($BackendPort, $PublicPort)) {
        if ($ocupados -contains $puerto -and -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
            throw "El puerto $puerto ya está en uso en el servidor. Elija otro."
        }
    }
    if (-not (Test-Path $NssmPath)) { throw "No se encontró NSSM en $NssmPath." }

    $backend = Join-Path $RemoteRoot "backend"
    $web = Join-Path $RemoteRoot "web"
    $logs = Join-Path $RemoteRoot "logs"
    $media = Join-Path $RemoteRoot "media"

    Paso "carpetas"
    foreach ($carpeta in @($RemoteRoot, $backend, $web, $logs, $media, (Join-Path $backend "logs"))) {
        New-Item -ItemType Directory -Force -Path $carpeta -ErrorAction Stop | Out-Null
    }
    # Página provisional hasta el primer despliegue.
    if (-not (Test-Path (Join-Path $web "index.html"))) {
        Set-Content -Path (Join-Path $web "index.html") -Value "<!doctype html><title>Intranet</title><p>Instalación en curso.</p>" -Encoding UTF8
    }

    Paso "entorno de Python"
    $python = Join-Path $backend ".venv\Scripts\python.exe"
    if (-not (Test-Path $python)) {
        & py -3.12 -m venv (Join-Path $backend ".venv")
        if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el entorno de Python (código $LASTEXITCODE)." }
        & $python -m pip install --upgrade pip --quiet
    }

    Paso ".env del servidor"
    $envFile = Join-Path $backend ".env"
    if (Test-Path $envFile) {
        Write-Host "   ya existe: no se toca"
    }
    else {
        # Las claves se generan aquí, en el servidor, y no se muestran.
        $secret = & $python -c "import secrets; print(secrets.token_urlsafe(50))"
        $jwt = & $python -c "import secrets; print(secrets.token_urlsafe(50))"
        if (-not $secret -or -not $jwt -or $secret -eq $jwt) { throw "No se pudieron generar las claves." }
        $origen = "http://$ServerHost`:$PublicPort"
        $lineas = @(
            "# backend\.env del servidor de aplicaciones (docs/despliegue-iis.md).",
            "# Vive solo en el servidor: nunca se copia ni se versiona.",
            "DJANGO_SETTINGS_MODULE=config.settings.production",
            "DEBUG=False",
            "SECRET_KEY=$secret",
            "JWT_SECRET_KEY=$jwt",
            "ALLOWED_HOSTS=$ServerHost,127.0.0.1,localhost",
            "FRONTEND_URL=$origen",
            "PUBLIC_API_URL=$origen",
            "CORS_ALLOWED_ORIGINS=$origen",
            "CSRF_TRUSTED_ORIGINS=$origen",
            "# Sitio por http en la red interna (sin certificado): sin redirección a",
            "# https ni HSTS. Cambiar al instalar un certificado.",
            "SECURE_SSL_REDIRECT=False",
            "SECURE_HSTS_SECONDS=0",
            "BACKEND_PORT=$BackendPort",
            "DB_HOST=$DbHost",
            "DB_PORT=1433",
            "DB_NAME=$DbName",
            "DB_USER=$DbUser",
            "DB_PASSWORD=PENDIENTE",
            "DB_DRIVER=ODBC Driver 18 for SQL Server",
            "DB_TRUST_SERVER_CERTIFICATE=true",
            "MULTIEMPRESA=false",
            "NOMINA_ROL_DEMO=false",
            "# Correo apagado hasta tener el buzón del sistema: no se envía nada.",
            "EMAIL_BACKEND=django.core.mail.backends.dummy.EmailBackend",
            "MEDIA_ROOT=$media"
        )
        Set-Content -Path $envFile -Value $lineas -Encoding UTF8 -ErrorAction Stop
        # Solo administradores y el sistema pueden leerlo.
        # Por SID y no por nombre: el servidor está en español («Administradores»).
        & icacls $envFile /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" | Out-Null
        Write-Host "   creado (DB_PASSWORD pendiente)"
    }

    Paso "servicio $ServiceName"
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        Write-Host "   ya existe"
    }
    else {
        & $NssmPath install $ServiceName $python (Join-Path $backend "scripts\serve_windows.py") | Out-Null
        & $NssmPath set $ServiceName AppDirectory $backend | Out-Null
        & $NssmPath set $ServiceName DisplayName "Intranet - Backend (Django)" | Out-Null
        & $NssmPath set $ServiceName Description "API de la Intranet (Django + waitress en 127.0.0.1:$BackendPort). Ver C:\intranet." | Out-Null
        & $NssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Null
        & $NssmPath set $ServiceName AppEnvironmentExtra "DJANGO_SETTINGS_MODULE=config.settings.production" "PYTHONUNBUFFERED=1" | Out-Null
        & $NssmPath set $ServiceName AppStdout (Join-Path $logs "$ServiceName.out.log") | Out-Null
        & $NssmPath set $ServiceName AppStderr (Join-Path $logs "$ServiceName.err.log") | Out-Null
        & $NssmPath set $ServiceName AppRotateFiles 1 | Out-Null
        & $NssmPath set $ServiceName AppRotateBytes 10485760 | Out-Null
        & $NssmPath set $ServiceName AppExit Default Restart | Out-Null
        & $NssmPath set $ServiceName AppRestartDelay 5000 | Out-Null
        if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { throw "NSSM no creó el servicio." }
        Write-Host "   creado (se inicia con el primer despliegue)"
    }

    Paso "sitio IIS $SiteName"
    Import-Module WebAdministration -ErrorAction Stop
    $pool = "IIS:\AppPools\$SiteName"
    if (-not (Test-Path $pool)) {
        New-WebAppPool -Name $SiteName -ErrorAction Stop | Out-Null
        Set-ItemProperty $pool -Name managedRuntimeVersion -Value ""
    }
    if (Get-Website -Name $SiteName -ErrorAction SilentlyContinue) {
        Write-Host "   ya existe"
    }
    else {
        New-Website -Name $SiteName -Port $PublicPort -PhysicalPath $web -ApplicationPool $SiteName -ErrorAction Stop | Out-Null
        Write-Host "   creado en *:$PublicPort"
    }

    Paso "firewall"
    $regla = "Intranet (HTTP $PublicPort)"
    if (-not (Get-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $regla -Direction Inbound -Action Allow -Protocol TCP -LocalPort $PublicPort -ErrorAction Stop | Out-Null
        Write-Host "   regla creada"
    }
    else { Write-Host "   ya existe" }

    Paso "tareas programadas"
    $pythonw = Join-Path $backend ".venv\Scripts\pythonw.exe"
    $usuario = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    # Todas pasan por scripts\produccion.py: fuerza la configuración de
    # producción sin una variable de la máquina (NEXO es otro Django).
    $tareas = @(
        @{ Nombre = "Intranet-Ciclo"; Exe = $pythonw; Script = "scripts\produccion.py scripts\tarea_respaldo.py"; Disparador = (New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)) },
        @{ Nombre = "Intranet-Indicadores"; Exe = $python; Script = "scripts\produccion.py manage.py recalcular_indicadores"; Disparador = (New-ScheduledTaskTrigger -Daily -At "05:00") },
        @{ Nombre = "Intranet-Alertas"; Exe = $python; Script = "scripts\produccion.py manage.py enviar_alertas"; Disparador = (New-ScheduledTaskTrigger -Daily -At "07:00") }
    )
    foreach ($tarea in $tareas) {
        if (Get-ScheduledTask -TaskName $tarea.Nombre -ErrorAction SilentlyContinue) { Write-Host "   $($tarea.Nombre): ya existe"; continue }
        $accion = New-ScheduledTaskAction -Execute $tarea.Exe -Argument $tarea.Script -WorkingDirectory $backend
        Register-ScheduledTask -TaskName $tarea.Nombre -TaskPath "\Intranet\" -Action $accion -Trigger $tarea.Disparador `
            -Principal $usuario -Settings $ajustes -Description "Intranet (C:\intranet). Ver docs/despliegue-iis.md." -ErrorAction Stop | Out-Null
        # Deshabilitadas hasta que el primer despliegue deje el código en su lugar.
        Disable-ScheduledTask -TaskName $tarea.Nombre -TaskPath "\Intranet\" | Out-Null
        Write-Host "   $($tarea.Nombre): creada (deshabilitada hasta el primer despliegue)"
    }

    "INTRANET_INSTALACION_OK"
}

if ($salida -notcontains $MARCADOR_OK) {
    throw "La instalación no llegó a terminar. Revise la salida de arriba."
}
Write-Host ""
Write-Host "Instalación inicial lista en $ServerHost`:$RemoteRoot" -ForegroundColor Green
Write-Host "Siguiente paso: .\scripts\deploy\establecer-clave-bd.ps1 (clave de ga_app) y el primer despliegue."
exit 0
