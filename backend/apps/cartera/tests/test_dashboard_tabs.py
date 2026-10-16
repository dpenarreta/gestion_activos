"""Pestañas dentro de un mismo dashboard: cada pestaña es un `Dashboard` independiente más (su
propia plantilla de 13 posiciones, su propio archivo), enlazado a una raíz por `Dashboard.parent`.
Máximo 5 pestañas por familia (la raíz cuenta como la primera)."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.exceptions import CarteraError
from apps.cartera.models import CargaArchivo, Dashboard, DashboardComponent, DashboardLayout
from apps.cartera.services import plantilla
from apps.cartera.services.dashboards import actualizar_dashboard, crear_dashboard, crear_pestana, eliminar_dashboard, listar_pestanas

User = get_user_model()


class CrearPestanaServiceTests(TestCase):
    def test_crea_pestana_ligada_a_la_raiz_con_el_siguiente_orden(self):
        raiz = crear_dashboard(nombre='Cartera')
        pestana = crear_pestana(raiz.dashboard_id, nombre='Vista regional')
        self.assertEqual(pestana.parent_id, raiz.id)
        self.assertEqual(pestana.orden, 2)
        self.assertEqual(pestana.name, 'Vista regional')

    def test_segunda_pestana_toma_el_siguiente_orden(self):
        raiz = crear_dashboard(nombre='Cartera')
        crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')
        tercera = crear_pestana(raiz.dashboard_id, nombre='Pestaña 3')
        self.assertEqual(tercera.orden, 3)

    def test_bloquea_al_llegar_al_maximo_de_5_pestanas(self):
        raiz = crear_dashboard(nombre='Cartera')
        for i in range(3):
            crear_pestana(raiz.dashboard_id, nombre=f'Pestaña {i + 2}')
        # Ya hay 4 en la familia (raíz + 3) -> la 5ta se permite, la 6ta no.
        crear_pestana(raiz.dashboard_id, nombre='Pestaña 5')
        with self.assertRaises(CarteraError) as ctx:
            crear_pestana(raiz.dashboard_id, nombre='Pestaña 6')
        self.assertEqual(ctx.exception.codigo, 'MAXIMO_PESTANAS_ALCANZADO')

    def test_crear_desde_una_pestana_no_raiz_la_cuelga_de_la_raiz(self):
        raiz = crear_dashboard(nombre='Cartera')
        pestana_2 = crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')
        pestana_3 = crear_pestana(pestana_2.dashboard_id, nombre='Pestaña 3')
        self.assertEqual(pestana_3.parent_id, raiz.id)
        self.assertEqual(pestana_3.orden, 3)

    def test_la_pestana_nace_con_su_propia_plantilla_de_13_posiciones(self):
        raiz = crear_dashboard(nombre='Cartera')
        pestana = crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')
        componentes = DashboardComponent.objects.filter(layout__dashboard_id=pestana.dashboard_id)
        self.assertEqual(componentes.count(), len(plantilla.PLANTILLA_SLOTS))

    def test_hereda_el_area_de_la_raiz(self):
        raiz = crear_dashboard(nombre='Cartera', area='Finanzas')
        pestana = crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')
        self.assertEqual(pestana.area, 'Finanzas')


class ListarPestanasServiceTests(TestCase):
    def test_sin_pestanas_adicionales_devuelve_solo_la_raiz(self):
        raiz = crear_dashboard(nombre='Cartera', area='Finanzas')
        self.assertEqual(listar_pestanas(raiz.dashboard_id), [
            {'dashboard_id': raiz.dashboard_id, 'name': 'Cartera', 'orden': 1, 'area': 'Finanzas'},
        ])

    def test_con_pestanas_devuelve_la_familia_completa_ordenada(self):
        raiz = crear_dashboard(nombre='Cartera', area='Finanzas')
        p2 = crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')
        p3 = crear_pestana(raiz.dashboard_id, nombre='Pestaña 3')
        self.assertEqual(listar_pestanas(raiz.dashboard_id), [
            {'dashboard_id': raiz.dashboard_id, 'name': 'Cartera', 'orden': 1, 'area': 'Finanzas'},
            {'dashboard_id': p2.dashboard_id, 'name': 'Pestaña 2', 'orden': 2, 'area': 'Finanzas'},
            {'dashboard_id': p3.dashboard_id, 'name': 'Pestaña 3', 'orden': 3, 'area': 'Finanzas'},
        ])

    def test_funciona_llamado_desde_cualquier_miembro_de_la_familia(self):
        raiz = crear_dashboard(nombre='Cartera')
        p2 = crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')
        self.assertEqual(listar_pestanas(p2.dashboard_id), listar_pestanas(raiz.dashboard_id))


class RenombrarPestanaTests(TestCase):
    def test_renombrar_una_pestana_no_afecta_a_la_raiz_ni_a_otras_pestanas(self):
        raiz = crear_dashboard(nombre='Cartera', area='Finanzas')
        p2 = crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')

        actualizar_dashboard(p2.dashboard_id, nombre='Vista regional', area=p2.area)

        self.assertEqual(listar_pestanas(raiz.dashboard_id), [
            {'dashboard_id': raiz.dashboard_id, 'name': 'Cartera', 'orden': 1, 'area': 'Finanzas'},
            {'dashboard_id': p2.dashboard_id, 'name': 'Vista regional', 'orden': 2, 'area': 'Finanzas'},
        ])


class EliminarDashboardConPestanasTests(TestCase):
    def test_eliminar_la_raiz_borra_tambien_las_pestanas_y_sus_datos(self):
        raiz = crear_dashboard(nombre='Cartera')
        pestana = crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')
        CargaArchivo.objects.create(dashboard_id=pestana.dashboard_id, nombre_original='datos.xlsx')

        eliminar_dashboard(raiz.dashboard_id, confirmacion_nombre='Cartera')

        self.assertFalse(Dashboard.objects.filter(dashboard_id=raiz.dashboard_id).exists())
        self.assertFalse(Dashboard.objects.filter(dashboard_id=pestana.dashboard_id).exists())
        self.assertFalse(CargaArchivo.objects.filter(dashboard_id=pestana.dashboard_id).exists())
        self.assertFalse(DashboardLayout.objects.filter(dashboard_id=pestana.dashboard_id).exists())


class DashboardsAutorizadosSinPestanasTests(TestCase):
    def test_las_pestanas_no_aparecen_como_dashboards_sueltos(self):
        raiz = crear_dashboard(nombre='Cartera')
        crear_pestana(raiz.dashboard_id, nombre='Pestaña 2')

        client = APIClient()
        usuario = User.objects.create_user(username='con_permiso3', email='cp3@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.view', content_type__app_label='permissions'))
        client.force_authenticate(user=usuario)

        resp = client.get('/api/v1/dashboards/authorized')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{
            'dashboard_id': raiz.dashboard_id, 'name': 'Cartera', 'area': '', 'contexto': '', 'puede_administrar_acceso': False,
        }])


class DashboardTabsViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.raiz = crear_dashboard(nombre='Cartera')

    def _usuario_con(self, *codenames, username):
        usuario = User.objects.create_user(username=username, email=f'{username}@example.com', password='Clave-Segura-123')
        for codename in codenames:
            usuario.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label='permissions'))
        return usuario

    def test_get_sin_permiso_devuelve_403(self):
        usuario = self._usuario_con(username='sin_ver')
        self.client.force_authenticate(user=usuario)
        resp = self.client.get(f'/api/v1/dashboards/{self.raiz.dashboard_id}/pestanas')
        self.assertEqual(resp.status_code, 403)

    def test_get_devuelve_la_familia(self):
        usuario = self._usuario_con('dashboard.view', username='con_ver')
        self.client.force_authenticate(user=usuario)
        resp = self.client.get(f'/api/v1/dashboards/{self.raiz.dashboard_id}/pestanas')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{'dashboard_id': self.raiz.dashboard_id, 'name': 'Cartera', 'orden': 1, 'area': ''}])

    def test_post_sin_permiso_devuelve_403(self):
        usuario = self._usuario_con(username='sin_crear')
        self.client.force_authenticate(user=usuario)
        resp = self.client.post(f'/api/v1/dashboards/{self.raiz.dashboard_id}/pestanas', {'name': 'Pestaña 2'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_post_con_permiso_crea_la_pestana(self):
        usuario = self._usuario_con('dashboard.crear', username='con_crear')
        self.client.force_authenticate(user=usuario)
        resp = self.client.post(f'/api/v1/dashboards/{self.raiz.dashboard_id}/pestanas', {'name': 'Pestaña 2'}, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['name'], 'Pestaña 2')
        self.assertEqual(data['orden'], 2)
        self.assertTrue(Dashboard.objects.filter(dashboard_id=data['dashboard_id'], parent=self.raiz).exists())

    def test_post_en_el_maximo_devuelve_400(self):
        usuario = self._usuario_con('dashboard.crear', username='con_crear2')
        self.client.force_authenticate(user=usuario)
        for i in range(4):
            resp = self.client.post(f'/api/v1/dashboards/{self.raiz.dashboard_id}/pestanas', {'name': f'Pestaña {i + 2}'}, format='json')
            self.assertEqual(resp.status_code, 201)

        resp = self.client.post(f'/api/v1/dashboards/{self.raiz.dashboard_id}/pestanas', {'name': 'Pestaña 6'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'MAXIMO_PESTANAS_ALCANZADO')
