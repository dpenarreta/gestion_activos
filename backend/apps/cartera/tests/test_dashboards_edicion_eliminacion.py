"""Edición (nombre/área) y eliminación (con confirmación de nombre) de dashboards por área."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.compat import AuditEvent
from apps.cartera.tests.auditoria import eventos
from apps.cartera.exceptions import CarteraError
from apps.cartera.models import CargaArchivo, ColumnaHistorica, Dashboard, DashboardComponent, FilaArchivoHistorico
from apps.cartera.services import dashboard_layout as dl
from apps.cartera.services import historico
from apps.cartera.services.dashboards import (
    actualizar_dashboard, actualizar_fuente_bd, borrar_datos_dashboard, crear_dashboard, eliminar_dashboard,
)

User = get_user_model()


class ActualizarDashboardServiceTests(TestCase):
    def test_actualiza_nombre_y_area(self):
        dashboard = crear_dashboard(nombre='Finanzas', area='Finanzas')
        actualizado = actualizar_dashboard(dashboard.dashboard_id, nombre='Finanzas y Contabilidad', area='FyC')
        self.assertEqual(actualizado.name, 'Finanzas y Contabilidad')
        self.assertEqual(actualizado.area, 'FyC')
        # El dashboard_id (slug) no cambia al editar, solo nombre/área.
        self.assertEqual(actualizado.dashboard_id, 'finanzas')

    def test_actualiza_el_contexto_para_la_ia(self):
        dashboard = crear_dashboard(nombre='Finanzas')
        actualizado = actualizar_dashboard(dashboard.dashboard_id, nombre='Finanzas', contexto='Datos de facturación mensual.')
        self.assertEqual(actualizado.contexto, 'Datos de facturación mensual.')

    def test_dashboard_inexistente_es_rechazado(self):
        with self.assertRaises(CarteraError) as ctx:
            actualizar_dashboard('no-existe', nombre='X')
        self.assertEqual(ctx.exception.codigo, 'DASHBOARD_NO_ENCONTRADO')

    def test_nombre_vacio_es_rechazado(self):
        dashboard = crear_dashboard(nombre='Logística')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_dashboard(dashboard.dashboard_id, nombre='   ')
        self.assertEqual(ctx.exception.codigo, 'NOMBRE_REQUERIDO')

    def test_registra_auditoria_con_valores_anteriores_y_nuevos(self):
        usuario = User.objects.create_user(username='ana', email='ana@example.com', password='Clave-Segura-123')
        dashboard = crear_dashboard(nombre='Talento Humano', area='RRHH')
        actualizar_dashboard(dashboard.dashboard_id, nombre='Talento Humano y Nómina', area='RRHH', actor=usuario)
        evento = eventos.get(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_UPDATED', dashboard_id=dashboard.dashboard_id,
        )
        self.assertEqual(evento.previous_values, {'name': 'Talento Humano', 'area': 'RRHH'})
        self.assertEqual(evento.new_values, {'name': 'Talento Humano y Nómina', 'area': 'RRHH'})
        self.assertEqual(evento.actor, usuario)


class EliminarDashboardServiceTests(TestCase):
    def test_elimina_con_confirmacion_correcta(self):
        dashboard = crear_dashboard(nombre='Comercial')
        eliminar_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')
        self.assertFalse(Dashboard.objects.filter(dashboard_id='comercial').exists())

    def test_confirmacion_incorrecta_no_elimina(self):
        dashboard = crear_dashboard(nombre='Comercial')
        with self.assertRaises(CarteraError) as ctx:
            eliminar_dashboard(dashboard.dashboard_id, confirmacion_nombre='comercial mal escrito')
        self.assertEqual(ctx.exception.codigo, 'CONFIRMACION_INVALIDA')
        self.assertTrue(Dashboard.objects.filter(dashboard_id='comercial').exists())

    def test_elimina_tambien_las_cargas_de_archivo_asociadas(self):
        dashboard = crear_dashboard(nombre='Comercial')
        CargaArchivo.objects.create(dashboard_id=dashboard.dashboard_id, nombre_original='datos.xlsx')
        eliminar_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')
        self.assertFalse(CargaArchivo.objects.filter(dashboard_id='comercial').exists())

    def test_registra_auditoria_con_los_valores_eliminados(self):
        usuario = User.objects.create_user(username='ana2', email='ana2@example.com', password='Clave-Segura-123')
        dashboard = crear_dashboard(nombre='Logística', area='Operaciones')
        eliminar_dashboard(dashboard.dashboard_id, confirmacion_nombre='Logística', actor=usuario)
        evento = eventos.get(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_DELETED', dashboard_id='logistica',
        )
        self.assertEqual(evento.previous_values, {'name': 'Logística', 'area': 'Operaciones'})
        self.assertEqual(evento.actor, usuario)


class DashboardDetailViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _usuario_con(self, *codenames, username):
        usuario = User.objects.create_user(username=username, email=f'{username}@example.com', password='Clave-Segura-123')
        for codename in codenames:
            usuario.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label='permissions'))
        return usuario

    def test_patch_sin_permiso_devuelve_403(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con(username='sin_editar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.patch(f'/api/v1/dashboards/{dashboard.dashboard_id}/', {'name': 'Ventas Nacionales'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_patch_con_permiso_actualiza(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.editar', username='con_editar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.patch(f'/api/v1/dashboards/{dashboard.dashboard_id}/', {'name': 'Ventas Nacionales', 'area': 'Comercial'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], 'Ventas Nacionales')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.name, 'Ventas Nacionales')

    def test_patch_actualiza_el_contexto(self):
        dashboard = crear_dashboard(nombre='Ventas', contexto='Original.')
        usuario = self._usuario_con('dashboard.editar', username='con_editar_contexto')
        self.client.force_authenticate(user=usuario)
        resp = self.client.patch(
            f'/api/v1/dashboards/{dashboard.dashboard_id}/', {'name': 'Ventas', 'contexto': 'Nuevo contexto para la IA.'}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['contexto'], 'Nuevo contexto para la IA.')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.contexto, 'Nuevo contexto para la IA.')

    def test_delete_sin_permiso_devuelve_403(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con(username='sin_eliminar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.delete(f'/api/v1/dashboards/{dashboard.dashboard_id}/', {'confirmation_name': 'Ventas'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_delete_con_permiso_y_confirmacion_correcta_elimina(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.eliminar', username='con_eliminar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.delete(f'/api/v1/dashboards/{dashboard.dashboard_id}/', {'confirmation_name': 'Ventas'}, format='json')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Dashboard.objects.filter(dashboard_id='ventas').exists())

    def test_delete_con_confirmacion_incorrecta_devuelve_400(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.eliminar', username='con_eliminar2')
        self.client.force_authenticate(user=usuario)
        resp = self.client.delete(f'/api/v1/dashboards/{dashboard.dashboard_id}/', {'confirmation_name': 'otro nombre'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(Dashboard.objects.filter(dashboard_id='ventas').exists())


class BorrarDatosDashboardServiceTests(TestCase):
    def test_confirmacion_incorrecta_no_borra_nada(self):
        dashboard = crear_dashboard(nombre='Comercial')
        CargaArchivo.objects.create(dashboard_id=dashboard.dashboard_id, nombre_original='datos.xlsx')
        with self.assertRaises(CarteraError) as ctx:
            borrar_datos_dashboard(dashboard.dashboard_id, confirmacion_nombre='comercial mal escrito')
        self.assertEqual(ctx.exception.codigo, 'CONFIRMACION_INVALIDA')
        self.assertTrue(CargaArchivo.objects.filter(dashboard_id=dashboard.dashboard_id).exists())

    def test_borra_las_cargas_de_archivo_y_su_historico(self):
        dashboard = crear_dashboard(nombre='Comercial')
        carga = CargaArchivo.objects.create(dashboard_id=dashboard.dashboard_id, nombre_original='datos.xlsx')
        FilaArchivoHistorico.objects.create(carga=carga, orden=1, datos={'Saldo': 100})
        historico.establecer_columnas_historicas(dashboard.dashboard_id, ['Saldo'])

        borrar_datos_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')

        self.assertFalse(CargaArchivo.objects.filter(dashboard_id=dashboard.dashboard_id).exists())
        self.assertFalse(FilaArchivoHistorico.objects.filter(carga_id=carga.id).exists())
        self.assertFalse(ColumnaHistorica.objects.filter(dashboard_id=dashboard.dashboard_id).exists())

    def test_borra_la_fuente_de_base_de_datos_configurada(self):
        dashboard = crear_dashboard(nombre='Comercial')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x',
            parametros={'FechaCorte': '2026-07-31'}, frecuencia_actualizacion='semanal',
        )

        borrar_datos_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')

        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_tipo, '')
        self.assertEqual(dashboard.fuente_bd_nombre, '')
        self.assertEqual(dashboard.fuente_bd_parametros, {})
        self.assertEqual(dashboard.fuente_bd_fecha_formato, Dashboard.FuenteBDFechaFormato.ISO)
        self.assertEqual(dashboard.fuente_bd_frecuencia_actualizacion, '')
        self.assertIsNone(dashboard.fuente_bd_fecha_configuracion)
        self.assertIsNone(dashboard.fuente_bd_ultima_actualizacion_automatica)
        self.assertEqual(dashboard.fuente_bd_ultimo_mapeo, {})
        self.assertEqual(dashboard.fuente_bd_ultimo_aliases, {})

    def test_borra_los_componentes_de_zona_personal(self):
        dashboard = crear_dashboard(nombre='Comercial')
        dl.agregar_componente_presentacional(dashboard.dashboard_id, DashboardComponent.Tipo.TITLE, zona='personal')

        borrar_datos_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')

        self.assertFalse(
            DashboardComponent.objects.filter(
                layout__dashboard_id=dashboard.dashboard_id, config__zona='personal',
            ).exists(),
        )

    def test_vuelve_a_sembrar_las_posiciones_fijas_con_datos_ficticios(self):
        dashboard = crear_dashboard(nombre='Comercial')
        layout = dl.obtener_o_crear_layout(dashboard.dashboard_id)
        DashboardComponent.objects.filter(layout=layout, component_id='kpi-1').update(content={'valor': 999999})

        borrar_datos_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')

        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id=dashboard.dashboard_id, component_id='kpi-1')
        self.assertNotEqual(kpi_1.content.get('valor'), 999999)

    def test_el_dashboard_en_si_no_se_elimina(self):
        dashboard = crear_dashboard(nombre='Comercial', area='Ventas')
        borrar_datos_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.name, 'Comercial')
        self.assertEqual(dashboard.area, 'Ventas')

    def test_registra_auditoria(self):
        usuario = User.objects.create_user(username='borra_datos', email='bd@example.com', password='Clave-Segura-123')
        dashboard = crear_dashboard(nombre='Comercial')
        borrar_datos_dashboard(dashboard.dashboard_id, confirmacion_nombre='Comercial', actor=usuario)
        evento = eventos.get(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_DATOS_BORRADOS', dashboard_id=dashboard.dashboard_id,
        )
        self.assertEqual(evento.actor, usuario)


class DashboardBorrarDatosViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _usuario_con(self, *codenames, username):
        usuario = User.objects.create_user(username=username, email=f'{username}@example.com', password='Clave-Segura-123')
        for codename in codenames:
            usuario.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label='permissions'))
        return usuario

    def test_sin_permiso_devuelve_403(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con(username='sin_permiso_borrar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.post(f'/api/v1/dashboards/{dashboard.dashboard_id}/borrar-datos', {'confirmation_name': 'Ventas'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_con_permiso_y_confirmacion_correcta_borra(self):
        dashboard = crear_dashboard(nombre='Ventas')
        CargaArchivo.objects.create(dashboard_id=dashboard.dashboard_id, nombre_original='datos.xlsx')
        usuario = self._usuario_con('dashboard.configuration.reset', username='con_permiso_borrar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.post(f'/api/v1/dashboards/{dashboard.dashboard_id}/borrar-datos', {'confirmation_name': 'Ventas'}, format='json')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(CargaArchivo.objects.filter(dashboard_id=dashboard.dashboard_id).exists())
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.name, 'Ventas')

    def test_con_confirmacion_incorrecta_devuelve_400(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.configuration.reset', username='con_permiso_borrar2')
        self.client.force_authenticate(user=usuario)
        resp = self.client.post(f'/api/v1/dashboards/{dashboard.dashboard_id}/borrar-datos', {'confirmation_name': 'otro'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).exists())

    def test_respeta_el_control_de_acceso_por_dashboard(self):
        dashboard = crear_dashboard(nombre='Ventas')
        editor = Group.objects.create(name='Editores borrar datos')
        dashboard.roles_editores.add(editor)
        usuario = User.objects.create_user(username='editor_acl_borrar', email='eab@example.com', password='Clave-Segura-123')
        usuario.groups.add(editor)
        self.client.force_authenticate(user=usuario)
        resp = self.client.post(f'/api/v1/dashboards/{dashboard.dashboard_id}/borrar-datos', {'confirmation_name': 'Ventas'}, format='json')
        self.assertEqual(resp.status_code, 204)
