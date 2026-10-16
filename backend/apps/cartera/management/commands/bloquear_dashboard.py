"""`python manage.py bloquear_dashboard <dashboard_id> [--desbloquear]`

Congela (o descongela) la ESTRUCTURA de un dashboard: con el bloqueo puesto no se puede agregar,
eliminar, reordenar, redimensionar ni ocultar ningún componente. Los datos siguen siendo
editables: el mapeo de columnas, el título y los colores se cambian como siempre, que es lo que
hace falta cuando cambia el origen de los datos.

Es un comando y no una opción de pantalla a propósito. El bloqueo existe para que la estructura no
se mueva por descuido; si se pudiera quitar con un clic desde la misma pantalla donde se edita, no
protegería de nada. Desde la aplicación un superusuario puede saltearlo operación por operación
confirmando su contraseña (`services/desbloqueo.py`), pero quitarlo del todo es una decisión
deliberada que se toma en el servidor.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.cartera.models import Dashboard
from apps.cartera.services import estructura


class Command(BaseCommand):
    help = 'Congela la estructura de un dashboard (o la descongela con --desbloquear).'

    def add_arguments(self, parser):
        parser.add_argument('dashboard_id', help='El dashboard_id (no el nombre visible).')
        parser.add_argument(
            '--desbloquear', action='store_true',
            help='Quita el bloqueo en vez de ponerlo.',
        )

    def handle(self, *args, **opciones):
        dashboard_id = opciones['dashboard_id']
        bloquear = not opciones['desbloquear']

        dashboard = Dashboard.objects.filter(dashboard_id=dashboard_id).first()
        if dashboard is None:
            existentes = ', '.join(Dashboard.objects.values_list('dashboard_id', flat=True)[:10]) or '(ninguno)'
            raise CommandError(f'No existe el dashboard "{dashboard_id}". Hay: {existentes}.')

        if dashboard.estructura_bloqueada == bloquear:
            if not bloquear:
                self.stdout.write(f'Sin cambios: la estructura de "{dashboard.name}" ya estaba libre.')
                return
            # Ya estaba bloqueado: se vuelve a tomar la foto contra la estructura de AHORA. Es el
            # caso de un dashboard bloqueado antes de que existiera la reposición (no tendría
            # foto, y el bloqueo quedaría a medias), y también la forma de confirmar una
            # estructura nueva después de cambiarla a propósito.
            foto = estructura.fijar(dashboard_id)
            self.stdout.write(self.style.SUCCESS(
                f'"{dashboard.name}" ya estaba bloqueado: se actualizó la foto de su estructura '
                f'({len(foto)} componentes).'
            ))
            return

        dashboard.estructura_bloqueada = bloquear
        dashboard.save(update_fields=['estructura_bloqueada'])

        if bloquear:
            # La foto se toma DESPUÉS de marcar el bloqueo: `estructura.fijada_de` solo devuelve
            # algo para un dashboard bloqueado, y sin esto la reposición quedaría inerte.
            foto = estructura.fijar(dashboard_id)
            self.stdout.write(self.style.SUCCESS(
                f'Estructura de "{dashboard.name}" ({dashboard_id}) bloqueada '
                f'({len(foto)} componentes fijados).\n'
                '  No se puede agregar, eliminar, reordenar, redimensionar ni ocultar componentes.\n'
                '  Tipos, orden y dimensiones se REPONEN aunque se borren los datos, se recargue\n'
                '  el archivo o se restablezca el diseño: el layout vuelve solo a esta foto.\n'
                '  Los datos (columnas, títulos, colores) se siguen editando normalmente.\n'
                '  Un superusuario puede saltear el bloqueo confirmando su contraseña en cada cambio.'
            ))
        else:
            estructura.limpiar(dashboard_id)
            self.stdout.write(self.style.WARNING(
                f'Estructura de "{dashboard.name}" ({dashboard_id}) DESBLOQUEADA: '
                'vuelve a poder editarse libremente y deja de reponerse sola.'
            ))
