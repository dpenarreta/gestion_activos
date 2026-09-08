# Reporte de migración: partición de `skelleton` → `skelleton_base`

## Inventario de la partición

| Elemento | Ubicación original | Clasificación | Acción |
| --- | --- | --- | --- |
| Autenticación JWT + sesiones | `apps/users/authentication.py`, `tokens.py` | Base | Conservado → `apps/authentication` |
| Modelo de usuario, CRUD administrativo | `apps/users/models.py`, `views.py`, `services.py` | Base | Conservado → `apps/users` |
| Roles (`auth.Group`) | `apps/users/services.py::RoleService`, `role_urls.py` | Base | Conservado → `apps/roles` |
| Catálogo de permisos, autorización | `apps/core/permissions_catalog.py`, `authorization.py`, `permissions.py` | Base | Conservado → `apps/permissions` |
| Auditoría transversal | `apps/core/audit.py`, `models.py::AuditLog` | Base | Conservado → `apps/core` |
| Health/version/logging/middleware | `apps/core/health/`, `middleware.py` | Base | Conservado → `apps/core` |
| Tema visual / identidad (`SiteTheme`) | `apps/core/models.py`, `theme_*.py` | Base (branding, ampliado a pedido) | Conservado y simplificado → `apps/branding`, sin biblioteca de medios ni tipografías en base de datos |
| Sistema de menús dinámicos | `apps/core/menu_*.py` | Negocio | **Excluido** — reemplazado por un menú estático en el frontend |
| Biblioteca multimedia | `apps/media/` | Negocio | **Excluido** |
| Constructor de páginas | `apps/pages/` | Negocio | **Excluido** |
| Formularios dinámicos | `apps/forms/` | Negocio | **Excluido** |
| Avisos | `apps/notices/` | Negocio | **Excluido** |
| Footer configurable | `apps/footer/` | Negocio | **Excluido** |
| Gateway Node.js | `services/node-gateway/` | Infraestructura de negocio | **Excluido** — el frontend habla directo con el backend Django |

## Dependencias desacopladas

- El sidebar administrativo dependía de `useAdministrativeMenu` (backend) y
  `useMenuIdentity` (biblioteca de medios) para resolver su logo. Ambas se
  reemplazaron: el menú es un array estático filtrado por permiso
  (`staticAdminMenu.js`), y el logo se lee directamente de
  `ThemeContext` (`theme.logo_url`), sin dependencia de medios.
- El editor de identidad (`IdentidadTab`) ya guardaba `logo_url`/
  `favicon_url` como texto plano — el botón "elegir de biblioteca" (que sí
  dependía de medios) se eliminó limpiamente; el input de texto ya
  funcionaba de forma autónoma.
- La tipografía dependía de un modelo `FontFamily` en base de datos
  (sembrado por una migración de datos del sistema de menús excluido). Se
  reemplazó por una lista estática de fuentes web-safe/del sistema en
  `apps/branding/catalog.py`.

## Cambios de tecnología

| Aspecto | Original | skelleton_base |
| --- | --- | --- |
| Base de datos | PostgreSQL (`dj-database-url`) | SQL Server (`mssql-django` + `pyodbc`) |
| Apps de dominio auth/usuarios | Mezcladas en `apps.users` + `apps.core` | Separadas en 5 apps: `authentication`, `users`, `roles`, `permissions`, `branding` |
| Menú administrativo | Dinámico (configurable en backend) | Estático (array en el frontend) |

## Dependencias eliminadas

Backend (`requirements/base.txt`): `dj-database-url`, `psycopg2-binary`,
`Pillow`, `defusedxml`, `nh3`, `python-magic`/`python-magic-bin` (todas
propias de medios/páginas, sin uso en este template).

Frontend (`package.json`): `@tiptap/*` (editor de texto enriquecido del
constructor de páginas).

Agregadas: `mssql-django`, `pyodbc` (SQL Server), `pytest-bdd` (Gherkin).

## Hallazgos de la exploración inicial

- El proyecto original **no** implementaba ninguna protección contra
  "quedar sin administrador activo" — se construyó desde cero para este
  template (AC-038).
- `PermissionAssignmentSerializer.validate_permission_codenames` del
  original devolvía instancias de `Permission`, no las cadenas de codename
  — se conservó ese comportamiento (documentado explícitamente en el
  código) porque cambiarlo hubiera requerido tocar `UserAdminService.
  assign_permissions`, fuera del alcance de esta partición.
- El bypass de superusuario es asimétrico por diseño de Django: no está en
  `get_user_permission_codenames` (que alimenta `/me/`) pero sí, de forma
  transparente, en el propio `ModelBackend` de Django — ver
  `docs/roles-and-permissions.md`.

## Validaciones ejecutadas

Ver `tests/qa/test-execution-report.md` para el detalle completo: 83
pruebas backend (pytest) + 13 escenarios de integración (pytest-bdd) + 10
pruebas frontend (Vitest), todas en verde contra una instancia real de SQL
Server 2022 en Docker, más una verificación manual en navegador que
encontró y corrigió 3 defectos reales antes de considerar el trabajo
terminado.
