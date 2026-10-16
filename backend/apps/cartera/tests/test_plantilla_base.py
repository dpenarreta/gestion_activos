"""Plantilla base personalizable desde "Configuración → Plantilla base": las 13 posiciones fijas
de todo dashboard, editables (arrastrar/redimensionar/reordenar/recolorear/renombrar/cambiar tipo
de gráfico) bajo el `dashboard_id` reservado `plantilla.DASHBOARD_ID_PLANTILLA_BASE`. Lo que se
guarde ahí es lo que hereda todo dashboard NUEVO de ahí en adelante."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.services import plantilla
from apps.cartera.services.dashboards import _generar_dashboard_id_unico, crear_dashboard

User = get_user_model()


def _usuario(username, **kwargs):
    return User.objects.create_user(username=username, email=f'{username}@example.com', password='Clave-Segura-123', **kwargs)


def _con_permiso(usuario, *codenames):
    for codename in codenames:
        usuario.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label='permissions'))
    return usuario


class SlotsEfectivosTests(TestCase):
    def test_sin_personalizacion_devuelve_los_valores_de_fabrica(self):
        self.assertEqual(plantilla.slots_efectivos(), plantilla.PLANTILLA_SLOTS)

    def test_con_personalizacion_parcial_mezcla_y_respeta_el_nuevo_orden(self):
        plantilla.sembrar_plantilla(plantilla.DASHBOARD_ID_PLANTILLA_BASE)
        layout = plantilla.dashboard_layout.obtener_o_crear_layout(plantilla.DASHBOARD_ID_PLANTILLA_BASE)

        kpi1 = layout.components.get(component_id='kpi-1')
        kpi1.content = {**kpi1.content, 'titulo': 'Ingresos totales'}
        kpi1.styles = {'colorPrincipal': '#ff0000'}
        kpi1.width = 6
        kpi1.order = 14  # se mueve al final (más allá del resto, que sigue en 1..13)
        kpi1.save()

        grafico1 = layout.components.get(component_id='grafico-1')
        grafico1.chart_type = 'pastel'
        grafico1.save()

        efectivos = plantilla.slots_efectivos()
        self.assertEqual(len(efectivos), 13)

        por_id = {s['id']: s for s in efectivos}
        self.assertEqual(por_id['kpi-1']['ancho'], 6)
        self.assertEqual(por_id['kpi-1']['titulo_personalizado'], 'Ingresos totales')
        self.assertEqual(por_id['kpi-1']['color_defecto'], '#ff0000')
        self.assertEqual(por_id['grafico-1']['chart_type'], 'pastel')
        # kpi-1 se movió al final (order=16): debe ser el último de la lista devuelta.
        self.assertEqual(efectivos[-1]['id'], 'kpi-1')
        # calculo/tipo/id nunca se personalizan.
        self.assertEqual(por_id['kpi-1']['calculo'], 'kpi')
        self.assertEqual(por_id['grafico-1']['calculo'], 'chart')


class SembrarPlantillaDesdeBaseTests(TestCase):
    def test_dashboard_nuevo_hereda_la_personalizacion_vigente(self):
        plantilla.sembrar_plantilla(plantilla.DASHBOARD_ID_PLANTILLA_BASE)
        layout_base = plantilla.dashboard_layout.obtener_o_crear_layout(plantilla.DASHBOARD_ID_PLANTILLA_BASE)
        kpi2 = layout_base.components.get(component_id='kpi-2')
        kpi2.content = {**kpi2.content, 'titulo': 'Ganancia neta'}
        kpi2.width = 4
        kpi2.save()

        dashboard = crear_dashboard(nombre='Con plantilla personalizada')

        componente = plantilla.dashboard_layout.componentes_validos(dashboard.dashboard_id)['kpi-2']
        self.assertEqual(componente['content']['titulo'], 'Ganancia neta')
        self.assertEqual(componente['width'], 4)

    def test_sin_personalizacion_un_dashboard_nuevo_sigue_naciendo_en_patron_z(self):
        dashboard = crear_dashboard(nombre='Sin plantilla personalizada')
        componentes = plantilla.dashboard_layout.componentes_validos(dashboard.dashboard_id)
        self.assertEqual(componentes['grafico-3']['order'], 5)
        self.assertEqual(componentes['grafico-3']['width'], 12)


class DashboardIdUnicoReservaSlugTests(TestCase):
    def test_nunca_genera_el_slug_reservado_de_la_plantilla_base(self):
        candidato = _generar_dashboard_id_unico('Plantilla Base Sistema')
        self.assertNotEqual(candidato, plantilla.DASHBOARD_ID_PLANTILLA_BASE)


class PlantillaBaseLayoutViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_get_sin_permiso_devuelve_403(self):
        usuario = _usuario('sin_permiso_pb')
        self.client.force_authenticate(user=usuario)
        resp = self.client.get('/api/v1/cartera/plantilla-base/layout')
        self.assertEqual(resp.status_code, 403)

    def test_get_autoarranca_con_las_13_posiciones_en_patron_z(self):
        usuario = _con_permiso(_usuario('con_ver_pb'), 'configuracion.ver')
        self.client.force_authenticate(user=usuario)
        resp = self.client.get('/api/v1/cartera/plantilla-base/layout')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data['components']), 13)
        ids_en_orden = [c['component_id'] for c in sorted(data['components'], key=lambda c: c['order'])]
        self.assertEqual(ids_en_orden[:5], ['kpi-1', 'kpi-2', 'kpi-3', 'kpi-4', 'grafico-3'])

    def test_put_sin_configuracion_editar_devuelve_403(self):
        usuario = _con_permiso(_usuario('solo_ver_pb'), 'configuracion.ver')
        self.client.force_authenticate(user=usuario)
        resp = self.client.put('/api/v1/cartera/plantilla-base/layout', {'version': 1, 'components': []}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_put_con_configuracion_editar_persiste_los_cambios(self):
        usuario = _con_permiso(_usuario('con_editar_pb'), 'configuracion.ver', 'configuracion.editar')
        self.client.force_authenticate(user=usuario)

        actual = self.client.get('/api/v1/cartera/plantilla-base/layout').json()
        componentes = actual['components']
        for c in componentes:
            if c['component_id'] == 'kpi-3':
                c['content'] = {**c['content'], 'titulo': 'Clientes activos'}

        resp = self.client.put(
            '/api/v1/cartera/plantilla-base/layout',
            {'version': actual['version'], 'components': componentes}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        kpi3 = next(c for c in resp.json()['components'] if c['component_id'] == 'kpi-3')
        self.assertEqual(kpi3['content']['titulo'], 'Clientes activos')

    def test_put_con_version_desactualizada_devuelve_409(self):
        usuario = _con_permiso(_usuario('con_editar_pb2'), 'configuracion.ver', 'configuracion.editar')
        self.client.force_authenticate(user=usuario)
        self.client.get('/api/v1/cartera/plantilla-base/layout')
        resp = self.client.put('/api/v1/cartera/plantilla-base/layout', {'version': 999, 'components': []}, format='json')
        self.assertEqual(resp.status_code, 409)


class PlantillaBaseResetViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_reset_sin_permiso_devuelve_403(self):
        usuario = _con_permiso(_usuario('sin_editar_reset'), 'configuracion.ver')
        self.client.force_authenticate(user=usuario)
        resp = self.client.post('/api/v1/cartera/plantilla-base/reset')
        self.assertEqual(resp.status_code, 403)

    def test_reset_vuelve_a_los_valores_de_fabrica(self):
        usuario = _con_permiso(_usuario('con_editar_reset'), 'configuracion.ver', 'configuracion.editar')
        self.client.force_authenticate(user=usuario)

        actual = self.client.get('/api/v1/cartera/plantilla-base/layout').json()
        componentes = actual['components']
        for c in componentes:
            if c['component_id'] == 'kpi-1':
                c['width'] = 8
        self.client.put('/api/v1/cartera/plantilla-base/layout', {'version': actual['version'], 'components': componentes}, format='json')

        resp = self.client.post('/api/v1/cartera/plantilla-base/reset')
        self.assertEqual(resp.status_code, 200)
        kpi1 = next(c for c in resp.json()['components'] if c['component_id'] == 'kpi-1')
        self.assertEqual(kpi1['width'], 3)
