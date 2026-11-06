"""La API de los informes ejecutivos: permisos, alcance por organigrama,
generación de los tres tipos, inmutabilidad, visibilidad, Excel y bitácora."""

from datetime import UTC, datetime
from io import BytesIO

import pytest
from openpyxl import load_workbook

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.informes.models import (
    ExecutiveReportAuditLog,
    ExecutiveReportIntegrityIncident,
    ExecutiveReportSnapshot,
    InformeInmutable,
)
from apps.organizacion.models import DatosDeContacto
from apps.tasks.models import MonthClosure, Task

from .conftest import actividad, client_for, congelar, make_user, organigrama, tarea

pytestmark = pytest.mark.django_db

URL = "/api/v1/informes/"
AHORA = datetime(2026, 10, 20, 15, tzinfo=UTC)


def t(mes, dia, hora=15, anio=2026):
    return datetime(anio, mes, dia, hora, tzinfo=UTC)


def generar(user, **cuerpo):
    return client_for(user).post(f"{URL}executive/", cuerpo, format="json")


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    congelar(monkeypatch, AHORA)


@pytest.fixture
def con_datos(equipo):
    ana, nino = equipo
    tarea(ana, end_date=t(3, 10), status="COMPLETADA", completed_at=t(3, 9), real_hours=6)
    tarea(ana, end_date=t(3, 12), status="EN_PROGRESO", progress=40)
    tarea(nino, end_date=t(3, 14), status="COMPLETADA", completed_at=t(3, 13), real_hours=3)
    seguimiento = tarea(ana, end_date=t(3, 28), type=Task.Type.SEGUIMIENTO)
    actividad(seguimiento, ana, en=t(3, 5), reason="FACTURAS", duration=45)
    return equipo


# ── Permisos ────────────────────────────────────────────────────────────────


def test_sin_sesion_es_401():
    from rest_framework.test import APIClient

    respuesta = APIClient().get(f"{URL}executive/list/")
    assert respuesta.status_code == 401


def test_sin_permiso_es_403_en_todo(sin_permiso):
    cliente = client_for(sin_permiso)
    assert cliente.get(f"{URL}executive/list/").status_code == 403
    assert cliente.get(f"{URL}roster/").status_code == 403
    assert generar(sin_permiso, tipo="MENSUAL", mes="2026-03").status_code == 403
    assert cliente.get(f"{URL}executive/integrity-incidents/").status_code == 403


def test_me_dice_permisos_y_alcance(coordinadora, admin_gh):
    me = client_for(coordinadora).get(f"{URL}me/").json()
    assert me == {
        "permissions": ["informes_gh.ver", "informes_gh.generar"],
        "alcance_completo": False,
        "scope": "COORDINADOR",
    }
    me = client_for(admin_gh).get(f"{URL}me/").json()
    assert me["alcance_completo"] is True and me["scope"] == "JEFE"


# ── Roster ──────────────────────────────────────────────────────────────────


def test_roster_sale_del_organigrama(coordinadora, equipo, externo, jefa):
    datos = client_for(coordinadora).get(f"{URL}roster/").json()
    assert [u["name"] for u in datos["users"]] == ["Ana", "Niño"]
    assert datos["roster_kind"] == "CONSOLIDADO"
    assert datos["scope"] == "COORDINADOR"
    assert datos["users"][0]["unidad"] == "Bienestar"
    # Ni la persona de fuera de su equipo ni la jefa (liderazgo).
    assert externo.pk not in datos["user_ids"]


def test_roster_con_alcance_completo_es_toda_la_empresa_sin_liderazgo(
    admin_gh, equipo, externo, jefa, coordinadora
):
    datos = client_for(admin_gh).get(f"{URL}roster/").json()
    nombres = {u["name"] for u in datos["users"]}
    assert {"Ana", "Niño", "Eugenia", "Coral"} <= nombres
    assert "Jimena" not in nombres  # Jefe Nacional: liderazgo, no ejecuta
    assert "Adela" not in nombres  # ella misma
    assert datos["scope"] == "JEFE"


def test_roster_filtros_solo_acotan(coordinadora, equipo, externo):
    ana, nino = equipo
    cliente = client_for(coordinadora)
    por_rol = cliente.get(f"{URL}roster/?roles=ANALISTA_CC").json()
    assert por_rol["user_ids"] == [ana.pk] and por_rol["roster_kind"] == "POR_AREA"
    unidad = por_rol["users"][0]["unidad_id"]
    por_area = cliente.get(f"{URL}roster/?areas={unidad}").json()
    assert sorted(por_area["user_ids"]) == sorted([ana.pk, nino.pk])
    # Pedir a alguien de fuera no lo agrega.
    individual = cliente.get(f"{URL}roster/?colaboradores={externo.pk},{nino.pk}").json()
    assert individual["user_ids"] == [nino.pk]
    assert individual["roster_kind"] == "POR_AREA"
    solo = cliente.get(f"{URL}roster/?colaboradores={nino.pk}").json()
    assert solo["roster_kind"] == "INDIVIDUAL"


def test_roster_valida_la_entrada(coordinadora):
    cliente = client_for(coordinadora)
    respuesta = cliente.get(f"{URL}roster/?roles=GERENTE")
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "invalid"
    assert cliente.get(f"{URL}roster/?colaboradores=abc").status_code == 400


# ── Generación ──────────────────────────────────────────────────────────────


def test_genera_un_mensual_historico(coordinadora, con_datos):
    ana, nino = con_datos
    respuesta = generar(coordinadora, tipo="MENSUAL", mes="2026-03")
    assert respuesta.status_code == 201, respuesta.content
    informe = respuesta.json()
    assert informe["report_id"].startswith("NXR-20261020-100000-")
    assert informe["type"] == "MENSUAL" and informe["scope"] == "COORDINADOR"
    assert informe["period_label"] == "marzo de 2026"
    assert informe["period_status"] == "HISTORICO"
    assert informe["collaborator_count"] == 2

    doc = informe["data"]
    assert doc["meta"]["reportId"] == informe["report_id"]
    assert doc["meta"]["collaboratorIds"] == [ana.pk, nino.pk]
    assert doc["meta"]["generatedBy"] == {"userId": coordinadora.pk, "name": "Coral"}
    assert doc["meta"]["versions"]["reportingEngineVersion"] == "2.0"
    # Ana 1 de 3 (33%) y Niño 1 de 1 (100%): 66,5 → 67 (mitad hacia arriba).
    assert doc["teamSummary"]["avgCumplimiento"] == 67
    assert doc["teamSummary"]["totalTasks"] == 4
    assert [m["name"] for m in doc["members"]] == ["Ana", "Niño"]
    assert doc["members"][0]["byReason"] == [{"reason": "FACTURAS", "count": 1, "totalMinutes": 45}]
    assert doc["members"][0]["estadoOperativo"]["estado"]
    # Mes pasado: sin Índice Ejecutivo ni predicción ni validación.
    assert doc["estadoGeneral"]["indiceEjecutivo"] is None
    assert doc["predictivo"] is None and doc["integrityCheck"] is None
    assert doc["trends"]["mesAnterior"]["label"] == "Mes anterior"
    # Narrativa determinista, sin IA.
    assert doc["novaOrigen"] == "DETERMINISTA" and doc["novaDegraded"] is False
    assert set(doc["nova"]) == {
        "executiveSummary",
        "executiveInsights",
        "executiveAssessment",
        "recommendationEnrichment",
        "scenarios",
    }
    assert [p["kind"] for p in informe["pages"]] == [
        "cover",
        "executiveSummary",
        "teamStatus",
        "strategicIndicators",
        "memberDetail",
        "operationalDistribution",
        "insights",
        "assessment",
        "recommendations",
        "predictive",
        "metadata",
    ]
    assert informe["pages"][0]["estadoGeneralLabel"] in (
        "Excelente",
        "Bueno",
        "Atención",
        "Crítico",
    )

    snap = ExecutiveReportSnapshot.objects.get(report_id=informe["report_id"])
    assert snap.generated_by == coordinadora
    assert snap.collaborator_ids == [ana.pk, nino.pk]
    assert snap.filters["periodo"] == {"tipoReporte": "MENSUAL", "month": 3, "year": 2026}
    evento = ExecutiveReportAuditLog.objects.get(report_id=snap.report_id)
    assert evento.action == "generated" and evento.user == coordinadora


def test_mensual_del_mes_en_curso_trae_indice_prediccion_e_integridad(coordinadora, equipo):
    ana, nino = equipo
    tarea(ana, end_date=t(10, 8), status="COMPLETADA", completed_at=t(10, 7), real_hours=8)
    tarea(nino, end_date=t(10, 9), status="PENDIENTE")
    respuesta = generar(coordinadora, tipo="MENSUAL", mes="2026-10")
    assert respuesta.status_code == 201, respuesta.content
    doc = respuesta.json()["data"]
    assert doc["meta"]["periodStatus"] == "EN_CURSO"
    indice = doc["estadoGeneral"]["indiceEjecutivo"]
    assert set(indice) == {
        "valor",
        "nivel",
        "color",
        "explicacion",
        "avgPerformance",
        "avgEquilibrio",
        "variacion",
    }
    assert indice["variacion"] is None
    # El Equilibrio Operativo llega a cada persona (en Nexo se perdía por un
    # id de texto contra uno numérico).
    assert all("equilibrioScore" in m for m in doc["members"])
    assert doc["predictivo"]["members"][0]["name"] == "Ana"
    assert doc["integrityCheck"]["performed"] is True
    assert (
        doc["integrityCheck"]["discrepancyCount"]
        == ExecutiveReportIntegrityIncident.objects.count()
    )


def test_variacion_del_indice_contra_el_mensual_anterior(coordinadora, equipo, monkeypatch):
    ana, nino = equipo
    congelar(monkeypatch, t(9, 20))
    previo = generar(coordinadora, tipo="MENSUAL", mes="2026-09").json()
    valor_previo = previo["data"]["estadoGeneral"]["indiceEjecutivo"]["valor"]
    congelar(monkeypatch, AHORA)
    actual = generar(coordinadora, tipo="MENSUAL", mes="2026-10").json()
    indice = actual["data"]["estadoGeneral"]["indiceEjecutivo"]
    assert indice["variacion"] == pytest.approx(indice["valor"] - valor_previo, abs=0.1)


def test_fecha_de_corte_explicita_no_valida_integridad(coordinadora, equipo):
    respuesta = generar(
        coordinadora, tipo="MENSUAL", mes="2026-10", fecha_corte="2026-10-10T12:00:00Z"
    )
    doc = respuesta.json()["data"]
    assert doc["meta"]["fechaCorte"] == "2026-10-10T12:00:00Z"
    assert doc["integrityCheck"] is None


def test_mes_con_cierre_anticipado_lo_dice_en_portada(coordinadora, con_datos):
    MonthClosure.objects.create(
        month=3,
        year=2026,
        closed_by=coordinadora,
        cutoff_date=datetime(2026, 3, 20, tzinfo=UTC),
        closure_type="EARLY",
        calendar_days_total=31,
        calendar_days_considered=20,
        working_days_considered=14,
        working_hours_considered=91.0,
        total_tasks=0,
        completed_tasks=0,
        summary={},
    )
    informe = generar(coordinadora, tipo="MENSUAL", mes="2026-03").json()
    assert informe["period_status"] == "CERRADO"
    assert informe["data"]["meta"]["closure"]["closureType"] == "EARLY"
    portada = informe["pages"][0]
    assert portada["closureStatusLabel"] == "Cerrado anticipadamente"
    assert portada["coverageLabel"] == "1 mar – 20 mar"
    assert "cierre anticipado" in portada["metodologicalNoteLabel"]


def test_genera_rango_de_meses(coordinadora, con_datos):
    respuesta = generar(coordinadora, tipo="RANGO_MESES", desde="2026-02", hasta="2026-04")
    assert respuesta.status_code == 201, respuesta.content
    doc = respuesta.json()["data"]
    assert doc["meta"]["periodLabel"] == "febrero de 2026 a abril de 2026"
    assert [m["month"] for m in doc["monthlyEvolution"]] == ["2026-02", "2026-03", "2026-04"]
    fila = doc["monthlyEvolution"][1]["memberSnapshots"][0]
    assert set(fila) == {
        "id",
        "name",
        "role",
        "completedPct",
        "cargaPct",
        "cargaColor",
        "cargaLabel",
        "score",
        "totalTasks",
    }
    assert doc["rangeTrend"]["cumplimientoTrend"] in ("mejora", "deterioro", "estancamiento")
    assert doc["trends"] is None and doc["estadoGeneral"]["indiceEjecutivo"] is None


def test_genera_rango_personalizado(coordinadora, con_datos):
    respuesta = generar(
        coordinadora, tipo="RANGO_PERSONALIZADO", desde="2026-03-01", hasta="2026-03-31"
    )
    assert respuesta.status_code == 201, respuesta.content
    doc = respuesta.json()["data"]
    assert doc["meta"]["periodLabel"] == "01 mar 2026 — 31 mar 2026"
    assert doc["meta"]["closure"] is None
    assert doc["meta"]["periodStatus"] == "HISTORICO"
    # Ana 1 de 3 (33%) y Niño 1 de 1 (100%): 66,5 → 67 (mitad hacia arriba).
    assert doc["teamSummary"]["avgCumplimiento"] == 67


@pytest.mark.parametrize(
    ("cuerpo", "campo"),
    [
        ({"tipo": "SEMANAL"}, "tipo"),
        ({"tipo": "MENSUAL"}, "mes"),
        ({"tipo": "MENSUAL", "mes": "2026-13"}, "mes"),
        ({"tipo": "MENSUAL", "mes": "2026-12"}, "mes"),  # todavía no empieza
        ({"tipo": "RANGO_MESES", "desde": "2026-03", "hasta": "2026-03"}, "desde"),
        ({"tipo": "RANGO_MESES", "desde": "2023-01", "hasta": "2026-03"}, "hasta"),
        ({"tipo": "RANGO_PERSONALIZADO", "desde": "2026-03-10", "hasta": "2026-03-01"}, "desde"),
        ({"tipo": "RANGO_PERSONALIZADO", "desde": "2024-01-01", "hasta": "2026-03-01"}, "hasta"),
        ({"tipo": "RANGO_PERSONALIZADO", "desde": "2026-02-30", "hasta": "2026-03-01"}, "desde"),
        (
            {"tipo": "MENSUAL", "mes": "2026-03", "fecha_corte": "2026-02-01T00:00:00Z"},
            "fecha_corte",
        ),
        ({"tipo": "MENSUAL", "mes": "2026-03", "roles": ["GERENTE"]}, "roles"),
    ],
)
def test_generacion_rechaza_datos_invalidos(coordinadora, equipo, cuerpo, campo):
    respuesta = generar(coordinadora, **cuerpo)
    assert respuesta.status_code == 400, respuesta.content
    error = respuesta.json()["error"]
    assert error["code"] == "invalid"
    assert campo in error["details"]
    assert not ExecutiveReportSnapshot.objects.exists()


def test_sin_colaboradores_no_se_emite(coordinadora):
    respuesta = generar(coordinadora, tipo="MENSUAL", mes="2026-03")
    assert respuesta.status_code == 422
    assert respuesta.json()["error"]["code"] == "roster_vacio"
    assert not ExecutiveReportSnapshot.objects.exists()


def test_doble_clic_devuelve_el_mismo_informe(coordinadora, con_datos):
    primero = generar(coordinadora, tipo="MENSUAL", mes="2026-03")
    segundo = generar(coordinadora, tipo="MENSUAL", mes="2026-03")
    assert (primero.status_code, segundo.status_code) == (201, 200)
    assert primero.json()["report_id"] == segundo.json()["report_id"]
    assert ExecutiveReportSnapshot.objects.count() == 1


def test_falla_de_calculo_se_audita_sin_revelar_el_detalle(coordinadora, equipo, monkeypatch):
    def revienta(**kwargs):
        raise RuntimeError("detalle interno con datos")

    monkeypatch.setattr("apps.informes.services.build_monthly", revienta)
    respuesta = generar(coordinadora, tipo="MENSUAL", mes="2026-03")
    assert respuesta.status_code == 500
    assert respuesta.json()["error"]["code"] == "generacion_fallida"
    assert "detalle interno" not in respuesta.content.decode()
    evento = ExecutiveReportAuditLog.objects.get()
    assert evento.action == "generation_failed" and evento.message == "RuntimeError"
    assert not ExecutiveReportSnapshot.objects.exists()


def test_el_informe_es_inmutable(coordinadora, con_datos):
    informe = generar(coordinadora, tipo="MENSUAL", mes="2026-03").json()
    snap = ExecutiveReportSnapshot.objects.get(report_id=informe["report_id"])
    snap.period_label = "otro"
    with pytest.raises(InformeInmutable):
        snap.save()


# ── Lectura y visibilidad ───────────────────────────────────────────────────


def test_listado_y_detalle_segun_quien_ve_a_quien(coordinadora, admin_gh, con_datos, externo):
    informe = generar(coordinadora, tipo="MENSUAL", mes="2026-03").json()
    report_id = informe["report_id"]

    # La coordinadora lo ve (lo generó); el admin de GH también (alcance completo).
    for quien in (coordinadora, admin_gh):
        listado = client_for(quien).get(f"{URL}executive/list/").json()
        assert [r["report_id"] for r in listado["reports"]] == [report_id]
        assert "data" not in listado["reports"][0]
        assert client_for(quien).get(f"{URL}executive/{report_id}/").status_code == 200

    # Quien ve a todas sus personas (su jefa en el organigrama) también.
    jefa = make_user("jefa2", "JEFE_NACIONAL", first_name="Julia")
    cargo_de_la_coordinadora = DatosDeContacto.objects.get(usuario=coordinadora).cargo
    cargo_de_la_coordinadora.jefe = organigrama(jefa)
    cargo_de_la_coordinadora.save()
    assert client_for(jefa).get(f"{URL}executive/{report_id}/").status_code == 200

    # Alguien con el permiso pero que no ve a esas personas: 404, no 403.
    organigrama(externo)
    otra = make_user("otra", "COORDINADOR_NACIONAL", first_name="Olga")
    organigrama(otra, externo)
    assert client_for(otra).get(f"{URL}executive/list/").json()["total"] == 0
    respuesta = client_for(otra).get(f"{URL}executive/{report_id}/")
    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "not_found"

    vistos = ExecutiveReportAuditLog.objects.filter(report_id=report_id, action="viewed")
    assert vistos.count() == 3


def test_listado_pagina_y_filtra(coordinadora, con_datos):
    generar(coordinadora, tipo="MENSUAL", mes="2026-03")
    generar(coordinadora, tipo="RANGO_MESES", desde="2026-02", hasta="2026-03")
    cliente = client_for(coordinadora)
    datos = cliente.get(f"{URL}executive/list/?page_size=1").json()
    assert datos["total"] == 2 and len(datos["reports"]) == 1
    assert datos["reports"][0]["type"] == "RANGO_MESES"  # el más reciente primero
    solo = cliente.get(f"{URL}executive/list/?tipo=MENSUAL").json()
    assert [r["type"] for r in solo["reports"]] == ["MENSUAL"]
    assert cliente.get(f"{URL}executive/list/?page_size=500").status_code == 400


def test_otra_empresa_no_ve_el_informe(coordinadora, con_datos):
    informe = generar(coordinadora, tipo="MENSUAL", mes="2026-03").json()
    otra = Empresa.objects.create(codigo="OTRA", nombre="Otra empresa")
    with usando_empresa(otra):
        assert not ExecutiveReportSnapshot.objects.filter(report_id=informe["report_id"]).exists()


def test_informe_inexistente_y_ruta_que_no_es_report_id(coordinadora):
    cliente = client_for(coordinadora)
    assert cliente.get(f"{URL}executive/NXR-20260101-000000-ABCD/").status_code == 404
    assert cliente.get(f"{URL}executive/cualquier-cosa/").status_code == 404


# ── Excel, PDF y bitácora ───────────────────────────────────────────────────


def test_exporta_a_excel(coordinadora, con_datos):
    informe = generar(coordinadora, tipo="MENSUAL", mes="2026-03").json()
    respuesta = client_for(coordinadora).get(f"{URL}executive/{informe['report_id']}/export/")
    assert respuesta.status_code == 200
    assert respuesta["Content-Disposition"] == f'attachment; filename="{informe["report_id"]}.xlsx"'
    libro = load_workbook(BytesIO(respuesta.content))
    assert libro.sheetnames == [
        "Resumen",
        "Estado General",
        "Indicadores Estrategicos",
        "Detalle por Colaborador",
        "Distribucion Operativa",
        "Insights",
        "Executive Assessment",
        "Recomendaciones",
        "Analytics Predictivo",
        "Metadatos",
    ]
    detalle = list(libro["Detalle por Colaborador"].values)
    assert detalle[1][0] == "Ana" and detalle[1][1] == "Analista Clima y Cultura"
    assert ExecutiveReportAuditLog.objects.filter(action="exported_excel").count() == 1


def test_el_navegador_solo_anota_el_pdf(coordinadora, con_datos):
    informe = generar(coordinadora, tipo="MENSUAL", mes="2026-03").json()
    cliente = client_for(coordinadora)
    url = f"{URL}executive/{informe['report_id']}/eventos/"
    assert cliente.post(url, {"action": "exported_pdf"}, format="json").status_code == 204
    assert cliente.post(url, {"action": "generated"}, format="json").status_code == 400
    assert ExecutiveReportAuditLog.objects.filter(action="exported_pdf").count() == 1


def test_bitacora_e_incidentes_solo_para_quien_administra(coordinadora, admin_gh, con_datos):
    informe = generar(coordinadora, tipo="MENSUAL", mes="2026-03").json()
    report_id = informe["report_id"]
    ExecutiveReportIntegrityIncident.objects.create(
        report_id=report_id,
        field_path="members[1].completedPct",
        expected_value=50,
        actual_value=60,
        detected_at=AHORA,
    )
    assert client_for(coordinadora).get(f"{URL}executive/{report_id}/audit/").status_code == 403
    bitacora = client_for(admin_gh).get(f"{URL}executive/{report_id}/audit/").json()
    assert [e["action"] for e in bitacora["events"]] == ["generated"]
    incidentes = (
        client_for(admin_gh)
        .get(f"{URL}executive/integrity-incidents/?report_id={report_id}")
        .json()
    )
    assert incidentes["total"] == 1
    assert incidentes["incidents"][0]["field_path"] == "members[1].completedPct"


def test_estado_de_cierre_para_el_asistente(coordinadora):
    cliente = client_for(coordinadora)
    abierto = cliente.get(f"{URL}executive/closure-status/?year=2026&month=3").json()
    assert abierto["closed"] is False and abierto["cutoff_date"] is None
    MonthClosure.objects.create(
        month=3,
        year=2026,
        closed_by=coordinadora,
        cutoff_date=datetime(2026, 3, 20, tzinfo=UTC),
        closure_type="MANUAL",
        calendar_days_total=31,
        calendar_days_considered=20,
        working_days_considered=14,
        working_hours_considered=91.0,
        total_tasks=0,
        completed_tasks=0,
        summary={},
    )
    cerrado = cliente.get(f"{URL}executive/closure-status/?year=2026&month=3").json()
    assert cerrado["closed"] is True
    assert cerrado["cutoff_date"] == "2026-03-20" and cerrado["closure_type"] == "MANUAL"
    assert cliente.get(f"{URL}executive/closure-status/?year=2026&month=13").status_code == 400
