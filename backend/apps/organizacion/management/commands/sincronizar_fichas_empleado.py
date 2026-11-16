"""Crea la ficha de empleado de cada persona de nómina y pone al día las
demás (16/11/2026). Corre sola tras cada sincronización de nómina; este
comando es para la carga inicial o para repetirla a mano."""

from django.core.management.base import BaseCommand

from apps.organizacion.fichas import sincronizar_fichas


class Command(BaseCommand):
    help = "Crea y pone al día las fichas de empleado desde las cuentas de nómina."

    def handle(self, *args, **options):
        resumen = sincronizar_fichas()
        self.stdout.write(
            self.style.SUCCESS(
                f"Fichas: {resumen['creadas']} creadas, {resumen['actualizadas']} actualizadas, "
                f"{resumen['omitidas']} omitidas."
            )
        )
