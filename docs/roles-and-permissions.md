# Roles y permisos

## Modelo

- **Roles = `django.contrib.auth.models.Group`.** No existe un modelo
  `Role` propio — se reutiliza el modelo de Django, que ya trae una tabla
  de asociación usuario↔grupo y grupo↔permiso probada y segura.
- **Permisos = catálogo cerrado en código**
  (`apps.permissions.catalog.PERMISSION_CATALOG`), no editable en runtime.
  Un modelo ancla sin tabla real (`apps.permissions.models.ModulePermission`,
  `managed=False`) cuelga cada entrada del catálogo como un
  `auth.Permission` real, bajo su propio `ContentType`, desacoplado de
  cualquier modelo de dominio.
- **Asignación** (qué permisos tiene cada usuario) sí es dinámica y vive en
  las tablas estándar de Django: por rol (`user.groups` → `group.permissions`)
  o directamente (`user.user_permissions`).

### ¿Por qué el catálogo es código y no una tabla editable?

Permitir crear permisos arbitrarios en runtime terminaría, en la práctica,
en permisos sin ningún código que realmente los verifique — un permiso solo
tiene sentido si existe una vista que lo exige. Mantenerlo en código obliga
a que cada permiso nuevo se sume junto con el código que lo consume. Ver
`docs/api-reference.md` para cómo un proyecto concreto agrega sus propios
módulos y permisos.

## Catálogo actual

| Módulo | Permisos |
| --- | --- |
| `usuarios` | `ver`, `crear`, `editar`, `deshabilitar`, `restablecer_password` |
| `roles` | `ver`, `editar` |
| `permisos` | `ver` |
| `configuracion` | `ver`, `editar` |
| `activos` | `ver`, `crear`, `editar`, `asignar`, `dar_baja`, `imprimir_etiqueta`, `exportar` |
| `organizacion` | `ver`, `editar` |
| `mantenimientos` | `ver`, `registrar`, `editar`, `componentes`, `exportar` |
| `politicas` | `ver`, `editar` |
| `adjuntos` | `ver`, `subir`, `eliminar` |
| `alertas` | `ver`, `configurar` |
| `auditoria` | `ver`, `ver_detalle`, `ver_ubicacion`, `exportar` |

## Resolución de autorización

`apps.permissions.authorization`:

- `get_user_permission_codenames(user)`: codenames (`"usuarios.ver"`, sin
  prefijo de app) que el usuario tiene, vía rol o asignación directa. Es lo
  que devuelve `GET /auth/me/`. **No hace ningún bypass propio para
  superusuarios** — pero Django's `ModelBackend` sí lo hace de forma
  transparente (`get_all_permissions()` devuelve `Permission.objects.all()`
  para cualquier `is_superuser=True`), así que un superusuario ve el
  catálogo completo igual, sin que este código tenga que duplicar esa
  lógica. Esto es un comportamiento real de Django, no específico de este
  proyecto — conviene tenerlo presente si se depuran permisos de un
  superusuario.
- `user_has_permission(user, codename)`: el chequeo de autorización real
  que usan las vistas (vía `HasModulePermission`). El bypass explícito de
  `is_superuser` aquí es redundante con el de Django, pero evita una
  consulta a la base en el camino más común.

## Clases DRF

`apps.permissions.permissions.HasModulePermission` es la base que usan
todas las vistas administrativas: declara `view_permission` (métodos
seguros) y `write_permission` (el resto). Cualquier denegación a un usuario
autenticado se audita automáticamente
(`action="access_denied"`, con el permiso exigido, método y ruta).

## AC-038: protección del último administrador activo

Este criterio **no existía en el proyecto original** — se construyó
específicamente para esta base. Se define "administrador" como
`is_superuser=True` (el único bypass real de autorización). Antes de
deshabilitar o bloquear un usuario,
`apps.users.services.UserAdminService._is_last_active_admin` verifica si
es el único superusuario con `status=ACTIVE`; si lo es, la operación se
rechaza con un 400 explícito. Habilitar/desbloquear nunca se restringe (solo
sumar administradores es siempre seguro).

Un superusuario se crea con el comando nativo de Django,
`python manage.py createsuperuser`, que nunca usa una contraseña fija
(AC-044) — es interactivo, o acepta `DJANGO_SUPERUSER_PASSWORD` por
variable de entorno para automatización (ej. scripts de aprovisionamiento),
nunca un valor hardcodeado en el repositorio.

## Frontend

- `usePermission(codename)`: chequeo puntual contra `user.permissions`
  (poblado desde `/auth/me/`).
- `usePermissionsCatalog()`: trae el catálogo completo
  (`GET /admin/permissions/`) para construir el selector de permisos del
  formulario de rol (`PermissionsCheckboxGroup`) o la página de solo
  consulta `Permisos`.
- El menú administrativo (`staticAdminMenu.js`) filtra client-side por
  `user.permissions` — nunca es la única barrera: toda vista administrativa
  vuelve a validar el permiso en el backend.
