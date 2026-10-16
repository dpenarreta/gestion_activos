"""Siembra del Dashboard Directorio desde la carga que el dashboard ya tiene.

En local el dashboard se sembró desde el Excel del informe. En producción no hay tal archivo: los
datos llegan de un procedimiento de la base, el dashboard ya tiene su carga procesada, y esa carga
—además de nombrar distinto algunas columnas— puede no traer fecha de corte, porque ahí la fecha es
un parámetro del procedimiento y no una columna del resultado.

Lo que se protege acá es que sembrar desde esa carga produzca lo mismo que sembrar desde el archivo,
y que la fecha de corte no se pierda por el camino: sin ella la antigüedad se calcularía contra la
fecha de hoy y el informe titularía el mes equivocado.
"""

import uuid
from datetime import date
from io import StringIO

import pandas as pd
from django.conf import settings
from django.core.management import CommandError, call_command
from django.test import TestCase

from apps.cartera.models import CargaArchivo, DashboardComponent, DashboardLayout
from apps.cartera.services.carga_archivos import HOJA_ARCHIVO_PERMANENTE
from apps.cartera.utils.archivos import asegurar_directorio

DASHBOARD = 'directorio-produccion'
CORTE = date(2026, 9, 17)


def _df_produccion():
    """Las columnas tal como las nombra la vista de producción: "Saldo Total", y sin RUC."""
    return pd.DataFrame({
        'Cliente': ['ACME', 'ACME', 'BETA', 'GAMMA'],
        'Saldo Total': [1000.0, 500.0, 300.0, 200.0],
        'Fecha de Vencimiento': [
            date(2026, 10, 30), date(2026, 9, 1), date(2026, 1, 15), date(2026, 8, 1),
        ],
        'Número de Documento': ['F-1', 'F-2', 'F-3', 'F-4'],
    })


def _carga(fecha_corte=CORTE, df=None):
    df = _df_produccion() if df is None else df
    carga = CargaArchivo.objects.create(
        id=uuid.uuid4(), dashboard_id=DASHBOARD, nombre_original='vista.xlsx',
        estado=CargaArchivo.Estado.PROCESADO, fecha_corte=fecha_corte,
        total_filas_excel=len(df), filas_validas=len(df),
    )
    nombre = f'{carga.id}.xlsx'
    ruta = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre
    df.to_excel(ruta, index=False, sheet_name=HOJA_ARCHIVO_PERMANENTE)
    carga.archivo_permanente_nombre = nombre
    carga.save(update_fields=['archivo_permanente_nombre'])
    return carga


def _sembrar(**extra):
    salida = StringIO()
    opciones = {
        'dashboard': DASHBOARD, 'desde_carga': True, 'aplicar': True,
        'columna_valor': 'Saldo Total', 'stdout': salida,
    }
    opciones.update(extra)
    call_command('sembrar_directorio_cartera', **opciones)
    return salida.getvalue()


def _componentes():
    layout = DashboardLayout.objects.get(dashboard_id=DASHBOARD)
    return {c.component_id: c for c in DashboardComponent.objects.filter(layout=layout)}


class OrigenDeLosDatosTests(TestCase):
    def test_pide_elegir_un_origen(self):
        with self.assertRaises(CommandError) as ctx:
            call_command('sembrar_directorio_cartera', dashboard=DASHBOARD, stdout=StringIO())
        self.assertIn('--archivo', str(ctx.exception))

    def test_no_acepta_los_dos_origenes_a_la_vez(self):
        with self.assertRaises(CommandError):
            call_command('sembrar_directorio_cartera', dashboard=DASHBOARD,
                         archivo='x.xlsx', desde_carga=True, stdout=StringIO())

    def test_sin_carga_procesada_lo_dice_con_el_dashboard_que_reviso(self):
        with self.assertRaises(CommandError) as ctx:
            _sembrar()
        self.assertIn(DASHBOARD, str(ctx.exception))

    def test_una_columna_que_no_existe_se_informa_con_las_que_si(self):
        _carga()
        with self.assertRaises(CommandError) as ctx:
            _sembrar(columna_valor='Saldo')
        # El mensaje tiene que servir para corregir el comando sin ir a mirar la base.
        self.assertIn('Saldo', str(ctx.exception))
        self.assertIn('Saldo Total', str(ctx.exception))


class SiembraDesdeCargaTests(TestCase):
    def setUp(self):
        self.carga = _carga()

    def test_siembra_el_dashboard_con_los_datos_de_la_carga(self):
        _sembrar()
        componentes = _componentes()
        self.assertEqual(componentes['cartera-total'].content['valor'], 2000.0)
        self.assertTrue(componentes['consulta-deudor'].is_visible)

    def test_la_fecha_de_corte_sale_de_la_carga(self):
        _sembrar()
        self.assertEqual(_componentes()['cartera-total'].content['fecha_corte'], CORTE.isoformat())

    def test_las_columnas_elegidas_quedan_en_el_mapeo_de_cada_seccion(self):
        _sembrar()
        for component_id in ('cartera-total', 'antiguedad-de-cartera', 'consulta-deudor'):
            with self.subTest(seccion=component_id):
                self.assertEqual(_componentes()[component_id].mapeo['columna_valor'], 'Saldo Total')

    def test_no_registra_una_carga_nueva(self):
        # Sembrar desde la carga existente no es una carga de datos: duplicarla ensuciaría el
        # histórico y dejaría dos cargas con los mismos datos y distinto id.
        _sembrar()
        self.assertEqual(CargaArchivo.objects.filter(dashboard_id=DASHBOARD).count(), 1)

    def test_simula_sin_escribir_nada(self):
        salida = _sembrar(aplicar=False)
        self.assertIn('SIMULACIÓN', salida)
        self.assertFalse(DashboardComponent.objects.filter(layout__dashboard_id=DASHBOARD).exists())


class FechaDeCorteAusenteTests(TestCase):
    """Una carga que viene de una fuente de base puede no traer fecha de corte."""

    def setUp(self):
        self.carga = _carga(fecha_corte=None)

    def test_la_fecha_explicita_se_graba_en_la_carga(self):
        # Sin grabarla, `reprocesar_dashboards` relee la carga, encuentra `None` y borra el
        # "Corte <mes>" del informe además de recalcular la antigüedad contra la fecha de hoy.
        _sembrar(fecha_corte=CORTE.isoformat())
        self.carga.refresh_from_db()
        self.assertEqual(self.carga.fecha_corte, CORTE)
        self.assertEqual(_componentes()['cartera-total'].content['fecha_corte'], CORTE.isoformat())

    def test_simular_no_toca_la_carga(self):
        _sembrar(fecha_corte=CORTE.isoformat(), aplicar=False)
        self.carga.refresh_from_db()
        self.assertIsNone(self.carga.fecha_corte)


class ColumnaRucAusenteTests(TestCase):
    def setUp(self):
        _carga()

    def test_avisa_que_identificara_por_nombre(self):
        salida = _sembrar()
        self.assertIn('Ruc Cliente', salida)
        self.assertIn('nombre', salida)

    def test_se_puede_declarar_que_no_hay_ruc(self):
        _sembrar(columna_ruc='')
        self.assertEqual(_componentes()['consulta-deudor'].mapeo['columna_ruc'], '')
