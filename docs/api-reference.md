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

## Inventario de activos (RF-01, RF-02, RF-03, RF-08)

Base: `/api/v1/activos/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/activos/` | `activos.ver` | Listado paginado. Filtros: `q`, `tipo`, `departamento`, `custodio`, `estado`, `requiere_renovacion` |
| POST | `/activos/` | `activos.crear` | Alta. El `codigo_barras` lo genera el sistema (RF-02) |
| GET | `/activos/{id}/` | `activos.ver` | Ficha completa, con el veredicto de renovación calculado en vivo |
| PATCH | `/activos/{id}/` | `activos.editar` | Edita la ficha técnica. No admite `custodio`/`departamento`/`estado` |
| GET | `/activos/por-codigo/{codigo}/` | `activos.ver` | **RF-03.** Resuelve por código de barras *o* número de serie; devuelve ficha, movimientos, mantenimientos y costos |
| GET | `/activos/{id}/historial/` | `activos.ver` | Igual que el anterior, por id |
| POST | `/activos/{id}/asignar/` | `activos.asignar` | Asigna, traslada o devuelve. `custodio: null` devuelve a bodega |
| POST | `/activos/{id}/cambiar-estado/` | `activos.dar_baja` | Cambia el estado. La baja exige `motivo` |
| GET | `/activos/{id}/etiqueta/` | `activos.imprimir_etiqueta` | **RF-08.** `?formato=pdf` (por defecto, devuelve el documento) o `zpl\|tspl` (trabajo térmico). `?descargar=false` entrega el PDF inline para previsualizar |
| POST | `/activos/etiquetas/` | `activos.imprimir_etiqueta` | Lote de etiquetas en un solo trabajo (`{"ids": [...]}`, máx. 200) |
| GET/POST/PATCH | `/activos/tipos/` | `activos.ver` / `activos.editar` | Catálogo de tipos de dispositivo |

`DELETE` no existe en este recurso: un activo se da de baja, nunca se borra.

## Organización

Base: `/api/v1/organizacion/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET/POST/PATCH | `/organizacion/departamentos/` | `organizacion.ver` / `organizacion.editar` | Áreas. Filtros: `q`, `activo` |
| GET/POST/PATCH | `/organizacion/empleados/` | `organizacion.ver` / `organizacion.editar` | Custodios. Filtros: `q`, `departamento`, `activo` |

Desactivar un empleado que aún custodia activos devuelve `400`
(`empleado_con_activos`).

## Mantenimientos (RF-04, RF-05)

Base: `/api/v1/mantenimientos/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/mantenimientos/` | `mantenimientos.ver` | Filtros: `activo`, `codigo_barras`, `tipo`, `q`, `desde`, `hasta` |
| POST | `/mantenimientos/` | `mantenimientos.registrar` | Registra la intervención con su lista `componentes` |
| PATCH | `/mantenimientos/{id}/` | `mantenimientos.editar` | Corrige. Enviar `componentes` reemplaza el desglose completo |
| DELETE | `/mantenimientos/{id}/` | `mantenimientos.editar` | Elimina una captura errónea y recalcula los contadores |
| GET/POST/PATCH | `/mantenimientos/componentes/` | `mantenimientos.ver` / `mantenimientos.componentes` | Catálogo de repuestos. `es_critico` alimenta el umbral de RF-06 |

Registrar o corregir una intervención recalcula, en la misma transacción, el
contador de RF-05 y la sugerencia de RF-07 del activo.

## Políticas de renovación (RF-06, RF-07)

Base: `/api/v1/politicas/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET/POST/PATCH/DELETE | `/politicas/` | `politicas.ver` / `politicas.editar` | Umbrales por tipo de dispositivo, o global si `tipo_dispositivo` va vacío |
| GET | `/politicas/sugerencias/` | `politicas.ver` | **RF-07.** Activos que hoy exceden algún umbral, con el motivo de cada criterio |
| POST | `/politicas/reevaluar/` | `politicas.editar` | Fuerza el recálculo de la caché de todos los activos |

Guardar una política reevalúa de inmediato los activos que rige. El criterio
de longevidad se cumple por el paso del tiempo, así que conviene programar
`manage.py recalcular_indicadores` a diario.

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
