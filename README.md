# Gestión de Activos

Repositorio: <https://github.com/dpenarreta/gestion_activos>

Sistema de gestión de activos institucionales. Incluye la infraestructura
transversal completa —identidad institucional, autenticación, JWT, cifrado
seguro de contraseñas, administración de usuarios, roles y permisos, y
auditoría— sobre la que se construyen los módulos de negocio.

Los controles de seguridad descritos en `docs/security-review.md` son el
**criterio base del proyecto**: todo módulo nuevo debe cumplirlos.

## 1. Descripción general

Backend Django (patrón Modelo-Vista-Template) + API REST, frontend React, y
SQL Server como base de datos.

**Estado actual:** infraestructura transversal y **backend completo de los
ocho requerimientos funcionales** (RF-01 a RF-08): inventario de activos con
código de barras automático, consulta por escáner, bitácora de
mantenimientos, motor de sugerencia de renovación e impresión de etiquetas
térmicas. La interfaz de estos módulos en el frontend está pendiente; el
panel administrativo heredado (usuarios, roles, permisos, configuración) sí
funciona.

## 2. Tecnologías principales

| Componente | Tecnología |
| --- | --- |
| Backend | Python 3.12, Django 5.2 LTS, Django REST Framework 3.17 |
| Base de datos | SQL Server (`mssql-django` + `pyodbc`) |
| Autenticación | JWT (`djangorestframework-simplejwt`) + sesiones propias |
| Contraseñas | Hash Argon2 (gestionado por Django) |
| Frontend | React 18, Vite 6, React Router 7 |
| Interfaz visual | Bootstrap 5 + Bootstrap Icons |
| Pruebas | pytest / pytest-django / pytest-bdd (backend), Vitest (frontend) |
| Contenedores | Docker / Docker Compose |

## 3. Arquitectura general del proyecto

Backend y frontend son proyectos independientes que se comunican por HTTP
(`/api/v1/`). El backend sigue el patrón Modelo-Vista-Template con una capa
de servicios explícita (la lógica de negocio nunca vive en las vistas). Ver
`docs/architecture.md` para el detalle completo, incluidas las decisiones
de alcance del proyecto.

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

## 5.1 Entorno local ya configurado en esta máquina

Los `.env` de este checkout ya están completos y verificados. Los puertos
convencionales (8000, 5173, 1433) estaban ocupados por otros proyectos de
la máquina, así que este proyecto usa los suyos:

| Servicio | Puerto | Notas |
| --- | --- | --- |
| SQL Server (Docker) | `14331` | contenedor `gestion_activos-mssql-1`, volumen propio |
| Backend (Django) | `8010` | `BACKEND_PORT` en `backend/.env` |
| Frontend (Vite) | `5174` | `VITE_PORT` en `frontend/.env`; también en `CORS_ALLOWED_ORIGINS` |

`DB_DRIVER` está en "ODBC Driver 17 for SQL Server" porque es el instalado
en esta máquina (la imagen Docker del backend usa el 18).

Arranque:

```bash
docker compose up -d mssql
cd backend && ./.venv/Scripts/python.exe manage.py runserver 8010
cd frontend && npm run dev
```

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
  administrativo (ver `docs/architecture.md`, "Decisiones de alcance").
- **Auditoría** (`apps.core`) — bitácora append-only de toda operación
  administrativa relevante.

### Dominio de negocio

- **Inventario** (`apps.activos`) — RF-01/RF-02/RF-03: expediente de cada
  dispositivo, código de barras único automático (`GA-<TIPO>-<SECUENCIA>`,
  Code 128), historial de movimientos de custodia y consulta por escáner.
- **Organización** (`apps.organizacion`) — departamentos y catálogo propio de
  empleados custodios, con vínculo opcional a una cuenta del sistema.
- **Mantenimientos** (`apps.mantenimientos`) — RF-04/RF-05: bitácora de
  intervenciones con desglose de repuestos, costos y contador automático de
  intervenciones y de piezas críticas sustituidas.
- **Políticas de renovación** (`apps.politicas`) — RF-06/RF-07: umbrales de
  obsolescencia por tipo de dispositivo (mantenimientos, piezas críticas,
  vida útil) y motor que evalúa cada activo y explica cada criterio superado.
- **Etiquetas térmicas** (`apps.activos.etiquetas`) — RF-08: generación de
  trabajos de impresión ZPL (Zebra) y TSPL (TSC/Godex).

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

- Backend: 144 pruebas `pytest` (ver `backend/apps/*/tests/`).
- Integración: 18 escenarios Gherkin conectados vía `pytest-bdd` (ver
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

**Infraestructura transversal: funcional y verificada de cero el
2026-09-08.** Sobre una base de datos SQL Server vacía: 27 migraciones aplicadas, 83 pruebas de
backend + 13 escenarios Gherkin + 10 pruebas de frontend en verde, lint
limpio, build de producción exitoso, backend y frontend arrancando, login
real vía API (JWT + Argon2), control de acceso (401 sin token), throttle de
fuerza bruta activo y `pip-audit`/`npm audit` sin hallazgos.

**Dominio de negocio: no iniciado.** El sistema todavía no tiene modelo de
activos, ubicaciones, asignaciones ni mantenimientos. Esa es la siguiente
capa; ver `docs/architecture.md`, sección "Qué no incluye todavía".

Detalle de la verificación heredada en `tests/qa/test-execution-report.md`.

## 19. Recomendaciones para próximos mantenimientos

1. Ejecutar `pip-audit -r requirements/base.txt` (backend) y `npm audit`
   (frontend) con revisión manual antes de cada release. Al 2026-09-08 ambos
   reportan 0 vulnerabilidades; ver `docs/security-review.md`.
2. Definir una política de retención para `AuditLog`/`LoginAttempt` antes
   de un despliegue con datos reales.
3. Si se agrega un módulo de negocio nuevo, sumar sus permisos al catálogo
   (`apps/permissions/catalog.py`) y documentar sus criterios de aceptación
   como Gherkin desde el principio, no después.
4. Mantener actualizada la matriz de trazabilidad
   (`tests/qa/acceptance-criteria-traceability.md`) cada vez que se agregue
   o cambie un criterio de aceptación.
