import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.compat import AuditEvent
from apps.cartera.tests.auditoria import eventos
from apps.cartera import permisos
from apps.cartera.exceptions import CarteraError
from apps.cartera.models import DashboardComponent, DashboardLayout
from apps.cartera.services import dashboard_layout as dl

User = get_user_model()


def _cliente_autenticado():
    """Desde la Fase 5, todo endpoint de `cartera`/`dashboards` exige `IsAuthenticated` +
    `dashboard.*` — un superusuario bypasea la resolución de permisos por diseño
    (`apps.permissions.authorization.user_has_permission`)."""
    client = APIClient()
    usuario = User.objects.create_superuser(username=f'tester_{User.objects.count()}', email=f'tester{User.objects.count()}@example.com', password='Clave-Segura-123')
    client.force_authenticate(user=usuario)
    return client


def _generar_componentes(dashboard_id, cantidad=2):
    """Agrega `cantidad` componentes vía `agregar_componente_generado`, como si el usuario
    hubiese subido un archivo y confirmado esa cantidad de recomendaciones — fixture reutilizada
    por varios tests que necesitan un layout no vacío para editar."""
    layout = None
    for i in range(1, cantidad + 1):
        especificacion = {
            'titulo': f'Gráfica {i}', 'columna_valor': 'valor', 'columna_categoria': 'categoria',
            'datos': {'tipo': 'chart', 'categorias': ['A', 'B'], 'valores': [10.0, 20.0]},
        }
        layout = dl.agregar_componente_generado(dashboard_id, especificacion, reemplazar_existentes=(i == 1))
    return layout


class LayoutVacioTests(TestCase):
    def setUp(self):
        self.client = _cliente_autenticado()

    def test_un_dashboard_nuevo_no_tiene_componentes(self):
        """Ya no existe un layout fijo predefinido: un dashboard recién creado arranca sin
        componentes hasta que se genera un dashboard a partir de un archivo cargado."""
        resp = self.client.get('/api/v1/dashboards/finanzas/layout')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['version'], 1)
        self.assertEqual(data['components'], [])
        self.assertTrue(DashboardLayout.objects.filter(dashboard_id='finanzas').exists())


class AgregarComponenteGeneradoTests(TestCase):
    def test_crea_un_componente_kpi(self):
        especificacion = {'titulo': 'Total', 'columna_valor': 'saldo', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 100.0}}
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componentes = list(layout.components.all())
        self.assertEqual(len(componentes), 1)
        self.assertEqual(componentes[0].type, DashboardComponent.Tipo.KPI)
        self.assertEqual(componentes[0].content, {'titulo': 'Total', 'descripcion': '', 'valor': 100.0, 'formato': 'numero'})

    def test_crea_un_componente_chart(self):
        especificacion = {
            'titulo': 'Por ciudad', 'columna_valor': 'saldo', 'columna_categoria': 'ciudad',
            'datos': {'tipo': 'chart', 'categorias': ['Quito'], 'valores': [100.0]},
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertEqual(componente.type, DashboardComponent.Tipo.CHART)
        self.assertEqual(componente.content['categorias'], ['Quito'])
        self.assertEqual(componente.content['valores'], [100.0])

    def test_agregar_sucesivamente_suma_componentes_en_vez_de_reemplazar(self):
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Primera', 'columna_valor': 'x', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 1.0},
        })
        layout = dl.agregar_componente_generado('finanzas', {
            'titulo': 'Segunda', 'columna_valor': 'y', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 2.0},
        })
        ids = sorted(c.component_id for c in layout.components.all())
        self.assertEqual(ids, ['primera', 'segunda'])

    def test_titulos_repetidos_generan_ids_unicos(self):
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Ventas', 'columna_valor': 'x', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 1.0},
        })
        layout = dl.agregar_componente_generado('finanzas', {
            'titulo': 'Ventas', 'columna_valor': 'y', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 2.0},
        })
        ids = sorted(c.component_id for c in layout.components.all())
        self.assertEqual(ids, ['ventas', 'ventas-2'])

    def test_reemplazar_existentes_empieza_de_cero(self):
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Viejo', 'columna_valor': 'x', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 1.0},
        })
        layout = dl.agregar_componente_generado('finanzas', {
            'titulo': 'Nuevo', 'columna_valor': 'y', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 2.0},
        }, reemplazar_existentes=True)
        ids = [c.component_id for c in layout.components.all()]
        self.assertEqual(ids, ['nuevo'])

    def test_registra_auditoria(self):
        usuario = User.objects.create_user(username='ana3', email='ana3@example.com', password='Clave-Segura-123')
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Ventas', 'columna_valor': 'x', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 1.0},
        }, actor=usuario)
        self.assertTrue(eventos.filter(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_CHART_ADDED',
            dashboard_id='finanzas', actor=usuario,
        ).exists())


class AgregarComponenteGeneradoCalculoNuevosTests(TestCase):
    """`agregar_componente_generado` para los 3 `calculo` nuevos — confirma que `mapeo` queda
    completo (necesario para reconfigurar después desde "Configurar componente" → "Datos")."""

    def test_kpi_con_meta_persiste_meta_min_y_meta_max_en_mapeo_y_content(self):
        especificacion = {
            'titulo': 'Total', 'calculo': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None,
            'datos': {'tipo': 'kpi', 'valor': 100.0}, 'meta_min': 50, 'meta_max': 200,
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertEqual(componente.mapeo['meta_min'], 50)
        self.assertEqual(componente.mapeo['meta_max'], 200)
        self.assertIn('meta', componente.content)
        self.assertTrue(componente.content['meta']['cumple'])

    def test_kpi_sin_meta_no_agrega_nada_de_meta(self):
        especificacion = {
            'titulo': 'Total', 'calculo': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None,
            'datos': {'tipo': 'kpi', 'valor': 100.0},
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertNotIn('meta_min', componente.mapeo)
        self.assertNotIn('meta', componente.content)

    def test_kpi_con_formato_moneda_lo_persiste_en_mapeo_y_content(self):
        especificacion = {
            'titulo': 'Cartera Total', 'calculo': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None,
            'datos': {'tipo': 'kpi', 'valor': 100.0}, 'formato': 'moneda',
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertEqual(componente.mapeo['formato'], 'moneda')
        self.assertEqual(componente.content['formato'], 'moneda')

    def test_kpi_sin_formato_elegido_cae_a_numero_en_content_sin_agregarlo_al_mapeo(self):
        especificacion = {
            'titulo': 'Total', 'calculo': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None,
            'datos': {'tipo': 'kpi', 'valor': 100.0},
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertNotIn('formato', componente.mapeo)
        self.assertEqual(componente.content['formato'], 'numero')

    def test_tramos_antiguedad_persiste_columna_fecha_y_valor_en_mapeo(self):
        especificacion = {
            'titulo': 'Antigüedad', 'calculo': 'tramos_antiguedad',
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo',
            'datos': {'tipo': 'chart', 'categorias': ['Anticipada'], 'valores': [100.0]},
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertEqual(componente.mapeo, {
            'disponible': True, 'calculo': 'tramos_antiguedad', 'columna_fecha': 'vencimiento', 'columna_valor': 'saldo',
        })

    def test_cumplimiento_metas_persiste_metas_en_mapeo(self):
        metas = [{'meta_min': 50}]
        especificacion = {
            'titulo': 'Cumplimiento', 'calculo': 'cumplimiento_metas',
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo', 'metas': metas,
            'datos': {'tipo': 'tabla_multi', 'columnas': ['Tramo', 'saldo', '% acumulado', 'Resultado'], 'filas': [], 'total': None},
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertEqual(componente.mapeo, {
            'disponible': True, 'calculo': 'cumplimiento_metas',
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo', 'metas': metas,
        })

    def test_concentracion_persiste_top_n_en_mapeo(self):
        especificacion = {
            'titulo': 'Concentración', 'calculo': 'concentracion',
            'columna_id': 'cliente', 'columna_valor': 'saldo', 'top_n': 10,
            'datos': {'tipo': 'tabla_multi', 'columnas': ['cliente', 'saldo', '% del total', '% acumulado'], 'filas': [], 'total': None},
        }
        layout = dl.agregar_componente_generado('finanzas', especificacion)
        componente = layout.components.get()
        self.assertEqual(componente.mapeo, {
            'disponible': True, 'calculo': 'concentracion', 'columna_id': 'cliente', 'columna_valor': 'saldo', 'top_n': 10,
        })


class ValidarMapeoCalculoTests(TestCase):
    """`validar_componentes` — validación real de `meta_min`/`meta_max` (KPI), `top_n`
    (concentración) y `metas` (cumplimiento de metas), a través del endpoint PUT del layout."""

    def setUp(self):
        self.client = _cliente_autenticado()

    def _guardar_kpi_con_especificacion(self, extra_especificacion):
        especificacion = {
            'titulo': 'Total', 'calculo': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None,
            'datos': {'tipo': 'kpi', 'valor': 100.0}, **extra_especificacion,
        }
        dl.agregar_componente_generado('finanzas', especificacion, reemplazar_existentes=True)
        data = self.client.get('/api/v1/dashboards/finanzas/layout').json()
        return data

    def test_kpi_con_meta_numerica_valida_se_guarda(self):
        data = self._guardar_kpi_con_especificacion({'meta_min': 50, 'meta_max': 200})
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)

    def test_kpi_con_meta_no_numerica_devuelve_400(self):
        data = self._guardar_kpi_con_especificacion({'meta_min': 50})
        comps = data['components']
        comps[0]['mapeo']['meta_min'] = 'no es un número'
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'META_INVALIDA')

    def test_kpi_con_formato_valido_se_guarda(self):
        data = self._guardar_kpi_con_especificacion({'formato': 'moneda'})
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)

    def test_kpi_sin_formato_elegido_se_guarda_como_numero(self):
        data = self._guardar_kpi_con_especificacion({})
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        guardado = resp.json()['components'][0]
        self.assertEqual(guardado['mapeo']['formato'], 'numero')

    def test_kpi_con_formato_invalido_devuelve_400(self):
        data = self._guardar_kpi_con_especificacion({})
        comps = data['components']
        comps[0]['mapeo']['formato'] = 'euros'
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'FORMATO_INVALIDO')

    def _guardar_componente_con_calculo(self, calculo, extra_especificacion):
        especificacion = {
            'titulo': 'Comp', 'calculo': calculo,
            'datos': {'tipo': 'tabla_multi', 'columnas': ['a'], 'filas': [], 'total': None},
            **extra_especificacion,
        }
        dl.agregar_componente_generado('finanzas', especificacion, reemplazar_existentes=True)
        return self.client.get('/api/v1/dashboards/finanzas/layout').json()

    def test_tabla_con_usa_historico_se_guarda(self):
        data = self._guardar_componente_con_calculo('tabla', {
            'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}], 'usa_historico': True,
        })
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        guardado = resp.json()['components'][0]
        self.assertTrue(guardado['mapeo']['usa_historico'])

    def test_tabla_sin_usa_historico_se_guarda_como_false(self):
        data = self._guardar_componente_con_calculo('tabla', {
            'columna_id': 'cliente', 'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}],
        })
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        guardado = resp.json()['components'][0]
        self.assertFalse(guardado['mapeo']['usa_historico'])

    def test_concentracion_con_top_n_valido_se_guarda(self):
        data = self._guardar_componente_con_calculo('concentracion', {'columna_id': 'cliente', 'columna_valor': 'saldo', 'top_n': 10})
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)

    def test_concentracion_con_top_n_fuera_de_rango_devuelve_400(self):
        data = self._guardar_componente_con_calculo('concentracion', {'columna_id': 'cliente', 'columna_valor': 'saldo', 'top_n': 10})
        comps = data['components']
        comps[0]['mapeo']['top_n'] = 200
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TOP_N_INVALIDO')

    def test_concentracion_con_top_n_no_entero_devuelve_400(self):
        data = self._guardar_componente_con_calculo('concentracion', {'columna_id': 'cliente', 'columna_valor': 'saldo', 'top_n': 10})
        comps = data['components']
        comps[0]['mapeo']['top_n'] = 'diez'
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TOP_N_INVALIDO')

    def _componente_deudores(self, cuantos):
        return self._guardar_componente_con_calculo('antiguedad_por_deudor', {
            'columna_id': 'cliente', 'columna_fecha': 'vencimiento', 'columna_valor': 'saldo',
            'cuantos': cuantos,
        })

    def test_antiguedad_por_deudor_con_cantidad_valida_se_guarda(self):
        data = self._componente_deudores(2)
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)

    def test_antiguedad_por_deudor_con_cantidad_fuera_de_rango_devuelve_400(self):
        # El tope existe porque los bloques se muestran uno al lado del otro: más de media docena
        # deja de ser legible.
        data = self._componente_deudores(2)
        comps = data['components']
        comps[0]['mapeo']['cuantos'] = 50
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'CANTIDAD_DEUDORES_INVALIDA')

    def test_antiguedad_por_deudor_con_cantidad_no_entera_devuelve_400(self):
        data = self._componente_deudores(2)
        comps = data['components']
        comps[0]['mapeo']['cuantos'] = 'dos'
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'CANTIDAD_DEUDORES_INVALIDA')

    def test_cumplimiento_metas_con_metas_validas_se_guarda(self):
        data = self._guardar_componente_con_calculo('cumplimiento_metas', {
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo', 'metas': [{'meta_min': 50}],
        })
        payload = {'version': data['version'], 'components': data['components'], 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 200)

    def test_cumplimiento_metas_con_metas_no_lista_devuelve_400(self):
        data = self._guardar_componente_con_calculo('cumplimiento_metas', {
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo', 'metas': [{'meta_min': 50}],
        })
        comps = data['components']
        comps[0]['mapeo']['metas'] = 'no es una lista'
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'METAS_INVALIDAS')

    def test_cumplimiento_metas_con_entrada_de_meta_invalida_devuelve_400(self):
        # El valor de una meta individual (dentro de la lista) reusa el mismo código de error que
        # la meta de un KPI (`META_INVALIDA`, no `METAS_INVALIDAS`) — `METAS_INVALIDAS` queda para
        # problemas de ESTRUCTURA de la lista (no es lista, entrada no es dict, más de 6 entradas).
        data = self._guardar_componente_con_calculo('cumplimiento_metas', {
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo', 'metas': [{'meta_min': 50}],
        })
        comps = data['components']
        comps[0]['mapeo']['metas'] = [{'meta_min': 'no numérico'}]
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'META_INVALIDA')

    def test_cumplimiento_metas_con_estructura_de_lista_invalida_devuelve_metas_invalidas(self):
        data = self._guardar_componente_con_calculo('cumplimiento_metas', {
            'columna_fecha': 'vencimiento', 'columna_valor': 'saldo', 'metas': [{'meta_min': 50}],
        })
        comps = data['components']
        comps[0]['mapeo']['metas'] = ['no es un dict']
        payload = {'version': data['version'], 'components': comps, 'changed_by': 'Tester'}
        resp = self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'METAS_INVALIDAS')


class ValidarMapeoCalculoUsaHistoricoDirectoTests(TestCase):
    """`_validar_mapeo_calculo` a través de llamadas directas (no vía el endpoint PUT del layout) —
    cubre específicamente el fallback `mapeo.get('calculo') or (chart_type si es 'tabla')`, que
    solo hace falta para las 13 posiciones fijas (tabla-1/tabla-2/tabla-3, nunca guardan `calculo`
    dentro de su propio mapeo, ver `ComponentDataSection.jsx::conCalculo`) — algo que
    `_guardar_componente_con_calculo` (arriba, usa `agregar_componente_generado`) no puede simular,
    porque Zona Personal SIEMPRE guarda `calculo` explícito."""

    def test_zona_personal_normaliza_usa_historico_a_bool(self):
        mapeo = {'calculo': 'tabla', 'usa_historico': 1}
        dl._validar_mapeo_calculo('mi-tabla', DashboardComponent.Tipo.CHART, 'tabla', mapeo)
        self.assertIs(mapeo['usa_historico'], True)

    def test_zona_personal_sin_usa_historico_lo_deja_en_false(self):
        mapeo = {'calculo': 'tabla'}
        dl._validar_mapeo_calculo('mi-tabla', DashboardComponent.Tipo.CHART, 'tabla', mapeo)
        self.assertIs(mapeo['usa_historico'], False)

    def test_posicion_fija_sin_calculo_en_el_mapeo_usa_el_chart_type_como_fallback(self):
        mapeo = {'usa_historico': True}
        dl._validar_mapeo_calculo('tabla-1', DashboardComponent.Tipo.CHART, 'tabla', mapeo)
        self.assertIs(mapeo['usa_historico'], True)

    def test_calculo_explicito_en_el_mapeo_gana_por_encima_del_chart_type(self):
        # concentracion/cumplimiento_metas también tienen chart_type == 'tabla' — sin priorizar
        # `mapeo['calculo']` cuando está presente, se les agregaría `usa_historico` por error.
        mapeo = {'calculo': 'concentracion'}
        dl._validar_mapeo_calculo('mi-concentracion', DashboardComponent.Tipo.CHART, 'tabla', mapeo)
        self.assertNotIn('usa_historico', mapeo)

    def test_posicion_fija_de_grafico_normal_tambien_recibe_usa_historico(self):
        # 'chart'/'multivalor'/'multiserie' quedan dentro de alcance (no solo 'tabla') — cualquier
        # `chart_type` que no sea 'tabla' ni 'dispersion' cae al fallback genérico 'chart', que sí
        # necesita `usa_historico` sanitizado.
        mapeo = {}
        dl._validar_mapeo_calculo('grafico-1', DashboardComponent.Tipo.CHART, 'barras_verticales', mapeo)
        self.assertIs(mapeo['usa_historico'], False)

    def test_posicion_fija_de_dispersion_no_agrega_usa_historico(self):
        # Dispersión es la única posición fija que queda fuera de alcance (su cálculo, un punto
        # por fila con ambas columnas presentes, no se traduce a "una carga = un punto").
        mapeo = {}
        dl._validar_mapeo_calculo('grafico-6', DashboardComponent.Tipo.CHART, 'dispersion', mapeo)
        self.assertNotIn('usa_historico', mapeo)


class AgregarComponentePresentacionalTests(TestCase):
    def test_crea_un_titulo_con_texto_de_partida(self):
        layout = dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TITLE)
        componente = layout.components.get()
        self.assertEqual(componente.type, DashboardComponent.Tipo.TITLE)
        self.assertEqual(componente.content, {'titulo': 'Nuevo título'})
        self.assertEqual(componente.width, 12)
        self.assertEqual(componente.height, 70)

    def test_crea_un_separador_sin_titulo(self):
        layout = dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TEXT)
        componente = layout.components.get()
        self.assertEqual(componente.type, DashboardComponent.Tipo.TEXT)
        self.assertEqual(componente.content, {'titulo': ''})
        self.assertEqual(componente.height, 40)

    def test_tipo_invalido_lanza_error(self):
        with self.assertRaises(CarteraError) as contexto:
            dl.agregar_componente_presentacional('finanzas', 'kpi')
        self.assertEqual(contexto.exception.codigo, 'TIPO_INVALIDO')

    def test_ancho_columnas_traduce_a_width(self):
        for ancho_columnas, width_esperado in ((1, 12), (2, 6), (4, 3)):
            layout = dl.agregar_componente_presentacional(
                'finanzas', DashboardComponent.Tipo.TITLE, ancho_columnas=ancho_columnas,
            )
            nuevo = layout.components.order_by('-order').first()
            self.assertEqual(nuevo.width, width_esperado)

    def test_sin_ancho_columnas_usa_ancho_completo(self):
        layout = dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TEXT)
        self.assertEqual(layout.components.get().width, 12)

    def test_zona_queda_en_config(self):
        layout = dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TITLE, zona='personal')
        self.assertEqual(layout.components.get().config, {'zona': 'personal'})

    def test_sin_zona_config_queda_vacio(self):
        layout = dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TITLE)
        self.assertEqual(layout.components.get().config, {})

    def test_dos_separadores_seguidos_generan_ids_unicos(self):
        dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TEXT)
        layout = dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TEXT)
        ids = sorted(c.component_id for c in layout.components.all())
        self.assertEqual(ids, ['separador', 'separador-2'])

    def test_se_agrega_al_final_de_los_componentes_existentes(self):
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'KPI existente', 'columna_valor': 'x', 'columna_categoria': None, 'datos': {'tipo': 'kpi', 'valor': 1.0},
        })
        layout = dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TITLE)
        nuevo = layout.components.get(type=DashboardComponent.Tipo.TITLE)
        self.assertEqual(nuevo.order, 2)

    def test_registra_auditoria(self):
        usuario = User.objects.create_user(username='ana4', email='ana4@example.com', password='Clave-Segura-123')
        dl.agregar_componente_presentacional('finanzas', DashboardComponent.Tipo.TITLE, actor=usuario)
        self.assertTrue(eventos.filter(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_CHART_ADDED',
            dashboard_id='finanzas', actor=usuario,
        ).exists())


class DashboardComponentePresentacionalViewTests(TestCase):
    def setUp(self):
        self.client = _cliente_autenticado()

    def test_crea_el_componente_y_devuelve_el_layout(self):
        resp = self.client.post(
            '/api/v1/dashboards/finanzas/componentes-presentacionales', {'tipo': 'title', 'zona': 'personal'}, format='json',
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(len(data['components']), 1)
        self.assertEqual(data['components'][0]['type'], 'title')
        self.assertEqual(data['components'][0]['config']['zona'], 'personal')

    def test_tipo_invalido_devuelve_400(self):
        resp = self.client.post('/api/v1/dashboards/finanzas/componentes-presentacionales', {'tipo': 'kpi'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TIPO_INVALIDO')

    def test_sin_permiso_de_edicion_devuelve_403(self):
        with mock.patch('apps.cartera.permisos.tiene_permiso', return_value=False):
            resp = self.client.post('/api/v1/dashboards/finanzas/componentes-presentacionales', {'tipo': 'text'}, format='json')
        self.assertEqual(resp.status_code, 403)


class GuardarLayoutTests(TestCase):
    def setUp(self):
        self.client = _cliente_autenticado()
        _generar_componentes('finanzas', cantidad=2)
        self.data_inicial = self.client.get('/api/v1/dashboards/finanzas/layout').json()

    def _guardar(self, componentes, version=None, changed_by='Tester'):
        payload = {'version': version if version is not None else self.data_inicial['version'], 'components': componentes, 'changed_by': changed_by}
        return self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')

    def test_guarda_cambio_de_orden_tamano_color_y_texto(self):
        comps = self.data_inicial['components']
        comps[0]['order'] = 10
        comps[1]['content']['titulo'] = 'Nuevo título'
        comps[1]['styles'] = {'colorPrincipal': '#123456'}
        comps[1]['width'] = 8

        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['version'], self.data_inicial['version'] + 1)

        audit = list(eventos.filter(
            domain=AuditEvent.Domain.DASHBOARD_LAYOUT, dashboard_id='finanzas',
        ).values_list('component_id', 'action'))
        self.assertIn((comps[0]['component_id'], dl.CambioLayout.ORDEN), audit)
        self.assertIn((comps[1]['component_id'], dl.CambioLayout.TEXTO), audit)
        self.assertIn((comps[1]['component_id'], dl.CambioLayout.COLOR), audit)
        self.assertIn((comps[1]['component_id'], dl.CambioLayout.TAMANO), audit)

    def test_ocultar_componente_registra_auditoria(self):
        comps = self.data_inicial['components']
        comps[0]['is_visible'] = False

        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)
        oculto = next(c for c in resp.json()['components'] if c['component_id'] == comps[0]['component_id'])
        self.assertFalse(oculto['is_visible'])
        self.assertTrue(eventos.filter(
            domain=AuditEvent.Domain.DASHBOARD_LAYOUT,
            dashboard_id='finanzas', component_id=comps[0]['component_id'], action=dl.CambioLayout.OCULTADO,
        ).exists())

    def test_permite_cambiar_el_chart_type_de_un_componente(self):
        comps = self.data_inicial['components']
        comps[0]['chart_type'] = 'lineas'

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 200)
        componente = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id=comps[0]['component_id'])
        self.assertEqual(componente.chart_type, 'lineas')

    def test_un_chart_type_no_reconocido_cae_al_que_ya_tenia(self):
        comps = self.data_inicial['components']
        original = comps[0]['chart_type']
        comps[0]['chart_type'] = 'no_existe'

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 200)
        componente = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id=comps[0]['component_id'])
        self.assertEqual(componente.chart_type, original)

    def test_permite_guardar_el_mapeo_de_un_componente(self):
        comps = self.data_inicial['components']
        comps[0]['mapeo'] = {'columna_valor': 'saldo', 'columna_categoria': 'ciudad'}

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 200)
        componente = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id=comps[0]['component_id'])
        self.assertEqual(componente.mapeo, {'columna_valor': 'saldo', 'columna_categoria': 'ciudad', 'usa_historico': False})

    def test_mapeo_invalido_devuelve_400(self):
        comps = self.data_inicial['components']
        comps[0]['mapeo'] = 'no es un objeto'

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'MAPEO_INVALIDO')

    def test_omitir_un_componente_lo_elimina_y_registra_auditoria(self):
        comps = self.data_inicial['components']
        eliminado_id = comps[0]['component_id']
        restantes = comps[1:]

        resp = self._guardar(restantes)
        self.assertEqual(resp.status_code, 200)
        ids_guardados = [c['component_id'] for c in resp.json()['components']]
        self.assertNotIn(eliminado_id, ids_guardados)
        self.assertEqual(len(ids_guardados), 1)

        self.assertTrue(eventos.filter(
            domain=AuditEvent.Domain.DASHBOARD_LAYOUT,
            dashboard_id='finanzas', component_id=eliminado_id, action=dl.CambioLayout.ELIMINADO,
        ).exists())

    def test_eliminar_todos_los_componentes_deja_el_dashboard_vacio(self):
        resp = self._guardar([])
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['components'], [])

    def test_titulo_con_signo_mayor_que_no_se_corrompe(self):
        """Regresión: la sanitización no debe destruir texto legítimo como 'Ventas > 100'."""
        comps = self.data_inicial['components']
        comps[0]['content']['titulo'] = 'Ventas > 100'

        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)
        guardado = next(c for c in resp.json()['components'] if c['component_id'] == comps[0]['component_id'])
        self.assertEqual(guardado['content']['titulo'], 'Ventas > 100')

    def test_sanitiza_etiquetas_html_del_titulo(self):
        comps = self.data_inicial['components']
        comps[0]['content']['titulo'] = '<script>alert(1)</script>Top clientes'

        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)
        guardado = next(c for c in resp.json()['components'] if c['component_id'] == comps[0]['component_id'])
        self.assertNotIn('<script>', guardado['content']['titulo'])
        self.assertIn('Top clientes', guardado['content']['titulo'])

    def test_conflicto_de_version_no_sobrescribe(self):
        comps = self.data_inicial['components']
        resp1 = self._guardar(comps, version=self.data_inicial['version'])
        self.assertEqual(resp1.status_code, 200)

        resp2 = self._guardar(comps, version=self.data_inicial['version'])
        self.assertEqual(resp2.status_code, 409)
        self.assertEqual(resp2.json()['error'], 'CONFLICTO_DE_VERSION')

    def test_rechaza_componente_desconocido(self):
        resp = self._guardar([{'component_id': 'kpi-hackeado', 'row': 1, 'order': 1, 'width': 2, 'height': 180}])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COMPONENTE_NO_PERMITIDO')

    def test_rechaza_ancho_fuera_de_rango(self):
        comps = self.data_inicial['components']
        comps[0]['width'] = 13
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'ANCHO_INVALIDO')

    def test_rechaza_color_invalido(self):
        comps = self.data_inicial['components']
        comps[0]['styles'] = {'colorPrincipal': 'javascript:alert(1)'}
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLOR_INVALIDO')

    def test_acepta_color_hex_y_rgba(self):
        comps = self.data_inicial['components']
        comps[0]['styles'] = {'colorPrincipal': '#1F4E78', 'colorSecundario': 'rgba(198, 40, 40, 0.8)'}
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)

    def test_acepta_un_color_distinto_por_categoria(self):
        comps = self.data_inicial['components']
        comps[0]['styles'] = {'coloresPorCategoria': {'Quito': '#1F4E78', 'Guayaquil': 'rgba(198, 40, 40, 0.8)'}}
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)
        guardado = next(c for c in resp.json()['components'] if c['component_id'] == comps[0]['component_id'])
        self.assertEqual(guardado['styles']['coloresPorCategoria'], {'Quito': '#1F4E78', 'Guayaquil': 'rgba(198, 40, 40, 0.8)'})

    def test_rechaza_coloresPorCategoria_que_no_es_un_objeto(self):
        comps = self.data_inicial['components']
        comps[0]['styles'] = {'coloresPorCategoria': 'no-es-un-objeto'}
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLOR_INVALIDO')

    def test_rechaza_un_color_invalido_dentro_de_coloresPorCategoria(self):
        comps = self.data_inicial['components']
        comps[0]['styles'] = {'coloresPorCategoria': {'Quito': 'javascript:alert(1)'}}
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COLOR_INVALIDO')

    def test_una_categoria_con_color_vacio_se_descarta_del_mapa(self):
        comps = self.data_inicial['components']
        comps[0]['styles'] = {'coloresPorCategoria': {'Quito': '#1F4E78', 'Guayaquil': ''}}
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)
        guardado = next(c for c in resp.json()['components'] if c['component_id'] == comps[0]['component_id'])
        self.assertEqual(guardado['styles']['coloresPorCategoria'], {'Quito': '#1F4E78'})


class GuardarLayoutTablaTests(TestCase):
    """Editar valores de celda (panel de propiedades, `TableCellsEditor.jsx`) solo puede cambiar
    el VALOR de una celda que ya existe — `_validar_contenido_tabla` es lo que realmente lo
    impide, no el frontend (ver `@.claude/rules/security.md`)."""

    def setUp(self):
        self.client = _cliente_autenticado()
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Top clientes', 'columna_id': 'cliente', 'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}],
            'datos': {'tipo': 'tabla_multi', 'columnas': ['Cliente', 'Saldo'], 'filas': [['A', 100.0], ['B', 200.0]], 'total': ['Total', 300.0]},
        })
        self.data_inicial = self.client.get('/api/v1/dashboards/finanzas/layout').json()

    def _guardar(self, componentes, version=None):
        payload = {'version': version if version is not None else self.data_inicial['version'], 'components': componentes, 'changed_by': 'Tester'}
        return self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')

    def test_editar_un_valor_de_celda_dentro_de_la_misma_forma_se_guarda(self):
        comps = self.data_inicial['components']
        comps[0]['content']['filas'] = [['A', 999.0], ['B', 200.0]]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 200)
        componente = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id=comps[0]['component_id'])
        self.assertEqual(componente.content['filas'], [['A', 999.0], ['B', 200.0]])

    def test_editar_la_fila_de_total_se_guarda(self):
        comps = self.data_inicial['components']
        comps[0]['content']['total'] = ['Total', 999.0]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 200)
        componente = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id=comps[0]['component_id'])
        self.assertEqual(componente.content['total'], ['Total', 999.0])

    def test_una_celda_que_pasa_de_null_a_numero_se_acepta(self):
        comps = self.data_inicial['components']
        comps[0]['content']['filas'] = [['A', None], ['B', 200.0]]
        resp = self._guardar(comps)
        self.assertEqual(resp.status_code, 200)

        comps2 = resp.json()['components']
        comps2[0]['content']['filas'] = [['A', 150.0], ['B', 200.0]]
        resp2 = self._guardar(comps2, version=resp.json()['version'])
        self.assertEqual(resp2.status_code, 200)

    def test_agregar_una_fila_se_rechaza(self):
        comps = self.data_inicial['components']
        comps[0]['content']['filas'] = [['A', 100.0], ['B', 200.0], ['C', 300.0]]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_FILAS_INVALIDAS')

    def test_quitar_una_fila_se_rechaza(self):
        comps = self.data_inicial['components']
        comps[0]['content']['filas'] = [['A', 100.0]]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_FILAS_INVALIDAS')

    def test_una_fila_con_menos_columnas_se_rechaza(self):
        comps = self.data_inicial['components']
        comps[0]['content']['filas'] = [['A'], ['B', 200.0]]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_FILAS_INVALIDAS')

    def test_renombrar_una_columna_se_rechaza(self):
        comps = self.data_inicial['components']
        comps[0]['content']['columnas'] = ['Cliente', 'Saldo Nuevo']

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_COLUMNAS_INVALIDAS')

    def test_agregar_una_columna_se_rechaza(self):
        comps = self.data_inicial['components']
        comps[0]['content']['columnas'] = ['Cliente', 'Saldo', 'Extra']

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_COLUMNAS_INVALIDAS')

    def test_una_celda_con_un_objeto_anidado_se_rechaza(self):
        comps = self.data_inicial['components']
        comps[0]['content']['filas'] = [['A', {'no': 'valido'}], ['B', 200.0]]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_CELDA_INVALIDA')

    def test_achicar_la_fila_de_total_se_rechaza(self):
        comps = self.data_inicial['components']
        comps[0]['content']['total'] = ['Total']

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_FILAS_INVALIDAS')


class GuardarLayoutTablaConMapeoTests(TestCase):
    """Reconfigurar la fuente de datos de una tabla (plantilla fija o Zona Personal, panel de
    propiedades → "Datos", `ComponentDataSection.jsx`) legítimamente cambia la cantidad de
    filas/columnas frente a lo ya persistido (nueva agrupación) — `_validar_contenido_tabla` no
    debe exigir la misma forma cuando el `mapeo` entrante cambió en el mismo guardado."""

    def setUp(self):
        self.client = _cliente_autenticado()
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Top clientes', 'calculo': 'tabla', 'columna_id': 'cliente',
            'columnas_valor': [{'columna': 'saldo', 'tipo_agregacion': 'suma'}],
            'datos': {'tipo': 'tabla_multi', 'columnas': ['Cliente', 'Saldo'], 'filas': [['A', 100.0], ['B', 200.0]], 'total': ['Total', 300.0]},
        })
        self.data_inicial = self.client.get('/api/v1/dashboards/finanzas/layout').json()

    def _guardar(self, componentes, version=None):
        payload = {'version': version if version is not None else self.data_inicial['version'], 'components': componentes, 'changed_by': 'Tester'}
        return self.client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps(payload), content_type='application/json')

    def test_cambiar_mapeo_y_forma_de_la_tabla_en_el_mismo_guardado_se_acepta(self):
        comps = self.data_inicial['components']
        comps[0]['mapeo'] = {'disponible': True, 'calculo': 'tabla', 'columna_id': 'cliente', 'columnas_valor': [{'columna': 'dias_credito', 'tipo_agregacion': 'suma'}]}
        comps[0]['content'] = {
            'titulo': 'Top clientes', 'descripcion': '',
            'columnas': ['Cliente', 'Dias credito', '% del total'],
            'filas': [['A', 10.0, 50.0], ['B', 10.0, 50.0], ['C', 0.0, 0.0]],
            'total': ['Total', 20.0, 100.0],
        }

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 200)
        componente = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id=comps[0]['component_id'])
        self.assertEqual(componente.content['columnas'], ['Cliente', 'Dias credito', '% del total'])
        self.assertEqual(len(componente.content['filas']), 3)
        self.assertEqual(componente.mapeo['columna_id'], 'cliente')

    def test_cambiar_solo_el_contenido_sin_tocar_el_mapeo_sigue_exigiendo_la_misma_forma(self):
        """Control: sin cambio de `mapeo`, el comportamiento existente (edición manual de celdas,
        `GuardarLayoutTablaTests`) no debe verse afectado por este fix."""
        comps = self.data_inicial['components']
        comps[0]['content']['filas'] = [['A', 100.0], ['B', 200.0], ['C', 300.0]]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_FILAS_INVALIDAS')

    def test_cambiar_mapeo_con_una_celda_invalida_sigue_rechazandose(self):
        comps = self.data_inicial['components']
        comps[0]['mapeo'] = {'disponible': True, 'calculo': 'tabla', 'columna_id': 'cliente', 'columnas_valor': [{'columna': 'dias_credito', 'tipo_agregacion': 'suma'}]}
        comps[0]['content']['filas'] = [['A', {'no': 'valido'}]]

        resp = self._guardar(comps)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'TABLA_CELDA_INVALIDA')


class PaginacionEnComponenteTablaTests(TestCase):
    """`_sanitizar_config_paginacion` sigue vigente para cualquier componente tipo TABLE que
    exista en un layout (aunque el flujo de generación ya no cree ninguno por defecto)."""

    def setUp(self):
        self.client = _cliente_autenticado()
        layout = dl.obtener_o_crear_layout('finanzas')
        DashboardComponent.objects.create(
            layout=layout, component_id='tabla-detalle', type=DashboardComponent.Tipo.TABLE,
            row=1, order=1, width=12, height=400,
            content={'titulo': 'Detalle'}, config={'defaultPageSize': 10, 'allowedPageSizes': [5, 10, 25, 50, 100], 'paginationEnabled': True},
        )
        self.data_inicial = self.client.get('/api/v1/dashboards/finanzas/layout').json()

    def test_page_size_por_defecto_invalido_cae_al_fallback(self):
        comps = self.data_inicial['components']
        comps[0]['config'] = {'defaultPageSize': 999, 'allowedPageSizes': [5, 10, 25, 50, 100]}
        resp = self.client.put(
            '/api/v1/dashboards/finanzas/layout',
            data=json.dumps({'version': self.data_inicial['version'], 'components': comps}), content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        guardado = resp.json()['components'][0]
        self.assertEqual(guardado['config']['defaultPageSize'], 10)


class RestablecerLayoutTests(TestCase):
    def test_restablecer_vuelve_a_mostrar_los_componentes_ocultos(self):
        """'Restablecer' ya no regenera un layout fijo (no existe uno) — solo deshace los
        `is_visible=False` de los componentes que ya existen."""
        client = _cliente_autenticado()
        _generar_componentes('finanzas', cantidad=2)
        data = client.get('/api/v1/dashboards/finanzas/layout').json()
        comps = data['components']
        comps[0]['is_visible'] = False
        client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps({'version': data['version'], 'components': comps}), content_type='application/json')

        resp = client.post('/api/v1/dashboards/finanzas/layout/reset', data=json.dumps({'changed_by': 'Admin'}), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        nuevo = resp.json()
        self.assertEqual(len(nuevo['components']), 2)
        antes_oculto = next(c for c in nuevo['components'] if c['component_id'] == comps[0]['component_id'])
        self.assertTrue(antes_oculto['is_visible'])
        self.assertTrue(eventos.filter(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION,
            dashboard_id='finanzas', action=dl.CambioLayout.RESTABLECIDO,
        ).exists())

    def test_versions_devuelve_historial_mas_reciente_primero(self):
        client = _cliente_autenticado()
        _generar_componentes('finanzas', cantidad=1)
        client.post('/api/v1/dashboards/finanzas/layout/reset', content_type='application/json')
        client.post('/api/v1/dashboards/finanzas/layout/reset', content_type='application/json')

        resp = client.get('/api/v1/dashboards/finanzas/versions')
        entradas = resp.json()
        self.assertGreaterEqual(len(entradas), 2)
        # El autor sale del usuario autenticado, no del cuerpo de la petición. Se verifica sobre
        # TODAS las entradas y no sobre `entradas[0]`: varios eventos de un mismo reset comparten
        # el instante de `created_at`, y con esa igualdad el orden entre ellos no está definido
        # (con SQLite, que inserta más rápido, la colisión es habitual).
        self.assertIn(User.objects.get().username, [e['changed_by'] for e in entradas])

    def test_versions_ignora_el_changed_by_enviado_por_el_cliente(self):
        """El autor del cambio no es falsificable.

        Antes `changed_by` venía en el cuerpo y el historial lo mostraba ANTES que el actor real,
        así que cualquiera que pudiera guardar un layout podía firmarlo con el nombre de otra
        persona.
        """
        client = _cliente_autenticado()
        _generar_componentes('finanzas', cantidad=1)
        client.post(
            '/api/v1/dashboards/finanzas/layout/reset',
            data=json.dumps({'changed_by': 'Gerente General'}), content_type='application/json',
        )

        entradas = client.get('/api/v1/dashboards/finanzas/versions').json()
        autores = [e['changed_by'] for e in entradas]
        # La afirmación central es que el nombre falsificado no aparece en NINGUNA entrada, y que
        # el reset quedó atribuido al usuario real. Independiente del orden entre eventos del
        # mismo instante (ver el test anterior).
        self.assertNotIn('Gerente General', autores)
        self.assertIn(User.objects.get().username, autores)


class PermisosTests(TestCase):
    def test_sin_usuario_autenticado_no_se_concede_ningun_permiso(self):
        """Fase 5: se retiró el fallback histórico que concedía todo sin autenticación (fallo
        cerrado, no abierto — docs/integracion/decisions.md #6)."""
        permisos_otorgados = permisos.permisos_del_usuario(request=None)
        for permiso in permisos.TODOS_LOS_PERMISOS:
            self.assertFalse(permisos_otorgados[permiso])

    def test_endpoint_respeta_el_punto_unico_de_verificacion(self):
        """Si el punto único de verificación deniega un permiso, el endpoint debe rechazar la
        solicitud — prueba que la protección es real y no un 200 hardcodeado."""
        client = _cliente_autenticado()
        with mock.patch('apps.cartera.permisos.tiene_permiso', return_value=False):
            resp = client.put('/api/v1/dashboards/finanzas/layout', data=json.dumps({'version': 1, 'components': []}), content_type='application/json')
        self.assertEqual(resp.status_code, 403)

        with mock.patch('apps.cartera.permisos.tiene_permiso', return_value=False):
            resp = client.post('/api/v1/dashboards/finanzas/layout/reset', data=json.dumps({}), content_type='application/json')
        self.assertEqual(resp.status_code, 403)

        with mock.patch('apps.cartera.permisos.tiene_permiso', return_value=False):
            resp = client.get('/api/v1/dashboards/finanzas/layout')
        self.assertEqual(resp.status_code, 403)


def _agregar_componente_bloqueado(dashboard_id, titulo='KPI bloqueado', **kwargs):
    especificacion = {
        'titulo': titulo, 'calculo': 'kpi', 'columna_valor': 'saldo', 'columna_categoria': None,
        'datos': {'tipo': 'kpi', 'valor': 100.0}, 'bloqueado': True,
    }
    especificacion.update(kwargs)
    return dl.agregar_componente_generado(dashboard_id, especificacion)


def _payload_actual(dashboard_id):
    """Copia mutable del layout guardado, en la misma forma que envía el frontend en el `PUT` —
    mismo patrón que `GuardarLayoutTests` (que la obtiene vía `self.client.get(...).json()`), pero
    directo desde el servicio para no depender de un cliente HTTP en tests unitarios."""
    layout = dl.obtener_o_crear_layout(dashboard_id)
    return [dict(c) for c in dl.serializar_layout(layout)['components']]


class ValidarComponentesBloqueoTests(TestCase):
    """`validar_componentes(..., es_superusuario=False)` — rechaza cambios de posición relativa/
    ancho/alto/visibilidad/eliminación en un componente con `config.bloqueado=True`, salvo que el
    actor sea superusuario. El mapeo/contenido de datos nunca se bloquea (no se testea acá que se
    pueda editar porque ya lo cubre `ValidarMapeoCalculoTests`/`AgregarComponenteGeneradoCalculoNuevosTests`
    sin este flag — la ausencia de una restricción nueva ahí es la prueba)."""

    def test_config_bloqueado_queda_persistido_al_crear(self):
        _agregar_componente_bloqueado('finanzas')
        componente = DashboardComponent.objects.get(layout__dashboard_id='finanzas', component_id='kpi-bloqueado')
        self.assertTrue(componente.config['bloqueado'])

    def test_cambiar_el_mapeo_sin_superusuario_se_acepta(self):
        """El bloqueo es solo estructural: un usuario normal puede seguir eligiendo qué columna
        alimenta un KPI/gráfico/tabla bloqueado desde "Configurar componente → Datos", igual que en
        cualquier otro componente — es lo que le permite a cada usuario seleccionar qué información
        quiere ver, aunque no pueda mover/redimensionar/ocultar/eliminar la estructura en sí."""
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['mapeo'] = {
            'disponible': True, 'calculo': 'kpi', 'columna_valor': 'otra_columna',
        }
        resultado = dl.validar_componentes('finanzas', comps, es_superusuario=False)
        self.assertEqual(resultado[0]['mapeo']['columna_valor'], 'otra_columna')

    def test_cambiar_el_contenido_titulo_y_descripcion_sin_superusuario_se_acepta(self):
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['content'] = {**comps[0]['content'], 'titulo': 'Otro título', 'descripcion': 'Otra descripción'}
        resultado = dl.validar_componentes('finanzas', comps, es_superusuario=False)
        self.assertEqual(resultado[0]['content']['titulo'], 'Otro título')
        self.assertEqual(resultado[0]['content']['descripcion'], 'Otra descripción')

    def test_cambiar_ancho_sin_superusuario_se_rechaza(self):
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['width'] = 6
        with self.assertRaises(CarteraError) as ctx:
            dl.validar_componentes('finanzas', comps, es_superusuario=False)
        self.assertEqual(ctx.exception.codigo, 'COMPONENTE_BLOQUEADO')

    def test_cambiar_ancho_con_superusuario_se_acepta(self):
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['width'] = 6
        resultado = dl.validar_componentes('finanzas', comps, es_superusuario=True)
        self.assertEqual(resultado[0]['width'], 6)

    def test_ocultar_sin_superusuario_se_rechaza(self):
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['is_visible'] = False
        with self.assertRaises(CarteraError) as ctx:
            dl.validar_componentes('finanzas', comps, es_superusuario=False)
        self.assertEqual(ctx.exception.codigo, 'COMPONENTE_BLOQUEADO')

    def test_ocultar_con_superusuario_se_acepta(self):
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['is_visible'] = False
        resultado = dl.validar_componentes('finanzas', comps, es_superusuario=True)
        self.assertFalse(resultado[0]['is_visible'])

    def test_eliminar_sin_superusuario_se_rechaza(self):
        _agregar_componente_bloqueado('finanzas')
        with self.assertRaises(CarteraError) as ctx:
            dl.validar_componentes('finanzas', [], es_superusuario=False)
        self.assertEqual(ctx.exception.codigo, 'COMPONENTE_BLOQUEADO')

    def test_eliminar_con_superusuario_se_acepta(self):
        _agregar_componente_bloqueado('finanzas')
        resultado = dl.validar_componentes('finanzas', [], es_superusuario=True)
        self.assertEqual(resultado, [])

    def test_reordenar_componentes_no_bloqueados_alrededor_del_bloqueado_no_rompe(self):
        """Agregar/reordenar Zona Personal libremente alrededor del bloque bloqueado cambia el
        `order` ABSOLUTO del bloqueado como efecto secundario — eso no cuenta como "tocarlo"."""
        _agregar_componente_bloqueado('finanzas')
        dl.agregar_componente_generado('finanzas', {
            'titulo': 'Libre 1', 'columna_valor': 'valor', 'columna_categoria': 'categoria',
            'datos': {'tipo': 'chart', 'categorias': ['A'], 'valores': [1.0]},
        })
        comps = _payload_actual('finanzas')
        # Invierte el orden de los 2 componentes NO bloqueados; el bloqueado no se toca.
        bloqueado = next(c for c in comps if c['component_id'] == 'kpi-bloqueado')
        libres = [c for c in comps if c['component_id'] != 'kpi-bloqueado']
        for i, c in enumerate(reversed(libres)):
            c['order'] = 100 + i
        resultado = dl.validar_componentes('finanzas', comps, es_superusuario=False)
        self.assertEqual(next(c for c in resultado if c['component_id'] == 'kpi-bloqueado')['width'], bloqueado['width'])

    def test_invertir_orden_relativo_entre_dos_bloqueados_se_rechaza(self):
        _agregar_componente_bloqueado('finanzas', titulo='Bloqueado 1')
        _agregar_componente_bloqueado('finanzas', titulo='Bloqueado 2')
        comps = _payload_actual('finanzas')
        ordenes = sorted(c['order'] for c in comps)
        por_id = {c['component_id']: c for c in comps}
        # Invierte el `order` de los dos bloqueados entre sí (mismo conjunto de valores, orden relativo distinto).
        por_id['bloqueado-1']['order'], por_id['bloqueado-2']['order'] = ordenes[1], ordenes[0]
        with self.assertRaises(CarteraError) as ctx:
            dl.validar_componentes('finanzas', comps, es_superusuario=False)
        self.assertEqual(ctx.exception.codigo, 'COMPONENTE_BLOQUEADO')

    def test_config_bloqueado_se_reafirma_aunque_el_payload_mande_config_vacio(self):
        """Un payload que mande `config: {}` para un componente bloqueado no debe poder
        desbloquearlo — el flag estructural se reafirma del lado del servidor, no del cliente."""
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['config'] = {}
        resultado = dl.validar_componentes('finanzas', comps, es_superusuario=False)
        self.assertTrue(resultado[0]['config']['bloqueado'])


class DashboardLayoutViewBloqueoTests(TestCase):
    """Confirma que `DashboardLayoutView.put` conecta `request.user.is_superuser` con
    `validar_componentes` — la protección real ya está cubierta por
    `ValidarComponentesBloqueoTests`, esto solo prueba el cableado de la vista."""

    def _cliente_normal_con_permiso(self):
        usuario = User.objects.create_user(
            username=f'editor_normal_{User.objects.count()}', email=f'editor{User.objects.count()}@example.com',
            password='Clave-Segura-123',
        )
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.layout.edit', content_type__app_label='permissions'))
        client = APIClient()
        client.force_authenticate(user=usuario)
        return client

    def test_usuario_normal_recibe_400_al_intentar_editar_un_componente_bloqueado(self):
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['width'] = 6
        version = dl.obtener_o_crear_layout('finanzas').version
        client = self._cliente_normal_con_permiso()
        resp = client.put(
            '/api/v1/dashboards/finanzas/layout',
            data=json.dumps({'version': version, 'components': comps, 'changed_by': 'Tester'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'COMPONENTE_BLOQUEADO')

    def test_superusuario_puede_editar_un_componente_bloqueado(self):
        _agregar_componente_bloqueado('finanzas')
        comps = _payload_actual('finanzas')
        comps[0]['width'] = 6
        version = dl.obtener_o_crear_layout('finanzas').version
        client = _cliente_autenticado()
        resp = client.put(
            '/api/v1/dashboards/finanzas/layout',
            data=json.dumps({'version': version, 'components': comps, 'changed_by': 'Tester'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['components'][0]['width'], 6)
