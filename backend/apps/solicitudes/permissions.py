from rest_framework.permissions import SAFE_METHODS

from apps.permissions.permissions import HasActionPermission


class SolicitudesPermission(HasActionPermission):
    """Pedir y gestionar son cosas distintas, y a propósito.

    Cualquiera que trabaje con equipos debería poder pedir uno; decidir si se
    compra es otro oficio. Por eso `solicitudes.crear` no habilita a mover el
    estado de nada, y `solicitudes.gestionar` no habilita a mover lo ajeno —eso
    lo comprueba el servicio, que es quien sabe de quién es cada solicitud—.

    El cambio de estado se deja en `solicitudes.ver` a propósito: cancelar lo
    propio tiene que poder hacerlo quien pidió, que no gestiona nada. Quién
    puede qué paso lo decide `SolicitudService.cambiar_estado`, con la
    solicitud delante.
    """

    def get_required_permission(self, request, view) -> str:
        if request.method in SAFE_METHODS:
            return "solicitudes.ver"
        accion = getattr(view, "action", None)
        if accion == "create":
            return "solicitudes.crear"
        if accion == "cambiar_estado":
            return "solicitudes.ver"
        # Corregir lo que se pidió es del solicitante mientras nadie la haya
        # tomado; el serializer se encarga de que no sea de otro ni tarde.
        return "solicitudes.crear"
