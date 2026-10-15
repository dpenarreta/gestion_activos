"""Matriz de obligaciones, fase 4: recordatorios, escalamiento y reintentos.

Cobertura de tests/qa/features/matriz-obligaciones.feature (AC-MTZ-037 a
AC-MTZ-046). Sigue las pruebas mínimas de la especificación (§23):
anticipaciones, hora de envío, copia al suplente, suspensión al validar,
deduplicación, escalamiento único y repetido, reintentos hasta el máximo.

El reloj se pasa a mano (`ahora=`): así cada prueba dice qué día y a qué hora
local corre, sin depender de cuándo se ejecute la suite.
"""

import datetime
import zoneinfo

import pytest
from django.contrib.auth.models import Group
from django.core import mail
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.matriz import recordatorios
from apps.matriz.models import (
    Area,
    ConfiguracionRecordatorios,
    EntidadControl,
    EstadoNotificacion,
    EventoPeriodo,
    Notificacion,
    Periodo,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db

GYE = zoneinfo.ZoneInfo("America/Guayaquil")
VENCE = datetime.date(2026, 10, 28)


def _a_las(dia, hora="09:00", zona=GYE):
    h, m = (int(x) for x in hora.split(":"))
    return datetime.datetime.combine(dia, datetime.time(h, m), tzinfo=zona)


def _dias(n):
    return VENCE + datetime.timedelta(days=n)


def _cuenta(nombre, email=True):
    return User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com" if email else "",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )


def _miembro(usuario, empresa, rol):
    membresia = MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    membresia.roles.set([Group.objects.get(name=f"Matriz · {rol}")])


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


@pytest.fixture
def courier():
    return Empresa.objects.create(
        nombre="LaarCourier", codigo="LC", zona_horaria="America/Guayaquil"
    )


@pytest.fixture
def escena(courier):
    gente = {n: _cuenta(n) for n in ("admin", "ana", "beto", "sara", "olga", "aldo")}
    _miembro(gente["admin"], courier, "Administrador")
    _miembro(gente["ana"], courier, "Responsable")
    _miembro(gente["beto"], courier, "Responsable")
    _miembro(gente["sara"], courier, "Supervisor/Aprobador")
    _miembro(gente["olga"], courier, "Supervisor/Aprobador")
    _miembro(gente["aldo"], courier, "Auditor")
    alta = _cliente(gente["admin"], courier).post(
        "/api/v1/matriz/obligaciones/",
        {
            "nombre": "Declaración de IVA",
            "area": Area.objects.get(codigo="CONT").id,
            "entidad": EntidadControl.objects.get(codigo="SRI").id,
            "periodicidad": "mensual",
            "evidencia_esperada": "Formulario 104",
            "fecha_vencimiento": VENCE.isoformat(),
            "responsable": gente["ana"].id,
            "suplente": gente["beto"].id,
            "supervisor": gente["sara"].id,
            "aprobador": gente["olga"].id,
        },
        format="json",
    )
    assert alta.status_code == 201, alta.data
    periodo = Periodo.objects.todas().get(pk=alta.data["id"])
    clientes = {n: _cliente(u, courier) for n, u in gente.items()}
    return {"periodo": periodo, "gente": gente, "empresa": courier, **clientes}


def _url(escena, accion=""):
    base = f"/api/v1/matriz/periodos/{escena['periodo'].id}/recordatorios/"
    return f"{base}{accion}/" if accion else base


def _a_quien():
    return sorted(m.to[0] for m in mail.outbox)


# --- Recordatorios automáticos (§12.1) -----------------------------------------------


def test_llega_en_cada_anticipacion_al_responsable_y_al_suplente(escena):
    for dias in (15, 7, 3, 1):
        mail.outbox.clear()
        assert recordatorios.enviar_recordatorios(_a_las(_dias(-dias))) == 2
        assert _a_quien() == ["ana@example.com", "beto@example.com"]
        assert mail.outbox[0].subject == (
            "Recordatorio de vencimiento — Declaración de IVA (Octubre 2026)"
        )

    mail.outbox.clear()
    recordatorios.enviar_recordatorios(_a_las(VENCE))
    assert mail.outbox[0].subject == "Hoy vence — Declaración de IVA (Octubre 2026)"


def test_fuera_de_las_anticipaciones_no_se_envia(escena):
    for dias in (14, 8, 2):
        assert recordatorios.enviar_recordatorios(_a_las(_dias(-dias))) == 0
    assert mail.outbox == []


def test_antes_de_la_hora_de_envio_no_sale(escena):
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-7), "07:59")) == 0
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-7), "08:00")) == 2


def test_la_hora_es_la_local_de_la_empresa(escena, courier):
    """Las 08:30 en Guayaquil son las 13:30 en UTC: con la hora del servidor el
    aviso de una empresa en Tokio saldría de madrugada."""
    courier.zona_horaria = "Asia/Tokyo"
    courier.save()
    tokio = zoneinfo.ZoneInfo("Asia/Tokyo")
    Periodo.objects.todas().filter(pk=escena["periodo"].pk).update(
        vence_en=_a_las(VENCE, "17:00", tokio)
    )
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-7), "07:30", tokio)) == 0
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-7), "08:30", tokio)) == 2


def test_sin_copia_al_suplente_solo_el_responsable(escena, courier):
    config = recordatorios.configuracion_de(courier)
    config.copia_suplente = False
    config.save()
    recordatorios.enviar_recordatorios(_a_las(_dias(-3)))
    assert _a_quien() == ["ana@example.com"]


def test_quien_no_tiene_correo_se_omite_y_no_se_repite(escena):
    ana = escena["gente"]["ana"]
    Periodo.objects.todas().filter(pk=escena["periodo"].pk).update(suplente=ana)
    recordatorios.enviar_recordatorios(_a_las(_dias(-3)))
    assert _a_quien() == ["ana@example.com"]

    mail.outbox.clear()
    ana.email = ""
    ana.save()
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-1))) == 0


def test_correr_dos_veces_no_duplica(escena):
    ahora = _a_las(_dias(-7))
    assert recordatorios.enviar_recordatorios(ahora) == 2
    assert recordatorios.enviar_recordatorios(ahora) == 0
    assert recordatorios.enviar_recordatorios(ahora + datetime.timedelta(hours=3)) == 0
    assert len(mail.outbox) == 2
    assert Notificacion.objects.todas().count() == 2


def test_si_cambia_el_vencimiento_se_reprograman(escena):
    recordatorios.enviar_recordatorios(_a_las(_dias(-7)))
    Periodo.objects.todas().filter(pk=escena["periodo"].pk).update(
        vence_en=_a_las(VENCE + datetime.timedelta(days=1), "17:00")
    )
    # Mismo día, nueva fecha: faltan 8 días, que no es anticipación.
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-7))) == 0
    # Un día después faltan 7 de nuevo, con otra fecha en la clave.
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-6))) == 2


def test_al_validar_dejan_de_enviarse(escena):
    Periodo.objects.todas().filter(pk=escena["periodo"].pk).update(
        cerrado=True, recordatorios_suspendidos=True
    )
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-1))) == 0
    assert recordatorios.escalar_atrasos(_a_las(_dias(5))) == 0


def test_las_anticipaciones_de_la_empresa_mandan(escena, courier):
    config = recordatorios.configuracion_de(courier)
    config.anticipaciones = [10, 0]
    config.save()
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-7))) == 0
    assert recordatorios.enviar_recordatorios(_a_las(_dias(-10))) == 2


# --- Escalamiento (§12.2) --------------------------------------------------------------


def test_con_dos_dias_de_atraso_se_escala_al_supervisor_una_vez(escena):
    assert recordatorios.escalar_atrasos(_a_las(_dias(1))) == 0
    assert recordatorios.escalar_atrasos(_a_las(_dias(2))) == 1
    assert _a_quien() == ["sara@example.com"]
    assert mail.outbox[0].subject.startswith("Escalamiento: obligación vencida")
    assert "2 día(s) de atraso" in mail.outbox[0].body

    assert recordatorios.escalar_atrasos(_a_las(_dias(2), "15:00")) == 0
    assert recordatorios.escalar_atrasos(_a_las(_dias(6))) == 0

    evento = EventoPeriodo.objects.todas().get(accion="reminder.escalated")
    assert evento.descripcion == "Escalamiento enviado a Sara"
    assert evento.motivo == "2 día(s) de atraso"
    assert evento.actor is None


def test_sin_supervisor_se_escala_al_aprobador(escena):
    Periodo.objects.todas().filter(pk=escena["periodo"].pk).update(supervisor=None)
    recordatorios.escalar_atrasos(_a_las(_dias(2)))
    assert _a_quien() == ["olga@example.com"]


def test_el_escalamiento_se_repite_cada_n_dias(escena, courier):
    config = recordatorios.configuracion_de(courier)
    config.repetir_escalamiento_cada = 2
    config.save()
    resultados = [recordatorios.escalar_atrasos(_a_las(_dias(n))) for n in range(2, 8)]
    assert resultados == [1, 0, 1, 0, 1, 0]


def test_el_escalamiento_desactivado_no_sale(escena, courier):
    config = recordatorios.configuracion_de(courier)
    config.escalamiento_activo = False
    config.save()
    assert recordatorios.escalar_atrasos(_a_las(_dias(3))) == 0


# --- Reintentos (§12.3) ----------------------------------------------------------------


@pytest.fixture
def smtp_caido(monkeypatch):
    def fallar(self, fail_silently=False):
        raise ConnectionRefusedError("SMTP no responde")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", fallar)


def test_un_fallo_queda_registrado_y_se_reintenta_hasta_el_maximo(escena, smtp_caido, courier):
    config = recordatorios.configuracion_de(courier)
    config.copia_suplente = False
    config.save()

    recordatorios.enviar_recordatorios(_a_las(_dias(-7)))
    original = Notificacion.objects.todas().get()
    assert original.estado == EstadoNotificacion.FALLIDO
    assert "SMTP no responde" in original.ultimo_error

    assert recordatorios.reintentar_fallidos(_a_las(_dias(-7))) == 1
    assert recordatorios.reintentar_fallidos(_a_las(_dias(-7))) == 1
    # Con 3 intentos se deja de insistir.
    assert recordatorios.reintentar_fallidos(_a_las(_dias(-7))) == 0

    filas = list(Notificacion.objects.todas().order_by("intentos"))
    assert [n.intentos for n in filas] == [1, 2, 3]
    assert [n.estado for n in filas] == ["reintentado", "reintentado", "fallido"]
    assert filas[1].reintento_de == filas[0]


def test_un_reintento_no_reenvia_el_original(escena, smtp_caido, monkeypatch):
    recordatorios.enviar_recordatorios(_a_las(_dias(-7)))
    monkeypatch.undo()
    recordatorios.reintentar_fallidos(_a_las(_dias(-7)))
    assert len(mail.outbox) == 2
    # El programador vuelve a pasar: lo enviado no se repite.
    recordatorios.enviar_recordatorios(_a_las(_dias(-7)))
    recordatorios.reintentar_fallidos(_a_las(_dias(-7)))
    assert len(mail.outbox) == 2


def test_el_comando_corre_el_ciclo_y_es_idempotente(escena, capsys):
    call_command("ciclo_matriz")
    call_command("ciclo_matriz")
    salida = capsys.readouterr().out
    assert "Matriz:" in salida


# --- API (§14.5) -------------------------------------------------------------------------


def test_la_configuracion_nace_con_los_valores_por_defecto(escena):
    respuesta = escena["ana"].get("/api/v1/matriz/recordatorios/configuracion/")
    assert respuesta.status_code == 200
    assert respuesta.data["offsets"] == [15, 7, 3, 1, 0]
    assert respuesta.data["send_time"] == "08:00"
    assert respuesta.data["escalation_days"] == 2
    assert respuesta.data["can_edit"] is False


def test_configurar_exige_permiso_y_el_dia_del_vencimiento_es_fijo(escena, courier):
    datos = {
        "offsets": [10, 5],
        "send_time": "07:30",
        "copy_backup": False,
        "escalation_enabled": True,
        "escalation_days": 3,
        "escalation_repeat_days": 1,
    }
    url = "/api/v1/matriz/recordatorios/configuracion/"
    assert escena["ana"].put(url, datos, format="json").status_code == 403
    assert AuditLog.objects.filter(
        action="access_denied", new_values__required_permission="matriz.configurar"
    ).exists()

    respuesta = escena["admin"].put(url, datos, format="json")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.data["offsets"] == [10, 5, 0]
    config = ConfiguracionRecordatorios.objects.todas().get(empresa=courier)
    assert config.hora_envio == datetime.time(7, 30)
    assert AuditLog.objects.filter(action="reminder_config.updated").exists()

    repetidas = escena["admin"].put(url, {**datos, "offsets": [5, 5]}, format="json")
    assert repetidas.status_code == 400
    fuera = escena["admin"].put(url, {**datos, "offsets": [91]}, format="json")
    assert fuera.status_code == 400


def test_la_vista_previa_no_envia_nada(escena):
    respuesta = escena["ana"].get(_url(escena, "vista-previa") + "?kind=vencimiento")
    assert respuesta.status_code == 200
    assert respuesta.data["subject"] == "Hoy vence — Declaración de IVA (Octubre 2026)"
    assert respuesta.data["to"] == ["ana@example.com", "beto@example.com"]
    assert "Estimado(a) Ana" in respuesta.data["text"]
    assert "28 de octubre de 2026 · 17:00" in respuesta.data["html"]
    assert f"periodo={escena['periodo'].id}" in respuesta.data["html"]
    assert mail.outbox == []

    escala = escena["ana"].get(_url(escena, "vista-previa") + "?kind=escalamiento")
    assert escala.data["to"] == ["sara@example.com"]
    assert escena["ana"].get(_url(escena, "vista-previa") + "?kind=otro").status_code == 400


def test_reenviar_siempre_sale_y_queda_en_el_historial(escena):
    for _ in range(2):
        respuesta = escena["ana"].post(_url(escena, "enviar"))
        assert respuesta.status_code == 201, respuesta.data
    assert len(mail.outbox) == 4
    assert EventoPeriodo.objects.todas().filter(accion="reminder.sent").count() == 2
    assert AuditLog.objects.filter(action="reminder.sent").count() == 2


def test_reenviar_exige_permiso(escena):
    assert escena["aldo"].post(_url(escena, "enviar")).status_code == 403
    # Beto es suplente: el período es suyo y su rol tiene `recordar`.
    assert escena["beto"].post(_url(escena, "enviar")).status_code == 201


def test_el_detalle_ofrece_reenviar_solo_a_quien_puede(escena):
    detalle = f"/api/v1/matriz/periodos/{escena['periodo'].id}/"
    assert "send_reminder" in escena["ana"].get(detalle).data["acciones"]
    assert "send_reminder" not in escena["aldo"].get(detalle).data["acciones"]


def test_la_programacion_dice_que_salio_y_que_falta(escena, monkeypatch):
    recordatorios.enviar_recordatorios(_a_las(_dias(-15)))
    monkeypatch.setattr("apps.matriz.recordatorios.timezone.now", lambda: _a_las(_dias(-5)))
    respuesta = escena["ana"].get(_url(escena))
    assert respuesta.status_code == 200
    estados = {fila["offset_days"]: fila["status"] for fila in respuesta.data["schedule"]}
    assert estados == {
        15: "enviado",
        7: "no_enviado",
        3: "programado",
        1: "programado",
        0: "programado",
    }
    assert len(respuesta.data["notifications"]) == 2
    assert respuesta.data["suspended"] is False


def test_las_notificaciones_de_la_empresa_exigen_ver_auditoria(escena, smtp_caido):
    recordatorios.enviar_recordatorios(_a_las(_dias(-7)))
    assert escena["ana"].get("/api/v1/matriz/notificaciones/").status_code == 403
    respuesta = escena["aldo"].get("/api/v1/matriz/notificaciones/?status=fallido")
    assert respuesta.status_code == 200
    assert respuesta.data["count"] == 2


def test_reintentar_a_mano(escena, smtp_caido, monkeypatch):
    recordatorios.enviar_recordatorios(_a_las(_dias(-7)))
    fallida = Notificacion.objects.todas().filter(correo="ana@example.com").get()
    monkeypatch.undo()
    url = f"/api/v1/matriz/notificaciones/{fallida.id}/reintentar/"

    assert escena["aldo"].post(url).status_code == 403
    respuesta = escena["ana"].post(url)
    assert respuesta.status_code == 201, respuesta.data
    assert respuesta.data["estado"] == "enviado"
    assert respuesta.data["intentos"] == 2
    assert respuesta.data["disparado_por"] == "Ana"
    # Lo ya reintentado no se reintenta otra vez.
    assert escena["ana"].post(url).status_code == 400


def test_el_aviso_de_otra_empresa_no_existe(escena, smtp_caido):
    recordatorios.enviar_recordatorios(_a_las(_dias(-7)))
    fallida = Notificacion.objects.todas().first()
    otra = Empresa.objects.create(nombre="Otra", codigo="OT")
    intruso = _cuenta("intruso")
    _miembro(intruso, otra, "Administrador")
    respuesta = _cliente(intruso, otra).post(
        f"/api/v1/matriz/notificaciones/{fallida.id}/reintentar/"
    )
    assert respuesta.status_code == 404
