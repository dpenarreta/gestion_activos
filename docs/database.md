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
DB_NAME=gestion_activos_dev
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

## Levantar SQL Server localmente

```bash
docker compose up -d mssql
```

Esto levanta `mcr.microsoft.com/mssql/server:2022-latest` con la
contraseña de `sa` tomada de `DB_PASSWORD` (variable en el `.env` de la
raíz del repo, la que usa `docker-compose.yml`). La primera vez hay que
crear la base de datos (SQL Server no la crea sola):

```bash
sqlcmd -S localhost,1433 -U sa -P "<DB_PASSWORD>" -C -Q "CREATE DATABASE gestion_activos_dev;"
```

## Migraciones

```bash
cd backend
python manage.py migrate
```

Validado realmente (no solo por inspección) contra un contenedor
`mcr.microsoft.com/mssql/server:2022-latest` real — ver
`tests/qa/test-execution-report.md`, criterio AC-040.

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
