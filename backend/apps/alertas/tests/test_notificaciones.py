"""Envío por correo del resumen de alertas (§19 del documento funcional).

Lo que se verifica aquí no es solo que el correo salga, sino las tres cosas
que hacen confiable a un aviso automático: que no se duplique, que no llegue a
quien no debe verlo, y que cuando no se envía quede dicho por qué.
"""

from datetime import date, timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.alertas.models import ConfiguracionAlertas, EnvioAlertas, Frecuencia
from apps.alertas.services import ejecutar_envio_programado, enviar_prueba
from apps.core.models import AuditLog
from apps.organizacion.models import Departamento, Empleado
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _conceder(usuario, *codenames):
    content_type = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_notif", email="admin_notif@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def receptor(db):
    """Usuario que puede ver las alertas: destinatario legítimo."""
    usuario = User.objects.create_user(
        username="jefe_ti", email="jefe.ti@example.com", password="Sup3r-Secr3t!"
    )
    _conceder(usuario, "alertas.ver")
    return usuario


@pytest.fixture
def configuracion(receptor):
    configuracion = ConfiguracionAlertas.cargar()
    configuracion.notificaciones_activas = True
    configuracion.save()
    configuracion.destinatarios.add(receptor)
    return configuracion


@pytest.fixture
def activo_con_custodio_inactivo(admin):
    """Un equipo a cargo de alguien dado de baja: dispara una alerta alta."""
    departamento = Departamento.objects.create(nombre="Tecnología", codigo="TI")
    empleado = Empleado.objects.create(
        nombres="Rosa",
        apellidos="Villacis",
        codigo_empleado="EMP-9001",
        departamento=departamento,
        activo=False,
    )
    return ActivoService.crear_activo(
        actor=admin,
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop de direccion",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-NOTIF-1",
        departamento=departamento,
        responsables=[empleado],
        fecha_adquisicion=timezone.localdate() - timedelta(days=200),
    )


# --- Envío programado -------------------------------------------------------


def test_no_envia_si_las_notificaciones_estan_desactivadas(receptor):
    envio = ejecutar_envio_programado()

    assert envio.resultado == EnvioAlertas.Resultado.OMITIDO
    assert "desactivadas" in envio.motivo
    assert mail.outbox == []


def test_envia_el_resumen_a_los_destinatarios(configuracion, activo_con_custodio_inactivo):
    envio = ejecutar_envio_programado()

    assert envio.resultado == EnvioAlertas.Resultado.ENVIADO
    assert len(mail.outbox) == 1
    assert envio.total_elementos >= 1
    configuracion.refresh_from_db()
    assert configuracion.ultimo_envio == timezone.localdate()


def test_dos_pasadas_el_mismo_dia_no_duplican_el_correo(
    configuracion, activo_con_custodio_inactivo
):
    """El cron puede reintentarse; el destinatario no debe recibir dos veces lo
    mismo, o dejará de creerle a los dos correos."""
    ejecutar_envio_programado()
    segundo = ejecutar_envio_programado()

    assert segundo.resultado == EnvioAlertas.Resultado.OMITIDO
    assert "Ya se envió hoy" in segundo.motivo
    assert len(mail.outbox) == 1


def test_la_frecuencia_semanal_solo_envia_su_dia(configuracion, activo_con_custodio_inactivo):
    configuracion.frecuencia = Frecuencia.SEMANAL
    configuracion.dia_envio_semanal = 0  # lunes
    configuracion.save()

    martes = date(2026, 9, 8)
    lunes = date(2026, 9, 7)

    assert ejecutar_envio_programado(hoy=martes).resultado == EnvioAlertas.Resultado.OMITIDO
    assert mail.outbox == []
    assert ejecutar_envio_programado(hoy=lunes).resultado == EnvioAlertas.Resultado.ENVIADO
    assert len(mail.outbox) == 1


def test_un_dia_sin_pendientes_no_genera_correo(configuracion):
    """El correo que llega todos los días diciendo lo mismo deja de leerse."""
    envio = ejecutar_envio_programado()

    assert envio.resultado == EnvioAlertas.Resultado.OMITIDO
    assert "No hay alertas pendientes" in envio.motivo
    assert mail.outbox == []


def test_se_puede_pedir_el_correo_aunque_no_haya_pendientes(configuracion):
    """«Revisado, nada pendiente» también es información para quien la quiera."""
    configuracion.omitir_si_no_hay_pendientes = False
    configuracion.save()

    envio = ejecutar_envio_programado()

    assert envio.resultado == EnvioAlertas.Resultado.ENVIADO
    assert "Sin alertas pendientes" in mail.outbox[0].subject


def test_no_envia_a_quien_perdio_el_permiso(configuracion, receptor, activo_con_custodio_inactivo):
    """El filtro se aplica al enviar, no al elegir: entre ambos momentos pueden
    haberle revocado el acceso."""
    receptor.user_permissions.clear()

    envio = ejecutar_envio_programado()

    assert envio.resultado == EnvioAlertas.Resultado.OMITIDO
    assert "permiso" in envio.motivo
    assert mail.outbox == []


def test_no_envia_a_una_cuenta_dada_de_baja(configuracion, receptor, activo_con_custodio_inactivo):
    receptor.status = User.Status.DISABLED
    receptor.save()

    envio = ejecutar_envio_programado()

    assert envio.resultado == EnvioAlertas.Resultado.OMITIDO
    assert mail.outbox == []


def test_un_fallo_de_envio_queda_registrado_y_no_marca_el_dia_como_enviado(
    configuracion, activo_con_custodio_inactivo
):
    """Si falló, mañana hay que volver a intentarlo: darlo por enviado
    convierte un problema de correo en un aviso que nadie recibió nunca."""
    with patch(
        "apps.alertas.emails.EmailMultiAlternatives.send", side_effect=OSError("SMTP caido")
    ):
        envio = ejecutar_envio_programado()

    assert envio.resultado == EnvioAlertas.Resultado.FALLIDO
    assert "SMTP caido" in envio.motivo
    configuracion.refresh_from_db()
    assert configuracion.ultimo_envio is None


def test_cada_pasada_del_cron_deja_constancia(configuracion):
    """Un día sin ninguna fila es un cron que no corrió, y eso hay que poder
    distinguirlo de un día tranquilo."""
    ejecutar_envio_programado()

    assert EnvioAlertas.objects.count() == 1


# --- Contenido del correo ---------------------------------------------------


def test_el_correo_no_lleva_datos_de_equipos_ni_de_personas(
    configuracion, activo_con_custodio_inactivo
):
    """Un correo sale del perímetro del sistema: se reenvía y se archiva en
    buzones donde no rigen los permisos. Viajan los recuentos, no el detalle."""
    ejecutar_envio_programado()
    mensaje = mail.outbox[0]
    cuerpos = [mensaje.body] + [contenido for contenido, _ in mensaje.alternatives]

    for cuerpo in cuerpos:
        assert "Villacis" not in cuerpo
        assert activo_con_custodio_inactivo.codigo_barras not in cuerpo
        assert "Laptop de direccion" not in cuerpo
    assert "Equipos con custodio inactivo" in mensaje.body


def test_los_destinatarios_van_en_copia_oculta(
    configuracion, receptor, activo_con_custodio_inactivo
):
    """Quién más recibe los avisos del parque no es asunto de cada destinatario."""
    otro = User.objects.create_user(
        username="otro_ti", email="otro.ti@example.com", password="Sup3r-Secr3t!"
    )
    _conceder(otro, "alertas.ver")
    configuracion.destinatarios.add(otro)

    ejecutar_envio_programado()
    mensaje = mail.outbox[0]

    assert receptor.email not in mensaje.to
    assert sorted(mensaje.bcc) == sorted([receptor.email, otro.email])


def test_el_correo_tiene_version_en_texto_plano(configuracion, activo_con_custodio_inactivo):
    """Hay clientes corporativos que bloquean el HTML de remitentes
    automáticos, y un correo vacío no se distingue de uno que no llegó."""
    ejecutar_envio_programado()
    mensaje = mail.outbox[0]

    assert mensaje.body.strip()
    assert mensaje.alternatives[0][1] == "text/html"


# --- Envío de prueba --------------------------------------------------------


def test_la_prueba_va_solo_a_quien_la_pide(configuracion, receptor, admin):
    """Probar que el correo sale no debería costarle un aviso falso a media
    empresa."""
    envio = enviar_prueba(usuario=admin)

    assert envio.origen == EnvioAlertas.Origen.PRUEBA
    assert mail.outbox[0].bcc == [admin.email]
    assert receptor.email not in mail.outbox[0].bcc


def test_la_prueba_no_sustituye_al_envio_del_dia(
    configuracion, activo_con_custodio_inactivo, admin
):
    enviar_prueba(usuario=admin)
    configuracion.refresh_from_db()
    assert configuracion.ultimo_envio is None

    assert ejecutar_envio_programado().resultado == EnvioAlertas.Resultado.ENVIADO


def test_endpoint_de_prueba_envia_y_queda_auditado(cliente, admin, configuracion):
    respuesta = cliente.post("/api/v1/alertas/envios/prueba/")

    assert respuesta.status_code == 200
    assert admin.email in respuesta.data["detail"]
    assert len(mail.outbox) == 1
    assert AuditLog.objects.filter(action="alertas.prueba_enviada").exists()


def test_endpoint_de_prueba_informa_cuando_el_correo_no_sale(cliente, configuracion):
    """Un 200 con el correo caído haría creer que el canal funciona."""
    with patch(
        "apps.alertas.emails.EmailMultiAlternatives.send", side_effect=OSError("SMTP caido")
    ):
        respuesta = cliente.post("/api/v1/alertas/envios/prueba/")

    assert respuesta.status_code == 502
    assert EnvioAlertas.objects.filter(resultado=EnvioAlertas.Resultado.FALLIDO).exists()


def test_ver_las_alertas_no_habilita_a_enviar_correo(receptor):
    """Mirar el estado del parque y hacer que el sistema escriba a terceros son
    decisiones de distinto alcance."""
    client = APIClient()
    client.force_authenticate(user=receptor)

    assert client.post("/api/v1/alertas/envios/prueba/").status_code == 403
    assert client.get("/api/v1/alertas/destinatarios/").status_code == 403


# --- Configuración por API --------------------------------------------------


def test_no_se_activa_el_envio_sin_destinatarios(cliente):
    """Encender el aviso sin nadie a quien avisar da la falsa impresión de que
    el parque está vigilado."""
    respuesta = cliente.patch(
        "/api/v1/alertas/configuracion/", {"notificaciones_activas": True}, format="json"
    )

    assert respuesta.status_code == 400
    assert "destinatarios" in respuesta.data["error"]["details"]


def test_no_se_puede_elegir_a_quien_no_puede_ver_las_alertas(cliente):
    ajeno = User.objects.create_user(
        username="contabilidad", email="conta@example.com", password="Sup3r-Secr3t!"
    )

    respuesta = cliente.patch(
        "/api/v1/alertas/configuracion/", {"destinatarios": [ajeno.id]}, format="json"
    )

    assert respuesta.status_code == 400
    assert "contabilidad" in str(respuesta.data)


def test_la_fecha_del_ultimo_envio_no_se_edita(cliente, configuracion):
    """Moverla saltaría el resumen de un día sin dejar rastro de quién lo hizo."""
    respuesta = cliente.patch(
        "/api/v1/alertas/configuracion/", {"ultimo_envio": "2020-01-01"}, format="json"
    )

    assert respuesta.status_code == 200
    configuracion.refresh_from_db()
    assert configuracion.ultimo_envio is None


def test_los_candidatos_llegan_con_el_correo_enmascarado(cliente, receptor):
    """Quien configura necesita reconocer a la persona, no su dirección."""
    respuesta = cliente.get("/api/v1/alertas/destinatarios/")

    fila = next(c for c in respuesta.data if c["id"] == receptor.id)
    assert fila["correo"] != receptor.email
    assert fila["correo"].endswith("@example.com")
    assert fila["correo"].startswith("j")


def test_el_historial_muestra_tambien_lo_que_no_se_envio(cliente, configuracion):
    ejecutar_envio_programado()

    respuesta = cliente.get("/api/v1/alertas/envios/")

    assert respuesta.status_code == 200
    assert respuesta.data[0]["resultado"] == EnvioAlertas.Resultado.OMITIDO
    assert respuesta.data[0]["motivo"]


# --- Comando de management --------------------------------------------------


def test_el_comando_respeta_la_configuracion(configuracion, activo_con_custodio_inactivo):
    call_command("enviar_alertas")

    assert len(mail.outbox) == 1


def test_el_comando_con_forzar_ignora_frecuencia_y_apagado(receptor, activo_con_custodio_inactivo):
    """Sirve para verificar la configuración SMTP sin encender el envío
    programado en producción."""
    configuracion = ConfiguracionAlertas.cargar()
    configuracion.destinatarios.add(receptor)

    call_command("enviar_alertas", "--forzar")

    assert len(mail.outbox) == 1
    assert EnvioAlertas.objects.first().resultado == EnvioAlertas.Resultado.ENVIADO
