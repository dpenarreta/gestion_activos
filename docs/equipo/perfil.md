# Perfil técnico del equipo — Intranet Grupo Laar (gestion_activos)

Documento de referencia para el Tech Lead (`/equipo`) y todos los subagentes. Lo que se define aquí prevalece sobre las reglas genéricas de `~/.claude/agents/*.md`. Mantenerlo actualizado es responsabilidad del Tech Lead.

## 1. Arquitectura
- Monolito Django + DRF (`backend/`) que expone `/api/v1/…`, SPA React + Vite (`frontend/`) y app móvil «Intranet LCE» (`mobile/`, React Native + Expo, desde el 12/11/2026). Ambas interfaces solo hablan con la misma API y comparten los datos; ninguna accede a la base.
- SQL Server (local en Docker, puerto 14331; producción en SER-WEBAI detrás de IIS, por HTTPS).
- Multiempresa: los modelos por empresa heredan de `ModeloDeEmpresa` y se filtran con `apps.empresas.contexto` (`empresa_actual`, `usando_empresa`). Ver `docs/multiempresa.md`.
- Permisos: catálogo en `backend/apps/permissions/catalog.py`, comprobados con `Requiere("modulo.accion")` en la API y con `RequirePermission` / `staticAdminMenu.js` en la interfaz. Un permiso nuevo lleva migración en `permissions` y, si se reparte a roles, en `roles`. Ver `docs/roles-and-permissions.md`.
- Notificaciones: campana (`apps.notificaciones.services.notificar`) y correos con plantilla (`apps.correos.catalogo`, enviados por `apps.alertas.eventos.enviar`).
- Datos personales (LOPDP): todo dato personal nuevo se declara en `apps/privacidad/mis_datos.py`. Las ausencias médicas nunca se revelan a terceros (`apps/ausencias/access.py`).

## 2. Roles activos y ámbitos
| Rol | Subagente | Rutas que puede modificar | Notas |
|---|---|---|---|
| DEV-5 DevOps | `dev-devops` | `deploy/`, `scripts/`, `docker-compose*.yml`, `backend/Dockerfile` | Despliegue a SER-WEBAI con `ga_migraciones` |
| DEV-3 Datos e Integraciones | `dev-database` | `backend/apps/*/models.py`, `backend/apps/*/migrations/` | |
| DEV-2 Backend | `dev-backend` | `backend/apps/**` (servicios, vistas, serializers, tests) salvo modelos/migraciones | |
| DEV-4 Web | `dev-web` | `frontend/src/**`, `frontend/tests/**` | |
| DEV-1 Mobile | `dev-mobile` | `mobile/**` | App «Intranet LCE»: replica solo algunos módulos (mapa `MODULOS_EN_APP`); lo demás se abre en el navegador |
| QA-FUNC / QA-TECH | `qa-functional` / `qa-technical` | Solo lectura | |
| QA-UX | `auditor-ux-ui` (`.claude/agents/`) | Solo lectura | Navegador en `http://localhost:5174` |
| QA-UX móvil | `auditor-ux-ui-movil` (`.claude/agents/`) | Solo lectura | App «Intranet LCE» (`mobile/`): 8 pilares, marca LAARCOURIER y P1/P2/P3. Se usa en las historias de la app en lugar de `ux-ui-auditor` |

## 3. Stack fijo por capa (no mezclar alternativas)
| Capa | Tecnología y versión |
|---|---|
| Backend | Python 3.12, Django 5.2, Django REST Framework 3.17, SimpleJWT |
| Base de datos | SQL Server (mssql-django 1.8, ODBC Driver 17) |
| Frontend | React 18, Vite 6, Bootstrap 5.3 / react-bootstrap, clases propias `mz-*` |
| Móvil | React Native + Expo (SDK estable), Expo Router, JavaScript, `expo-secure-store`, `expo-notifications`, EAS Build (Android e iOS, tiendas) |
| Pruebas | pytest (backend), Vitest + Testing Library (frontend), jest-expo + @testing-library/react-native (móvil) |

## 4. Convenciones y contrato entre capas
- Textos, nombres de dominio y comentarios en español, con tildes. Tratamiento de «usted» en la interfaz.
- Errores de la API: `{"error": {"code", "message", "details"}}` (`apps.core.exceptions.api_exception_handler`); en el frontend se leen con `mensajeDeError` y `erroresPorCampo` (`frontend/src/utils/errores.js`).
- Los comentarios explican el porqué y fechan las decisiones de negocio (dd/mm/aaaa).
- Formateadores (prettier, black) solo sobre los archivos tocados.
- Commits directos en `main`, con cuerpo largo al estilo del repo. El repo es público: nada de secretos ni informes de vulnerabilidades.

## 5. Comandos de verificación
| Capa | Comando | Qué ejecuta |
|---|---|---|
| Backend | `cd backend && .venv/Scripts/python.exe -m pytest apps/<app> -q -n 4` | Pruebas de las apps tocadas, en 4 procesos con `pytest-xdist`; cada uno usa su propia base `test_<base>_gw<N>`. Sin `-n`, la suite completa tarda ~45 min. No lanzar dos pytest a la vez sobre la misma base: SQL Server responde con deadlocks 1205 |
| Backend | `cd backend && .venv/Scripts/python.exe manage.py makemigrations --check --dry-run` | Que no falten migraciones |
| Frontend | `cd frontend && npx vitest run` | Suite completa (~3 min) |
| Frontend | `cd frontend && npx eslint <archivos>` | Lint de lo tocado |
| Móvil | `cd mobile && npx jest` | Pruebas de la app |
| Móvil | `cd mobile && npx expo export --platform android` | Que el bundle compila |

## 6. Reglas específicas por rol
### DEV-3
- Tras crear una migración, aplicarla en la base local (`manage.py migrate`): pytest usa su propia base y no lo detecta. La tarea programada de respaldo corre cada 5 minutos y falla con el modelo sin migrar.
### DEV-2
- Reutilizar los servicios existentes (p. ej. `licencias.services.jefes_de`, `tasks.jerarquia`) antes de escribir otros.
- El `runserver` local corre con `--noreload` en el puerto 8010: hay que reiniciarlo tras cambiar Python.
### DEV-4
- Accesibilidad WCAG 2.1 AA; áreas táctiles de 44 px con `pointer: coarse`; obligatorio marcado con `mz-campo__obligatorio` + texto oculto «(obligatorio)».
### DEV-1
- Marca LAARCOURIER (Brand Book 2026, decisión del usuario, 12/11/2026): amarillo #FCE200, negro #000000, gris #E1E1E1; fuente Poppins (auxiliar oficial de Mazzard); logotipo LAARCOURIER sin alterar (`frontend/src/assets/marca/`); ícono de la app «LCE». Igual que la web (`branding/0004_marca_laarcourier`). El amarillo nunca va como texto sobre fondo claro.
- Tokens solo en `expo-secure-store`. El push nunca lleva datos personales (solo el nombre del módulo y los IDs). La sesión se comporta igual que en la web. Nada de secretos en `mobile/`. Áreas táctiles de 44 pt o más y etiquetas de accesibilidad.
### DEV-5
- Todo cambio probado se despliega a producción; las migraciones se aplican con `ga_migraciones`.

## 7. Estado actual / Estado de implementación
- Andamiaje del equipo creado el 11/11/2026 con US-001.
- App móvil iniciada el 12/11/2026 con US-009 (Fase 1); siguen US-010 y US-011.
