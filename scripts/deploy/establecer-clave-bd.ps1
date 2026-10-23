<#
.SYNOPSIS
  Escribe la contraseña de la base (DB_PASSWORD de ga_app) en el backend\.env
  del servidor, sin que pase por pantalla, archivos locales ni el historial.
  Ver docs/despliegue-iis.md.

.DESCRIPTION
  Se ejecuta a mano, en una ventana propia de PowerShell (no desde un asistente
  ni un registro de comandos): pide la contraseña con entrada oculta, la envía
  por la sesión de WinRM (cifrada) y reemplaza la línea DB_PASSWORD del .env.
  Después prueba la conexión a la base desde el servidor y dice si funcionó,
  sin mostrar la clave.

.EXAMPLE
  .\scripts\deploy\establecer-clave-bd.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$CredentialPath,

    [string]$ServerHost = "10.0.2.33",
    [string]$RemoteRoot = "C:\intranet"
)

$ErrorActionPreference = "Continue"
$credencial = Import-CliXml $CredentialPath

$segura = Read-Host "Contraseña de ga_app (no se muestra)" -AsSecureString
$clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
if (-not $clave) { throw "No se escribió ninguna contraseña." }
if ($clave -match '[#$"''\r\n]') {
    throw "La contraseña tiene un carácter que el .env no admite sin comillas (# `$ comillas o saltos de línea). Pida al DBA una sin esos caracteres."
}

$resultado = Invoke-Command -ComputerName $ServerHost -Credential $credencial -ArgumentList $RemoteRoot, $clave -ScriptBlock {
    param($RemoteRoot, $clave)
    $ErrorActionPreference = "Continue"
    $backend = Join-Path $RemoteRoot "backend"
    $envFile = Join-Path $backend ".env"
    if (-not (Test-Path $envFile)) { throw "No existe $envFile. Corra antes instalar-servidor.ps1." }
    $lineas = Get-Content $envFile -Encoding UTF8
    $nuevas = foreach ($linea in $lineas) { if ($linea -match '^DB_PASSWORD=') { "DB_PASSWORD=$clave" } else { $linea } }
    Set-Content -Path $envFile -Value $nuevas -Encoding UTF8

    # Prueba la conexión con la configuración real, sin imprimir la clave.
    $python = Join-Path $backend ".venv\Scripts\python.exe"
    $prueba = "import os,sys; sys.path.insert(0, r'$backend'); os.chdir(r'$backend'); os.environ['DJANGO_SETTINGS_MODULE']='config.settings.production'; import django; django.setup(); from django.db import connection; c=connection.cursor(); c.execute('SELECT SUSER_NAME(), DB_NAME()'); print('CONEXION_OK', *c.fetchone())"
    $salida = & $python -c $prueba
    $salida
}
Remove-Variable clave

$ok = $resultado | Where-Object { $_ -like "CONEXION_OK*" }
if ($ok) {
    Write-Host "Contraseña guardada y conexión verificada: $($ok -replace 'CONEXION_OK ', '')" -ForegroundColor Green
}
else {
    Write-Host "La contraseña se guardó, pero la conexión a la base FALLÓ. Revise la salida de arriba (¿la clave de ga_app es la correcta?)." -ForegroundColor Red
}
