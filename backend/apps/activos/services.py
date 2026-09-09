"""Lógica de negocio del inventario de activos (RF-01, RF-02).

Toda alta, edición, asignación y baja pasa por aquí: las vistas no tocan el
ORM ni escriben en auditoría por su cuenta. Cada operación que cambia
custodio, área o estado deja además un `MovimientoActivo`, que es lo que
alimenta el historial exigido por RF-03.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from apps.core.audit import record_audit_event

from .barcode import generar_codigo_barras
from .models import ESTADOS_ASIGNABLES, ESTADOS_FUERA_DE_INVENTARIO, Activo, MovimientoActivo

MODULO = "activos"

#: Distingue «no toques la ubicación» de «déjala vacía». Sin él, una
#: reasignación normal borraría en silencio dónde está el equipo.
SIN_CAMBIO = object()
MAX_REINTENTOS_CODIGO = 5


class ActivoService:
    @staticmethod
    def _registrar_movimiento(*, activo, tipo, actor, motivo="", **cambios) -> MovimientoActivo:
        return MovimientoActivo.objects.create(
            activo=activo,
            tipo=tipo,
            registrado_por=actor,
            motivo=motivo,
            **cambios,
        )

    @staticmethod
    def crear_activo(*, actor, context: dict | None = None, **datos) -> Activo:
        """Da de alta un activo y le emite su código de barras (RF-02).

        El código se calcula leyendo el último correlativo del tipo, lo que no
        es atómico: dos altas simultáneas del mismo tipo pueden calcular el
        mismo número. En vez de serializar las altas con un bloqueo de tabla
        —que penalizaría el caso normal para proteger uno raro— se deja que la
        restricción única de la base detecte la colisión y se reintenta.
        """
        tipo = datos["tipo"]
        ultimo_error = None

        for _ in range(MAX_REINTENTOS_CODIGO):
            try:
                with transaction.atomic():
                    activo = Activo.objects.create(
                        codigo_barras=generar_codigo_barras(tipo.codigo), **datos
                    )
                break
            except IntegrityError as exc:
                # Solo reintentar si chocó el código de barras: un número de
                # serie duplicado es un error del usuario, no una carrera, y
                # reintentarlo cinco veces solo retrasaría el mensaje.
                if "codigo_barras" not in str(exc).lower():
                    raise
                ultimo_error = exc
        else:
            raise ultimo_error

        ActivoService._registrar_movimiento(
            activo=activo,
            tipo=MovimientoActivo.Tipo.ALTA,
            actor=actor,
            custodio_nuevo=activo.custodio,
            departamento_nuevo=activo.departamento,
            estado_nuevo=activo.estado,
        )
        record_audit_event(
            actor=actor,
            action="activo.created",
            target=activo,
            module=MODULO,
            new_values={
                "codigo_barras": activo.codigo_barras,
                "nombre": activo.nombre,
                "numero_serie": activo.numero_serie,
                "tipo": tipo.nombre,
                "departamento_id": activo.departamento_id,
                "custodio_id": activo.custodio_id,
            },
            context=context,
        )
        return activo

    @staticmethod
    def actualizar_activo(*, actor, activo: Activo, context: dict | None = None, **datos) -> Activo:
        """Edita la ficha técnica. Los cambios de custodio, área y estado no
        se hacen por aquí sino con `asignar_custodio` / `cambiar_estado`, que
        además dejan el movimiento correspondiente."""
        anteriores, nuevos = {}, {}
        for campo, valor in datos.items():
            actual = getattr(activo, campo)
            if actual != valor:
                anteriores[campo] = str(actual) if actual is not None else None
                nuevos[campo] = str(valor) if valor is not None else None
                setattr(activo, campo, valor)

        if not nuevos:
            return activo

        activo.save()
        record_audit_event(
            actor=actor,
            action="activo.updated",
            target=activo,
            module=MODULO,
            previous_values=anteriores,
            new_values=nuevos,
            context=context,
        )
        return activo

    @staticmethod
    @transaction.atomic
    def asignar_custodio(
        *,
        actor,
        activo: Activo,
        custodio=None,
        departamento=None,
        ubicacion=SIN_CAMBIO,
        motivo="",
        context=None,
    ) -> Activo:
        """Cambia el responsable, el área y/o la ubicación, con la traza de RF-03.

        `custodio=None` es una devolución a bodega, no "sin cambios": el
        llamador que no quiere tocar el custodio simplemente no invoca este
        método.

        `ubicacion`, en cambio, sí distingue las dos cosas con un centinela:
        un traslado puede querer **quitar** la ubicación (`None`) y una
        reasignación normal no debe tocarla. Con un solo valor para ambos
        casos, cada entrega de equipo borraría en silencio dónde está.
        """
        if not activo.esta_operativo:
            # Antes esto se colaba: el método no tocaba el estado de un equipo
            # dado de baja, pero sí le cambiaba el custodio, y quedaba un
            # responsable nuevo para un equipo que ya no existe. Con «perdido»
            # y «robado» el absurdo es más visible: nadie recibe un equipo
            # robado.
            raise serializers.ValidationError(
                {
                    "estado": (
                        f"El activo está {activo.get_estado_display().lower()}: no se puede "
                        "asignar ni trasladar. Reingréselo al inventario primero."
                    )
                }
            )

        custodio_anterior = activo.custodio
        departamento_anterior = activo.departamento
        ubicacion_anterior = activo.ubicacion
        estado_anterior = activo.estado

        activo.custodio = custodio
        if departamento is not None:
            activo.departamento = departamento
        if ubicacion is not SIN_CAMBIO:
            activo.ubicacion = ubicacion

        # Un equipo con responsable está en uso; sin responsable, vuelve a
        # bodega. No se toca el estado si está en mantenimiento, en garantía o
        # en tránsito: esos describen dónde está el equipo, y eso manda sobre
        # quién responde por él.
        if activo.estado in ESTADOS_ASIGNABLES:
            # La devolución deja el equipo «en bodega», no «disponible»: antes
            # de volver a entregarlo hay que revisarlo y formatearlo, y
            # marcarlo entregable de inmediato haría prometer equipos que
            # todavía no lo están.
            activo.estado = Activo.Estado.EN_USO if custodio else Activo.Estado.EN_BODEGA

        activo.save(update_fields=["custodio", "departamento", "ubicacion", "estado", "updated_at"])

        # El tipo lo decide el cambio que se ve desde fuera. Un traslado libera
        # al responsable —el equipo pasa a una bodega, y una bodega no responde
        # por nada—, pero eso no lo convierte en una devolucion: lo que hay que
        # poder rastrear despues es donde acabo el equipo, no que alguien lo
        # soltara. La devolucion sin movimiento fisico sigue siendo devolucion.
        hubo_traslado = activo.ubicacion_id != (
            ubicacion_anterior.id if ubicacion_anterior else None
        )
        if custodio is not None:
            tipo_movimiento = MovimientoActivo.Tipo.ASIGNACION
        elif hubo_traslado:
            tipo_movimiento = MovimientoActivo.Tipo.TRASLADO
        elif custodio_anterior is not None:
            tipo_movimiento = MovimientoActivo.Tipo.DEVOLUCION
        else:
            tipo_movimiento = MovimientoActivo.Tipo.TRASLADO

        ActivoService._registrar_movimiento(
            activo=activo,
            tipo=tipo_movimiento,
            actor=actor,
            motivo=motivo,
            custodio_anterior=custodio_anterior,
            custodio_nuevo=custodio,
            departamento_anterior=departamento_anterior,
            departamento_nuevo=activo.departamento,
            ubicacion_anterior=ubicacion_anterior,
            ubicacion_nueva=activo.ubicacion,
            estado_anterior=estado_anterior,
            estado_nuevo=activo.estado,
        )
        record_audit_event(
            actor=actor,
            action="activo.custodio_changed",
            target=activo,
            module=MODULO,
            previous_values={
                "custodio_id": custodio_anterior.id if custodio_anterior else None,
                "departamento_id": departamento_anterior.id,
                "ubicacion_id": ubicacion_anterior.id if ubicacion_anterior else None,
            },
            new_values={
                "custodio_id": custodio.id if custodio else None,
                "departamento_id": activo.departamento_id,
                "ubicacion_id": activo.ubicacion_id,
                "motivo": motivo,
            },
            context=context,
        )
        return activo

    @staticmethod
    @transaction.atomic
    def cambiar_estado(*, actor, activo: Activo, estado: str, motivo="", context=None) -> Activo:
        """Cambia el estado operativo del activo.

        Los tres estados de salida —baja, perdido y robado— comparten el
        registro de fecha y motivo: para el inventario los tres significan que
        el equipo dejó de estar disponible, y la diferencia entre ellos es
        justamente el motivo. La baja, en cambio, es definitiva: un equipo
        desincorporado no vuelve, mientras que uno perdido puede aparecer.
        """
        estado_anterior = activo.estado
        if estado_anterior == estado:
            return activo

        if estado_anterior == Activo.Estado.DADO_DE_BAJA:
            raise serializers.ValidationError(
                {
                    "estado": (
                        "Un activo dado de baja no vuelve al inventario: su expediente se "
                        "conserva como respaldo de la desincorporación. Registre el equipo "
                        "como uno nuevo."
                    )
                }
            )

        activo.estado = estado
        campos = ["estado", "updated_at"]

        if estado in ESTADOS_FUERA_DE_INVENTARIO:
            activo.fecha_baja = timezone.localdate()
            activo.motivo_baja = motivo
            campos += ["fecha_baja", "motivo_baja"]
            if activo.custodio_id is not None:
                # El equipo ya no está: mantenerlo a nombre de alguien lo haría
                # aparecer en su lista de responsabilidades y en las alertas de
                # custodia, y el historial ya guarda quién lo tenía.
                activo.custodio = None
                campos.append("custodio")
        elif estado_anterior in ESTADOS_FUERA_DE_INVENTARIO:
            # Reingreso: un equipo dado por perdido que aparece. Se limpian la
            # fecha y el motivo de salida porque ya no describen su situación,
            # y el historial conserva que estuvo fuera y por qué.
            activo.fecha_baja = None
            activo.motivo_baja = ""
            campos += ["fecha_baja", "motivo_baja"]

        activo.save(update_fields=campos)

        ActivoService._registrar_movimiento(
            activo=activo,
            tipo=(
                MovimientoActivo.Tipo.BAJA
                if estado in ESTADOS_FUERA_DE_INVENTARIO
                else MovimientoActivo.Tipo.CAMBIO_ESTADO
            ),
            actor=actor,
            motivo=motivo,
            estado_anterior=estado_anterior,
            estado_nuevo=estado,
        )
        record_audit_event(
            actor=actor,
            action=(
                "activo.dado_de_baja"
                if estado in ESTADOS_FUERA_DE_INVENTARIO
                else "activo.estado_changed"
            ),
            target=activo,
            module=MODULO,
            previous_values={"estado": estado_anterior},
            new_values={"estado": estado, "motivo": motivo},
            context=context,
        )
        return activo
