"""Lógica de negocio del inventario de activos (RF-01, RF-02).

Toda alta, edición, asignación y baja pasa por aquí: las vistas no tocan el
ORM ni escriben en auditoría por su cuenta. Cada operación que cambia
custodio, área o estado deja además un `MovimientoActivo`, que es lo que
alimenta el historial exigido por RF-03.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.audit import record_audit_event

from .barcode import generar_codigo_barras
from .models import Activo, MovimientoActivo

MODULO = "activos"
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
        *, actor, activo: Activo, custodio=None, departamento=None, motivo="", context=None
    ) -> Activo:
        """Cambia el responsable y/o el área, dejando la traza de RF-03.

        `custodio=None` es una devolución a bodega, no "sin cambios": el
        llamador que no quiere tocar el custodio simplemente no invoca este
        método.
        """
        custodio_anterior = activo.custodio
        departamento_anterior = activo.departamento
        estado_anterior = activo.estado

        activo.custodio = custodio
        if departamento is not None:
            activo.departamento = departamento

        # Un equipo con responsable está en uso; sin responsable, vuelve a
        # bodega. No se toca el estado si está en mantenimiento o dado de baja:
        # esos mandan sobre la asignación.
        if activo.estado in {Activo.Estado.EN_USO, Activo.Estado.EN_BODEGA}:
            activo.estado = Activo.Estado.EN_USO if custodio else Activo.Estado.EN_BODEGA

        activo.save(update_fields=["custodio", "departamento", "estado", "updated_at"])

        if custodio is not None:
            tipo_movimiento = MovimientoActivo.Tipo.ASIGNACION
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
            },
            new_values={
                "custodio_id": custodio.id if custodio else None,
                "departamento_id": activo.departamento_id,
                "motivo": motivo,
            },
            context=context,
        )
        return activo

    @staticmethod
    @transaction.atomic
    def cambiar_estado(*, actor, activo: Activo, estado: str, motivo="", context=None) -> Activo:
        """Cambia el estado operativo del activo."""
        estado_anterior = activo.estado
        if estado_anterior == estado:
            return activo

        activo.estado = estado
        campos = ["estado", "updated_at"]

        if estado == Activo.Estado.DADO_DE_BAJA:
            activo.fecha_baja = timezone.localdate()
            activo.motivo_baja = motivo
            campos += ["fecha_baja", "motivo_baja"]

        activo.save(update_fields=campos)

        ActivoService._registrar_movimiento(
            activo=activo,
            tipo=(
                MovimientoActivo.Tipo.BAJA
                if estado == Activo.Estado.DADO_DE_BAJA
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
                if estado == Activo.Estado.DADO_DE_BAJA
                else "activo.estado_changed"
            ),
            target=activo,
            module=MODULO,
            previous_values={"estado": estado_anterior},
            new_values={"estado": estado, "motivo": motivo},
            context=context,
        )
        return activo
