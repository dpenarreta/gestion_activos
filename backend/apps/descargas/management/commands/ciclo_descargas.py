from django.core.management.base import BaseCommand

from apps.descargas import services


class Command(BaseCommand):
    help = (
        "Registro de descargas: desde las 07:00 avisa el resumen del día anterior y borra lo"
        " servido de hace dos días y las copias de hace un año. Lo corre la tarea oculta cada"
        " 5 minutos (scripts/tarea_respaldo.py)."
    )

    def handle(self, *args, **options):
        avisos = services.resumen_diario()
        limpieza = services.limpiar()
        if avisos or limpieza["copias"]:
            self.stdout.write(
                f"Descargas: {avisos} aviso(s) de resumen, {limpieza['copias']} copia(s) vencida(s)."
            )
