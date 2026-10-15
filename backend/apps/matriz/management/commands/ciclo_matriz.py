"""Un ciclo de los procesos programados de la Matriz (§13).

Lo lanza la tarea programada de Windows cada cinco minutos, junto al respaldo
(`scripts/tarea_respaldo.py`). Es seguro repetirlo y correrlo dos veces a la
vez: cada aviso tiene su clave única y la hora de envío la decide la
configuración de cada empresa, no la frecuencia de la tarea.
"""

from django.core.management.base import BaseCommand

from apps.matriz.recordatorios import ciclo


class Command(BaseCommand):
    help = (
        "Genera los períodos siguientes, envía los recordatorios y escalamientos de la Matriz "
        "y reintenta los fallidos."
    )

    def handle(self, *args, **options):
        resumen = ciclo()
        self.stdout.write(
            "Matriz: {periodos} período(s) generado(s), {recordatorios} recordatorio(s), "
            "{escalamientos} escalamiento(s), "
            "{reintentos} reintento(s).".format(**resumen)
        )
