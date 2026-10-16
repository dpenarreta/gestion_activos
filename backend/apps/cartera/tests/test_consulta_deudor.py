"""Consulta puntual de un deudor (`services/consulta_deudor.py`).

Lo que importa verificar acá es que la antigüedad de un cliente sea CONSISTENTE con la del
dashboard —misma función de tramos, mismos seis tramos siempre— y que la búsqueda no sume clientes
distintos por una coincidencia parcial.
"""

import datetime
from unittest.mock import patch

import pandas as pd
from django.test import TestCase

from apps.cartera.exceptions import CarteraError
from apps.cartera.models import CargaArchivo
from apps.cartera.services import consulta_deudor

CORTE = datetime.date(2026, 6, 30)


def _df():
    """Dos clientes con el mismo prefijo de nombre y uno con el RUC vacío.

    El prefijo compartido es el caso que obliga a elegir en vez de sumar; el RUC vacío ejercita la
    regla de identidad (identificador → nombre).
    """
    return pd.DataFrame({
        'Cliente': ['TRANSEXPRESS', 'TRANSEXPRESS', 'TRANSEXPORT SA', 'PEÑA LOPEZ', 'OTRO'],
        'Ruc Cliente': ['111', '111', '222', '', '333'],
        'Fecha de Vencimiento': [
            datetime.date(2026, 7, 15),   # anticipada (vence después del corte)
            datetime.date(2026, 1, 1),    # +120 días
            datetime.date(2026, 6, 15),   # 30 días
            datetime.date(2026, 6, 1),    # 30 días
            datetime.date(2026, 6, 20),   # 30 días
        ],
        'Saldo': [100.0, 900.0, 50.0, 25.0, 10.0],
        'Número de Documento': ['A-1', 'A-2', 'B-1', 'C-1', 'D-1'],
    })


class ConsultaDeudorTests(TestCase):
    def setUp(self):
        self.carga = CargaArchivo.objects.create(
            dashboard_id='directorio-cartera', nombre_original='x.xlsx', nombre_hoja='Hoja1',
            tamano_bytes=1, estado=CargaArchivo.Estado.PROCESADO, fecha_corte=CORTE,
        )
        parche = patch.object(consulta_deudor.carga_archivos, 'leer_archivo_de_carga',
                              side_effect=lambda carga: ('ruta.xlsx', _df()))
        self.lector = parche.start()
        self.addCleanup(parche.stop)
        # La caché de archivos vive en el módulo, así que sobrevive de un test al siguiente.
        consulta_deudor.limpiar_cache()
        self.addCleanup(consulta_deudor.limpiar_cache)

    def _buscar(self, texto):
        return consulta_deudor.buscar(
            'directorio-cartera', texto,
            columna_nombre='Cliente', columna_valor='Saldo', columna_ruc='Ruc Cliente',
        )

    def _detalle(self, identidad, columnas=None):
        return consulta_deudor.detalle(
            'directorio-cartera', identidad,
            columna_nombre='Cliente', columna_fecha='Fecha de Vencimiento',
            columna_valor='Saldo', columna_ruc='Ruc Cliente', columnas_detalle=columnas,
        )

    # --- búsqueda ---------------------------------------------------------
    def test_una_coincidencia_parcial_devuelve_los_dos_clientes_por_separado(self):
        # "transex" toca dos razones sociales distintas: se listan para elegir, no se suman.
        resultado = self._buscar('transex')
        self.assertEqual(resultado['total'], 2)
        identidades = {c['identidad'] for c in resultado['coincidencias']}
        self.assertEqual(identidades, {'111', '222'})

    def test_las_coincidencias_traen_saldo_y_cantidad_de_filas(self):
        coincidencia = next(c for c in self._buscar('transex')['coincidencias'] if c['identidad'] == '111')
        self.assertEqual(coincidencia['saldo'], 1000.0)
        self.assertEqual(coincidencia['filas'], 2)

    def test_vienen_ordenadas_por_saldo_para_que_el_mayor_quede_primero(self):
        coincidencias = self._buscar('transex')['coincidencias']
        self.assertEqual([c['identidad'] for c in coincidencias], ['111', '222'])

    def test_se_busca_tambien_por_identificador(self):
        self.assertEqual(self._buscar('222')['total'], 1)

    def test_los_acentos_no_impiden_encontrar(self):
        # El nombre está con Ñ; buscar sin ella tiene que encontrarlo igual.
        self.assertEqual(self._buscar('pena')['total'], 1)

    def test_un_texto_de_una_letra_se_rechaza_en_vez_de_devolver_medio_padron(self):
        with self.assertRaises(CarteraError) as contexto:
            self._buscar('t')
        self.assertEqual(contexto.exception.codigo, 'BUSQUEDA_MUY_CORTA')

    def test_sin_coincidencias_devuelve_vacio_y_no_un_error(self):
        self.assertEqual(self._buscar('inexistente'), {'coincidencias': [], 'total': 0})

    # --- detalle ----------------------------------------------------------
    def test_los_seis_tramos_siempre_estan_y_los_vacios_valen_cero(self):
        # Es el pedido explícito: un tramo sin filas se muestra en 0, no desaparece.
        tramos = self._detalle('111')['tramos']
        self.assertEqual(len(tramos['categorias']), 6)
        self.assertEqual(len(tramos['valores']), 6)
        por_tramo = dict(zip(tramos['categorias'], tramos['valores']))
        self.assertEqual(por_tramo['60 días'], 0)
        self.assertEqual(por_tramo['90 días'], 0)

    def test_la_antiguedad_del_deudor_usa_la_misma_funcion_que_el_grafico(self):
        from apps.cartera.services import generic_charts
        detalle = self._detalle('111')
        esperado = generic_charts.generar_datos_tramos_antiguedad(
            _df()[_df()['Ruc Cliente'] == '111'], 'Fecha de Vencimiento', 'Saldo', fecha_referencia=CORTE,
        )
        self.assertEqual(detalle['tramos']['valores'], esperado['valores'])

    def test_el_total_es_la_suma_de_sus_filas(self):
        detalle = self._detalle('111')
        self.assertEqual(detalle['total'], 1000.0)
        self.assertEqual(detalle['cantidad_filas'], 2)

    def test_un_cliente_sin_identificador_se_encuentra_por_su_nombre(self):
        detalle = self._detalle('PEÑA LOPEZ')
        self.assertEqual(detalle['cantidad_filas'], 1)

    def test_devuelve_todas_las_filas_del_deudor_no_solo_las_que_tienen_saldo(self):
        self.assertEqual(len(self._detalle('111')['filas']), 2)

    def test_las_columnas_elegidas_acotan_el_detalle(self):
        detalle = self._detalle('111', columnas=['Número de Documento', 'Saldo'])
        self.assertEqual(detalle['columnas'], ['Número de Documento', 'Saldo'])
        self.assertEqual(len(detalle['filas'][0]), 2)

    def test_una_columna_que_ya_no_existe_se_ignora_en_vez_de_romper(self):
        # El mapeo puede haberse guardado con un archivo que tenía otras columnas.
        detalle = self._detalle('111', columnas=['Saldo', 'Columna Inventada'])
        self.assertEqual(detalle['columnas'], ['Saldo'])

    def test_siempre_informa_todas_las_columnas_disponibles_para_el_selector(self):
        detalle = self._detalle('111', columnas=['Saldo'])
        self.assertIn('Número de Documento', detalle['columnas_disponibles'])

    def test_las_fechas_viajan_como_texto_ISO_y_no_como_objeto_de_python(self):
        detalle = self._detalle('111', columnas=['Fecha de Vencimiento'])
        self.assertEqual(detalle['filas'][0][0], '2026-07-15')

    def test_un_cliente_inexistente_da_un_error_de_negocio_claro(self):
        with self.assertRaises(CarteraError) as contexto:
            self._detalle('999')
        self.assertEqual(contexto.exception.codigo, 'DEUDOR_SIN_FILAS')

    def test_sin_carga_procesada_lo_dice_en_vez_de_fallar_al_leer(self):
        CargaArchivo.objects.all().delete()
        with self.assertRaises(CarteraError) as contexto:
            self._buscar('transex')
        self.assertEqual(contexto.exception.codigo, 'SIN_CARGA_PARA_CONSULTAR')

    def test_una_columna_de_mapeo_que_falta_en_el_archivo_se_avisa(self):
        with self.assertRaises(CarteraError) as contexto:
            consulta_deudor.buscar(
                'directorio-cartera', 'transex',
                columna_nombre='Columna Que No Existe', columna_valor='Saldo',
            )
        self.assertEqual(contexto.exception.codigo, 'COLUMNAS_NO_DISPONIBLES')


class CacheDeArchivoTests(TestCase):
    """El archivo se lee del disco una vez y se reutiliza.

    Deja de ser un detalle de rendimiento desde que el buscador pide sugerencias mientras se
    escribe: sin caché, cada tecla releía el .xlsx entero (~1,4 s con el archivo de producción,
    de 10.374 filas), así que escribir el nombre de un cliente costaba varios segundos de CPU
    sobre el mismo archivo.
    """

    def setUp(self):
        self.carga = CargaArchivo.objects.create(
            dashboard_id='directorio-cartera', nombre_original='x.xlsx', nombre_hoja='Hoja1',
            tamano_bytes=1, estado=CargaArchivo.Estado.PROCESADO, fecha_corte=CORTE,
        )
        parche = patch.object(consulta_deudor.carga_archivos, 'leer_archivo_de_carga',
                              side_effect=lambda carga: ('ruta.xlsx', _df()))
        self.lector = parche.start()
        self.addCleanup(parche.stop)
        consulta_deudor.limpiar_cache()
        self.addCleanup(consulta_deudor.limpiar_cache)

    def _buscar(self, texto):
        return consulta_deudor.buscar(
            'directorio-cartera', texto,
            columna_nombre='Cliente', columna_valor='Saldo', columna_ruc='Ruc Cliente',
        )

    def test_varias_busquedas_seguidas_leen_el_archivo_una_sola_vez(self):
        for texto in ('tr', 'tra', 'tran', 'trans'):
            self._buscar(texto)
        self.assertEqual(self.lector.call_count, 1)

    def test_una_carga_nueva_vuelve_a_leer_el_archivo(self):
        # La clave de la caché es la carga, así que procesar uno nuevo la invalida sola: nadie
        # tiene que acordarse de limpiarla al cargar datos.
        self._buscar('trans')
        CargaArchivo.objects.create(
            dashboard_id='directorio-cartera', nombre_original='y.xlsx', nombre_hoja='Hoja1',
            tamano_bytes=1, estado=CargaArchivo.Estado.PROCESADO, fecha_corte=CORTE,
        )
        self._buscar('trans')
        self.assertEqual(self.lector.call_count, 2)

    def test_modificar_el_dataframe_devuelto_no_contamina_la_consulta_siguiente(self):
        # Los cálculos de `generic_charts` agregan columnas derivadas al dataframe que reciben.
        # Con el original compartido en memoria, esa mutación se filtraría a la consulta que
        # viene; por eso `_df_de` entrega una copia.
        df, _ = consulta_deudor._df_de('directorio-cartera')
        df['columna_intrusa'] = 1
        df.drop(df.index[0], inplace=True)

        otro, _ = consulta_deudor._df_de('directorio-cartera')
        self.assertNotIn('columna_intrusa', otro.columns)
        self.assertEqual(len(otro), len(_df()))

    def test_no_crece_sin_limite(self):
        for i in range(consulta_deudor._CACHE_MAXIMO + 3):
            CargaArchivo.objects.create(
                dashboard_id=f'dash-{i}', nombre_original='x.xlsx', nombre_hoja='Hoja1',
                tamano_bytes=1, estado=CargaArchivo.Estado.PROCESADO, fecha_corte=CORTE,
            )
            consulta_deudor._df_de(f'dash-{i}')
        self.assertLessEqual(len(consulta_deudor._cache_archivos), consulta_deudor._CACHE_MAXIMO)


def _df_con_padron_sucio():
    """Las dos formas en que un padrón se ensucia, cada una con su caso.

    - "DOBLE IDENTIDAD" figura con dos RUC distintos: o son dos empresas homónimas, o el mismo
      cliente cargado dos veces.
    - El RUC 555 figura con dos razones sociales: el saldo se suma bien porque la identidad es el
      RUC, pero el nombre que se muestra depende de qué fila venga primero.
    """
    return pd.DataFrame({
        'Cliente': ['DOBLE IDENTIDAD', 'DOBLE IDENTIDAD', 'MUTANTE S.A.', 'MUTANTE SA', 'LIMPIO'],
        'Ruc Cliente': ['333', '444', '555', '555', '666'],
        'Fecha de Vencimiento': [datetime.date(2026, 6, 15)] * 5,
        'Saldo': [10.0, 20.0, 30.0, 40.0, 50.0],
        'Número de Documento': ['A', 'B', 'C', 'D', 'E'],
    })


class DiscrepanciasDeIdentidadTests(TestCase):
    """Un mismo nombre con varios identificadores, o un identificador con varios nombres.

    Ninguna de las dos la detecta el resto del informe: agrupa por identidad y sigue. En la lista
    de coincidencias, dos empresas homónimas salían como filas idénticas y elegir una era
    adivinar.
    """

    def setUp(self):
        self.carga = CargaArchivo.objects.create(
            dashboard_id='directorio-cartera', nombre_original='x.xlsx', nombre_hoja='Hoja1',
            tamano_bytes=1, estado=CargaArchivo.Estado.PROCESADO, fecha_corte=CORTE,
        )
        parche = patch.object(consulta_deudor.carga_archivos, 'leer_archivo_de_carga',
                              side_effect=lambda carga: ('ruta.xlsx', _df_con_padron_sucio()))
        parche.start()
        self.addCleanup(parche.stop)
        consulta_deudor.limpiar_cache()
        self.addCleanup(consulta_deudor.limpiar_cache)

    def _buscar(self, texto, columna_ruc='Ruc Cliente'):
        return consulta_deudor.buscar(
            'directorio-cartera', texto,
            columna_nombre='Cliente', columna_valor='Saldo', columna_ruc=columna_ruc,
        )

    def _detalle(self, identidad, columna_ruc='Ruc Cliente'):
        return consulta_deudor.detalle(
            'directorio-cartera', identidad,
            columna_nombre='Cliente', columna_fecha='Fecha de Vencimiento',
            columna_valor='Saldo', columna_ruc=columna_ruc,
        )

    def test_un_nombre_con_dos_identificadores_lo_avisa_en_cada_coincidencia(self):
        coincidencias = {c['identidad']: c for c in self._buscar('doble')['coincidencias']}
        self.assertEqual(sorted(coincidencias), ['333', '444'])
        self.assertEqual(coincidencias['333']['otros_identificadores'], ['444'])
        self.assertEqual(coincidencias['444']['otros_identificadores'], ['333'])

    def test_un_identificador_con_dos_nombres_lo_avisa(self):
        coincidencia = self._buscar('mutante')['coincidencias'][0]
        self.assertEqual(coincidencia['identidad'], '555')
        self.assertEqual(coincidencia['otros_nombres'], ['MUTANTE SA'])

    def test_un_cliente_sin_problemas_no_arrastra_ningun_aviso(self):
        coincidencia = self._buscar('limpio')['coincidencias'][0]
        self.assertEqual(coincidencia['otros_identificadores'], [])
        self.assertEqual(coincidencia['otros_nombres'], [])

    def test_el_detalle_repite_el_aviso_del_cliente_elegido(self):
        detalle = self._detalle('333')
        self.assertEqual(detalle['otros_identificadores'], ['444'])
        self.assertEqual(detalle['otros_nombres'], [])

        mutante = self._detalle('555')
        self.assertEqual(mutante['otros_nombres'], ['MUTANTE SA'])
        self.assertEqual(mutante['otros_identificadores'], [])

    def test_el_aviso_mira_el_archivo_entero_y_no_solo_lo_encontrado(self):
        # Buscar "444" trae una sola coincidencia, pero el nombre igual está repartido: si se
        # calculara sobre lo encontrado, ese caso no avisaría nada.
        coincidencia = self._buscar('444')['coincidencias'][0]
        self.assertEqual(coincidencia['otros_identificadores'], ['333'])

    def test_sin_columna_de_identificador_no_hay_nada_que_comparar(self):
        # Es el caso de producción: la vista no trae RUC, así que la identidad ES el nombre y dos
        # nombres iguales son, por definición, el mismo cliente.
        coincidencia = self._buscar('doble', columna_ruc='')['coincidencias'][0]
        self.assertEqual(coincidencia['otros_identificadores'], [])
        self.assertEqual(coincidencia['otros_nombres'], [])
