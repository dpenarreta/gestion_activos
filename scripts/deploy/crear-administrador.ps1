<#
.SYNOPSIS
  Crea el primer administrador de la Intranet en el servidor, sin entrar a él
  y sin que la contraseña pase por pantalla, archivos ni historial. Ver
  docs/despliegue-iis.md.

.DESCRIPTION
  Se ejecuta a mano, en una ventana propia de PowerShell:

    powershell -ExecutionPolicy Bypass -File .\scripts\deploy\crear-administrador.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred"

  Pide usuario, correo, nombres, apellidos y la contraseña dos veces (oculta),
  y los manda por la sesión de WinRM (cifrada). En el servidor,
  backend\scripts\crear_administrador.py valida la contraseña con las reglas
  del sistema y crea la cuenta como superusuario en la única empresa. Con ese
  usuario se entra a http://10.0.2.33:5080 y se crean los demás desde
  Configuración → Usuarios y roles.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$CredentialPath,

    [string]$ServerHost = "10.0.2.33",
    [string]$RemoteRoot = "C:\intranet"
)

$ErrorActionPreference = "Continue"
$credencial = Import-CliXml $CredentialPath

function Leer-Oculta([string]$mensaje) {
    $segura = Read-Host $mensaje -AsSecureString
    [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
}

Write-Host "Primer administrador de la Intranet ($ServerHost)" -ForegroundColor Cyan
$usuario = (Read-Host "Usuario para entrar (ej. dpenarreta)").Trim()
$correo = (Read-Host "Correo institucional").Trim()
$nombres = (Read-Host "Nombres").Trim()
$apellidos = (Read-Host "Apellidos").Trim()
$clave = Leer-Oculta "Contraseña (no se muestra)"
$repetida = Leer-Oculta "Repita la contraseña"
if (-not $usuario -or -not $correo -or -not $clave) { throw "Usuario, correo y contraseña son obligatorios." }
if ($clave -ne $repetida) { throw "Las contraseñas no coinciden. No se creó nada." }
Remove-Variable repetida

$salida = Invoke-Command -ComputerName $ServerHost -Credential $credencial `
    -ArgumentList $RemoteRoot, $usuario, $correo, $nombres, $apellidos, $clave -ScriptBlock {
    param($RemoteRoot, $usuario, $correo, $nombres, $apellidos, $clave)
    $ErrorActionPreference = "Continue"
    $backend = Join-Path $RemoteRoot "backend"
    $registros = Join-Path $RemoteRoot "logs\despliegue"
    New-Item -ItemType Directory -Force -Path $registros | Out-Null
    # Por variables de entorno del proceso, nunca por argumentos (se verían en
    # la lista de procesos). Se borran al terminar.
    $env:ADMIN_USUARIO = $usuario; $env:ADMIN_CORREO = $correo
    $env:ADMIN_NOMBRES = $nombres; $env:ADMIN_APELLIDOS = $apellidos; $env:ADMIN_CLAVE = $clave
    $out = Join-Path $registros "crear-administrador.out.log"
    $err = Join-Path $registros "crear-administrador.err.log"
    $p = Start-Process -FilePath (Join-Path $backend ".venv\Scripts\python.exe") -ArgumentList "scripts\crear_administrador.py" `
        -WorkingDirectory $backend -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    Remove-Item Env:\ADMIN_USUARIO, Env:\ADMIN_CORREO, Env:\ADMIN_NOMBRES, Env:\ADMIN_APELLIDOS, Env:\ADMIN_CLAVE -ErrorAction SilentlyContinue
    Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_ -like "ADMIN_*" }
    if ($p.ExitCode -ne 0 -and -not (Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_ -like "ADMIN_*" })) {
        "ADMIN_ERROR " + ((Get-Content $err -Tail 5 -ErrorAction SilentlyContinue) -join " | ")
    }
}
Remove-Variable clave

$ok = $salida | Where-Object { $_ -like "ADMIN_OK*" }
if ($ok) {
    Write-Host ("Administrador creado: " + ($ok -replace '^ADMIN_OK ', '')) -ForegroundColor Green
    Write-Host "Entre en http://$ServerHost`:5080 con ese usuario."
}
else {
    $error1 = ($salida | Where-Object { $_ -like "ADMIN_ERROR*" }) -replace '^ADMIN_ERROR ', ''
    Write-Host "No se creó la cuenta: $error1" -ForegroundColor Red
}
