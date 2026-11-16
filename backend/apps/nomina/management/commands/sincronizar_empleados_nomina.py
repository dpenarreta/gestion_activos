"""La sincronización nocturna de perfiles con nómina (US-021). La corre la
tarea programada «Intranet-Nomina» a las 02:00 (`instalar-servidor.ps1`)."""

from django.core.cache import cache
from django.core.management.base import BaseCommand

from apps.nomina import empleados
from apps.nomina.sincronizacion_views import CANDADO, CANDADO_SEGUNDOS


class Command(BaseCommand):
    help = "Sincroniza los perfiles de las personas con nómina (sp de empleados activos)."

    def handle(self, *args, **opciones):
        if not empleados.configurada():
            self.stdout.write(
                "Nómina: la sincronización no está configurada (NOMINA_EMPLEADOS_PROCEDIMIENTO)."
            )
            return
        if not cache.add(CANDADO, True, CANDADO_SEGUNDOS):
            self.stdout.write("Nómina: ya hay una sincronización en curso.")
            return
        try:
            corrida = empleados.sincronizar()
        finally:
            cache.delete(CANDADO)
        self.stdout.write(
            f"Nómina: {corrida.get_estado_display()} · {corrida.empleados} empleados, "
            f"{corrida.creadas} creadas, {corrida.actualizadas} actualizadas, "
            f"{corrida.sin_cambios} sin cambios, {len(corrida.conflictos or [])} conflictos"
            + (f" · {corrida.error}" if corrida.error else "")
        )
