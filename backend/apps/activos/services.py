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
        # Una relación de muchos a muchos no cabe en el `create`: el activo
        # necesita existir antes de que se le pueda colgar a nadie.
        responsables = [
            empleado for empleado in (datos.pop("responsables", None) or []) if empleado is not None
        ]
        if len(responsables) > 1 and not datos.get("compartido"):
            raise serializers.ValidationError(
                {
                    "responsables": (
                        "Este equipo tiene un solo responsable. Márquelo como compartido "
                        "si varias personas responden por él en igualdad."
                    )
                }
            )
        ultimo_error = None

        for _ in range(MAX_REINTENTOS_CODIGO):
            try:
                with transaction.atomic():
                    activo = Activo.objects.create(
                        codigo_barras=generar_codigo_barras(tipo.codigo), **datos
                    )
                    activo.responsables.set(responsables)
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

        # Un alta por cada responsable con el que el equipo nace, y una sola si
        # nace en bodega: el movimiento es también de lo que sale el acta, y en
        # un equipo compartido cada quien firma la suya.
        for empleado in responsables or [None]:
            ActivoService._registrar_movimiento(
                activo=activo,
                tipo=MovimientoActivo.Tipo.ALTA,
                actor=actor,
                custodio_nuevo=empleado,
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
                "responsables": sorted(empleado.id for empleado in responsables),
            },
            context=context,
        )
        return activo

    @staticmethod
    def actualizar_activo(*, actor, activo: Activo, context: dict | None = None, **datos) -> Activo:
        """Edita la ficha técnica. Los cambios de custodio, área y estado no
        se hacen por aquí sino con `asignar_responsables` / `cambiar_estado`, que
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
    def asignar_responsables(
        *,
        actor,
        activo: Activo,
        responsables=(),
        departamento=None,
        sede=SIN_CAMBIO,
        motivo="",
        context=None,
    ) -> Activo:
        """Cambia quiénes responden por el equipo, el área y/o la ubicación (RF-03).

        `responsables` es la lista completa de quienes responden **después** de
        esta operación, no los que se suman: una lista vacía es una devolución
        a bodega, y quien no quiera tocar la custodia sencillamente no llama a
        este método. Se pasa entera y no como altas y bajas sueltas porque es
        lo que el formulario tiene delante —la lista que queda— y calcular la
        diferencia aquí evita que cada llamador la calcule a su manera.

        `sede` sí distingue «quitarla» de «no tocarla» con un centinela: un
        traslado puede querer dejar el equipo sin sitio y una reasignación
        normal no debe tocarlo. Con un solo valor para ambos casos, cada
        entrega borraría en silencio dónde está el equipo.

        Varios responsables solo caben en un equipo marcado como compartido. La
        marca es una decisión explícita y no una consecuencia de sumar gente:
        repartir la responsabilidad de una laptop personal entre tres nombres
        es exactamente lo que hace que después nadie responda por ella.
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

        # Sin repetidos: la misma persona dos veces en la lista es la misma
        # responsabilidad, no dos.
        nuevos = {empleado.id: empleado for empleado in responsables if empleado is not None}
        if len(nuevos) > 1 and not activo.compartido:
            raise serializers.ValidationError(
                {
                    "responsables": (
                        "Este equipo tiene un solo responsable. Márquelo como compartido "
                        "si varias personas responden por él en igualdad."
                    )
                }
            )

        anteriores = {empleado.id: empleado for empleado in activo.responsables.all()}
        entran = [nuevos[clave] for clave in nuevos if clave not in anteriores]
        salen = [anteriores[clave] for clave in anteriores if clave not in nuevos]

        departamento_anterior = activo.departamento
        sede_anterior = activo.sede
        estado_anterior = activo.estado

        if departamento is not None:
            activo.departamento = departamento
        if sede is not SIN_CAMBIO:
            activo.sede = sede

        # Un equipo con responsable está en uso; sin nadie, vuelve a bodega. No
        # se toca el estado si está en mantenimiento, en garantía o en
        # tránsito: esos describen dónde está el equipo, y eso manda sobre
        # quién responde por él.
        if activo.estado in ESTADOS_ASIGNABLES:
            # La devolución deja el equipo «en bodega», no «disponible»: antes
            # de volver a entregarlo hay que revisarlo y formatearlo, y
            # marcarlo entregable de inmediato haría prometer equipos que
            # todavía no lo están.
            activo.estado = Activo.Estado.EN_USO if nuevos else Activo.Estado.EN_BODEGA

        activo.save(update_fields=["departamento", "sede", "estado", "updated_at"])
        activo.responsables.set(nuevos.values())

        ActivoService._registrar_movimientos_de_custodia(
            activo=activo,
            actor=actor,
            motivo=motivo,
            entran=entran,
            salen=salen,
            hubo_traslado=activo.sede_id != (sede_anterior.id if sede_anterior else None),
            departamento_anterior=departamento_anterior,
            sede_anterior=sede_anterior,
            estado_anterior=estado_anterior,
        )
        record_audit_event(
            actor=actor,
            action="activo.responsables_changed",
            target=activo,
            module=MODULO,
            previous_values={
                "responsables": sorted(anteriores),
                "departamento_id": departamento_anterior.id,
                "sede_id": sede_anterior.id if sede_anterior else None,
            },
            new_values={
                "responsables": sorted(nuevos),
                "departamento_id": activo.departamento_id,
                "sede_id": activo.sede_id,
                "motivo": motivo,
            },
            context=context,
        )
        return activo

    @staticmethod
    def _registrar_movimientos_de_custodia(
        *,
        activo,
        actor,
        motivo,
        entran,
        salen,
        hubo_traslado,
        departamento_anterior,
        sede_anterior,
        estado_anterior,
    ) -> None:
        """La traza de RF-03: un movimiento **por persona** que entra o sale.

        Por persona y no por operación porque de cada movimiento sale un acta y
        cada quien firma la suya: en un equipo compartido no hay un titular que
        pueda firmar por los demás.

        El traslado, en cambio, ocurrió una sola vez por muchas personas que
        cambien, así que el cambio de área, sede y estado lo cuenta solo el
        primer movimiento; los siguientes describen únicamente el relevo.

        Y un traslado que deja el equipo sin nadie **no es una devolución**: el
        equipo pasó a una bodega, y una bodega no responde por nada. Lo que hay
        que poder rastrear después es dónde acabó, no que alguien lo soltara;
        la devolución sin movimiento físico sigue siendo devolución.
        """
        contexto = {
            "departamento_anterior": departamento_anterior,
            "sede_anterior": sede_anterior,
            "estado_anterior": estado_anterior,
        }
        ya_contado = {
            "departamento_anterior": activo.departamento,
            "sede_anterior": activo.sede,
            "estado_anterior": activo.estado,
        }
        comun = {
            "activo": activo,
            "actor": actor,
            "motivo": motivo,
            "departamento_nuevo": activo.departamento,
            "sede_nueva": activo.sede,
            "estado_nuevo": activo.estado,
        }

        if len(entran) == 1 and len(salen) == 1:
            # El relevo se cuenta como un solo hecho —«pasó de A a B»—, que es
            # como se lee en el historial y como se leía cuando el custodio era
            # uno solo y no había equipos compartidos.
            ActivoService._registrar_movimiento(
                tipo=MovimientoActivo.Tipo.ASIGNACION,
                custodio_anterior=salen[0],
                custodio_nuevo=entran[0],
                **comun,
                **contexto,
            )
            return

        if not entran and not salen:
            # Nadie cambió de manos: lo que hubo fue un traslado, o nada. Se
            # registra igual, para que el historial explique por qué el equipo
            # está donde está.
            ActivoService._registrar_movimiento(
                tipo=MovimientoActivo.Tipo.TRASLADO,
                custodio_anterior=None,
                custodio_nuevo=None,
                **comun,
                **contexto,
            )
            return

        for empleado in entran:
            ActivoService._registrar_movimiento(
                tipo=MovimientoActivo.Tipo.ASIGNACION,
                custodio_anterior=None,
                custodio_nuevo=empleado,
                **comun,
                **contexto,
            )
            contexto = ya_contado
        salida = (
            MovimientoActivo.Tipo.TRASLADO
            if hubo_traslado and not entran
            else MovimientoActivo.Tipo.DEVOLUCION
        )
        for empleado in salen:
            ActivoService._registrar_movimiento(
                tipo=salida,
                custodio_anterior=empleado,
                custodio_nuevo=None,
                **comun,
                **contexto,
            )
            contexto = ya_contado

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
        responsables_al_salir = []

        if estado in ESTADOS_FUERA_DE_INVENTARIO:
            activo.fecha_baja = timezone.localdate()
            activo.motivo_baja = motivo
            campos += ["fecha_baja", "motivo_baja"]
            # El equipo ya no está: mantenerlo a nombre de alguien lo haría
            # aparecer en su lista de responsabilidades y en las alertas de
            # custodia, y el historial ya guarda quiénes lo tenían. Se vacía
            # después de guardar, porque una relación de muchos a muchos no
            # viaja en `update_fields`.
            responsables_al_salir = list(activo.responsables.all())
        elif estado_anterior in ESTADOS_FUERA_DE_INVENTARIO:
            # Reingreso: un equipo dado por perdido que aparece. Se limpian la
            # fecha y el motivo de salida porque ya no describen su situación,
            # y el historial conserva que estuvo fuera y por qué.
            activo.fecha_baja = None
            activo.motivo_baja = ""
            campos += ["fecha_baja", "motivo_baja"]

        activo.save(update_fields=campos)
        if estado in ESTADOS_FUERA_DE_INVENTARIO and responsables_al_salir:
            activo.responsables.clear()

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
