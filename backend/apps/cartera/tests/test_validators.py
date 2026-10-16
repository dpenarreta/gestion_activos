import datetime as dt
from decimal import Decimal

from django.test import SimpleTestCase

from apps.cartera.services import validators


class ParsearSaldoTests(SimpleTestCase):
    def test_numero_simple(self):
        self.assertEqual(validators.parsear_saldo(172.39), Decimal('172.39'))

    def test_texto_con_simbolo_monetario(self):
        self.assertEqual(validators.parsear_saldo('$ 1,581,042.54'), Decimal('1581042.54'))

    def test_formato_regional_coma_decimal(self):
        self.assertEqual(validators.parsear_saldo('1.581.042,54'), Decimal('1581042.54'))

    def test_negativo(self):
        self.assertEqual(validators.parsear_saldo('-50.00'), Decimal('-50.00'))

    def test_no_numerico_devuelve_none(self):
        self.assertIsNone(validators.parsear_saldo('no aplica'))

    def test_none_devuelve_none(self):
        self.assertIsNone(validators.parsear_saldo(None))


class FilaVaciaTests(SimpleTestCase):
    def test_fila_completamente_vacia(self):
        self.assertTrue(validators.fila_esta_vacia([None, '', '   ', None]))

    def test_fila_con_algun_valor(self):
        self.assertFalse(validators.fila_esta_vacia([None, 'Cliente X', '']))


class AdvertenciasFilaTests(SimpleTestCase):
    def test_saldo_negativo(self):
        adv = validators.advertencias_de_fila(
            fecha_emision=None, fecha_vencimiento=dt.date(2026, 5, 1), fecha_compromiso_pago=None,
            saldo=Decimal('-10'), fecha_corte=dt.date(2026, 6, 30),
        )
        self.assertIn('SALDO_NEGATIVO', adv)

    def test_saldo_cero(self):
        adv = validators.advertencias_de_fila(
            fecha_emision=None, fecha_vencimiento=dt.date(2026, 5, 1), fecha_compromiso_pago=None,
            saldo=Decimal('0'), fecha_corte=dt.date(2026, 6, 30),
        )
        self.assertIn('SALDO_CERO', adv)

    def test_sin_fecha_vencimiento(self):
        adv = validators.advertencias_de_fila(
            fecha_emision=None, fecha_vencimiento=None, fecha_compromiso_pago=None,
            saldo=Decimal('10'), fecha_corte=dt.date(2026, 6, 30),
        )
        self.assertIn('SIN_FECHA_VENCIMIENTO', adv)

    def test_emision_posterior_a_vencimiento(self):
        adv = validators.advertencias_de_fila(
            fecha_emision=dt.date(2026, 6, 1), fecha_vencimiento=dt.date(2026, 5, 1), fecha_compromiso_pago=None,
            saldo=Decimal('10'), fecha_corte=dt.date(2026, 6, 30),
        )
        self.assertIn('FECHA_EMISION_POSTERIOR_A_VENCIMIENTO', adv)

    def test_vencimiento_extremadamente_futura(self):
        adv = validators.advertencias_de_fila(
            fecha_emision=None, fecha_vencimiento=dt.date(2035, 1, 1), fecha_compromiso_pago=None,
            saldo=Decimal('10'), fecha_corte=dt.date(2026, 6, 30),
        )
        self.assertIn('FECHA_VENCIMIENTO_EXTREMADAMENTE_FUTURA', adv)

    def test_sin_advertencias_fila_normal(self):
        adv = validators.advertencias_de_fila(
            fecha_emision=dt.date(2026, 5, 1), fecha_vencimiento=dt.date(2026, 6, 1), fecha_compromiso_pago=None,
            saldo=Decimal('100'), fecha_corte=dt.date(2026, 6, 30),
        )
        self.assertEqual(adv, [])


class DatasetLevelTests(SimpleTestCase):
    def test_ruc_con_nombres_distintos(self):
        registros = [
            {'ruc_cliente': '0900000001001', 'cliente': 'ACME COMERCIAL SA'},
            {'ruc_cliente': '0900000001001', 'cliente': 'ACME COMERCIAL S.A.'},
            {'ruc_cliente': '0900000002001', 'cliente': 'BETA SA'},
        ]
        advertencias = validators.detectar_ruc_con_nombres_distintos(registros)
        self.assertEqual(len(advertencias), 1)
        self.assertIn('0900000001001', advertencias[0])

    def test_documentos_duplicados(self):
        registros = [
            {'numero_documento': 'DOC-1'},
            {'numero_documento': 'DOC-1'},
            {'numero_documento': 'DOC-2'},
        ]
        advertencias = validators.detectar_documentos_duplicados(registros)
        self.assertEqual(len(advertencias), 1)
