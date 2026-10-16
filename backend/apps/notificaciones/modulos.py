"""De qué módulo viene cada notificación, con su nombre y su ícono.

La clave es el prefijo de la plantilla de correo (`soporte.ticket_creado` →
`soporte`) o del evento. Lo que no esté aquí se muestra como «Sistema».
"""

MODULOS = {
    "activos": ("Gestión de Activos", "pc-display"),
    "solicitudes": ("Gestión de Activos · Solicitudes", "inbox"),
    "mantenimientos": ("Gestión de Activos · Mantenimientos", "tools"),
    "alertas": ("Alertas", "exclamation-triangle"),
    "matriz": ("Matriz de obligaciones", "journal-check"),
    "soporte": ("Mesa de ayuda", "headset"),
    "ordenes": ("Mantenimiento de sedes", "buildings"),
    "dashboards": ("Dashboards", "bar-chart-line"),
}

SISTEMA = ("Sistema", "bell")


def modulo_de(tipo: str) -> str:
    """El módulo de una clave: lo que va antes del primer punto."""
    return (tipo or "").split(".", 1)[0]


def describir(modulo: str) -> tuple[str, str]:
    """Nombre e ícono del módulo."""
    return MODULOS.get(modulo, SISTEMA)
