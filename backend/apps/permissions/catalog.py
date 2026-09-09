"""Catálogo centralizado de permisos, agrupados por módulo.

Fuente de verdad única y versionada en código (no editable en runtime):
qué permisos existen y a qué módulo pertenecen. Lo que sí es dinámico por
rol/usuario es *cuáles* de estos permisos tiene asignados cada uno — eso
vive en `auth.Group`/`auth.Permission` (ver `apps.permissions.models.ModulePermission`
y `apps.permissions.authorization`).

Convención de nombres: `"<modulo>.<accion>"`, ej. `"usuarios.ver"`.

Hoy solo contiene los módulos transversales (usuarios, roles, permisos,
auditoría, configuración/branding). Cada módulo de negocio que se agregue
debe sumar aquí sus propias entradas — el catálogo es cerrado: un permiso
que no esté en este archivo no existe para el sistema
(ver docs/roles-and-permissions.md).
"""

PERMISSION_CATALOG = {
    "usuarios": {
        "label": "Usuarios",
        "description": "Gestión de las cuentas de usuario del sistema.",
        "permissions": {
            "usuarios.ver": "Ver usuarios",
            "usuarios.crear": "Crear usuarios",
            "usuarios.editar": "Editar usuarios y su asignación de roles/permisos",
            "usuarios.deshabilitar": "Habilitar, deshabilitar, bloquear y desbloquear usuarios",
            "usuarios.restablecer_password": (
                "Enviar enlace de restablecimiento, forzar cambio de contraseña en el "
                "próximo inicio o cerrar sesiones activas de un usuario"
            ),
        },
    },
    "roles": {
        "label": "Roles",
        "description": "Gestión de roles y asignación de permisos por módulo.",
        "permissions": {
            "roles.ver": "Ver roles y el catálogo de permisos",
            "roles.editar": "Crear, editar y eliminar roles",
        },
    },
    "permisos": {
        "label": "Permisos",
        "description": "Consulta del catálogo de permisos disponibles en el sistema.",
        "permissions": {
            "permisos.ver": "Ver el catálogo de permisos y a qué módulo pertenece cada uno",
        },
    },
    "configuracion": {
        "label": "Configuración",
        "description": "Identidad institucional y apariencia visual del sistema.",
        "permissions": {
            "configuracion.ver": "Ver configuración del sistema",
            "configuracion.editar": "Editar configuración del sistema",
        },
    },
    "activos": {
        "label": "Activos",
        "description": "Inventario de dispositivos electrónicos de la compañía.",
        "permissions": {
            "activos.ver": "Ver el inventario y la ficha de cada activo",
            "activos.crear": "Registrar nuevos activos en el inventario",
            "activos.editar": "Editar la ficha técnica de un activo",
            "activos.asignar": "Asignar, trasladar y devolver activos entre custodios y áreas",
            "activos.dar_baja": "Dar de baja activos del inventario",
            "activos.imprimir_etiqueta": "Generar e imprimir etiquetas de código de barras",
            "activos.exportar": "Exportar el inventario a Excel",
        },
    },
    "organizacion": {
        "label": "Organización",
        "description": (
            "Catálogos de departamentos, ubicaciones físicas y empleados custodios."
        ),
        "permissions": {
            "organizacion.ver": "Ver departamentos, ubicaciones y empleados",
            "organizacion.editar": "Crear y editar departamentos, ubicaciones y empleados",
        },
    },
    "mantenimientos": {
        "label": "Mantenimientos",
        "description": "Bitácora de intervenciones preventivas y correctivas.",
        "permissions": {
            "mantenimientos.ver": "Ver el historial de mantenimientos y sus costos",
            "mantenimientos.registrar": "Registrar nuevas intervenciones",
            "mantenimientos.editar": "Corregir o eliminar intervenciones registradas",
            "mantenimientos.componentes": "Administrar el catálogo de componentes y repuestos",
            "mantenimientos.exportar": "Exportar la bitácora de mantenimientos a Excel",
        },
    },
    "politicas": {
        "label": "Políticas de renovación",
        "description": "Umbrales de obsolescencia que disparan la sugerencia de cambio.",
        "permissions": {
            "politicas.ver": "Ver las políticas de renovación configuradas",
            "politicas.editar": "Configurar los umbrales de obsolescencia",
        },
    },
    "adjuntos": {
        "label": "Adjuntos",
        "description": "Documentos y evidencias asociados a los activos.",
        "permissions": {
            "adjuntos.ver": "Ver y descargar los adjuntos de un activo",
            "adjuntos.subir": "Adjuntar documentos y evidencias",
            "adjuntos.eliminar": "Eliminar adjuntos",
        },
    },
    "alertas": {
        "label": "Alertas",
        "description": "Avisos sobre el estado del parque y sus umbrales.",
        "permissions": {
            "alertas.ver": "Ver el centro de alertas del parque",
            "alertas.configurar": "Configurar los umbrales y qué alertas están activas",
        },
    },
    "reportes": {
        "label": "Reportes",
        "description": "Los trece reportes del documento funcional y su exportación.",
        "permissions": {
            "reportes.ver": "Ver el catálogo de reportes y su vista previa",
            # Descargar es un permiso aparte porque el archivo sale del
            # sistema: circula por correo y se archiva en equipos donde no
            # rigen los permisos que protegen la pantalla.
            "reportes.exportar": "Descargar reportes en Excel, CSV o PDF",
        },
    },
    "auditoria": {
        "label": "Auditoría",
        "description": "Consulta del registro de auditoría de operaciones administrativas.",
        "permissions": {
            "auditoria.ver": "Ver el registro de auditoría",
            "auditoria.ver_detalle": "Ver el detalle (valores anteriores y nuevos) de un evento",
            "auditoria.ver_ubicacion": "Ver la ubicación aproximada asociada a un evento",
            "auditoria.exportar": "Exportar el registro de auditoría",
        },
    },
}


def iter_all_permissions():
    """Itera `(codename, verbose_name)` de todos los módulos, en el formato
    que Django espera en `Meta.permissions`."""
    for module in PERMISSION_CATALOG.values():
        yield from module["permissions"].items()


def all_codenames() -> set[str]:
    return {codename for codename, _ in iter_all_permissions()}


def all_module_keys() -> set[str]:
    return set(PERMISSION_CATALOG.keys())


def as_django_permission_tuples() -> list[tuple[str, str]]:
    return list(iter_all_permissions())
