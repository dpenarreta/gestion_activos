# Base de datos

## Motor

SQL Server, vía `mssql-django` (motor `"mssql"`) + `pyodbc`. El proyecto
original de referencia usaba PostgreSQL — la migración se hizo reemplazando
por completo la configuración de conexión; nada en el código de
autenticación/usuarios/roles/permisos dependía de una característica
específica de Postgres (no había SQL crudo, ni `ArrayField`, ni
`django.contrib.postgres`), así que el resto del código no necesitó
cambios.

## Configuración

Todo por variables de entorno (`backend/.env`, ver `.env.example`):

```env
DB_NAME=gestion_activos
DB_USER=gestion_activos_user
DB_PASSWORD=<password-seguro-local>
DB_HOST=localhost
DB_PORT=1433
DB_DRIVER=ODBC Driver 18 for SQL Server
DB_TRUST_SERVER_CERTIFICATE=true
```

`DB_DRIVER` depende de qué driver ODBC esté instalado en el sistema que
ejecuta Django: la imagen Docker de este proyecto instala
"ODBC Driver 18 for SQL Server"; en Windows, si ya tiene instalado un
driver distinto (ej. "ODBC Driver 17 for SQL Server"), ajuste el valor.
Para saber cuál tiene: `Get-OdbcDriver | Where-Object Name -like "*SQL Server*"`.

> **`DB_PASSWORD` no puede contener `#`.** `django-environ` trata ese
> carácter como inicio de comentario y trunca el valor en silencio; el
> síntoma es un `Login failed for user` que no coincide con la contraseña
> que sí funciona en `sqlcmd`. Evite también `;`, `{`, `}` y `=`, que tienen
> significado propio en la cadena de conexión ODBC.

## Levantar SQL Server localmente

```bash
docker compose up -d mssql
```

Esto levanta `mcr.microsoft.com/mssql/server:2022-latest` con la
contraseña de `sa` tomada de `DB_PASSWORD` (variable en el `.env` de la
raíz del repo, la que usa `docker-compose.yml`). La primera vez hay que
crear la base de datos (SQL Server no la crea sola):

```bash
# Desde el host (o dentro del contenedor: docker exec <contenedor> /opt/mssql-tools18/bin/sqlcmd ...)
sqlcmd -S localhost,1433 -U sa -P "<DB_PASSWORD>" -C -Q "CREATE DATABASE gestion_activos;"

# Usuario de aplicación (evita que Django corra como 'sa'): lee, escribe y
# ejecuta procedimientos; no cambia la estructura (ver «Inicios de sesión y
# permisos» más abajo).
sqlcmd -S localhost,1433 -U sa -P "<DB_PASSWORD>" -C -Q "CREATE LOGIN gestion_activos_user WITH PASSWORD = '<password-seguro-local>';"
sqlcmd -S localhost,1433 -U sa -P "<DB_PASSWORD>" -C -d gestion_activos -Q "CREATE USER gestion_activos_user FOR LOGIN gestion_activos_user; ALTER ROLE db_datareader ADD MEMBER gestion_activos_user; ALTER ROLE db_datawriter ADD MEMBER gestion_activos_user; GRANT EXECUTE TO gestion_activos_user;"

# Login de migraciones: el único que cambia la estructura de la base.
sqlcmd -S localhost,1433 -U sa -P "<DB_PASSWORD>" -C -Q "CREATE LOGIN ga_migraciones WITH PASSWORD = '<otra-password-segura-local>';"
sqlcmd -S localhost,1433 -U sa -P "<DB_PASSWORD>" -C -d gestion_activos -Q "CREATE USER ga_migraciones FOR LOGIN ga_migraciones; ALTER ROLE db_ddladmin ADD MEMBER ga_migraciones; ALTER ROLE db_datareader ADD MEMBER ga_migraciones; ALTER ROLE db_datawriter ADD MEMBER ga_migraciones;"

# Solo en desarrollo: pytest crea y destruye 'test_gestion_activos',
# lo que exige permiso para crear bases. NO otorgar esto en producción.
sqlcmd -S localhost,1433 -U sa -P "<DB_PASSWORD>" -C -Q "ALTER SERVER ROLE dbcreator ADD MEMBER gestion_activos_user;"
```

Si el puerto 1433 del host ya está ocupado por otro proyecto, cambie
`DB_PORT` en el `.env` de la raíz (mapeo del contenedor) **y** en
`backend/.env` (conexión de Django); ambos deben coincidir.

## Migraciones

El usuario de la aplicación no puede crear ni alterar tablas: las migraciones
se aplican con `ga_migraciones`, pasándole sus credenciales solo a ese comando
(las variables del proceso mandan sobre las de `backend/.env`). Es lo mismo que
hace `scripts/deploy/deploy-from-workstation.ps1 -Migrar` en el servidor.

```powershell
cd backend
$env:DB_USER = "ga_migraciones"; $env:DB_PASSWORD = "<password-de-ga_migraciones>"
python manage.py migrate
Remove-Item Env:\DB_USER, Env:\DB_PASSWORD
```

Validado realmente (no solo por inspección) contra un contenedor
`mcr.microsoft.com/mssql/server:2022-latest` real — ver
`tests/qa/test-execution-report.md`, criterio AC-040.

## Inicios de sesión y permisos

Revisado en la auditoría de seguridad del 29/10/2026: la guía anterior hacía al
usuario de la aplicación `db_owner`, con lo que un fallo en la aplicación (una
inyección SQL, una consulta armada a mano) podía borrar tablas, cambiar
permisos o leer cualquier cosa de la base. Ahora cada tarea tiene su login y
cada login lo mínimo:

| Login | Para qué | Permisos en la base |
| --- | --- | --- |
| Aplicación (`gestion_activos_user` en local, `ga_app` en el servidor) | El backend y sus tareas programadas | `db_datareader`, `db_datawriter`, `GRANT EXECUTE` |
| `ga_migraciones` | Solo `manage.py migrate` | `db_ddladmin`, `db_datareader`, `db_datawriter` |
| Respaldos | `manage.py respaldar` (`BACKUP DATABASE`) | `db_backupoperator` (más `db_datareader` para el manifiesto) |

- **Ninguno es `db_owner`** ni `sysadmin`. Si alguna migración llegara a pedir
  más (p. ej. cambiar permisos), se le da a `ga_migraciones` para ese
  despliegue, nunca al de la aplicación.
- **Respaldos.** `respaldar` usa la conexión de Django, así que corre con el
  login que diga `DB_USER` en ese proceso. Lo recomendable es un login propio
  con `db_backupoperator`, pasado solo a la tarea de respaldo como en las
  migraciones. Si en cambio se le agrega `db_backupoperator` al de la
  aplicación, téngase en cuenta que cualquier fallo de la aplicación podría
  escribir `.bak` en el disco del servidor. La comprobación posterior
  (`RESTORE VERIFYONLY`) pide, según la documentación de SQL Server, permiso
  `CREATE DATABASE`: no se le da al login de la aplicación; si hace falta,
  solo al de respaldos.
- **`dbcreator` es solo de desarrollo**, para que pytest cree y borre su base
  de pruebas (ver arriba). Nunca en el servidor.
- Las claves van solo en el `.env` de cada máquina o en los archivos cifrados
  de `%USERPROFILE%\.deploy`, nunca en el repositorio.

### Base externa de solo lectura (dashboards)

Los dashboards que leen otra base (`EXTERNAL_DB_*`, ver
`backend/.env.example`) se conectan con un login propio que solo puede leer las
vistas y ejecutar los procedimientos que se usan. Nada de `db_datareader` (lee
todas las tablas) ni de `db_owner`:

```sql
-- En el servidor de la base externa, como administrador.
CREATE LOGIN <login_dashboards> WITH PASSWORD = '<password-segura>';

USE <base_externa>;
CREATE USER <usuario_dashboards> FOR LOGIN <login_dashboards>;

-- Una línea por cada objeto que de verdad se consulta.
GRANT SELECT  ON OBJECT::dbo.<vista_usada>          TO <usuario_dashboards>;
GRANT EXECUTE ON OBJECT::dbo.<procedimiento_usado>  TO <usuario_dashboards>;
```

- Por el encadenamiento de propiedad de SQL Server, una vista o un
  procedimiento de `dbo` puede leer sus tablas de `dbo` sin que el usuario
  tenga `SELECT` sobre ellas: no hace falta dar permiso sobre las tablas.
- La misma lista de objetos va en `EXTERNAL_DB_OBJETOS_PERMITIDOS`: la
  aplicación rechaza lo que no está ahí, y la base rechaza lo que no tiene
  permiso. Son dos barreras; si una falla, queda la otra.
- Al agregar un dashboard que use un objeto nuevo, hay que pedir el `GRANT`
  correspondiente al DBA y añadirlo a la lista.

## Relaciones

- `users.User` — modelo de usuario personalizado (`AUTH_USER_MODEL`),
  extiende `AbstractUser` + `BaseModel`. `email` es único.
- `auth.Group` — roles. `auth.Permission` — permisos (ver
  `docs/roles-and-permissions.md`).
- `authentication.Session` — FK a `User`; `refresh_token_jti` único.
- `authentication.PasswordResetToken` — FK a `User`; `token_hash` único.
- `authentication.LoginAttempt` — FK opcional a `User` (se conserva el
  registro aunque el usuario se elimine, vía `SET_NULL`).
- `core.AuditLog` — FK opcional a `User` (actor); referencia el objeto
  afectado por texto (`target_type`/`target_id`), no por FK, para no acoplar
  `core` a ninguna otra app.
- `branding.SiteTheme` — fila única (singleton), sembrada por una migración
  de datos (`branding/migrations/0002_seed_default_theme.py`).

## Restricciones de unicidad

| Campo | Modelo | Restricción |
| --- | --- | --- |
| `username` | `User` | Única (heredada de `AbstractUser`) |
| `email` | `User` | Única |
| `refresh_token_jti` | `Session` | Única |
| `token_hash` | `PasswordResetToken` | Única |
| `name` | `auth.Group` (rol) | Validada a nivel de aplicación (case-insensitive, en `RoleWriteSerializer`) |

## Semillas de datos

La única migración de datos versionada es
`apps/branding/migrations/0002_seed_default_theme.py`, que crea la fila
única de `SiteTheme` con la identidad institucional por defecto (colores,
tipografía, nombre del sistema). No existen datos productivos, de clientes
ni de ejemplo versionados en el repositorio (AC-043).
