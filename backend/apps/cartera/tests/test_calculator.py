import datetime as dt

import pandas as pd
from django.test import SimpleTestCase

from apps.cartera.services.calculator import _dias_vencidos, anotar_estado_y_mora, resumen_kpis
from apps.cartera.utils.dates import calcular_dias_vencidos, calcular_rango_mora, fecha_corte_por_defecto


class FechaCorteTests(SimpleTestCase):
    def test_ultimo_dia_del_mes_anterior(self):
        self.assertEqual(fecha_corte_por_defecto(dt.date(2026, 7, 29)), dt.date(2026, 6, 30))
        self.assertEqual(fecha_corte_por_defecto(dt.date(2026, 1, 15)), dt.date(2025, 12, 31))
        self.assertEqual(fecha_corte_por_defecto(dt.date(2024, 3, 1)), dt.date(2024, 2, 29))  # bisiesto


class RangoMoraTests(SimpleTestCase):
    def setUp(self):
        self.corte = dt.date(2026, 6, 30)

    def test_por_vencer(self):
        self.assertEqual(calcular_rango_mora(dt.date(2026, 7, 1), self.corte), 'POR VENCER')

    def test_rango_0_30(self):
        self.assertEqual(calcular_rango_mora(dt.date(2026, 6, 15), self.corte), '0-30 DÍAS')

    def test_rango_mayor_360(self):
        self.assertEqual(calcular_rango_mora(dt.date(2025, 1, 1), self.corte), 'MÁS DE 360 DÍAS')

    def test_sin_fecha(self):
        self.assertEqual(calcular_rango_mora(None, self.corte), 'SIN FECHA')

    def test_dias_vencidos(self):
        self.assertEqual(calcular_dias_vencidos(dt.date(2026, 2, 1), self.corte), 149)


def _df_ejemplo():
    corte = dt.date(2026, 6, 30)
    filas = [
        # saldo>0, vencida
        {'saldo': 500.0, 'fecha_vencimiento': dt.date(2026, 6, 1), 'identificador_cliente': 'A', 'numero_documento': 'D1'},
        # saldo>0, no vencida
        {'saldo': 300.0, 'fecha_vencimiento': dt.date(2026, 8, 1), 'identificador_cliente': 'A', 'numero_documento': 'D2'},
        # saldo>0, mayor a 120 y 360
        {'saldo': 2500.0, 'fecha_vencimiento': dt.date(2025, 5, 1), 'identificador_cliente': 'B', 'numero_documento': 'D3'},
        # sin fecha
        {'saldo': 150.75, 'fecha_vencimiento': pd.NaT, 'identificador_cliente': 'C', 'numero_documento': 'D4'},
        # saldo cero
        {'saldo': 0.0, 'fecha_vencimiento': dt.date(2026, 5, 1), 'identificador_cliente': 'D', 'numero_documento': 'D5'},
        # saldo negativo
        {'saldo': -50.0, 'fecha_vencimiento': dt.date(2026, 5, 1), 'identificador_cliente': 'E', 'numero_documento': 'D6'},
    ]
    return pd.DataFrame(filas), corte


class AnotarEstadoYMoraTests(SimpleTestCase):
    def test_clasificacion_por_fila(self):
        df, corte = _df_ejemplo()
        anotado = anotar_estado_y_mora(df, corte)
        estados = dict(zip(anotado['numero_documento'], anotado['estado_calculado']))
        self.assertEqual(estados['D1'], 'VENCIDA')
        self.assertEqual(estados['D2'], 'NO VENCIDA')
        self.assertEqual(estados['D3'], 'VENCIDA')
        self.assertEqual(estados['D4'], 'SIN FECHA DE VENCIMIENTO')
        self.assertEqual(estados['D5'], 'SALDO CERO')
        self.assertEqual(estados['D6'], 'SALDO A FAVOR')


class ResumenKpisTests(SimpleTestCase):
    def test_totales_y_porcentajes(self):
        df, corte = _df_ejemplo()
        resumen = resumen_kpis(df, corte)

        self.assertEqual(resumen['total_clientes'], 5)
        self.assertEqual(resumen['total_documentos'], 6)
        self.assertAlmostEqual(resumen['cartera_total'], 3450.75, places=2)
        self.assertAlmostEqual(resumen['cartera_vencida']['valor'], 3000.0, places=2)
        self.assertAlmostEqual(resumen['cartera_no_vencida']['valor'], 300.0, places=2)
        self.assertAlmostEqual(resumen['sin_fecha_vencimiento']['valor'], 150.75, places=2)
        self.assertAlmostEqual(resumen['mayor_120_dias']['valor'], 2500.0, places=2)
        self.assertAlmostEqual(resumen['mayor_360_dias']['valor'], 2500.0, places=2)
        self.assertEqual(resumen['mayor_360_dias']['clientes'], 1)

        suma_porcentajes = (
            resumen['cartera_vencida']['porcentaje']
            + resumen['cartera_no_vencida']['porcentaje']
            + resumen['sin_fecha_vencimiento']['porcentaje']
        )
        self.assertAlmostEqual(suma_porcentajes, 100.0, places=1)


class DiasVencidosTests(SimpleTestCase):
    """`_dias_vencidos` delega en `utils.dates.calcular_dias_vencidos` en vez de repetir la resta.

    Antes la repetía sin la conversión de `datetime`/`Timestamp` a `date`, así que con un valor de
    ese tipo lanzaba `TypeError`. No era alcanzable por el único llamador (que arma el DataFrame
    desde el ORM, que entrega `date`), pero cualquier DataFrame leído de Excel —donde pandas
    convierte las fechas a `datetime64`— rompía, y la columna vecina `rango_mora` sí lo toleraba.
    """

    CORTE = dt.date(2026, 8, 31)

    def test_acepta_date_datetime_y_timestamp_con_el_mismo_resultado(self):
        esperado = 30
        self.assertEqual(_dias_vencidos(dt.date(2026, 8, 1), self.CORTE), esperado)
        self.assertEqual(_dias_vencidos(dt.datetime(2026, 8, 1, 15, 30), self.CORTE), esperado)
        self.assertEqual(_dias_vencidos(pd.Timestamp('2026-08-01 15:30'), self.CORTE), esperado)

    def test_sin_fecha_devuelve_nan_y_no_none(self):
        """`resumen_kpis` compara la columna con `> DIAS_120`: un `None` en una columna de tipo
        object hace fallar esa comparación, un `NaN` en una columna float da False."""
        self.assertTrue(pd.isna(_dias_vencidos(None, self.CORTE)))
        self.assertTrue(pd.isna(_dias_vencidos(float('nan'), self.CORTE)))

    def test_una_columna_de_timestamps_no_rompe_anotar_estado_y_mora(self):
        df = pd.DataFrame({
            'fecha_vencimiento': pd.to_datetime(['2026-08-01', '2026-09-15']),
            'saldo': [100.0, 200.0],
            'identificador_cliente': ['a', 'b'],
            'numero_documento': ['1', '2'],
        })
        anotado = anotar_estado_y_mora(df, self.CORTE)
        self.assertEqual(anotado['dias_vencidos'].tolist(), [30, -15])
        self.assertEqual(anotado['estado_calculado'].tolist(), ['VENCIDA', 'NO VENCIDA'])


class SaldoPromedioPorClienteTests(SimpleTestCase):
    """Numerador y denominador tienen que describir la misma población."""

    CORTE = dt.date(2026, 8, 31)

    def _df(self, filas):
        return pd.DataFrame([
            {'identificador_cliente': c, 'numero_documento': d, 'saldo': s, 'fecha_vencimiento': self.CORTE}
            for c, d, s in filas
        ])

    def test_los_clientes_sin_saldo_positivo_no_diluyen_el_promedio(self):
        """`cartera_total` suma solo saldos positivos; antes el denominador contaba además a los
        clientes que solo tenían saldo cero o a favor, y el promedio salía hacia abajo."""
        df = self._df([('a', '1', 100.0), ('b', '2', 0.0), ('c', '3', -50.0)])
        kpis = resumen_kpis(df, self.CORTE)

        self.assertEqual(kpis['cartera_total'], 100.0)
        self.assertEqual(kpis['saldo_promedio_por_cliente'], 100.0)
        # El conteo de clientes del archivo se conserva como dato de encabezado.
        self.assertEqual(kpis['total_clientes'], 3)

    def test_promedio_normal_con_varios_clientes_con_saldo(self):
        df = self._df([('a', '1', 100.0), ('b', '2', 200.0)])
        self.assertEqual(resumen_kpis(df, self.CORTE)['saldo_promedio_por_cliente'], 150.0)

    def test_sin_ningun_saldo_positivo_el_promedio_es_cero(self):
        df = self._df([('a', '1', 0.0), ('b', '2', -10.0)])
        self.assertEqual(resumen_kpis(df, self.CORTE)['saldo_promedio_por_cliente'], 0.0)
