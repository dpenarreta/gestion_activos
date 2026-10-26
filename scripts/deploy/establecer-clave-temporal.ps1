<#
.SYNOPSIS
  Escribe la clave temporal de las cuentas nuevas (CLAVE_INICIAL_USUARIOS) en
  el backend\.env del servidor y, con -TambienLocal, en el de esta máquina,
  sin que pase por pantalla, archivos del repositorio ni el historial.

.DESCRIPTION
  La clave temporal es con la que nacen las cuentas que se crean sin escribir
  contraseña; solo sirve para el primer inicio de sesión, en el que el sistema
  obliga a cambiarla (26/10/2026). Va solo en el .env de cada entorno, nunca
  en el código.

  Se ejecuta a mano, en una ventana propia de PowerShell: pide la clave dos
  veces con entrada oculta, comprueba que cumpla las reglas (8 caracteres, una
  mayúscula, un número y un signo especial), la envía por la sesión de WinRM
  (cifrada), reemplaza o agrega la línea del .env y reinicia el servicio
  IntranetBackend para que la tome.

.EXAMPLE
  .\scripts\deploy\establecer-clave-temporal.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred" -TambienLocal
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$CredentialPath,

    [switch]$TambienLocal,

    [string]$ServerHost = "10.0.2.33",
    [string]$RemoteRoot = "C:\intranet"
)

$ErrorActionPreference = "Continue"
$credencial = Import-CliXml $CredentialPath
$Variable = "CLAVE_INICIAL_USUARIOS"

function Leer-Oculta([string]$mensaje) {
    $segura = Read-Host $mensaje -AsSecureString
    [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
}

function Escribir-EnEnv([string]$envFile, [string]$clave) {
    $lineas = @()
    if (Test-Path $envFile) { $lineas = @(Get-Content $envFile -Encoding UTF8) }
    $hay = $false
    $nuevas = foreach ($linea in $lineas) {
        if ($linea -match "^$Variable=") { $hay = $true; "$Variable=$clave" } else { $linea }
    }
    if (-not $hay) { $nuevas = @($nuevas) + "$Variable=$clave" }
    # UTF-8 SIN BOM (con BOM, django-environ avisa «Invalid line»).
    $nuevas = $nuevas | ForEach-Object { $_.TrimStart([char]0xFEFF) }
    [IO.File]::WriteAllLines($envFile, [string[]]$nuevas, (New-Object Text.UTF8Encoding($false)))
}

$clave = Leer-Oculta "Clave temporal de las cuentas nuevas (no se muestra)"
$repetida = Leer-Oculta "Repítala"
if (-not $clave) { throw "No se escribió ninguna clave." }
if ($clave -ne $repetida) { throw "Las claves no coinciden. No se cambió nada." }
Remove-Variable repetida
$faltan = @()
if ($clave.Length -lt 8) { $faltan += "8 caracteres" }
if ($clave -cnotmatch '\p{Lu}') { $faltan += "una mayúscula" }
if ($clave -notmatch '\d') { $faltan += "un número" }
if ($clave -notmatch '[^\p{L}\p{N}\s]') { $faltan += "un signo especial" }
if ($faltan) { throw "La clave no cumple las reglas; le falta: $($faltan -join ', '). No se cambió nada." }
if ($clave -match '[#$"''\r\n]') {
    throw "La clave tiene un carácter que el .env no admite sin comillas (# `$ comillas o saltos de línea). Elija otro signo, por ejemplo @, !, * o -."
}

$resultado = Invoke-Command -ComputerName $ServerHost -Credential $credencial -ArgumentList $RemoteRoot, $Variable, $clave -ScriptBlock {
    param($RemoteRoot, $Variable, $clave)
    $ErrorActionPreference = "Continue"
    $envFile = Join-Path $RemoteRoot "backend\.env"
    if (-not (Test-Path $envFile)) { throw "No existe $envFile. Corra antes instalar-servidor.ps1." }
    $lineas = @(Get-Content $envFile -Encoding UTF8)
    $hay = $false
    $nuevas = foreach ($linea in $lineas) {
        if ($linea -match "^$Variable=") { $hay = $true; "$Variable=$clave" } else { $linea }
    }
    if (-not $hay) { $nuevas = @($nuevas) + "$Variable=$clave" }
    $nuevas = $nuevas | ForEach-Object { $_.TrimStart([char]0xFEFF) }
    [IO.File]::WriteAllLines($envFile, [string[]]$nuevas, (New-Object Text.UTF8Encoding($false)))
    Restart-Service IntranetBackend
    Start-Sleep -Seconds 5
    "SERVICIO " + (Get-Service IntranetBackend).Status
}

if ($TambienLocal) {
    $local = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "backend\.env"
    Escribir-EnEnv $local $clave
    Write-Host "También quedó en $local (reinicie el backend local para que la tome)." -ForegroundColor Green
}
Remove-Variable clave

$estado = $resultado | Where-Object { $_ -like "SERVICIO*" }
if ($estado -match "Running") {
    Write-Host "Clave temporal guardada en el servidor e IntranetBackend reiniciado." -ForegroundColor Green
}
else {
    Write-Host "La clave se guardó, pero el servicio no quedó en marcha: $estado. Revise el servidor." -ForegroundColor Red
}
