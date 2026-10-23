# Despliegue en el servidor de aplicaciones (IIS, Windows)

La Intranet corre en **SER-WEBAI (10.0.2.33)**, Windows Server 2022 con IIS 10,
y se despliega **desde la máquina de desarrollo** por WinRM, sin entrar al
servidor y sin Git en él. Es el mismo mecanismo que NEXO, que ya corre en ese
servidor (ver `gestion_tareas_rrhh/docs/DEPLOYMENT_IIS.md`), adaptado a este
proyecto.

```
Usuarios (LAN) ──http──▶ IIS «Intranet» (*:5080) ──┬─ archivos del frontend (C:\intranet\web)
                                                   └─ /api/ ─ARR─▶ IntranetBackend (127.0.0.1:8010)
                                                                       │ Django + waitress
                                                                       ▼
                                                     SQL Server 10.0.2.51 · base «intranet» · ga_app
```

## En el servidor

| | |
|---|---|
| Carpeta | `C:\intranet` — `backend\` (código, `.venv`, `.env`), `web\` (frontend compilado), `media\` (adjuntos), `logs\` |
| Sitio IIS | **Intranet**, `http://10.0.2.33:5080`, grupo de aplicaciones «Intranet» sin código administrado |
| Servicio | **IntranetBackend** (NSSM `C:\tools\nssm-2.24\win64\nssm.exe`): `backend\scripts\serve_windows.py`, waitress en **127.0.0.1:8010**, arranque automático y reinicio si se cae |
| Tareas (`\Intranet\`) | **Intranet-Ciclo** cada 5 min (`tarea_respaldo.py`: Matriz, Mesa de ayuda, dashboards y respaldo si toca) · **Intranet-Indicadores** 05:00 · **Intranet-Alertas** 07:00. Corren como SYSTEM y pasan por `scripts\produccion.py` |
| Firewall | Regla «Intranet (HTTP 5080)», solo TCP 5080 de entrada |
| Logs | `C:\intranet\logs\IntranetBackend.{out,err}.log` (NSSM rota a los 10 MB) y `backend\logs\tarea-respaldo.log` |

**Lo que no es de este sistema y no se toca:** `C:\nexo` y los servicios
NexoBackend/NexoFrontend, los sitios y servicios de AsisVen, el Default Web
Site y los puertos 80, 443, 3000–3003, 3080, 4080, 8000, 8443–8445, 9115, 9165,
9200 y 50810.

### Por qué así

- **El frontend es estático** (Vite): se compila en la máquina de desarrollo y
  se copia `frontend\dist`. IIS lo sirve directamente; no hay servicio de
  Node ni `node_modules` en el servidor para este sistema (a diferencia de
  NEXO, que es Next.js).
- **`/admin/` no se reenvía a Django**: es una ruta del frontend. El admin de
  Django queda inalcanzable desde la red.
- **La configuración de producción se fuerza por proceso, no por máquina.**
  `manage.py` usa desarrollo por defecto; en el servidor el servicio lo recibe
  de NSSM y las tareas de `scripts\produccion.py`. Una variable global
  `DJANGO_SETTINGS_MODULE` cambiaría también la de NEXO.
- **http, sin certificado** (red interna, por IP): `SECURE_SSL_REDIRECT=False`
  y `SECURE_HSTS_SECONDS=0` en el `.env`. La sesión va por token y no por
  cookie, así que funciona por http; pero las contraseñas viajan en claro por
  la red interna. Al instalar un certificado: binding https en IIS, quitar
  esas dos variables y cambiar los orígenes a `https://`.

## El `backend\.env` del servidor

Vive solo en el servidor (solo lo leen Administradores y SYSTEM) y nunca se
copia ni se versiona. Lo crea `instalar-servidor.ps1`:

- `SECRET_KEY` y `JWT_SECRET_KEY` **se generan en el servidor** y no pasan por
  ninguna otra máquina.
- `DB_HOST=10.0.2.51`, `DB_NAME=intranet`, `DB_USER=ga_app`,
  `DB_DRIVER=ODBC Driver 18 for SQL Server`.
- `ALLOWED_HOSTS`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`
  con `http://10.0.2.33:5080`.
- `MULTIEMPRESA=false`, `NOMINA_ROL_DEMO=false`.
- `EMAIL_BACKEND=…dummy…`: **el correo está apagado** hasta tener el buzón del
  sistema. Para encenderlo, reemplazarlo por el SMTP real (`EMAIL_HOST`,
  `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`,
  `DEFAULT_FROM_EMAIL`) y reiniciar IntranetBackend.
- **`DB_PASSWORD`** (la clave de `ga_app`) se escribe aparte, con
  `establecer-clave-bd.ps1`, que la pide oculta y la manda por la sesión de
  WinRM: no queda en pantalla, ni en archivos locales, ni en el repositorio.

## Requisitos en la máquina de desarrollo (una sola vez)

```powershell
# Credencial del administrador, cifrada con su usuario de Windows (solo sirve en esta PC).
# DOMINIO\usuario: con usuario@dominio la autenticación por IP falla.
New-Item -ItemType Directory -Force "$env:USERPROFILE\.deploy" | Out-Null
Get-Credential COURIERUIO\administrador | Export-CliXml "$env:USERPROFILE\.deploy\ser-webai.cred"

# WinRM encendido y el servidor en TrustedHosts (PowerShell como administrador).
Start-Service WinRM
Set-Item WSMan:\localhost\Client\TrustedHosts -Value "10.0.2.33" -Force
```

## Instalación inicial (ya hecha el 23/10/2026)

```powershell
.\scripts\deploy\instalar-servidor.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred"
.\scripts\deploy\establecer-clave-bd.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred"   # en una ventana propia
```

`instalar-servidor.ps1` es idempotente: lo que ya existe no se toca y el
`.env` nunca se sobrescribe.

## Desplegar

```powershell
.\scripts\deploy\deploy-from-workstation.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred"
# Sin cambios en backend\requirements (más rápido, sin detener la API antes):
.\scripts\deploy\deploy-from-workstation.ps1 -CredentialPath "$env:USERPROFILE\.deploy\ser-webai.cred" -SkipInstall
```

Qué hace, en orden:

1. Exige estar en **main, sin cambios pendientes y al día con origin/main**
   (`-OmitirVerificacionGit` solo para emergencias).
2. Compila el frontend aquí, con `VITE_API_BASE_URL=/api/v1`. Si falla, no
   toca el servidor.
3. Copia `backend\apps`, `config`, `scripts`, `requirements` y `manage.py`
   (con `/MIR`: lo borrado en el repositorio desaparece del servidor) y el
   frontend compilado a `web.nuevo` con su `web.config`. Nunca copia `.env`,
   `.venv`, `logs`, `media` ni `staticfiles`.
4. En el servidor: `pip install` (deteniendo antes el servicio, salvo con
   `-SkipInstall`), `manage.py check`, `collectstatic` y
   **`migrate --check`**. Si algo falla, no se reinicia nada.
5. Publica el frontend de un golpe (renombra `web.nuevo` → `web`; la versión
   anterior queda en `web.anterior`), reinicia IntranetBackend, espera a que
   `/api/v1/health/ready/` responda con la base conectada y habilita las
   tareas programadas.
6. Verifica desde la red `http://10.0.2.33:5080/` y la API.

El éxito se detecta por el marcador `INTRANET_DESPLIEGUE_OK` que el bloque
remoto emite al final, no por la ausencia de mensajes en stderr (pip y Django
escriben ahí aunque terminen bien).

### Migraciones

`ga_app` **no puede cambiar la estructura** de la base (ver el script de
creación de la base). Si un despliegue trae migraciones nuevas, el paso 4 se
detiene con «Hay migraciones pendientes» antes de reiniciar. Entonces:

1. El DBA habilita `ga_migraciones`: `ALTER LOGIN [ga_migraciones] ENABLE;`
2. `.\scripts\deploy\deploy-from-workstation.ps1 -CredentialPath … -Migrar`
   — pide la clave de `ga_migraciones` en esta máquina y la usa solo para
   `manage.py migrate`; no se guarda.
3. El DBA lo deshabilita: `ALTER LOGIN [ga_migraciones] DISABLE;`

### Volver atrás

El frontend anterior queda en `C:\intranet\web.anterior`: renombrarlo a `web`.
Para el backend, desplegar el commit anterior (`git checkout <commit>` y
`-OmitirVerificacionGit`). Si la versión nueva trajo migraciones, revisar antes
si son reversibles.

## Primer administrador

La base nace sin usuarios. En el servidor (o por WinRM), una sola vez:

```powershell
cd C:\intranet\backend
.\.venv\Scripts\python.exe scripts\produccion.py manage.py createsuperuser
```

## Pendientes conocidos

- **El servidor es una versión de evaluación** de Windows Server 2022: al
  vencer la licencia se apaga solo cada hora. Activarlo (`slmgr /dlv` muestra
  los días que quedan).
- **SQL Server 2022 sin actualizaciones** (16.0.1000.6, RTM): instalar la
  última CU.
- **Respaldos de la base**: los hace el DBA con el Agente de SQL Server.
  `ga_app` no puede ejecutar `BACKUP DATABASE`, así que el respaldo desde
  *Configuración → Respaldos* debe quedar apagado (los adjuntos de
  `C:\intranet\media` se respaldan con el servidor).
- **Correo apagado** hasta definir el buzón del sistema.
