"""Catálogo centralizado de permisos, agrupados por módulo.

Fuente de verdad única y versionada en código (no editable en runtime):
qué permisos existen y a qué módulo pertenecen. Lo que sí es dinámico por
rol/usuario es *cuáles* de estos permisos tiene asignados cada uno — eso
vive en `auth.Group`/`auth.Permission` (ver `apps.permissions.models.ModulePermission`
y `apps.permissions.authorization`).

Convención de nombres: `"<modulo>.<accion>"`, ej. `"usuarios.ver"`.

Cada bloque pertenece a un grupo (`MODULE_GROUPS`): una sección general
(Reportes, Auditoría, Configuración) o un módulo (Gestión de Activos, Matriz,
Dashboards, Mantenimiento de sedes). Cada
módulo de negocio que se agregue debe sumar aquí sus propias entradas y su
grupo — el catálogo es cerrado: un permiso que no esté en este archivo no
existe para el sistema (ver docs/roles-and-permissions.md).
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
        },
    },
    "notificaciones": {
        "label": "Notificaciones",
        "description": (
            "Configuración → Notificaciones: qué alertas del inventario están "
            "activas, sus umbrales y a quién se avisan. Es configuración del "
            "sistema, no trabajo del módulo. (Hasta el 16 de octubre de 2026 "
            "era `alertas.configurar`; la migración lo renombró y los roles lo "
            "conservan.)"
        ),
        "permissions": {
            "notificaciones.configurar": "Configurar los umbrales y qué alertas están activas",
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
            "empresa: sus períodos, evidencias, cierres y recordatorios. Como "
            "todos, cuentan por un rol general o por el de la membresía en la "
            "empresa activa (ver `apps.permissions.authorization`)."
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
    "ordenes": {
        "label": "Órdenes de trabajo",
        "description": (
            "Mantenimiento de sedes y agencias: solicitar, asignar, ejecutar y "
            "aceptar órdenes de trabajo. Sin «ver todas», cada persona ve las "
            "que solicitó, las asignadas a ella y las de las sedes a su cargo "
            "(Configuración → Catálogos → Sedes)."
        ),
        "permissions": {
            "ordenes.ver": (
                "Entrar al módulo y ver las órdenes que solicitó, las asignadas "
                "a usted y las de las sedes a su cargo"
            ),
            "ordenes.ver_todas": "Ver todas las órdenes de la empresa",
            "ordenes.crear": "Solicitar órdenes de trabajo",
            "ordenes.gestionar": (
                "Asignar, programar, corregir y mover cualquier orden (coordinación)"
            ),
            "ordenes.ejecutar": (
                "Ejecutar las órdenes asignadas a usted: programarlas, iniciarlas, "
                "pausarlas, registrar materiales y horas y enviarlas a aprobación"
            ),
            "ordenes.aceptar": ("Aceptar o devolver el trabajo terminado en las sedes a su cargo"),
            "ordenes.ver_contacto": "Ver completo el teléfono de contacto del solicitante",
            "ordenes.reportes": "Ver y exportar los reportes de órdenes de trabajo",
        },
    },
    "soporte": {
        "label": "Mesa de ayuda",
        "description": (
            "Tickets de soporte de TI que los empleados crean desde el formulario "
            "público de su empresa. Se reparten por disponibilidad entre los "
            "técnicos habilitados para cada categoría y en su horario."
        ),
        "permissions": {
            "soporte.atender": (
                "Atender tickets: bandeja propia, tomar de la cola, responder, "
                "escalar, marcar como atendido y registrar horas fuera de horario"
            ),
            "soporte.ver_todos": "Ver todos los tickets de la empresa",
            "soporte.asignar": "Asignar y reasignar tickets a cualquier técnico (coordinación)",
            "soporte.aprobar_horas": "Aprobar o rechazar las horas fuera de horario",
            "soporte.configurar": (
                "Configurar la mesa de ayuda: niveles, categorías y casos, técnicos y "
                "sus horarios, SLA y respuestas predefinidas"
            ),
            "soporte.reportes": "Ver los reportes de la mesa de ayuda",
        },
    },
    "chat": {
        "label": "Chat",
        "description": (
            "El chat de la empresa (canal general, mensajes directos y grupos) lo usa "
            "toda persona con cuenta sin ningún permiso. Estos permisos suman lo de "
            "administración."
        ),
        "permissions": {
            "chat.historial_completo": (
                "Ver hasta 12 meses de historial en sus conversaciones (los demás ven 6)"
            ),
            "chat.grupos_por_area": (
                "Crear grupos por área, cuyos miembros son las personas de esa área"
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


#: A qué parte del sistema pertenece cada bloque del catálogo, en el orden en
#: que se muestran. Los **generales** son las secciones del bloque «General»
#: del menú —Reportes, Auditoría y Configuración, con todo lo que se
#: administra desde ella— y valen en todo el sistema; los demás solo sirven
#: dentro de su módulo. Todo
#: bloque del catálogo está en exactamente un grupo (lo comprueba
#: `apps/permissions/tests/test_grupos_del_catalogo.py`).
MODULE_GROUPS = [
    # --- Generales: las secciones del bloque «General» del menú -------------
    {
        "id": "reportes",
        "label": "Reportes",
        "alcance": "general",
        "description": (
            "La sección Reportes del bloque «General»: los reportes y su "
            "descarga. La pestaña de cada módulo pide además los permisos de "
            "ese módulo (los de la Matriz, los suyos)."
        ),
        "modules": ["reportes"],
    },
    {
        "id": "auditoria",
        "label": "Auditoría",
        "alcance": "general",
        "description": (
            "La sección Auditoría del bloque «General»: el registro de lo que "
            "se hizo en todo el sistema."
        ),
        "modules": ["auditoria"],
    },
    {
        "id": "configuracion",
        "label": "Configuración",
        "alcance": "general",
        "description": (
            "La sección Configuración del bloque «General»: empresas, usuarios, "
            "roles y permisos, catálogos, notificaciones, identidad visual y "
            "respaldos. Valen en todo el sistema."
        ),
        "modules": [
            "empresas",
            "usuarios",
            "roles",
            "permisos",
            "organizacion",
            "catalogos",
            "notificaciones",
            "configuracion",
        ],
    },
    {
        "id": "chat",
        "label": "Chat",
        "alcance": "general",
        "description": (
            "El chat de la empresa: lo usa toda persona con cuenta. Estos permisos "
            "suman el historial de 12 meses y los grupos por área."
        ),
        "modules": ["chat"],
    },
    # --- De cada módulo: solo sirven dentro de él ----------------------------
    {
        "id": "activos",
        "label": "Gestión de Activos",
        "alcance": "modulo",
        "description": (
            "Solo sirven en el módulo de Gestión de Activos: inventario, "
            "alertas, mantenimientos, solicitudes y renovación."
        ),
        "modules": [
            "activos",
            "alertas",
            "adjuntos",
            "mantenimientos",
            "solicitudes",
            "politicas",
        ],
    },
    {
        "id": "matriz",
        "label": "Matriz de obligaciones",
        "alcance": "modulo",
        "description": (
            "Solo sirven en el módulo de la Matriz: obligaciones, períodos, "
            "evidencias y recordatorios de cada empresa."
        ),
        "modules": ["matriz"],
    },
    {
        "id": "dashboards",
        "label": "Dashboards",
        "alcance": "modulo",
        "description": (
            "Solo sirven en el módulo de Dashboards: los de cada área o "
            "departamento, sus datos y su interpretación con IA."
        ),
        "modules": ["dashboard"],
    },
    {
        "id": "sedes",
        "label": "Mantenimiento de sedes",
        "alcance": "modulo",
        "description": (
            "Solo sirven en el módulo de Mantenimiento de sedes: las órdenes de "
            "trabajo sobre sedes y agencias, su ejecución y su aceptación."
        ),
        "modules": ["ordenes"],
    },
    {
        "id": "mesa_de_ayuda",
        "label": "Mesa de ayuda",
        "alcance": "modulo",
        "description": (
            "Solo sirven en el módulo de Mesa de ayuda: atender, asignar y supervisar "
            "los tickets de soporte de la empresa."
        ),
        "modules": ["soporte"],
    },
]


def _anotar_grupos():
    """Cada bloque del catálogo lleva su grupo (`grupo`), y el catálogo queda
    en el orden de los grupos: quien lo recorre los encuentra juntos."""
    global PERMISSION_CATALOG
    ordenado = {}
    for orden, grupo in enumerate(MODULE_GROUPS):
        resumen = {
            "id": grupo["id"],
            "label": grupo["label"],
            "alcance": grupo["alcance"],
            "description": grupo["description"],
            "orden": orden,
        }
        for clave in grupo["modules"]:
            ordenado[clave] = {**PERMISSION_CATALOG[clave], "grupo": resumen}
    # Un bloque sin grupo no se pierde: va al final, sin `grupo`, y la prueba
    # del catálogo lo señala.
    for clave, modulo in PERMISSION_CATALOG.items():
        ordenado.setdefault(clave, modulo)
    PERMISSION_CATALOG = ordenado


_anotar_grupos()


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
