from django.core.management.base import BaseCommand

from apps.notificaciones import services


class Command(BaseCommand):
    help = "Borra las notificaciones de la campana que ya no son noticia."

    def handle(self, *args, **opciones):
        borradas = services.limpiar()
        if borradas:
            self.stdout.write(f"Notificaciones viejas borradas: {borradas}")
