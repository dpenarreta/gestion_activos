"""Las reglas de una solicitud: quién puede moverla y a dónde.

Viven aquí y no en el serializer porque no son de la forma del formulario sino
del negocio: que el solicitante pueda cancelar lo suyo y no aprobarlo, que una
solicitud entregada ya no se mueva, y que cada paso deje dicho quién lo dio.
La vista solo traduce a HTTP lo que esto decide.
"""

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction

from apps.permissions.authorization import user_has_permission

from .models import MovimientoSolicitud, Solicitud


def administra(actor) -> bool:
    """Quien administra compras ve y mueve las de todos."""
    return user_has_permission(actor, "solicitudes.administrar")


def puede_gestionarla(actor, solicitud: Solicitud) -> bool:
    """El encargado de esta solicitud, o quien administra compras.

    El permiso de gestionar no alcanza por sí solo: tenerlo habilita a mover
    **las propias**, no las de los demás. Sin esa distinción, «Solicitudes
    recibidas» sería una bandeja donde cualquiera cierra el pedido de otro.
    """
    if administra(actor):
        return True
    return solicitud.encargado_id == actor.id and user_has_permission(
        actor, "solicitudes.gestionar"
    )


class SolicitudService:
    """Alta y recorrido de una solicitud."""

    @staticmethod
    @transaction.atomic
    def crear(*, actor, **datos) -> Solicitud:
        """Registra la petición y deja escrito que nació.

        El primer movimiento no es decorativo: sin él, una solicitud rechazada
        el mismo día no tendría cuándo se pidió, y la fecha de creación de la
        fila no dice quién la puso ahí.
        """
        solicitud = Solicitud(solicitante=actor, **datos)
        solicitud.full_clean(exclude=["empresa"])
        solicitud.save()
        MovimientoSolicitud.objects.create(
            solicitud=solicitud,
            estado_anterior="",
            estado_nuevo=solicitud.estado,
            actor=actor,
            nota="Solicitud registrada.",
        )
        return solicitud

    @staticmethod
    @transaction.atomic
    def cambiar_estado(*, solicitud: Solicitud, actor, estado: str, nota: str = "") -> Solicitud:
        """Mueve la solicitud, si quien lo pide puede y el paso existe.

        Los tres motivos de rechazo se distinguen a propósito —no puede, no se
        puede, falta el motivo—: un «no permitido» genérico obliga a adivinar
        cuál de los tres era.
        """
        if estado not in Solicitud.Estado.values:
            raise ValidationError({"estado": f"«{estado}» no es un estado de solicitud."})

        if estado == Solicitud.Estado.CANCELADA:
            # Cancelar lo propio no es gestionar: quien pidió algo que ya no
            # hace falta debe poder retirarlo sin pedirle permiso a nadie, y
            # dejarlo abierto le hace perder el tiempo a quien compra.
            if solicitud.solicitante_id != actor.id and not administra(actor):
                raise PermissionDenied(
                    "Una solicitud la cancela quien la pidió, o quien administra compras."
                )
        elif not puede_gestionarla(actor, solicitud):
            raise PermissionDenied(
                "Esta solicitud la gestiona quien la tiene asignada, o quien administra compras."
            )

        if not solicitud.puede_pasar_a(estado):
            actual = solicitud.get_estado_display()
            destino = Solicitud.Estado(estado).label
            if solicitud.esta_cerrada:
                raise ValidationError(
                    {
                        "estado": (
                            f"La solicitud ya está {actual.lower()}: su recorrido terminó y "
                            "no se reabre. Si hace falta otra vez, se pide de nuevo."
                        )
                    }
                )
            raise ValidationError(
                {"estado": f"Una solicitud {actual.lower()} no puede pasar a {destino.lower()}."}
            )

        nota = (nota or "").strip()
        if estado == Solicitud.Estado.RECHAZADA and not nota:
            raise ValidationError(
                {
                    "nota": (
                        "Un rechazo lleva motivo: es lo único que le llega a quien "
                        "pidió como explicación de por qué no."
                    )
                }
            )

        anterior = solicitud.estado
        solicitud.estado = estado
        solicitud.save(update_fields=["estado", "updated_at"])
        MovimientoSolicitud.objects.create(
            solicitud=solicitud,
            estado_anterior=anterior,
            estado_nuevo=estado,
            actor=actor,
            nota=nota,
        )
        return solicitud
