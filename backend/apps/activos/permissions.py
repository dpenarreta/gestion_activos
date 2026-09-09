from rest_framework.permissions import SAFE_METHODS

from apps.permissions.permissions import HasActionPermission, HasModulePermission


class ActivosPermission(HasActionPermission):
    """El inventario separa alta, edición, asignación y baja en permisos
    distintos: quien registra equipos en bodega no es necesariamente quien
    puede darlos de baja, y dar de baja es la acción con consecuencia
    contable."""

    PERMISO_POR_ACCION = {
        # Ver los equipos propios es un permiso aparte de ver el inventario: es
        # justo lo que separa al «usuario final» del §13 de todos los demás
        # roles. Con `activos.ver` a secas vería el parque entero, que es lo
        # contrario de lo que el documento le concede.
        "mis_equipos": "activos.ver_asignados",
        "create": "activos.crear",
        "update": "activos.editar",
        "partial_update": "activos.editar",
        "asignar": "activos.asignar",
        "cambiar_estado": "activos.dar_baja",
    }

    def get_required_permission(self, request, view) -> str | None:
        accion = getattr(view, "action", None)
        if accion in self.PERMISO_POR_ACCION and request.method in SAFE_METHODS:
            return self.PERMISO_POR_ACCION[accion]
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


class ColumnasPlantillaPermission(HasModulePermission):
    """Configurar la plantilla de carga es administrar el módulo, no capturar
    datos: quien carga inventario no debería poder cambiar qué se le exige al
    resto."""

    view_permission = "activos.ver"
    write_permission = "activos.editar"


class ExportacionActivosPermission(HasActionPermission):
    """Exportar va aparte de ver, siguiendo el criterio ya establecido para la
    auditoría (`auditoria.exportar`): quien consulta el inventario en pantalla
    no necesariamente debe poder sacarlo completo en un archivo que sale del
    sistema."""

    def get_required_permission(self, request, view) -> str:
        return "activos.exportar"
