"""Borra los registros de interacción de más de 400 días (18/11/2026)."""

from django.core.management.base import BaseCommand

from apps.interaccion import services


class Command(BaseCommand):
    help = "Borra los registros de interacción con más de 400 días."

    def handle(self, *args, **options):
        borrados = services.purgar()
        self.stdout.write(f"Interacción: {borrados} registros antiguos borrados.")
