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

from apps.core.audit import record_audit_event
from apps.politicas.services import refrescar_indicadores_renovacion

from .models import ComponenteUtilizado, Mantenimiento

MODULO = "mantenimientos"


def recalcular_indicadores(activo, politica=None):
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

        evaluacion = recalcular_indicadores(activo)

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
