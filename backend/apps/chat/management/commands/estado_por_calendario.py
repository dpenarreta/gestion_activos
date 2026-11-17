"""Pasa a «En reunión» a quien conectó su calendario de Google y tiene una
reunión ahora, y devuelve el estado de quien ya terminó (17/11/2026). Corre
cada 5 minutos en la tarea Intranet-Ciclo; sin Google configurado no hace
nada."""

from django.core.management.base import BaseCommand

from apps.chat.calendario import revisar_todos


class Command(BaseCommand):
    help = "Actualiza el estado «En reunión» del chat según el calendario de Google."

    def handle(self, *args, **options):
        resumen = revisar_todos()
        self.stdout.write(
            f"Calendario: {resumen['revisados']} revisados, {resumen['puestos']} en reunión, "
            f"{resumen['devueltos']} devueltos, {resumen['recordatorios']} recordatorios, {resumen['errores']} con error."
        )
