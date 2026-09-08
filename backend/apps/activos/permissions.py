from rest_framework.permissions import SAFE_METHODS

from apps.permissions.permissions import HasActionPermission, HasModulePermission


class ActivosPermission(HasActionPermission):
    """El inventario separa alta, edición, asignación y baja en permisos
    distintos: quien registra equipos en bodega no es necesariamente quien
    puede darlos de baja, y dar de baja es la acción con consecuencia
    contable."""

    PERMISO_POR_ACCION = {
        "create": "activos.crear",
        "update": "activos.editar",
        "partial_update": "activos.editar",
        "asignar": "activos.asignar",
        "cambiar_estado": "activos.dar_baja",
    }

    def get_required_permission(self, request, view) -> str | None:
        if request.method in SAFE_METHODS:
            return "activos.ver"
        return self.PERMISO_POR_ACCION.get(getattr(view, "action", None), "activos.editar")


class TiposDispositivoPermission(HasModulePermission):
    view_permission = "activos.ver"
    write_permission = "activos.editar"


class EtiquetasPermission(HasActionPermission):
    """La impresión de etiquetas es una acción propia (RF-08): consume
    consumibles físicos y se delega a personal de bodega que no
    necesariamente puede editar fichas."""

    def get_required_permission(self, request, view) -> str:
        return "activos.imprimir_etiqueta"


class ImportacionPermission(HasActionPermission):
    """La carga masiva exige el mismo permiso que registrar un activo: es la
    misma acción a otra escala, y separarla llevaría a que alguien con
    `activos.crear` tuviera que pedir un permiso extra para hacer con 200
    equipos lo que ya puede hacer 200 veces de a uno."""

    def get_required_permission(self, request, view) -> str:
        return "activos.crear"
