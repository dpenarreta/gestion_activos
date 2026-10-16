"""SEC-20: el borrado de datos tiene que alcanzar al sistema de archivos.

Antes nada eliminaba de `CARTERA_ARCHIVOS_DIR`: `ArchivoView.delete` borraba solo el temporal y
`borrar_datos_dashboard` —la acción que exige escribir el nombre exacto del dashboard para
confirmar— borraba las filas de la base y dejaba los `.xlsx` con la cartera completa en disco,
indefinidamente. La limpieza vive ahora en una señal `post_delete` (`cartera/signals.py`) para
cubrir de una vez los tres caminos de borrado, incluidos los dos que son cascadas del ORM.
"""

import tempfile
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from apps.cartera.models import CargaArchivo, Dashboard
from apps.cartera.services.dashboards import borrar_datos_dashboard, eliminar_dashboard

User = get_user_model()

# `Path`, no str: los settings reales son `Path` y la señal compone rutas con `/`.
_DIR_ARCHIVOS = Path(tempfile.mkdtemp())
_DIR_TEMP = Path(tempfile.mkdtemp())


@override_settings(CARTERA_ARCHIVOS_DIR=_DIR_ARCHIVOS, CARTERA_TEMP_UPLOADS_DIR=_DIR_TEMP)
class BorradoDeArchivosEnDiscoTests(TestCase):
    def setUp(self):
        self.dashboard = Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas', area='Finanzas')
        self.actor = User.objects.create_superuser(
            username='admin', email='admin@example.com', password='Clave-Segura-123',
        )

    def _carga_con_archivos(self):
        carga = CargaArchivo.objects.create(
            dashboard_id='finanzas', nombre_original='apps.cartera.xlsx', nombre_hoja='Datos',
            tamano_bytes=10, estado=CargaArchivo.Estado.VALIDADO, total_filas_excel=1,
            archivo_temp_nombre='temporal.xlsx', archivo_permanente_nombre='permanente.xlsx',
        )
        permanente = settings.CARTERA_ARCHIVOS_DIR / carga.archivo_permanente_nombre
        temporal = settings.CARTERA_TEMP_UPLOADS_DIR / carga.archivo_temp_nombre
        permanente.write_bytes(b'datos reales de cartera')
        temporal.write_bytes(b'datos reales de cartera')
        return carga, permanente, temporal

    def test_eliminar_la_carga_borra_ambos_archivos(self):
        carga, permanente, temporal = self._carga_con_archivos()
        self.assertTrue(permanente.exists())

        carga.delete()

        self.assertFalse(permanente.exists())
        self.assertFalse(temporal.exists())

    def test_borrar_datos_del_dashboard_borra_los_archivos(self):
        """Este es el camino que más importaba: pide confirmación escrita y se presenta como el
        borrado definitivo de los datos del dashboard."""
        _, permanente, temporal = self._carga_con_archivos()

        borrar_datos_dashboard('finanzas', confirmacion_nombre='Finanzas', actor=self.actor)

        self.assertFalse(permanente.exists())
        self.assertFalse(temporal.exists())

    def test_eliminar_el_dashboard_borra_los_archivos_de_sus_cargas(self):
        _, permanente, temporal = self._carga_con_archivos()

        eliminar_dashboard('finanzas', confirmacion_nombre='Finanzas', actor=self.actor)

        self.assertFalse(permanente.exists())
        self.assertFalse(temporal.exists())

    def test_un_archivo_ya_inexistente_no_rompe_el_borrado(self):
        carga, permanente, _ = self._carga_con_archivos()
        permanente.unlink()

        carga.delete()  # no debe lanzar

        self.assertFalse(CargaArchivo.objects.filter(pk=carga.pk).exists())
