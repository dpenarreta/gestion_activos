from rest_framework.permissions import SAFE_METHODS

from apps.permissions.permissions import HasActionPermission


class AdjuntosPermission(HasActionPermission):
    """Ver, subir y eliminar son tres decisiones distintas.

    Eliminar tiene permiso propio porque un adjunto es evidencia: la factura
    de compra o el acta firmada de un equipo no deberían poder desaparecer
    con el mismo permiso con el que se sube una foto.
    """

    def get_required_permission(self, request, view) -> str:
        if request.method in SAFE_METHODS:
            return "adjuntos.ver"
        if request.method == "DELETE":
            return "adjuntos.eliminar"
        return "adjuntos.subir"
