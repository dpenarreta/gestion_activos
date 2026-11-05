"""Protección de los datos de salud (LOPDP) en las ausencias, y lo demás que
la intranet agregó al portar (visibilidad por organigrama, multiempresa).

- El permiso MÉDICO solo lo ve con su tipo y su observación el titular o
  quien tiene `ausencias.medicas_ver`. Los demás —incluidos los jefes y quien
  gestiona ausencias sin ese permiso— ven «AUSENCIA» con sus horas, y nada
  permite deducir el tipo: se enmascaran los tres, no se filtra por tipo y el
  «no puede eliminar» es el mismo para cualquiera.
- Solo `ausencias.medicas_gestionar` registra permisos médicos.
- Nada médico en la auditoría legible.
"""

from datetime import date

import pytest
from rest_framework.test import APIClient

from apps.ausencias import access
from apps.ausencias.models import LeaveRecord, SpecialStatus
from apps.core.models import AuditLog
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.modulos import modulo_de_ruta
from apps.users.models import User

from .conftest import client_for, grant, make_admin, make_user, organigrama

pytestmark = pytest.mark.django_db

URL = "/api/v1/ausencias/leave-records/"


@pytest.fixture
def admin():
    return make_admin()


@pytest.fixture
def colaboradora():
    return make_user("colaboradora")


def _medico(user, admin, **extra):
    return LeaveRecord.objects.create(
        user=user,
        created_by=admin,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=False,
        duration_minutes=120,
        observation="Control de embarazo",
        **extra,
    )


def _por_id(respuesta, pk):
    return next(r for r in respuesta.data if r["id"] == pk)


def test_el_jefe_ve_ausencia_con_horas_sin_motivo(admin, colaboradora):
    jefe = make_user("jefe", "COORDINADOR_ZS")  # tiene `ausencias.ver`
    organigrama(jefe, colaboradora)
    registro = _medico(colaboradora, admin)

    visto = _por_id(client_for(jefe).get(URL), registro.id)
    assert visto["type"] == "AUSENCIA"
    assert visto["observation"] is None
    assert visto["masked"] is True
    assert visto["durationMinutes"] == 120
    assert visto["isFullDay"] is False


def test_se_enmascaran_los_tres_tipos_para_no_deducir_el_medico(admin, colaboradora):
    jefe = make_user("jefe", "COORDINADOR_ZS")
    organigrama(jefe, colaboradora)
    for tipo in LeaveRecord.Type.values:
        LeaveRecord.objects.create(
            user=colaboradora, created_by=admin, type=tipo, date=date(2026, 1, 5), is_full_day=True
        )
    tipos = {r["type"] for r in client_for(jefe).get(URL).data}
    assert tipos == {"AUSENCIA"}


def test_sin_ausencias_ver_el_jefe_no_ve_las_de_su_equipo(admin, colaboradora):
    jefe = make_user("jefe", "ASISTENTE_GH")  # sin `ausencias.ver`
    organigrama(jefe, colaboradora)
    _medico(colaboradora, admin)
    assert client_for(jefe).get(URL).data == []


def test_quien_gestiona_sin_permiso_medico_tampoco_ve_el_motivo(admin, colaboradora):
    gestora = make_user("gestora")
    grant(gestora, access.GESTIONAR)
    registro = _medico(colaboradora, admin)
    visto = _por_id(client_for(gestora).get(URL), registro.id)
    assert visto["type"] == "AUSENCIA"
    assert visto["observation"] is None


def test_con_medicas_ver_se_ve_el_detalle(admin, colaboradora):
    registro = _medico(colaboradora, admin)
    visto = _por_id(client_for(admin).get(URL), registro.id)
    assert visto["type"] == "MEDICO"
    assert visto["observation"] == "Control de embarazo"
    assert visto["masked"] is False


def test_la_titular_ve_lo_suyo_con_detalle(admin, colaboradora):
    registro = _medico(colaboradora, admin)
    visto = _por_id(client_for(colaboradora).get(URL), registro.id)
    assert visto["type"] == "MEDICO"
    assert visto["observation"] == "Control de embarazo"


def test_filtrar_por_tipo_exige_ver_lo_medico(admin, colaboradora):
    jefe = make_user("jefe", "COORDINADOR_ZS")
    organigrama(jefe, colaboradora)
    _medico(colaboradora, admin)
    respuesta = client_for(jefe).get(f"{URL}?type=MEDICO")
    assert respuesta.status_code == 403
    assert client_for(admin).get(f"{URL}?type=MEDICO").status_code == 200


def test_solo_medicas_gestionar_registra_un_permiso_medico(colaboradora):
    gestora = make_user("gestora")
    grant(gestora, access.GESTIONAR)
    cuerpo = {
        "user_id": colaboradora.id,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-05",
        "is_full_day": True,
    }
    assert client_for(gestora).post(URL, cuerpo, format="json").status_code == 403
    cuerpo["type"] = "PERSONAL"
    assert client_for(gestora).post(URL, cuerpo, format="json").status_code == 201


def test_quien_gestiona_solo_elimina_lo_que_registro_y_con_el_mismo_mensaje(admin, colaboradora):
    gestora = make_user("gestora")
    grant(gestora, access.GESTIONAR)
    medico = _medico(colaboradora, admin)
    personal_ajeno = LeaveRecord.objects.create(
        user=colaboradora,
        created_by=admin,
        type=LeaveRecord.Type.PERSONAL,
        date=date(2026, 1, 6),
        is_full_day=True,
    )
    propio = LeaveRecord.objects.create(
        user=colaboradora,
        created_by=gestora,
        type=LeaveRecord.Type.PERSONAL,
        date=date(2026, 1, 7),
        is_full_day=True,
    )
    cliente = client_for(gestora)
    r_medico = cliente.delete(f"{URL}{medico.id}/")
    r_personal = cliente.delete(f"{URL}{personal_ajeno.id}/")
    assert r_medico.status_code == r_personal.status_code == 403
    assert r_medico.data == r_personal.data
    assert cliente.delete(f"{URL}{propio.id}/").status_code == 200
    # Y en el listado, `canDelete` tampoco distingue.
    vistos = {r["id"]: r["canDelete"] for r in cliente.get(URL).data}
    assert vistos == {medico.id: False, personal_ajeno.id: False}


def test_la_auditoria_no_lleva_el_tipo_ni_la_observacion(admin, colaboradora):
    cuerpo = {
        "user_id": colaboradora.id,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-06",
        "is_full_day": True,
        "observation": "Diagnóstico reservado",
    }
    assert client_for(admin).post(URL, cuerpo, format="json").status_code == 201
    registro = LeaveRecord.objects.filter(user=colaboradora).first()
    assert client_for(admin).delete(f"{URL}{registro.id}/").status_code == 200
    estado = {
        "user_id": colaboradora.id,
        "type": "LACTANCIA",
        "start_date": "2026-01-05",
        "daily_hours": 6,
        "limit_low": 5,
        "limit_base": 6,
        "limit_high": 7,
        "limit_overload": 8,
    }
    assert (
        client_for(admin)
        .post("/api/v1/ausencias/special-status/", estado, format="json")
        .status_code
        == 201
    )

    eventos = AuditLog.objects.filter(module="ausencias")
    assert eventos.count() == 3
    texto = " ".join(
        f"{e.action} {e.target_type} {e.previous_values} {e.new_values}" for e in eventos
    ).upper()
    for prohibido in ("MEDICO", "MÉDICO", "DIAGNÓSTICO", "LACTANCIA", "MATERNIDAD", "SPECIAL"):
        assert prohibido not in texto
    assert {e.target_type for e in eventos} == {"ausencia"}


def test_el_estado_especial_no_lo_ve_ni_el_jefe(admin, colaboradora):
    jefe = make_user("jefe", "JEFE_NACIONAL")
    organigrama(jefe, colaboradora)
    SpecialStatus.objects.create(
        user=colaboradora, created_by=admin, type="MATERNIDAD", start_date=date(2026, 1, 1)
    )
    assert client_for(jefe).get("/api/v1/ausencias/special-status/").status_code == 403
    assert access.can_see_special_status(User.objects.get(pk=jefe.pk), colaboradora.id) is False
    assert access.can_see_special_status(colaboradora, colaboradora.id) is True


def test_me_dice_si_ve_lo_medico(admin):
    assert client_for(admin).get("/api/v1/ausencias/me/").data["can_see_medical"] is True
    jefe = make_user("jefe", "JEFE_NACIONAL")
    assert client_for(jefe).get("/api/v1/ausencias/me/").data["can_see_medical"] is False


# --- Multiempresa ---------------------------------------------------------------------


def test_las_rutas_son_del_modulo_gestion_humana():
    assert modulo_de_ruta(URL) == "gestion_humana"
    assert modulo_de_ruta("/api/v1/ausencias/special-status/") == "gestion_humana"


def test_la_ausencia_de_otra_empresa_no_existe(admin, colaboradora):
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    MembresiaEmpresa.objects.create(usuario=colaboradora, empresa=otra)
    with usando_empresa(otra):
        ajena = LeaveRecord.objects.create(
            user=colaboradora,
            created_by=admin,
            type=LeaveRecord.Type.VACACIONES,
            date=date(2026, 1, 5),
            is_full_day=True,
        )
    cliente = client_for(admin)
    assert ajena.id not in {r["id"] for r in cliente.get(URL).data}
    assert cliente.delete(f"{URL}{ajena.id}/").status_code == 404


def test_no_se_registra_para_alguien_de_otra_empresa(admin):
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    with usando_empresa(otra):
        ajena = User.objects.create_user(
            username="ajena", email="ajena@example.com", password="Sup3r-Secr3t!"
        )
    MembresiaEmpresa.objects.get_or_create(usuario=ajena, empresa=otra)
    MembresiaEmpresa.objects.filter(usuario=ajena).exclude(empresa=otra).delete()
    cuerpo = {
        "user_id": ajena.id,
        "type": "VACACIONES",
        "start_date": "2026-01-05",
        "end_date": "2026-01-05",
        "is_full_day": True,
    }
    assert client_for(admin).post(URL, cuerpo, format="json").status_code == 404


def test_sin_sesion_nada():
    assert APIClient().get("/api/v1/ausencias/me/").status_code == 401
