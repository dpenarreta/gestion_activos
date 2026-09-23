"""A quién se le puede asignar una solicitud.

El desplegable de «encargado» no es la lista de usuarios del sistema: es la de
quienes pueden atender una compra en **esta** empresa. Ofrecer a todos dejaría
mandar solicitudes a un buzón que nadie abre —quien no tiene el permiso no ve
«Solicitudes recibidas»—, y el solicitante se quedaría esperando sin saber que
su petición no le llegó a nadie.
"""

from django.contrib.auth import get_user_model
from django.db.models import Q

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

User = get_user_model()

#: Quien puede gestionar una solicitud asignada, y quien además administra las
#: de todos. Los dos sirven como encargado.
PERMISOS_DE_GESTION = ("solicitudes.gestionar", "solicitudes.administrar")


def encargados_posibles():
    """Usuarios activos que pueden atender una solicitud en la empresa activa.

    Los permisos llegan por tres caminos y los tres cuentan: el rol que se
    ejerce en esta empresa, el rol global de quien administra el grupo y la
    asignación directa. Mirar solo uno dejaría fuera justamente a quien
    administra compras para todas las empresas.
    """
    empresa = empresa_actual()
    candidatos = (
        Q(groups__permissions__codename__in=PERMISOS_DE_GESTION)
        | Q(user_permissions__codename__in=PERMISOS_DE_GESTION)
        | Q(is_superuser=True)
    )
    if empresa is not None and empresa is not SIN_EMPRESA:
        candidatos |= Q(
            membresias__empresa=empresa,
            membresias__roles__permissions__codename__in=PERMISOS_DE_GESTION,
        )

    queryset = User.objects.filter(is_active=True).filter(candidatos)
    if empresa is not None and empresa is not SIN_EMPRESA:
        # Y que además trabaje aquí: un permiso global no da acceso a los datos
        # de una empresa en la que la cuenta no tiene membresía, así que
        # asignarle algo de ella sería mandarlo a donde no puede entrar.
        queryset = queryset.filter(membresias__empresa=empresa)

    return queryset.distinct().order_by("first_name", "last_name", "username")
