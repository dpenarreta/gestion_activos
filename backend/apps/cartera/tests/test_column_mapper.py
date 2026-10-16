from django.test import SimpleTestCase

from apps.cartera.services import column_mapper
from apps.cartera.utils.normalization import normalize_header


class NormalizeHeaderTests(SimpleTestCase):
    def test_variantes_equivalentes(self):
        variantes = ['Fecha Vencimiento', 'Fecha de vencimiento', 'FECHA DE VENCIMIENTO', 'fecha_vencimiento',
                     '  Fecha   de   Vencimiento  ']
        claves = {normalize_header(v) for v in variantes}
        # Todas deben normalizar a algo que contenga las mismas palabras clave.
        for clave in claves:
            self.assertIn('fecha', clave)
            self.assertIn('vencimiento', clave)


class DetectarMapeoTests(SimpleTestCase):
    def test_detecta_columnas_obligatorias_con_variantes(self):
        headers = [
            'Cliente', 'Ruc Cliente', 'numero_documento', 'FECHA DE VENCIMIENTO', 'Fecha de Emisión',
            'Saldo', 'Lugar Geografico', 'Vendedor 3', 'Causal', 'Vendedor / Ejecutivo Ventas',
        ]
        resultado = column_mapper.detectar_mapeo(headers)
        por_campo = {c['campo']: c for c in resultado['obligatorios']}

        self.assertEqual(por_campo['cliente']['columna_detectada'], 'Cliente')
        self.assertEqual(por_campo['ruc_cliente']['columna_detectada'], 'Ruc Cliente')
        self.assertEqual(por_campo['fecha_vencimiento']['columna_detectada'], 'FECHA DE VENCIMIENTO')
        self.assertEqual(por_campo['ciudad']['columna_detectada'], 'Lugar Geografico')
        self.assertEqual(por_campo['recuperador']['columna_detectada'], 'Vendedor 3')
        for campo in por_campo.values():
            self.assertEqual(campo['estado'], 'ENCONTRADA')

    def test_nunca_sugiere_vendedor_ejecutivo_como_recuperador(self):
        headers = ['Vendedor / Ejecutivo Ventas', 'Cliente', 'Saldo']
        resultado = column_mapper.detectar_mapeo(headers)
        recuperador = next(c for c in resultado['obligatorios'] if c['campo'] == 'recuperador')
        self.assertIsNone(recuperador['columna_detectada'])
        self.assertEqual(recuperador['estado'], 'NO_ENCONTRADA')

    def test_columna_faltante_marca_no_encontrada(self):
        headers = ['Cliente', 'Saldo']
        resultado = column_mapper.detectar_mapeo(headers)
        causal = next(c for c in resultado['obligatorios'] if c['campo'] == 'causal')
        self.assertIsNone(causal['columna_detectada'])
        self.assertEqual(causal['estado'], 'NO_ENCONTRADA')


class CamposFaltantesTests(SimpleTestCase):
    def test_bloquea_si_falta_un_obligatorio(self):
        mapeo = {
            'cliente': 'Cliente', 'ruc_cliente': 'Ruc Cliente', 'numero_documento': 'Documento',
            'fecha_vencimiento': 'Fecha de Vencimiento', 'fecha_emision': 'Fecha de Emisión',
            'saldo': 'Saldo', 'ciudad': 'Lugar Geográfico', 'recuperador': 'Vendedor 3',
            'causal': '',
        }
        faltantes = column_mapper.campos_obligatorios_faltantes(mapeo)
        self.assertEqual(faltantes, ['Causal'])

    def test_sin_faltantes_cuando_todo_mapeado(self):
        mapeo = {
            'cliente': 'Cliente', 'ruc_cliente': 'Ruc Cliente', 'numero_documento': 'Documento',
            'fecha_vencimiento': 'Fecha de Vencimiento', 'fecha_emision': 'Fecha de Emisión',
            'saldo': 'Saldo', 'ciudad': 'Lugar Geográfico', 'recuperador': 'Vendedor 3',
            'causal': 'Causal',
        }
        self.assertEqual(column_mapper.campos_obligatorios_faltantes(mapeo), [])
