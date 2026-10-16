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
    "empresas": {
        "label": "Empresas",
        "description": (
            "Las empresas del grupo y en cuáles trabaja cada cuenta. Quien no "
            "tiene membresía en una empresa no ve nada de ella, así que asignar "
            "usuarios es dar acceso a información: por eso es un permiso aparte "
            "de editar los datos de la empresa."
        ),
        "permissions": {
            "empresas.ver": "Ver las empresas del sistema y en cuáles trabaja cada usuario",
            "empresas.editar": "Crear y editar empresas",
            "empresas.asignar": ("Asignar usuarios a empresas y elegir en cuál entran por defecto"),
        },
    },
    "configuracion": {
        "label": "Configuración",
        "description": (
            "Ajustes del sistema: identidad institucional, apariencia y la "
            "política de respaldo automático."
        ),
        "permissions": {
            "configuracion.ver": "Ver configuración del sistema",
            "configuracion.editar": "Editar configuración del sistema",
            # Aparte de `configuracion.editar` porque no es la misma
            # responsabilidad: cambiar el logo y los colores lo hace quien
            # cuida la imagen del sistema, y apagar el respaldo automático o
            # mover su carpeta decide de cuándo se puede volver si algo se
            # pierde. Quien tenía `configuracion.editar` lo conserva —la
            # migración se lo concede—, pero a partir de ahora se pueden
            # separar.
            "configuracion.respaldos": (
                "Configurar el respaldo automático: si está encendido, cada "
                "cuánto, a qué hora, en qué carpeta y cuántos conservar"
            ),
        },
    },
    "activos": {
        "label": "Activos",
        "description": "Inventario de dispositivos electrónicos de la compañía.",
        "permissions": {
            "activos.ver": "Ver el inventario y la ficha de cada activo",
            "activos.ver_asignados": "Ver únicamente los equipos que uno tiene a su cargo",
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
        "description": ("Catálogos de sedes, departamentos y empleados custodios."),
        "permissions": {
            "organizacion.ver": "Ver sedes, departamentos y empleados",
            "organizacion.editar": "Crear y editar sedes, departamentos y empleados",
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
    "solicitudes": {
        "label": "Solicitudes de compra",
        "description": (
            "Peticiones de dispositivos y componentes que todavía no existen. "
            "Pedir y gestionar se separan a propósito: cualquiera que trabaje "
            "con equipos debería poder pedir uno, y decidir si se compra es "
            "otro oficio. Gestionar habilita a mover **las asignadas a uno**; "
            "administrar, las de todos."
        ),
        "permissions": {
            "solicitudes.ver": "Ver las solicitudes propias y las asignadas",
            "solicitudes.crear": "Realizar solicitudes de compra",
            "solicitudes.gestionar": (
                "Gestionar las solicitudes asignadas a uno: tomarlas, comprarlas, "
                "entregarlas o rechazarlas"
            ),
            "solicitudes.administrar": (
                "Ver y gestionar las solicitudes de todos, no solo las propias"
            ),
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
    "matriz": {
        "label": "Matriz de obligaciones",
        "description": (
            "Obligaciones regulatorias, contractuales e internas de cada "
            "empresa: sus períodos, evidencias, cierres y recordatorios. Estos "
            "permisos valen **solo en la empresa donde se tienen** por el rol "
            "de la membresía: un rol global del usuario no los concede en "
            "ninguna empresa (ver `apps.permissions.authorization`)."
        ),
        "permissions": {
            "matriz.ver_todas": (
                "Ver todos los períodos de la empresa; sin él, solo aquellos en "
                "los que es responsable o suplente"
            ),
            "matriz.crear": "Crear obligaciones",
            "matriz.editar": "Editar obligaciones y el seguimiento de los períodos",
            "matriz.cambiar_fecha": "Cambiar la fecha de vencimiento de un período, con justificación",
            "matriz.cargar": "Cargar evidencias y eliminar las rechazadas",
            "matriz.enviar": "Enviar períodos a validación",
            "matriz.validar": "Validar cierres, devolver períodos y rechazar evidencias",
            "matriz.recordar": "Reenviar recordatorios y reintentar avisos fallidos",
            "matriz.exportar": "Exportar la matriz y sus reportes a Excel o PDF",
            "matriz.ver_auditoria": "Ver el historial y las notificaciones de la empresa",
            "matriz.configurar": "Configurar la empresa y sus recordatorios",
            "matriz.gestionar_miembros": "Asignar y quitar roles de personas en la empresa",
        },
    },
    "catalogos": {
        "label": "Catálogos de la Matriz",
        "description": (
            "Áreas y entidades de control, compartidas por todas las empresas. "
            "No son los departamentos del inventario: estas clasifican "
            "obligaciones, aquellos organizan personas y equipos."
        ),
        "permissions": {
            "catalogos.ver": "Ver áreas y entidades de control",
            "catalogos.editar": "Crear, editar y eliminar áreas y entidades de control",
        },
    },
    "dashboard": {
        "label": "Dashboards",
        "description": (
            "Los dashboards de cada área o departamento de la empresa: verlos, crearlos, editarlos, "
            "cargar sus datos (Excel o la base externa) y su IA. Los codenames "
            "son los del sistema de origen (cms_dashboards). Un dashboard con "
            "roles propios (editores/lectores) decide su acceso por esa lista y "
            "no por estos permisos (ver `apps.cartera.permisos`)."
        ),
        "permissions": {
            "dashboard.crear": "Crear nuevos dashboards por área",
            "dashboard.editar": "Editar el nombre y área de un dashboard",
            "dashboard.eliminar": "Eliminar un dashboard",
            "dashboard.view": "Ver Dashboards",
            "dashboard.edit": "Entrar en modo edición del dashboard",
            "dashboard.layout.edit": "Editar el diseño (orden/tamaño) del dashboard",
            "dashboard.component.style": "Editar estilos de un componente del dashboard",
            "dashboard.component.create": "Crear componentes del dashboard",
            "dashboard.component.delete": "Eliminar componentes del dashboard",
            "dashboard.configuration.reset": "Restablecer la configuración del dashboard",
            "dashboard.interpretar": "Generar la interpretación completa del dashboard con IA",
            "dashboard.hallazgos_ia": "Generar hallazgos clave por componente con IA",
            "dashboard.fuente_bd.configurar": (
                "Elegir/cambiar la vista o procedimiento de base de datos, sus "
                "parámetros y la frecuencia de actualización automática de un dashboard"
            ),
            "dashboard.fuente_bd.actualizar": (
                "Forzar una actualización inmediata de los datos desde la base de "
                "datos ya configurada"
            ),
            "dashboard.archivo.cargar": (
                "Cargar un archivo Excel nuevo que reemplaza los datos de un dashboard "
                '("Cargar otro archivo")'
            ),
            "dashboard.datos.editar": (
                "Procesar, reprocesar, borrar o remapear los datos ya cargados de un dashboard"
            ),
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
