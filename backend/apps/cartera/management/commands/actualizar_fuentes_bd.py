import time

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.cartera.services import fuente_bd_scheduler


class Command(BaseCommand):
    help = (
        'Actualización automática de "Conectar vista de base de datos": reconecta y reaplica el '
        'último mapeo confirmado para cada dashboard con una actualización PENDIENTE según su '
        'frecuencia (semanal/mensual). Sin programador de tareas propio de la app — se espera que '
        'un programador externo al sistema operativo (Windows Task Scheduler / cron) invoque este '
        'comando una vez al día. Si un día previsto no corrió, la siguiente ejecución lo recupera: '
        'no hay que esperar al próximo período ni lanzar nada a mano.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--si-toca', action='store_true',
            help='Como mucho una pasada por hora. Lo usa la tarea oculta del sistema '
                 '(scripts/tarea_respaldo.py), que corre cada cinco minutos: sin esto, un '
                 'dashboard cuya fuente falla se reintentaría contra la base externa doce '
                 'veces por hora.',
        )

    def handle(self, *args, **options):
        if options['si_toca'] and not _paso_una_hora():
            return
        resultados = fuente_bd_scheduler.actualizar_todos()
        if not resultados:
            self.stdout.write('Ningún dashboard tenía una actualización automática pendiente.')
            return

        for resultado in resultados:
            linea = f'{resultado["dashboard_id"]}: {resultado["mensaje"]}'
            if resultado['ok']:
                self.stdout.write(self.style.SUCCESS(linea))
            else:
                self.stdout.write(self.style.WARNING(linea))


#: Una pasada por hora basta: las frecuencias son semanal y mensual.
INTERVALO_SEGUNDOS = 60 * 60


def _paso_una_hora():
    """Mira y renueva la marca de la última pasada (un archivo junto a los de Cartera)."""
    marca = settings.CARTERA_ARCHIVOS_DIR.parent / '.ultima-pasada-fuentes-bd'
    if marca.exists() and time.time() - marca.stat().st_mtime < INTERVALO_SEGUNDOS:
        return False
    marca.parent.mkdir(parents=True, exist_ok=True)
    marca.touch()
    return True
