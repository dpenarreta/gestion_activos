"""Permisos del editor visual de dashboards (sección 6 del prompt de personalización).

Desde la Fase 5 de la integración con skelleton_base (docs/integracion/decisions.md #6),
`permisos_del_usuario` resuelve siempre permisos reales contra `request.user` — se retiró el
fallback histórico que concedía todo sin autenticación, ahora que el dashboard exige
`IsAuthenticated` (`REST_FRAMEWORK.DEFAULT_PERMISSION_CLASSES`) y el frontend ya tiene pantalla de
login. Sin usuario autenticado, todos los permisos son `False` (fallo cerrado, no abierto).
"""

from apps.permissions.authorization import user_has_permission

from .models import Dashboard

DASHBOARD_CREAR = 'dashboard.crear'
DASHBOARD_EDITAR = 'dashboard.editar'
DASHBOARD_ELIMINAR = 'dashboard.eliminar'
DASHBOARD_VIEW = 'dashboard.view'
DASHBOARD_EDIT = 'dashboard.edit'
DASHBOARD_LAYOUT_EDIT = 'dashboard.layout.edit'
DASHBOARD_COMPONENT_STYLE = 'dashboard.component.style'
DASHBOARD_COMPONENT_CREATE = 'dashboard.component.create'
DASHBOARD_COMPONENT_DELETE = 'dashboard.component.delete'
DASHBOARD_CONFIGURATION_RESET = 'dashboard.configuration.reset'
DASHBOARD_INTERPRETAR = 'dashboard.interpretar'
DASHBOARD_HALLAZGOS_IA = 'dashboard.hallazgos_ia'
DASHBOARD_FUENTE_BD_CONFIGURAR = 'dashboard.fuente_bd.configurar'
DASHBOARD_FUENTE_BD_ACTUALIZAR = 'dashboard.fuente_bd.actualizar'
DASHBOARD_ARCHIVO_CARGAR = 'dashboard.archivo.cargar'
# Mutar los datos YA cargados (procesar, reprocesar, borrar la carga, reaplicar el mapeo,
# incluir/excluir del histórico). Separado de `DASHBOARD_VIEW`: esas acciones caían antes al
# genérico "quien puede ver, puede mutar", así que en un dashboard sin ACL propia bastaba
# `dashboard.view` para borrar la carga entera.
DASHBOARD_DATOS_EDITAR = 'dashboard.datos.editar'

TODOS_LOS_PERMISOS = [
    DASHBOARD_CREAR,
    DASHBOARD_EDITAR,
    DASHBOARD_ELIMINAR,
    DASHBOARD_VIEW,
    DASHBOARD_EDIT,
    DASHBOARD_LAYOUT_EDIT,
    DASHBOARD_COMPONENT_STYLE,
    DASHBOARD_COMPONENT_CREATE,
    DASHBOARD_COMPONENT_DELETE,
    DASHBOARD_CONFIGURATION_RESET,
    DASHBOARD_INTERPRETAR,
    DASHBOARD_HALLAZGOS_IA,
    DASHBOARD_FUENTE_BD_CONFIGURAR,
    DASHBOARD_FUENTE_BD_ACTUALIZAR,
    DASHBOARD_ARCHIVO_CARGAR,
    DASHBOARD_DATOS_EDITAR,
]


def permisos_del_usuario(request):
    """Devuelve un dict {permiso: bool} para que el código llamador siga preguntando por permiso
    específico (`permisos_del_usuario(request)[DASHBOARD_EDIT]`) en vez de asumir un booleano
    global. Se resuelve siempre contra `request.user` (ver docstring del módulo).
    """
    usuario = getattr(request, 'user', None)
    return {permiso: user_has_permission(usuario, permiso) for permiso in TODOS_LOS_PERMISOS}


def tiene_permiso(request, permiso):
    return permisos_del_usuario(request).get(permiso, False)


def _dashboard_o_none(dashboard_id):
    try:
        return Dashboard.objects.prefetch_related('roles_editores', 'roles_lectores').get(
            dashboard_id=dashboard_id,
        )
    except Dashboard.DoesNotExist:
        return None


def _resolver_dashboard(dashboard_id, dashboard=None):
    """Devuelve el `Dashboard` a evaluar, sin volver a consultarlo si el llamador ya lo tiene.

    `dashboard_registry.dashboards_autorizados` itera sobre dashboards ya cargados y llamaba a
    `tiene_acceso_dashboard` + `puede_administrar_acceso` por cada uno: dos `SELECT` por dashboard
    para traer un objeto que estaba a mano, más los `exists()` de la ACL. Con el objeto pasado por
    parámetro, el listado completo baja a una consulta por los dashboards y una por cada relación
    prefetcheada.
    """
    if dashboard is not None:
        return dashboard
    return _dashboard_o_none(dashboard_id)


def _acl_configurada(dashboard):
    # `all()` y no `exists()`: con `prefetch_related` ya están en memoria, así que evaluar la
    # lista no consulta la base — `exists()` en cambio siempre emite un SELECT y desperdicia el
    # prefetch.
    return bool(dashboard.roles_editores.all() or dashboard.roles_lectores.all())


def _es_dueno_o_superusuario(request, dashboard):
    usuario = getattr(request, 'user', None)
    if not usuario or not usuario.is_authenticated:
        return False
    return bool(usuario.is_superuser or (dashboard.owner_id and dashboard.owner_id == usuario.id))


def tiene_acceso_dashboard(request, dashboard_id, *, permiso_global, requiere_edicion=False, dashboard=None):
    """Punto único de autorización por dashboard (control de acceso por roles editores/lectores +
    dueño). Si el dashboard no existe o no tiene ACL propia configurada (sin roles asignados a
    ninguno de los 2 grupos — el caso de todo dashboard hoy y por defecto), se comporta exactamente
    igual que siempre: `tiene_permiso(request, permiso_global)`. En cuanto se le asignan roles a
    cualquiera de los 2 grupos, ese dashboard queda restringido a su dueño, al superusuario, o a
    quien tenga uno de esos roles — `roles_editores` alcanza para ver Y editar; `roles_lectores`
    solo para ver.

    `dashboard`: instancia ya cargada, para no volver a consultarla (ver `_resolver_dashboard`)."""
    dashboard = _resolver_dashboard(dashboard_id, dashboard)
    if dashboard is None:
        # Integración multiempresa: el gestor de `Dashboard` filtra por la
        # empresa activa, así que aquí "no existe" puede querer decir "es de
        # otra empresa", y eso no da acceso a nada. Si no existe en ninguna,
        # se conserva el comportamiento del origen (el permiso global).
        if Dashboard.objects.todas().filter(dashboard_id=dashboard_id).exists():
            return False
        return tiene_permiso(request, permiso_global)
    if not _acl_configurada(dashboard):
        return tiene_permiso(request, permiso_global)

    if _es_dueno_o_superusuario(request, dashboard):
        return True

    usuario = getattr(request, 'user', None)
    if not usuario or not usuario.is_authenticated:
        return False

    # Los ids salen del prefetch (en memoria) y la pertenencia se compara contra los grupos del
    # usuario, que Django ya cachea por instancia — antes esto armaba un queryset combinado con
    # una subconsulta y emitía un SELECT por cada dashboard evaluado.
    ids_permitidos = {rol.pk for rol in dashboard.roles_editores.all()}
    if not requiere_edicion:
        ids_permitidos |= {rol.pk for rol in dashboard.roles_lectores.all()}
    return bool(ids_permitidos & _ids_de_roles(usuario, dashboard))


def _ids_de_roles(usuario, dashboard):
    """Los roles de la persona que cuentan para este dashboard: los generales y
    los de su membresía en la empresa del dashboard (en este sistema los roles
    también se asignan por empresa; en el de origen solo eran globales)."""
    from apps.empresas.models import MembresiaEmpresa

    ids = {grupo.pk for grupo in usuario.groups.all()}
    if dashboard.empresa_id:
        ids |= set(
            MembresiaEmpresa.objects.filter(
                usuario=usuario, empresa_id=dashboard.empresa_id
            ).values_list("roles", flat=True)
        )
    ids.discard(None)
    return ids


def registrar_acceso_denegado(request, dashboard_id, permiso):
    """Escribe un `ACCESS_DENIED` cuando se rechaza el acceso a un dashboard.

    `apps.permissions.permissions.HasModulePermission` ya audita los rechazos de los endpoints
    administrativos, pero los de `cartera` se resolvían con un `Response(..., 403)` inline y no
    escribían nada. Es decir que los intentos contra los dashboards protegidos por ACL —
    justamente los que alguien configuró para restringir — eran los únicos invisibles en la
    auditoría, y un sondeo sistemático de dashboards ajenos no aparecía en ninguna pantalla.

    Se centraliza acá para que los ~30 puntos de rechazo de `views.py` y `dashboard_views.py`
    queden cubiertos sin repetir la llamada en cada uno. Como todo `log_event`, nunca lanza.
    """
    from apps.cartera.compat import AuditEvent
    from apps.cartera.compat import log_event

    usuario = getattr(request, 'user', None)
    log_event(
        domain=AuditEvent.Domain.SECURITY,
        action='ACCESS_DENIED',
        result=AuditEvent.Result.DENIED,
        actor=usuario if (usuario and getattr(usuario, 'is_authenticated', False)) else None,
        entity_type='dashboard',
        entity_id=dashboard_id or '',
        dashboard_id=dashboard_id or '',
        metadata={
            'required_permission': permiso,
            'method': getattr(request, 'method', ''),
            'path': getattr(request, 'path', ''),
        },
        request=request,
    )


def puede_administrar_acceso(request, dashboard_id, dashboard=None):
    """Editar la configuración de acceso de un dashboard (sus 2 grupos de roles) o reasignar su
    dueño está reservado al dueño actual o al superusuario — a propósito no cae a ningún permiso
    global del catálogo, ni siquiera `dashboard.editar`.

    `dashboard`: instancia ya cargada, para no volver a consultarla (ver `_resolver_dashboard`)."""
    dashboard = _resolver_dashboard(dashboard_id, dashboard)
    if dashboard is None:
        return False
    return _es_dueno_o_superusuario(request, dashboard)
