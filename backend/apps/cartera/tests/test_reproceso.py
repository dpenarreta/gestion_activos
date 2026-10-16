"""Reproceso del contenido almacenado de dashboards existentes.

Dos cosas importan acá. Que el contenido se recalcule para TODOS los componentes que tienen un
mapeo —no solo para las 13 posiciones fijas: un dashboard puede tener casi todo su contenido en la
Zona Personal, como el Dashboard Directorio— y que al recalcularlo no se toque nada más que
`content`: ni el tamaño, ni los colores, ni la versión de más.
"""

import uuid

import pandas as pd
from django.conf import settings
from django.test import TestCase

from apps.cartera.models import CargaArchivo, DashboardComponent, DashboardLayout
from apps.cartera.services import dashboard_layout, generic_charts, plantilla, reproceso
from apps.cartera.utils.archivos import asegurar_directorio

DASHBOARD = 'reproceso-test'


def _df():
    return pd.DataFrame({
        'Cliente': ['ana', 'beto', 'caro', 'ana'],
        'Zona': ['norte', 'sur', 'norte', 'sur'],
        'Saldo': [100.0, 250.0, 50.0, 75.0],
    })


class ReprocesoTests(TestCase):
    def setUp(self):
        self.df = _df()
        self.carga = CargaArchivo.objects.create(
            id=uuid.uuid4(), dashboard_id=DASHBOARD, nombre_original='datos.xlsx',
            estado=CargaArchivo.Estado.PROCESADO,
        )
        nombre = f'{self.carga.id}.xlsx'
        ruta = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre
        self.df.to_excel(ruta, index=False, sheet_name='Datos')
        self.carga.archivo_permanente_nombre = nombre
        self.carga.save(update_fields=['archivo_permanente_nombre'])

        columnas = generic_charts.analizar_columnas(self.df)['columnas']
        mapeo = plantilla.sugerir_mapeo(columnas)
        plantilla.aplicar_mapeo(DASHBOARD, self.df, mapeo)
        self.layout = dashboard_layout.obtener_o_crear_layout(DASHBOARD)

    def _un_componente_con_mapeo(self):
        return self.layout.components.exclude(mapeo={}).exclude(content={}).first()

    def test_analizar_no_escribe_nada(self):
        componente = self._un_componente_con_mapeo()
        DashboardComponent.objects.filter(pk=componente.pk).update(content={'titulo': 'valor viejo'})
        version_antes = DashboardLayout.objects.get(pk=self.layout.pk).version

        resultado = reproceso.analizar_dashboard(DASHBOARD)

        self.assertTrue(resultado['ok'])
        self.assertTrue(resultado['cambios'])
        self.assertEqual(DashboardComponent.objects.get(pk=componente.pk).content, {'titulo': 'valor viejo'})
        self.assertEqual(DashboardLayout.objects.get(pk=self.layout.pk).version, version_antes)

    def test_aplicar_actualiza_el_contenido(self):
        componente = self._un_componente_con_mapeo()
        contenido_correcto = componente.content
        # Se le quitan los datos pero no el título: el reproceso conserva el título a propósito
        # (`test_conserva_un_titulo_renombrado`), así que pisarlo acá mediría otra cosa.
        DashboardComponent.objects.filter(pk=componente.pk).update(
            content={'titulo': contenido_correcto['titulo']},
        )

        reproceso.aplicar_dashboard(DASHBOARD)

        self.assertEqual(DashboardComponent.objects.get(pk=componente.pk).content, contenido_correcto)

    def test_aplicar_conserva_la_personalizacion_visual(self):
        """La razón de ser de este módulo: `aplicar_mapeo` pisaría todo esto."""
        componente = self._un_componente_con_mapeo()
        DashboardComponent.objects.filter(pk=componente.pk).update(
            content={'titulo': 'valor viejo'}, width=2, height=999,
            styles={'colorPrincipal': '#123456'}, chart_type='line',
        )

        reproceso.aplicar_dashboard(DASHBOARD)

        despues = DashboardComponent.objects.get(pk=componente.pk)
        self.assertEqual(despues.width, 2)
        self.assertEqual(despues.height, 999)
        self.assertEqual(despues.styles, {'colorPrincipal': '#123456'})
        self.assertEqual(despues.chart_type, 'line')

    def test_conserva_un_titulo_renombrado(self):
        """`calcular_datos_mapeo` rearma el título desde `PLANTILLA_SLOTS` ("KPI 1"), así que sin
        conservarlo un reproceso masivo revertiría en silencio TODOS los renombres del proyecto.
        El reproceso recalcula datos; el título lo escribió una persona."""
        componente = self._un_componente_con_mapeo()
        DashboardComponent.objects.filter(pk=componente.pk).update(
            content={**componente.content, 'titulo': 'Cartera vencida real'},
        )

        reproceso.aplicar_dashboard(DASHBOARD)

        self.assertEqual(
            DashboardComponent.objects.get(pk=componente.pk).content['titulo'], 'Cartera vencida real',
        )

    def test_aplicar_sube_la_version_del_layout(self):
        componente = self._un_componente_con_mapeo()
        DashboardComponent.objects.filter(pk=componente.pk).update(content={'titulo': 'valor viejo'})
        version_antes = DashboardLayout.objects.get(pk=self.layout.pk).version

        reproceso.aplicar_dashboard(DASHBOARD)

        self.assertEqual(DashboardLayout.objects.get(pk=self.layout.pk).version, version_antes + 1)

    def test_sin_cambios_no_sube_la_version(self):
        version_antes = DashboardLayout.objects.get(pk=self.layout.pk).version

        resultado = reproceso.aplicar_dashboard(DASHBOARD)

        self.assertEqual(resultado['cambios'], [])
        self.assertEqual(DashboardLayout.objects.get(pk=self.layout.pk).version, version_antes)

    def test_es_idempotente(self):
        componente = self._un_componente_con_mapeo()
        DashboardComponent.objects.filter(pk=componente.pk).update(content={'titulo': 'valor viejo'})

        primera = reproceso.aplicar_dashboard(DASHBOARD)
        segunda = reproceso.aplicar_dashboard(DASHBOARD)

        self.assertTrue(primera['cambios'])
        self.assertEqual(segunda['cambios'], [])

    def test_omite_un_dashboard_sin_carga_procesada(self):
        self.carga.estado = CargaArchivo.Estado.SUBIDO
        self.carga.save(update_fields=['estado'])

        resultado = reproceso.analizar_dashboard(DASHBOARD)

        self.assertFalse(resultado['ok'])
        self.assertIn('carga procesada', resultado['motivo'])

    def test_omite_un_dashboard_sin_mapeo(self):
        plantilla.sembrar_plantilla('sin-mapeo')

        resultado = reproceso.analizar_dashboard('sin-mapeo')

        self.assertFalse(resultado['ok'])
        self.assertIn('mapeo', resultado['motivo'])

    def test_omite_un_dashboard_sin_layout(self):
        resultado = reproceso.analizar_dashboard('no-existe')

        self.assertFalse(resultado['ok'])
        self.assertIn('layout', resultado['motivo'])

    def test_omite_cuando_el_archivo_ya_no_esta_en_disco(self):
        self.carga.archivo_permanente_nombre = 'no-existe.xlsx'
        self.carga.archivo_temp_nombre = ''
        self.carga.save(update_fields=['archivo_permanente_nombre', 'archivo_temp_nombre'])

        resultado = reproceso.analizar_dashboard(DASHBOARD)

        self.assertFalse(resultado['ok'])
        self.assertIn('No se pudo leer', resultado['motivo'])

    def test_dashboards_con_layout_los_lista(self):
        self.assertIn(DASHBOARD, reproceso.dashboards_con_layout())


class ComponentesFueraDeLaPlantillaTests(TestCase):
    """Un dashboard no son solo las 13 posiciones fijas.

    `calcular_datos_mapeo` recorre `PLANTILLA_SLOTS`, así que el reproceso ignoraba todo lo que
    estuviera en la Zona Personal. Para un dashboard corriente eso dejaba sin corregir los
    componentes agregados a mano; para el Dashboard Directorio, cuyas 8 secciones reales viven
    todas ahí, el comando no tocaba nada de lo que se ve y en cambio proponía reescribir las
    posiciones de fábrica ocultas.
    """

    def setUp(self):
        self.df = _df()
        self.carga = CargaArchivo.objects.create(
            id=uuid.uuid4(), dashboard_id=DASHBOARD, nombre_original='datos.xlsx',
            estado=CargaArchivo.Estado.PROCESADO,
        )
        nombre = f'{self.carga.id}.xlsx'
        ruta = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre
        self.df.to_excel(ruta, index=False, sheet_name='Datos')
        self.carga.archivo_permanente_nombre = nombre
        self.carga.save(update_fields=['archivo_permanente_nombre'])
        plantilla.sembrar_plantilla(DASHBOARD)

    def _agregar_personal(self, titulo='Saldo por zona'):
        dashboard_layout.agregar_componente_generado(DASHBOARD, {
            'titulo': titulo, 'calculo': 'chart', 'columna_categoria': 'Zona', 'columna_valor': 'Saldo',
            'columna_id': None, 'zona': 'personal',
            'datos': generic_charts.generar_datos_grafica(self.df, 'Saldo', 'Zona'),
        })
        return DashboardComponent.objects.get(layout__dashboard_id=DASHBOARD, component_id=titulo.lower().replace(' ', '-'))

    def test_recalcula_un_componente_de_zona_personal(self):
        componente = self._agregar_personal()
        correcto = componente.content
        DashboardComponent.objects.filter(pk=componente.pk).update(
            content={'titulo': correcto['titulo']},  # se le quitan los datos, no el título
        )

        reproceso.aplicar_dashboard(DASHBOARD)

        recalculado = DashboardComponent.objects.get(pk=componente.pk).content
        self.assertEqual(recalculado['categorias'], correcto['categorias'])
        self.assertEqual(recalculado['valores'], correcto['valores'])
        self.assertEqual(recalculado['titulo'], correcto['titulo'])

    def test_un_componente_de_zona_personal_sin_mapeo_no_se_toca(self):
        """El flujo legado de recomendaciones automáticas no guarda `mapeo`: sin él no hay forma de
        recalcular, y adivinar sería peor que dejarlo como está."""
        componente = self._agregar_personal()
        DashboardComponent.objects.filter(pk=componente.pk).update(mapeo={}, content={'titulo': 'intacto'})

        reproceso.aplicar_dashboard(DASHBOARD)

        self.assertEqual(DashboardComponent.objects.get(pk=componente.pk).content, {'titulo': 'intacto'})

    def test_una_columna_que_ya_no_existe_conserva_el_contenido_anterior(self):
        componente = self._agregar_personal()
        DashboardComponent.objects.filter(pk=componente.pk).update(
            mapeo={'disponible': True, 'calculo': 'chart', 'columna_categoria': 'NoExiste', 'columna_valor': 'Saldo'},
        )
        anterior = DashboardComponent.objects.get(pk=componente.pk).content

        resultado = reproceso.aplicar_dashboard(DASHBOARD)

        self.assertTrue(resultado['ok'])
        self.assertEqual(DashboardComponent.objects.get(pk=componente.pk).content, anterior)

    def test_conserva_la_personalizacion_del_componente_personal(self):
        componente = self._agregar_personal()
        DashboardComponent.objects.filter(pk=componente.pk).update(
            width=12, height=500, styles={'colorPrincipal': '#abcdef'},
            content={'titulo': componente.content['titulo']},
        )

        reproceso.aplicar_dashboard(DASHBOARD)

        actualizado = DashboardComponent.objects.get(pk=componente.pk)
        self.assertEqual((actualizado.width, actualizado.height), (12, 500))
        self.assertEqual(actualizado.styles, {'colorPrincipal': '#abcdef'})


class ReprocesoDelDashboardDirectorioTests(TestCase):
    """El caso que destapó el hueco: sus 8 secciones son componentes de Zona Personal."""

    def setUp(self):
        from datetime import date
        self.corte = date(2026, 8, 31)
        self.df = pd.DataFrame({
            'Cliente': ['ACME', 'ACME', 'BETA', 'GAMMA'],
            'Saldo': [1000.0, 500.0, 300.0, 150.0],
            'Fecha de Vencimiento': [
                date(2026, 9, 30), date(2026, 8, 20), date(2026, 1, 15), date(2026, 2, 10),
            ],
        })
        self.carga = CargaArchivo.objects.create(
            id=uuid.uuid4(), dashboard_id=DASHBOARD, nombre_original='directorio.xlsx',
            estado=CargaArchivo.Estado.PROCESADO, fecha_corte=self.corte,
        )
        nombre = f'{self.carga.id}.xlsx'
        ruta = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre
        self.df.to_excel(ruta, index=False, sheet_name='Datos')
        self.carga.archivo_permanente_nombre = nombre
        self.carga.save(update_fields=['archivo_permanente_nombre'])

        from apps.cartera.services import directorio_cartera
        plantilla.sembrar_plantilla(DASHBOARD)
        directorio_cartera.construir(DASHBOARD, self.df, self.corte)

    def _seccion(self, component_id):
        return DashboardComponent.objects.get(layout__dashboard_id=DASHBOARD, component_id=component_id)

    def test_recalcula_las_secciones_reales_del_informe(self):
        secciones = ['cartera-total', 'antiguedad-de-cartera', 'concentracion-de-cartera', 'mayores-deudores']
        correctos = {}
        for component_id in secciones:
            seccion = self._seccion(component_id)
            correctos[component_id] = seccion.content
            DashboardComponent.objects.filter(pk=seccion.pk).update(
                content={'titulo': seccion.content['titulo']},  # se le quitan los datos, no el título
            )

        reproceso.aplicar_dashboard(DASHBOARD)

        for component_id in secciones:
            with self.subTest(seccion=component_id):
                self.assertEqual(self._seccion(component_id).content, correctos[component_id])

    def test_respeta_la_fecha_de_corte_de_la_carga(self):
        """La antigüedad se mide contra la fecha de corte, no contra hoy: reprocesar con la fecha
        equivocada movería las facturas de tramo sin que nadie cambiara un dato."""
        antiguedad = self._seccion('antiguedad-de-cartera')
        correcto = antiguedad.content
        DashboardComponent.objects.filter(pk=antiguedad.pk).update(content={'titulo': correcto['titulo']})

        reproceso.aplicar_dashboard(DASHBOARD)

        self.assertEqual(self._seccion('antiguedad-de-cartera').content['valores'], correcto['valores'])


class ComandoReprocesarDashboardsTests(TestCase):
    """El comando es la única forma de usar esto, y no tenía ninguna prueba."""

    def setUp(self):
        self.df = _df()
        self.carga = CargaArchivo.objects.create(
            id=uuid.uuid4(), dashboard_id=DASHBOARD, nombre_original='datos.xlsx',
            estado=CargaArchivo.Estado.PROCESADO,
        )
        nombre = f'{self.carga.id}.xlsx'
        ruta = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre
        self.df.to_excel(ruta, index=False, sheet_name='Datos')
        self.carga.archivo_permanente_nombre = nombre
        self.carga.save(update_fields=['archivo_permanente_nombre'])

        columnas = generic_charts.analizar_columnas(self.df)['columnas']
        plantilla.aplicar_mapeo(DASHBOARD, self.df, plantilla.sugerir_mapeo(columnas))
        self.layout = dashboard_layout.obtener_o_crear_layout(DASHBOARD)
        self.componente = self.layout.components.exclude(mapeo={}).exclude(content={}).first()
        self.correcto = self.componente.content
        DashboardComponent.objects.filter(pk=self.componente.pk).update(
            content={'titulo': self.correcto['titulo']},
        )

    def _correr(self, *argumentos):
        from io import StringIO
        from django.core.management import call_command
        salida = StringIO()
        call_command('reprocesar_dashboards', '--dashboard', DASHBOARD, *argumentos, stdout=salida)
        return salida.getvalue()

    def test_sin_aplicar_informa_pero_no_escribe(self):
        texto = self._correr()

        self.assertIn('SIMULACIÓN', texto)
        self.assertIn(self.componente.component_id, texto)
        self.assertEqual(
            DashboardComponent.objects.get(pk=self.componente.pk).content,
            {'titulo': self.correcto['titulo']},
        )

    def test_con_aplicar_escribe(self):
        texto = self._correr('--aplicar')

        self.assertIn('APLICANDO CAMBIOS', texto)
        self.assertEqual(DashboardComponent.objects.get(pk=self.componente.pk).content, self.correcto)

    def test_marca_los_componentes_ocultos(self):
        """Un componente oculto también se recalcula, pero una lista de ids que nadie ve en
        pantalla, sin ninguna aclaración, parece un error del comando."""
        DashboardComponent.objects.filter(pk=self.componente.pk).update(is_visible=False)

        texto = self._correr()

        self.assertIn(f'{self.componente.component_id}  (oculto)', texto)
