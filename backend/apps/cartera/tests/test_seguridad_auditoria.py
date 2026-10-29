"""Hallazgos de la auditoría de seguridad del 29/10/2026 en cartera: la búsqueda del detalle se
hace como texto literal (no como expresión regular) y un .xlsx que se descomprime de más se
rechaza antes de abrirlo."""

import io
import time
import zipfile
from types import SimpleNamespace
from unittest import mock

import pandas as pd
from django.test import SimpleTestCase

from apps.cartera.exceptions import CarteraError
from apps.cartera.services import excel_reader
from apps.cartera.views import _buscar_y_ordenar


def _request(**params):
    return SimpleNamespace(query_params=params)


def _df():
    return pd.DataFrame({
        'cliente': ['Comercial (Norte) S.A.', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', None],
        'ruc_cliente': ['1790012345001', '0999999999001', '0102030405001'],
        'numero_documento': ['FAC-001', 'FAC-002', 'FAC-003'],
    })


class BusquedaLiteralTests(SimpleTestCase):
    def test_un_parentesis_se_busca_como_texto_y_no_rompe(self):
        resultado = _buscar_y_ordenar(_df(), _request(buscar='(Norte'))
        self.assertEqual(list(resultado['numero_documento']), ['FAC-001'])

    def test_un_patron_de_backtracking_no_se_interpreta(self):
        inicio = time.monotonic()
        resultado = _buscar_y_ordenar(_df(), _request(buscar='(a+)+$'))
        self.assertTrue(resultado.empty)
        self.assertLess(time.monotonic() - inicio, 2)

    def test_sigue_sin_distinguir_mayusculas_y_tolera_vacios(self):
        resultado = _buscar_y_ordenar(_df(), _request(buscar='comercial'))
        self.assertEqual(list(resultado['numero_documento']), ['FAC-001'])

    def test_un_punto_no_es_comodin(self):
        resultado = _buscar_y_ordenar(_df(), _request(buscar='FAC.001'))
        self.assertTrue(resultado.empty)


def _xlsx_con_entrada_de(tamano):
    salida = io.BytesIO()
    with zipfile.ZipFile(salida, 'w', zipfile.ZIP_DEFLATED) as zip_:
        zip_.writestr('[Content_Types].xml', '<Types/>')
        zip_.writestr('xl/worksheets/sheet1.xml', b'0' * tamano)
    return salida.getvalue()


class TamanoDescomprimidoTests(SimpleTestCase):
    @mock.patch.object(excel_reader, 'MAX_BYTES_DESCOMPRIMIDOS', 1024 * 1024)
    def test_un_xlsx_que_se_descomprime_de_mas_se_rechaza(self):
        contenido = _xlsx_con_entrada_de(1024 * 1024 + 1)
        self.assertLess(len(contenido), 64 * 1024)
        with self.assertRaises(CarteraError) as ctx:
            excel_reader.validar_extension_y_firma('cartera.xlsx', contenido)
        self.assertEqual(ctx.exception.codigo, 'ARCHIVO_DEMASIADO_GRANDE')

    @mock.patch.object(excel_reader, 'MAX_BYTES_DESCOMPRIMIDOS', 1024 * 1024)
    def test_un_xlsx_dentro_del_limite_pasa(self):
        excel_reader.validar_extension_y_firma('cartera.xlsx', _xlsx_con_entrada_de(1000))  # no lanza

    def test_el_limite_por_defecto_es_holgado_para_un_archivo_real(self):
        self.assertGreaterEqual(excel_reader.MAX_BYTES_DESCOMPRIMIDOS, 100 * 1024 * 1024)
