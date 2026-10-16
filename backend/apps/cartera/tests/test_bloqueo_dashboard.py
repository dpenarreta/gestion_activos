"""Bloqueo estructural de un dashboard completo (`Dashboard.estructura_bloqueada`).

Distinto del bloqueo por componente (`config.bloqueado`, ver `test_dashboard_layout.py`) en tres
cosas, y las tres son el motivo de este archivo:

1. Alcanza a TODOS los componentes del dashboard, incluidos los que se agreguen después.
2. Cierra también la puerta de "agregar", que ningún flag por componente puede cerrar.
3. No lo exime ser superusuario: hay que volver a escribir la contraseña en la misma operación.

El caso real que lo motivó: el dueño del dashboard, que es superusuario, dejó tres KPIs del
Dashboard Directorio filtrando por una columna equivocada sin advertirlo. Un permiso no habría
cambiado nada (los tenía todos); lo que faltaba era que el cambio costara un acto deliberado.
"""

from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.cartera.compat import AuditEvent
from apps.cartera.tests.auditoria import eventos
from apps.authentication.models import LoginAttempt
from apps.cartera.exceptions import CarteraError
from apps.cartera.models import Dashboard, DashboardComponent
from apps.cartera.services import dashboard_layout as dl
from apps.cartera.services import desbloqueo

User = get_user_model()

DASHBOARD = 'finanzas'
CLAVE = 'Clave-Segura-123'
# Una cadena que no aparezca por casualidad en ningún mensaje del sistema: el test que revisa que
# la contraseña no se filtre a la auditoría busca justamente este texto, y con una palabra común
# ("incorrecta") daba positivo contra el propio mensaje de error.
CLAVE_EQUIVOCADA = 'Zx9-no-es-la-clave'


def _usuario(superusuario=True, sufijo=''):
    crear = User.objects.create_superuser if superusuario else User.objects.create_user
    n = User.objects.count()
    return crear(username=f'u{n}{sufijo}', email=f'u{n}{sufijo}@example.com', password=CLAVE)


def _cliente(usuario):
    client = APIClient()
    client.force_authenticate(user=usuario)
    return client


def _con_componentes(dashboard_id=DASHBOARD, cantidad=2):
    for i in range(1, cantidad + 1):
        dl.agregar_componente_generado(dashboard_id, {
            'titulo': f'Gráfica {i}', 'columna_valor': 'valor', 'columna_categoria': 'categoria',
            'datos': {'tipo': 'chart', 'categorias': ['A', 'B'], 'valores': [10.0, 20.0]},
        }, reemplazar_existentes=(i == 1))
    return dl.obtener_o_crear_layout(dashboard_id)


def _bloquear(dashboard_id=DASHBOARD):
    Dashboard.objects.update_or_create(
        dashboard_id=dashboard_id, defaults={'name': 'Finanzas', 'estructura_bloqueada': True},
    )


def _payload(dashboard_id=DASHBOARD):
    layout = dl.obtener_o_crear_layout(dashboard_id)
    return [dict(c) for c in dl.serializar_layout(layout)['components']]


class ValidacionDeEstructuraTests(TestCase):
    """El servicio, sin pasar por HTTP."""

    def setUp(self):
        _con_componentes()
        _bloquear()

    def test_no_se_puede_eliminar_un_componente(self):
        componentes = _payload()[:1]
        with self.assertRaises(CarteraError) as ctx:
            dl.validar_componentes(DASHBOARD, componentes)
        self.assertEqual(ctx.exception.codigo, desbloqueo.CODIGO_BLOQUEADO)

    def test_no_se_puede_reordenar(self):
        componentes = _payload()
        componentes[0]['order'], componentes[1]['order'] = componentes[1]['order'], componentes[0]['order']
        with self.assertRaises(CarteraError) as ctx:
            dl.validar_componentes(DASHBOARD, componentes)
        self.assertEqual(ctx.exception.codigo, desbloqueo.CODIGO_BLOQUEADO)

    def test_no_se_puede_redimensionar_ni_ocultar(self):
        for campo, valor in (('width', 4), ('height', 400), ('is_visible', False)):
            with self.subTest(campo=campo):
                componentes = _payload()
                componentes[0][campo] = valor
                with self.assertRaises(CarteraError) as ctx:
                    dl.validar_componentes(DASHBOARD, componentes)
                self.assertEqual(ctx.exception.codigo, desbloqueo.CODIGO_BLOQUEADO)

    def test_ser_superusuario_no_alcanza(self):
        # La diferencia central con `config.bloqueado`: ahí `es_superusuario=True` eximía de todo.
        componentes = _payload()[:1]
        with self.assertRaises(CarteraError):
            dl.validar_componentes(DASHBOARD, componentes, es_superusuario=True)

    def test_con_la_confirmacion_hecha_el_cambio_pasa(self):
        componentes = _payload()[:1]
        resultado = dl.validar_componentes(DASHBOARD, componentes, desbloqueo_confirmado=True)
        self.assertEqual(len(resultado), 1)

    def test_los_datos_y_el_titulo_siguen_siendo_editables(self):
        # El bloqueo es de ESTRUCTURA. Si además congelara el mapeo, un cambio de columnas en el
        # origen obligaría a desbloquear el dashboard entero para poder repararlo.
        componentes = _payload()
        componentes[0]['content'] = {**componentes[0]['content'], 'titulo': 'Otro título'}
        componentes[0]['mapeo'] = {**componentes[0]['mapeo'], 'columna_valor': 'otra_columna'}
        resultado = dl.validar_componentes(DASHBOARD, componentes)
        self.assertEqual(resultado[0]['content']['titulo'], 'Otro título')
        self.assertEqual(resultado[0]['mapeo']['columna_valor'], 'otra_columna')

    def test_el_bloqueo_no_se_copia_al_config_de_cada_componente(self):
        # Dos fuentes de verdad para el mismo hecho terminan contradiciéndose: al desbloquear el
        # dashboard quedarían componentes marcados como bloqueados por su cuenta.
        resultado = dl.validar_componentes(DASHBOARD, _payload())
        for comp in resultado:
            self.assertNotIn('bloqueado', comp['config'])

    def test_mostrar_un_componente_oculto_tambien_es_un_cambio_de_estructura(self):
        """El caso que se colaba: `componentes_validos` no devolvía `is_visible`, así que la
        comparación se hacía siempre contra "visible" y pasar un componente de oculto a visible no
        contaba como cambio. En el Dashboard Directorio eso deja a la vista las 13 posiciones de
        fábrica, que están ocultas justamente porque el informe no las usa."""
        dl.validar_componentes(DASHBOARD, [
            {**c, 'is_visible': False} for c in _payload()
        ], desbloqueo_confirmado=True)
        dl.aplicar_layout(DASHBOARD, dl.validar_componentes(
            DASHBOARD, [{**c, 'is_visible': False} for c in _payload()], desbloqueo_confirmado=True,
        ), 'test')

        componentes = _payload()
        componentes[0]['is_visible'] = True
        with self.assertRaises(CarteraError) as ctx:
            dl.validar_componentes(DASHBOARD, componentes)
        self.assertEqual(ctx.exception.codigo, desbloqueo.CODIGO_BLOQUEADO)

    def test_agregar_un_componente_no_saca_a_la_luz_los_ocultos(self):
        # Mismo origen que el test de arriba: al agregar, los existentes se reescribían con el
        # default `True`. Un dashboard bloqueado prometía que nada cambia sin confirmar, y esto
        # cambiaba la visibilidad de todos los ocultos de rebote.
        componentes = [{**c, 'is_visible': False} for c in _payload()]
        dl.aplicar_layout(DASHBOARD, dl.validar_componentes(
            DASHBOARD, componentes, desbloqueo_confirmado=True,
        ), 'test')

        dl.agregar_componente_presentacional(DASHBOARD, 'title', zona='personal')

        visibles = DashboardComponent.objects.filter(layout__dashboard_id=DASHBOARD, is_visible=True)
        self.assertEqual([c.component_id for c in visibles], ['nuevo-titulo'])

    def test_sin_bloqueo_todo_sigue_como_antes(self):
        Dashboard.objects.filter(dashboard_id=DASHBOARD).update(estructura_bloqueada=False)
        self.assertEqual(len(dl.validar_componentes(DASHBOARD, _payload()[:1])), 1)


class GuardarLayoutBloqueadoTests(TestCase):
    """El PUT del layout, que es por donde pasa el editor visual."""

    def setUp(self):
        self.layout = _con_componentes()
        _bloquear()
        self.usuario = _usuario()
        self.client = _cliente(self.usuario)

    def _put(self, componentes, **extra):
        return self.client.put(
            f'/api/v1/dashboards/{DASHBOARD}/layout',
            {'version': self.layout.version, 'components': componentes, **extra}, format='json',
        )

    def test_rechaza_el_cambio_estructural_y_dice_que_se_puede_confirmar(self):
        resp = self._put(_payload()[:1])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'DASHBOARD_BLOQUEADO')
        # Lo que hace que el editor abra el cuadro de contraseña en vez de solo avisar.
        self.assertTrue(resp.json()['detalles']['puede_confirmar'])

    def test_con_la_contrasena_correcta_el_cambio_se_guarda(self):
        resp = self._put(_payload()[:1], password_confirmacion=CLAVE)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(DashboardComponent.objects.filter(layout__dashboard_id=DASHBOARD).count(), 1)

    def test_con_la_contrasena_equivocada_no_se_guarda(self):
        resp = self._put(_payload()[:1], password_confirmacion=CLAVE_EQUIVOCADA)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'CONFIRMACION_INVALIDA')
        self.assertEqual(DashboardComponent.objects.filter(layout__dashboard_id=DASHBOARD).count(), 2)

    def test_un_cambio_que_no_toca_la_estructura_no_pide_nada(self):
        componentes = _payload()
        componentes[0]['content'] = {**componentes[0]['content'], 'titulo': 'Renombrada'}
        self.assertEqual(self._put(componentes).status_code, 200)

    def test_a_un_usuario_comun_no_le_sirve_su_contrasena(self):
        # Con permiso de edición y la contraseña correcta: aun así no pasa. El bloqueo no es un
        # permiso más, y por eso no se puede conceder desde la pantalla de roles.
        usuario = _usuario(superusuario=False, sufijo='n')
        with mock.patch('apps.cartera.permisos.tiene_acceso_dashboard', return_value=True):
            resp = _cliente(usuario).put(
                f'/api/v1/dashboards/{DASHBOARD}/layout',
                {'version': self.layout.version, 'components': _payload()[:1], 'password_confirmacion': CLAVE},
                format='json',
            )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'DASHBOARD_BLOQUEADO')
        self.assertFalse(resp.json()['detalles']['puede_confirmar'])
        self.assertEqual(DashboardComponent.objects.filter(layout__dashboard_id=DASHBOARD).count(), 2)


class AgregarYRestablecerBloqueadosTests(TestCase):
    def setUp(self):
        _con_componentes()
        _bloquear()
        self.usuario = _usuario()
        self.client = _cliente(self.usuario)

    def test_no_se_puede_agregar_un_componente(self):
        resp = self.client.post(
            f'/api/v1/dashboards/{DASHBOARD}/componentes-presentacionales', {'tipo': 'title'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'DASHBOARD_BLOQUEADO')

    def test_se_puede_agregar_confirmando_la_contrasena(self):
        resp = self.client.post(
            f'/api/v1/dashboards/{DASHBOARD}/componentes-presentacionales',
            {'tipo': 'title', 'password_confirmacion': CLAVE}, format='json',
        )
        self.assertEqual(resp.status_code, 201)

    def test_no_se_pueden_borrar_los_datos(self):
        """La puerta por la que el Dashboard Directorio de producción perdió sus 9 secciones.

        "Borrar datos" no es solo datos: se lleva los componentes de la Zona Personal y resiembra
        las 13 posiciones de ejemplo. Pedía escribir el nombre del dashboard, pero no consultaba
        el bloqueo, así que un dashboard "bloqueado" se podía convertir en el genérico sin más.
        """
        resp = self.client.post(
            f'/api/v1/dashboards/{DASHBOARD}/borrar-datos', {'confirmation_name': 'Finanzas'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'DASHBOARD_BLOQUEADO')
        self.assertEqual(DashboardComponent.objects.filter(layout__dashboard_id=DASHBOARD).count(), 2)

    def test_se_pueden_borrar_los_datos_confirmando_la_contrasena(self):
        resp = self.client.post(
            f'/api/v1/dashboards/{DASHBOARD}/borrar-datos',
            {'confirmation_name': 'Finanzas', 'password_confirmacion': CLAVE}, format='json',
        )
        self.assertEqual(resp.status_code, 204)

    def test_no_se_puede_restablecer_el_diseno(self):
        resp = self.client.post(f'/api/v1/dashboards/{DASHBOARD}/layout/reset', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'DASHBOARD_BLOQUEADO')


class ConfirmacionTests(TestCase):
    """Lo que hace que la confirmación no sea, ella misma, una forma de adivinar la contraseña."""

    def setUp(self):
        _con_componentes()
        _bloquear()
        self.usuario = _usuario()
        self.layout = dl.obtener_o_crear_layout(DASHBOARD)
        self.client = _cliente(self.usuario)

    def _intentar(self, password):
        # La versión se relee en cada intento: después de un PUT que sí entra, la guardada queda
        # vieja y el siguiente se cortaría en el 409 de concurrencia sin llegar a la contraseña.
        version = dl.obtener_o_crear_layout(DASHBOARD).version
        return self.client.put(
            f'/api/v1/dashboards/{DASHBOARD}/layout',
            {'version': version, 'components': _payload()[:1], 'password_confirmacion': password},
            format='json',
        )

    def test_un_fallo_gasta_un_intento_del_mismo_contador_que_el_login(self):
        self._intentar(CLAVE_EQUIVOCADA)
        self.assertEqual(LoginAttempt.objects.filter(user=self.usuario, successful=False).count(), 1)

    def test_un_acierto_no_limpia_el_bloqueo_por_fuerza_bruta_del_login(self):
        # Registrar el acierto como "login exitoso" dejaría que esta puerta desactive la
        # protección del login desde adentro.
        self._intentar(CLAVE)
        self.assertFalse(LoginAttempt.objects.filter(user=self.usuario, successful=True).exists())

    def test_el_desbloqueo_queda_auditado_con_la_accion(self):
        self._intentar(CLAVE)
        evento = eventos.filter(action='DASHBOARD_DESBLOQUEADO').first()
        self.assertIsNotNone(evento)
        self.assertEqual(evento.dashboard_id, DASHBOARD)
        self.assertEqual(evento.metadata.get('accion'), 'cambiar el diseño')

    def test_el_intento_fallido_tambien_queda_auditado(self):
        self._intentar(CLAVE_EQUIVOCADA)
        self.assertTrue(eventos.filter(action='DASHBOARD_DESBLOQUEO_FALLIDO').exists())

    def test_la_contrasena_nunca_queda_escrita_en_la_auditoria(self):
        self._intentar(CLAVE)
        self._intentar(CLAVE_EQUIVOCADA)
        for evento in eventos.all():
            volcado = f'{evento.metadata} {evento.new_values} {evento.previous_values} {evento.message}'
            with self.subTest(evento=evento.action):
                self.assertNotIn(CLAVE, volcado)
                self.assertNotIn(CLAVE_EQUIVOCADA, volcado)


class EstadoExpuestoAlEditorTests(TestCase):
    def test_el_layout_informa_si_esta_bloqueado(self):
        _con_componentes()
        client = _cliente(_usuario())

        self.assertFalse(client.get(f'/api/v1/dashboards/{DASHBOARD}/layout').json()['estructura_bloqueada'])
        _bloquear()
        self.assertTrue(client.get(f'/api/v1/dashboards/{DASHBOARD}/layout').json()['estructura_bloqueada'])


class ComandoTests(TestCase):
    def setUp(self):
        Dashboard.objects.create(dashboard_id=DASHBOARD, name='Finanzas')

    def _correr(self, *args):
        salida = StringIO()
        call_command('bloquear_dashboard', *args, stdout=salida)
        return salida.getvalue()

    def test_bloquea_y_desbloquea(self):
        self._correr(DASHBOARD)
        self.assertTrue(Dashboard.objects.get(dashboard_id=DASHBOARD).estructura_bloqueada)
        self._correr(DASHBOARD, '--desbloquear')
        self.assertFalse(Dashboard.objects.get(dashboard_id=DASHBOARD).estructura_bloqueada)

    def test_repetirlo_actualiza_la_foto_de_la_estructura(self):
        # Volver a correrlo sobre un dashboard ya bloqueado no es un error ni un no-op: vuelve a
        # fotografiar la estructura actual. Es lo que permite confirmar una estructura nueva
        # después de cambiarla a propósito, y lo que le da foto a un dashboard que se bloqueó
        # antes de que la reposición existiera.
        self._correr(DASHBOARD)
        self.assertIn('se actualizó la foto', self._correr(DASHBOARD))

    def test_desbloquear_dos_veces_no_es_un_error(self):
        self._correr(DASHBOARD, '--desbloquear')
        self.assertIn('Sin cambios', self._correr(DASHBOARD, '--desbloquear'))

    def test_un_dashboard_inexistente_lista_los_que_hay(self):
        with self.assertRaises(CommandError) as ctx:
            self._correr('no-existe')
        self.assertIn(DASHBOARD, str(ctx.exception))
