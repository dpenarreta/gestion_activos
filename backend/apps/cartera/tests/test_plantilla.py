"""Plantilla fija de dashboard (`services/plantilla.py`): siembra al crear un dashboard, mapeo
automático de columnas de un archivo a las 13 posiciones fijas, y aplicación de ese mapeo."""

import os
from datetime import date, timedelta

import pandas as pd
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.models import CargaArchivo, Dashboard, DashboardComponent, FilaArchivoHistorico
from apps.cartera.services import generic_charts, historico, plantilla

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'cartera_ejemplo.xlsx')
User = get_user_model()


class SembrarPlantillaServiceTests(TestCase):
    def test_crea_las_13_posiciones_con_ids_fijos(self):
        plantilla.sembrar_plantilla('finanzas')
        componentes = {c.component_id: c for c in DashboardComponent.objects.filter(layout__dashboard_id='finanzas')}
        self.assertEqual(set(componentes.keys()), {slot['id'] for slot in plantilla.PLANTILLA_SLOTS})

    def test_los_kpi_traen_icono_y_color_fijos(self):
        plantilla.sembrar_plantilla('finanzas')
        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id='kpi-1')
        self.assertEqual(kpi_1.config['icono'], 'persona')
        self.assertEqual(kpi_1.styles['colorPrincipal'], '#2a78d6')

    def test_los_tipos_con_leyenda_traen_posicion_de_leyenda_por_defecto(self):
        plantilla.sembrar_plantilla('finanzas')
        grafico_3 = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id='grafico-3')
        self.assertEqual(grafico_3.chart_type, 'barras_agrupadas')
        self.assertEqual(grafico_3.config['leyenda_posicion'], 'abajo')

    def test_sembrar_dos_veces_no_duplica_componentes(self):
        plantilla.sembrar_plantilla('finanzas')
        plantilla.sembrar_plantilla('finanzas')
        total = DashboardComponent.objects.filter(layout__dashboard_id='finanzas').count()
        self.assertEqual(total, len(plantilla.PLANTILLA_SLOTS))

    def test_preserva_los_componentes_de_zona_personal_al_volver_a_sembrar(self):
        from apps.cartera.services import dashboard_layout as dl
        plantilla.sembrar_plantilla('finanzas')
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Mi KPI', 'columna_valor': 'x', 'columna_categoria': None,
            'datos': {'tipo': 'kpi', 'valor': 42.0}, 'zona': 'personal',
        })

        plantilla.sembrar_plantilla('finanzas')

        componentes = DashboardComponent.objects.filter(layout__dashboard_id='finanzas')
        self.assertEqual(componentes.count(), len(plantilla.PLANTILLA_SLOTS) + 1)
        personal = componentes.get(component_id='mi-kpi')
        self.assertEqual(personal.content['valor'], 42.0)
        self.assertEqual(personal.config['zona'], 'personal')
        self.assertEqual(personal.order, len(plantilla.PLANTILLA_SLOTS) + 1)


class SugerirMapeoServiceTests(TestCase):
    def _columnas(self, df):
        from apps.cartera.services import generic_charts
        return generic_charts.analizar_columnas(df)['columnas']

    def test_con_columnas_suficientes_todas_las_posiciones_quedan_disponibles(self):
        # tabla-3 necesita 3 columnas de categoría distintas -> el archivo trae 3 (región,
        # vendedor, producto) para que ninguna de las 13 posiciones caiga al dato ficticio.
        df = pd.DataFrame({
            'region': ['Norte', 'Sur', 'Centro', 'Norte', 'Sur'],
            'vendedor': ['A', 'B', 'A', 'B', 'A'],
            'producto': ['X', 'Y', 'X', 'Z', 'Y'],
            'ventas': [100, 200, 150, 50, 300],
            'costo': [50, 100, 75, 25, 150],
        })
        mapeo = plantilla.sugerir_mapeo(self._columnas(df))
        self.assertTrue(all(m['disponible'] for m in mapeo.values()), mapeo)

    def test_sin_columnas_categoricas_solo_los_kpi_quedan_disponibles(self):
        df = pd.DataFrame({'ventas': [100, 200, 150], 'costo': [50, 100, 75]})
        mapeo = plantilla.sugerir_mapeo(self._columnas(df))
        for i in range(1, 5):
            self.assertTrue(mapeo[f'kpi-{i}']['disponible'])
        for slot_id in ('grafico-1', 'grafico-3', 'tabla-1'):
            self.assertFalse(mapeo[slot_id]['disponible'])

    def test_es_deterministico(self):
        df = pd.DataFrame({
            'region': ['Norte', 'Sur', 'Centro'], 'ventas': [100, 200, 150], 'costo': [50, 100, 75],
        })
        columnas = self._columnas(df)
        self.assertEqual(plantilla.sugerir_mapeo(columnas), plantilla.sugerir_mapeo(columnas))

    def test_las_columnas_de_valor_de_tabla_traen_tipo_de_agregacion_suma_por_defecto(self):
        df = pd.DataFrame({
            'region': ['Norte', 'Sur', 'Centro'], 'ventas': [100, 200, 150], 'costo': [50, 100, 75],
        })
        mapeo = plantilla.sugerir_mapeo(self._columnas(df))
        for entrada in mapeo['tabla-1']['columnas_valor']:
            self.assertEqual(entrada, {'columna': entrada['columna'], 'tipo_agregacion': 'suma'})

    def test_incluye_el_chart_type_por_defecto_de_cada_grafico(self):
        df = pd.DataFrame({
            'region': ['Norte', 'Sur', 'Centro'], 'ventas': [100, 200, 150], 'costo': [50, 100, 75],
        })
        mapeo = plantilla.sugerir_mapeo(self._columnas(df))
        self.assertEqual(mapeo['grafico-1']['chart_type'], 'barras_verticales')
        self.assertEqual(mapeo['grafico-2']['chart_type'], 'lineas_multiples')
        self.assertEqual(mapeo['grafico-3']['chart_type'], 'barras_agrupadas')
        self.assertEqual(mapeo['grafico-4']['chart_type'], 'dona')
        self.assertEqual(mapeo['grafico-5']['chart_type'], 'pastel')


class CalcularDatosMapeoServiceTests(TestCase):
    def test_una_posicion_disponible_usa_datos_reales(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur', 'Norte'], 'ventas': [100, 200, 50]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'ventas'}}
        # El resto de posiciones no vienen en el mapeo -> caen al dato ficticio.
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 350.0)
        self.assertNotIn('tendencia', datos['kpi-1'])
        self.assertEqual(datos['kpi-2'], plantilla.datos_ficticios()['kpi-2'])

    def test_columna_inexistente_cae_al_dato_ficticio(self):
        df = pd.DataFrame({'ventas': [100, 200]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'no_existe'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1'], plantilla.datos_ficticios()['kpi-1'])

    def test_kpi_con_tipo_agregacion_conteo_unicos_cuenta_valores_distintos(self):
        df = pd.DataFrame({'cliente': ['Ana', 'Ana', 'Luis', 'Carlos']})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'cliente', 'tipo_agregacion': 'conteo_unicos'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 3)
        self.assertIn('Cantidad de valores únicos', datos['kpi-1']['descripcion'])

    def test_kpi_con_tipo_agregacion_promedio_calcula_la_media(self):
        df = pd.DataFrame({'saldo': [100, 200, 300]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo', 'tipo_agregacion': 'promedio'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 200.0)
        self.assertIn('Promedio de', datos['kpi-1']['descripcion'])

    def test_kpi_con_tipo_agregacion_promedio_ignora_valores_no_numericos(self):
        df = pd.DataFrame({'saldo': [100, 'no numérico', 300]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo', 'tipo_agregacion': 'promedio'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 200.0)

    def test_kpi_sin_tipo_agregacion_sigue_sumando_por_defecto(self):
        df = pd.DataFrame({'ventas': [100, 200, 50]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'ventas'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 350.0)
        self.assertIn('Suma de', datos['kpi-1']['descripcion'])

    def test_kpi_sin_formato_elegido_cae_a_numero_por_defecto(self):
        df = pd.DataFrame({'ventas': [100, 200, 50]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'ventas'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['formato'], 'numero')

    def test_kpi_con_formato_moneda_elegido_lo_usa_en_vez_de_numero(self):
        df = pd.DataFrame({'saldo': [100, 200, 50]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo', 'formato': 'moneda'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['formato'], 'moneda')

    def test_kpi_con_formato_se_respeta_tambien_con_promedio_y_conteo_unicos(self):
        df = pd.DataFrame({'saldo': [100, 200, 300]})
        mapeo_promedio = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo', 'tipo_agregacion': 'promedio', 'formato': 'moneda'}}
        self.assertEqual(plantilla.calcular_datos_mapeo(df, mapeo_promedio)['kpi-1']['formato'], 'moneda')
        mapeo_conteo = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo', 'tipo_agregacion': 'conteo_unicos', 'formato': 'porcentaje'}}
        self.assertEqual(plantilla.calcular_datos_mapeo(df, mapeo_conteo)['kpi-1']['formato'], 'porcentaje')

    def test_kpi_con_filtro_solo_suma_las_filas_que_coinciden(self):
        df = pd.DataFrame({
            'saldo': [100, 200, 50, 300],
            'causal': ['GESTIONANDO', 'PAGADO', 'GESTIONANDO', 'PAGADO'],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo',
            'columna_filtro': 'causal', 'valor_filtro': 'GESTIONANDO',
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 150.0)
        self.assertIn('donde "causal" es "GESTIONANDO"', datos['kpi-1']['descripcion'])

    def test_filtro_aplica_igual_a_una_grafica_no_solo_a_un_kpi(self):
        df = pd.DataFrame({
            'ventas': [100, 200, 50, 300],
            'region': ['Norte', 'Norte', 'Sur', 'Sur'],
            'causal': ['GESTIONANDO', 'PAGADO', 'GESTIONANDO', 'PAGADO'],
        })
        mapeo = {'grafico-1': {
            'disponible': True, 'columna_categoria': 'region', 'columna_valor': 'ventas',
            'columna_filtro': 'causal', 'valor_filtro': 'GESTIONANDO',
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(dict(zip(datos['grafico-1']['categorias'], datos['grafico-1']['valores'])), {'Norte': 100.0, 'Sur': 50.0})

    def test_filtro_sin_coincidencias_da_un_resultado_real_en_cero_no_el_dato_ficticio(self):
        df = pd.DataFrame({'saldo': [100, 200], 'causal': ['PAGADO', 'PAGADO']})
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'causal', 'valor_filtro': 'GESTIONANDO',
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 0.0)
        self.assertNotEqual(datos['kpi-1'], plantilla.datos_ficticios()['kpi-1'])

    def test_columna_de_filtro_inexistente_cae_al_dato_ficticio(self):
        df = pd.DataFrame({'saldo': [100, 200]})
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'no_existe', 'valor_filtro': 'X',
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1'], plantilla.datos_ficticios()['kpi-1'])

    def test_sin_filtro_elegido_la_descripcion_no_cambia(self):
        df = pd.DataFrame({'saldo': [100, 200]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertNotIn('donde', datos['kpi-1']['descripcion'])

    def test_kpi_con_filtro_dias_vencidos_mayor_solo_suma_filas_vencidas_hace_mas_de_n_dias(self):
        hoy = date.today()
        df = pd.DataFrame({
            'saldo': [100, 200, 300],
            'vencimiento': [
                (hoy - timedelta(days=45)).isoformat(),  # 45 días vencido -> pasa (> 30)
                (hoy - timedelta(days=10)).isoformat(),  # 10 días vencido -> no pasa
                (hoy - timedelta(days=30)).isoformat(),  # exactamente 30 -> no pasa con "mayor"
            ],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'mayor', 'dias_filtro': 30,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 100.0)

    def test_kpi_con_filtro_dias_vencidos_sin_operador_explicito_cae_a_mayor_por_defecto(self):
        # El selector de "Comparación" en la UI muestra "Mayor que (>)" preseleccionado apenas se
        # elige la columna de fecha, pero eso no persiste `operador_filtro` en el mapeo hasta que
        # el usuario lo toca a mano — el filtro debe comportarse igual que si `operador_filtro`
        # fuera `'mayor'` explícito, no como si no hubiera filtro en absoluto.
        hoy = date.today()
        df = pd.DataFrame({
            'saldo': [100, 200],
            'vencimiento': [(hoy - timedelta(days=45)).isoformat(), (hoy - timedelta(days=10)).isoformat()],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'dias_filtro': 30,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 100.0)

    def test_kpi_con_filtro_dias_vencidos_mayor_igual_incluye_el_limite_exacto(self):
        hoy = date.today()
        df = pd.DataFrame({
            'saldo': [100, 300],
            'vencimiento': [(hoy - timedelta(days=10)).isoformat(), (hoy - timedelta(days=30)).isoformat()],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'mayor_igual', 'dias_filtro': 30,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 300.0)

    def test_kpi_con_filtro_dias_vencidos_menor_solo_suma_filas_que_todavia_no_vencieron(self):
        hoy = date.today()
        df = pd.DataFrame({
            'saldo': [100, 200, 300],
            'vencimiento': [
                (hoy + timedelta(days=10)).isoformat(),  # todavía no vence (-10 días transcurridos) -> pasa (< 0)
                (hoy - timedelta(days=5)).isoformat(),  # ya vencido -> no pasa
                hoy.isoformat(),  # vence hoy (0 días transcurridos) -> no pasa con "menor" que 0
            ],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'menor', 'dias_filtro': 0,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 100.0)

    def test_kpi_con_filtro_dias_vencidos_menor_igual_incluye_el_limite_exacto(self):
        hoy = date.today()
        df = pd.DataFrame({
            'saldo': [100, 300],
            'vencimiento': [(hoy + timedelta(days=10)).isoformat(), hoy.isoformat()],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'menor_igual', 'dias_filtro': 0,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 400.0)

    def test_kpi_con_filtro_dias_vencidos_menor_excluye_fechas_invalidas_igual_que_mayor(self):
        hoy = date.today()
        df = pd.DataFrame({
            'saldo': [100, 200],
            'vencimiento': [(hoy + timedelta(days=10)).isoformat(), 'no es una fecha'],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'menor', 'dias_filtro': 0,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 100.0)

    def test_kpi_con_filtro_dias_vencidos_excluye_fechas_invalidas(self):
        hoy = date.today()
        df = pd.DataFrame({
            'saldo': [100, 200],
            'vencimiento': [(hoy - timedelta(days=45)).isoformat(), 'no es una fecha'],
        })
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'mayor', 'dias_filtro': 30,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['kpi-1']['valor'], 100.0)

    def test_filtro_dias_vencidos_en_una_grafica_no_aplica_solo_es_para_kpi(self):
        hoy = date.today()
        df = pd.DataFrame({
            'ventas': [100, 200],
            'region': ['Norte', 'Sur'],
            'vencimiento': [(hoy - timedelta(days=45)).isoformat(), (hoy - timedelta(days=5)).isoformat()],
        })
        mapeo = {'grafico-1': {
            'disponible': True, 'columna_categoria': 'region', 'columna_valor': 'ventas', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'mayor', 'dias_filtro': 30,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        # Ninguna fila coincide con `valor_filtro` (no se eligió) bajo el filtro de igualdad al que
        # cae un `calculo` que no es KPI -> sin filtro real aplicado, se ven ambas filas.
        self.assertEqual(dict(zip(datos['grafico-1']['categorias'], datos['grafico-1']['valores'])), {'Norte': 100.0, 'Sur': 200.0})

    def test_descripcion_con_filtro_dias_vencidos_menciona_la_comparacion(self):
        hoy = date.today()
        df = pd.DataFrame({'saldo': [100], 'vencimiento': [(hoy - timedelta(days=45)).isoformat()]})
        mapeo = {'kpi-1': {
            'disponible': True, 'columna_valor': 'saldo', 'columna_filtro': 'vencimiento',
            'tipo_filtro': 'dias_vencidos', 'operador_filtro': 'mayor', 'dias_filtro': 30,
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertIn('"vencimiento" son > 30', datos['kpi-1']['descripcion'])

    def test_tabla_calcula_columnas_filas_y_total(self):
        df = pd.DataFrame({
            'producto': ['A', 'A', 'B', 'C'],
            'ventas': [100, 50, 80, 60],
        })
        mapeo = {'tabla-1': {'disponible': True, 'columna_id': 'producto', 'columnas_valor': ['ventas']}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertEqual(datos['tabla-1']['columnas'], ['producto', 'ventas', '% del total'])
        self.assertEqual(datos['tabla-1']['total'][1], 290.0)

    def test_tabla_respeta_el_tipo_de_agregacion_elegido_por_columna(self):
        df = pd.DataFrame({
            'producto': ['A', 'A', 'B', 'C'],
            'ventas': [100, 50, 80, 60],
        })
        mapeo = {'tabla-1': {
            'disponible': True, 'columna_id': 'producto',
            'columnas_valor': [{'columna': 'ventas', 'tipo_agregacion': 'promedio'}],
        }}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        fila_a = next(f for f in datos['tabla-1']['filas'] if f[0] == 'A')
        self.assertEqual(fila_a[1], 75.0)

    def test_kpi_con_meta_adjunta_meta_al_contenido(self):
        df = pd.DataFrame({'saldo': [100, 200, 300]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo', 'meta_min': 700, 'meta_max': 1000}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertIn('meta', datos['kpi-1'])
        self.assertFalse(datos['kpi-1']['meta']['cumple'])

    def test_kpi_sin_meta_no_agrega_la_clave(self):
        df = pd.DataFrame({'saldo': [100, 200, 300]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'saldo'}}
        datos = plantilla.calcular_datos_mapeo(df, mapeo)
        self.assertNotIn('meta', datos['kpi-1'])


class TablaConUsaHistoricoTests(TestCase):
    """`calculo == 'tabla'` con `propuesta['usa_historico']` — en vez de leer `df` (el archivo
    actual), arma el contenido desde el histórico de cargas del dashboard
    (`historico.calcular_tabla_historica`, mismo cálculo que "Tabla 3"), vía
    `_contenido_tabla_historica`. Cubre tanto `calcular_contenido_por_calculo` (Zona Personal)
    como `calcular_datos_mapeo` (las 13 posiciones fijas, p. ej. tabla-1/tabla-2)."""

    def setUp(self):
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        carga_enero = CargaArchivo.objects.create(dashboard_id='finanzas', nombre_original='enero.xlsx')
        carga_febrero = CargaArchivo.objects.create(dashboard_id='finanzas', nombre_original='febrero.xlsx')
        historico.guardar_filas_historicas(carga_enero, pd.DataFrame({'saldo': [100, 200]}), ['saldo'])
        historico.guardar_filas_historicas(carga_febrero, pd.DataFrame({'saldo': [500]}), ['saldo'])
        # El `df` del archivo "actual" es intencionalmente distinto — si el cálculo lo llegara a
        # usar en vez del histórico, los tests de abajo fallarían con estos valores.
        self.df_actual = pd.DataFrame({'saldo': [999999]})

    def test_calcular_contenido_por_calculo_arma_una_fila_por_carga(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'tabla', 'Saldo histórico',
            {'usa_historico': True, 'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}]},
            dashboard_id='finanzas',
        )
        self.assertEqual(contenido['titulo'], 'Saldo histórico')
        self.assertEqual(contenido['columnas'], ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'saldo'])
        self.assertEqual([fila[-1] for fila in contenido['filas']], [300.0, 500.0])
        self.assertIsNone(contenido['total'])

    def test_calcular_contenido_por_calculo_sin_dashboard_id_devuelve_none(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'tabla', 'Saldo histórico',
            {'usa_historico': True, 'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}]},
        )
        self.assertIsNone(contenido)

    def test_calcular_contenido_por_calculo_sin_columnas_valor_devuelve_none(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'tabla', 'Saldo histórico', {'usa_historico': True}, dashboard_id='finanzas',
        )
        self.assertIsNone(contenido)

    def test_sin_usa_historico_sigue_leyendo_el_archivo_actual_como_siempre(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            pd.DataFrame({'cliente': ['A', 'B'], 'saldo': [10, 20]}), 'tabla', 'Detalle',
            {'columna_id': 'cliente', 'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}]},
            dashboard_id='finanzas',
        )
        self.assertEqual(sorted(fila[0] for fila in contenido['filas']), ['A', 'B'])
        self.assertEqual({fila[0]: fila[1] for fila in contenido['filas']}, {'A': 10.0, 'B': 20.0})

    def test_calcular_datos_mapeo_de_una_posicion_fija_usa_el_historico(self):
        mapeo = {'tabla-1': {
            'disponible': True, 'usa_historico': True,
            'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}],
        }}
        datos = plantilla.calcular_datos_mapeo(self.df_actual, mapeo, dashboard_id='finanzas')
        self.assertEqual([fila[-1] for fila in datos['tabla-1']['filas']], [300.0, 500.0])

    def test_calcular_datos_mapeo_sin_dashboard_id_cae_al_dato_ficticio(self):
        mapeo = {'tabla-1': {
            'disponible': True, 'usa_historico': True,
            'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}],
        }}
        datos = plantilla.calcular_datos_mapeo(self.df_actual, mapeo)
        self.assertEqual(datos['tabla-1'], plantilla.datos_ficticios()['tabla-1'])


class KpiChartMultivalorMultiserieConUsaHistoricoTests(TestCase):
    """`calculo in ('kpi', 'chart', 'multivalor', 'multiserie')` con `propuesta['usa_historico']`
    — mismo mecanismo que `TablaConUsaHistoricoTests`, extendido más allá de tablas. Cubre solo
    `calcular_contenido_por_calculo` (Zona Personal); `calcular_datos_mapeo` (posiciones fijas)
    reusa exactamente el mismo despacho interno (`_calcular_contenido_slot`), ya probado para
    'tabla' arriba — no hace falta repetirlo acá."""

    def setUp(self):
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        carga_enero = CargaArchivo.objects.create(dashboard_id='finanzas', nombre_original='enero.xlsx')
        carga_febrero = CargaArchivo.objects.create(dashboard_id='finanzas', nombre_original='febrero.xlsx')
        historico.guardar_filas_historicas(
            carga_enero, pd.DataFrame({'saldo': [100, 200], 'costo': [10, 20], 'region': ['Norte', 'Sur']}),
            ['saldo', 'costo', 'region'],
        )
        historico.guardar_filas_historicas(
            carga_febrero, pd.DataFrame({'saldo': [500], 'costo': [50], 'region': ['Norte']}),
            ['saldo', 'costo', 'region'],
        )
        # El `df` del archivo "actual" es intencionalmente distinto de los valores históricos — si
        # el cálculo lo llegara a usar en vez del histórico, estos tests fallarían con esos valores.
        self.df_actual = pd.DataFrame({'saldo': [999999], 'costo': [999999], 'region': ['Ninguna']})

    def test_kpi_toma_el_valor_de_la_carga_mas_reciente(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'kpi', 'Saldo', {'usa_historico': True, 'columna_valor': 'saldo'}, dashboard_id='finanzas',
        )
        self.assertEqual(contenido['valor'], 500.0)  # febrero, la más reciente — no 100+200+500
        self.assertEqual(contenido['formato'], 'numero')

    def test_kpi_respeta_formato_y_meta_igual_que_en_modo_normal(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'kpi', 'Saldo',
            {'usa_historico': True, 'columna_valor': 'saldo', 'formato': 'moneda', 'meta_min': 1000},
            dashboard_id='finanzas',
        )
        self.assertEqual(contenido['formato'], 'moneda')
        self.assertFalse(contenido['meta']['cumple'])  # 500 < 1000

    def test_kpi_sin_columna_valor_devuelve_none(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'kpi', 'Saldo', {'usa_historico': True}, dashboard_id='finanzas',
        )
        self.assertIsNone(contenido)

    def test_chart_arma_una_categoria_por_carga(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'chart', 'Saldo histórico', {'usa_historico': True, 'columna_valor': 'saldo'}, dashboard_id='finanzas',
        )
        self.assertEqual(contenido['categorias'], ['enero.xlsx', 'febrero.xlsx'])
        self.assertEqual(contenido['valores'], [300.0, 500.0])

    def test_multivalor_arma_una_serie_por_columna_con_la_carga_como_categoria(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'multivalor', 'Comparación',
            {'usa_historico': True, 'columnas_valor': ['saldo', 'costo']}, dashboard_id='finanzas',
        )
        self.assertEqual(contenido['categorias'], ['enero.xlsx', 'febrero.xlsx'])
        self.assertEqual(contenido['series'], [
            {'nombre': 'saldo', 'valores': [300.0, 500.0]},
            {'nombre': 'costo', 'valores': [30.0, 50.0]},
        ])

    def test_multiserie_arma_una_serie_por_valor_de_columna_serie(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'multiserie', 'Saldo por región',
            {'usa_historico': True, 'columna_valor': 'saldo', 'columna_serie': 'region'}, dashboard_id='finanzas',
        )
        self.assertEqual(contenido['categorias'], ['enero.xlsx', 'febrero.xlsx'])
        series_por_nombre = {s['nombre']: s['valores'] for s in contenido['series']}
        self.assertEqual(series_por_nombre['Norte'], [100.0, 500.0])
        self.assertEqual(series_por_nombre['Sur'], [200.0, None])

    def test_multiserie_sin_columna_serie_devuelve_none(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self.df_actual, 'multiserie', 'Saldo por región',
            {'usa_historico': True, 'columna_valor': 'saldo'}, dashboard_id='finanzas',
        )
        self.assertIsNone(contenido)

    def test_dispersion_ignora_usa_historico_sigue_leyendo_el_archivo_actual(self):
        # Dispersión queda fuera de alcance a propósito — `usa_historico` en su `propuesta` no
        # tiene ningún efecto, sigue leyendo `df` como siempre.
        contenido = plantilla.calcular_contenido_por_calculo(
            pd.DataFrame({'x': [1, 2], 'y': [3, 4]}), 'dispersion', 'Dispersión',
            {'usa_historico': True, 'columna_valor': 'x', 'columna_valor_y': 'y'}, dashboard_id='finanzas',
        )
        self.assertEqual(len(contenido['puntos']), 2)


class CalcularContenidoPorCalculoTramosYConcentracionTests(TestCase):
    """Los 3 `calculo` nuevos (`tramos_antiguedad`/`cumplimiento_metas`/`concentracion`) vía
    `calcular_contenido_por_calculo` — el camino que usa Zona Personal (`ComponentDataSection.jsx`
    /`AgregarComponentePersonalModal.jsx`), a diferencia de las 13 posiciones fijas."""

    def _df(self):
        hoy = date.today()
        return pd.DataFrame({
            'cliente': ['A', 'B', 'C'],
            'saldo': [500, 300, 200],
            'vencimiento': [
                (hoy - timedelta(days=5)).isoformat(),
                (hoy - timedelta(days=45)).isoformat(),
                (hoy - timedelta(days=150)).isoformat(),
            ],
        })

    def test_tramos_antiguedad_caso_feliz(self):
        contenido = plantilla.calcular_contenido_por_calculo(self._df(), 'tramos_antiguedad', 'Antigüedad', {
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo',
        })
        self.assertEqual(contenido['titulo'], 'Antigüedad')
        self.assertEqual(contenido['categorias'], generic_charts.ETIQUETAS_TRAMOS_ANTIGUEDAD)
        self.assertEqual(sum(contenido['valores']), 1000.0)

    def test_tramos_antiguedad_columna_faltante_devuelve_none(self):
        contenido = plantilla.calcular_contenido_por_calculo(self._df(), 'tramos_antiguedad', 'Antigüedad', {
            'columna_fecha': 'no_existe', 'columna_valor': 'saldo',
        })
        self.assertIsNone(contenido)

    def test_cumplimiento_metas_caso_feliz(self):
        contenido = plantilla.calcular_contenido_por_calculo(self._df(), 'cumplimiento_metas', 'Cumplimiento', {
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo',
            'metas': [{'meta_min': 5}],
        })
        self.assertEqual(contenido['columnas'], ['Tramo', 'saldo', '% acumulado', 'Resultado'])
        self.assertEqual(len(contenido['filas']), 6)
        self.assertIsNone(contenido['total'])

    def test_cumplimiento_metas_columna_faltante_devuelve_none(self):
        contenido = plantilla.calcular_contenido_por_calculo(self._df(), 'cumplimiento_metas', 'Cumplimiento', {
            'columna_fecha': 'vencimiento', 'columna_valor': 'no_existe',
        })
        self.assertIsNone(contenido)

    def test_concentracion_caso_feliz(self):
        contenido = plantilla.calcular_contenido_por_calculo(self._df(), 'concentracion', 'Concentración', {
            'columna_id': 'cliente', 'columna_valor': 'saldo', 'top_n': 2,
        })
        self.assertEqual(contenido['columnas'], ['cliente', 'saldo', '% del total', '% acumulado'])
        self.assertEqual(len(contenido['filas']), 3)
        self.assertEqual(contenido['total'], ['Total', 1000.0, 100.0, 100.0])

    def test_concentracion_columna_faltante_devuelve_none(self):
        contenido = plantilla.calcular_contenido_por_calculo(self._df(), 'concentracion', 'Concentración', {
            'columna_id': 'no_existe', 'columna_valor': 'saldo', 'top_n': 2,
        })
        self.assertIsNone(contenido)


class AplicarMapeoServiceTests(TestCase):
    def setUp(self):
        self.dashboard_id = 'finanzas'
        plantilla.sembrar_plantilla(self.dashboard_id)

    def test_sobreescribe_las_mismas_13_posiciones_sin_duplicar(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'ventas'}}

        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)

        componentes = DashboardComponent.objects.filter(layout__dashboard_id=self.dashboard_id)
        self.assertEqual(componentes.count(), len(plantilla.PLANTILLA_SLOTS))
        kpi_1 = componentes.get(component_id='kpi-1')
        self.assertEqual(kpi_1.content['valor'], 300.0)

    def test_preserva_los_componentes_de_zona_personal_al_reaplicar_el_mapeo(self):
        """Subir/reaplicar un archivo nuevo no debe borrar la Zona Personal: su contenido se
        preserva tal cual (no se recalcula contra el archivo nuevo, ver docstring de
        `_componentes_zona_personal`)."""
        from apps.cartera.services import dashboard_layout as dl
        dl.agregar_componente_generado(self.dashboard_id, {
            'titulo': 'Mi tabla personal', 'columna_valor': 'x', 'columna_categoria': None,
            'datos': {'tipo': 'kpi', 'valor': 7.0}, 'zona': 'personal',
        })

        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        plantilla.aplicar_mapeo(self.dashboard_id, df, {'kpi-1': {'disponible': True, 'columna_valor': 'ventas'}})

        componentes = DashboardComponent.objects.filter(layout__dashboard_id=self.dashboard_id)
        self.assertEqual(componentes.count(), len(plantilla.PLANTILLA_SLOTS) + 1)
        personal = componentes.get(component_id='mi-tabla-personal')
        self.assertEqual(personal.content['valor'], 7.0)
        self.assertEqual(personal.order, len(plantilla.PLANTILLA_SLOTS) + 1)

    def test_persiste_el_mapeo_de_cada_posicion_disponible(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'ventas', 'tipo_agregacion': 'suma'}}

        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)

        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='kpi-1')
        self.assertEqual(kpi_1.mapeo, mapeo['kpi-1'])
        # Una posición sin mapeo (cae al dato ficticio) no debe quedar con un mapeo fantasma.
        kpi_2 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='kpi-2')
        self.assertEqual(kpi_2.mapeo, {})

    def test_registra_auditoria(self):
        from apps.cartera.compat import AuditEvent
        from apps.cartera.tests.auditoria import eventos
        usuario = User.objects.create_user(username='ana2', email='ana2@example.com', password='Clave-Segura-123')
        df = pd.DataFrame({'ventas': [1, 2]})
        plantilla.aplicar_mapeo(self.dashboard_id, df, {}, actor=usuario)
        self.assertTrue(eventos.filter(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_TEMPLATE_APPLIED',
            actor=usuario, dashboard_id=self.dashboard_id,
        ).exists())

    def test_persiste_el_chart_type_elegido_cuando_es_compatible(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        mapeo = {'grafico-1': {
            'disponible': True, 'columna_categoria': 'region', 'columna_valor': 'ventas', 'chart_type': 'pastel',
        }}
        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)
        grafico_1 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='grafico-1')
        self.assertEqual(grafico_1.chart_type, 'pastel')
        # 'pastel' necesita leyenda, a diferencia del 'barras_verticales' original del slot.
        self.assertEqual(grafico_1.config['leyenda_posicion'], 'abajo')

    def test_un_chart_type_incompatible_con_el_calculo_cae_al_default_del_slot(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        mapeo = {'grafico-1': {
            'disponible': True, 'columna_categoria': 'region', 'columna_valor': 'ventas', 'chart_type': 'tabla',
        }}
        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)
        grafico_1 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='grafico-1')
        self.assertEqual(grafico_1.chart_type, 'barras_verticales')

    def test_sin_chart_type_elegido_usa_el_default_del_slot(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        mapeo = {'grafico-3': {
            'disponible': True, 'columna_categoria': 'region', 'columna_serie': 'region', 'columna_valor': 'ventas',
        }}
        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)
        grafico_3 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='grafico-3')
        self.assertEqual(grafico_3.chart_type, 'barras_agrupadas')

    def test_sembrar_no_se_ve_afectado_por_chart_type_de_un_mapeo_anterior(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        mapeo = {'grafico-1': {
            'disponible': True, 'columna_categoria': 'region', 'columna_valor': 'ventas', 'chart_type': 'dona',
        }}
        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)
        plantilla.sembrar_plantilla(self.dashboard_id)
        grafico_1 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='grafico-1')
        self.assertEqual(grafico_1.chart_type, 'barras_verticales')

    def test_barras_verticales_y_horizontales_son_compatibles_con_multivalor_se_persisten_aunque_el_contenido_siga_siendo_series(self):
        # Barras verticales/horizontales, pastel y dona son el mínimo que SIEMPRE debe estar
        # disponible en cualquier posición de gráfico, también en `multivalor`/`multiserie` (2+
        # columnas de valor) — mismo criterio que pastel/dona: el colapso a una sola columna por
        # categoría lo hace el frontend (`GenericChartRenderer`), este servicio solo respeta el
        # `chart_type` elegido sin tocar el contenido calculado.
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200], 'costo': [50, 80]})
        for chart_type in ('barras_verticales', 'barras_horizontales'):
            mapeo = {'grafico-2': {
                'disponible': True, 'columna_categoria': 'region', 'columnas_valor': ['ventas', 'costo'], 'chart_type': chart_type,
            }}
            plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)
            grafico_2 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='grafico-2')
            self.assertEqual(grafico_2.chart_type, chart_type)
            self.assertIn('series', grafico_2.content)

    def test_pastel_dona_son_compatibles_con_multivalor_se_persisten_aunque_el_contenido_siga_siendo_series(self):
        # Antes de esta feature, 'pastel'/'dona' no eran compatibles con 'multivalor' (2+ columnas
        # de valor) y `_chart_type_elegido` los descartaba, cayendo al default del slot — ahora sí
        # se respetan, aunque el contenido calculado siga siendo {categorias, series} (el colapso a
        # una sola porción por categoría lo hace el frontend, no este servicio).
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200], 'costo': [50, 80]})
        mapeo = {'grafico-2': {
            'disponible': True, 'columna_categoria': 'region', 'columnas_valor': ['ventas', 'costo'], 'chart_type': 'pastel',
        }}
        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)
        grafico_2 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='grafico-2')
        self.assertEqual(grafico_2.chart_type, 'pastel')
        self.assertIn('series', grafico_2.content)
        self.assertEqual(grafico_2.config['leyenda_posicion'], 'abajo')

    def test_pastel_dona_son_compatibles_con_multiserie(self):
        df = pd.DataFrame({'region': ['Norte', 'Sur'], 'vendedor': ['Ana', 'Ana'], 'ventas': [100, 200]})
        mapeo = {'grafico-3': {
            'disponible': True, 'columna_categoria': 'region', 'columna_serie': 'vendedor', 'columna_valor': 'ventas',
            'chart_type': 'dona',
        }}
        plantilla.aplicar_mapeo(self.dashboard_id, df, mapeo)
        grafico_3 = DashboardComponent.objects.get(layout__dashboard_id=self.dashboard_id, component_id='grafico-3')
        self.assertEqual(grafico_3.chart_type, 'dona')


class PersonalizacionAlReaplicarMapeoTests(TestCase):
    """Reaplicar un mapeo no puede devolver el dashboard al diseño de fábrica.

    `aplicar_mapeo` borra y recrea las 13 posiciones, y las reconstruía desde `PLANTILLA_SLOTS`:
    ancho, alto, orden, colores, título, visibilidad y configuración volvían a los valores de
    fábrica. No es un caso de borde — lo dispara cada actualización automática semanal/mensual
    (`fuente_bd_scheduler`), cada archivo nuevo y cada reconfiguración desde la pantalla, así que
    el diseño que el usuario armó desaparecía solo.
    """

    def setUp(self):
        self.dashboard_id = 'finanzas'
        plantilla.sembrar_plantilla(self.dashboard_id)
        self.df = pd.DataFrame({'region': ['Norte', 'Sur'], 'ventas': [100, 200]})
        self.mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'ventas'}}

    def _personalizar(self, component_id, **campos):
        DashboardComponent.objects.filter(
            layout__dashboard_id=self.dashboard_id, component_id=component_id,
        ).update(**campos)

    def _componente(self, component_id):
        return DashboardComponent.objects.get(
            layout__dashboard_id=self.dashboard_id, component_id=component_id,
        )

    def test_conserva_el_tamano(self):
        self._personalizar('kpi-1', width=12, height=400)
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        kpi_1 = self._componente('kpi-1')
        self.assertEqual((kpi_1.width, kpi_1.height), (12, 400))

    def test_conserva_el_orden_entre_posiciones(self):
        # Se invierten las dos primeras: el orden es de la persona, no del patrón Z de fábrica.
        self._personalizar('kpi-1', order=2)
        self._personalizar('kpi-2', order=1)
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        self.assertLess(self._componente('kpi-2').order, self._componente('kpi-1').order)

    def test_conserva_una_posicion_oculta(self):
        self._personalizar('grafico-6', is_visible=False)
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        self.assertFalse(self._componente('grafico-6').is_visible)

    def test_conserva_el_titulo_renombrado(self):
        componente = self._componente('kpi-1')
        self._personalizar('kpi-1', content={**componente.content, 'titulo': 'Cartera total'})
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        self.assertEqual(self._componente('kpi-1').content['titulo'], 'Cartera total')

    def test_conserva_todos_los_colores_no_solo_el_principal(self):
        self._personalizar('kpi-1', styles={'colorPrincipal': '#123456', 'colorTexto': '#abcdef'})
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        self.assertEqual(self._componente('kpi-1').styles,
                         {'colorPrincipal': '#123456', 'colorTexto': '#abcdef'})

    def test_conserva_la_posicion_de_la_leyenda(self):
        componente = self._componente('grafico-3')
        self._personalizar('grafico-3', config={**componente.config, 'leyenda_posicion': 'derecha'})
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        self.assertEqual(self._componente('grafico-3').config['leyenda_posicion'], 'derecha')

    def test_conserva_el_resto_de_la_configuracion(self):
        componente = self._componente('tabla-1')
        self._personalizar('tabla-1', config={**componente.config, 'page_size': 25})
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        self.assertEqual(self._componente('tabla-1').config['page_size'], 25)

    def test_la_descripcion_calculada_sigue_al_mapeo_nuevo(self):
        """La contracara: la descripción SÍ se recalcula. Es texto derivado del mapeo ("Suma de
        'ventas'."), así que congelarla dejaría la posición describiendo columnas que ya no usa."""
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        primera = self._componente('kpi-1').content['descripcion']
        otro_mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'region', 'tipo_agregacion': 'conteo'}}
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, otro_mapeo)
        self.assertNotEqual(self._componente('kpi-1').content['descripcion'], primera)

    def test_el_contenido_si_se_recalcula(self):
        # Conservar el diseño no puede significar conservar datos viejos.
        self._personalizar('kpi-1', width=12)
        plantilla.aplicar_mapeo(self.dashboard_id, self.df, self.mapeo)
        self.assertEqual(self._componente('kpi-1').content['valor'], 300.0)


class FlujoApiMapeoPlantillaTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_plantilla', email='tp@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        plantilla.sembrar_plantilla('finanzas')

    def _subir_archivo(self):
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': 'finanzas'}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        return resp.json()['carga_id']

    def test_sugerir_devuelve_mapeo_y_vista_previa(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('mapeo', data)
        self.assertIn('datos', data)
        self.assertEqual(set(data['mapeo'].keys()), {slot['id'] for slot in plantilla.PLANTILLA_SLOTS})

    def test_sugerir_incluye_las_columnas_con_valores_en_blanco_recurrentes(self):
        # El fixture real (15 filas) tiene columnas con 3+ blancos de forma natural: "Alterno
        # Cliente" y "OBSERVACION" totalmente vacías (15), "Fecha compromiso pago" y
        # "Observaciones" con 14, "VENCE" con 3 — y "Causal" con solo 2, que NO debe aparecer.
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json')
        data = resp.json()
        self.assertIn('columnas_con_blancos', data)
        por_columna = {c['columna']: c for c in data['columnas_con_blancos']}
        self.assertEqual(por_columna['Alterno Cliente']['cantidad_en_blanco'], 15)
        self.assertEqual(por_columna['OBSERVACION']['cantidad_en_blanco'], 15)
        self.assertEqual(por_columna['VENCE']['cantidad_en_blanco'], 3)
        self.assertNotIn('Causal', por_columna)
        # Cada fila de ejemplo trae con qué ubicarla.
        ejemplo = por_columna['VENCE']['filas_ejemplo'][0]
        self.assertIn('numero_fila', ejemplo)
        self.assertIn('referencia', ejemplo)

    def test_previsualizar_recalcula_los_datos_sin_persistir(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {
            'carga_id': carga_id, 'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Saldo'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('Suma de "Saldo"', data['datos']['kpi-1']['descripcion'])
        # No debe haber sobreescrito el layout (sigue con los datos ficticios de la siembra).
        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id='kpi-1')
        self.assertEqual(kpi_1.content, plantilla.datos_ficticios()['kpi-1'])

    def test_previsualizar_sin_mapeo_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'MAPEO_REQUERIDO')

    def test_aplicar_sobreescribe_el_layout_y_marca_la_carga_procesada(self):
        carga_id = self._subir_archivo()
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()

        resp = self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id, 'mapeo': sugerido['mapeo']}, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data['components']), len(plantilla.PLANTILLA_SLOTS))

        carga = CargaArchivo.objects.get(id=carga_id)
        self.assertEqual(carga.estado, CargaArchivo.Estado.PROCESADO)

    def test_aplicar_guarda_una_foto_del_mapeo_y_los_aliases_para_actualizaciones_automaticas(self):
        """`Dashboard.fuente_bd_ultimo_mapeo`/`fuente_bd_ultimo_aliases` — lo que
        `services/fuente_bd_scheduler.py` reaplica sin intervención humana en cada actualización
        automática de "Conectar vista de base de datos". Se guarda para CUALQUIER carga (no solo
        las que vinieron de una base de datos), es la foto más reciente disponible."""
        carga_id = self._subir_archivo()
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()

        self.client.post('/api/v1/cartera/plantilla/aplicar', {
            'carga_id': carga_id, 'mapeo': sugerido['mapeo'], 'aliases': {'Saldo': 'Monto'},
        }, format='json')

        dashboard = Dashboard.objects.get(dashboard_id='finanzas')
        self.assertEqual(dashboard.fuente_bd_ultimo_mapeo, sugerido['mapeo'])
        self.assertEqual(dashboard.fuente_bd_ultimo_aliases, {'Saldo': 'Monto'})

    def test_aplicar_respeta_el_chart_type_elegido_por_el_usuario(self):
        carga_id = self._subir_archivo()
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()
        mapeo = sugerido['mapeo']
        mapeo['grafico-1']['chart_type'] = 'barras_horizontales'

        resp = self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id, 'mapeo': mapeo}, format='json')
        self.assertEqual(resp.status_code, 200)
        grafico_1 = next(c for c in resp.json()['components'] if c['component_id'] == 'grafico-1')
        self.assertEqual(grafico_1['chart_type'], 'barras_horizontales')

    def test_previsualizar_con_tipo_agregacion_conteo_unicos(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {
            'carga_id': carga_id,
            'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Ruc Cliente', 'tipo_agregacion': 'conteo_unicos'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        datos = resp.json()['datos']['kpi-1']
        self.assertIn('Cantidad de valores únicos', datos['descripcion'])
        self.assertIsInstance(datos['valor'], int)

    def test_previsualizar_con_tipo_agregacion_promedio(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {
            'carga_id': carga_id,
            'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Saldo', 'tipo_agregacion': 'promedio'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        datos = resp.json()['datos']['kpi-1']
        self.assertIn('Promedio de', datos['descripcion'])

    def test_previsualizar_con_filtro_de_columna_y_valor(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {
            'carga_id': carga_id,
            'mapeo': {'kpi-1': {
                'disponible': True, 'columna_valor': 'Saldo',
                'columna_filtro': 'Causal', 'valor_filtro': 'GESTIONANDO',
            }},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('donde "Causal" es "GESTIONANDO"', resp.json()['datos']['kpi-1']['descripcion'])

    def test_valores_columna_devuelve_los_valores_distintos(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/valores-columna', {
            'carga_id': carga_id, 'columna': 'Causal',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('GESTIONANDO', data['valores'])
        self.assertEqual(data['valores'], sorted(data['valores']))

    def test_valores_columna_sin_columna_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/valores-columna', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_REQUERIDA')

    def test_valores_columna_inexistente_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/valores-columna', {
            'carga_id': carga_id, 'columna': 'no_existe',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_INVALIDA')

    def test_valores_columna_respeta_el_alias_elegido(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/valores-columna', {
            'carga_id': carga_id, 'columna': 'Motivo', 'aliases': {'Causal': 'Motivo'},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('GESTIONANDO', resp.json()['valores'])

    def test_duplicados_columna_devuelve_cantidad_y_ejemplos(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/duplicados-columna', {
            'carga_id': carga_id, 'columna': 'Causal',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('cantidad_valores_duplicados', data)
        self.assertIn('ejemplos', data)
        # "Causal" repite valores (GESTIONANDO/PAGADO) en el fixture de 15 filas.
        self.assertGreater(data['cantidad_valores_duplicados'], 0)

    def test_duplicados_columna_sin_columna_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/duplicados-columna', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_REQUERIDA')

    def test_duplicados_columna_inexistente_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/duplicados-columna', {
            'carga_id': carga_id, 'columna': 'no_existe',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_INVALIDA')

    def test_duplicados_columna_respeta_el_alias_elegido(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/duplicados-columna', {
            'carga_id': carga_id, 'columna': 'Motivo', 'aliases': {'Causal': 'Motivo'},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertGreater(resp.json()['cantidad_valores_duplicados'], 0)

    def test_duplicados_columna_sin_carga_id_devuelve_400(self):
        resp = self.client.post('/api/v1/cartera/plantilla/duplicados-columna', {'columna': 'Causal'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'CARGA_ID_REQUERIDO')

    def test_aplicar_sin_mapeo_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'MAPEO_REQUERIDO')

    def test_aplicar_guarda_una_copia_permanente_del_archivo(self):
        from django.conf import settings
        carga_id = self._subir_archivo()
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()
        self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id, 'mapeo': sugerido['mapeo']}, format='json')

        carga = CargaArchivo.objects.get(id=carga_id)
        self.assertTrue(carga.archivo_permanente_nombre)
        ruta = settings.CARTERA_ARCHIVOS_DIR / carga.archivo_permanente_nombre
        self.assertTrue(ruta.exists())

    def test_el_mapeo_sigue_funcionando_aunque_el_archivo_temporal_ya_no_exista(self):
        # Simula lo que hace `clean_temp_uploads` a las 24h (borra el archivo temporal): en vez
        # de tocar el archivo físico (bloqueado por el propio proceso en Windows justo después de
        # leerlo con pandas), apunta `archivo_temp_nombre` a una ruta que no existe — si
        # `_leer_archivo_temporal_de_carga` intentara leer de ahí, fallaría.
        carga_id = self._subir_archivo()
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()
        self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id, 'mapeo': sugerido['mapeo']}, format='json')

        carga = CargaArchivo.objects.get(id=carga_id)
        self.assertTrue(carga.archivo_permanente_nombre)
        carga.archivo_temp_nombre = 'no-existe.xlsx'
        carga.save(update_fields=['archivo_temp_nombre'])

        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {
            'carga_id': carga_id, 'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Saldo'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)


class FlujoApiPrevisualizarComponenteTests(TestCase):
    """`PrevisualizarMapeoComponenteView` — igual que `previsualizar` pero para UN componente que
    no es una de las 13 posiciones fijas (Zona Personal): recibe `calculo`/`titulo`/`mapeo` de un
    único componente, no un dict indexado por slot id."""

    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_previsualizar_comp', email='tpc@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        plantilla.sembrar_plantilla('finanzas')

    def _subir_archivo(self):
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': 'finanzas'}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        return resp.json()['carga_id']

    def test_previsualizar_componente_kpi_devuelve_contenido_recalculado(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar-componente', {
            'carga_id': carga_id, 'calculo': 'kpi', 'titulo': 'Mi KPI',
            'mapeo': {'disponible': True, 'columna_valor': 'Saldo'},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['contenido']['titulo'], 'Mi KPI')
        self.assertIn('Suma de "Saldo"', data['contenido']['descripcion'])
        self.assertIsInstance(data['contenido']['valor'], float)

    def test_previsualizar_componente_tabla_devuelve_columnas_y_filas(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar-componente', {
            'carga_id': carga_id, 'calculo': 'tabla', 'titulo': 'Detalle',
            'mapeo': {'disponible': True, 'columna_id': 'Cliente', 'columnas_valor': ['Saldo']},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        contenido = resp.json()['contenido']
        self.assertIn('columnas', contenido)
        self.assertIn('filas', contenido)

    def test_previsualizar_componente_columna_inexistente_devuelve_contenido_null(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar-componente', {
            'carga_id': carga_id, 'calculo': 'kpi', 'titulo': 'Mi KPI',
            'mapeo': {'disponible': True, 'columna_valor': 'Columna Que No Existe'},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['contenido'])

    def test_previsualizar_componente_no_persiste_nada(self):
        carga_id = self._subir_archivo()
        self.client.post('/api/v1/cartera/plantilla/previsualizar-componente', {
            'carga_id': carga_id, 'calculo': 'kpi', 'titulo': 'Mi KPI',
            'mapeo': {'disponible': True, 'columna_valor': 'Saldo'},
        }, format='json')
        self.assertEqual(DashboardComponent.objects.filter(layout__dashboard_id='finanzas').count(), len(plantilla.PLANTILLA_SLOTS))

    def test_previsualizar_componente_sin_calculo_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar-componente', {
            'carga_id': carga_id, 'titulo': 'Mi KPI', 'mapeo': {'disponible': True, 'columna_valor': 'Saldo'},
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'CALCULO_REQUERIDO')

    def test_previsualizar_componente_sin_mapeo_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar-componente', {
            'carga_id': carga_id, 'calculo': 'kpi', 'titulo': 'Mi KPI',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'MAPEO_REQUERIDO')

    def test_previsualizar_componente_sin_carga_id_devuelve_400(self):
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar-componente', {
            'calculo': 'kpi', 'titulo': 'Mi KPI', 'mapeo': {'disponible': True, 'columna_valor': 'Saldo'},
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'CARGA_ID_REQUERIDO')


class ArchivoActualDashboardViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_archivo', email='ta2@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        plantilla.sembrar_plantilla('finanzas')

    def _subir_archivo(self):
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': 'finanzas'}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        return resp.json()['carga_id']

    def test_sin_archivo_aplicado_no_esta_disponible(self):
        resp = self.client.post('/api/v1/cartera/plantilla/archivo-actual', {'dashboard_id': 'finanzas'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['disponible'])

    def test_tras_aplicar_un_mapeo_devuelve_el_archivo_y_sus_columnas(self):
        carga_id = self._subir_archivo()
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()
        self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id, 'mapeo': sugerido['mapeo']}, format='json')

        resp = self.client.post('/api/v1/cartera/plantilla/archivo-actual', {'dashboard_id': 'finanzas'}, format='json')

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['disponible'])
        self.assertEqual(data['carga_id'], carga_id)
        self.assertIn('Saldo', {c['nombre'] for c in data['columnas']})

    def test_sin_dashboard_id_devuelve_400(self):
        resp = self.client.post('/api/v1/cartera/plantilla/archivo-actual', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'DASHBOARD_ID_REQUERIDO')

    def test_aplicar_dos_veces_no_duplica_componentes(self):
        carga_id = self._subir_archivo()
        sugerido = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json').json()
        self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id, 'mapeo': sugerido['mapeo']}, format='json')
        resp = self.client.post('/api/v1/cartera/plantilla/aplicar', {'carga_id': carga_id, 'mapeo': sugerido['mapeo']}, format='json')
        self.assertEqual(len(resp.json()['components']), len(plantilla.PLANTILLA_SLOTS))


class AliasColumnasApiTests(TestCase):
    """El paso "renombrar columnas" (antes del mapeo): `aliases` ({nombre_original: nuevo_nombre})
    renombra el archivo antes de analizarlo, así que el resto del flujo (columnas devueltas,
    mapeo, datos calculados, títulos/descripciones) usa el nuevo nombre como si fuera el
    original."""

    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_alias', email='ta@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        plantilla.sembrar_plantilla('finanzas')

    def _subir_archivo(self):
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': 'finanzas'}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        return resp.json()['carga_id']

    def test_sugerir_aplica_el_alias_a_las_columnas_devueltas(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {
            'carga_id': carga_id, 'aliases': {'Saldo': 'Monto Adeudado'},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        nombres = {c['nombre'] for c in resp.json()['columnas']}
        self.assertIn('Monto Adeudado', nombres)
        self.assertNotIn('Saldo', nombres)

    def test_previsualizar_calcula_contra_el_nombre_renombrado(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {
            'carga_id': carga_id,
            'aliases': {'Saldo': 'Monto Adeudado'},
            'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Monto Adeudado'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('Monto Adeudado', resp.json()['datos']['kpi-1']['descripcion'])

    def test_aplicar_persiste_el_componente_con_el_nombre_renombrado(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/aplicar', {
            'carga_id': carga_id,
            'aliases': {'Saldo': 'Monto Adeudado'},
            'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Monto Adeudado'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id='kpi-1')
        self.assertIn('Monto Adeudado', kpi_1.content['descripcion'])

    def test_un_alias_repetido_en_dos_columnas_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {
            'carga_id': carga_id, 'aliases': {'Saldo': 'Mismo Nombre', 'Telefono': 'Mismo Nombre'},
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'ALIAS_DUPLICADO')

    def test_sin_aliases_se_comporta_igual_que_antes(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('Saldo', {c['nombre'] for c in resp.json()['columnas']})


class ValoresBlancosApiTests(TestCase):
    """El paso "valores en blanco" (entre renombrar y mapeo, para columnas con más de 10 blancos):
    `valores_blancos` ({columna: valor_de_reemplazo}) completa esas celdas antes de analizar,
    igual que `aliases` renombra columnas — afecta de verdad los cálculos, no es una etiqueta de
    vista. "Alterno Cliente" del fixture tiene sus 15 filas en blanco (columna totalmente vacía),
    ideal para probar el reemplazo sin ambigüedad."""

    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_blancos', email='tb@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')
        plantilla.sembrar_plantilla('finanzas')

    def _subir_archivo(self):
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': 'finanzas'}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        return resp.json()['carga_id']

    def test_sugerir_con_valores_blancos_completa_la_columna(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {
            'carga_id': carga_id, 'valores_blancos': {'Alterno Cliente': '5'},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        columna = next(c for c in resp.json()['columnas'] if c['nombre'] == 'Alterno Cliente')
        self.assertEqual(columna['valores_no_nulos'], 15)
        self.assertTrue(columna['apta_para_valor'])

    def test_columna_sin_valor_elegido_no_se_toca(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {
            'carga_id': carga_id, 'valores_blancos': {'OBSERVACION': '5'},
        }, format='json')
        columna = next(c for c in resp.json()['columnas'] if c['nombre'] == 'Alterno Cliente')
        self.assertEqual(columna['valores_no_nulos'], 0)

    def test_un_valor_en_blanco_vacio_no_reemplaza(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/sugerir', {
            'carga_id': carga_id, 'valores_blancos': {'Alterno Cliente': '   '},
        }, format='json')
        columna = next(c for c in resp.json()['columnas'] if c['nombre'] == 'Alterno Cliente')
        self.assertEqual(columna['valores_no_nulos'], 0)

    def test_previsualizar_incluye_el_reemplazo_en_la_suma(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/previsualizar', {
            'carga_id': carga_id,
            'valores_blancos': {'Alterno Cliente': '100'},
            'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Alterno Cliente'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['datos']['kpi-1']['valor'], 1500)  # 15 filas x 100

    def test_aplicar_persiste_el_reemplazo_en_el_kpi_el_archivo_permanente_y_el_historico(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/plantilla/aplicar', {
            'carga_id': carga_id,
            'valores_blancos': {'Alterno Cliente': '7'},
            'columnas_historicas': ['Alterno Cliente'],
            'mapeo': {'kpi-1': {'disponible': True, 'columna_valor': 'Alterno Cliente'}},
        }, format='json')
        self.assertEqual(resp.status_code, 200)

        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id='kpi-1')
        self.assertEqual(kpi_1.content['valor'], 105)  # 15 filas x 7

        carga = CargaArchivo.objects.get(id=carga_id)
        filas = FilaArchivoHistorico.objects.filter(carga=carga)
        self.assertEqual(filas.count(), 15)
        self.assertTrue(all(f.datos.get('Alterno Cliente') == '7' for f in filas))

        # El reemplazo queda fijado en el archivo permanente: una consulta posterior sin volver a
        # mandar `valores_blancos` ya lo ve completo.
        resp2 = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json')
        columna2 = next(c for c in resp2.json()['columnas'] if c['nombre'] == 'Alterno Cliente')
        self.assertEqual(columna2['valores_no_nulos'], 15)


class AntiguedadContraLaFechaDeCorteTests(TestCase):
    """La antigüedad se mide contra la fecha de corte de la carga, no contra el día en que se mira
    el dashboard.

    Antes usaba siempre `date.today()`: un archivo de junio seguía envejeciendo en septiembre
    aunque no hubiera cambiado —los tramos se vaciaban solos hacia "+120 días" y un "Cumple" del
    cumplimiento de metas podía darse vuelta de un día para el otro— y convivían dos nociones de
    "vencido" en la misma pantalla, porque los KPIs de cartera siempre midieron contra la fecha de
    corte.
    """

    CORTE = date(2026, 6, 30)

    def _df(self):
        return pd.DataFrame({
            'vencimiento': [
                (self.CORTE - timedelta(days=10)).isoformat(),
                (self.CORTE - timedelta(days=200)).isoformat(),
            ],
            'saldo': [100, 50],
        })

    def test_los_tramos_se_calculan_desde_la_fecha_de_corte(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self._df(), 'tramos_antiguedad', 'Antigüedad',
            {'columna_fecha': 'vencimiento', 'columna_valor': 'saldo'}, None, self.CORTE,
        )
        por_tramo = dict(zip(contenido['categorias'], contenido['valores']))

        # Vencido hace 10 días RESPECTO DE LA FECHA DE CORTE.
        self.assertEqual(por_tramo['30 días'], 100.0)
        self.assertEqual(por_tramo['+120 días'], 50.0)

    def test_el_resultado_no_depende_del_dia_en_que_se_calcula(self):
        """Dos fechas de corte distintas sobre el mismo archivo dan tramos distintos, que es el
        comportamiento correcto; lo que no puede pasar es que el resultado cambie solo."""
        df = self._df()
        args = ('tramos_antiguedad', 'Antigüedad', {'columna_fecha': 'vencimiento', 'columna_valor': 'saldo'})

        primera = plantilla.calcular_contenido_por_calculo(df, *args, None, self.CORTE)
        segunda = plantilla.calcular_contenido_por_calculo(df, *args, None, self.CORTE)
        self.assertEqual(primera['valores'], segunda['valores'])

        mas_tarde = plantilla.calcular_contenido_por_calculo(
            df, *args, None, self.CORTE + timedelta(days=90),
        )
        self.assertNotEqual(primera['valores'], mas_tarde['valores'])

    def test_el_filtro_de_dias_transcurridos_de_un_kpi_usa_la_fecha_de_corte(self):
        contenido = plantilla.calcular_contenido_por_calculo(
            self._df(), 'kpi', 'Vencido +30 días',
            {'columna_valor': 'saldo', 'columna_filtro': 'vencimiento', 'tipo_filtro': 'dias_vencidos',
             'dias_filtro': 30, 'operador_filtro': 'mayor'},
            None, self.CORTE,
        )
        # Solo el documento vencido hace 200 días supera los 30 a la fecha de corte.
        self.assertEqual(contenido['valor'], 50.0)

    def test_sin_fecha_de_corte_registrada_se_cae_a_hoy(self):
        """Comportamiento anterior, conservado para cargas sin `fecha_corte`."""
        hoy = date.today()
        df = pd.DataFrame({
            'vencimiento': [(hoy - timedelta(days=5)).isoformat()],
            'saldo': [100],
        })
        contenido = plantilla.calcular_contenido_por_calculo(
            df, 'tramos_antiguedad', 'Antigüedad',
            {'columna_fecha': 'vencimiento', 'columna_valor': 'saldo'},
        )
        self.assertEqual(dict(zip(contenido['categorias'], contenido['valores']))['30 días'], 100.0)


class FiltroPorValoresTests(TestCase):
    """Filtro por los valores de una columna, con inclusión o exclusión.

    El caso que lo motivó: "sumar el saldo de todo MENOS lo anticipado". Antes solo se podía pedir
    igualdad contra un único valor, así que había que enumerar los demás tramos a mano — y la lista
    quedaba mal en cuanto el archivo traía una categoría nueva.
    """

    def setUp(self):
        self.df = pd.DataFrame({
            'Saldo': [100.0, 200.0, 300.0, 400.0],
            'VENCE': ['ANTICIPADA', '30 DIAS', '60 DIAS', 'ANTICIPADA'],
        })

    def _kpi(self, **filtro):
        propuesta = {'disponible': True, 'calculo': 'kpi', 'columna_valor': 'Saldo', **filtro}
        return plantilla.calcular_contenido_por_calculo(self.df, 'kpi', 'Total', propuesta)

    def test_sin_valores_elegidos_no_filtra(self):
        # "Ninguno de nada" excluiría el archivo entero, que nunca es lo que alguien configuró.
        self.assertEqual(self._kpi(columna_filtro='VENCE', valores_filtro=[])['valor'], 1000.0)
        self.assertEqual(
            self._kpi(columna_filtro='VENCE', valores_filtro=[], operador_valor='no_en')['valor'], 1000.0,
        )

    def test_incluye_los_valores_elegidos(self):
        contenido = self._kpi(columna_filtro='VENCE', valores_filtro=['ANTICIPADA'], operador_valor='en')
        self.assertEqual(contenido['valor'], 500.0)
        self.assertIn('"VENCE" es "ANTICIPADA"', contenido['descripcion'])

    def test_excluye_los_valores_elegidos(self):
        contenido = self._kpi(columna_filtro='VENCE', valores_filtro=['ANTICIPADA'], operador_valor='no_en')
        self.assertEqual(contenido['valor'], 500.0)
        self.assertIn('"VENCE" no es "ANTICIPADA"', contenido['descripcion'])

    def test_incluir_y_excluir_el_mismo_valor_reparten_el_total(self):
        incluido = self._kpi(columna_filtro='VENCE', valores_filtro=['ANTICIPADA'], operador_valor='en')['valor']
        excluido = self._kpi(columna_filtro='VENCE', valores_filtro=['ANTICIPADA'], operador_valor='no_en')['valor']
        self.assertEqual(incluido + excluido, self._kpi()['valor'])

    def test_excluye_varios_valores_a_la_vez(self):
        contenido = self._kpi(
            columna_filtro='VENCE', valores_filtro=['ANTICIPADA', '30 DIAS'], operador_valor='no_en',
        )
        self.assertEqual(contenido['valor'], 300.0)
        self.assertIn('no es ninguno de "ANTICIPADA", "30 DIAS"', contenido['descripcion'])

    def test_un_operador_desconocido_incluye_en_vez_de_romper(self):
        # Mismo criterio permisivo que el filtro de días vencidos: una vista previa en vivo nunca
        # debe romperse por un valor inesperado en el mapeo.
        contenido = self._kpi(columna_filtro='VENCE', valores_filtro=['ANTICIPADA'], operador_valor='cualquiera')
        self.assertEqual(contenido['valor'], 500.0)

    def test_sigue_funcionando_el_mapeo_guardado_con_un_solo_valor(self):
        # Forma anterior (`valor_filtro`), que quedó en los mapeos ya guardados: no hay migración.
        contenido = self._kpi(columna_filtro='VENCE', valor_filtro='ANTICIPADA')
        self.assertEqual(contenido['valor'], 500.0)
        self.assertIn('"VENCE" es "ANTICIPADA"', contenido['descripcion'])

    def test_la_lista_tiene_precedencia_sobre_la_forma_anterior(self):
        contenido = self._kpi(
            columna_filtro='VENCE', valor_filtro='ANTICIPADA', valores_filtro=['30 DIAS'],
        )
        self.assertEqual(contenido['valor'], 200.0)

    def test_el_filtro_por_valores_tambien_aplica_a_una_grafica(self):
        # No es exclusivo de los KPI: cualquier posición con `columna_filtro` lo usa.
        propuesta = {
            'disponible': True, 'calculo': 'chart', 'columna_valor': 'Saldo', 'columna_categoria': 'VENCE',
            'columna_filtro': 'VENCE', 'valores_filtro': ['ANTICIPADA'], 'operador_valor': 'no_en',
        }
        contenido = plantilla.calcular_contenido_por_calculo(self.df, 'chart', 'Gráfico', propuesta)
        self.assertNotIn('ANTICIPADA', contenido['categorias'])
