from apps.permissions.permissions import HasModulePermission


class AlertasPermission(HasModulePermission):
    view_permission = "alertas.ver"
    write_permission = "notificaciones.configurar"


class ConfiguracionAlertasPermission(HasModulePermission):
    """Exige `notificaciones.configurar` incluso para leer.

    Lo usan los endpoints que sirven la lista de posibles destinatarios: son
    nombres y correos de personas, y quien solo puede mirar el estado del
    parque no tiene por qué recibir el directorio de quién recibe los avisos.
    """

    view_permission = "notificaciones.configurar"
    write_permission = "notificaciones.configurar"
