from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import HasModulePermission


class OrganizacionPermission(HasModulePermission):
    view_permission = "organizacion.ver"
    write_permission = "organizacion.editar"


class InstitucionalPermission(HasModulePermission):
    """El organigrama (módulo Institucional): verlo y armarlo."""

    view_permission = "institucional.ver"
    write_permission = "institucional.editar"


class AsignarCargosPermission(HasModulePermission):
    """Poner a una persona en un cargo del organigrama."""

    view_permission = "institucional.asignar"
    write_permission = "institucional.asignar"


class ArmarOAsignarPermission(BasePermission):
    """Descargar la plantilla o el organigrama completo (con nombres y
    correos): quien arma la estructura o asigna cargos."""

    def has_permission(self, request, view) -> bool:
        return any(
            user_has_permission(request.user, f"institucional.{p}") for p in ("editar", "asignar")
        )


class VerOrganigramaPermission(BasePermission):
    """Leer el organigrama: quien lo ve, lo arma o asigna cargos (la pestaña de
    asignación lo necesita para listar los cargos y sus vacantes)."""

    def has_permission(self, request, view) -> bool:
        return any(
            user_has_permission(request.user, f"institucional.{p}")
            for p in ("ver", "ver_area", "editar", "asignar", "perfil_cargo")
        )


class PerfilCargoPermission(BasePermission):
    """Leer el perfil de un cargo: quien ve el organigrama; escribirlo:
    `institucional.perfil_cargo`."""

    def has_permission(self, request, view) -> bool:
        if request.method in SAFE_METHODS:
            return VerOrganigramaPermission().has_permission(request, view)
        return user_has_permission(request.user, "institucional.perfil_cargo")


class DocumentosPermission(HasModulePermission):
    """Leer los códigos y reglamentos es de toda persona con sesión;
    publicarlos, editarlos, retirarlos o borrarlos pide `codigos.publicar`."""

    view_permission = None
    write_permission = "codigos.publicar"


class AcuerdoPermission(HasModulePermission):
    """Ver el acuerdo de confidencialidad es de todos (se acepta antes de
    leer); cambiar su título y texto pide `codigos.acuerdo`."""

    view_permission = None
    write_permission = "codigos.acuerdo"


class AceptacionesPermission(HasModulePermission):
    """Ver quién aceptó el acuerdo y cuándo pide `codigos.ver_aceptaciones`."""

    view_permission = "codigos.ver_aceptaciones"
    write_permission = "codigos.ver_aceptaciones"


class NoticiasPermission(HasModulePermission):
    """Ver el carrusel de Inicio es de todos; publicar, borrar y ajustar su
    velocidad pide `noticias.gestionar`."""

    view_permission = None
    write_permission = "noticias.gestionar"


class CalendarioPermission(HasModulePermission):
    """Ver el calendario de Inicio es de todos; agregar, editar y borrar sus
    fechas pide `calendario.gestionar`."""

    view_permission = None
    write_permission = "calendario.gestionar"


class AvisoInicioPermission(HasModulePermission):
    """Ver el aviso al iniciar sesión es de todos (se muestra al entrar);
    cambiarlo pide `configuracion.aviso_inicio`."""

    view_permission = None
    write_permission = "configuracion.aviso_inicio"


class VacacionesDeTodosPermission(HasModulePermission):
    """Consultar las vacaciones de otras personas pide
    `vacaciones.ver_todas`."""

    view_permission = "vacaciones.ver_todas"
    write_permission = "vacaciones.ver_todas"


class HerramientasPermission(BasePermission):
    """El catálogo de herramientas: leerlo es de toda persona con sesión (lo
    necesita «Mis herramientas»); cambiarlo pide `herramientas.gestionar`."""

    def has_permission(self, request, view) -> bool:
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return user_has_permission(request.user, "herramientas.gestionar")


class GestionarHerramientasPermission(BasePermission):
    def has_permission(self, request, view) -> bool:
        return user_has_permission(request.user, "herramientas.gestionar")
