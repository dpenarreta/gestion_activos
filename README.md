# Gestión de Activos

Sistema de gestión de activos institucionales. Construido sobre la
plantilla [`dpenarreta/skelleton_base`](https://github.com/dpenarreta/skelleton_base)
(commit `a9896f1`, VERSION `0.1.0`), adoptada como **criterio base de
seguridad**: identidad institucional, autenticación, JWT, cifrado seguro de
contraseñas, administración de usuarios/roles/permisos y auditoría vienen
de esa base y no se reimplementan.

## 1. Descripción general

Backend Django (patrón Modelo-Vista-Template) + API REST, frontend React, y
SQL Server como base de datos.

**Estado actual:** la infraestructura transversal está completa y validada;
el dominio propio del sistema (activos, ubicaciones, asignaciones,
mantenimientos) todavía no está implementado — es la siguiente capa a
construir. Todo módulo de negocio nuevo debe respetar los controles
descritos en `docs/security-review.md` y sumar sus permisos al catálogo
cerrado (`backend/apps/permissions/catalog.py`).

## 2. Tecnologías principales

| Componente | Tecnología |
| --- | --- |
| Backend | Python 3.12, Django 5.1, Django REST Framework |
| Base de datos | SQL Server (`mssql-django` + `pyodbc`) |
| Autenticación | JWT (`djangorestframework-simplejwt`) + sesiones propias |
| Contraseñas | Hash Argon2 (gestionado por Django) |
| Frontend | React 18, Vite, React Router |
| Interfaz visual | Bootstrap 5 + Bootstrap Icons |
| Pruebas | pytest / pytest-django / pytest-bdd (backend), Vitest (frontend) |
| Contenedores | Docker / Docker Compose |

## 3. Arquitectura general del proyecto

Backend y frontend son proyectos independientes que se comunican por HTTP
(`/api/v1/`). El backend sigue el patrón Modelo-Vista-Template con una capa
de servicios explícita (la lógica de negocio nunca vive en las vistas). Ver
`docs/architecture.md` para el detalle completo, incluidas las decisiones
de alcance heredadas de la plantilla base.

## 4. Estructura de carpetas

```
gestion_activos/
├── backend/
│   ├── apps/{core,authentication,users,roles,permissions,branding}/
│   ├── config/
│   ├── requirements/
│   └── manage.py
├── frontend/
│   └── src/{api,components,context,hooks,pages,routes,styles,utils}/
├── tests/qa/
│   ├── features/            # Criterios de aceptación en Gherkin
│   ├── step_definitions/     # pytest-bdd
│   ├── acceptance-criteria-traceability.md
│   └── test-execution-report.md
├── docs/
│   └── plantilla/          # Artefactos heredados de skelleton_base
├── database/
├── docker-compose.yml
└── docker-compose.prod.yml
```

## 5. Configuración base del entorno

Copiar y completar dos archivos `.env.example`:

- `.env.example` (raíz) → variables de Docker Compose (SQL Server, build
  args del frontend).
- `backend/.env.example` → variables de Django (secretos, conexión a base
  de datos, JWT, correo).
- `frontend/.env.example` → variables de Vite.

Nunca commitear los `.env` reales (ya excluidos por `.gitignore`).

## 6. Instalación local

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate      # Windows; en Linux/Mac: source .venv/bin/activate
pip install -r requirements/dev.txt
cp .env.example .env         # y completar los valores
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

### Base de datos (SQL Server vía Docker)

```bash
docker compose up -d mssql
```

Ver `docs/database.md` para crear la base de datos la primera vez y para
los detalles de conexión.

## 7. Scripts y comandos disponibles

| Comando | Dónde | Qué hace |
| --- | --- | --- |
| `python manage.py runserver` | `backend/` | Servidor de desarrollo |
| `pytest` | `backend/` | Suite de pruebas del backend |
| `ruff check .` / `black .` / `isort .` | `backend/` | Lint y formato |
| `npm run dev` | `frontend/` | Servidor de desarrollo (Vite) |
| `npm run build` | `frontend/` | Build de producción |
| `npm test` | `frontend/` | Suite de pruebas (Vitest) |
| `npm run lint` | `frontend/` | Lint (ESLint) |
| `docker compose up -d mssql` | raíz | SQL Server de desarrollo |
| `docker compose -f docker-compose.prod.yml up -d --build` | raíz | Stack completo de producción |

## 8. Base de datos

SQL Server. Ver `docs/database.md` para configuración, migraciones y
relaciones entre usuarios, roles y permisos.

## 9. Módulos o funcionalidades principales

- **Autenticación y sesiones** (`apps.authentication`) — login, JWT,
  refresh con detección de reuso, recuperación de contraseña.
- **Usuarios** (`apps.users`) — CRUD administrativo, búsqueda/filtros,
  activar/desactivar/bloquear, restablecimiento administrativo de
  contraseña, protección del último administrador activo.
- **Roles** (`apps.roles`) — CRUD sobre `auth.Group`.
- **Permisos** (`apps.permissions`) — catálogo cerrado en código,
  resolución de autorización.
- **Configuración / identidad institucional** (`apps.branding`) — nombre,
  logo, favicon, colores, tipografía, editable desde el panel
  administrativo (módulo agregado deliberadamente más allá del mínimo
  estricto de la partición, ver `docs/architecture.md`).
- **Auditoría** (`apps.core`) — bitácora append-only de toda operación
  administrativa relevante.

## 10. APIs, rutas o interfaces internas

Ver `docs/api-reference.md` para el listado completo de endpoints,
métodos y permisos requeridos. Documentación interactiva en
`/api/v1/schema/swagger-ui/`.

## 11. Autenticación y permisos

Ver `docs/authentication.md` y `docs/roles-and-permissions.md`.

## 12. Estilos, templates y recursos estáticos

El frontend usa Bootstrap 5 como base visual, con variables CSS propias
(`frontend/src/styles/variables.css`) sobrescritas en runtime por el tema
configurado en Configuración. Cada componente/página tiene su propio
archivo `.css`. El backend usa templates de Django únicamente para el
panel de administración nativo y los correos transaccionales
(`backend/templates/emails/`) — la interfaz de usuario vive enteramente en
el frontend React.

## 13. Pruebas y calidad

- Backend: 83 pruebas `pytest` (ver `backend/apps/*/tests/`).
- Integración: 13 escenarios Gherkin conectados vía `pytest-bdd` (ver
  `tests/qa/step_definitions/`).
- Frontend: 10 pruebas `Vitest` (ver `frontend/tests/`).
- Todos los criterios de aceptación están documentados como escenarios
  Gherkin en `tests/qa/features/`, con trazabilidad completa en
  `tests/qa/acceptance-criteria-traceability.md` y resultados reales de
  ejecución en `tests/qa/test-execution-report.md`. Ver la estrategia
  completa en `docs/qa-strategy.md`.

## 14. Despliegue

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Levanta SQL Server, el backend (Gunicorn, migraciones automáticas al
arrancar) y el frontend (build estático servido por nginx). Ver
`docs/database.md` y `backend/entrypoint.sh`.

## 15. Seguridad y buenas prácticas

Ver `docs/security-review.md` para el checklist completo de controles de
seguridad implementados y sus limitaciones conocidas (documentadas, no
ocultas).

## 16. Protección de datos personales según normativa de Ecuador

Ver `docs/data-protection-review.md` — inventario de datos personales
gestionados, controles existentes y recomendaciones. No constituye
asesoría legal.

## 17. Convenciones de desarrollo

- Backend: vistas delgadas, lógica de negocio en `services.py`, nunca
  acceso directo al ORM desde las vistas. `ruff` + `black` + `isort`
  (ver `backend/pyproject.toml`).
- Frontend: un componente por carpeta con su propio `.css`; servicios de
  API separados de los componentes (`src/api/*.js`); permisos siempre
  validados también en el backend, nunca solo en el cliente.
- Todo criterio de aceptación nuevo se documenta como escenario Gherkin
  (`tests/qa/features/`) con su identificador `AC-xxx`, nunca solo en este
  README o en un comentario de código.

## 18. Estado del proyecto

Funcional y validado: migraciones aplicadas contra SQL Server real,
backend y frontend iniciando correctamente, suites de pruebas en verde,
build de producción exitoso, y una verificación manual en navegador que
incluyó login real, creación de roles, y navegación completa del panel
administrativo. Ver el detalle en `tests/qa/test-execution-report.md`.

## 19. Recomendaciones para próximos mantenimientos

1. Ejecutar `pip-audit`/`npm audit` con revisión manual antes de cada
   release (ver limitaciones en `docs/security-review.md`).
2. Definir una política de retención para `AuditLog`/`LoginAttempt` antes
   de un despliegue con datos reales.
3. Si se agrega un módulo de negocio nuevo, sumar sus permisos al catálogo
   (`apps/permissions/catalog.py`) y documentar sus criterios de aceptación
   como Gherkin desde el principio, no después.
4. Mantener actualizada la matriz de trazabilidad
   (`tests/qa/acceptance-criteria-traceability.md`) cada vez que se agregue
   o cambie un criterio de aceptación.
