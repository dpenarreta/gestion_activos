"""Lógica de negocio de la bitácora de mantenimientos (RF-04, RF-05) y de la
actualización de los indicadores que alimentan el motor de renovación.

`recalcular_indicadores` es la única función que escribe los contadores del
activo. Se recalculan desde la bitácora en vez de incrementarse (`F('x') + 1`)
porque un mantenimiento se puede editar o eliminar, y un contador incremental
quedaría desfasado en cuanto eso ocurriera. Recontar cuesta dos agregaciones
sobre un historial que rara vez pasa de unas decenas de filas por activo.
"""

from django.db import transaction
from django.db.models import Count, Sum

from apps.activos.models import Activo
from apps.activos.services import ActivoService
from apps.core.audit import record_audit_event
from apps.politicas.services import SIN_RESOLVER, refrescar_indicadores_renovacion

from . import notificaciones
from .models import ComponenteUtilizado, Mantenimiento

#: Reparaciones que no devuelven el equipo a operación. El equipo se queda «en
#: reparación» hasta que alguien decida qué hacer con él: darlo de baja es una
#: decisión con motivo, no la consecuencia automática de un diagnóstico.
_FINALES_SIN_VUELTA = (
    Mantenimiento.EstadoFinal.NO_REPARABLE,
    Mantenimiento.EstadoFinal.DADO_DE_BAJA,
)

MODULO = "mantenimientos"


def recalcular_indicadores(activo, politica=SIN_RESOLVER):
    """Recuenta mantenimientos y piezas críticas del activo y reevalúa su
    sugerencia de renovación. Devuelve el resultado de la evaluación."""
    total_mantenimientos = activo.mantenimientos.count()
    total_criticos = (
        ComponenteUtilizado.objects.filter(
            mantenimiento__activo=activo, era_critico=True
        ).aggregate(total=Sum("cantidad"))["total"]
        or 0
    )

    activo.total_mantenimientos = total_mantenimientos
    activo.total_componentes_criticos = total_criticos
    activo.save(update_fields=["total_mantenimientos", "total_componentes_criticos"])

    return refrescar_indicadores_renovacion(activo, politica=politica)


class MantenimientoService:
    @staticmethod
    @transaction.atomic
    def registrar(*, actor, activo, componentes=None, context=None, **datos) -> Mantenimiento:
        """Registra una intervención con su desglose de repuestos (RF-04).

        Al terminar recalcula los indicadores del activo, de modo que el
        contador de RF-05 y la alerta de RF-07 quedan al día en la misma
        transacción: nunca se ve un mantenimiento registrado cuyo contador
        todavía no lo refleje.
        """
        mantenimiento = Mantenimiento.objects.create(activo=activo, registrado_por=actor, **datos)

        for linea in componentes or []:
            componente = linea["componente"]
            ComponenteUtilizado.objects.create(
                mantenimiento=mantenimiento,
                componente=componente,
                cantidad=linea.get("cantidad", 1),
                costo_unitario=linea.get("costo_unitario"),
                numero_serie_nuevo=linea.get("numero_serie_nuevo", ""),
                observaciones=linea.get("observaciones", ""),
                # Snapshot del catálogo al momento del consumo.
                era_critico=componente.es_critico,
            )

        # El equipo está donde dice la intervención: si queda abierta, está en
        # el taller. Antes había que acordarse de cambiarlo a mano, y mientras
        # nadie se acordaba la ficha decía «Asignado» sobre un equipo que no
        # estaba en el escritorio de nadie.
        MantenimientoService._llevar_al_taller(mantenimiento, actor, context)

        evaluacion = recalcular_indicadores(activo)

        # Un mantenimiento que nace ya cerrado —se arregló en el sitio, en diez
        # minutos— manda un solo aviso, el de salida: contar que entró y salió
        # en dos correos seguidos es contar dos veces lo mismo.
        aviso = (
            notificaciones.al_entrar_al_taller(mantenimiento, actor)
            if mantenimiento.sigue_fuera_de_operacion
            else notificaciones.al_salir_del_taller(mantenimiento, actor)
        )
        mantenimiento.aviso = aviso

        record_audit_event(
            actor=actor,
            action="mantenimiento.created",
            target=mantenimiento,
            module=MODULO,
            new_values={
                "activo_id": activo.id,
                "codigo_barras": activo.codigo_barras,
                "tipo": mantenimiento.tipo,
                "fecha_intervencion": str(mantenimiento.fecha_intervencion),
                "responsable": mantenimiento.responsable,
                "componentes": [
                    {
                        "componente": linea["componente"].nombre,
                        "cantidad": linea.get("cantidad", 1),
                        "critico": linea["componente"].es_critico,
                    }
                    for linea in componentes or []
                ],
                "total_mantenimientos": activo.total_mantenimientos,
                "requiere_renovacion": evaluacion.requiere_renovacion,
            },
            context=context,
        )
        return mantenimiento

    @staticmethod
    @transaction.atomic
    def actualizar(*, actor, mantenimiento, componentes=None, context=None, **datos):
        """Corrige una intervención ya registrada.

        Si vienen `componentes`, reemplazan por completo el desglose anterior:
        una edición parcial de líneas obligaría al cliente a llevar los ids de
        cada una, y el formulario real siempre reenvía la lista completa.
        """
        estaba_fuera = mantenimiento.sigue_fuera_de_operacion
        anteriores, nuevos = {}, {}
        for campo, valor in datos.items():
            actual = getattr(mantenimiento, campo)
            if actual != valor:
                anteriores[campo] = str(actual) if actual is not None else None
                nuevos[campo] = str(valor) if valor is not None else None
                setattr(mantenimiento, campo, valor)

        if nuevos:
            mantenimiento.save()

        if componentes is not None:
            anteriores["componentes"] = [
                {"componente": c.componente.nombre, "cantidad": c.cantidad}
                for c in mantenimiento.componentes.select_related("componente")
            ]
            mantenimiento.componentes.all().delete()
            for linea in componentes:
                componente = linea["componente"]
                ComponenteUtilizado.objects.create(
                    mantenimiento=mantenimiento,
                    componente=componente,
                    cantidad=linea.get("cantidad", 1),
                    costo_unitario=linea.get("costo_unitario"),
                    numero_serie_nuevo=linea.get("numero_serie_nuevo", ""),
                    observaciones=linea.get("observaciones", ""),
                    era_critico=componente.es_critico,
                )
            nuevos["componentes"] = [
                {"componente": linea["componente"].nombre, "cantidad": linea.get("cantidad", 1)}
                for linea in componentes
            ]

        if not nuevos:
            return mantenimiento

        recalcular_indicadores(mantenimiento.activo)

        # Ponerle fecha de salida es sacar el equipo del taller. Solo en ese
        # cruce: corregir la solución de una reparación ya cerrada no vuelve a
        # avisar de que el equipo volvió.
        if estaba_fuera and not mantenimiento.sigue_fuera_de_operacion:
            MantenimientoService._devolver_del_taller(mantenimiento, actor, context)
            mantenimiento.aviso = notificaciones.al_salir_del_taller(mantenimiento, actor)
        elif not estaba_fuera and mantenimiento.sigue_fuera_de_operacion:
            # Se le quitó la fecha de salida: la reparación se reabre y el
            # equipo vuelve al taller.
            MantenimientoService._llevar_al_taller(mantenimiento, actor, context)

        record_audit_event(
            actor=actor,
            action="mantenimiento.updated",
            target=mantenimiento,
            module=MODULO,
            previous_values=anteriores,
            new_values=nuevos,
            context=context,
        )
        return mantenimiento

    @staticmethod
    def _llevar_al_taller(mantenimiento, actor, context) -> None:
        """Pone el equipo «en reparación» mientras la intervención siga abierta.

        No toca los estados de salida —un equipo robado que aparece en una
        orden de reparación es un error de captura, no un traslado al taller— ni
        el de un equipo que ya estaba allí por otra intervención.
        """
        activo = mantenimiento.activo
        if not mantenimiento.sigue_fuera_de_operacion:
            # Una intervención que nace cerrada no movió el equipo a ninguna
            # parte: se arregló en el sitio, o se registra después de hecha.
            return
        if not activo.esta_operativo or activo.estado == Activo.Estado.EN_MANTENIMIENTO:
            return

        Mantenimiento.objects.filter(pk=mantenimiento.pk).update(
            estado_previo_del_activo=activo.estado
        )
        mantenimiento.estado_previo_del_activo = activo.estado
        ActivoService.cambiar_estado(
            actor=actor,
            activo=activo,
            estado=Activo.Estado.EN_MANTENIMIENTO,
            motivo=f"Ingresa a reparación: {mantenimiento.causa or mantenimiento.descripcion}"[
                :255
            ],
            context=context,
        )

    @staticmethod
    def _devolver_del_taller(mantenimiento, actor, context) -> None:
        """Devuelve el equipo al estado en que entró, si la reparación terminó bien.

        Con «no reparable» o «dado de baja» no se devuelve nada: el equipo no
        vuelve a operar, y ponerlo otra vez «Asignado» lo haría contar entre lo
        que funciona. Sacarlo del parque es una decisión con motivo, y se toma
        desde la ficha.
        """
        activo = mantenimiento.activo
        if mantenimiento.estado_final in _FINALES_SIN_VUELTA:
            return
        if activo.estado != Activo.Estado.EN_MANTENIMIENTO:
            # Alguien lo movió mientras estaba en el taller: se respeta lo que
            # haya decidido, que es información más fresca que la nuestra.
            return

        destino = mantenimiento.estado_previo_del_activo or (
            Activo.Estado.EN_USO if activo.esta_asignado else Activo.Estado.EN_BODEGA
        )
        ActivoService.cambiar_estado(
            actor=actor,
            activo=activo,
            estado=destino,
            motivo=f"Vuelve de reparación: {mantenimiento.get_estado_final_display()}",
            context=context,
        )

    @staticmethod
    @transaction.atomic
    def eliminar(*, actor, mantenimiento, context=None) -> None:
        """Elimina una intervención registrada por error.

        Se permite el borrado físico —a diferencia de los activos, que se dan
        de baja— porque un mantenimiento mal capturado distorsiona el contador
        de RF-05 y, por su intermedio, la sugerencia de renovación de RF-07:
        conservarlo "inactivo" obligaría a que todos los conteos filtraran por
        ese estado. El evento queda en la bitácora de auditoría, que sí es
        append-only.
        """
        activo = mantenimiento.activo
        datos_previos = {
            "activo_id": activo.id,
            "tipo": mantenimiento.tipo,
            "fecha_intervencion": str(mantenimiento.fecha_intervencion),
            "responsable": mantenimiento.responsable,
        }
        mantenimiento_id = mantenimiento.id
        mantenimiento.delete()

        recalcular_indicadores(activo)
        record_audit_event(
            actor=actor,
            action="mantenimiento.deleted",
            target_type="mantenimiento",
            target_id=mantenimiento_id,
            module=MODULO,
            previous_values=datos_previos,
            context=context,
        )


def resumen_costos(activo) -> dict:
    """Cuánto se ha invertido en sostener un activo.

    Responde a la pregunta que el contexto de RF-04 declara imposible hoy
    ("cuánto dinero se ha invertido en su sostenimiento").
    """
    from decimal import Decimal

    mano_obra = activo.mantenimientos.aggregate(total=Sum("costo_mano_obra"))["total"] or Decimal(
        "0"
    )
    repuestos = Decimal("0")
    for componente in ComponenteUtilizado.objects.filter(
        mantenimiento__activo=activo
    ).select_related("componente"):
        repuestos += componente.costo_total

    por_tipo = dict(
        activo.mantenimientos.values_list("tipo")
        .annotate(total=Count("id"))
        .values_list("tipo", "total")
    )

    return {
        "costo_mano_obra": mano_obra,
        "costo_repuestos": repuestos,
        "costo_total": mano_obra + repuestos,
        "mantenimientos_por_tipo": por_tipo,
    }
