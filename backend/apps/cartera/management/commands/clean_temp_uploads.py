import time

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.cartera.models import CargaArchivo

HORAS_POR_DEFECTO = 24


class Command(BaseCommand):
    help = 'Elimina archivos temporales de carga (sección 17) más antiguos que N horas (por defecto 24).'

    def add_arguments(self, parser):
        parser.add_argument('--horas', type=float, default=HORAS_POR_DEFECTO)

    def handle(self, *args, **options):
        limite = time.time() - options['horas'] * 3600
        carpeta = settings.CARTERA_TEMP_UPLOADS_DIR

        # Nunca se borra un archivo que una `CargaArchivo` todavía referencia. Antes se borraba
        # solo por antigüedad, así que una carga en estado VALIDADO de más de 24 h quedaba
        # apuntando a un archivo inexistente y el siguiente paso del asistente fallaba con un
        # error de sistema de archivos en vez de uno de negocio legible.
        referenciados = set(
            CargaArchivo.objects.exclude(archivo_temp_nombre='')
            .values_list('archivo_temp_nombre', flat=True)
        )

        eliminados = conservados = 0
        for archivo in carpeta.glob('*'):
            if not archivo.is_file() or archivo.stat().st_mtime >= limite:
                continue
            if archivo.name in referenciados:
                conservados += 1
                continue
            archivo.unlink()
            eliminados += 1

        mensaje = f'{eliminados} archivo(s) temporal(es) eliminado(s).'
        if conservados:
            mensaje += f' {conservados} conservado(s) por seguir referenciados por una carga.'
        self.stdout.write(self.style.SUCCESS(mensaje))
