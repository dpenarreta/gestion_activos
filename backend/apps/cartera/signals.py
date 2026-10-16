"""Limpieza de archivos en disco cuando se elimina la `CargaArchivo` que los referencia.

Antes no había nada que borrara de `CARTERA_ARCHIVOS_DIR`: `clean_temp_uploads` solo limpia el
directorio temporal, `views.ArchivoView.delete` borraba únicamente el temporal, y
`services/dashboards.py::borrar_datos_dashboard` —la acción que exige escribir el nombre exacto
del dashboard para confirmar— borraba las filas de la base y dejaba los `.xlsx` intactos. Es decir
que la operación presentada como el borrado definitivo de los datos del dashboard dejaba la
cartera completa legible en el sistema de archivos, indefinidamente.

Se resuelve con una señal `post_delete` en vez de repetir la limpieza en cada camino de borrado,
porque hay tres y dos son cascadas del ORM (`borrar_datos_dashboard` y `eliminar_dashboard` hacen
`.delete()` sobre el queryset, que no pasa por ningún `delete()` de instancia).
"""

import logging

from django.conf import settings
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import CargaArchivo

logger = logging.getLogger(__name__)


def _borrar_si_existe(ruta):
    try:
        ruta.unlink(missing_ok=True)
    except OSError:
        # Un archivo que no se pudo borrar (permisos, archivo en uso en Windows) no debe romper la
        # operación de negocio que lo originó — queda registrado para poder limpiarlo aparte.
        logger.warning('No se pudo eliminar el archivo de carga %s', ruta, exc_info=True)


@receiver(post_delete, sender=CargaArchivo, dispatch_uid='cartera_borrar_archivos_de_carga')
def borrar_archivos_de_carga(sender, instance, **kwargs):
    if instance.archivo_permanente_nombre:
        _borrar_si_existe(settings.CARTERA_ARCHIVOS_DIR / instance.archivo_permanente_nombre)
    if instance.archivo_temp_nombre:
        _borrar_si_existe(settings.CARTERA_TEMP_UPLOADS_DIR / instance.archivo_temp_nombre)
