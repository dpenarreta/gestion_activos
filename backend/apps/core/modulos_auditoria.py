"""El nombre legible de cada módulo del registro de auditoría, para el
filtro «Módulo» (20/10/2026). La clave es el `module` con que se registró el
evento; lo que no esté aquí se muestra con su clave."""

NOMBRES = {
    "": "Sistema (sin módulo)",
    "core": "Sistema",
    "activos": "Gestión de Activos",
    "mantenimientos": "Gestión de Activos · Mantenimientos",
    "solicitudes": "Gestión de Activos · Solicitudes",
    "politicas": "Gestión de Activos · Renovación",
    "adjuntos": "Gestión de Activos · Adjuntos",
    "alertas": "Gestión de Activos · Alertas",
    "ordenes": "Órdenes de trabajo",
    "soporte": "Mesa de ayuda",
    "cartera": "Dashboards",
    "dashboards": "Dashboards",
    "institucional": "Institucional",
    "licencias": "Institucional · Solicitud de permisos",
    "organizacion": "Configuración · Catálogos",
    "empresas": "Configuración · Empresas",
    "usuarios": "Configuración · Usuarios",
    "roles": "Configuración · Roles",
    "configuracion": "Configuración",
    "notificaciones": "Configuración · Notificaciones",
    "correos": "Configuración · Correos",
    "reportes": "Reportes",
    "chat": "Chat",
    "matriz": "Matriz de obligaciones",
}


def nombre(modulo: str) -> str:
    return NOMBRES.get(modulo or "", modulo or "Sistema (sin módulo)")
