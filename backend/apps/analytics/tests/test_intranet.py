"""Lo propio de la intranet: lo que no existía en Nexo y se agregó al portar
el motor de KPI.

- Multiempresa: las tareas, los ajustes, la auditoría del motor y la fecha de
  inicio de otra empresa no cuentan ni se ven; la persona de otra empresa no
  existe (404).
- Jerarquía por organigrama: un jefe ve a quien depende de su cargo (directa
  o indirectamente), no a sus pares ni a sus jefes, y solo con `kpi.equipo`.
- LOPDP: el motivo de una ausencia (médico) y el estado especial se
  enmascaran para quien no es el titular ni tiene el permiso de Ausencias.
- Acceso por permisos del catálogo y ajustes del motor con auditoría.
"""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group, Permission

from apps.analytics.configuracion import get_effective_analytics_config
from apps.analytics.models import AnalyticsAuditLog, KpiStartDate
from apps.ausencias.models import LeaveRecord, SpecialStatus
from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.modulos import modulo_de_ruta
from apps.organizacion.models import Cargo, DatosDeContacto
from apps.tasks.models import Task
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import client_for, freeze_now, make_admin, make_user, organigrama

pytestmark = pytest.mark.django_db

BASE = "/api/v1/analytics"
#: Miércoles 14/01/2026, 10:00 UTC (05:00 en Ecuador): día hábil.
NOW = datetime(2026, 1, 14, 15, 0, tzinfo=dt_timezone.utc)
HOY = date(2026, 1, 14)


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    freeze_now(monkeypatch, NOW)


@pytest.fixture
def otra_empresa():
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


def _tarea(asignada, *, empresa=None, **extra) -> Task:
    campos = {
        "title": "Tarea",
        "priority": "MEDIA",
        "frequency": "PUNTUAL",
        "start_date": datetime(2026, 1, 2, tzinfo=dt_timezone.utc),
        "end_date": datetime(2026, 1, 12, tzinfo=dt_timezone.utc),
        "estimated_hours": 2,
        "assigned_to": asignada,
        "created_by": asignada,
        "status": Task.Status.COMPLETADA,
        "completed_at": datetime(2026, 1, 10, 15, tzinfo=dt_timezone.utc),
        **extra,
    }
    if empresa is None:
        return Task.objects.create(**campos)
    with usando_empresa(empresa):
        return Task.objects.create(**campos)


def _otorgar(user: User, *codenames: str) -> None:
    for codename in codenames:
        user.user_permissions.add(
            Permission.objects.get(content_type__app_label="permissions", codename=codename)
        )


# --- Acceso al módulo -------------------------------------------------------


def test_las_rutas_son_del_modulo_gestion_humana():
    assert modulo_de_ruta(f"{BASE}/kpis/me/") == "gestion_humana"
    assert modulo_de_ruta(f"{BASE}/predictive/team-alerts/") == "gestion_humana"


def test_sin_sesion_no_hay_modulo():
    from rest_framework.test import APIClient

    assert APIClient().get(f"{BASE}/kpis/me/").status_code == 401


def test_quien_no_es_de_gestion_humana_no_entra():
    """Una cuenta de la empresa sin `kpi.acceder` (TI, por ejemplo): 403."""
    ti = make_user("ti")
    MembresiaEmpresa.objects.filter(usuario=ti).first().roles.clear()
    respuesta = client_for(ti).get(f"{BASE}/kpis/me/")
    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"


def test_el_administrador_de_ti_no_entra():
    """Decisión del usuario (05/11/2026): el rol «Administrador» no ve el KPI
    de Gestión Humana, como en Tareas."""
    ti = make_user("ti_admin", "Administrador")
    MembresiaEmpresa.objects.filter(usuario=ti).first().roles.clear()
    assert client_for(ti).get(f"{BASE}/kpis/me/").status_code == 403


@pytest.mark.parametrize(
    "rol",
    [
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
        ADMIN_GH,
    ],
)
def test_cada_rol_de_gestion_humana_ve_sus_kpi(rol):
    persona = make_user("gh", rol)
    MembresiaEmpresa.objects.filter(usuario=persona).first().roles.clear()
    respuesta = client_for(persona).get(f"{BASE}/me/")
    assert respuesta.status_code == 200
    assert respuesta.json()["role"] == rol
    assert "kpi.acceder" in respuesta.json()["permissions"]
    assert client_for(persona).get(f"{BASE}/kpis/me/").status_code == 200


def test_me_resume_permisos_cargo_y_equipo():
    jefa = make_user("jefa", "COORDINADOR_NACIONAL")
    organigrama(jefa, make_user("ana", "ANALISTA_CC"))
    datos = client_for(jefa).get(f"{BASE}/me/").json()
    assert datos["has_cargo"] is True
    assert datos["team_size"] == 1
    assert {"kpi.acceder", "kpi.equipo", "kpi.ejecutivo", "inteligencia_preventiva.ver"} <= set(
        datos["permissions"]
    )
    assert datos["is_admin"] is False
    assert datos["engine_version"] == "1.5.0"
    assert datos["formula_set_version"] == "4.4"


def test_month_malformado_es_400_del_contrato():
    """En Nexo reventaba con 500."""
    persona = make_user("ana", "ANALISTA_CC")
    respuesta = client_for(persona).get(f"{BASE}/kpis/me/?month=2026-13")
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "invalid"
    assert "month" in respuesta.json()["error"]["details"]


# --- Multiempresa -----------------------------------------------------------


def test_la_persona_de_otra_empresa_no_existe(otra_empresa):
    admin = make_admin()
    with usando_empresa(otra_empresa):
        ajena = User.objects.create_user(
            username="ajena", email="ajena@example.com", password="Sup3r-Secr3t!"
        )
    MembresiaEmpresa.objects.filter(usuario=ajena).delete()
    MembresiaEmpresa.objects.create(usuario=ajena, empresa=otra_empresa)
    cliente = client_for(admin)
    for ruta in (
        f"kpis/{ajena.id}/",
        f"{ajena.id}/",
        f"insights/{ajena.id}/",
        f"benchmarks/{ajena.id}/",
        f"predictive/predictions/{ajena.id}/",
        f"predictive/alerts/{ajena.id}/",
    ):
        respuesta = cliente.get(f"{BASE}/{ruta}")
        assert respuesta.status_code == 404, ruta
        assert respuesta.json()["error"]["code"] == "not_found"


def test_las_tareas_de_otra_empresa_no_cuentan(otra_empresa):
    ana = make_user("ana", "ANALISTA_CC")
    MembresiaEmpresa.objects.create(usuario=ana, empresa=otra_empresa)
    _tarea(ana)
    _tarea(ana, empresa=otra_empresa, status=Task.Status.PENDIENTE, completed_at=None)
    _tarea(ana, empresa=otra_empresa, status=Task.Status.PENDIENTE, completed_at=None)

    datos = client_for(ana).get(f"{BASE}/kpis/me/?month=2026-01").json()
    assert datos["cumplimiento"]["total"] == 1
    assert datos["cumplimiento"]["completed_pct"] == 100


def test_la_auditoria_del_motor_queda_en_su_empresa(otra_empresa):
    ana = make_user("ana", "ANALISTA_CC")
    client_for(ana).get(f"{BASE}/{ana.id}/")
    empresa = empresa_actual()
    assert AnalyticsAuditLog.objects.filter(user=ana, kind="performance_score").exists()
    assert set(
        AnalyticsAuditLog.objects.todas().filter(user=ana).values_list("empresa_id", flat=True)
    ) == {empresa.id}
    with usando_empresa(otra_empresa):
        assert not AnalyticsAuditLog.objects.filter(user=ana).exists()


def test_los_ajustes_del_motor_son_de_cada_empresa(otra_empresa):
    admin = make_admin()
    respuesta = client_for(admin).patch(
        f"{BASE}/settings/analytics-config/",
        {"alert_overdue_task_threshold": 7},
        format="json",
    )
    assert respuesta.status_code == 200
    assert get_effective_analytics_config(NOW)["alert_overdue_task_threshold"] == 7
    with usando_empresa(otra_empresa):
        assert get_effective_analytics_config(NOW)["alert_overdue_task_threshold"] == 3


def test_la_fecha_de_inicio_es_de_cada_empresa(otra_empresa):
    from apps.analytics.configuracion import kpi_start_date_of

    ana = make_user("ana", "ANALISTA_CC")
    KpiStartDate.objects.create(
        user=ana, kpi_start_date=datetime(2026, 1, 10, tzinfo=dt_timezone.utc)
    )
    assert kpi_start_date_of(ana) is not None
    with usando_empresa(otra_empresa):
        assert kpi_start_date_of(ana) is None


def test_el_equipo_de_un_cargo_de_otra_empresa_no_cuenta(otra_empresa):
    jefa = make_user("jefa", "COORDINADOR_NACIONAL")
    ana = make_user("ana", "ANALISTA_CC")
    MembresiaEmpresa.objects.create(usuario=jefa, empresa=otra_empresa)
    MembresiaEmpresa.objects.create(usuario=ana, empresa=otra_empresa)
    with usando_empresa(otra_empresa):
        arriba = Cargo.objects.create(nombre="Jefatura")
        DatosDeContacto.objects.create(usuario=jefa, cargo=arriba)
        DatosDeContacto.objects.create(
            usuario=ana, cargo=Cargo.objects.create(nombre="Analista", jefe=arriba)
        )
    assert client_for(jefa).get(f"{BASE}/kpis/{ana.id}/").status_code == 403
    assert client_for(jefa).get(f"{BASE}/kpis/team/").json()["users"] == []


# --- Jerarquía por organigrama ----------------------------------------------


@pytest.fixture
def linea():
    """Coordinación Nacional → Coordinación ZS → Asistente; y una analista
    que es par de la Coordinación ZS."""
    nacional = make_user("nacional", "COORDINADOR_NACIONAL", first_name="Nadia")
    zs = make_user("zs", "COORDINADOR_ZS", first_name="Zoe")
    asistente = make_user("asistente", "ASISTENTE_GH_ZS", first_name="Ada")
    par = make_user("par", "ANALISTA_CC", first_name="Pía")
    organigrama(nacional, zs, par)
    organigrama(zs, asistente)
    return {"nacional": nacional, "zs": zs, "asistente": asistente, "par": par}


def test_el_jefe_ve_a_su_equipo_directo_e_indirecto(linea):
    cliente = client_for(linea["nacional"])
    assert cliente.get(f"{BASE}/kpis/{linea['zs'].id}/").status_code == 200
    assert cliente.get(f"{BASE}/kpis/{linea['asistente'].id}/").status_code == 200


def test_nadie_ve_a_su_par_ni_a_su_jefe(linea):
    cliente = client_for(linea["zs"])
    assert cliente.get(f"{BASE}/kpis/{linea['par'].id}/").status_code == 403
    assert cliente.get(f"{BASE}/kpis/{linea['nacional'].id}/").status_code == 403


def test_sin_kpi_equipo_el_organigrama_no_basta(linea):
    """Ser jefe en el organigrama no da los KPI del equipo: hace falta el
    permiso (en Nexo, `can_view_team`)."""
    jefa = make_user("jefa_sin_permiso", "ASISTENTE_GH")
    ada = make_user("subordinada", "ASISTENTE_GH")
    organigrama(jefa, ada)
    assert client_for(jefa).get(f"{BASE}/kpis/{ada.id}/").status_code == 403
    assert client_for(jefa).get(f"{BASE}/kpis/team/").status_code == 403


def test_la_vista_de_equipo_es_su_organigrama(linea):
    ids = {u["id"] for u in client_for(linea["nacional"]).get(f"{BASE}/kpis/team/").json()["users"]}
    assert ids == {linea["zs"].id, linea["asistente"].id, linea["par"].id}
    ids_zs = {u["id"] for u in client_for(linea["zs"]).get(f"{BASE}/kpis/team/").json()["users"]}
    assert ids_zs == {linea["asistente"].id}


def test_el_equipo_no_incluye_a_quien_no_tiene_rol_de_gestion_humana(linea):
    """En Nexo, sin grupo no se era ejecutor."""
    sin_rol = make_user("sin_rol")
    organigrama(linea["zs"], sin_rol)
    ids = {u["id"] for u in client_for(linea["zs"]).get(f"{BASE}/kpis/team/").json()["users"]}
    assert sin_rol.id not in ids


def test_quien_administra_ve_a_todo_gestion_humana_de_la_empresa(linea):
    admin = make_admin()
    cliente = client_for(admin)
    assert cliente.get(f"{BASE}/kpis/{linea['par'].id}/").status_code == 200
    ids = {u["id"] for u in cliente.get(f"{BASE}/kpis/team/").json()["users"]}
    assert {linea["zs"].id, linea["asistente"].id, linea["par"].id} <= ids
    # El liderazgo (nivel >= 4) no es sujeto de ejecución.
    jefe = make_user("jefe", "JEFE_NACIONAL")
    ids = {u["id"] for u in cliente.get(f"{BASE}/kpis/team/").json()["users"]}
    assert jefe.id not in ids


def test_las_alertas_preventivas_de_equipo_siguen_el_organigrama(linea):
    respuesta = client_for(linea["zs"]).get(f"{BASE}/predictive/team-subutilization/")
    assert respuesta.status_code == 200
    assert {m["user_id"] for m in respuesta.json()["members"]} == {linea["asistente"].id}


def test_riesgo_operativo_exige_su_permiso_ademas_del_organigrama(linea):
    """La analista no tiene `inteligencia_preventiva.ver`, ni para sí misma."""
    assert (
        client_for(linea["par"]).get(f"{BASE}/operational-risk/{linea['par'].id}/").status_code
        == 403
    )
    assert (
        client_for(linea["zs"]).get(f"{BASE}/operational-risk/{linea['asistente'].id}/").status_code
        == 200
    )


def test_el_historial_de_riesgo_exige_su_permiso(linea):
    cliente = client_for(linea["par"])
    assert (
        cliente.get(f"{BASE}/history/{linea['par'].id}/?kind=performance_score").status_code == 200
    )
    assert (
        cliente.get(f"{BASE}/history/{linea['par'].id}/?kind=operational_risk").status_code == 403
    )


# --- LOPDP: ausencias médicas y estados especiales ---------------------------


@pytest.fixture
def con_ausencia_medica():
    jefa = make_user("jefa", "COORDINADOR_NACIONAL")
    ana = make_user("ana", "ANALISTA_CC")
    organigrama(jefa, ana)
    admin = make_admin("admin_reg")
    LeaveRecord.objects.create(
        user=ana,
        type=LeaveRecord.Type.MEDICO,
        date=HOY,
        is_full_day=False,
        duration_minutes=90,
        observation="Control médico",
        created_by=admin,
    )
    LeaveRecord.objects.create(
        user=ana,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 12),
        is_full_day=True,
        created_by=admin,
    )
    SpecialStatus.objects.create(
        user=ana,
        type=SpecialStatus.Type.LACTANCIA,
        start_date=date(2026, 1, 1),
        daily_hours=6,
        limit_low=5,
        limit_base=6,
        limit_high=7,
        limit_overload=8,
        created_by=admin,
    )
    return jefa, ana


def test_el_jefe_ve_ausencia_y_horas_sin_el_motivo_medico(con_ausencia_medica):
    jefa, ana = con_ausencia_medica
    carga = client_for(jefa).get(f"{BASE}/kpis/{ana.id}/").json()["carga_tiempo"]
    assert carga["sensitive_detail_visible"] is False
    # Hoy: los minutos se ven como una sola ausencia, sin el tipo.
    assert carga["diaria"]["medico_leave_minutes"] == 0
    assert carga["diaria"]["personal_leave_minutes"] == 90
    assert carga["diaria"]["special_status_type"] is None
    # El mes: el total como «ausencia».
    assert carga["mensual"]["medico_leave_minutes"] == 0
    assert carga["mensual"]["ausencia_minutes"] > 0
    assert carga["mensual"]["special_status_type"] is None
    # El historial diario: el día completo de permiso es «leave-generic».
    kinds = {p["date"]: p["kind"] for p in carga["daily_history"]}
    assert kinds["2026-01-12"] == "leave-generic"
    assert all(p["special_status_type"] is None for p in carga["daily_history"])
    assert "MEDICO" not in str(carga)
    assert "LACTANCIA" not in str(carga)
    assert "Control médico" not in str(carga)


def test_las_horas_no_cambian_al_enmascarar(con_ausencia_medica):
    jefa, ana = con_ausencia_medica
    del_jefe = client_for(jefa).get(f"{BASE}/kpis/{ana.id}/").json()
    propio = client_for(ana).get(f"{BASE}/kpis/me/").json()
    assert (
        del_jefe["carga_tiempo"]["diaria"]["base_hours"]
        == propio["carga_tiempo"]["diaria"]["base_hours"]
    )
    assert (
        del_jefe["carga_tiempo"]["mensual"]["base_hours"]
        == propio["carga_tiempo"]["mensual"]["base_hours"]
    )
    assert del_jefe["carga_laboral"] == propio["carga_laboral"]


def test_la_titular_ve_su_detalle(con_ausencia_medica):
    _jefa, ana = con_ausencia_medica
    carga = client_for(ana).get(f"{BASE}/kpis/{ana.id}/").json()["carga_tiempo"]
    assert carga["sensitive_detail_visible"] is True
    assert carga["diaria"]["medico_leave_minutes"] == 90
    assert carga["diaria"]["special_status_type"] == "LACTANCIA"
    kinds = {p["date"]: p["kind"] for p in carga["daily_history"]}
    assert kinds["2026-01-12"] == "leave-medico"


def test_con_permiso_medico_el_jefe_ve_el_detalle(con_ausencia_medica):
    jefa, ana = con_ausencia_medica
    _otorgar(jefa, "ausencias.medicas_ver")
    carga = client_for(jefa).get(f"{BASE}/kpis/{ana.id}/").json()["carga_tiempo"]
    assert carga["sensitive_detail_visible"] is True
    assert carga["diaria"]["medico_leave_minutes"] == 90


def test_quien_gestiona_estados_especiales_ve_el_tipo_pero_no_el_motivo(con_ausencia_medica):
    jefa, ana = con_ausencia_medica
    _otorgar(jefa, "ausencias.estados_gestionar")
    carga = client_for(jefa).get(f"{BASE}/kpis/{ana.id}/").json()["carga_tiempo"]
    assert carga["sensitive_detail_visible"] is False
    assert carga["diaria"]["special_status_type"] == "LACTANCIA"
    assert carga["diaria"]["medico_leave_minutes"] == 0


def test_quien_administra_gestion_humana_ve_el_detalle(con_ausencia_medica):
    _jefa, ana = con_ausencia_medica
    carga = client_for(make_admin()).get(f"{BASE}/kpis/{ana.id}/").json()["carga_tiempo"]
    assert carga["sensitive_detail_visible"] is True
    assert carga["diaria"]["medico_leave_full_day"] is False
    assert carga["diaria"]["medico_leave_minutes"] == 90


def test_la_auditoria_del_motor_no_guarda_el_tipo_de_ausencia(con_ausencia_medica):
    jefa, ana = con_ausencia_medica
    client_for(jefa).get(f"{BASE}/{ana.id}/")
    for registro in AnalyticsAuditLog.objects.filter(user=ana):
        assert "MEDICO" not in str(registro.inputs) + str(registro.result)
        assert "LACTANCIA" not in str(registro.inputs) + str(registro.result)


# --- Ajustes del motor ------------------------------------------------------


def test_leer_ajustes_basta_con_acceder_y_cambiarlos_exige_administrar():
    ana = make_user("ana", "ANALISTA_CC")
    cliente = client_for(ana)
    assert cliente.get(f"{BASE}/settings/analytics-config/").status_code == 200
    respuesta = cliente.patch(
        f"{BASE}/settings/analytics-config/", {"alert_overdue_task_threshold": 5}, format="json"
    )
    assert respuesta.status_code == 403


def test_las_ponderaciones_deben_sumar_100():
    respuesta = client_for(make_admin()).patch(
        f"{BASE}/settings/analytics-config/", {"perf_weight_cumplimiento": 50}, format="json"
    )
    assert respuesta.status_code == 400
    assert "deben sumar 100" in respuesta.json()["error"]["message"]


def test_los_umbrales_de_riesgo_deben_ir_en_orden():
    respuesta = client_for(make_admin()).patch(
        f"{BASE}/settings/analytics-config/", {"risk_threshold_alto": 20}, format="json"
    )
    assert respuesta.status_code == 400


def test_clave_desconocida_o_fuera_de_rango_es_400():
    cliente = client_for(make_admin())
    respuesta = cliente.patch(f"{BASE}/settings/analytics-config/", {"inventada": 1}, format="json")
    assert respuesta.status_code == 400
    assert "inventada" in respuesta.json()["error"]["details"]
    respuesta = cliente.patch(
        f"{BASE}/settings/analytics-config/", {"alert_overdue_task_threshold": 0}, format="json"
    )
    assert respuesta.status_code == 400


def test_un_cambio_de_ajustes_queda_auditado():
    admin = make_admin()
    client_for(admin).patch(
        f"{BASE}/settings/analytics-config/", {"alert_overdue_task_threshold": 6}, format="json"
    )
    evento = AuditLog.objects.filter(action="kpi.ajustes_motor").latest("id")
    assert evento.new_values == {"alert_overdue_task_threshold": 6}
    assert evento.previous_values == {"alert_overdue_task_threshold": 3}


def test_limites_de_carga_mantienen_el_orden():
    cliente = client_for(make_admin())
    assert cliente.get(f"{BASE}/settings/workload-config/").json()["workload_limit_low"] == 5.5
    respuesta = cliente.put(
        f"{BASE}/settings/workload-config/", {"workload_limit_high": 6}, format="json"
    )
    assert respuesta.status_code == 400  # 6 < horas efectivas (6.5)
    respuesta = cliente.put(
        f"{BASE}/settings/workload-config/", {"workload_limit_high": 7.75}, format="json"
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["workload_limit_high"] == 7.75


def test_ventana_de_prediccion_solo_acepta_sus_opciones():
    cliente = client_for(make_admin())
    assert (
        cliente.put(
            f"{BASE}/settings/prediction-window/", {"window_weeks": "5"}, format="json"
        ).status_code
        == 400
    )
    respuesta = cliente.put(
        f"{BASE}/settings/prediction-window/", {"window_weeks": "6"}, format="json"
    )
    assert respuesta.json()["window_weeks"] == "6"


def test_curva_invalida_es_400_y_valida_se_guarda():
    cliente = client_for(make_admin())
    malo = cliente.patch(
        f"{BASE}/settings/normalization-curves/",
        {"name": "carga", "points": [{"x": 0, "y": 150}, {"x": 1, "y": 1}]},
        format="json",
    )
    assert malo.status_code == 400
    bueno = cliente.patch(
        f"{BASE}/settings/normalization-curves/",
        {"name": "carga", "points": [{"x": 0, "y": 0}, {"x": 100, "y": 100}]},
        format="json",
    )
    assert bueno.status_code == 200
    assert bueno.json()["curves"]["carga"] == [{"x": 0, "y": 0}, {"x": 100, "y": 100}]


def test_objetivo_del_cargo_y_compatibilidad_regla_4():
    cliente = client_for(make_admin())
    respuesta = cliente.patch(
        f"{BASE}/settings/role-targets/",
        {
            "role": "ANALISTA_CC",
            "target": {"performance": 80, "riesgo_max": None, "cumplimiento": 90},
        },
        format="json",
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["targets"]["ANALISTA_CC"]["performance"] == 80
    # Regla 4: nunca entre niveles distintos (Coordinador ZS 2 vs Asistente 1).
    respuesta = cliente.patch(
        f"{BASE}/settings/role-compatibility/",
        {"role": "COORDINADOR_ZS", "compatible_roles": ["ASISTENTE_GH"]},
        format="json",
    )
    assert respuesta.status_code == 400
    respuesta = cliente.patch(
        f"{BASE}/settings/role-compatibility/",
        {"role": "COORDINADOR_ZS", "compatible_roles": ["ANALISTA_CC", "COORDINADOR_ZS"]},
        format="json",
    )
    assert respuesta.json()["matrix"]["COORDINADOR_ZS"] == ["ANALISTA_CC"]


def test_fecha_de_inicio_del_kpi():
    admin = make_admin()
    ana = make_user("ana", "ANALISTA_CC")
    cliente = client_for(admin)
    respuesta = cliente.patch(
        f"{BASE}/settings/kpi-start-date/",
        {"user_id": ana.id, "kpi_start_date": "2026-01-10"},
        format="json",
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["kpi_start_date"] == "2026-01-10"
    carga = client_for(ana).get(f"{BASE}/kpis/me/").json()["carga_tiempo"]
    assert carga["kpi_start_date"].startswith("2026-01-10")
    lista = {
        p["id"]: p["kpi_start_date"] for p in cliente.get(f"{BASE}/settings/kpi-start-date/").json()
    }
    assert lista[ana.id] == "2026-01-10"
    respuesta = cliente.patch(
        f"{BASE}/settings/kpi-start-date/",
        {"user_id": ana.id, "kpi_start_date": None},
        format="json",
    )
    assert respuesta.json()["kpi_start_date"] is None
    assert AuditLog.objects.filter(action="kpi.fecha_inicio").count() == 2


def test_fecha_de_inicio_exige_administrar_y_persona_de_la_empresa(otra_empresa):
    ana = make_user("ana", "ANALISTA_CC")
    assert client_for(ana).get(f"{BASE}/settings/kpi-start-date/").status_code == 403
    ajena = User.objects.create_user(
        username="ajena", email="ajena@example.com", password="Sup3r-Secr3t!"
    )
    MembresiaEmpresa.objects.filter(usuario=ajena).delete()
    respuesta = client_for(make_admin()).patch(
        f"{BASE}/settings/kpi-start-date/",
        {"user_id": ajena.id, "kpi_start_date": "2026-01-10"},
        format="json",
    )
    assert respuesta.status_code == 404


def test_el_diagnostico_es_solo_de_quien_administra():
    assert (
        client_for(make_user("ana", "ANALISTA_CC")).get(f"{BASE}/diagnostics/").status_code == 403
    )
    datos = client_for(make_admin()).get(f"{BASE}/diagnostics/").json()
    assert datos["engine_version"] == "1.5.0"


def test_las_advertencias_del_motor_solo_para_quien_administra():
    ana = make_user("ana", "ANALISTA_CC")
    organigrama(make_user("jefa", "COORDINADOR_NACIONAL"), ana)
    # Sin advertencias en datos coherentes; la clave nunca aparece para ella.
    assert "validation_warnings" not in client_for(ana).get(f"{BASE}/kpis/me/").json()


def test_el_superusuario_ve_a_cualquiera_de_la_empresa():
    ana = make_user("ana", "ANALISTA_CC")
    raiz = make_user("raiz")
    raiz.is_superuser = True
    raiz.save()
    assert client_for(raiz).get(f"{BASE}/kpis/{ana.id}/").status_code == 200


def test_rol_de_la_membresia_solo_vale_en_su_empresa(otra_empresa):
    """Un rol de Gestión Humana dado en la membresía de otra empresa no da
    `kpi.equipo` aquí."""
    jefa = make_user("jefa")
    ana = make_user("ana", "ANALISTA_CC")
    organigrama(jefa, ana)
    membresia = MembresiaEmpresa.objects.create(usuario=jefa, empresa=otra_empresa)
    membresia.roles.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    assert client_for(jefa).get(f"{BASE}/kpis/{ana.id}/").status_code == 403
