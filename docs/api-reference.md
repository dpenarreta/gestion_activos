# Referencia de API

Base: `/api/v1/`. Documentación interactiva (drf-spectacular): `/api/v1/schema/swagger-ui/`.

Todas las respuestas de error siguen el contrato:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

## Autenticación

| Método | Ruta | Auth | Permiso |
| --- | --- | --- | --- |
| POST | `auth/register/` | Pública | — |
| POST | `auth/login/` | Pública | — |
| POST | `auth/token/refresh/` | Pública | — |
| POST | `auth/logout/` | Requerida | — |
| POST | `auth/logout-all/` | Requerida | — |
| GET | `auth/sessions/` | Requerida | — |
| GET | `auth/me/` | Requerida | — |
| POST | `auth/password-reset/request/` | Pública | — |
| POST | `auth/password-reset/confirm/` | Pública | — |
| POST | `auth/password/change/` | Requerida | — |

## Usuarios (`admin/users/`)

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `admin/users/` | `usuarios.ver` |
| POST | `admin/users/` | `usuarios.crear` |
| GET | `admin/users/{id}/` | `usuarios.ver` |
| PATCH | `admin/users/{id}/` | `usuarios.editar` |
| POST | `admin/users/{id}/enable/` | `usuarios.deshabilitar` |
| POST | `admin/users/{id}/disable/` | `usuarios.deshabilitar` |
| POST | `admin/users/{id}/block/` | `usuarios.deshabilitar` |
| POST | `admin/users/{id}/unblock/` | `usuarios.deshabilitar` |
| GET | `admin/users/{id}/sessions/` | `usuarios.editar` |
| POST | `admin/users/{id}/sessions/revoke/` | `usuarios.editar` |
| POST | `admin/users/{id}/password-reset/` | `usuarios.restablecer_password` |
| POST | `admin/users/{id}/roles/` | `usuarios.editar` |
| POST | `admin/users/{id}/permissions/` | `usuarios.editar` |

Sin `DELETE`: la eliminación física de usuarios está deshabilitada a
propósito (baja lógica vía `disable`/`block`, ver AC-DP-006).

## Roles (`admin/roles/`)

| Método | Ruta | Permiso (lectura / escritura) |
| --- | --- | --- |
| GET | `admin/roles/` | `roles.ver` |
| POST | `admin/roles/` | `roles.editar` |
| GET | `admin/roles/{id}/` | `roles.ver` |
| PATCH | `admin/roles/{id}/` | `roles.editar` |
| DELETE | `admin/roles/{id}/` | `roles.editar` |
| GET | `admin/roles/permissions-catalog/` | `roles.ver` |

## Permisos (`admin/permissions/`)

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `admin/permissions/` | `permisos.ver` |

Solo lectura: el catálogo es código versionado, no un recurso editable en
runtime (ver `docs/roles-and-permissions.md`).

## Auditoría (`admin/audit-logs/`)

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `admin/audit-logs/` | `auditoria.ver` |
| GET | `admin/audit-logs/{id}/` | `auditoria.ver` (+ `auditoria.ver_detalle`/`ver_ubicacion` para esos campos) |
| GET | `admin/audit-logs/export/` | `auditoria.exportar` |

Solo lectura: no existe endpoint de escritura (el registro se crea
internamente vía `apps.core.audit.record_audit_event`).

## Identidad institucional / tema (`admin/theme/`, `theme/current/`)

| Método | Ruta | Auth | Permiso |
| --- | --- | --- | --- |
| GET | `theme/current/` | Pública | — |
| GET | `admin/theme/` | Requerida | `configuracion.ver` |
| PATCH | `admin/theme/` | Requerida | `configuracion.editar` |
| POST | `admin/theme/reset/` | Requerida | `configuracion.editar` |
| GET | `admin/theme/options/` | Requerida | `configuracion.ver` |

## Infraestructura

| Método | Ruta | Auth |
| --- | --- | --- |
| GET | `health/` | Pública |
| GET | `health/ready/` | Pública |
| GET | `version/` | Pública |
| GET | `schema/`, `schema/swagger-ui/`, `schema/redoc/` | Pública |

## Agregar un módulo nuevo (para un proyecto concreto)

1. Sumar el módulo y sus permisos a `apps/permissions/catalog.py`
   (`PERMISSION_CATALOG`).
2. Crear la app Django (modelos, servicios, serializers, vistas, urls).
3. Definir clases de permiso propias extendiendo
   `apps.permissions.permissions.HasModulePermission`.
4. Registrar las rutas en `config/api_v1_urls.py`.
5. Documentar los nuevos criterios de aceptación como escenarios Gherkin en
   `tests/qa/features/` y sumarlos a la matriz de trazabilidad — nunca
   dejarlos solo en el README o en comentarios de código.
