"""Control de acceso por dashboard: 2 grupos de roles (`roles_editores` puede ver y editar,
`roles_lectores` solo puede ver) más un dueño reasignable por un superusuario. Un dashboard sin
ningún rol asignado en ninguno de los 2 grupos no tiene ACL activa: se sigue autorizando por el
permiso global de siempre (`cartera/permisos.py::tiene_acceso_dashboard`) — verificado acá mismo
como caso de regresión."""

import json

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.cartera.compat import AuditEvent
from apps.cartera.tests.auditoria import eventos
from apps.cartera.models import Dashboard
from apps.cartera.services.dashboards import crear_dashboard

User = get_user_model()


def _usuario(username, **kwargs):
    return User.objects.create_user(username=username, email=f'{username}@example.com', password='Clave-Segura-123', **kwargs)


def _con_permiso(usuario, *codenames):
    for codename in codenames:
        usuario.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label='permissions'))
    return usuario


class AccesoPorAclTests(TestCase):
    """Ejercita `permisos.tiene_acceso_dashboard` a través de `GET`/`PUT /layout` — endpoints
    representativos de "ver" y "editar" respectivamente."""

    def setUp(self):
        self.client = APIClient()
        self.raiz = crear_dashboard(nombre='Cartera')  # sin creado_por -> sin dueño

    def _get_layout(self, usuario):
        self.client.force_authenticate(user=usuario)
        return self.client.get(f'/api/v1/dashboards/{self.raiz.dashboard_id}/layout')

    def _put_layout(self, usuario):
        self.client.force_authenticate(user=usuario)
        resp_get = self.client.get(f'/api/v1/dashboards/{self.raiz.dashboard_id}/layout')
        version = resp_get.json().get('version', 1)
        return self.client.put(
            f'/api/v1/dashboards/{self.raiz.dashboard_id}/layout',
            {'version': version, 'components': []}, format='json',
        )

    def test_sin_acl_el_permiso_global_alcanza_para_ver(self):
        usuario = _con_permiso(_usuario('con_view'), 'dashboard.view')
        self.assertEqual(self._get_layout(usuario).status_code, 200)

    def test_sin_acl_el_permiso_global_alcanza_para_editar(self):
        usuario = _con_permiso(_usuario('con_edit'), 'dashboard.view', 'dashboard.layout.edit')
        self.assertEqual(self._put_layout(usuario).status_code, 200)

    def test_con_acl_el_permiso_global_ya_no_alcanza(self):
        self.raiz.roles_lectores.add(Group.objects.create(name='Lectores acceso 1'))
        usuario = _con_permiso(_usuario('con_view_pero_fuera'), 'dashboard.view')
        self.assertEqual(self._get_layout(usuario).status_code, 403)

    def test_con_acl_el_dueno_ve_y_edita(self):
        self.raiz.owner = _usuario('dueno1')
        self.raiz.save(update_fields=['owner'])
        self.raiz.roles_lectores.add(Group.objects.create(name='Lectores acceso 2'))
        self.assertEqual(self._get_layout(self.raiz.owner).status_code, 200)
        self.assertEqual(self._put_layout(self.raiz.owner).status_code, 200)

    def test_con_acl_el_superusuario_ve_y_edita(self):
        self.raiz.roles_lectores.add(Group.objects.create(name='Lectores acceso 3'))
        admin = User.objects.create_superuser(username='admin_acl', email='admin_acl@example.com', password='Clave-Segura-123')
        self.assertEqual(self._get_layout(admin).status_code, 200)
        self.assertEqual(self._put_layout(admin).status_code, 200)

    def test_con_acl_rol_editor_ve_y_edita(self):
        grupo = Group.objects.create(name='Editores acceso 1')
        self.raiz.roles_editores.add(grupo)
        usuario = _usuario('editor1')
        usuario.groups.add(grupo)
        self.assertEqual(self._get_layout(usuario).status_code, 200)
        self.assertEqual(self._put_layout(usuario).status_code, 200)

    def test_con_acl_rol_lector_ve_pero_no_edita(self):
        grupo = Group.objects.create(name='Lectores acceso 4')
        self.raiz.roles_lectores.add(grupo)
        usuario = _usuario('lector1')
        usuario.groups.add(grupo)
        self.assertEqual(self._get_layout(usuario).status_code, 200)
        self.assertEqual(self._put_layout(usuario).status_code, 403)

    def test_con_acl_usuario_ajeno_no_ve(self):
        self.raiz.roles_lectores.add(Group.objects.create(name='Lectores acceso 5'))
        usuario = _usuario('ajeno1')
        self.assertEqual(self._get_layout(usuario).status_code, 403)


class DashboardAccesoViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.dueno = _usuario('dueno_view')
        self.raiz = crear_dashboard(nombre='Cartera', creado_por=self.dueno)
        self.editor = Group.objects.create(name='Editores vista 1')
        self.lector = Group.objects.create(name='Lectores vista 1')

    def test_get_devuelve_el_estado_actual(self):
        self.raiz.roles_editores.add(self.editor)
        self.raiz.roles_lectores.add(self.lector)
        self.client.force_authenticate(user=self.dueno)
        resp = self.client.get(f'/api/v1/dashboards/{self.raiz.dashboard_id}/acceso')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['owner'], {'id': self.dueno.id, 'username': self.dueno.username})
        self.assertEqual([r['id'] for r in data['roles_editores']], [self.editor.id])
        self.assertEqual([r['id'] for r in data['roles_lectores']], [self.lector.id])

    def test_put_por_el_dueno_actualiza_los_roles(self):
        self.client.force_authenticate(user=self.dueno)
        resp = self.client.put(
            f'/api/v1/dashboards/{self.raiz.dashboard_id}/acceso',
            {'roles_editores': [self.editor.id], 'roles_lectores': [self.lector.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.raiz.refresh_from_db()
        self.assertEqual(list(self.raiz.roles_editores.values_list('id', flat=True)), [self.editor.id])
        self.assertEqual(list(self.raiz.roles_lectores.values_list('id', flat=True)), [self.lector.id])

    def test_superusuario_tambien_puede_actualizar_el_acceso(self):
        admin = User.objects.create_superuser(username='admin_view', email='admin_view@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=admin)
        resp = self.client.put(
            f'/api/v1/dashboards/{self.raiz.dashboard_id}/acceso',
            {'roles_editores': [self.editor.id], 'roles_lectores': []}, format='json',
        )
        self.assertEqual(resp.status_code, 200)

    def test_put_por_quien_no_es_dueno_ni_superusuario_devuelve_403(self):
        # Con el permiso global dashboard.editar, pero sin ser dueño ni superusuario.
        usuario = _con_permiso(_usuario('con_editar_global'), 'dashboard.editar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.put(
            f'/api/v1/dashboards/{self.raiz.dashboard_id}/acceso',
            {'roles_editores': [self.editor.id], 'roles_lectores': []}, format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_put_con_rol_repetido_en_ambos_grupos_devuelve_400(self):
        self.client.force_authenticate(user=self.dueno)
        resp = self.client.put(
            f'/api/v1/dashboards/{self.raiz.dashboard_id}/acceso',
            {'roles_editores': [self.editor.id], 'roles_lectores': [self.editor.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'ROL_DUPLICADO')

    def test_put_con_rol_inexistente_devuelve_400(self):
        self.client.force_authenticate(user=self.dueno)
        resp = self.client.put(
            f'/api/v1/dashboards/{self.raiz.dashboard_id}/acceso',
            {'roles_editores': [999999], 'roles_lectores': []}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'ROL_NO_ENCONTRADO')


class DashboardDuenoViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.dueno = _usuario('dueno_reasignar')
        self.raiz = crear_dashboard(nombre='Cartera', creado_por=self.dueno)
        self.nuevo_dueno = _usuario('nuevo_dueno')

    def test_superusuario_reasigna_el_dueno(self):
        admin = User.objects.create_superuser(username='admin_dueno', email='admin_dueno@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=admin)
        resp = self.client.patch(f'/api/v1/dashboards/{self.raiz.dashboard_id}/dueno', {'owner_id': self.nuevo_dueno.id}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['owner'], {'id': self.nuevo_dueno.id, 'username': self.nuevo_dueno.username})
        self.raiz.refresh_from_db()
        self.assertEqual(self.raiz.owner_id, self.nuevo_dueno.id)

    def test_el_dueno_actual_no_puede_reasignar_por_si_mismo(self):
        self.client.force_authenticate(user=self.dueno)
        resp = self.client.patch(f'/api/v1/dashboards/{self.raiz.dashboard_id}/dueno', {'owner_id': self.nuevo_dueno.id}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_reasignar_a_null_desasigna_el_dueno(self):
        admin = User.objects.create_superuser(username='admin_dueno2', email='admin_dueno2@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=admin)
        resp = self.client.patch(f'/api/v1/dashboards/{self.raiz.dashboard_id}/dueno', {'owner_id': None}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['owner'])

    def test_usuario_inexistente_devuelve_400(self):
        admin = User.objects.create_superuser(username='admin_dueno3', email='admin_dueno3@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=admin)
        resp = self.client.patch(f'/api/v1/dashboards/{self.raiz.dashboard_id}/dueno', {'owner_id': 999999}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'USUARIO_NO_ENCONTRADO')


class DashboardsAutorizadosConAclTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.raiz = crear_dashboard(nombre='Restringido')

    def test_rol_asignado_sin_permiso_global_ve_el_dashboard_en_la_lista(self):
        grupo = Group.objects.create(name='Lectores lista 1')
        self.raiz.roles_lectores.add(grupo)
        usuario = _usuario('solo_rol')
        usuario.groups.add(grupo)
        self.client.force_authenticate(user=usuario)
        resp = self.client.get('/api/v1/dashboards/authorized')
        ids = [d['dashboard_id'] for d in resp.json()]
        self.assertIn(self.raiz.dashboard_id, ids)

    def test_permiso_global_sin_rol_asignado_deja_de_ver_un_dashboard_restringido(self):
        grupo = Group.objects.create(name='Lectores lista 2')
        self.raiz.roles_lectores.add(grupo)
        usuario = _con_permiso(_usuario('solo_global'), 'dashboard.view')
        self.client.force_authenticate(user=usuario)
        resp = self.client.get('/api/v1/dashboards/authorized')
        ids = [d['dashboard_id'] for d in resp.json()]
        self.assertNotIn(self.raiz.dashboard_id, ids)

    def test_puede_administrar_acceso_en_la_lista(self):
        # Sin ACL configurada, el dueño igual necesita `dashboard.view` global para verlo en la
        # lista (comportamiento sin cambios respecto a hoy) — `puede_administrar_acceso` es
        # independiente de eso, refleja únicamente si puede editar el ACL en sí.
        dueno = _con_permiso(_usuario('dueno_lista'), 'dashboard.view')
        raiz_con_dueno = crear_dashboard(nombre='Con dueño', creado_por=dueno)
        otro = _con_permiso(_usuario('otro_lista'), 'dashboard.view')

        self.client.force_authenticate(user=dueno)
        resp = self.client.get('/api/v1/dashboards/authorized')
        item = next(d for d in resp.json() if d['dashboard_id'] == raiz_con_dueno.dashboard_id)
        self.assertTrue(item['puede_administrar_acceso'])

        self.client.force_authenticate(user=otro)
        resp = self.client.get('/api/v1/dashboards/authorized')
        item = next(d for d in resp.json() if d['dashboard_id'] == raiz_con_dueno.dashboard_id)
        self.assertFalse(item['puede_administrar_acceso'])


class CorreccionesDeSeguridadTests(TestCase):
    """Hallazgos SEC-08, SEC-09 y SEC-13 de la revisión de seguridad."""

    def setUp(self):
        self.dashboard = Dashboard.objects.create(dashboard_id='finanzas', name='Finanzas', area='Finanzas')
        self.rol_ajeno = Group.objects.create(name='SOLO_OTROS')
        self.usuario = User.objects.create_user(
            username='pepe', email='pepe@example.com', password='Clave-Segura-123',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.usuario)

    def _otorgar(self, *codenames):
        for codename in codenames:
            self.usuario.user_permissions.add(
                Permission.objects.get(codename=codename, content_type__app_label='permissions'),
            )

    # --- SEC-08 -------------------------------------------------------------------------------
    def test_eliminar_respeta_la_acl_del_dashboard(self):
        """Antes `delete` consultaba solo el permiso global, así que la ACL no protegía justo la
        acción más destructiva."""
        self._otorgar('dashboard.eliminar', 'dashboard.view')
        # ACL configurada que NO incluye a este usuario.
        self.dashboard.roles_editores.add(self.rol_ajeno)

        resp = self.client.delete(
            '/api/v1/dashboards/finanzas/', data=json.dumps({'confirmation_name': 'Finanzas'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Dashboard.objects.filter(dashboard_id='finanzas').exists())

    def test_editar_respeta_la_acl_del_dashboard(self):
        self._otorgar('dashboard.editar', 'dashboard.view')
        self.dashboard.roles_editores.add(self.rol_ajeno)

        resp = self.client.patch(
            '/api/v1/dashboards/finanzas/', data=json.dumps({'name': 'Secuestrado'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)
        self.dashboard.refresh_from_db()
        self.assertEqual(self.dashboard.name, 'Finanzas')

    def test_un_editor_de_la_acl_si_puede_eliminar(self):
        """La corrección no rompe el camino legítimo."""
        self._otorgar('dashboard.eliminar', 'dashboard.view')
        rol_propio = Group.objects.create(name='EDITORES_FINANZAS')
        self.dashboard.roles_editores.add(rol_propio)
        self.usuario.groups.add(rol_propio)

        resp = self.client.delete(
            '/api/v1/dashboards/finanzas/', data=json.dumps({'confirmation_name': 'Finanzas'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 204)

    # --- SEC-13 -------------------------------------------------------------------------------
    def test_un_acceso_denegado_a_un_dashboard_queda_auditado(self):
        """Antes los rechazos de `cartera` no escribían ningún `AuditEvent`, así que un sondeo de
        dashboards ajenos no aparecía en ninguna pantalla."""
        self.dashboard.roles_lectores.add(self.rol_ajeno)

        resp = self.client.get('/api/v1/dashboards/finanzas/layout')
        self.assertEqual(resp.status_code, 403)

        evento = eventos.filter(
            domain=AuditEvent.Domain.SECURITY, action='ACCESS_DENIED', dashboard_id='finanzas',
        ).first()
        self.assertIsNotNone(evento)
        self.assertEqual(evento.result, AuditEvent.Result.DENIED)
        self.assertEqual(evento.actor_id, self.usuario.id)
        self.assertEqual(evento.metadata['required_permission'], 'dashboard.view')


class ConsultasDelListadoTests(TestCase):
    """El listado de dashboards autorizados no debe escalar en consultas con la cantidad de
    dashboards.

    Antes eran ~5 por dashboard: `tiene_acceso_dashboard` y `puede_administrar_acceso` volvían a
    hacer `Dashboard.objects.get(...)` cada una sobre un objeto que el bucle ya tenía cargado, más
    los `exists()` de la ACL y una subconsulta de pertenencia a grupos.
    """

    def setUp(self):
        self.usuario = User.objects.create_superuser(
            username='admin', email='admin@example.com', password='Clave-Segura-123',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.usuario)

    def _consultas_para(self, cantidad):
        Dashboard.objects.all().delete()
        for i in range(cantidad):
            Dashboard.objects.create(dashboard_id=f'd{i}', name=f'D{i}', area='A')
        with CaptureQueriesContext(connection) as capturadas:
            resp = self.client.get('/api/v1/dashboards/authorized')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), cantidad)
        return len(capturadas)

    def test_el_numero_de_consultas_no_crece_con_la_cantidad_de_dashboards(self):
        con_2 = self._consultas_para(2)
        con_10 = self._consultas_para(10)
        self.assertEqual(
            con_2, con_10,
            f'El listado hizo {con_2} consultas con 2 dashboards y {con_10} con 10 — hay un N+1.',
        )
