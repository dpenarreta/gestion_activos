"""Análisis genérico de columnas, recomendación de gráficas y confirmación (una por una) a partir
de un archivo cargado — flujo "cargar archivo → analizar columnas → recomendar gráficas →
agregar", sin depender del esquema fijo de cartera (`services/generic_charts.py`)."""

import os
from datetime import date, timedelta

import pandas as pd
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.models import CargaArchivo, Dashboard
from apps.cartera.services import dashboard_layout, generic_charts, historico

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'cartera_ejemplo.xlsx')
User = get_user_model()


class AnalizarColumnasServiceTests(TestCase):
    def test_columna_numerica_es_apta_para_valor(self):
        df = pd.DataFrame({'saldo': [100, 200, 300], 'ciudad': ['Quito', 'Guayaquil', 'Quito']})
        resultado = generic_charts.analizar_columnas(df)
        columna_saldo = next(c for c in resultado['columnas'] if c['nombre'] == 'saldo')
        self.assertEqual(columna_saldo['tipo'], 'numerico')
        self.assertTrue(columna_saldo['apta_para_valor'])
        self.assertFalse(columna_saldo['apta_para_categoria'])

    def test_columna_texto_con_pocos_valores_distintos_es_apta_para_categoria(self):
        df = pd.DataFrame({'saldo': [100, 200, 300], 'ciudad': ['Quito', 'Guayaquil', 'Quito']})
        resultado = generic_charts.analizar_columnas(df)
        columna_ciudad = next(c for c in resultado['columnas'] if c['nombre'] == 'ciudad')
        self.assertEqual(columna_ciudad['tipo'], 'categorico')
        self.assertTrue(columna_ciudad['apta_para_categoria'])
        self.assertFalse(columna_ciudad['apta_para_valor'])

    def test_columna_tipo_identificador_no_es_apta_para_nada(self):
        df = pd.DataFrame({'id': ['A1', 'A2', 'A3'], 'saldo': [1, 2, 3]})
        resultado = generic_charts.analizar_columnas(df)
        columna_id = next(c for c in resultado['columnas'] if c['nombre'] == 'id')
        self.assertFalse(columna_id['apta_para_valor'])
        self.assertFalse(columna_id['apta_para_categoria'])
        self.assertIn('distintos', columna_id['motivo_no_apta'])

    def test_columna_con_demasiadas_categorias_no_es_apta(self):
        df = pd.DataFrame({'detalle': [f'texto único {i}' for i in range(60)], 'saldo': list(range(60))})
        resultado = generic_charts.analizar_columnas(df)
        columna_detalle = next(c for c in resultado['columnas'] if c['nombre'] == 'detalle')
        self.assertFalse(columna_detalle['apta_para_categoria'])

    def test_columna_vacia_no_es_apta_para_nada(self):
        df = pd.DataFrame({'vacia': [None, None, None], 'saldo': [1, 2, 3]})
        resultado = generic_charts.analizar_columnas(df)
        columna_vacia = next(c for c in resultado['columnas'] if c['nombre'] == 'vacia')
        self.assertEqual(columna_vacia['tipo'], 'vacio')
        self.assertFalse(columna_vacia['apta_para_valor'])
        self.assertFalse(columna_vacia['apta_para_categoria'])

    def test_columna_fecha_se_detecta_como_fecha(self):
        df = pd.DataFrame({'fecha': ['2026-01-01', '2026-02-01', '2026-03-01'], 'saldo': [1, 2, 3]})
        resultado = generic_charts.analizar_columnas(df)
        columna_fecha = next(c for c in resultado['columnas'] if c['nombre'] == 'fecha')
        self.assertEqual(columna_fecha['tipo'], 'fecha')


class ColumnasConBlancosRecurrentesServiceTests(TestCase):
    def test_columna_con_menos_de_3_blancos_no_se_reporta(self):
        df = pd.DataFrame({
            'ciudad': ['Quito', None, 'Guayaquil', None, 'Quito'],  # 2 blancos: no llega al umbral
            'saldo': [100, 200, 300, 400, 500],
        })
        resultado = generic_charts.columnas_con_blancos_recurrentes(df)
        self.assertEqual(resultado, [])

    def test_columna_con_3_o_mas_blancos_se_reporta_con_la_cantidad_correcta(self):
        df = pd.DataFrame({
            'ciudad': ['Quito', None, 'Guayaquil', None, None],  # 3 blancos: llega al umbral
            'saldo': [100, 200, 300, 400, 500],
        })
        resultado = generic_charts.columnas_con_blancos_recurrentes(df)
        self.assertEqual(len(resultado), 1)
        self.assertEqual(resultado[0]['columna'], 'ciudad')
        self.assertEqual(resultado[0]['cantidad_en_blanco'], 3)

    def test_incluye_hasta_3_filas_de_ejemplo_con_numero_de_fila_y_referencia(self):
        df = pd.DataFrame({
            'sucursal': ['A', 'B', 'C', 'D', 'E'],
            'ciudad': ['Quito', None, None, None, None],  # 4 blancos, pide 3 ejemplos
        })
        resultado = generic_charts.columnas_con_blancos_recurrentes(df, cantidad_ejemplos=3)
        columna_ciudad = resultado[0]
        self.assertEqual(columna_ciudad['cantidad_en_blanco'], 4)
        self.assertEqual(len(columna_ciudad['filas_ejemplo']), 3)
        primera = columna_ciudad['filas_ejemplo'][0]
        # Fila 0 de "ciudad" en blanco es 'B' (índice 1) -> fila 3 de Excel (índice 0-based +1, +1 encabezado).
        self.assertEqual(primera['numero_fila'], 3)
        self.assertEqual(primera['referencia'], {'sucursal': 'B'})

    def test_columna_totalmente_vacia_tambien_se_reporta(self):
        df = pd.DataFrame({'vacia': [None, None, None, None], 'saldo': [1, 2, 3, 4]})
        resultado = generic_charts.columnas_con_blancos_recurrentes(df)
        columna_vacia = next(c for c in resultado if c['columna'] == 'vacia')
        self.assertEqual(columna_vacia['cantidad_en_blanco'], 4)

    def test_no_reporta_columnas_sin_ningun_blanco(self):
        df = pd.DataFrame({'ciudad': ['Quito', 'Guayaquil', 'Quito'], 'saldo': [1, 2, 3]})
        resultado = generic_charts.columnas_con_blancos_recurrentes(df)
        self.assertEqual(resultado, [])

    def test_la_columna_de_referencia_no_incluye_a_si_misma(self):
        # "sucursal" es una de las 2 primeras columnas del archivo Y la que tiene blancos: no debe
        # aparecer como su propia referencia.
        df = pd.DataFrame({
            'sucursal': [None, None, None, 'D', 'E'],
            'ciudad': ['Quito', 'Guayaquil', 'Cuenca', 'Quito', 'Quito'],
        })
        resultado = generic_charts.columnas_con_blancos_recurrentes(df)
        primera = resultado[0]['filas_ejemplo'][0]
        self.assertNotIn('sucursal', primera['referencia'])
        self.assertEqual(primera['referencia'], {'ciudad': 'Quito'})


class GenerarRecomendacionesServiceTests(TestCase):
    def test_una_columna_numerica_sin_categorias_solo_recomienda_el_kpi_total(self):
        columnas = [
            {'nombre': 'saldo', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        self.assertEqual(len(recomendaciones), 1)
        self.assertEqual(recomendaciones[0], {
            'id': 'saldo::total', 'tipo_grafica': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None,
            'categorias_unicas': None, 'columna_serie_sugerida': None,
        })

    def test_columna_numerica_y_categorica_recomienda_kpi_y_grafica(self):
        columnas = [
            {'nombre': 'saldo', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10},
            {'nombre': 'ciudad', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': 5},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        tipos = [r['tipo_grafica'] for r in recomendaciones]
        self.assertEqual(tipos, ['kpi', 'chart'])
        self.assertEqual(recomendaciones[1]['columna_valor'], 'saldo')
        self.assertEqual(recomendaciones[1]['columna_categoria'], 'ciudad')
        self.assertEqual(recomendaciones[1]['categorias_unicas'], 5)

    def test_limita_las_categorias_recomendadas_por_cada_valor(self):
        columnas = [{'nombre': 'saldo', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10}]
        columnas += [
            {'nombre': f'cat{i}', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': i}
            for i in range(1, 6)  # 5 columnas de categoría disponibles
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        recomendaciones_de_grafica = [r for r in recomendaciones if r['tipo_grafica'] == 'chart']
        self.assertEqual(len(recomendaciones_de_grafica), generic_charts.MAX_CATEGORIAS_POR_VALOR)
        # Prioriza las de menor cardinalidad (gráficas más legibles).
        self.assertEqual([r['columna_categoria'] for r in recomendaciones_de_grafica], ['cat1', 'cat2', 'cat3'])

    def test_sin_columnas_numericas_no_recomienda_nada(self):
        columnas = [{'nombre': 'ciudad', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': 5}]
        self.assertEqual(generic_charts.generar_recomendaciones(columnas), [])


class CalcularDatosRecomendacionesServiceTests(TestCase):
    """Cada recomendación trae sus datos ya calculados, para que el frontend pueda mostrar una
    vista previa real de todas (sección "todos los generados deben de tener una forma de
    previsualizar") sin una solicitud aparte por cada una."""

    def test_agrega_los_datos_de_cada_recomendacion(self):
        df = pd.DataFrame({'saldo': [100, 300, 50], 'ciudad': ['Quito', 'Quito', 'Guayaquil']})
        columnas = generic_charts.analizar_columnas(df)['columnas']
        recomendaciones = generic_charts.generar_recomendaciones(columnas)

        con_datos = generic_charts.calcular_datos_recomendaciones(df, recomendaciones)

        kpi = next(r for r in con_datos if r['tipo_grafica'] == 'kpi')
        self.assertEqual(kpi['datos'], {'tipo': 'kpi', 'valor': 450.0})

        chart = next(r for r in con_datos if r['tipo_grafica'] == 'chart')
        self.assertEqual(chart['datos']['tipo'], 'chart')
        self.assertEqual(chart['datos']['categorias'][0], 'Quito')

    def test_no_pierde_los_campos_originales_de_la_recomendacion(self):
        df = pd.DataFrame({'saldo': [1, 2, 3]})
        recomendaciones = [{'id': 'saldo::total', 'tipo_grafica': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None, 'categorias_unicas': None}]
        con_datos = generic_charts.calcular_datos_recomendaciones(df, recomendaciones)
        self.assertEqual(con_datos[0]['id'], 'saldo::total')
        self.assertEqual(con_datos[0]['columna_valor'], 'saldo')


class AplicarSeleccionUsuarioServiceTests(TestCase):
    """El análisis automático nunca excluye una columna por sí solo — el usuario decide, columna
    por columna, marcándola como utilizable o no (sección "todas se muestren de forma
    obligatoria")."""

    def test_columna_marcada_queda_apta_segun_su_tipo(self):
        columnas = [
            {'nombre': 'saldo', 'tipo': 'numerico', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10},
            {'nombre': 'ciudad', 'tipo': 'categorico', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': 5},
        ]
        resultado = generic_charts.aplicar_seleccion_usuario(columnas, ['saldo', 'ciudad'])
        self.assertTrue(resultado[0]['apta_para_valor'])
        self.assertTrue(resultado[1]['apta_para_categoria'])

    def test_columna_no_marcada_queda_inapta_aunque_el_analisis_la_sugiriera(self):
        columnas = [{'nombre': 'saldo', 'tipo': 'numerico', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10}]
        resultado = generic_charts.aplicar_seleccion_usuario(columnas, [])
        self.assertFalse(resultado[0]['apta_para_valor'])
        self.assertFalse(resultado[0]['apta_para_categoria'])

    def test_columna_marcada_aunque_el_analisis_la_hubiera_descartado(self):
        """El usuario puede forzar como utilizable una columna que el análisis marcó
        `apta_para_categoria=False` (p. ej. por parecer un identificador)."""
        columnas = [{
            'nombre': 'codigo', 'tipo': 'categorico', 'apta_para_valor': False, 'apta_para_categoria': False,
            'valores_unicos': 15, 'motivo_no_apta': 'Todos los valores son distintos (parece un identificador).',
        }]
        resultado = generic_charts.aplicar_seleccion_usuario(columnas, ['codigo'])
        self.assertTrue(resultado[0]['apta_para_categoria'])

    def test_columna_vacia_marcada_por_el_usuario_no_rompe(self):
        columnas = [{'nombre': 'vacia', 'tipo': 'vacio', 'apta_para_valor': False, 'apta_para_categoria': False, 'valores_unicos': 0}]
        resultado = generic_charts.aplicar_seleccion_usuario(columnas, ['vacia'])
        self.assertTrue(resultado[0]['apta_para_categoria'])  # tipo != 'numerico' → rol de categoría
        self.assertFalse(resultado[0]['apta_para_valor'])


class GenerarDatosGraficaServiceTests(TestCase):
    def test_sin_categoria_devuelve_un_kpi_con_la_suma(self):
        df = pd.DataFrame({'saldo': [100, 200, 300]})
        resultado = generic_charts.generar_datos_grafica(df, 'saldo')
        self.assertEqual(resultado, {'tipo': 'kpi', 'valor': 600.0})

    def test_con_categoria_agrupa_y_suma_por_categoria(self):
        df = pd.DataFrame({'saldo': [100, 200, 50], 'ciudad': ['Quito', 'Quito', 'Guayaquil']})
        resultado = generic_charts.generar_datos_grafica(df, 'saldo', 'ciudad')
        self.assertEqual(resultado['tipo'], 'chart')
        self.assertEqual(resultado['categorias'][0], 'Quito')
        self.assertEqual(resultado['valores'][0], 300.0)

    def test_columna_de_valor_inexistente_devuelve_none(self):
        df = pd.DataFrame({'saldo': [1, 2, 3]})
        self.assertIsNone(generic_charts.generar_datos_grafica(df, 'no_existe'))

    def test_mas_de_15_categorias_se_agrupan_en_otras(self):
        filas = {'categoria': [f'cat-{i}' for i in range(20)], 'valor': [1] * 20}
        df = pd.DataFrame(filas)
        resultado = generic_charts.generar_datos_grafica(df, 'valor', 'categoria')
        self.assertEqual(len(resultado['categorias']), 16)  # 15 + "Otras"
        self.assertIn('Otras', resultado['categorias'])


class GenerarConteoValoresUnicosServiceTests(TestCase):
    def test_cuenta_valores_distintos_no_nulos(self):
        df = pd.DataFrame({'cliente': ['Ana', 'Ana', 'Luis', 'Carlos', None]})
        resultado = generic_charts.generar_conteo_valores_unicos(df, 'cliente')
        self.assertEqual(resultado, {'tipo': 'kpi', 'valor': 3})

    def test_funciona_con_columnas_no_numericas(self):
        df = pd.DataFrame({'documento': ['A-001', 'A-002', 'A-001']})
        resultado = generic_charts.generar_conteo_valores_unicos(df, 'documento')
        self.assertEqual(resultado['valor'], 2)

    def test_columna_inexistente_devuelve_none(self):
        df = pd.DataFrame({'cliente': ['Ana']})
        self.assertIsNone(generic_charts.generar_conteo_valores_unicos(df, 'no_existe'))


class ValoresUnicosDeColumnaServiceTests(TestCase):
    def test_devuelve_valores_distintos_ordenados_alfabeticamente(self):
        df = pd.DataFrame({'causal': ['GESTIONANDO', 'PAGADO', 'GESTIONANDO', None]})
        resultado = generic_charts.valores_unicos_de_columna(df, 'causal')
        self.assertEqual(resultado, {'valores': ['GESTIONANDO', 'PAGADO'], 'total': 2})

    def test_columna_inexistente_devuelve_none(self):
        df = pd.DataFrame({'causal': ['GESTIONANDO']})
        self.assertIsNone(generic_charts.valores_unicos_de_columna(df, 'no_existe'))

    def test_respeta_el_limite_pero_informa_el_total_real(self):
        df = pd.DataFrame({'id': [f'v{i}' for i in range(10)]})
        resultado = generic_charts.valores_unicos_de_columna(df, 'id', limite=3)
        self.assertEqual(len(resultado['valores']), 3)
        self.assertEqual(resultado['total'], 10)


class ValoresDuplicadosDeColumnaServiceTests(TestCase):
    def test_devuelve_cantidad_y_ejemplos_ordenados_por_repeticiones_descendente(self):
        df = pd.DataFrame({'ciudad': ['Quito'] * 3 + ['Guayaquil'] * 2 + ['Cuenca']})
        resultado = generic_charts.valores_duplicados_de_columna(df, 'ciudad')
        self.assertEqual(resultado['cantidad_valores_duplicados'], 2)
        self.assertEqual(resultado['ejemplos'], [
            {'valor': 'Quito', 'cantidad': 3}, {'valor': 'Guayaquil', 'cantidad': 2},
        ])

    def test_sin_duplicados_devuelve_cantidad_cero_y_ejemplos_vacios(self):
        df = pd.DataFrame({'id': ['a', 'b', 'c']})
        resultado = generic_charts.valores_duplicados_de_columna(df, 'id')
        self.assertEqual(resultado, {'cantidad_valores_duplicados': 0, 'ejemplos': []})

    def test_columna_inexistente_devuelve_none(self):
        df = pd.DataFrame({'ciudad': ['Quito']})
        self.assertIsNone(generic_charts.valores_duplicados_de_columna(df, 'no_existe'))

    def test_valores_nulos_no_cuentan_como_duplicados_entre_si(self):
        df = pd.DataFrame({'ciudad': [None, None, None]})
        resultado = generic_charts.valores_duplicados_de_columna(df, 'ciudad')
        self.assertEqual(resultado, {'cantidad_valores_duplicados': 0, 'ejemplos': []})

    def test_respeta_la_cantidad_de_ejemplos_pero_informa_el_total_real(self):
        df = pd.DataFrame({'ciudad': ['Quito'] * 5 + ['Guayaquil'] * 4 + ['Cuenca'] * 3 + ['Loja'] * 2})
        resultado = generic_charts.valores_duplicados_de_columna(df, 'ciudad', cantidad_ejemplos=2)
        self.assertEqual(resultado['cantidad_valores_duplicados'], 4)
        self.assertEqual(len(resultado['ejemplos']), 2)
        self.assertEqual(resultado['ejemplos'][0], {'valor': 'Quito', 'cantidad': 5})


class ColumnaSerieSugeridaServiceTests(TestCase):
    """Cada recomendación con categoría propone una segunda columna de agrupación (para barras
    agrupadas/apiladas) cuando hay otra columna categórica disponible."""

    def test_con_dos_columnas_de_categoria_sugiere_la_otra_como_serie(self):
        columnas = [
            {'nombre': 'saldo', 'tipo': 'numerico', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10},
            {'nombre': 'ciudad', 'tipo': 'categorico', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': 3},
            {'nombre': 'causal', 'tipo': 'categorico', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': 5},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        por_ciudad = next(r for r in recomendaciones if r['columna_categoria'] == 'ciudad')
        self.assertEqual(por_ciudad['columna_serie_sugerida'], 'causal')
        por_causal = next(r for r in recomendaciones if r['columna_categoria'] == 'causal')
        self.assertEqual(por_causal['columna_serie_sugerida'], 'ciudad')

    def test_con_una_sola_columna_de_categoria_no_hay_serie_sugerida(self):
        columnas = [
            {'nombre': 'saldo', 'tipo': 'numerico', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10},
            {'nombre': 'ciudad', 'tipo': 'categorico', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': 3},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        por_ciudad = next(r for r in recomendaciones if r['columna_categoria'] == 'ciudad')
        self.assertIsNone(por_ciudad['columna_serie_sugerida'])

    def test_el_kpi_de_total_nunca_tiene_serie_sugerida(self):
        columnas = [
            {'nombre': 'saldo', 'tipo': 'numerico', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10},
            {'nombre': 'ciudad', 'tipo': 'categorico', 'apta_para_valor': False, 'apta_para_categoria': True, 'valores_unicos': 3},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        kpi = next(r for r in recomendaciones if r['tipo_grafica'] == 'kpi')
        self.assertIsNone(kpi['columna_serie_sugerida'])


class GenerarDatosMultiserieServiceTests(TestCase):
    def test_agrupa_por_categoria_y_serie(self):
        df = pd.DataFrame({
            'saldo': [100, 200, 150, 50],
            'ciudad': ['Quito', 'Quito', 'Guayaquil', 'Guayaquil'],
            'causal': ['A', 'B', 'A', 'B'],
        })
        resultado = generic_charts.generar_datos_multiserie(df, 'saldo', 'ciudad', 'causal')
        self.assertEqual(resultado['tipo'], 'multiserie')
        self.assertEqual(set(resultado['categorias']), {'Quito', 'Guayaquil'})
        nombres_series = {s['nombre'] for s in resultado['series']}
        self.assertEqual(nombres_series, {'A', 'B'})

    def test_columna_inexistente_devuelve_none(self):
        df = pd.DataFrame({'saldo': [1, 2], 'ciudad': ['Quito', 'Guayaquil']})
        self.assertIsNone(generic_charts.generar_datos_multiserie(df, 'saldo', 'ciudad', 'no_existe'))

    def test_limita_las_series_a_las_de_mayor_total_y_colapsa_el_resto_en_otras(self):
        """Mismo criterio que las categorías (`test_mas_de_15_categorias_se_agrupan_en_otras`):
        las que quedan fuera del top se agrupan, no se descartan. Antes se recortaban a secas y
        los segmentos de una categoría dejaban de sumar su total sin ninguna indicación."""
        filas = 20
        df = pd.DataFrame({
            'valor': [1] * filas,
            'categoria': ['cat-a'] * filas,
            'serie': [f'serie-{i}' for i in range(filas)],
        })
        resultado = generic_charts.generar_datos_multiserie(df, 'valor', 'categoria', 'serie')

        self.assertEqual(len(resultado['series']), generic_charts.MAX_SERIES_EN_GRAFICA + 1)
        self.assertEqual(resultado['series'][-1]['nombre'], 'Otras')
        # Nada se pierde: los segmentos siguen sumando el total real de la categoría.
        self.assertEqual(sum(s['valores'][0] for s in resultado['series']), float(filas))

    def test_con_pocas_series_no_agrega_la_serie_otras(self):
        df = pd.DataFrame({
            'valor': [1, 2, 3],
            'categoria': ['cat-a'] * 3,
            'serie': ['A', 'B', 'C'],
        })
        resultado = generic_charts.generar_datos_multiserie(df, 'valor', 'categoria', 'serie')
        self.assertEqual([s['nombre'] for s in resultado['series']], ['C', 'B', 'A'])

    def test_mas_de_15_categorias_se_agrupan_en_otras(self):
        filas = 20
        df = pd.DataFrame({
            'valor': [1] * filas,
            'categoria': [f'cat-{i}' for i in range(filas)],
            'serie': ['A'] * filas,
        })
        resultado = generic_charts.generar_datos_multiserie(df, 'valor', 'categoria', 'serie')
        self.assertIn('Otras', resultado['categorias'])
        self.assertEqual(len(resultado['categorias']), 16)


class MejorParColumnasNumericasServiceTests(TestCase):
    def test_con_dos_o_mas_columnas_numericas_elige_las_de_menos_nulos(self):
        columnas_valor = [
            {'nombre': 'a', 'valores_no_nulos': 5},
            {'nombre': 'b', 'valores_no_nulos': 10},
            {'nombre': 'c', 'valores_no_nulos': 8},
        ]
        self.assertEqual(generic_charts._mejor_par_columnas_numericas(columnas_valor), ('b', 'c'))

    def test_con_menos_de_dos_columnas_numericas_devuelve_none(self):
        self.assertIsNone(generic_charts._mejor_par_columnas_numericas([{'nombre': 'a', 'valores_no_nulos': 5}]))
        self.assertIsNone(generic_charts._mejor_par_columnas_numericas([]))


class GenerarDatosDispersionServiceTests(TestCase):
    def test_calcula_los_puntos_x_y_de_cada_fila(self):
        df = pd.DataFrame({'ventas': [100, 200, 300], 'ganancia': [10, 25, 40]})
        resultado = generic_charts.generar_datos_dispersion(df, 'ventas', 'ganancia')
        self.assertEqual(resultado['tipo'], 'dispersion')
        self.assertEqual(resultado['puntos'], [
            {'x': 100.0, 'y': 10.0}, {'x': 200.0, 'y': 25.0}, {'x': 300.0, 'y': 40.0},
        ])

    def test_descarta_filas_con_algun_valor_faltante(self):
        df = pd.DataFrame({'ventas': [100, None, 300], 'ganancia': [10, 25, None]})
        resultado = generic_charts.generar_datos_dispersion(df, 'ventas', 'ganancia')
        self.assertEqual(resultado['puntos'], [{'x': 100.0, 'y': 10.0}])

    def test_columna_inexistente_devuelve_none(self):
        df = pd.DataFrame({'ventas': [1, 2]})
        self.assertIsNone(generic_charts.generar_datos_dispersion(df, 'ventas', 'no_existe'))

    def test_limita_la_cantidad_de_puntos(self):
        filas = generic_charts.LIMITE_PUNTOS_DISPERSION + 50
        df = pd.DataFrame({'x': list(range(filas)), 'y': list(range(filas))})
        resultado = generic_charts.generar_datos_dispersion(df, 'x', 'y')
        self.assertEqual(len(resultado['puntos']), generic_charts.LIMITE_PUNTOS_DISPERSION)


class GenerarPromedioColumnaServiceTests(TestCase):
    """`None` significa "la columna no existe" y nada más — es lo que los llamadores usan para
    decidir que la posición cae al dato ficticio."""

    def test_promedio_normal(self):
        df = pd.DataFrame({'saldo': [100, 200]})
        self.assertEqual(generic_charts.generar_promedio_columna(df, 'saldo')['valor'], 150.0)

    def test_columna_inexistente_devuelve_none(self):
        df = pd.DataFrame({'saldo': [100]})
        self.assertIsNone(generic_charts.generar_promedio_columna(df, 'no_existe'))

    def test_columna_sin_valores_numericos_devuelve_cero_no_none(self):
        """Regresión: devolvía `None`, y cada llamador lo malinterpretaba a su manera —
        `plantilla.calcular_datos_mapeo` caía al dato ficticio (un número inventado con la
        descripción "Dato de ejemplo" sobre un archivo ya cargado) y `AgregarGraficaView`
        levantaba "la columna ya no existe en el archivo", que no era la causa."""
        df = pd.DataFrame({'observacion': ['pendiente', 'en gestion']})
        self.assertEqual(generic_charts.generar_promedio_columna(df, 'observacion'), {'tipo': 'kpi', 'valor': 0.0})

    def test_dataframe_vacio_devuelve_cero_no_none(self):
        df = pd.DataFrame({'saldo': pd.Series([], dtype='float64')})
        self.assertEqual(generic_charts.generar_promedio_columna(df, 'saldo'), {'tipo': 'kpi', 'valor': 0.0})

    def test_coincide_con_suma_y_conteo_ante_una_columna_de_texto(self):
        """Las tres agregaciones de KPI se comportan igual frente a la misma columna sin números:
        ninguna devuelve `None`."""
        df = pd.DataFrame({'observacion': ['a', 'b']})
        self.assertIsNotNone(generic_charts.generar_datos_grafica(df, 'observacion', None))
        self.assertIsNotNone(generic_charts.generar_conteo_valores_unicos(df, 'observacion'))
        self.assertIsNotNone(generic_charts.generar_promedio_columna(df, 'observacion'))


class GenerarDatosTablaServiceTests(TestCase):
    def _df(self):
        return pd.DataFrame({
            'producto': ['A', 'A', 'B', 'C'],
            'ventas': [100, 50, 80, 60],
            'cliente': ['x', 'y', 'x', 'z'],
        })

    def test_por_defecto_cada_columna_de_valor_se_suma(self):
        columnas_valor = [{'columna': 'ventas', 'tipo_agregacion': 'suma'}]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        fila_a = next(f for f in resultado['filas'] if f[0] == 'A')
        self.assertEqual(fila_a[1], 150.0)
        self.assertEqual(resultado['total'][1], 290.0)

    def test_acepta_columnas_valor_como_strings_planos_tratados_como_suma(self):
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', ['ventas'])
        self.assertEqual(resultado['total'][1], 290.0)

    def test_tipo_promedio_calcula_la_media_por_grupo(self):
        columnas_valor = [{'columna': 'ventas', 'tipo_agregacion': 'promedio'}]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        fila_a = next(f for f in resultado['filas'] if f[0] == 'A')
        self.assertEqual(fila_a[1], 75.0)  # (100 + 50) / 2

    def test_tipo_conteo_unicos_cuenta_valores_distintos_por_grupo(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'columna': 'cliente', 'tipo_agregacion': 'conteo_unicos'},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        fila_a = next(f for f in resultado['filas'] if f[0] == 'A')
        self.assertEqual(fila_a[2], 2.0)  # 'A' tiene clientes 'x' e 'y' -> 2 distintos

    def test_cada_columna_puede_tener_un_tipo_de_agregacion_distinto(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'columna': 'ventas', 'tipo_agregacion': 'promedio'},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        fila_a = next(f for f in resultado['filas'] if f[0] == 'A')
        self.assertEqual(fila_a[1], 150.0)
        self.assertEqual(fila_a[2], 75.0)

    def test_columna_de_valor_inexistente_devuelve_none(self):
        columnas_valor = [{'columna': 'no_existe', 'tipo_agregacion': 'suma'}]
        self.assertIsNone(generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor))

    def test_tipo_valor_celda_muestra_el_valor_cuando_es_igual_en_todo_el_grupo(self):
        df = pd.DataFrame({
            'producto': ['A', 'A', 'B'],
            'ventas': [100, 50, 80],
            'zona': ['Norte', 'Norte', 'Sur'],
        })
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'columna': 'zona', 'tipo_agregacion': 'valor_celda'},
        ]
        resultado = generic_charts.generar_datos_tabla(df, 'producto', columnas_valor)
        fila_a = next(f for f in resultado['filas'] if f[0] == 'A')
        fila_b = next(f for f in resultado['filas'] if f[0] == 'B')
        self.assertEqual(fila_a[2], 'Norte')
        self.assertEqual(fila_b[2], 'Sur')

    def test_tipo_valor_celda_muestra_varios_cuando_el_grupo_tiene_valores_distintos(self):
        df = pd.DataFrame({
            'producto': ['A', 'A'],
            'zona': ['Norte', 'Sur'],
        })
        columnas_valor = [{'columna': 'zona', 'tipo_agregacion': 'valor_celda'}]
        resultado = generic_charts.generar_datos_tabla(df, 'producto', columnas_valor)
        self.assertEqual(resultado['filas'][0][1], 'Varios')

    def test_tipo_valor_celda_en_una_columna_no_primaria_queda_vacio_en_el_total(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'columna': 'cliente', 'tipo_agregacion': 'valor_celda'},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        self.assertEqual(resultado['total'][1], 290.0)
        self.assertIsNone(resultado['total'][2])

    def test_tipo_valor_celda_como_columna_primaria_ordena_alfabetico_y_porcentaje_en_cero(self):
        df = pd.DataFrame({
            'producto': ['A', 'B', 'C'],
            'zona': ['Sur', 'Norte', 'Este'],
        })
        columnas_valor = [{'columna': 'zona', 'tipo_agregacion': 'valor_celda'}]
        resultado = generic_charts.generar_datos_tabla(df, 'producto', columnas_valor)
        # sort_values(ascending=False) por VALOR de "zona": Sur > Norte > Este alfabéticamente,
        # así que las filas quedan en ese orden (A=Sur, B=Norte, C=Este) — no hay nada que rankear
        # por magnitud porque "valor_celda" no es una cantidad.
        self.assertEqual([f[0] for f in resultado['filas']], ['A', 'B', 'C'])
        self.assertTrue(all(f[-1] == 0 for f in resultado['filas']))
        self.assertEqual(resultado['total'][-1], 0)

    def test_columna_manual_se_intercala_por_posicion_junto_a_columnas_reales(self):
        # "producto" ordenado por "ventas" (suma) descendente: A=150, B=80, C=60.
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'manual': True, 'titulo': 'Meta', 'valores': ['≥ 100', '≥ 80', '≥ 50'], 'total': None},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        self.assertEqual(resultado['columnas'], ['producto', 'ventas', 'Meta', '% del total'])
        filas_por_id = {f[0]: f for f in resultado['filas']}
        self.assertEqual(filas_por_id['A'][2], '≥ 100')
        self.assertEqual(filas_por_id['B'][2], '≥ 80')
        self.assertEqual(filas_por_id['C'][2], '≥ 50')

    def test_columna_manual_no_participa_del_orden_ni_del_porcentaje(self):
        columnas_valor = [
            {'manual': True, 'titulo': 'Meta', 'valores': ['x', 'y', 'z']},
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        # El orden sigue siendo por "ventas" (la única real), no por la columna manual que va primero.
        self.assertEqual([f[0] for f in resultado['filas']], ['A', 'B', 'C'])
        fila_a = next(f for f in resultado['filas'] if f[0] == 'A')
        self.assertEqual(fila_a[-1], round(150 / 290 * 100, 2))

    def test_columna_manual_con_menos_valores_que_filas_deja_none_en_las_faltantes(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'manual': True, 'titulo': 'Meta', 'valores': ['≥ 100']},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        filas_por_id = {f[0]: f for f in resultado['filas']}
        self.assertEqual(filas_por_id['A'][2], '≥ 100')
        self.assertIsNone(filas_por_id['B'][2])
        self.assertIsNone(filas_por_id['C'][2])

    def test_columna_manual_con_mas_valores_que_filas_ignora_los_sobrantes(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'manual': True, 'titulo': 'Meta', 'valores': ['≥ 100', '≥ 80', '≥ 50', '≥ 0', '≥ 0']},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        self.assertEqual(len(resultado['filas']), 3)

    def test_columna_manual_usa_su_propio_total_tecleado(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'manual': True, 'titulo': 'Meta', 'valores': ['≥ 100', '≥ 80', '≥ 50'], 'total': 'Cumplido'},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        self.assertEqual(resultado['total'][2], 'Cumplido')

    def test_columna_manual_sin_total_tecleado_queda_vacia_en_el_total(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'manual': True, 'titulo': 'Meta', 'valores': ['≥ 100', '≥ 80', '≥ 50']},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        self.assertIsNone(resultado['total'][2])

    def test_sin_ninguna_columna_real_ordena_alfabetico_por_identidad_y_porcentaje_en_cero(self):
        columnas_valor = [{'manual': True, 'titulo': 'Meta', 'valores': ['x', 'y', 'z']}]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        self.assertEqual([f[0] for f in resultado['filas']], ['A', 'B', 'C'])
        self.assertTrue(all(f[-1] == 0 for f in resultado['filas']))
        self.assertEqual(resultado['columnas'], ['producto', 'Meta', '% del total'])

    def test_columna_manual_sin_titulo_usa_un_nombre_por_defecto(self):
        columnas_valor = [
            {'columna': 'ventas', 'tipo_agregacion': 'suma'},
            {'manual': True, 'valores': ['a', 'b', 'c']},
        ]
        resultado = generic_charts.generar_datos_tabla(self._df(), 'producto', columnas_valor)
        self.assertEqual(resultado['columnas'][2], 'Manual')

    def test_por_defecto_ya_no_trunca_a_5_filas_el_frontend_pagina_lo_que_llegue(self):
        df = pd.DataFrame({
            'producto': [f'P{i}' for i in range(12)],
            'ventas': list(range(12)),
        })
        columnas_valor = [{'columna': 'ventas', 'tipo_agregacion': 'suma'}]
        resultado = generic_charts.generar_datos_tabla(df, 'producto', columnas_valor)
        self.assertEqual(len(resultado['filas']), 12)

    def test_el_parametro_limite_sigue_funcionando_como_tope_de_seguridad(self):
        df = pd.DataFrame({
            'producto': [f'P{i}' for i in range(12)],
            'ventas': list(range(12)),
        })
        columnas_valor = [{'columna': 'ventas', 'tipo_agregacion': 'suma'}]
        resultado = generic_charts.generar_datos_tabla(df, 'producto', columnas_valor, limite=5)
        self.assertEqual(len(resultado['filas']), 5)

    def test_el_porcentaje_cierra_en_100_con_cualquier_tipo_de_agregacion_primaria(self):
        """Regresión: el denominador es el total de la columna primaria TAL COMO SE MUESTRA en la
        fila "Total", no la columna completa reagregada.

        Con 'promedio' el denominador anterior era la media global, así que dividía la media de
        cada grupo por la media global y la columna llegaba a mostrar 166% con un total de 333%.
        Con 'conteo_unicos', un mismo valor presente en dos grupos se contaba dos veces en las
        filas y una sola en el denominador, y los porcentajes cerraban en 125%.
        """
        df = pd.DataFrame({
            'cliente': ['A', 'A', 'B', 'B', 'C'],
            'saldo': [100, 100, 200, 200, 300],
            'doc': ['d1', 'd2', 'd3', 'd4', 'd1'],
        })
        casos = [
            ('suma', 'saldo'),
            ('promedio', 'saldo'),
            ('conteo_unicos', 'doc'),
        ]
        for tipo, columna in casos:
            with self.subTest(tipo=tipo):
                resultado = generic_charts.generar_datos_tabla(
                    df, 'cliente', [{'columna': columna, 'tipo_agregacion': tipo}],
                )
                self.assertEqual(resultado['total'][-1], 100.0)
                self.assertAlmostEqual(sum(f[-1] for f in resultado['filas']), 100.0, places=1)
                self.assertTrue(all(0 <= f[-1] <= 100 for f in resultado['filas']))

    def test_el_porcentaje_se_reparte_sobre_las_filas_mostradas_cuando_el_limite_recorta(self):
        """Con el tope de filas activo, el porcentaje sigue coincidiendo con la fila "Total" que
        el lector tiene a la vista (antes esa fila mostraba 77.78% y las filas no cerraban)."""
        df = pd.DataFrame({'cliente': ['A', 'B', 'C'], 'saldo': [200, 400, 300]})
        resultado = generic_charts.generar_datos_tabla(
            df, 'cliente', [{'columna': 'saldo', 'tipo_agregacion': 'suma'}], limite=2,
        )
        self.assertEqual([f[0] for f in resultado['filas']], ['B', 'C'])
        self.assertEqual(resultado['total'][1], 700.0)
        self.assertEqual([f[-1] for f in resultado['filas']], [57.14, 42.86])
        self.assertEqual(resultado['total'][-1], 100.0)

    def test_el_porcentaje_usa_la_columna_primaria_aunque_haya_una_manual_antes(self):
        """La columna manual no participa del porcentaje, así que el índice de la primaria en la
        fila no coincide con su índice en `columnas_valor` — se verifica que no se desalinee."""
        df = pd.DataFrame({'cliente': ['A', 'B'], 'saldo': [300, 100]})
        resultado = generic_charts.generar_datos_tabla(df, 'cliente', [
            {'manual': True, 'titulo': 'Meta', 'valores': [1, 2], 'total': 3},
            {'columna': 'saldo', 'tipo_agregacion': 'suma'},
        ])
        filas_por_id = {f[0]: f for f in resultado['filas']}
        self.assertEqual(filas_por_id['A'][-1], 75.0)
        self.assertEqual(filas_por_id['B'][-1], 25.0)
        self.assertEqual(resultado['total'][-1], 100.0)

class DiasTranscurridosDesdeServiceTests(TestCase):
    def test_fecha_pasada_da_dias_positivos(self):
        hoy = date.today()
        serie = pd.Series([(hoy - timedelta(days=45)).isoformat()])
        resultado = generic_charts.dias_transcurridos_desde(serie)
        self.assertEqual(resultado.iloc[0], 45)

    def test_fecha_futura_da_dias_negativos(self):
        hoy = date.today()
        serie = pd.Series([(hoy + timedelta(days=10)).isoformat()])
        resultado = generic_charts.dias_transcurridos_desde(serie)
        self.assertEqual(resultado.iloc[0], -10)

    def test_fecha_hoy_da_cero(self):
        serie = pd.Series([date.today().isoformat()])
        resultado = generic_charts.dias_transcurridos_desde(serie)
        self.assertEqual(resultado.iloc[0], 0)

    def test_fecha_invalida_da_nan(self):
        serie = pd.Series(['no es una fecha'])
        resultado = generic_charts.dias_transcurridos_desde(serie)
        self.assertTrue(pd.isna(resultado.iloc[0]))


class GenerarDatosTramosAntiguedadServiceTests(TestCase):
    def _df_con_dias(self, lista_dias_saldo):
        hoy = date.today()
        return pd.DataFrame({
            'vencimiento': [(hoy - timedelta(days=dias)).isoformat() for dias, _ in lista_dias_saldo],
            'saldo': [saldo for _, saldo in lista_dias_saldo],
        })

    def test_bordes_exactos_de_cada_tramo(self):
        df = self._df_con_dias([
            (0, 100), (30, 200), (31, 300), (60, 400), (61, 500), (120, 600), (121, 700),
        ])
        resultado = generic_charts.generar_datos_tramos_antiguedad(df, 'vencimiento', 'saldo')
        self.assertEqual(resultado['categorias'], generic_charts.ETIQUETAS_TRAMOS_ANTIGUEDAD)
        esperado = dict(zip(resultado['categorias'], resultado['valores']))
        self.assertEqual(esperado['Anticipada'], 100.0)
        self.assertEqual(esperado['30 días'], 200.0)
        self.assertEqual(esperado['60 días'], 300.0 + 400.0)
        self.assertEqual(esperado['90 días'], 500.0)
        self.assertEqual(esperado['120 días'], 600.0)
        self.assertEqual(esperado['+120 días'], 700.0)

    def test_fecha_invalida_queda_fuera_de_todos_los_tramos(self):
        df = pd.DataFrame({'vencimiento': ['no es una fecha'], 'saldo': [999]})
        resultado = generic_charts.generar_datos_tramos_antiguedad(df, 'vencimiento', 'saldo')
        self.assertEqual(sum(resultado['valores']), 0.0)

    def test_columna_faltante_devuelve_none(self):
        df = pd.DataFrame({'saldo': [100]})
        self.assertIsNone(generic_charts.generar_datos_tramos_antiguedad(df, 'vencimiento', 'saldo'))
        df2 = pd.DataFrame({'vencimiento': [date.today().isoformat()]})
        self.assertIsNone(generic_charts.generar_datos_tramos_antiguedad(df2, 'vencimiento', 'saldo'))


class EvaluarMetaServiceTests(TestCase):
    def test_sin_meta_devuelve_none(self):
        self.assertIsNone(generic_charts.evaluar_meta(50, None, ''))

    def test_solo_minimo_cumple(self):
        resultado = generic_charts.evaluar_meta(50, 30, None)
        self.assertTrue(resultado['cumple'])
        self.assertEqual(resultado['motivos'], [])

    def test_solo_minimo_no_cumple(self):
        resultado = generic_charts.evaluar_meta(10, 30, None)
        self.assertFalse(resultado['cumple'])
        self.assertEqual(len(resultado['motivos']), 1)

    def test_solo_maximo_no_cumple(self):
        resultado = generic_charts.evaluar_meta(90, None, 50)
        self.assertFalse(resultado['cumple'])
        self.assertEqual(len(resultado['motivos']), 1)

    def test_ambos_cumple(self):
        resultado = generic_charts.evaluar_meta(50, 30, 70)
        self.assertTrue(resultado['cumple'])

    def test_ambos_no_cumple_da_dos_motivos(self):
        # meta mal configurada a propósito (min > max) para probar que se acumulan los 2 motivos.
        resultado = generic_charts.evaluar_meta(80, 90, 10)
        self.assertFalse(resultado['cumple'])
        self.assertEqual(len(resultado['motivos']), 2)


class EtiquetaCumplimientoServiceTests(TestCase):
    def test_sin_meta(self):
        self.assertEqual(generic_charts.etiqueta_cumplimiento(None), 'Sin meta')

    def test_cumple(self):
        meta = generic_charts.evaluar_meta(50, 30, 70)
        self.assertEqual(generic_charts.etiqueta_cumplimiento(meta), 'Cumple')

    def test_no_cumple_tiene_prefijo(self):
        meta = generic_charts.evaluar_meta(10, 30, None)
        self.assertTrue(generic_charts.etiqueta_cumplimiento(meta).startswith('No cumple ('))


class GenerarDatosCumplimientoTramosServiceTests(TestCase):
    def _df(self):
        hoy = date.today()
        return pd.DataFrame({
            'vencimiento': [
                (hoy - timedelta(days=0)).isoformat(),
                (hoy - timedelta(days=45)).isoformat(),
                (hoy - timedelta(days=150)).isoformat(),
            ],
            'saldo': [100, 200, 700],
        })

    def test_acumulacion_y_porcentaje_correctos(self):
        resultado = generic_charts.generar_datos_cumplimiento_tramos(self._df(), 'vencimiento', 'saldo')
        self.assertEqual(resultado['columnas'], ['Tramo', 'saldo', '% acumulado', 'Resultado'])
        filas_por_tramo = {fila[0]: fila for fila in resultado['filas']}
        self.assertEqual(filas_por_tramo['Corriente'][1], 100.0)
        self.assertEqual(filas_por_tramo['Corriente'][2], 10.0)
        self.assertEqual(filas_por_tramo['Vencido ≤ 60 días (acum.)'][1], 300.0)
        self.assertEqual(filas_por_tramo['Vencido ≤ 60 días (acum.)'][2], 30.0)
        # La última fila NO es un cierre al 100%: es la cola ">120 días" sola (no acumulada).
        self.assertEqual(filas_por_tramo['Más de 120 días'][1], 700.0)
        self.assertEqual(filas_por_tramo['Más de 120 días'][2], 70.0)
        self.assertIsNone(resultado['total'])

    def test_metas_por_posicion_dan_resultado_cumple_o_no_cumple(self):
        metas = [
            {'meta_min': 5}, {}, {'meta_min': 50}, None, None, {'meta_max': 50},
        ]
        resultado = generic_charts.generar_datos_cumplimiento_tramos(self._df(), 'vencimiento', 'saldo', metas)
        filas_por_tramo = {fila[0]: fila for fila in resultado['filas']}
        self.assertEqual(filas_por_tramo['Corriente'][3], 'Cumple')
        self.assertEqual(filas_por_tramo['Vencido ≤ 30 días (acum.)'][3], 'Sin meta')
        self.assertTrue(filas_por_tramo['Vencido ≤ 60 días (acum.)'][3].startswith('No cumple ('))
        self.assertTrue(filas_por_tramo['Más de 120 días'][3].startswith('No cumple ('))

    def test_sin_metas_todas_las_filas_quedan_sin_meta(self):
        resultado = generic_charts.generar_datos_cumplimiento_tramos(self._df(), 'vencimiento', 'saldo', None)
        self.assertTrue(all(fila[3] == 'Sin meta' for fila in resultado['filas']))

    def test_columna_faltante_devuelve_none(self):
        df = pd.DataFrame({'saldo': [100]})
        self.assertIsNone(generic_charts.generar_datos_cumplimiento_tramos(df, 'vencimiento', 'saldo', None))

    def test_el_acumulado_hasta_120_mas_la_cola_siempre_dan_100(self):
        """El invariante real de la tabla: las 6 filas NO suman 100% entre sí, porque las 5
        primeras se contienen unas a otras."""
        resultado = generic_charts.generar_datos_cumplimiento_tramos(self._df(), 'vencimiento', 'saldo')
        self.assertAlmostEqual(resultado['filas'][4][2] + resultado['filas'][5][2], 100.0, places=2)

    def test_una_fecha_invalida_no_desbalancea_los_porcentajes(self):
        """Regresión: las filas cuya fecha no parsea quedan fuera de todos los tramos, así que
        tampoco pueden estar en el denominador. Antes se incluían solo ahí y los porcentajes
        cerraban por debajo de 100% sin ninguna señal."""
        hoy = date.today()
        df = pd.DataFrame({
            'vencimiento': [
                (hoy - timedelta(days=10)).isoformat(),
                (hoy - timedelta(days=200)).isoformat(),
                'no-es-una-fecha',
            ],
            'saldo': [50, 30, 20],
        })
        resultado = generic_charts.generar_datos_cumplimiento_tramos(df, 'vencimiento', 'saldo')

        self.assertAlmostEqual(resultado['filas'][4][2] + resultado['filas'][5][2], 100.0, places=2)
        # Los 20 de la fila sin fecha válida no entran en ningún tramo ni en la base: 50 de 80.
        self.assertEqual(resultado['filas'][4][1], 50.0)
        self.assertAlmostEqual(resultado['filas'][4][2], 62.5, places=2)

    def test_una_meta_no_se_incumple_por_filas_con_fecha_invalida(self):
        """La consecuencia práctica del test anterior, en la unidad en que el usuario configura
        la meta: antes esta misma meta daba "No cumple" con 50%."""
        hoy = date.today()
        df = pd.DataFrame({
            'vencimiento': [(hoy - timedelta(days=10)).isoformat(), 'no-es-una-fecha'],
            'saldo': [100, 100],
        })
        metas = [None, {'meta_min': 90}, None, None, None, None]
        resultado = generic_charts.generar_datos_cumplimiento_tramos(df, 'vencimiento', 'saldo', metas)
        self.assertEqual(resultado['filas'][1][3], 'Cumple')

class GenerarDatosConcentracionServiceTests(TestCase):
    def _df(self):
        return pd.DataFrame({
            'cliente': ['A', 'B', 'C', 'D', 'E'],
            'saldo': [500, 300, 100, 60, 40],
        })

    def test_top_n_menor_a_la_cardinalidad_agrega_fila_resto(self):
        resultado = generic_charts.generar_datos_concentracion(self._df(), 'cliente', 'saldo', top_n=2)
        self.assertEqual(resultado['columnas'], ['cliente', 'saldo', '% del total', '% acumulado'])
        self.assertEqual(len(resultado['filas']), 3)
        self.assertEqual(resultado['filas'][0], ['A', 500.0, 50.0, 50.0])
        self.assertEqual(resultado['filas'][1], ['B', 300.0, 30.0, 80.0])
        fila_resto = resultado['filas'][2]
        self.assertEqual(fila_resto[0], 'Resto (3)')
        self.assertEqual(fila_resto[1], 200.0)
        self.assertEqual(fila_resto[3], 100.0)
        self.assertEqual(resultado['total'], ['Total', 1000.0, 100.0, 100.0])

    def test_top_n_mayor_o_igual_a_la_cardinalidad_no_agrega_resto(self):
        resultado = generic_charts.generar_datos_concentracion(self._df(), 'cliente', 'saldo', top_n=10)
        self.assertEqual(len(resultado['filas']), 5)
        self.assertNotIn('Resto', resultado['filas'][-1][0])

    def test_top_n_menor_a_uno_se_trata_como_uno(self):
        resultado = generic_charts.generar_datos_concentracion(self._df(), 'cliente', 'saldo', top_n=0)
        self.assertEqual(resultado['filas'][0][0], 'A')
        self.assertEqual(resultado['filas'][1][0], 'Resto (4)')

    def test_top_n_no_numerico_se_trata_como_uno(self):
        resultado = generic_charts.generar_datos_concentracion(self._df(), 'cliente', 'saldo', top_n='no numérico')
        self.assertEqual(resultado['filas'][0][0], 'A')

    def test_columna_faltante_devuelve_none(self):
        df = pd.DataFrame({'saldo': [100]})
        self.assertIsNone(generic_charts.generar_datos_concentracion(df, 'cliente', 'saldo', top_n=5))


class RecomendacionDeDispersionServiceTests(TestCase):
    """Con al menos dos columnas numéricas disponibles, `generar_recomendaciones` propone además
    UNA gráfica de dispersión (`_mejor_par_columnas_numericas`) — no una por cada combinación
    posible."""

    def test_con_dos_columnas_numericas_agrega_una_recomendacion_de_dispersion(self):
        columnas = [
            {'nombre': 'ventas', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10, 'valores_no_nulos': 10},
            {'nombre': 'ganancia', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10, 'valores_no_nulos': 8},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        dispersion = next(r for r in recomendaciones if r['tipo_grafica'] == 'dispersion')
        self.assertEqual(dispersion['columna_valor'], 'ventas')
        self.assertEqual(dispersion['columna_valor_y'], 'ganancia')
        self.assertIsNone(dispersion['columna_categoria'])

    def test_con_una_sola_columna_numerica_no_hay_recomendacion_de_dispersion(self):
        columnas = [
            {'nombre': 'ventas', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 10, 'valores_no_nulos': 10},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        self.assertFalse(any(r['tipo_grafica'] == 'dispersion' for r in recomendaciones))

    def test_calcular_datos_recomendaciones_calcula_los_puntos_de_la_dispersion(self):
        df = pd.DataFrame({'ventas': [100, 200], 'ganancia': [10, 20]})
        columnas = [
            {'nombre': 'ventas', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 2, 'valores_no_nulos': 2},
            {'nombre': 'ganancia', 'apta_para_valor': True, 'apta_para_categoria': False, 'valores_unicos': 2, 'valores_no_nulos': 2},
        ]
        recomendaciones = generic_charts.generar_recomendaciones(columnas)
        con_datos = generic_charts.calcular_datos_recomendaciones(df, recomendaciones)
        dispersion = next(r for r in con_datos if r['tipo_grafica'] == 'dispersion')
        self.assertEqual(dispersion['datos']['tipo'], 'dispersion')
        self.assertEqual(len(dispersion['datos']['puntos']), 2)
        self.assertIsNone(dispersion['datos_multiserie'])


class FlujoApiAnalizarRecomendarYAgregarTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_charts', email='tc@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas')

    def _subir_archivo(self):
        with open(FIXTURE_PATH, 'rb') as f:
            resp = self.client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': 'finanzas'}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        return resp.json()['carga_id']

    def test_analizar_columnas_devuelve_columnas_aptas_para_valor_y_categoria(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/analizar-columnas', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['total_filas'], 15)
        columna_saldo = next(c for c in data['columnas'] if c['nombre'] == 'Saldo')
        self.assertTrue(columna_saldo['apta_para_valor'])

    def test_analizar_columnas_sin_carga_id_devuelve_400(self):
        resp = self.client.post('/api/v1/cartera/analizar-columnas', {}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_recomendar_graficas_devuelve_recomendaciones_a_partir_del_archivo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/recomendar-graficas', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(len(data['recomendaciones']) > 0)
        recomendacion_saldo_total = next(r for r in data['recomendaciones'] if r['id'] == 'Saldo::total')
        self.assertEqual(recomendacion_saldo_total['tipo_grafica'], 'kpi')
        # Cada recomendación trae sus datos ya calculados, para poder previsualizarla sin una
        # solicitud aparte.
        self.assertIn('datos', recomendacion_saldo_total)
        self.assertEqual(recomendacion_saldo_total['datos']['tipo'], 'kpi')
        self.assertIsInstance(recomendacion_saldo_total['datos']['valor'], float)

    def test_recomendar_graficas_respeta_las_columnas_utilizables_del_usuario(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/recomendar-graficas', {
            'carga_id': carga_id, 'columnas_utilizables': ['Saldo'],
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # Solo "Saldo" fue marcada utilizable: ninguna recomendación debe agrupar por otra columna.
        self.assertTrue(all(r['columna_categoria'] is None for r in data['recomendaciones']))
        self.assertTrue(any(r['id'] == 'Saldo::total' for r in data['recomendaciones']))

    def test_recomendar_graficas_sin_columnas_utilizables_no_recomienda_nada(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/recomendar-graficas', {
            'carga_id': carga_id, 'columnas_utilizables': [],
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['recomendaciones'], [])

    def test_recomendar_graficas_no_borra_el_archivo_temporal(self):
        """El archivo debe seguir disponible para poder agregar varias gráficas después de
        recomendar (a diferencia del viejo `generar-dashboard`, que era una acción terminal)."""
        carga_id = self._subir_archivo()
        self.client.post('/api/v1/cartera/recomendar-graficas', {'carga_id': carga_id}, format='json')
        carga = CargaArchivo.objects.get(id=carga_id)
        self.assertNotEqual(carga.archivo_temp_nombre, '')

    def test_agregar_grafica_crea_el_componente_y_marca_la_carga_procesada(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cartera total', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(len(data['components']), 1)

        carga = CargaArchivo.objects.get(id=carga_id)
        self.assertEqual(carga.estado, CargaArchivo.Estado.PROCESADO)
        # A diferencia del viejo flujo, el archivo temporal se conserva: puede haber más
        # gráficas por agregar desde la misma carga.
        self.assertNotEqual(carga.archivo_temp_nombre, '')

    def test_agregar_dos_graficas_de_la_misma_carga_se_suman(self):
        carga_id = self._subir_archivo()
        self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cartera total', 'columna_valor': 'Saldo',
        }, format='json')
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por causal', 'columna_valor': 'Saldo', 'columna_categoria': 'Causal',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        titulos = sorted(c['content']['titulo'] for c in resp.json()['components'])
        self.assertEqual(titulos, ['Cartera total', 'Saldo por causal'])

    def test_agregar_grafica_kpi_con_meta_adjunta_meta_al_contenido(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cartera total', 'calculo': 'kpi', 'columna_valor': 'Saldo',
            'meta_min': 1, 'meta_max': 2,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertIn('meta', componente['content'])
        self.assertFalse(componente['content']['meta']['cumple'])

    def test_agregar_grafica_tramos_antiguedad_caso_feliz(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Antigüedad', 'calculo': 'tramos_antiguedad',
            'columna_valor': 'Saldo', 'columna_fecha': 'Fecha de Vencimiento',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['type'], 'chart')
        self.assertEqual(componente['content']['categorias'], generic_charts.ETIQUETAS_TRAMOS_ANTIGUEDAD)

    def test_agregar_grafica_tramos_antiguedad_sin_columna_fecha_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Antigüedad', 'calculo': 'tramos_antiguedad', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_FECHA_REQUERIDA')

    def test_agregar_grafica_cumplimiento_metas_caso_feliz(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cumplimiento', 'calculo': 'cumplimiento_metas',
            'columna_valor': 'Saldo', 'columna_fecha': 'Fecha de Vencimiento', 'metas': [{'meta_min': 10}],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['chart_type'], 'tabla')
        self.assertEqual(componente['content']['columnas'], ['Tramo', 'Saldo', '% acumulado', 'Resultado'])

    def test_agregar_grafica_cumplimiento_metas_sin_columna_fecha_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cumplimiento', 'calculo': 'cumplimiento_metas', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_FECHA_REQUERIDA')

    def test_agregar_grafica_concentracion_caso_feliz(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Concentración', 'calculo': 'concentracion',
            'columna_valor': 'Saldo', 'columna_id': 'Cliente', 'top_n': 5,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['chart_type'], 'tabla')
        self.assertEqual(componente['content']['columnas'], ['Cliente', 'Saldo', '% del total', '% acumulado'])

    def test_agregar_grafica_concentracion_sin_columna_id_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Concentración', 'calculo': 'concentracion', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_ID_REQUERIDA')

    def test_agregar_grafica_respeta_el_tipo_de_visualizacion_elegido(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por causal', 'columna_valor': 'Saldo',
            'columna_categoria': 'Causal', 'tipo_visualizacion': 'pastel',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['chart_type'], 'pastel')
        self.assertEqual(componente['type'], 'chart')

    def test_agregar_grafica_con_tipo_kpi_ignora_la_categoria_y_suma_el_total(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Total de saldo', 'columna_valor': 'Saldo',
            'columna_categoria': 'Causal', 'tipo_visualizacion': 'kpi',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['type'], 'kpi')
        self.assertIn('valor', componente['content'])
        self.assertNotIn('categorias', componente['content'])

    def test_agregar_grafica_agrupada_calcula_datos_multiserie(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por ciudad y causal', 'columna_valor': 'Saldo',
            'columna_categoria': 'Lugar Geográfico', 'columna_serie': 'Causal', 'tipo_visualizacion': 'barras_agrupadas',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['chart_type'], 'barras_agrupadas')
        self.assertIn('series', componente['content'])
        self.assertIn('categorias', componente['content'])

    def test_agregar_grafica_sin_descripcion_guarda_descripcion_vacia(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cartera total', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['content']['descripcion'], '')

    def test_agregar_grafica_con_descripcion_la_guarda_en_el_contenido(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por causal', 'columna_valor': 'Saldo',
            'columna_categoria': 'Causal', 'descripcion': 'Distribución del saldo por causal.',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['content']['descripcion'], 'Distribución del saldo por causal.')

    def test_agregar_grafica_pastel_incluye_posicion_de_leyenda_por_defecto(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por causal', 'columna_valor': 'Saldo',
            'columna_categoria': 'Causal', 'tipo_visualizacion': 'pastel',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['config']['leyenda_posicion'], 'abajo')

    def test_agregar_grafica_barras_horizontales_no_incluye_posicion_de_leyenda(self):
        """Las gráficas de una sola serie no dibujan leyenda, así que no necesitan la config."""
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por causal', 'columna_valor': 'Saldo',
            'columna_categoria': 'Causal', 'tipo_visualizacion': 'barras_horizontales',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertNotIn('leyenda_posicion', componente['config'])

    def test_agregar_grafica_agrupada_incluye_posicion_de_leyenda_por_defecto(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por ciudad y causal', 'columna_valor': 'Saldo',
            'columna_categoria': 'Lugar Geográfico', 'columna_serie': 'Causal', 'tipo_visualizacion': 'barras_agrupadas',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['config']['leyenda_posicion'], 'abajo')

    def test_agregar_grafica_apilada_sin_columna_serie_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo apilado', 'columna_valor': 'Saldo',
            'columna_categoria': 'Lugar Geográfico', 'tipo_visualizacion': 'barras_apiladas',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_SERIE_REQUERIDA')

    def test_agregar_grafica_area_apilada_calcula_datos_multiserie_e_incluye_leyenda(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por ciudad y causal (área)', 'columna_valor': 'Saldo',
            'columna_categoria': 'Lugar Geográfico', 'columna_serie': 'Causal', 'tipo_visualizacion': 'area_apilada',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['chart_type'], 'area_apilada')
        self.assertIn('series', componente['content'])
        self.assertEqual(componente['config']['leyenda_posicion'], 'abajo')

    def test_agregar_grafica_dispersion_calcula_los_puntos(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo vs. Dias credito', 'columna_valor': 'Saldo',
            'columna_valor_y': 'Dias credito', 'tipo_visualizacion': 'dispersion',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['chart_type'], 'dispersion')
        self.assertEqual(componente['type'], 'chart')
        self.assertIn('puntos', componente['content'])
        self.assertTrue(len(componente['content']['puntos']) > 0)

    def test_agregar_grafica_dispersion_sin_columna_valor_y_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo vs. nada', 'columna_valor': 'Saldo',
            'tipo_visualizacion': 'dispersion',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_VALOR_Y_REQUERIDA')

    def test_agregar_grafica_sin_titulo_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TITULO_REQUERIDO')

    def test_agregar_grafica_con_columna_invalida_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'X', 'columna_valor': 'no_existe',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_INVALIDA')

    def test_reemplazar_existentes_en_una_carga_nueva_no_mezcla_datos_de_dos_archivos(self):
        carga_id = self._subir_archivo()
        self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Primera', 'columna_valor': 'Saldo',
        }, format='json')

        carga_id_2 = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id_2, 'titulo': 'Segunda', 'columna_valor': 'Saldo', 'reemplazar_existentes': True,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        titulos = [c['content']['titulo'] for c in resp.json()['components']]
        self.assertEqual(titulos, ['Segunda'])

    # --- Zona Personal: `calculo` explícito, `ancho_columnas`, `zona` (sección "Zona Personal") ---

    def test_agregar_con_calculo_tabla_calcula_una_tabla_multicolumna(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Detalle por causal', 'calculo': 'tabla',
            'columna_id': 'Causal', 'columnas_valor': [{'columna': 'Saldo', 'tipo_agregacion': 'suma'}],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['chart_type'], 'tabla')
        self.assertIn('columnas', componente['content'])
        self.assertIn('filas', componente['content'])
        self.assertIn('total', componente['content'])

    def test_agregar_con_calculo_tabla_sin_columna_id_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Detalle', 'calculo': 'tabla',
            'columnas_valor': [{'columna': 'Saldo', 'tipo_agregacion': 'suma'}],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_VALOR_REQUERIDA')

    def test_agregar_con_calculo_tabla_usa_historico_arma_una_fila_por_carga(self):
        carga_previa = CargaArchivo.objects.create(dashboard_id='finanzas', nombre_original='enero.xlsx')
        historico.guardar_filas_historicas(carga_previa, pd.DataFrame({'Saldo': [100, 200]}), ['Saldo'])

        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo histórico', 'calculo': 'tabla', 'usa_historico': True,
            'columnas_valor': [{'columna': 'Saldo', 'tipo_agregacion': 'suma'}],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['content']['columnas'], ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'Saldo'])
        self.assertEqual(componente['content']['filas'][0][-1], 300.0)
        self.assertIsNone(componente['content']['total'])
        self.assertTrue(componente['mapeo']['usa_historico'])

    def test_agregar_con_calculo_tabla_usa_historico_sin_columna_elegida_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'X', 'calculo': 'tabla', 'usa_historico': True,
            'columnas_valor': [None],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_VALOR_REQUERIDA')

    def test_agregar_con_calculo_tabla_usa_historico_sin_columnas_valor_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'X', 'calculo': 'tabla', 'usa_historico': True,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_VALOR_REQUERIDA')

    def test_agregar_con_calculo_tabla_sin_usa_historico_no_persiste_ese_campo_en_el_mapeo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Detalle', 'calculo': 'tabla',
            'columna_id': 'Causal', 'columnas_valor': [{'columna': 'Saldo', 'tipo_agregacion': 'suma'}],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertNotIn('usa_historico', componente['mapeo'])

    def _crear_carga_historica(self, columnas):
        carga = CargaArchivo.objects.create(dashboard_id='finanzas', nombre_original='enero.xlsx')
        historico.guardar_filas_historicas(carga, pd.DataFrame(columnas), list(columnas.keys()))
        return carga

    def test_agregar_con_calculo_kpi_usa_historico_toma_el_valor_de_la_carga_mas_reciente(self):
        self._crear_carga_historica({'Saldo': [100, 200]})
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo histórico', 'calculo': 'kpi', 'usa_historico': True,
            'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['type'], 'kpi')
        self.assertEqual(componente['content']['valor'], 300.0)
        self.assertTrue(componente['mapeo']['usa_historico'])

    def test_agregar_con_calculo_kpi_usa_historico_sin_datos_historicos_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'X', 'calculo': 'kpi', 'usa_historico': True, 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_INVALIDA')

    def test_agregar_con_calculo_chart_usa_historico_arma_una_categoria_por_carga(self):
        self._crear_carga_historica({'Saldo': [100, 200]})
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo histórico', 'calculo': 'chart', 'usa_historico': True,
            'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['content']['categorias'], ['enero.xlsx'])
        self.assertEqual(componente['content']['valores'], [300.0])
        self.assertTrue(componente['mapeo']['usa_historico'])

    def test_agregar_con_calculo_multivalor_usa_historico_arma_una_serie_por_columna(self):
        self._crear_carga_historica({'Saldo': [100, 200], 'Dias credito': [10, 20]})
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Comparación histórica', 'calculo': 'multivalor', 'usa_historico': True,
            'columnas_valor': ['Saldo', 'Dias credito'],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['content']['categorias'], ['enero.xlsx'])
        self.assertEqual(len(componente['content']['series']), 2)
        self.assertTrue(componente['mapeo']['usa_historico'])

    def test_agregar_con_calculo_multiserie_usa_historico_arma_una_serie_por_valor_de_columna_serie(self):
        self._crear_carga_historica({'Saldo': [100, 200], 'Causal': ['GESTIONANDO', 'PAGADO']})
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por causal (histórico)', 'calculo': 'multiserie', 'usa_historico': True,
            'columna_valor': 'Saldo', 'columna_serie': 'Causal',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['content']['categorias'], ['enero.xlsx'])
        nombres_serie = sorted(s['nombre'] for s in componente['content']['series'])
        self.assertEqual(nombres_serie, ['GESTIONANDO', 'PAGADO'])
        self.assertTrue(componente['mapeo']['usa_historico'])

    def test_agregar_con_calculo_multiserie_usa_historico_sin_columna_serie_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'X', 'calculo': 'multiserie', 'usa_historico': True, 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNA_SERIE_REQUERIDA')

    def test_agregar_con_calculo_multivalor_calcula_series_por_columna(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Comparación', 'calculo': 'multivalor',
            'columna_categoria': 'Causal', 'columnas_valor': ['Saldo', 'Dias credito'],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertIn('series', componente['content'])
        self.assertEqual(len(componente['content']['series']), 2)

    def test_agregar_con_calculo_multivalor_con_una_sola_columna_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Comparación', 'calculo': 'multivalor',
            'columna_categoria': 'Causal', 'columnas_valor': ['Saldo'],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLUMNAS_VALOR_REQUERIDAS')

    def test_agregar_con_calculo_kpi_y_tipo_agregacion_promedio(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo promedio', 'calculo': 'kpi',
            'columna_valor': 'Saldo', 'tipo_agregacion': 'promedio',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['type'], 'kpi')

    def test_agregar_con_calculo_kpi_y_tipo_agregacion_conteo_unicos(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Clientes distintos', 'calculo': 'kpi',
            'columna_valor': 'Ruc Cliente', 'tipo_agregacion': 'conteo_unicos',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        componente = resp.json()['components'][0]
        self.assertEqual(componente['type'], 'kpi')

    def test_ancho_columnas_1_2_4_traduce_a_width_12_6_3(self):
        carga_id = self._subir_archivo()
        for ancho_columnas, width_esperado in ((1, 12), (2, 6), (4, 3)):
            resp = self.client.post('/api/v1/cartera/agregar-grafica', {
                'carga_id': carga_id, 'titulo': f'KPI ancho {ancho_columnas}', 'columna_valor': 'Saldo',
                'ancho_columnas': ancho_columnas, 'reemplazar_existentes': True,
            }, format='json')
            self.assertEqual(resp.status_code, 201)
            componente = resp.json()['components'][0]
            self.assertEqual(componente['width'], width_esperado)

    def test_sin_ancho_columnas_mantiene_el_ancho_legado(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'KPI legado', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['width'], dashboard_layout.KPI_ANCHO)

    def test_ancho_columnas_invalido_devuelve_400(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'X', 'columna_valor': 'Saldo', 'ancho_columnas': 3,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'ANCHO_COLUMNAS_INVALIDO')

    def test_zona_personal_queda_en_config(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'KPI personal', 'columna_valor': 'Saldo', 'zona': 'personal',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['config']['zona'], 'personal')

    def test_sin_zona_no_queda_marcado_en_config(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'KPI sin zona', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertNotIn('zona', resp.json()['components'][0]['config'])

    def test_instruccion_ia_y_columna_contexto_quedan_en_config_con_su_desglose_calculado(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por zona', 'columna_valor': 'Saldo',
            'columna_categoria': 'Zona', 'zona': 'personal',
            'instruccion_ia': 'Explicá los totales por la causal de gestión.',
            'columna_contexto_ia': 'Causal',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        config = resp.json()['components'][0]['config']
        self.assertEqual(config['instruccion_ia'], 'Explicá los totales por la causal de gestión.')
        self.assertEqual(config['contexto_ia']['columna'], 'Causal')
        self.assertTrue(len(config['contexto_ia']['categorias']) > 0)
        self.assertEqual(len(config['contexto_ia']['categorias']), len(config['contexto_ia']['valores']))

    def test_sin_instruccion_ia_ni_columna_contexto_no_quedan_en_config(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cartera total', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        config = resp.json()['components'][0]['config']
        self.assertNotIn('instruccion_ia', config)
        self.assertNotIn('contexto_ia', config)

    def test_columna_contexto_ia_invalida_no_rompe_ni_agrega_el_desglose(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cartera total', 'columna_valor': 'Saldo',
            'columna_contexto_ia': 'Columna que no existe',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertNotIn('contexto_ia', resp.json()['components'][0]['config'])

    def test_agregar_grafica_con_calculo_kpi_guarda_el_mapeo(self):
        """`mapeo` es lo que permite reconfigurar después la fuente de datos desde "Configurar
        componente" → "Datos" — sin `calculo` explícito (flujo legado) no se guarda nada acá."""
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Mi KPI', 'calculo': 'kpi', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'kpi', 'columna_valor': 'Saldo',
        })

    def test_agregar_grafica_con_calculo_kpi_y_tipo_agregacion_lo_guarda_en_el_mapeo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Clientes únicos', 'calculo': 'kpi',
            'columna_valor': 'Ruc Cliente', 'tipo_agregacion': 'conteo_unicos',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'kpi', 'columna_valor': 'Ruc Cliente', 'tipo_agregacion': 'conteo_unicos',
        })

    def test_agregar_grafica_con_calculo_chart_guarda_el_mapeo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por causal', 'calculo': 'chart',
            'columna_valor': 'Saldo', 'columna_categoria': 'Causal',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'chart', 'columna_valor': 'Saldo', 'columna_categoria': 'Causal',
        })

    def test_agregar_grafica_con_calculo_multivalor_guarda_el_mapeo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Comparación', 'calculo': 'multivalor',
            'columna_categoria': 'Causal', 'columnas_valor': ['Saldo', 'Dias credito'],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'multivalor', 'columna_categoria': 'Causal',
            'columnas_valor': ['Saldo', 'Dias credito'],
        })

    def test_agregar_grafica_con_calculo_multiserie_guarda_el_mapeo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo por ciudad y causal', 'calculo': 'multiserie',
            'columna_valor': 'Saldo', 'columna_categoria': 'Lugar Geográfico', 'columna_serie': 'Causal',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'multiserie', 'columna_categoria': 'Lugar Geográfico',
            'columna_serie': 'Causal', 'columna_valor': 'Saldo',
        })

    def test_agregar_grafica_con_calculo_dispersion_guarda_el_mapeo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Saldo vs. Dias credito', 'calculo': 'dispersion',
            'columna_valor': 'Saldo', 'columna_valor_y': 'Dias credito',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'dispersion', 'columna_valor': 'Saldo', 'columna_valor_y': 'Dias credito',
        })

    def test_agregar_grafica_con_calculo_tabla_guarda_el_mapeo(self):
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Detalle', 'calculo': 'tabla',
            'columna_id': 'Cliente', 'columnas_valor': ['Saldo'],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'tabla', 'columna_id': 'Cliente', 'columnas_valor': ['Saldo'],
        })

    def test_agregar_grafica_sin_calculo_explicito_igual_guarda_el_mapeo_inferido(self):
        """Flujo legado de recomendaciones automáticas (`calculo` no viene, se infiere por
        `tipo_visualizacion`) — la inferencia es igual de determinística que un `calculo`
        explícito, así que también queda reconfigurable después desde "Datos"."""
        carga_id = self._subir_archivo()
        resp = self.client.post('/api/v1/cartera/agregar-grafica', {
            'carga_id': carga_id, 'titulo': 'Cartera total', 'columna_valor': 'Saldo',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['components'][0]['mapeo'], {
            'disponible': True, 'calculo': 'chart', 'columna_valor': 'Saldo', 'columna_categoria': None,
        })


class ColapsoEnOtrasTests(TestCase):
    """Nada que quede fuera del top puede desaparecer sin dejar una fila/serie 'Otras'."""

    def test_otras_aparece_aunque_el_resto_sume_exactamente_cero(self):
        """Dos categorías que se cancelan (+50 y −50) desaparecían del gráfico: el `if resto:`
        omitía la barra y con ella toda señal de que existían."""
        datos = {f'C{i}': 100 - i for i in range(15)}
        datos['X'], datos['Y'] = 50, -50
        df = pd.DataFrame({'cat': list(datos.keys()), 'val': list(datos.values())})

        resultado = generic_charts.generar_datos_grafica(df, 'val', 'cat')

        self.assertIn('Otras', resultado['categorias'])
        self.assertEqual(resultado['valores'][resultado['categorias'].index('Otras')], 0.0)

    def test_multivalor_rankea_las_categorias_por_la_suma_de_todas_las_columnas(self):
        """Rankeando solo por la primera columna, los meses de mayor INGRESO quedaban colapsados
        en 'Otras' porque eran justo los de menor GASTO — el gráfico escondía lo que se quería
        comparar.

        Los gastos bajan de 20 a 1 y los ingresos suben de 0 a 1900, así que los dos criterios
        eligen conjuntos opuestos: por gastos entran M00..M14, por la suma entran M05..M19.
        """
        filas = [
            {'mes': f'M{i:02d}', 'gastos': 20 - i, 'ingresos': i * 100}
            for i in range(20)
        ]

        resultado = generic_charts.generar_datos_multivalor(pd.DataFrame(filas), 'mes', ['gastos', 'ingresos'])

        mostradas = [c for c in resultado['categorias'] if c != 'Otras']
        # Los 5 meses de mayor ingreso tienen que estar entre los visibles.
        for mes in ('M19', 'M18', 'M17', 'M16', 'M15'):
            self.assertIn(mes, mostradas)
        # Y los de menor ingreso (y mayor gasto) son los que se colapsan.
        self.assertNotIn('M00', mostradas)


class AntiguedadPorDeudorTests(TestCase):
    """Cruza concentración con antigüedad: cuánto debe cada cliente Y en qué tramo está.

    Es lo que distingue una mora crónica (peso en "+120 días" — renegociación o vía legal) de una
    reciente (peso en 30-60 días — cobranza inmediata antes de que escale). Ninguno de los dos
    cálculos por separado lo responde.
    """

    def setUp(self):
        self.corte = date(2026, 8, 31)
        self.df = pd.DataFrame({
            'Cliente': ['GRANDE', 'GRANDE', 'MEDIANO', 'CHICO'],
            'Saldo': [1000.0, 500.0, 400.0, 100.0],
            'Vence': [
                date(2026, 1, 15),   # vencida hace más de 120 días
                date(2026, 9, 30),   # aún no vence
                date(2026, 8, 20),   # vencida hace 11 días
                date(2026, 8, 20),
            ],
        })

    def _datos(self, **kwargs):
        opciones = {'columna_id': 'Cliente', 'columna_fecha': 'Vence', 'columna_valor': 'Saldo',
                    'cuantos': 2, 'fecha_referencia': self.corte}
        opciones.update(kwargs)
        return generic_charts.generar_datos_antiguedad_por_deudor(self.df, **opciones)

    def test_devuelve_los_mayores_deudores_en_orden(self):
        deudores = self._datos()['deudores']
        self.assertEqual([d['nombre'] for d in deudores], ['GRANDE', 'MEDIANO'])
        self.assertEqual(deudores[0]['total'], 1500.0)

    def test_el_porcentaje_es_sobre_la_cartera_total(self):
        deudores = self._datos()['deudores']
        self.assertEqual(deudores[0]['porcentaje_cartera'], 75.0)   # 1500 de 2000
        self.assertEqual(deudores[1]['porcentaje_cartera'], 20.0)   # 400 de 2000

    def test_el_porcentaje_de_cada_tramo_es_sobre_el_saldo_de_ese_deudor(self):
        # Es lo que permite comparar dos deudores de tamaños muy distintos.
        filas = self._datos()['deudores'][0]['filas']
        self.assertEqual(sum(fila[2] for fila in filas), 100.0)

    def test_lista_los_seis_tramos_aunque_esten_en_cero(self):
        # Criterio cambiado a pedido: antes se omitían los tramos vacíos. Un tramo en 0 dice que
        # ese cliente NO tiene mora ahí, y además los bloques de dos deudores se leen fila por
        # fila — omitiendo los ceros, uno con seis tramos y otro con uno solo no se podían
        # comparar de un vistazo.
        filas = self._datos()['deudores'][1]['filas']
        self.assertEqual(len(filas), 6)
        self.assertEqual([fila[0] for fila in filas], list(generic_charts.ETIQUETAS_TRAMOS_ANTIGUEDAD))
        con_saldo = [fila for fila in filas if fila[1]]
        self.assertEqual(len(con_saldo), 1)
        self.assertEqual(con_saldo[0][0], '30 días')

    def test_un_tramo_sin_documentos_vale_cero_en_saldo_y_en_porcentaje(self):
        filas = self._datos()['deudores'][1]['filas']
        vacios = [fila for fila in filas if fila[0] != '30 días']
        for fila in vacios:
            with self.subTest(tramo=fila[0]):
                self.assertEqual(fila[1], 0)
                self.assertEqual(fila[2], 0)

    def test_un_deudor_sin_saldo_clasificado_no_destaca_ningun_tramo(self):
        # Con todos los tramos en cero, `max` devolvería el primero y se señalaría un tramo vacío
        # como si fuera el problema del cliente.
        df = pd.DataFrame({
            'Cliente': ['SOLO'],
            'Saldo': [0.0],
            'Vence': [date(2026, 1, 1)],
        })
        datos = generic_charts.generar_datos_antiguedad_por_deudor(
            df, 'Cliente', 'Vence', 'Saldo', cuantos=1, fecha_referencia=date(2026, 8, 31))
        self.assertIsNone(datos['deudores'][0]['tramo_mayor'])

    def test_senala_el_tramo_mas_pesado(self):
        deudores = self._datos()['deudores']
        self.assertEqual(deudores[0]['tramo_mayor'], '+120 días')  # 1000 en +120 vs 500 anticipado
        self.assertEqual(deudores[1]['tramo_mayor'], '30 días')

    def test_cuantos_acota_la_cantidad_de_bloques(self):
        self.assertEqual(len(self._datos(cuantos=1)['deudores']), 1)
        self.assertEqual(len(self._datos(cuantos=3)['deudores']), 3)

    def test_cuantos_se_recorta_al_limite_en_vez_de_romper(self):
        # De mejor esfuerzo, igual que `top_n` en concentración: la validación estricta vive en
        # `dashboard_layout.validar_componentes`; esto nunca debe romper una vista previa en vivo.
        deudores = self._datos(cuantos=99)['deudores']
        self.assertLessEqual(len(deudores), generic_charts.LIMITE_DEUDORES)
        self.assertEqual(len(self._datos(cuantos='x')['deudores']), 2)

    def test_devuelve_none_si_falta_una_columna(self):
        self.assertIsNone(self._datos(columna_fecha='No existe'))
        self.assertIsNone(self._datos(columna_id='No existe'))
