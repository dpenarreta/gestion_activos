"""Histórico de archivos cargados (sección 28): `services/historico.py` y las vistas
`HistoricoCargasView`/`HistoricoTablaView`."""

import os

import pandas as pd
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.models import CargaArchivo, Dashboard, FilaArchivoHistorico
from apps.cartera.services import dashboards as dashboards_service
from apps.cartera.services import generic_charts
from apps.cartera.services import historico, plantilla

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'cartera_ejemplo.xlsx')
User = get_user_model()


def _crear_carga(dashboard_id='finanzas', subido_por=None):
    return CargaArchivo.objects.create(dashboard_id=dashboard_id, nombre_original='datos.xlsx', subido_por=subido_por)


def _guardar_todo(carga, df):
    """Atajo para los tests que no les interesa la feature de "solo columnas históricas": guarda
    TODAS las columnas del DataFrame como históricas, replicando el comportamiento previo a esa
    feature (fila completa)."""
    historico.guardar_filas_historicas(carga, df, list(df.columns))


class GuardarFilasHistoricasServiceTests(TestCase):
    def test_persiste_una_fila_historica_por_fila_del_dataframe(self):
        carga = _crear_carga()
        df = pd.DataFrame({'producto': ['A', 'B'], 'ventas': [100, 200]})

        _guardar_todo(carga, df)

        filas = list(FilaArchivoHistorico.objects.filter(carga=carga).order_by('orden'))
        self.assertEqual(len(filas), 2)
        self.assertEqual(filas[0].datos, {'producto': 'A', 'ventas': 100})
        self.assertEqual(filas[1].datos, {'producto': 'B', 'ventas': 200})

    def test_reaplicar_la_misma_carga_reemplaza_en_vez_de_duplicar(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({'ventas': [100]}))
        _guardar_todo(carga, pd.DataFrame({'ventas': [200, 300]}))

        filas = list(FilaArchivoHistorico.objects.filter(carga=carga).order_by('orden'))
        self.assertEqual(len(filas), 2)
        self.assertEqual([f.datos['ventas'] for f in filas], [200, 300])

    def test_valores_faltantes_se_guardan_como_null(self):
        carga = _crear_carga()
        df = pd.DataFrame({'ventas': [100, None]})

        _guardar_todo(carga, df)

        filas = list(FilaArchivoHistorico.objects.filter(carga=carga).order_by('orden'))
        self.assertIsNone(filas[1].datos['ventas'])

    def test_solo_guarda_las_columnas_marcadas_como_historicas(self):
        carga = _crear_carga()
        df = pd.DataFrame({'producto': ['A', 'B'], 'ventas': [100, 200], 'costo': [50, 60]})

        historico.guardar_filas_historicas(carga, df, ['ventas'])

        filas = list(FilaArchivoHistorico.objects.filter(carga=carga).order_by('orden'))
        self.assertEqual(len(filas), 2)
        self.assertEqual(filas[0].datos, {'ventas': 100})
        self.assertEqual(filas[1].datos, {'ventas': 200})

    def test_lista_vacia_no_guarda_ninguna_fila(self):
        carga = _crear_carga()
        historico.guardar_filas_historicas(carga, pd.DataFrame({'ventas': [100, 200]}), [])
        self.assertFalse(FilaArchivoHistorico.objects.filter(carga=carga).exists())

    def test_una_columna_marcada_que_ya_no_existe_en_el_archivo_se_ignora(self):
        carga = _crear_carga()
        df = pd.DataFrame({'ventas': [100]})

        historico.guardar_filas_historicas(carga, df, ['ventas', 'columna_que_no_existe'])

        filas = list(FilaArchivoHistorico.objects.filter(carga=carga))
        self.assertEqual(filas[0].datos, {'ventas': 100})

    def test_reaplicar_con_una_lista_distinta_de_columnas_reemplaza_las_anteriores(self):
        carga = _crear_carga()
        historico.guardar_filas_historicas(carga, pd.DataFrame({'ventas': [100], 'costo': [50]}), ['ventas', 'costo'])
        historico.guardar_filas_historicas(carga, pd.DataFrame({'ventas': [100], 'costo': [50]}), ['ventas'])

        filas = list(FilaArchivoHistorico.objects.filter(carga=carga))
        self.assertEqual(filas[0].datos, {'ventas': 100})


class ColumnasHistoricasConfiguradasServiceTests(TestCase):
    def test_establecer_y_leer(self):
        historico.establecer_columnas_historicas('finanzas', ['Ventas', 'Costo'])
        self.assertEqual(set(historico.columnas_historicas_configuradas('finanzas')), {'Ventas', 'Costo'})

    def test_establecer_reemplaza_la_configuracion_previa_en_vez_de_acumular(self):
        historico.establecer_columnas_historicas('finanzas', ['Ventas', 'Costo'])
        historico.establecer_columnas_historicas('finanzas', ['Ventas'])
        self.assertEqual(historico.columnas_historicas_configuradas('finanzas'), ['Ventas'])

    def test_lista_vacia_deja_la_configuracion_sin_ninguna_columna(self):
        historico.establecer_columnas_historicas('finanzas', ['Ventas'])
        historico.establecer_columnas_historicas('finanzas', [])
        self.assertEqual(historico.columnas_historicas_configuradas('finanzas'), [])

    def test_no_afecta_la_configuracion_de_otro_dashboard(self):
        historico.establecer_columnas_historicas('finanzas', ['Ventas'])
        historico.establecer_columnas_historicas('comercial', ['Costo'])
        self.assertEqual(historico.columnas_historicas_configuradas('finanzas'), ['Ventas'])

    def test_sin_configurar_devuelve_lista_vacia(self):
        self.assertEqual(historico.columnas_historicas_configuradas('finanzas'), [])


class CascadaBorradoTests(TestCase):
    def test_borrar_la_carga_borra_sus_filas_historicas(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({'ventas': [100]}))

        carga.delete()

        self.assertFalse(FilaArchivoHistorico.objects.filter(carga_id=carga.id).exists())

    def test_eliminar_dashboard_borra_las_filas_historicas_de_sus_cargas(self):
        dashboard = dashboards_service.crear_dashboard(nombre='Comercial')
        carga = CargaArchivo.objects.create(dashboard_id=dashboard.dashboard_id, nombre_original='datos.xlsx')
        _guardar_todo(carga, pd.DataFrame({'ventas': [100]}))

        dashboards_service.eliminar_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')

        self.assertFalse(FilaArchivoHistorico.objects.filter(carga_id=carga.id).exists())


class CalcularTablaHistoricaServiceTests(TestCase):
    def setUp(self):
        self.carga_enero = _crear_carga()
        self.carga_febrero = _crear_carga()
        _guardar_todo(self.carga_enero, pd.DataFrame({
            'producto': ['A', 'B', 'C'], 'ventas': [100, 200, 300], 'cliente': ['x', 'y', 'x'],
        }))
        _guardar_todo(self.carga_febrero, pd.DataFrame({
            'producto': ['A', 'B'], 'ventas': [500, 500],
        }))

    def test_suma_una_fila_por_carga_en_orden_cronologico(self):
        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'ventas', 'tipo_agregacion': 'suma'}],
        )
        self.assertEqual(resultado['columnas'], ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'ventas'])
        self.assertEqual(len(resultado['filas']), 2)
        self.assertEqual(resultado['filas'][0][-1], 600.0)  # enero: 100+200+300
        self.assertEqual(resultado['filas'][1][-1], 1000.0)  # febrero: 500+500

    def test_columna_usuario_muestra_quien_subio_cada_carga(self):
        ana = User.objects.create_user(username='ana', email='ana@example.com', password='Clave-Segura-123')
        carga_con_usuario = _crear_carga(subido_por=ana)
        carga_sin_usuario = _crear_carga()
        _guardar_todo(carga_con_usuario, pd.DataFrame({'ventas': [1]}))
        _guardar_todo(carga_sin_usuario, pd.DataFrame({'ventas': [2]}))

        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'ventas', 'tipo_agregacion': 'suma'}],
            carga_ids=[str(carga_con_usuario.id), str(carga_sin_usuario.id)],
        )

        indice_usuario = resultado['columnas'].index('Usuario')
        usuarios = [fila[indice_usuario] for fila in resultado['filas']]
        self.assertIn('ana', usuarios)
        self.assertIn('Desconocido', usuarios)

    def test_promedio(self):
        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'ventas', 'tipo_agregacion': 'promedio'}],
        )
        self.assertAlmostEqual(resultado['filas'][0][-1], 200.0)  # (100+200+300)/3
        self.assertAlmostEqual(resultado['filas'][1][-1], 500.0)

    def test_conteo_unicos(self):
        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'cliente', 'tipo_agregacion': 'conteo_unicos'}],
        )
        self.assertEqual(resultado['filas'][0][-1], 2.0)  # 'x', 'y' en enero
        self.assertEqual(resultado['filas'][1][-1], 0.0)  # 'cliente' no existe en febrero

    def test_carga_ids_filtra_a_solo_las_cargas_pedidas(self):
        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'ventas', 'tipo_agregacion': 'suma'}], carga_ids=[str(self.carga_enero.id)],
        )
        self.assertEqual(len(resultado['filas']), 1)
        self.assertEqual(resultado['filas'][0][-1], 600.0)

    def test_sin_carga_ids_excluye_las_cargas_deshabilitadas(self):
        historico.establecer_carga_incluida_en_historico(self.carga_febrero, False)

        resultado = historico.calcular_tabla_historica('finanzas', [{'columna': 'ventas', 'tipo_agregacion': 'suma'}])

        self.assertEqual(len(resultado['filas']), 1)
        self.assertEqual(resultado['filas'][0][-1], 600.0)  # solo enero

    def test_carga_ids_explicito_incluye_una_carga_deshabilitada(self):
        historico.establecer_carga_incluida_en_historico(self.carga_febrero, False)

        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'ventas', 'tipo_agregacion': 'suma'}], carga_ids=[str(self.carga_febrero.id)],
        )

        self.assertEqual(len(resultado['filas']), 1)
        self.assertEqual(resultado['filas'][0][-1], 1000.0)  # febrero, aunque esté deshabilitada

    def test_todas_habilitadas_por_defecto(self):
        resultado = historico.calcular_tabla_historica('finanzas', [{'columna': 'ventas', 'tipo_agregacion': 'suma'}])
        self.assertEqual(len(resultado['filas']), 2)

    def test_dos_columnas_con_distinto_tipo_de_agregacion(self):
        resultado = historico.calcular_tabla_historica('finanzas', [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'columna': 'ventas', 'tipo_agregacion': 'promedio'},
        ])
        self.assertEqual(resultado['filas'][0][-2], 600.0)
        self.assertAlmostEqual(resultado['filas'][0][-1], 200.0)

    def test_valor_celda_muestra_el_valor_cuando_es_igual_en_toda_la_carga(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({'zona': ['Norte', 'Norte', 'Norte']}))
        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'zona', 'tipo_agregacion': 'valor_celda'}], carga_ids=[str(carga.id)],
        )
        self.assertEqual(resultado['filas'][0][-1], 'Norte')

    def test_valor_celda_muestra_varios_cuando_la_carga_tiene_valores_distintos(self):
        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'cliente', 'tipo_agregacion': 'valor_celda'}], carga_ids=[str(self.carga_enero.id)],
        )
        self.assertEqual(resultado['filas'][0][-1], 'Varios')  # cliente: x, y, x -> distintos

    def test_valor_celda_en_columna_que_no_existe_para_esa_carga_queda_none(self):
        resultado = historico.calcular_tabla_historica(
            'finanzas', [{'columna': 'cliente', 'tipo_agregacion': 'valor_celda'}], carga_ids=[str(self.carga_febrero.id)],
        )
        self.assertIsNone(resultado['filas'][0][-1])


class CalcularKpiHistoricoServiceTests(TestCase):
    def setUp(self):
        self.carga_enero = _crear_carga()
        self.carga_febrero = _crear_carga()
        _guardar_todo(self.carga_enero, pd.DataFrame({'ventas': [100, 200, 300]}))
        _guardar_todo(self.carga_febrero, pd.DataFrame({'ventas': [500, 500]}))

    def test_toma_el_valor_de_la_carga_mas_reciente_no_la_suma_de_todas(self):
        valor = historico.calcular_kpi_historico('finanzas', 'ventas', 'suma')
        self.assertEqual(valor, 1000.0)  # febrero (500+500), NO 600+1000=1600

    def test_promedio(self):
        valor = historico.calcular_kpi_historico('finanzas', 'ventas', 'promedio')
        self.assertAlmostEqual(valor, 500.0)  # promedio de febrero, la más reciente

    def test_columna_sin_datos_historicos_con_promedio_devuelve_none(self):
        # A diferencia de "suma" (una columna ausente suma 0, mismo criterio que
        # `calcular_tabla_historica` ya usaba antes de esta función), "promedio" de ninguna fila
        # es NaN -> None, mismo criterio que ya prueba `test_valor_celda_en_columna_que_no_existe...`.
        valor = historico.calcular_kpi_historico('finanzas', 'no_existe', 'promedio')
        self.assertIsNone(valor)

    def test_sin_ninguna_carga_historica_devuelve_none(self):
        valor = historico.calcular_kpi_historico('otro-dashboard-sin-historico', 'ventas', 'suma')
        self.assertIsNone(valor)


class CalcularCategoricoHistoricoServiceTests(TestCase):
    def setUp(self):
        self.carga_enero = _crear_carga()
        self.carga_febrero = _crear_carga()
        _guardar_todo(self.carga_enero, pd.DataFrame({'ventas': [100, 200, 300]}))
        _guardar_todo(self.carga_febrero, pd.DataFrame({'ventas': [500, 500]}))

    def test_una_categoria_por_carga_en_orden_cronologico(self):
        resultado = historico.calcular_categorico_historico('finanzas', 'ventas', 'suma')
        self.assertEqual(resultado['categorias'], [self.carga_enero.nombre_original, self.carga_febrero.nombre_original])
        self.assertEqual(resultado['valores'], [600.0, 1000.0])

    def test_columna_sin_datos_historicos_da_valores_none_por_carga_sin_romper(self):
        # Sigue habiendo una categoría por carga (hay cargas históricas) — la columna elegida
        # simplemente no tiene datos guardados en ninguna, cada valor queda `None`.
        resultado = historico.calcular_categorico_historico('finanzas', 'no_existe', 'promedio')
        self.assertEqual(resultado['valores'], [None, None])

    def test_sin_ninguna_carga_historica_devuelve_none(self):
        self.assertIsNone(historico.calcular_categorico_historico('otro-dashboard-sin-historico', 'ventas', 'suma'))


class CalcularMultivalorHistoricoServiceTests(TestCase):
    def setUp(self):
        self.carga_enero = _crear_carga()
        self.carga_febrero = _crear_carga()
        _guardar_todo(self.carga_enero, pd.DataFrame({'ventas': [100, 200], 'costo': [10, 20]}))
        _guardar_todo(self.carga_febrero, pd.DataFrame({'ventas': [500], 'costo': [50]}))

    def test_una_serie_por_columna_de_valor_con_la_carga_como_categoria(self):
        resultado = historico.calcular_multivalor_historico('finanzas', ['ventas', 'costo'])
        self.assertEqual(resultado['categorias'], [self.carga_enero.nombre_original, self.carga_febrero.nombre_original])
        self.assertEqual(resultado['series'], [
            {'nombre': 'ventas', 'valores': [300.0, 500.0]},
            {'nombre': 'costo', 'valores': [30.0, 50.0]},
        ])

    def test_sin_columnas_valor_devuelve_none(self):
        self.assertIsNone(historico.calcular_multivalor_historico('finanzas', []))
        self.assertIsNone(historico.calcular_multivalor_historico('finanzas', None))


class CalcularMultiserieHistoricoServiceTests(TestCase):
    def setUp(self):
        self.carga_enero = _crear_carga()
        self.carga_febrero = _crear_carga()
        historico.guardar_filas_historicas(self.carga_enero, pd.DataFrame({
            'ventas': [100, 200, 50], 'region': ['Norte', 'Norte', 'Sur'],
        }), ['ventas', 'region'])
        historico.guardar_filas_historicas(self.carga_febrero, pd.DataFrame({
            'ventas': [300, 400], 'region': ['Norte', 'Sur'],
        }), ['ventas', 'region'])

    def test_una_serie_por_valor_distinto_de_columna_serie_agrupado_dentro_de_cada_carga(self):
        resultado = historico.calcular_multiserie_historico('finanzas', 'ventas', 'region', 'suma')
        self.assertEqual(resultado['categorias'], [self.carga_enero.nombre_original, self.carga_febrero.nombre_original])
        series_por_nombre = {s['nombre']: s['valores'] for s in resultado['series']}
        self.assertEqual(series_por_nombre['Norte'], [300.0, 300.0])  # enero: 100+200=300; febrero: 300
        self.assertEqual(series_por_nombre['Sur'], [50.0, 400.0])

    def test_columna_serie_no_historica_devuelve_none(self):
        self.assertIsNone(historico.calcular_multiserie_historico('finanzas', 'ventas', 'no_es_historica', 'suma'))

    def test_sin_ninguna_carga_historica_devuelve_none(self):
        self.assertIsNone(historico.calcular_multiserie_historico('otro-dashboard-sin-historico', 'ventas', 'region', 'suma'))


class EstablecerCargaIncluidaEnHistoricoServiceTests(TestCase):
    def test_deshabilita_y_rehabilita_una_carga(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({'ventas': [1]}))

        historico.establecer_carga_incluida_en_historico(carga, False)
        carga.refresh_from_db()
        self.assertFalse(carga.incluir_en_historico)

        historico.establecer_carga_incluida_en_historico(carga, True)
        carga.refresh_from_db()
        self.assertTrue(carga.incluir_en_historico)

    def test_no_borra_las_filas_historicas_al_deshabilitar(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({'ventas': [1, 2]}))

        historico.establecer_carga_incluida_en_historico(carga, False)

        self.assertEqual(FilaArchivoHistorico.objects.filter(carga=carga).count(), 2)

    def test_habilitada_por_defecto(self):
        carga = _crear_carga()
        self.assertTrue(carga.incluir_en_historico)


class ListarCargasHistoricasServiceTests(TestCase):
    def test_solo_incluye_cargas_con_filas_historicas(self):
        con_historico = _crear_carga()
        _guardar_todo(con_historico, pd.DataFrame({'ventas': [1]}))
        _crear_carga()  # nunca se aplicó a la plantilla -> sin filas históricas

        resultado = historico.listar_cargas_historicas('finanzas')

        self.assertEqual(len(resultado['cargas']), 1)
        self.assertEqual(resultado['cargas'][0]['carga_id'], str(con_historico.id))

    def test_incluye_incluir_en_historico_por_carga(self):
        habilitada = _crear_carga()
        deshabilitada = _crear_carga()
        _guardar_todo(habilitada, pd.DataFrame({'ventas': [1]}))
        _guardar_todo(deshabilitada, pd.DataFrame({'ventas': [1]}))
        historico.establecer_carga_incluida_en_historico(deshabilitada, False)

        resultado = historico.listar_cargas_historicas('finanzas')

        por_id = {c['carga_id']: c['incluir_en_historico'] for c in resultado['cargas']}
        self.assertTrue(por_id[str(habilitada.id)])
        self.assertFalse(por_id[str(deshabilitada.id)])

    def test_columnas_disponibles_es_la_configuracion_de_columnas_historicas_no_lo_guardado(self):
        # Aunque las filas guardadas tengan columnas distintas (p. ej. cargas de antes de esta
        # config, que persisten la fila completa), `columnas_disponibles` debe reflejar solo lo que
        # el usuario marcó a propósito como histórico — no lo que haya en `FilaArchivoHistorico`.
        carga_1 = _crear_carga()
        carga_2 = _crear_carga()
        _guardar_todo(carga_1, pd.DataFrame({'ventas': [1], 'costo': [1]}))
        _guardar_todo(carga_2, pd.DataFrame({'ventas': [1], 'unidades': [1]}))
        historico.establecer_columnas_historicas('finanzas', ['ventas'])

        resultado = historico.listar_cargas_historicas('finanzas')

        self.assertEqual(resultado['columnas_disponibles'], ['ventas'])

    def test_sin_columnas_historicas_configuradas_columnas_disponibles_queda_vacia(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({'ventas': [1], 'costo': [1]}))

        resultado = historico.listar_cargas_historicas('finanzas')

        self.assertEqual(resultado['columnas_disponibles'], [])

    def test_sin_ninguna_carga_historica_devuelve_listas_vacias(self):
        resultado = historico.listar_cargas_historicas('sin-datos')
        self.assertEqual(resultado, {'cargas': [], 'columnas_disponibles': []})


class ObtenerFilasArchivoServiceTests(TestCase):
    def test_devuelve_todas_las_columnas_y_filas_sin_agregar(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({
            'producto': ['A', 'B', 'C'], 'ventas': [100, 200, 300],
        }))

        resultado = historico.obtener_filas_archivo(carga)

        self.assertEqual(resultado['columnas'], ['producto', 'ventas'])
        self.assertEqual(resultado['filas'], [['A', 100], ['B', 200], ['C', 300]])

    def test_respeta_el_orden_original_de_las_filas(self):
        carga = _crear_carga()
        _guardar_todo(carga, pd.DataFrame({'producto': ['Z', 'A', 'M']}))

        resultado = historico.obtener_filas_archivo(carga)

        self.assertEqual([f[0] for f in resultado['filas']], ['Z', 'A', 'M'])

    def test_carga_sin_filas_historicas_devuelve_listas_vacias(self):
        carga = _crear_carga()
        resultado = historico.obtener_filas_archivo(carga)
        self.assertEqual(resultado, {'columnas': [], 'filas': []})


class HistoricoViewsApiTests(TestCase):
    """Extremo a extremo: subir y aplicar dos archivos reales al mismo dashboard y consultar el
    histórico resultante a través de las vistas."""

    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_historico', email='th@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        plantilla.sembrar_plantilla('finanzas')

    def _subir_y_aplicar(self, columnas_historicas=None):
        """Por defecto marca TODAS las columnas del archivo como históricas — preserva el
        comportamiento previo a la feature de columnas históricas (fila completa) para los tests
        que no les interesa esa selección puntualmente."""
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': 'finanzas'}, format='multipart')
        carga_id = resp.json()['carga_id']
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()
        if columnas_historicas is None:
            columnas_historicas = [c['nombre'] for c in sugerido['columnas']]
        self.client.post('/api/v1/cartera/plantilla/aplicar', {
            'carga_id': carga_id, 'mapeo': sugerido['mapeo'], 'columnas_historicas': columnas_historicas,
        }, format='json')
        return carga_id

    def test_aplicar_mapeo_guarda_filas_historicas(self):
        carga_id = self._subir_y_aplicar()
        self.assertTrue(FilaArchivoHistorico.objects.filter(carga_id=carga_id).exists())

    def test_aplicar_solo_guarda_las_columnas_marcadas_como_historicas(self):
        carga_id = self._subir_y_aplicar(columnas_historicas=['Saldo'])
        carga = CargaArchivo.objects.get(id=carga_id)
        resultado = historico.obtener_filas_archivo(carga)
        self.assertEqual(resultado['columnas'], ['Saldo'])

    def test_aplicar_persiste_la_configuracion_para_reconocerla_en_la_proxima_carga(self):
        self._subir_y_aplicar(columnas_historicas=['Saldo', 'Telefono'])
        resp = self.client.get('/api/v1/cartera/historico/cargas', {'dashboard_id': 'finanzas'})
        self.assertEqual(set(resp.json()['columnas_historicas_configuradas']), {'Saldo', 'Telefono'})

    def test_aplicar_de_nuevo_con_otra_seleccion_reemplaza_la_configuracion_anterior(self):
        self._subir_y_aplicar(columnas_historicas=['Saldo'])
        self._subir_y_aplicar(columnas_historicas=['Telefono'])
        resp = self.client.get('/api/v1/cartera/historico/cargas', {'dashboard_id': 'finanzas'})
        self.assertEqual(resp.json()['columnas_historicas_configuradas'], ['Telefono'])

    def test_listar_cargas_requiere_dashboard_id(self):
        resp = self.client.get('/api/v1/cartera/historico/cargas')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'DASHBOARD_ID_REQUERIDO')

    def test_listar_cargas_devuelve_la_carga_aplicada(self):
        carga_id = self._subir_y_aplicar()
        resp = self.client.get('/api/v1/cartera/historico/cargas', {'dashboard_id': 'finanzas'})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data['cargas']), 1)
        self.assertEqual(data['cargas'][0]['carga_id'], carga_id)
        self.assertIn('Saldo', data['columnas_disponibles'])

    def test_tabla_historica_agrega_saldo(self):
        # Suma de "Saldo" sobre las 15 filas del archivo tal cual se subieron (esta tabla NO
        # descarta filas inválidas como sí hace el flujo clásico de cartera — son pipelines
        # independientes; por eso el número no coincide con el KPI "cartera_total" de ese otro
        # flujo). 13 de las 15 filas tienen un Saldo numérico; `pd.to_numeric(errors='coerce')`
        # excluye las otras 2 automáticamente al sumar.
        self._subir_y_aplicar()
        resp = self.client.post('/api/v1/cartera/historico/tabla', {
            'dashboard_id': 'finanzas', 'columnas_valor': [{'columna': 'Saldo', 'tipo_agregacion': 'suma'}],
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['columnas'], ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'Saldo'])
        self.assertEqual(len(data['filas']), 1)
        self.assertEqual(data['filas'][0][1], 'tester_historico')  # quien subió el archivo en _subir_y_aplicar
        self.assertAlmostEqual(data['filas'][0][-1], 7401.25, places=2)

    def test_sin_acceso_al_dashboard_devuelve_403(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get('/api/v1/cartera/historico/cargas', {'dashboard_id': 'finanzas'})
        self.assertIn(resp.status_code, (401, 403))

    def test_ver_archivo_devuelve_todas_las_columnas_y_filas_de_esa_carga(self):
        carga_id = self._subir_y_aplicar()
        resp = self.client.get(f'/api/v1/cartera/historico/cargas/{carga_id}/archivo')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('Saldo', data['columnas'])
        self.assertEqual(len(data['filas']), 15)

    def test_ver_archivo_sin_acceso_al_dashboard_devuelve_403(self):
        carga_id = self._subir_y_aplicar()
        self.client.force_authenticate(user=None)
        resp = self.client.get(f'/api/v1/cartera/historico/cargas/{carga_id}/archivo')
        self.assertIn(resp.status_code, (401, 403))


class HistoricoCargaIncluidaViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_incluir', email='ti@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        self.carga = _crear_carga()
        _guardar_todo(self.carga, pd.DataFrame({'ventas': [1]}))

    def test_deshabilita_la_carga(self):
        resp = self.client.patch(f'/api/v1/cartera/historico/cargas/{self.carga.id}/incluir', {'incluir': False}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {'carga_id': str(self.carga.id), 'incluir_en_historico': False})
        self.carga.refresh_from_db()
        self.assertFalse(self.carga.incluir_en_historico)

    def test_rehabilita_la_carga(self):
        historico.establecer_carga_incluida_en_historico(self.carga, False)
        resp = self.client.patch(f'/api/v1/cartera/historico/cargas/{self.carga.id}/incluir', {'incluir': True}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['incluir_en_historico'])

    def test_sin_el_campo_incluir_devuelve_400(self):
        resp = self.client.patch(f'/api/v1/cartera/historico/cargas/{self.carga.id}/incluir', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'INCLUIR_REQUERIDO')

    def test_carga_inexistente_devuelve_404(self):
        import uuid
        resp = self.client.patch(f'/api/v1/cartera/historico/cargas/{uuid.uuid4()}/incluir', {'incluir': False}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_sin_acceso_al_dashboard_devuelve_403(self):
        self.client.force_authenticate(user=None)
        resp = self.client.patch(f'/api/v1/cartera/historico/cargas/{self.carga.id}/incluir', {'incluir': False}, format='json')
        self.assertIn(resp.status_code, (401, 403))


class HistoricoCasosBordeTests(TestCase):
    """Casos borde encontrados auditando el núcleo de cálculo."""

    def setUp(self):
        self.carga = _crear_carga()
        self.carga.incluir_en_historico = True
        self.carga.save(update_fields=['incluir_en_historico'])
        df = pd.DataFrame({'zona': ['norte', 'norte', 'sur'], 'saldo': [10, 20, 30]})
        _guardar_todo(self.carga, df)

    def test_una_entrada_sin_columna_elegida_no_desalinea_encabezados_y_celdas(self):
        """Regresión: las entradas sin columna se filtraban del encabezado pero igual aportaban un
        `None` por fila, así que `columnas` quedaba con 4 elementos y cada fila con 5 — la tabla se
        renderizaba corrida."""
        tabla = historico.calcular_tabla_historica('finanzas', [
            {'columna': None, 'tipo_agregacion': 'suma'},
            {'columna': 'saldo', 'tipo_agregacion': 'suma'},
        ])
        self.assertEqual(tabla['columnas'], ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'saldo'])
        for fila in tabla['filas']:
            self.assertEqual(len(fila), len(tabla['columnas']))
        self.assertEqual(tabla['filas'][0][-1], 60.0)

    def test_todas_las_entradas_sin_columna_dejan_la_tabla_solo_con_la_identidad(self):
        tabla = historico.calcular_tabla_historica('finanzas', [{'columna': None, 'tipo_agregacion': 'suma'}])
        self.assertEqual(tabla['columnas'], ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte'])
        for fila in tabla['filas']:
            self.assertEqual(len(fila), 4)

    def test_multiserie_historico_con_valor_celda_no_revienta(self):
        """Regresión: `valor_celda` devuelve el texto de la celda y el `float(...)` levantaba
        `ValueError: could not convert string to float`, que salía como un 500 al aplicar el
        mapeo. Un gráfico dibuja números, así que cae a "suma" — lo que hace siempre el multiserie
        no histórico."""
        resultado = historico.calcular_multiserie_historico('finanzas', 'saldo', 'zona', 'valor_celda')

        self.assertEqual(resultado['categorias'], ['datos.xlsx'])
        valores_por_serie = {s['nombre']: s['valores'] for s in resultado['series']}
        self.assertEqual(valores_por_serie['norte'], [30.0])
        self.assertEqual(valores_por_serie['sur'], [30.0])

    def test_multiserie_historico_con_suma_da_el_mismo_resultado(self):
        con_suma = historico.calcular_multiserie_historico('finanzas', 'saldo', 'zona', 'suma')
        con_celda = historico.calcular_multiserie_historico('finanzas', 'saldo', 'zona', 'valor_celda')
        self.assertEqual(con_suma, con_celda)


class HistoricoRendimientoYTopeTests(TestCase):
    """Consultas de la tabla histórica y tope de series del multiserie histórico."""

    def _cargas(self, dashboard_id, cantidad):
        CargaArchivo.objects.filter(dashboard_id=dashboard_id).delete()
        for i in range(cantidad):
            carga = CargaArchivo.objects.create(
                dashboard_id=dashboard_id, nombre_original=f'{i}.xlsx', incluir_en_historico=True,
            )
            _guardar_todo(carga, pd.DataFrame({'saldo': [1, 2]}))

    def test_el_numero_de_consultas_no_crece_con_la_cantidad_de_cargas(self):
        """Antes se consultaban las filas históricas una vez POR CARGA dentro del bucle: un
        dashboard con dos años de cargas mensuales eran 24 consultas para armar una tabla."""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        columnas = [{'columna': 'saldo', 'tipo_agregacion': 'suma'}]

        self._cargas('perf', 1)
        with CaptureQueriesContext(connection) as pocas:
            historico.calcular_tabla_historica('perf', columnas)

        self._cargas('perf', 6)
        with CaptureQueriesContext(connection) as muchas:
            resultado = historico.calcular_tabla_historica('perf', columnas)

        self.assertEqual(len(resultado['filas']), 6)
        self.assertEqual(len(pocas), len(muchas))

    def test_el_multiserie_historico_aplica_el_mismo_tope_de_series_que_el_normal(self):
        """Sin tope devolvía una serie por cada valor distinto de la columna (40 en el sondeo),
        con la leyenda inutilizable, mientras el gráfico equivalente sobre el archivo actual
        cortaba en 6."""
        carga = _crear_carga()
        carga.incluir_en_historico = True
        carga.save(update_fields=['incluir_en_historico'])
        df = pd.DataFrame({'serie': [f'S{i}' for i in range(40)], 'saldo': list(range(1, 41))})
        _guardar_todo(carga, df)

        resultado = historico.calcular_multiserie_historico('finanzas', 'saldo', 'serie')

        self.assertEqual(len(resultado['series']), generic_charts.MAX_SERIES_EN_GRAFICA + 1)
        self.assertEqual(resultado['series'][-1]['nombre'], 'Otras')
        # Nada se pierde: las series siguen sumando el total real de la carga.
        self.assertAlmostEqual(sum(s['valores'][0] for s in resultado['series']), float(df['saldo'].sum()), places=2)

    def test_con_pocas_series_el_multiserie_historico_no_agrega_otras(self):
        carga = _crear_carga()
        carga.incluir_en_historico = True
        carga.save(update_fields=['incluir_en_historico'])
        _guardar_todo(carga, pd.DataFrame({'serie': ['A', 'B'], 'saldo': [10, 20]}))

        resultado = historico.calcular_multiserie_historico('finanzas', 'saldo', 'serie')

        self.assertEqual([s['nombre'] for s in resultado['series']], ['A', 'B'])
