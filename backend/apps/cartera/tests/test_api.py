import os

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.models import CargaArchivo, RegistroCartera

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'cartera_ejemplo.xlsx')
User = get_user_model()


class FlujoCompletoApiTests(TestCase):
    """Se autentica con un superusuario en `setUp`: desde la Fase 5 de la integración con
    skelleton_base, todos los endpoints de `cartera` exigen `IsAuthenticated` + `dashboard.view`
    (docs/integracion/decisions.md #6). Las pruebas de autorización dedicadas (401/403/200 y
    `ADMINISTRADOR_GENERAL`) viven en `test_dashboard_authorization.py`; aquí solo se preserva el
    comportamiento funcional ya existente."""

    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester', email='tester@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)

    def _validar_y_mapear(self):
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['total_filas_detectadas'], 15)

        mapeo = {}
        for campo in data['mapeo_sugerido']['obligatorios'] + data['mapeo_sugerido']['opcionales']:
            if campo['columna_detectada']:
                mapeo[campo['campo']] = campo['columna_detectada']
        return data['carga_id'], mapeo

    def _procesar(self, carga_id, mapeo):
        resp = self.client.post(
            '/api/v1/cartera/procesar',
            data={'carga_id': carga_id, 'mapeo': mapeo, 'fecha_corte': '2026-06-30'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def test_validar_rechaza_extension_no_permitida(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        archivo = SimpleUploadedFile('archivo.txt', b'contenido', content_type='text/plain')
        resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': archivo}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'EXTENSION_NO_PERMITIDA')

    def test_procesar_bloquea_si_falta_columna_obligatoria(self):
        carga_id, mapeo = self._validar_y_mapear()
        del mapeo['causal']
        resp = self.client.post(
            '/api/v1/cartera/procesar', data={'carga_id': carga_id, 'mapeo': mapeo}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'MAPEO_INCOMPLETO')

    def test_flujo_completo_y_kpis(self):
        carga_id, mapeo = self._validar_y_mapear()
        resultado = self._procesar(carga_id, mapeo)

        self.assertEqual(resultado['fecha_corte'], '2026-06-30')
        self.assertEqual(resultado['total_clientes'], 11)
        self.assertEqual(resultado['total_documentos'], 13)
        self.assertAlmostEqual(resultado['cartera_total'], 7451.25, places=2)
        self.assertAlmostEqual(resultado['cartera_vencida']['valor'], 6900.50, places=2)
        self.assertAlmostEqual(resultado['cartera_no_vencida']['valor'], 400.0, places=2)
        self.assertAlmostEqual(resultado['sin_fecha_vencimiento']['valor'], 150.75, places=2)
        self.assertEqual(resultado['mayor_120_dias']['clientes'], 2)
        self.assertEqual(resultado['mayor_360_dias']['clientes'], 1)

        resumen = resultado['resumen_validacion']
        self.assertEqual(resumen['filas_leidas'], 15)
        self.assertEqual(resumen['filas_validas'], 13)
        self.assertEqual(resumen['filas_descartadas'], 2)
        self.assertTrue(any('0900000001001' in a for a in resumen['advertencias_generales']))

        self.assertEqual(RegistroCartera.objects.filter(carga_id=carga_id).count(), 13)

        # Recuperador vacio normalizado
        beta = RegistroCartera.objects.get(numero_documento='DOC-0003')
        self.assertEqual(beta.recuperador, 'SIN RECUPERADOR ASIGNADO')
        self.assertEqual(beta.causal, 'SIN GESTIÓN')

    def test_endpoints_get_tras_procesar(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/resumen/{carga_id}')
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(f'/api/v1/cartera/top-clientes/{carga_id}')
        self.assertEqual(resp.status_code, 200)
        top = resp.json()
        self.assertGreater(len(top), 0)
        acme = next(c for c in top if c['ruc_cliente'] == '0900000001001')
        self.assertEqual(acme['documentos'], 3)

        resp = self.client.get(f'/api/v1/cartera/pareto-ciudades/{carga_id}')
        self.assertEqual(resp.status_code, 200)
        pareto = resp.json()
        self.assertAlmostEqual(pareto['ciudades'][-1]['porcentaje_acumulado'], 100.0, places=0)

        resp = self.client.get(f'/api/v1/cartera/causales/{carga_id}')
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(f'/api/v1/cartera/recuperadores-causales/{carga_id}', {'formato': 'matriz'})
        self.assertEqual(resp.status_code, 200)
        self.assertIn('porcentajes_gestion', resp.json())

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'page': 1, 'page_size': 5})
        self.assertEqual(resp.status_code, 200)
        detalle = resp.json()
        self.assertEqual(detalle['count'], 13)
        self.assertEqual(len(detalle['results']), 5)

    def test_filtro_por_ciudad(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'ciudad': 'QUITO', 'page_size': 100})
        data = resp.json()
        self.assertTrue(all(r['ciudad'] == 'QUITO' for r in data['results']))

    def test_filtro_multivalor_causal_otras(self):
        """El drill-down de 'OTRAS' envía una lista separada por comas: causal=PROBLEMA,CRUCE."""
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'causal': 'PROBLEMA,CRUCE', 'page_size': 100})
        data = resp.json()
        self.assertEqual(data['count'], 3)
        self.assertTrue(all(r['causal'] in ('PROBLEMA', 'CRUCE') for r in data['results']))

    def test_filtro_dias_vencidos_min_max(self):
        """Usado por el drill-down de las tarjetas KPI '> 120 días' / '> 360 días'."""
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {
            'fecha_corte': '2026-06-30', 'dias_vencidos_min': 121, 'page_size': 100,
        })
        data = resp.json()
        self.assertEqual(data['count'], 2)
        self.assertTrue(all(r['dias_vencidos'] >= 121 for r in data['results']))

    def test_filtro_rango_fecha_vencimiento(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {
            'fecha_vencimiento_desde': '2026-05-01', 'fecha_vencimiento_hasta': '2026-05-31', 'page_size': 100,
        })
        data = resp.json()
        self.assertEqual(data['count'], 7)
        for r in data['results']:
            self.assertGreaterEqual(r['fecha_vencimiento'], '2026-05-01')
            self.assertLessEqual(r['fecha_vencimiento'], '2026-05-31')

    def test_filtro_rango_fecha_emision(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {
            'fecha_emision_desde': '2026-01-01', 'fecha_emision_hasta': '2026-01-31', 'page_size': 100,
        })
        data = resp.json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['numero_documento'], 'DOC-0004')

    def test_filtro_rango_fecha_afecta_resumen_y_graficos(self):
        """El rango de fechas debe afectar por igual a los KPIs y a las agregaciones."""
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        params = {'fecha_vencimiento_desde': '2026-05-01', 'fecha_vencimiento_hasta': '2026-05-31'}

        resumen = self.client.get(f'/api/v1/cartera/resumen/{carga_id}', params).json()
        self.assertEqual(resumen['total_documentos'], 7)

        top_clientes = self.client.get(f'/api/v1/cartera/top-clientes/{carga_id}', params).json()
        total_top = sum(c['documentos'] for c in top_clientes)
        self.assertEqual(total_top, 7)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {
            'fecha_corte': '2026-06-30', 'dias_vencidos_min': 0, 'dias_vencidos_max': 30, 'page_size': 100,
        })
        data = resp.json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['numero_documento'], 'DOC-0001')

    def test_filtros_desconocidos_se_ignoran_sin_error(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        base = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'page_size': 100}).json()
        con_extra = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {
            'page_size': 100, 'campo_inexistente': 'DROP TABLE cartera;--', 'otro_no_permitido': '1',
        }).json()

        self.assertEqual(base['count'], con_extra['count'])

    def test_coherencia_entre_grafico_de_ciudad_y_detalle(self):
        """AC-CAR-008: la suma del detalle filtrado debe coincidir con el valor del gráfico."""
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        pareto = self.client.get(f'/api/v1/cartera/pareto-ciudades/{carga_id}', {'fecha_corte': '2026-06-30'}).json()
        quito = next(c for c in pareto['ciudades'] if c['ciudad'] == 'QUITO')

        detalle = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {
            'fecha_corte': '2026-06-30', 'estado_cartera': 'VENCIDA', 'ciudad': 'QUITO', 'page_size': 100,
        }).json()

        self.assertAlmostEqual(quito['saldo_vencido'], detalle['saldo_filtrado'], places=2)
        self.assertEqual(quito['documentos'], detalle['count'])

    def test_exportar_excel(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/exportar/{carga_id}', {'formato': 'xlsx'})
        self.assertEqual(resp.status_code, 200)
        self.assertIn('spreadsheetml', resp['Content-Type'])

    def test_exportar_csv(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/exportar/{carga_id}', {'formato': 'csv'})
        self.assertEqual(resp.status_code, 200)
        self.assertIn('text/csv', resp['Content-Type'])

    def test_exportar_con_formato_invalido_es_un_error_de_negocio(self):
        """Antes cualquier valor distinto de `csv` devolvía un .xlsx en silencio, así que un typo
        en el parámetro entregaba un archivo distinto del pedido sin ningún aviso."""
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/exportar/{carga_id}', {'formato': 'pdf'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'FORMATO_EXPORTACION_INVALIDO')
        self.assertEqual(resp.json()['detalles']['permitidos'], ['xlsx', 'csv'])

    def test_exportar_con_tipo_invalido_es_un_error_de_negocio(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/exportar/{carga_id}', {'tipo': 'resumen'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TIPO_EXPORTACION_INVALIDO')

    def test_page_size_no_permitido_usa_fallback_sin_error(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'page_size': 7})
        self.assertEqual(resp.status_code, 200)
        detalle = resp.json()
        self.assertEqual(detalle['page_size'], 10)
        self.assertLessEqual(len(detalle['results']), 10)

    def test_page_size_no_numerico_usa_fallback_sin_error(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'page_size': 'abc'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['page_size'], 10)

    def test_page_size_valido_se_respeta(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        for valor in (5, 10, 25, 50, 100):
            resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'page_size': valor})
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()['page_size'], valor)

    def test_page_no_numerico_usa_fallback_sin_error(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/detalle/{carga_id}', {'page': 'xyz'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['page'], 1)

    def test_eliminar_archivo_borra_registros(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.delete(f'/api/v1/cartera/archivo/{carga_id}')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(CargaArchivo.objects.filter(id=carga_id).exists())
        self.assertEqual(RegistroCartera.objects.filter(carga_id=carga_id).count(), 0)

    def test_recalcula_al_cambiar_fecha_corte(self):
        carga_id, mapeo = self._validar_y_mapear()
        self._procesar(carga_id, mapeo)

        resp = self.client.get(f'/api/v1/cartera/resumen/{carga_id}', {'fecha_corte': '2026-01-01'})
        resumen_enero = resp.json()
        resp = self.client.get(f'/api/v1/cartera/resumen/{carga_id}', {'fecha_corte': '2026-12-31'})
        resumen_diciembre = resp.json()

        self.assertNotEqual(resumen_enero['cartera_vencida']['valor'], resumen_diciembre['cartera_vencida']['valor'])
