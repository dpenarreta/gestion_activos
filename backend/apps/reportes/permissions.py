"""Permisos de los reportes (§16).

Ver un reporte en pantalla y llevárselo en un archivo no son la misma acción,
aunque las dos sean un `GET`: el archivo sale del sistema y circula por correo
sin los permisos que protegen la pantalla. Por eso el permiso no depende del
método HTTP —como en el resto de módulos— sino del formato pedido.
"""

from apps.permissions.permissions import HasActionPermission

FORMATOS_DE_ARCHIVO = {"xlsx", "csv", "pdf"}


class ReportesPermission(HasActionPermission):
    def get_required_permission(self, request, view) -> str | None:
        formato = request.query_params.get("formato", "json")
        return "reportes.exportar" if formato in FORMATOS_DE_ARCHIVO else "reportes.ver"
