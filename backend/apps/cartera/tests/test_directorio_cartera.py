"""Dashboard Directorio — réplica de la pestaña "6. Cartera" de un informe financiero.

Lo que estas pruebas protegen es que el dashboard sea PARAMETRIZABLE. Una versión anterior guardaba
el contenido con una forma propia y `mapeo` vacío: se veía igual, pero las columnas, las metas y el
Top-N estaban quemados en el código y "Configurar componente → Datos" no tenía nada que editar.

Por eso acá se verifica, además de la estructura y la coherencia de las cifras, que cada sección
guarde un `mapeo` completo y que su contenido sea el GENÉRICO — el mismo que produce
`calcular_contenido_por_calculo` para cualquier dashboard. Esa es la condición para que la pantalla
de configuración de siempre pueda recalcularlas.
"""

from datetime import date

import pandas as pd
from django.test import TestCase

from apps.cartera.services import dashboard_layout, directorio_cartera, plantilla

DASHBOARD = 'directorio-prueba'
CORTE = date(2026, 8, 31)


def _df():
    """Facturas con vencimientos elegidos alrededor del corte para caer en tramos distintos."""
    return pd.DataFrame({
        'Cliente': ['ACME', 'ACME', 'BETA', 'GAMMA', 'DELTA'],
        'Saldo': [1000.0, 500.0, 300.0, 150.0, 50.0],
        'Fecha de Vencimiento': [
            date(2026, 9, 30),   # aún no vence al 31/08 -> Anticipada
            date(2026, 8, 20),   # vencida hace 11 días  -> 30 días
            date(2026, 1, 15),   # vencida hace >120     -> +120 días
            date(2026, 2, 10),   # vencida hace >120     -> +120 días
            date(2026, 7, 20),   # vencida hace 42 días  -> 60 días
        ],
    })


def _contenidos(**parametros):
    return {spec['component_id']: contenido
            for spec, contenido in directorio_cartera.calcular_contenidos(_df(), CORTE, **parametros)}


def _specs_calculadas():
    """Las secciones que PRECALCULAN contenido — todas menos la consulta por cliente, que lo pide
    en vivo. Las invariantes de mapeo y cálculo aplican a estas."""
    return [s for s in directorio_cartera.especificacion() if s['calculo']]


class SeccionDeConsultaTests(TestCase):
    """La consulta por cliente no precalcula nada: su contenido lo trae `services/consulta_deudor.py`
    cuando alguien busca. Este bloque fija lo que SÍ tiene que cumplir, para que no se cuele por el
    hueco que deja no tener cálculo."""

    def setUp(self):
        self.spec = next(s for s in directorio_cartera.especificacion()
                         if s['component_id'] == 'consulta-deudor')

    def test_no_declara_calculo_porque_no_precalcula_nada(self):
        self.assertIsNone(self.spec['calculo'])
        self.assertNotIn('calculo', self.spec['mapeo'])

    def test_no_queda_disponible_para_recalculo(self):
        # Con `disponible: True` un reproceso intentaría calcular un contenido que no existe.
        self.assertFalse(self.spec['mapeo']['disponible'])

    def test_declara_las_columnas_que_la_consulta_necesita(self):
        for clave in ('columna_id', 'columna_ruc', 'columna_fecha', 'columna_valor'):
            with self.subTest(clave=clave):
                self.assertIn(clave, self.spec['mapeo'])

    def test_las_columnas_son_parametros_como_en_el_resto_de_las_secciones(self):
        spec = next(s for s in directorio_cartera.especificacion(columna_valor='Importe',
                                                                columna_cliente='Razón social')
                    if s['component_id'] == 'consulta-deudor')
        self.assertEqual(spec['mapeo']['columna_valor'], 'Importe')
        self.assertEqual(spec['mapeo']['columna_id'], 'Razón social')

    def test_trae_columnas_de_detalle_por_defecto(self):
        # Sin ninguna elegida el detalle mostraría las 28 del archivo, que no se lee.
        self.assertTrue(self.spec['config']['columnas_detalle'])

    def test_las_columnas_del_detalle_siguen_a_las_elegidas(self):
        # El origen de producción llama "Saldo Total" a lo que el Excel llamaba "Saldo". Con la
        # lista de detalle literal, el detalle de un cliente se abría SIN la columna del saldo —el
        # dato por el que se lo busca—, porque esa columna no existe con ese nombre.
        spec = next(s for s in directorio_cartera.especificacion(columna_valor='Saldo Total')
                    if s['component_id'] == 'consulta-deudor')
        columnas = spec['config']['columnas_detalle']
        self.assertIn('Saldo Total', columnas)
        self.assertNotIn('Saldo', columnas)
        self.assertEqual(len(columnas), len(set(columnas)))

    def test_el_ruc_es_un_parametro_y_puede_no_existir(self):
        # Una fuente que no trae identificador no es un error: la consulta cae a identificar por
        # nombre (`consulta_deudor._identidad`). Lo que no puede es quedar con el nombre por
        # defecto de una columna que no existe.
        spec = next(s for s in directorio_cartera.especificacion(columna_ruc='')
                    if s['component_id'] == 'consulta-deudor')
        self.assertEqual(spec['mapeo']['columna_ruc'], '')

    def test_va_al_final_del_dashboard(self):
        # Las secciones de arriba son la réplica del informe impreso y se leen en ese orden; esta
        # es una herramienta de consulta a demanda, así que cierra el dashboard en vez de
        # interponerse (entre el gráfico y la tabla de cumplimiento, además, partía la fila que
        # esos dos forman).
        ids = [s['component_id'] for s in directorio_cartera.especificacion()]
        self.assertEqual(ids[-1], 'consulta-deudor')


class ParametrizacionTests(TestCase):
    """El motivo de ser de este archivo: que nada quede quemado."""

    def test_cada_seccion_guarda_un_mapeo_completo(self):
        # Solo las secciones CALCULADAS: "Consulta por cliente" no precalcula nada (su contenido se
        # consulta en vivo contra el archivo), así que no declara cálculo. Su propio contrato está
        # en `SeccionDeConsultaTests`.
        for spec in _specs_calculadas():
            with self.subTest(seccion=spec['component_id']):
                mapeo = spec['mapeo']
                self.assertTrue(mapeo.get('disponible'))
                self.assertEqual(mapeo['calculo'], spec['calculo'])
                # Sin columnas en el mapeo no hay nada que ofrecer en "Configurar componente".
                self.assertTrue(
                    any(clave.startswith('columna_') for clave in mapeo),
                    f'{spec["component_id"]} no declara ninguna columna en su mapeo',
                )

    def test_los_calculos_son_los_que_la_interfaz_sabe_editar(self):
        # `SlotFields.jsx` tiene un formulario por cada uno de estos. Un cálculo fuera de esta lista
        # se vería, pero no se podría reconfigurar desde la pantalla.
        editables = {'kpi', 'tramos_antiguedad', 'cumplimiento_metas', 'concentracion',
                     'antiguedad_por_deudor'}
        for spec in _specs_calculadas():
            with self.subTest(seccion=spec['component_id']):
                self.assertIn(spec['calculo'], editables)

    def test_las_columnas_son_parametros_y_llegan_al_mapeo(self):
        specs = directorio_cartera.especificacion(
            columna_valor='Importe', columna_fecha='Vence', columna_cliente='Razón social',
        )
        mapeos = {s['component_id']: s['mapeo'] for s in specs}
        self.assertEqual(mapeos['cartera-total']['columna_valor'], 'Importe')
        self.assertEqual(mapeos['antiguedad-de-cartera']['columna_fecha'], 'Vence')
        self.assertEqual(mapeos['concentracion-de-cartera']['columna_id'], 'Razón social')
        self.assertEqual(mapeos['al-corriente']['columna_filtro'], 'Vence')

    def test_la_cantidad_de_deudores_es_un_parametro(self):
        specs = {s['component_id']: s for s in directorio_cartera.especificacion(deudores=4)}
        self.assertEqual(specs['mayores-deudores']['mapeo']['cuantos'], 4)

    def test_cambiar_la_cantidad_de_deudores_cambia_el_resultado(self):
        self.assertEqual(len(_contenidos(deudores=1)['mayores-deudores']['deudores']), 1)
        self.assertEqual(len(_contenidos(deudores=3)['mayores-deudores']['deudores']), 3)

    def test_el_top_n_es_un_parametro(self):
        specs = {s['component_id']: s for s in directorio_cartera.especificacion(top_n=3)}
        self.assertEqual(specs['concentracion-de-cartera']['mapeo']['top_n'], 3)

    def test_el_titulo_de_concentracion_no_lleva_el_numero_escrito(self):
        # El número va como marcador `{n}` y lo resuelve el renderer con el `top_n` vigente. Si se
        # escribiera acá, cambiar el Top-N desde la interfaz actualizaría las tarjetas y la tabla
        # pero dejaría el título con la cifra vieja — el título se guarda una sola vez.
        titulo = next(s['titulo'] for s in directorio_cartera.especificacion(top_n=3)
                      if s['component_id'] == 'concentracion-de-cartera')
        self.assertIn('{n}', titulo)
        self.assertNotIn('TOP 3', titulo)

    def test_cambiar_el_top_n_cambia_el_resultado(self):
        con_2 = _contenidos(top_n=2)['concentracion-de-cartera']
        con_3 = _contenidos(top_n=3)['concentracion-de-cartera']
        # N principales + la fila "Resto".
        self.assertEqual(len(con_2['filas']), 3)
        self.assertEqual(len(con_3['filas']), 4)

    def test_las_metas_viajan_en_el_mapeo_y_no_en_el_codigo_del_renderer(self):
        spec = next(s for s in directorio_cartera.especificacion()
                    if s['component_id'] == 'cumplimiento-metas-antiguedad')
        metas = spec['mapeo']['metas']
        self.assertEqual(len(metas), 6)
        self.assertEqual(metas[0]['meta_min'], 50)
        self.assertEqual(metas[-1]['meta_max'], 5)

    def test_el_contenido_es_el_generico_no_una_forma_propia(self):
        # Si el contenido tuviera una forma propia, la primera edición desde la interfaz —que
        # recalcula con `calcular_contenido_por_calculo`— dejaría la sección en blanco.
        #
        # `fecha_corte` en el KPI total es la única clave agregada, y es ADITIVA: el informe la
        # muestra como "Corte junio 2026" bajo el total, y el renderer cae a la descripción cuando
        # no está. Por eso no rompe la invariante que este test protege — se compara el resto.
        calculadas = {s['component_id'] for s in _specs_calculadas()}
        for component_id, contenido in _contenidos().items():
            if component_id not in calculadas:
                continue  # la consulta por cliente no produce contenido: ver SeccionDeConsultaTests
            with self.subTest(seccion=component_id):
                self.assertIsNotNone(contenido)
                self.assertNotIn('bloque', contenido)
                self.assertIn('titulo', contenido)
                esperado = plantilla.calcular_contenido_por_calculo(
                    _df(),
                    next(s['calculo'] for s in directorio_cartera.especificacion()
                         if s['component_id'] == component_id),
                    contenido['titulo'],
                    next(s['mapeo'] for s in directorio_cartera.especificacion()
                         if s['component_id'] == component_id),
                    fecha_referencia=CORTE,
                )
                self.assertEqual({k: v for k, v in contenido.items() if k != 'fecha_corte'}, esperado)

    def test_el_kpi_total_lleva_la_fecha_del_corte_para_titularlo(self):
        # El informe titula el total con el corte al que corresponde ("Corte junio 2026"). Viaja en
        # el CONTENIDO y no en `config` porque cambia con cada archivo, y `config` se conserva
        # entre recálculos: ahí quedaría anunciando el corte anterior.
        contenidos = _contenidos()
        self.assertEqual(contenidos['cartera-total']['fecha_corte'], CORTE.isoformat())

    def test_solo_el_kpi_total_lleva_la_fecha(self):
        # Los otros tres muestran su participación sobre el portafolio, no el corte.
        contenidos = _contenidos()
        for component_id in ('al-corriente', 'vencida-total', 'vencida-mas-120-dias'):
            with self.subTest(seccion=component_id):
                self.assertNotIn('fecha_corte', contenidos[component_id])

    def test_el_kpi_de_mas_120_conoce_su_meta_maxima_y_sale_de_METAS(self):
        # El informe lo señala como el único fuera de meta ("excede meta máx. 5%"). El tope sale de
        # la misma lista que alimenta la tabla de cumplimiento: si se editara solo en un lado, el
        # KPI y la tabla dirían cosas distintas sobre el mismo tramo.
        spec = next(s for s in directorio_cartera.especificacion()
                    if s['component_id'] == 'vencida-mas-120-dias')
        self.assertEqual(spec['config']['meta_maxima_porcentaje'],
                         directorio_cartera.METAS[-1]['meta_max'])

    def test_los_demas_kpis_no_declaran_meta_maxima(self):
        for component_id in ('cartera-total', 'al-corriente', 'vencida-total'):
            spec = next(s for s in directorio_cartera.especificacion()
                        if s['component_id'] == component_id)
            with self.subTest(seccion=component_id):
                self.assertNotIn('meta_maxima_porcentaje', spec['config'])


class EstructuraTests(TestCase):
    def setUp(self):
        plantilla.sembrar_plantilla(DASHBOARD)
        directorio_cartera.construir(DASHBOARD, _df(), CORTE)
        self.layout = dashboard_layout.obtener_o_crear_layout(DASHBOARD)

    def test_crea_las_secciones_del_informe_en_orden(self):
        visibles = list(
            self.layout.components.filter(is_visible=True).order_by('order').values_list('component_id', flat=True)
        )
        self.assertEqual(visibles, [
            'cartera-total', 'al-corriente', 'vencida-total', 'vencida-mas-120-dias',
            'antiguedad-de-cartera', 'cumplimiento-metas-antiguedad', 'concentracion-de-cartera',
            'mayores-deudores', 'consulta-deudor',
        ])

    def test_oculta_las_posiciones_de_fabrica(self):
        fabrica = self.layout.components.filter(component_id__in=directorio_cartera.IDS_FABRICA)
        self.assertEqual(fabrica.count(), 13)
        self.assertFalse(fabrica.filter(is_visible=True).exists())

    def test_las_secciones_no_quedan_bloqueadas(self):
        # El dashboard es del usuario: tiene que poder mover, redimensionar y reconfigurar cada
        # sección. Bloquearlas era justamente parte del problema de "está quemado".
        for componente in self.layout.components.filter(is_visible=True):
            with self.subTest(seccion=componente.component_id):
                self.assertFalse(componente.config.get('bloqueado'))
                self.assertEqual(componente.config.get('render'), 'directorio')
                self.assertIn(componente.config.get('bloque'),
                              {'kpi', 'antiguedad', 'consulta-deudor', 'cumplimiento',
                               'concentracion', 'deudores'})

    def test_el_mapeo_queda_persistido_en_cada_componente(self):
        # El mapeo es lo que hace reconfigurable a cada sección: sin él, "Configurar componente →
        # Datos" no tiene de dónde leer las columnas. `calculo` solo lo llevan las que calculan
        # algo — la consulta por cliente guarda sus columnas igual, pero no precalcula nada.
        calculadas = {s['component_id'] for s in _specs_calculadas()}
        for componente in self.layout.components.filter(is_visible=True):
            with self.subTest(seccion=componente.component_id):
                self.assertTrue(componente.mapeo)
                self.assertTrue(any(c.startswith('columna_') for c in componente.mapeo))
                if componente.component_id in calculadas:
                    self.assertIn('calculo', componente.mapeo)

    def test_reconstruir_no_duplica_componentes(self):
        directorio_cartera.construir(DASHBOARD, _df(), CORTE)
        ids = list(self.layout.components.values_list('component_id', flat=True))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), 22)  # 9 secciones + 13 de fábrica


class CoherenciaEntreSeccionesTests(TestCase):
    """Las cifras del informe tienen que cerrar entre sí, no solo ser correctas por separado."""

    def setUp(self):
        self.contenidos = _contenidos()

    def test_los_kpis_reparten_el_total(self):
        total = self.contenidos['cartera-total']['valor']
        corriente = self.contenidos['al-corriente']['valor']
        vencida = self.contenidos['vencida-total']['valor']
        self.assertEqual(total, 2000.0)
        self.assertEqual(corriente + vencida, total)

    def test_los_tramos_del_grafico_suman_el_total(self):
        total = self.contenidos['cartera-total']['valor']
        self.assertEqual(sum(self.contenidos['antiguedad-de-cartera']['valores']), total)

    def test_el_kpi_de_mas_120_coincide_con_la_cola_del_grafico(self):
        cola = self.contenidos['antiguedad-de-cartera']['valores'][-1]
        self.assertEqual(self.contenidos['vencida-mas-120-dias']['valor'], cola)

    def test_la_concentracion_cierra_en_el_total(self):
        concentracion = self.contenidos['concentracion-de-cartera']
        total = self.contenidos['cartera-total']['valor']
        self.assertEqual(concentracion['total'][1], total)
        self.assertAlmostEqual(sum(fila[1] for fila in concentracion['filas']), total, places=2)

    def test_el_acumulado_de_cumplimiento_mas_la_cola_dan_cien(self):
        filas = self.contenidos['cumplimiento-metas-antiguedad']['filas']
        self.assertAlmostEqual(filas[4][2] + filas[5][2], 100.0, places=1)

    def test_el_cumplimiento_evalua_las_metas_y_ninguna_queda_sin_meta(self):
        for fila in self.contenidos['cumplimiento-metas-antiguedad']['filas']:
            with self.subTest(tramo=fila[0]):
                self.assertNotEqual(fila[3], 'Sin meta')


class ColumnasTests(TestCase):
    def test_detecta_las_columnas_que_faltan(self):
        df = pd.DataFrame({'Cliente': ['x'], 'Saldo': [1.0]})
        self.assertEqual(directorio_cartera.columnas_faltantes(df), ['Fecha de Vencimiento'])

    def test_las_columnas_requeridas_siguen_a_los_parametros(self):
        faltantes = directorio_cartera.columnas_faltantes(_df(), columna_valor='Importe')
        self.assertEqual(faltantes, ['Importe'])
