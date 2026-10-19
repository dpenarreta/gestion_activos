from django.core.management.base import BaseCommand

from apps.chat import services


class Command(BaseCommand):
    help = "Borra los mensajes del chat (y sus archivos) que pasaron los 12 meses."

    def handle(self, *args, **opciones):
        borrados = services.limpiar()
        if borrados:
            self.stdout.write(f"Mensajes del chat borrados por antigüedad: {borrados}")
