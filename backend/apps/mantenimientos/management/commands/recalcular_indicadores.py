"""Recalcula los contadores y la sugerencia de renovación de todos los activos.

Pensado para correr a diario por cron: el criterio de longevidad de RF-07 se
cumple por el paso del tiempo, sin ningún evento en el sistema que dispare la
actualización de la caché. Sin esta pasada, un equipo que nadie tocó nunca
encendería su alerta en los listados (las respuestas de la API sí lo calculan
en vivo; esto mantiene coherente lo que se puede filtrar y ordenar).

Es idempotente: correrlo dos veces seguidas deja el mismo estado.
"""

from django.core.management.base import BaseCommand

from apps.activos.models import Activo
from apps.mantenimientos.services import recalcular_indicadores
from apps.politicas.services import precalcular_ventanas


class Command(BaseCommand):
    help = "Recalcula contadores de mantenimiento y sugerencias de renovación."

    def add_arguments(self, parser):
        parser.add_argument(
            "--incluir-bajas",
            action="store_true",
            help="Procesa también los activos dados de baja (por defecto se omiten).",
        )

    def handle(self, *args, **options):
        activos = Activo.objects.select_related("tipo").order_by("id")
        if not options["incluir_bajas"]:
            activos = activos.exclude(estado=Activo.Estado.DADO_DE_BAJA)

        # El conteo de la ventana móvil se resuelve antes del bucle, con una
        # consulta agregada por ventana configurada.
        activos, politicas = precalcular_ventanas(activos)
        total = con_alerta = 0
        por_nivel = {"evaluar": 0, "recomendado": 0}

        for activo in activos:
            resultado = recalcular_indicadores(activo, politica=politicas.get(activo.tipo_id))
            total += 1
            if resultado.requiere_renovacion:
                con_alerta += 1
                por_nivel[resultado.nivel] += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"{total} activo(s) evaluados; {con_alerta} con sugerencia de renovación "
                f"({por_nivel['recomendado']} con reemplazo recomendado, "
                f"{por_nivel['evaluar']} a evaluar)."
            )
        )
