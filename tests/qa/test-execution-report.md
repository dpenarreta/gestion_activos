# Reporte de ejecución de pruebas QA

> **Registro histórico de la plantilla base.** Este reporte documenta la
> verificación de `skelleton_base` (2026-07-29), no la de este proyecto. Se
> conserva sin modificar porque respalda los controles heredados, pero sus
> filas AC-001…AC-007 describen la partición de aquel repositorio: cuando
> AC-002 dice que `origin` apunta a `skelleton_base`, se refiere al repo de
> la plantilla. El `origin` de **este** proyecto es
> `https://github.com/dpenarreta/gestion_activos.git`.
>
> La verificación de este proyecto sobre base de datos limpia (2026-09-08)
> está resumida en el README, sección 18, y en `docs/security-review.md`.

Fecha de ejecución: 2026-07-29. Ninguna fila está marcada "Aprobado" sin
haberse ejecutado realmente en esta sesión — donde la verificación fue
manual (inspección de repositorio/configuración) se indica explícitamente
como tal, no como prueba automatizada.

## Resumen de comandos ejecutados

| Suite | Comando | Resultado |
| --- | --- | --- |
| Backend (pytest) | `pytest` desde `backend/`, contra SQL Server 2022 real en Docker | **83 passed** |
| Integración (pytest-bdd) | `PYTHONPATH=backend DJANGO_SETTINGS_MODULE=config.settings.development pytest tests/qa` | **13 passed** |
| Frontend (Vitest) | `npm test` desde `frontend/` | **10 passed** (5 archivos) |
| Lint backend | `ruff check .` desde `backend/` | **Sin errores** |
| Formato backend | `black --check .` / `isort --check-only` | **Sin errores** (tras `black .` para 1 archivo) |
| Lint frontend | `npm run lint` desde `frontend/` | **Sin errores** |
| Build frontend | `npm run build` desde `frontend/` | **Éxito** — `dist/` generado |
| Migraciones SQL Server | `manage.py migrate` contra `mcr.microsoft.com/mssql/server:2022-latest` (Docker) | **Éxito**, todas las migraciones aplicadas |
| Superusuario | `manage.py createsuperuser --noinput` con contraseña aleatoria por variable de entorno | **Éxito** |
| Verificación manual en navegador | Login real, navegación por Usuarios/Roles/Permisos/Configuración, creación de 2 roles reales, cambio de apariencia claro/oscuro | **Éxito** — ver hallazgos abajo |

## Hallazgos corregidos durante la verificación manual en navegador

La verificación visual (no solo pytest) encontró y corrigió 3 defectos reales
antes de considerar el trabajo terminado:

1. **`apps/core/exceptions.py` faltante** — el manejador de excepciones
   referenciado en `settings.REST_FRAMEWORK.EXCEPTION_HANDLER` no se había
   creado, causando 500 en cualquier error de negocio (ej. la protección del
   último administrador). Corregido antes de que ninguna prueba pytest lo
   detectara (las pruebas pytest sí lo habrían detectado al ejecutarse, y de
   hecho fue así como se detectó por primera vez).
2. **`DEFAULT_PAGINATION_CLASS` global agregado por error** — no existe en el
   proyecto original; rompía `RolesList` en el frontend (`roles.map is not a
   function`) porque `RoleViewSet` no espera paginación. Corregido eliminando
   el default global (cada listado declara su propia paginación si la
   necesita).
3. **Colisión de especificidad CSS + `Button.css` incompleto** — un botón
   "Nuevo rol"/"Nuevo usuario" quedaba con texto azul sobre fondo azul
   (invisible) por dos causas combinadas: `.admin-layout__content a`
   competía con `.btn` de Bootstrap, y `Button.css` no incluía las reglas
   reales de `.app-button--primary/secondary` (solo un placeholder). Ambas
   corregidas; se aprovechó para también corregir un diálogo de confirmación
   que quedaba abierto tras crear un rol (no se cerraba en la rama de
   creación, solo en la de edición).

## Repositorio y partición

| ID | Verificación | Ejecutado | Resultado | Evidencia |
| --- | --- | --- | --- | --- |
| AC-001 | Clonado desde la URL correcta | Sí | Aprobado | Repo destino ya presente localmente con `origin` correcto (ver AC-002) |
| AC-002 | `git remote -v` del repo destino | Sí | Aprobado | `origin  https://github.com/dpenarreta/skelleton_base.git (fetch/push)` |
| AC-003 | Repo original intacto | Sí | Aprobado | `git status` limpio en `skelleton` antes y después; rama `backup/pre-skelleton-base-partition` creada |
| AC-004 | Sin comandos destructivos | Sí | Aprobado | Ningún `push --force`/`reset --hard` ejecutado en esta sesión (revisar historial de comandos) |
| AC-005 | Módulos de negocio excluidos | Sí | Aprobado | `apps/` del backend solo contiene core/authentication/users/roles/permissions/branding |
| AC-006 | Solo módulos base | Sí | Aprobado | Igual que AC-005 |
| AC-007 | Sin referencias al original | Sí | Aprobado | Nombres/URLs propios ("Gestión de Activos", `gestion_activos_dev`); sin referencias funcionales a "skeleton" original |
| AC-025 | Sin credenciales reales versionadas | Sí | Aprobado | `.gitignore` excluye `.env`; solo `.env.example` versionados con placeholders |
| AC-026 | `.env.example` seguro existe | Sí | Aprobado | `/.env.example` y `/backend/.env.example` presentes, sin valores reales |

## Arquitectura

| ID | Verificación | Ejecutado | Resultado | Evidencia |
| --- | --- | --- | --- | --- |
| AC-008 | Backend/frontend separados | Sí | Aprobado | Carpetas `backend/` (pip) y `frontend/` (npm) independientes |
| AC-009 | Python + Django | Sí | Aprobado | `Django==5.1.15` en `requirements/base.txt`, Python 3.12 |
| AC-010 | SQL Server | Sí | Aprobado | Ver AC-040 (migración real ejecutada) |
| AC-011 | Patrón MVT | Sí | Aprobado | Cada app: `models.py` + `views.py`/`serializers.py` + `services.py`; templates Django para emails |
| AC-012 | React | Sí | Aprobado | `react@18.3.1` en `package.json` |
| AC-013 | Node.js | Sí | Aprobado | `npm install`/`npm run build` ejecutados con éxito (Node v24.18.0) |
| AC-014 | Bootstrap | Sí | Aprobado | `bootstrap@5.3.3` + `bootstrap-icons`, verificado visualmente en navegador |
| AC-015 | Templates/estilos separados | Sí | Aprobado | Un `.css` por componente/página, sin `style=` extensos |

## Autenticación y seguridad

Ver detalle completo por escenario en `acceptance-criteria-traceability.md`.
Resumen: AC-016, AC-017, AC-018, AC-019, AC-020, AC-021, AC-022, AC-023,
AC-024 → **Aprobado**, cubiertos por los 83 tests de pytest y/o los 13
escenarios pytest-bdd (ambas corridas verdes en esta sesión).

## Usuarios, roles y permisos

AC-027 a AC-039 → **Aprobado**, cubiertos por la suite pytest (apps
`users`, `roles`, `permissions`) y por la verificación manual en navegador
(creación real de los roles "Soporte" y "Editor", edición del usuario
`admin`, consulta de la página Permisos).

## Base de datos

| ID | Verificación | Ejecutado | Resultado | Evidencia |
| --- | --- | --- | --- | --- |
| AC-040 | Migraciones con SQL Server real | Sí | **Aprobado** | `manage.py migrate` contra contenedor `mcr.microsoft.com/mssql/server:2022-latest`, 0 errores |
| AC-041 | Relaciones válidas | Sí | Aprobado | Toda la suite pytest ejercita `user.groups`/`group.permissions` reales sobre SQL Server |
| AC-042 | Restricciones de unicidad | Sí | Aprobado | `test_admin_cannot_create_user_with_duplicate_email` pasa contra la base real |
| AC-043 | Sin datos productivos | Sí | Aprobado | Única migración de datos: `branding/migrations/0002_seed_default_theme.py` (identidad institucional por defecto) |
| AC-044 | Admin sin contraseña fija | Sí | Aprobado | Superusuario de validación creado con `createsuperuser --noinput` y una contraseña generada con `secrets`, nunca escrita en código |

## Calidad y documentación

| ID | Verificación | Ejecutado | Resultado | Evidencia |
| --- | --- | --- | --- | --- |
| AC-045 | Backend inicia | Sí | Aprobado | `runserver` real en `:8000`, `curl /api/v1/health/` → `{"status":"ok",...}` |
| AC-046 | Frontend inicia | Sí | Aprobado | `npm run dev`, navegado en Chrome real, sin errores de consola tras las correcciones |
| AC-047 | Build frontend | Sí | Aprobado | `npm run build` → `dist/` generado, ~87KB gzip JS |
| AC-048 | Pruebas backend documentadas | Sí | Aprobado | 83 pruebas pytest en `backend/apps/*/tests/` |
| AC-049 | Pruebas frontend documentadas | Sí | Aprobado | 10 pruebas Vitest en `frontend/tests/` |
| AC-050 | Pruebas de integración documentadas | Sí | Aprobado | 13 escenarios pytest-bdd en `tests/qa/step_definitions/` |
| AC-051 | Cada AC con escenario Gherkin | Sí | Aprobado | Ver `acceptance-criteria-traceability.md` |
| AC-052 | Trazabilidad por escenario | Sí | Aprobado | Ídem |
| AC-053 | Resultados documentados | Sí | Aprobado | Este mismo archivo |
| AC-054 | README refleja estructura | Sí | Aprobado | Ver `README.md` |
| AC-055 | Documentación en docs/ | Sí | Aprobado | Ver carpeta `docs/` |
| AC-056 | Sin imports/rutas huérfanas | Sí | Aprobado | `ruff check .` y `eslint .` sin errores |
| AC-057 | Sin dependencias innecesarias | Parcial | Pendiente de auditoría exhaustiva | Revisión manual básica hecha; no se ejecutó una herramienta de detección de dependencias no usadas (ej. `depcheck`) — **no se marca Aprobado sin esa verificación puntual** |

## Branding y protección de datos personales

AC-BR-001 a AC-BR-010 y AC-DP-001 a AC-DP-006 → **Aprobado**, cubiertos por
la suite pytest de `apps/branding` y `apps/core` (auditoría), más
verificación manual en navegador (Identidad, Colores y tipografía,
Apariencia).

## Pendientes / no verificados en esta sesión

- **AC-057** (dependencias no utilizadas): requiere una herramienta dedicada
  (`depcheck` para npm, `pip-autoremove`/revisión manual para pip) no
  ejecutada en esta sesión — queda como acción manual pendiente.
- **AC-DP-002** (datos personales nunca en logs): se revisó el formato de
  logging estructurado (`apps/core/middleware.py`, `AccessLogMiddleware`) y
  se confirmó que solo registra método/ruta/estado/duración, nunca el cuerpo
  del request — pero no se auditaron logs de un despliegue productivo real
  (no existe tal despliegue). Verificación de diseño, no de logs en
  producción.
- **Auditoría externa de seguridad** (sección 21, ítem "Búsqueda de
  secretos"): se hizo `grep` manual de patrones obvios (`password=`,
  `SECRET`, etc.) sin hallazgos, pero no se ejecutó una herramienta dedicada
  (ej. `gitleaks`, `truffleHog`).
