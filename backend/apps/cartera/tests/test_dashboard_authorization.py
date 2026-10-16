"""Fase 5 de la integración con skelleton_base: protección real de los endpoints de `cartera` y
del endpoint de dashboards autorizados (docs/integracion/decisions.md #6, integration_plan.md).
"""

import os
import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.models import CargaArchivo
from apps.cartera.services.dashboards import crear_dashboard

User = get_user_model()
CARGA_ID_INEXISTENTE = str(uuid.uuid4())
FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'cartera_ejemplo.xlsx')


class ProteccionEndpointsCarteraTests(TestCase):
    def test_sin_token_devuelve_401(self):
        client = APIClient()
        resp = client.get(f'/api/v1/cartera/resumen/{CARGA_ID_INEXISTENTE}')
        self.assertEqual(resp.status_code, 401)

    def test_autenticado_sin_permiso_dashboard_view_devuelve_403(self):
        # Con una carga real (no un id inexistente): el chequeo de acceso por dashboard necesita
        # resolver `carga.dashboard_id`, así que la carga debe existir para poder distinguir "no
        # autorizado" (403) de "no existe" (404) — ver `test_carga_inexistente_devuelve_404`.
        carga = CargaArchivo.objects.create(dashboard_id='cartera', nombre_original='archivo.xlsx')
        client = APIClient()
        usuario = User.objects.create_user(username='sin_permiso', email='sp@example.com', password='Clave-Segura-123')
        client.force_authenticate(user=usuario)
        resp = client.get(f'/api/v1/cartera/resumen/{carga.id}')
        self.assertEqual(resp.status_code, 403)

    def test_carga_inexistente_devuelve_404_incluso_sin_permiso(self):
        client = APIClient()
        usuario = User.objects.create_user(username='sin_permiso2', email='sp3@example.com', password='Clave-Segura-123')
        client.force_authenticate(user=usuario)
        resp = client.get(f'/api/v1/cartera/resumen/{CARGA_ID_INEXISTENTE}')
        self.assertEqual(resp.status_code, 404)

    def test_autenticado_con_permiso_dashboard_view_pasa_la_verificacion(self):
        """Con el permiso concedido, la solicitud ya no se rechaza por autorización — si el
        recurso no existe, la vista sigue su curso normal y responde 404 (no 401 ni 403)."""
        client = APIClient()
        usuario = User.objects.create_user(username='con_permiso', email='cp@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.view', content_type__app_label='permissions'))
        client.force_authenticate(user=usuario)
        resp = client.get(f'/api/v1/cartera/resumen/{CARGA_ID_INEXISTENTE}')
        self.assertEqual(resp.status_code, 404)

    def test_administrador_general_ve_el_dashboard_sin_asignacion_individual(self):
        client = APIClient()
        usuario = User.objects.create_user(username='gerente', email='gerente@example.com', password='Clave-Segura-123')
        usuario.groups.add(Group.objects.get(name='Administrador'))
        client.force_authenticate(user=usuario)
        resp = client.get(f'/api/v1/cartera/resumen/{CARGA_ID_INEXISTENTE}')
        self.assertEqual(resp.status_code, 404)

    def test_endpoint_de_carga_de_archivo_tambien_esta_protegido(self):
        client = APIClient()
        resp = client.post('/api/v1/cartera/validar-archivo', {})
        self.assertEqual(resp.status_code, 401)

    def test_exportar_esta_protegido(self):
        client = APIClient()
        resp = client.get(f'/api/v1/cartera/exportar/{CARGA_ID_INEXISTENTE}')
        self.assertEqual(resp.status_code, 401)


class ValidarArchivoPermisoTests(TestCase):
    """"Cargar otro archivo" tiene su propio permiso (`dashboard.archivo.cargar`), separado de
    `dashboard.view` (antes alcanzaba con poder ver el dashboard) y de
    `dashboard.fuente_bd.configurar` (conectar a la base de datos es una acción distinta)."""

    def _post_archivo(self, client, dashboard_id='cartera'):
        with open(FIXTURE_PATH, 'rb') as f:
            return client.post('/api/v1/cartera/validar-archivo', {'archivo': f, 'dashboard_id': dashboard_id}, format='multipart')

    def test_con_solo_dashboard_view_devuelve_403(self):
        client = APIClient()
        usuario = User.objects.create_user(username='solo_ver_archivo', email='sva@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.view', content_type__app_label='permissions'))
        client.force_authenticate(user=usuario)
        resp = self._post_archivo(client)
        self.assertEqual(resp.status_code, 403)

    def test_con_solo_fuente_bd_configurar_devuelve_403(self):
        client = APIClient()
        usuario = User.objects.create_user(username='solo_fuente_bd', email='sfb@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.fuente_bd.configurar', content_type__app_label='permissions'))
        client.force_authenticate(user=usuario)
        resp = self._post_archivo(client)
        self.assertEqual(resp.status_code, 403)

    def test_con_dashboard_archivo_cargar_pasa_la_verificacion(self):
        client = APIClient()
        usuario = User.objects.create_user(username='con_cargar_archivo', email='cca@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.archivo.cargar', content_type__app_label='permissions'))
        client.force_authenticate(user=usuario)
        resp = self._post_archivo(client)
        self.assertEqual(resp.status_code, 200)

    def test_respeta_el_control_de_acceso_por_dashboard(self):
        """Un editor asignado por ACL a un dashboard puntual puede cargar archivos ahí aunque no
        tenga `dashboard.archivo.cargar` global — mismo criterio que `dashboard.fuente_bd.configurar`."""
        dashboard = crear_dashboard(nombre='Editores archivo')
        editor = Group.objects.create(name='Editores carga archivo')
        dashboard.roles_editores.add(editor)
        usuario = User.objects.create_user(username='editor_acl_archivo', email='eaa@example.com', password='Clave-Segura-123')
        usuario.groups.add(editor)
        client = APIClient()
        client.force_authenticate(user=usuario)
        resp = self._post_archivo(client, dashboard_id=dashboard.dashboard_id)
        self.assertEqual(resp.status_code, 200)


class DashboardsAuthorizedViewTests(TestCase):
    def test_sin_token_devuelve_401(self):
        client = APIClient()
        resp = client.get('/api/v1/dashboards/authorized')
        self.assertEqual(resp.status_code, 401)

    def test_usuario_sin_permiso_no_ve_ningun_dashboard(self):
        client = APIClient()
        usuario = User.objects.create_user(username='sin_permiso', email='sp2@example.com', password='Clave-Segura-123')
        client.force_authenticate(user=usuario)
        resp = client.get('/api/v1/dashboards/authorized')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_usuario_con_dashboard_view_ve_los_dashboards_existentes(self):
        crear_dashboard(nombre='Cobranza', area='Cartera')
        client = APIClient()
        usuario = User.objects.create_user(username='con_permiso', email='cp2@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.view', content_type__app_label='permissions'))
        client.force_authenticate(user=usuario)
        resp = client.get('/api/v1/dashboards/authorized')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{
            'dashboard_id': 'cobranza', 'name': 'Cobranza', 'area': 'Cartera', 'contexto': '', 'puede_administrar_acceso': False,
        }])

    def test_administrador_general_ve_todos_los_dashboards_autorizados(self):
        crear_dashboard(nombre='Cobranza', area='Cartera')
        client = APIClient()
        usuario = User.objects.create_user(username='gerente2', email='gerente2@example.com', password='Clave-Segura-123')
        usuario.groups.add(Group.objects.get(name='Administrador'))
        client.force_authenticate(user=usuario)
        resp = client.get('/api/v1/dashboards/authorized')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{
            'dashboard_id': 'cobranza', 'name': 'Cobranza', 'area': 'Cartera', 'contexto': '', 'puede_administrar_acceso': False,
        }])

    def test_superusuario_ve_todos_los_dashboards(self):
        crear_dashboard(nombre='Cobranza', area='Cartera')
        client = APIClient()
        admin = User.objects.create_superuser(username='admin', email='admin@example.com', password='Clave-Segura-123')
        client.force_authenticate(user=admin)
        resp = client.get('/api/v1/dashboards/authorized')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [{
            'dashboard_id': 'cobranza', 'name': 'Cobranza', 'area': 'Cartera', 'contexto': '', 'puede_administrar_acceso': True,
        }])
