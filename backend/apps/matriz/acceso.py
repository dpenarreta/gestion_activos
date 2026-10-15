"""Quién puede qué en la Matriz, empresa por empresa (§8).

Los permisos `matriz.*` salen del rol de la **membresía** en cada empresa; el
superusuario los tiene todos en todas (ver
`apps.permissions.authorization.SOLO_POR_EMPRESA`).

Dos respuestas distintas, a propósito (§8.4, §8.5):

- **404** si la persona no tiene ningún rol de la Matriz en la empresa activa, o
  si pide un período que no puede ver: no se le confirma que exista.
- **403** si lo ve pero le falta la capacidad para lo que intenta, y queda en la
  auditoría como `access_denied`.
"""

from django.contrib.auth.models import Permission
from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.core.request_meta import get_request_context
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.permissions.authorization import get_user_permission_codenames
from apps.permissions.catalog import PERMISSION_CATALOG

TODAS_LAS_CAPACIDADES = sorted(PERMISSION_CATALOG["matriz"]["permissions"])

#: Las que, sin `ver_todas`, solo se ejercen sobre los períodos propios (§6.1).
ACOTADAS_AL_PERIODO = {
    "matriz.editar",
    "matriz.cambiar_fecha",
    "matriz.cargar",
    "matriz.enviar",
    "matriz.validar",
    "matriz.recordar",
}

MENSAJES = {
    "matriz.crear": "No tiene permiso para crear obligaciones.",
    "matriz.editar": "No tiene permiso para editar este período.",
    "matriz.cambiar_fecha": "No tiene permiso para cambiar la fecha de vencimiento.",
    "matriz.cargar": "No tiene permiso para cargar evidencias en este período.",
    "matriz.enviar": "No tiene permiso para enviar este período a validación.",
    "matriz.validar": "No tiene permiso para validar este período.",
    "matriz.recordar": "No tiene permiso para enviar recordatorios de este período.",
    "matriz.configurar": "No tiene permiso para configurar los recordatorios de la empresa.",
    "matriz.ver_auditoria": "No tiene permiso para ver las notificaciones de la empresa.",
}


def capacidades_en(usuario, empresa) -> list[str]:
    """Los permisos `matriz.*` de la cuenta en una empresa concreta (no solo la
    activa): lo que necesita el selector para decir con qué rol se entraría."""
    if usuario.is_superuser:
        return list(TODAS_LAS_CAPACIDADES)
    if not empresa.activa:
        # Una empresa inactiva no da acceso a nadie (§8.3).
        return []
    return sorted(
        set(
            Permission.objects.filter(
                codename__startswith="matriz.",
                group__membresias__usuario=usuario,
                group__membresias__empresa=empresa,
            ).values_list("codename", flat=True)
        )
    )


def empresa_de_la_matriz(request):
    """La empresa activa y las capacidades en ella; 404 si no hay ninguna.

    Sin un rol de la Matriz en la empresa activa, la persona no tiene nada que
    ver aquí, y responder 404 —no 403— no le confirma que haya algo (§8.4).
    """
    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA or not empresa.activa:
        raise NotFound()
    capacidades = {
        c for c in get_user_permission_codenames(request.user) if c.startswith("matriz.")
    }
    if not capacidades:
        raise NotFound()
    return empresa, capacidades


def es_mio(periodo, usuario) -> bool:
    """«Es mío»: soy el responsable o el suplente del período (§2.3)."""
    return usuario.pk in (periodo.responsable_id, periodo.suplente_id)


def visibles(consulta, usuario, capacidades):
    """Sin `ver_todas`, solo los períodos propios (§8.6)."""
    if "matriz.ver_todas" in capacidades:
        return consulta
    return consulta.filter(Q(responsable=usuario) | Q(suplente=usuario))


def puede(capacidad, periodo, usuario, capacidades) -> bool:
    """Si la capacidad alcanza a este período: acotada y sin `ver_todas`, solo
    si es suyo."""
    if capacidad not in capacidades:
        return False
    if (
        capacidad in ACOTADAS_AL_PERIODO
        and "matriz.ver_todas" not in capacidades
        and periodo is not None
    ):
        return es_mio(periodo, usuario)
    return True


def exigir(request, capacidad, capacidades, periodo=None):
    """403 con el mensaje de la acción, registrado en la auditoría (§8.5)."""
    if puede(capacidad, periodo, request.user, capacidades):
        return
    record_audit_event(
        actor=request.user,
        action="access_denied",
        target=periodo,
        module="matriz",
        new_values={
            "required_permission": capacidad,
            "method": request.method,
            "path": request.path,
        },
        result=AuditLog.Result.FAILURE,
        context=get_request_context(request),
    )
    raise PermissionDenied(MENSAJES.get(capacidad, f"No tiene el permiso requerido: {capacidad}."))


def acciones(periodo, usuario, capacidades) -> list[str]:
    """Las acciones que el detalle ofrece, calculadas en el servidor (§8.10).

    El frontend dibuja solo estas: un botón que termina en un 403 hace parecer
    roto el sistema. La separación de funciones no se mira aquí sino al
    validar, para que el botón no desaparezca sin explicación: si toca, el
    servidor responde con el motivo.
    """
    if periodo.cerrado:
        return []
    pendiente = periodo.etapa == "pendiente_validacion"

    def tiene(capacidad):
        return puede(capacidad, periodo, usuario, capacidades)

    candidatas = [
        ("edit", tiene("matriz.editar")),
        ("change_due_date", tiene("matriz.cambiar_fecha")),
        ("upload", tiene("matriz.cargar")),
        ("submit", not pendiente and tiene("matriz.enviar")),
        ("validate", pendiente and tiene("matriz.validar")),
        ("return", pendiente and tiene("matriz.validar")),
        ("reject_document", tiene("matriz.validar")),
        ("remind", not periodo.recordatorios_suspendidos and tiene("matriz.recordar")),
    ]
    return [accion for accion, permitida in candidatas if permitida]
