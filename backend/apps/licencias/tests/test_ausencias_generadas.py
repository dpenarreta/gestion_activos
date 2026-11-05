"""La Solicitud de permisos genera las ausencias de Gestión Humana
(decisión del usuario del 05/11/2026).

Lo que se protege:

- Cada tipo de permiso se clasifica: `descuento` (sueldo, vacaciones o
  ninguno), `unidad` (días u horas) y `tipo_ausencia` (el `LeaveRecord` que
  genera). `descuenta_vacaciones` queda como espejo de `descuento`.
- Al aprobarse, la solicitud crea sus `LeaveRecord`: por días, uno por día
  sin feriados ni fines de semana (salvo vacaciones con su regla de sábados y
  domingos); por horas, uno solo con sus minutos. Idempotente.
- Rechazada, no genera nada; cancelada después de aprobada (por Gestión
  Humana), se borran sus ausencias y sus días de vacaciones vuelven.
- Lo que viene de una solicitud no se borra desde Ausencias (409).
- LOPDP: el motivo no se copia; nada del tipo en la auditoría de Ausencias.
"""

import datetime
import importlib
import json

import pytest
from django.apps import apps as django_apps
from rest_framework.exceptions import ValidationError

from apps.ausencias.models import LeaveRecord
from apps.ausencias.services import create_from_request
from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import Empresa
from apps.licencias import services
from apps.licencias.models import FlujoPermiso, SolicitudPermiso
from apps.licencias.tests.test_licencias import (  # noqa: F401 (fixture)
    FLUJOS,
    SOLICITUDES,
    _persona,
    empresa_con_organigrama,
)
from apps.licencias.tests.test_restricciones import _con_reglas, _periodo
from apps.organizacion.models import EventoCalendario, GoceVacaciones

D = datetime.date
AUSENCIAS = "/api/v1/ausencias/leave-records/"
MOTIVO = "Control de embarazo y exámenes de laboratorio"


@pytest.fixture
def e(empresa_con_organigrama):  # noqa: F811 (el fixture importado de test_licencias)
    return empresa_con_organigrama


def _feriado(dia, titulo="Feriado"):
    with usando_empresa(empresa_actual()):
        EventoCalendario.objects.create(titulo=titulo, tipo="feriado", fecha=dia)


def _clasificar(e, flujo, **campos):
    _, admin = e["admin"]
    respuesta = admin.patch(f"{FLUJOS}{e[flujo]}/", campos, format="json")
    assert respuesta.status_code == 200, respuesta.data
    return respuesta.json()


def _pedir(cliente, flujo, desde, hasta, **extra):
    return cliente.post(
        SOLICITUDES,
        {"flujo": flujo, "desde": desde, "hasta": hasta, "motivo": MOTIVO, **extra},
        format="multipart",
    )


def _pedida(cliente, flujo, desde, hasta, **extra):
    respuesta = _pedir(cliente, flujo, desde, hasta, **extra)
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.json()


def _aprobar_medico(e, solicitud_id):
    _, th = e["th"]
    respuesta = th.post(f"{SOLICITUDES}{solicitud_id}/aprobar/")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["estado"] == "aprobada"
    return respuesta.json()


def _aprobar_vacaciones(e, solicitud_id):
    _, jefa = e["jefa"]
    _, th = e["th"]
    assert jefa.post(f"{SOLICITUDES}{solicitud_id}/aprobar/").status_code == 200
    final = th.post(f"{SOLICITUDES}{solicitud_id}/aprobar/")
    assert final.status_code == 200, final.data
    assert final.json()["estado"] == "aprobada"


def _ausencias(solicitud_id):
    return list(LeaveRecord.objects.filter(solicitud_id=solicitud_id).order_by("date"))


def _auditoria_de_ausencias():
    return list(AuditLog.objects.filter(module="ausencias"))


# --- Clasificación de los tipos de permiso -------------------------------------------


def test_un_tipo_nuevo_es_por_dias_con_goce_y_personal(e):
    _, admin = e["admin"]
    flujo = admin.get(f"{FLUJOS}{e['medico']}/").json()
    assert flujo["descuento"] == "ninguno"
    assert flujo["unidad"] == "dias"
    assert flujo["tipo_ausencia"] == "PERSONAL"
    assert flujo["descuenta_vacaciones"] is False


@pytest.mark.parametrize(
    ("descuento", "espejo", "tipo"),
    [
        ("sueldo", False, "PERSONAL"),
        ("vacaciones", True, "VACACIONES"),
        ("ninguno", False, "PERSONAL"),
    ],
)
def test_cada_descuento_se_guarda_y_lo_lleva_la_ausencia(e, descuento, espejo, tipo):
    usuario, ana = e["ana"]
    flujo = _clasificar(e, "medico", descuento=descuento)
    assert flujo["descuento"] == descuento
    assert flujo["descuenta_vacaciones"] is espejo
    assert flujo["tipo_ausencia"] == tipo
    if descuento == "vacaciones":
        _periodo(usuario, D(2025, 6, 1))
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    [ausencia] = _ausencias(solicitud["id"])
    assert ausencia.descuento == descuento
    assert ausencia.type == tipo
    # Con descuento de vacaciones, la lógica de descuento sigue igual: el día
    # queda como gozado.
    goces = GoceVacaciones.objects.filter(periodo__usuario=usuario)
    assert goces.exists() is (descuento == "vacaciones")


def test_la_pantalla_anterior_sigue_marcando_vacaciones_con_el_booleano(e):
    flujo = _clasificar(e, "medico", descuenta_vacaciones=True)
    assert (flujo["descuento"], flujo["tipo_ausencia"]) == ("vacaciones", "VACACIONES")
    flujo = _clasificar(e, "medico", descuenta_vacaciones=False)
    assert (flujo["descuento"], flujo["tipo_ausencia"]) == ("ninguno", "PERSONAL")
    # Uno con descuento de sueldo no cambia porque llegue el booleano en falso.
    _clasificar(e, "medico", descuento="sueldo", tipo_ausencia="MEDICO")
    flujo = _clasificar(e, "medico", descuenta_vacaciones=False)
    assert (flujo["descuento"], flujo["tipo_ausencia"]) == ("sueldo", "MEDICO")


def test_la_clasificacion_incoherente_no_se_guarda(e):
    _, admin = e["admin"]
    url = f"{FLUJOS}{e['medico']}/"
    vacaciones_por_horas = admin.patch(
        url, {"descuento": "vacaciones", "unidad": "horas"}, format="json"
    )
    assert vacaciones_por_horas.status_code == 400
    assert "unidad" in str(vacaciones_por_horas.data)
    vacaciones_medicas = admin.patch(
        url, {"descuento": "vacaciones", "tipo_ausencia": "MEDICO"}, format="json"
    )
    assert vacaciones_medicas.status_code == 400
    horas_de_varios_dias = admin.patch(url, {"unidad": "horas", "dias_minimos": 2}, format="json")
    assert horas_de_varios_dias.status_code == 400
    assert admin.patch(url, {"descuento": "nada"}, format="json").status_code == 400


def test_quien_solo_escribe_el_booleano_en_el_codigo_tambien_queda_clasificado(db):
    with usando_empresa(empresa_actual()):
        flujo = FlujoPermiso.objects.create(nombre="Vacaciones 2027", descuenta_vacaciones=True)
    assert flujo.descuento == FlujoPermiso.Descuento.VACACIONES
    assert flujo.tipo_ausencia == FlujoPermiso.TipoAusencia.VACACIONES


def test_la_migracion_clasifica_los_tipos_existentes(db):
    """`licencias/0004`: `descuenta_vacaciones=True` pasa a «vacaciones»; los
    «… médico …» generan ausencias MÉDICAS; el resto, «ninguno» y PERSONAL."""
    migracion = importlib.import_module(
        "apps.licencias.migrations.0004_clasificacion_de_tipos_y_horas"
    )
    with usando_empresa(empresa_actual()):
        vacaciones = FlujoPermiso.objects.create(nombre="Vacaciones anuales")
        medico = FlujoPermiso.objects.create(nombre="Permiso Médico")
        calamidad = FlujoPermiso.objects.create(nombre="Calamidad doméstica")
    # Como estaban antes de la migración: solo el booleano.
    FlujoPermiso.objects.todas().filter(pk=vacaciones.pk).update(descuenta_vacaciones=True)

    migracion.clasificar(django_apps, None)

    def clasif(flujo):
        flujo.refresh_from_db()
        return (flujo.descuento, flujo.tipo_ausencia, flujo.unidad, flujo.descuenta_vacaciones)

    assert clasif(vacaciones) == ("vacaciones", "VACACIONES", "dias", True)
    assert clasif(medico) == ("ninguno", "MEDICO", "dias", False)
    assert clasif(calamidad) == ("ninguno", "PERSONAL", "dias", False)


# --- Aprobar por días -----------------------------------------------------------------


def test_aprobar_por_dias_salta_fin_de_semana_y_feriado(e):
    usuario, ana = e["ana"]
    _clasificar(e, "medico", descuento="sueldo", tipo_ausencia="MEDICO")
    _feriado(D(2026, 11, 9), "Feriado de prueba")
    # Del viernes 06 al martes 10: sábado, domingo y el feriado del lunes no
    # son día de trabajo.
    solicitud = _pedida(ana, e["medico"], "2026-11-06", "2026-11-10")
    _aprobar_medico(e, solicitud["id"])

    ausencias = _ausencias(solicitud["id"])
    assert [a.date for a in ausencias] == [D(2026, 11, 6), D(2026, 11, 10)]
    for ausencia in ausencias:
        assert ausencia.user_id == usuario.id
        assert ausencia.type == "MEDICO"
        assert ausencia.descuento == "sueldo"
        assert ausencia.is_full_day is True
        assert ausencia.duration_minutes is None
        # LOPDP: el motivo de la solicitud no se copia.
        assert ausencia.observation is None
        assert ausencia.empresa_id == empresa_actual().id


def test_vacaciones_con_regla_de_fines_de_semana_los_registran(e):
    _con_reglas(e)
    usuario, ana = e["ana"]
    _periodo(usuario, D(2025, 6, 1))
    _feriado(D(2026, 11, 3), "Independencia de Cuenca")
    solicitud = _pedida(ana, e["vacaciones"], "2026-11-02", "2026-11-08")
    _aprobar_vacaciones(e, solicitud["id"])

    ausencias = _ausencias(solicitud["id"])
    # Lunes 02 a domingo 08, sin el feriado del martes 03; el sábado y el
    # domingo cuentan porque el tipo pide sábados y domingos por período.
    assert [a.date.day for a in ausencias] == [2, 4, 5, 6, 7, 8]
    assert {a.type for a in ausencias} == {"VACACIONES"}
    assert {a.descuento for a in ausencias} == {"vacaciones"}


def test_la_auditoria_de_ausencias_no_lleva_el_tipo_ni_el_motivo(e):
    _, ana = e["ana"]
    _clasificar(e, "medico", tipo_ausencia="MEDICO")
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    [evento] = _auditoria_de_ausencias()
    assert evento.action == "ausencias.registro_creado"
    texto = json.dumps(evento.new_values, ensure_ascii=False).lower()
    assert "medic" not in texto and "médic" not in texto
    assert MOTIVO.lower() not in texto
    assert evento.new_values["origen"] == "solicitud"


# --- Aprobar por horas ------------------------------------------------------------------


def test_aprobar_por_horas_crea_una_sola_ausencia_con_sus_minutos(e):
    _, ana = e["ana"]
    _clasificar(e, "medico", unidad="horas", tipo_ausencia="MEDICO")
    solicitud = _pedida(
        ana, e["medico"], "2026-11-05", "2026-11-05", hora_desde="09:00", hora_hasta="11:30"
    )
    assert (solicitud["hora_desde"], solicitud["hora_hasta"]) == ("09:00", "11:30")
    assert solicitud["unidad"] == "horas"
    assert solicitud["minutos"] == 150
    _aprobar_medico(e, solicitud["id"])

    [ausencia] = _ausencias(solicitud["id"])
    assert ausencia.date == D(2026, 11, 5)
    assert ausencia.is_full_day is False
    assert ausencia.duration_minutes == 150
    assert ausencia.type == "MEDICO"


@pytest.mark.parametrize(
    ("hasta", "horas", "campo"),
    [
        ("2026-11-05", {}, "hora_desde"),
        ("2026-11-05", {"hora_desde": "09:00"}, "hora_hasta"),
        ("2026-11-06", {"hora_desde": "09:00", "hora_hasta": "10:00"}, "hasta"),
        ("2026-11-05", {"hora_desde": "11:00", "hora_hasta": "11:00"}, "hora_hasta"),
        ("2026-11-05", {"hora_desde": "11:00", "hora_hasta": "08:00"}, "hora_hasta"),
    ],
)
def test_las_horas_se_validan_en_la_api(e, hasta, horas, campo):
    _, ana = e["ana"]
    _clasificar(e, "medico", unidad="horas")
    respuesta = _pedir(ana, e["medico"], "2026-11-05", hasta, **horas)
    assert respuesta.status_code == 400
    assert campo in respuesta.json()["error"]["details"]
    assert not SolicitudPermiso.objects.exists()


def test_un_tipo_por_dias_no_lleva_horas(e):
    _, ana = e["ana"]
    respuesta = _pedir(
        ana, e["medico"], "2026-11-05", "2026-11-05", hora_desde="09:00", hora_hasta="10:00"
    )
    assert respuesta.status_code == 400
    assert "hora_desde" in respuesta.json()["error"]["details"]


def test_las_horas_se_validan_tambien_en_el_servicio(e):
    usuario, _ = e["ana"]
    _clasificar(e, "medico", unidad="horas")
    flujo = FlujoPermiso.objects.get(pk=e["medico"])
    with pytest.raises(ValidationError):
        services.crear(usuario, flujo, desde=D(2026, 11, 5), hasta=D(2026, 11, 5))
    with pytest.raises(ValidationError):
        services.crear(
            usuario,
            flujo,
            desde=D(2026, 11, 5),
            hasta=D(2026, 11, 5),
            hora_desde=datetime.time(10, 0),
            hora_hasta=datetime.time(9, 0),
        )
    assert not SolicitudPermiso.objects.exists()


# --- Idempotencia, rechazo y cancelación ---------------------------------------------


def test_aprobar_dos_veces_o_reintentar_no_duplica(e):
    _, ana = e["ana"]
    th_usuario, th = e["th"]
    solicitud = _pedida(ana, e["medico"], "2026-11-04", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    assert len(_ausencias(solicitud["id"])) == 2

    assert th.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").status_code == 400
    objeto = SolicitudPermiso.objects.get(pk=solicitud["id"])
    create_from_request(objeto, actor=th_usuario)
    assert len(_ausencias(solicitud["id"])) == 2
    assert len(_auditoria_de_ausencias()) == 1


def test_rechazar_no_genera_ausencias(e):
    _, ana = e["ana"]
    _, th = e["th"]
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    respuesta = th.post(f"{SOLICITUDES}{solicitud['id']}/rechazar/", {"comentario": "No procede"})
    assert respuesta.json()["estado"] == "rechazada"
    assert not LeaveRecord.objects.exists()
    assert _auditoria_de_ausencias() == []


def test_una_pendiente_no_genera_ausencias(e):
    _, ana = e["ana"]
    _, jefa = e["jefa"]
    solicitud = _pedida(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    jefa.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/")  # Falta Talento Humano.
    assert not LeaveRecord.objects.exists()


def test_gestion_humana_cancela_una_aprobada_y_se_borran_sus_ausencias(e):
    _, ana = e["ana"]
    _, admin = e["admin"]
    solicitud = _pedida(ana, e["medico"], "2026-11-04", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    assert len(_ausencias(solicitud["id"])) == 2

    # Quien la pidió ya no la cancela (como antes); Gestión Humana sí, con motivo.
    assert ana.post(f"{SOLICITUDES}{solicitud['id']}/cancelar/").status_code == 400
    detalle = admin.get(f"{SOLICITUDES}{solicitud['id']}/").json()
    assert detalle["puedo"]["cancelar"] is True
    assert detalle["puedo"]["cancelar_pide_comentario"] is True
    sin_motivo = admin.post(f"{SOLICITUDES}{solicitud['id']}/cancelar/")
    assert sin_motivo.status_code == 400
    assert len(_ausencias(solicitud["id"])) == 2

    cancelada = admin.post(
        f"{SOLICITUDES}{solicitud['id']}/cancelar/", {"comentario": "Se reincorporó antes"}
    )
    assert cancelada.status_code == 200, cancelada.data
    assert cancelada.json()["estado"] == "cancelada"
    assert _ausencias(solicitud["id"]) == []
    acciones = [a.action for a in _auditoria_de_ausencias()]
    assert acciones.count("ausencias.registro_eliminado") == 1


def test_cancelar_unas_vacaciones_aprobadas_devuelve_sus_dias(e):
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, admin = e["admin"]
    periodo = _periodo(usuario, D(2025, 6, 1))
    solicitud = _pedida(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    _aprobar_vacaciones(e, solicitud["id"])
    with usando_empresa(empresa_actual()):
        assert sum(g.dias for g in periodo.goces.all()) == 5

    admin.post(f"{SOLICITUDES}{solicitud['id']}/cancelar/", {"comentario": "Error de fechas"})
    with usando_empresa(empresa_actual()):
        assert not periodo.goces.exists()
    assert _ausencias(solicitud["id"]) == []


def test_quien_no_ve_todas_no_cancela_una_aprobada_ajena(e):
    _, ana = e["ana"]
    _, th = e["th"]
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    respuesta = th.post(f"{SOLICITUDES}{solicitud['id']}/cancelar/", {"comentario": "x"})
    assert respuesta.status_code == 403
    assert len(_ausencias(solicitud["id"])) == 1


# --- Desde Ausencias: lo de una solicitud no se toca a mano ---------------------------


def test_lo_que_viene_de_una_solicitud_no_se_borra_desde_ausencias(e):
    usuario, ana = e["ana"]
    _clasificar(e, "medico", tipo_ausencia="MEDICO")
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    [ausencia] = _ausencias(solicitud["id"])

    _, gestora = _persona(
        "gabriela", "ausencias.medicas_gestionar", "ausencias.medicas_ver", "ausencias.gestionar"
    )
    lista = gestora.get(AUSENCIAS, {"user_id": usuario.id}).json()
    [fila] = [f for f in lista if f["id"] == ausencia.id]
    assert fila["solicitudId"] == solicitud["id"]
    assert fila["descuento"] == "ninguno"
    assert fila["canDelete"] is False

    respuesta = gestora.delete(f"{AUSENCIAS}{ausencia.id}/")
    assert respuesta.status_code == 409
    error = respuesta.json()["error"]
    assert error["code"] == "linked_to_request"
    assert error["message"] == (
        f"Este registro viene de la solicitud N.º {solicitud['id']}; "
        "gestiónelo desde Solicitud de permisos."
    )
    assert error["details"] == {"solicitud_id": solicitud["id"]}
    assert LeaveRecord.objects.filter(pk=ausencia.id).exists()

    # Los manuales siguen funcionando.
    manual = gestora.post(
        AUSENCIAS,
        {
            "user_id": usuario.id,
            "type": "PERSONAL",
            "start_date": "2026-11-12",
            "end_date": "2026-11-12",
            "is_full_day": True,
        },
        format="json",
    )
    assert manual.status_code == 201, manual.data
    manual_id = manual.json()["records"][0]["id"]
    assert manual.json()["records"][0]["solicitudId"] is None
    assert gestora.delete(f"{AUSENCIAS}{manual_id}/").status_code == 200


def test_quien_no_ve_la_ausencia_recibe_404_y_no_409(e):
    """El 409 nombra la solicitud: solo lo recibe quien ya ve la ausencia."""
    _, ana = e["ana"]
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    [ausencia] = _ausencias(solicitud["id"])
    _, ajeno = _persona("rodrigo")
    assert ajeno.delete(f"{AUSENCIAS}{ausencia.id}/").status_code == 404


# --- Aislamiento por empresa -----------------------------------------------------------


def test_las_ausencias_generadas_son_de_la_empresa_de_la_solicitud(e):
    _, ana = e["ana"]
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    [ausencia] = _ausencias(solicitud["id"])
    assert ausencia.empresa_id == SolicitudPermiso.objects.get(pk=solicitud["id"]).empresa_id

    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    with usando_empresa(otra):
        assert not LeaveRecord.objects.filter(pk=ausencia.id).exists()
        assert not SolicitudPermiso.objects.filter(pk=solicitud["id"]).exists()
