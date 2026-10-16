from django.core.management.base import BaseCommand

from apps.soporte import services


class Command(BaseCommand):
    help = (
        "Mesa de ayuda: reparte la cola entre los técnicos que empiezan su turno, avisa al 80 %"
        " del SLA, escala los vencidos y cierra los atendidos sin respuesta. Lo corre la tarea"
        " oculta cada 5 minutos (scripts/tarea_respaldo.py)."
    )

    def handle(self, *args, **options):
        resumen = services.ciclo()
        if any(resumen.values()):
            self.stdout.write(
                "Mesa de ayuda: {asignados} asignado(s), {alertas} alerta(s) de SLA, "
                "{vencidos} vencido(s), {cerrados} cerrado(s).".format(**resumen)
            )
