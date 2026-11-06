"""El motor de cálculo del informe, portado de Nexo (`apps.reports.member_kpis`,
`insights` y `team_report`, con sus pruebas). Mismas reglas y mismos
números: estas pruebas son las de Nexo adaptadas a la intranet (empresa activa,
cuentas con `created_at` en el pasado, organigrama)."""

from datetime import UTC, date, datetime, timedelta

import pytest

from apps.informes.insights import (
    compute_findings,
    compute_recommendations,
    compute_risk_quadrant,
    compute_team_insights,
    compute_team_monthly_snapshots,
    compute_trend_comparisons,
    explain_carga_indicator,
    explain_consultas_indicator,
    explain_cumplimiento_indicator,
    explain_motivo_distribution,
    previous_equivalent_period,
    resolve_custom_range_period_status,
    resolve_monthly_period_status,
)
from apps.informes.member_kpis import (
    _local_month_bounds,
    _ts_local_period_end_date,
    as_of_fecha_corte,
    compute_custom_range_member_kpis,
    compute_effective_member_bases,
    compute_monthly_member_kpis,
    compute_principal_hallazgo,
    compute_range_member_kpis,
    derive_estado_operativo,
    months_in_range,
    resolve_closure_cutoff,
)
from apps.informes.team_report import (
    assemble_custom_range_team_report,
    assemble_monthly_team_report,
    assemble_range_team_report,
    compute_consultas_by_reason,
    compute_monthly_ranking,
    compute_range_alerts,
    compute_range_ranking,
    compute_team_alerts,
)
from apps.tasks.business_time import business_day_real_range
from apps.tasks.models import ActivityReason, MonthClosure, Task

from .conftest import actividad, make_user, tarea

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 3
AHORA = datetime(2026, 10, 20, 15, tzinfo=UTC)


def t(mes, dia, hora=15, anio=YEAR):
    return datetime(anio, mes, dia, hora, tzinfo=UTC)


@pytest.fixture
def ana():
    return make_user("anunez", "ANALISTA_CC", first_name="Ana")


def _cierre(user, *, year=YEAR, month=MONTH, dia=20, tipo="EARLY"):
    return MonthClosure.objects.create(
        month=month,
        year=year,
        closed_by=user,
        cutoff_date=datetime(year, month, dia, tzinfo=UTC),
        closure_type=tipo,
        calendar_days_total=31,
        calendar_days_considered=dia,
        working_days_considered=14,
        working_hours_considered=91.0,
        total_tasks=0,
        completed_tasks=0,
        summary={},
    )


# ── Fecha de corte ──────────────────────────────────────────────────────────


def test_as_of_fecha_corte_trata_como_pendiente_lo_completado_despues_del_corte():
    corte = t(3, 15)
    completada_despues = Task(status="COMPLETADA", completed_at=t(3, 20))
    completada_antes = Task(status="COMPLETADA", completed_at=t(3, 10))
    resultado = as_of_fecha_corte([completada_despues, completada_antes], corte)
    assert [r.status for r in resultado] == ["PENDIENTE", "COMPLETADA"]
    # Nunca toca la instancia original.
    assert completada_despues.status == "COMPLETADA"


def test_resolve_closure_cutoff_explicito_gana_al_cierre(ana):
    _cierre(ana)
    explicito = t(3, 10)
    assert resolve_closure_cutoff(YEAR, MONTH, explicito, t(3, 31), AHORA) == explicito


def test_resolve_closure_cutoff_usa_el_fin_del_dia_de_negocio_del_cierre(ana):
    _cierre(ana, dia=20)
    _, esperado = business_day_real_range(date(YEAR, MONTH, 20))
    assert resolve_closure_cutoff(YEAR, MONTH, None, t(3, 31, 23), AHORA) == esperado


def test_resolve_closure_cutoff_sin_cierre_nunca_pasa_de_ahora():
    ahora = t(3, 15)
    assert resolve_closure_cutoff(YEAR, MONTH, None, t(3, 31, 23), ahora) == ahora


# ── Bases efectivas ─────────────────────────────────────────────────────────


def test_bases_efectivas_sin_prorrateo_para_quien_ya_estaba(ana):
    bases = compute_effective_member_bases(
        [ana], date(YEAR, 3, 1), date(YEAR, 3, 31), 6.5, 5.5, 7.5, 8.5, now=AHORA
    )
    assert bases[ana.id]["was_prorated"] is False
    assert bases[ana.id]["base_hours"] > 0


def test_bases_efectivas_prorratea_a_quien_entra_a_mitad_de_mes():
    nueva = make_user("pnueva", "ANALISTA_CC", first_name="Paula")
    tarea(nueva, end_date=t(3, 20), status="COMPLETADA", completed_at=t(3, 16), real_hours=2)
    completo = compute_effective_member_bases(
        [make_user("vieja", "ANALISTA_CC")],
        date(YEAR, 3, 1),
        date(YEAR, 3, 31),
        6.5,
        5.5,
        7.5,
        8.5,
        now=AHORA,
    )
    from apps.users.models import User

    User.objects.filter(pk=nueva.pk).update(created_at=t(3, 16))
    nueva.refresh_from_db()
    bases = compute_effective_member_bases(
        [nueva], date(YEAR, 3, 1), date(YEAR, 3, 31), 6.5, 5.5, 7.5, 8.5, now=AHORA
    )
    assert bases[nueva.id]["was_prorated"] is True
    assert 0 < bases[nueva.id]["base_hours"] < list(completo.values())[0]["base_hours"]


def test_bases_efectivas_vacias_si_no_hay_personas():
    assert (
        compute_effective_member_bases(
            [], date(YEAR, 3, 1), date(YEAR, 3, 31), 1, 1, 1, 1, now=AHORA
        )
        == {}
    )


# ── Constructor MENSUAL ─────────────────────────────────────────────────────


def test_mensual_score_y_cumplimiento(ana):
    tarea(ana, end_date=t(3, 10), status="COMPLETADA", completed_at=t(3, 9), real_hours=4)
    tarea(ana, end_date=t(3, 12), status="EN_PROGRESO", progress=50)
    kpis = compute_monthly_member_kpis(user_ids=[ana.id], year=YEAR, month=MONTH, now=AHORA)
    fila = kpis[ana.id]
    assert fila["completed_pct"] == 50
    assert fila["total_tasks"] == 2
    assert fila["completed_tasks"] == 1
    # 50% × 40 + carga 80% (sin penalizar) 20 + progreso 50% × 20 = 20 + 20 + 10.
    assert fila["score"] == 50
    assert fila["overdue_count"] == 1
    assert fila["carga_real_hours"] == 4.0


def test_mensual_respeta_la_fecha_de_corte(ana):
    tarea(ana, end_date=t(3, 25), status="COMPLETADA", completed_at=t(3, 24))
    kpis = compute_monthly_member_kpis(
        user_ids=[ana.id], year=YEAR, month=MONTH, explicit_fecha_corte=t(3, 15), now=AHORA
    )
    assert kpis[ana.id]["completed_pct"] == 0


def test_mensual_cuenta_las_consultas_por_motivo(ana):
    seguimiento = tarea(ana, end_date=t(3, 28), type=Task.Type.SEGUIMIENTO)
    actividad(seguimiento, ana, en=t(3, 5), reason="FACTURAS", duration=30)
    actividad(seguimiento, ana, en=t(3, 6), reason="FACTURAS", duration=45)
    actividad(seguimiento, ana, en=t(3, 7), reason="SOLICITUD_PERMISO", duration=15)
    fila = compute_monthly_member_kpis(user_ids=[ana.id], year=YEAR, month=MONTH, now=AHORA)[ana.id]
    assert fila["seguimiento_total"] == 3
    assert {r["reason"]: (r["count"], r["total_minutes"]) for r in fila["by_reason"]} == {
        "FACTURAS": (2, 75),
        "SOLICITUD_PERMISO": (1, 15),
    }


def test_mensual_sin_personas_devuelve_vacio():
    assert compute_monthly_member_kpis(user_ids=[], year=YEAR, month=MONTH, now=AHORA) == {}


# ── Estado operativo y hallazgo ─────────────────────────────────────────────


def test_estado_operativo_con_equilibrio_real_y_aproximado():
    assert (
        derive_estado_operativo(
            completed_pct=0, carga_label="Sobrecarga", overdue_count=9, equilibrio_score=92
        )["estado"]
        == "Equilibrio Óptimo"
    )
    # 100×0.5 + 100×0.5 − 0 = 100 → Óptimo; con 2 vencidas, 80 → Estable.
    assert (
        derive_estado_operativo(completed_pct=100, carga_label="Óptimo", overdue_count=0)["estado"]
        == "Equilibrio Óptimo"
    )
    assert (
        derive_estado_operativo(completed_pct=100, carga_label="Óptimo", overdue_count=2)["estado"]
        == "Equilibrio Estable"
    )


@pytest.mark.parametrize(
    ("datos", "esperado"),
    [
        (
            {"carga_label": "Óptimo", "completed_pct": 90, "overdue_count": 0, "total_tasks": 0},
            "Sin actividad registrada",
        ),
        (
            {
                "carga_label": "Sobrecarga",
                "completed_pct": 90,
                "overdue_count": 3,
                "total_tasks": 4,
            },
            "Sobrecarga",
        ),
        (
            {"carga_label": "Óptimo", "completed_pct": 90, "overdue_count": 1, "total_tasks": 4},
            "Retrasos recurrentes",
        ),
        (
            {"carga_label": "Óptimo", "completed_pct": 90, "overdue_count": 0, "total_tasks": 4},
            "Sin tareas vencidas",
        ),
        (
            {"carga_label": "Moderado", "completed_pct": 50, "overdue_count": 0, "total_tasks": 4},
            "Carga equilibrada",
        ),
    ],
)
def test_principal_hallazgo(datos, esperado):
    assert compute_principal_hallazgo(**datos) == esperado


# ── RANGO PERSONALIZADO y RANGO DE MESES ────────────────────────────────────


def test_rango_personalizado_basico(ana):
    tarea(ana, end_date=t(3, 10), status="COMPLETADA", completed_at=t(3, 9))
    tarea(ana, end_date=t(4, 2), status="PENDIENTE")
    kpis = compute_custom_range_member_kpis(
        user_ids=[ana.id], period_start=t(3, 1, 0), period_end=t(4, 5, 23), now=AHORA
    )
    fila = kpis[ana.id]
    assert fila["completed_pct"] == 50
    assert fila["estado_operativo"]["estado"]
    assert fila["principal_hallazgo"]


def test_rango_de_meses_promedia_solo_los_meses_activos(ana):
    tarea(ana, end_date=t(3, 10), status="COMPLETADA", completed_at=t(3, 9))
    tarea(ana, end_date=t(5, 10), status="PENDIENTE")
    tarea(ana, end_date=t(5, 11), status="COMPLETADA", completed_at=t(5, 11))
    resultado = compute_range_member_kpis(
        user_ids=[ana.id], from_year=YEAR, from_month=3, to_year=YEAR, to_month=5, now=AHORA
    )
    meses = resultado["month_snapshots"]
    assert [m["month"] for m in meses] == ["2026-03", "2026-04", "2026-05"]
    assert [m["label"] for m in meses] == ["marzo de 2026", "abril de 2026", "mayo de 2026"]
    # Marzo 100%, abril sin tareas (no cuenta), mayo 50% → 75%.
    assert resultado["aggregated_members"][ana.id]["completed_pct"] == 75
    assert resultado["aggregated_members"][ana.id]["overdue_count"] == 0


def test_limites_locales_del_mes_y_paso_de_24_horas():
    inicio, fin = _local_month_bounds(YEAR, 3)
    assert inicio == datetime(YEAR, 3, 1, 5, tzinfo=UTC)
    assert fin == datetime(YEAR, 4, 1, 5, tzinfo=UTC) - timedelta(microseconds=1)
    # Empezando a medianoche UTC, el último paso de 24 h cae el 1 de abril.
    assert _ts_local_period_end_date(datetime(YEAR, 3, 10, tzinfo=UTC), fin) == date(YEAR, 4, 1)
    assert months_in_range(2025, 11, 2026, 2) == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]


# ── Interpretación (`insights`) ─────────────────────────────────────────────


def test_explicaciones_de_indicadores():
    assert "por debajo del objetivo" in explain_cumplimiento_indicator(55, 3)["why"]
    assert "Mantener" in explain_cumplimiento_indicator(85, 3)["action"]
    assert "por encima del rango óptimo" in explain_carga_indicator(120)["why"]
    assert (
        explain_consultas_indicator(10, None)["why"]
        == "El equipo atendió 10 consultas en el período."
    )
    assert "un 50% más" in explain_consultas_indicator(15, 10)["why"]
    assert "reforzar" in explain_consultas_indicator(15, 10)["action"]
    assert "un 50% menos" in explain_consultas_indicator(5, 10)["why"]


def test_mapa_de_riesgo_los_cuatro_cuadrantes():
    members = [
        {"name": "A", "completed_pct": 40, "carga_pct": 120},
        {"name": "B", "completed_pct": 90, "carga_pct": 120},
        {"name": "C", "completed_pct": 40, "carga_pct": 80},
        {"name": "D", "completed_pct": 90, "carga_pct": 80},
    ]
    assert [m["quadrant"] for m in compute_risk_quadrant(members)] == [
        "criticos",
        "atencion-carga",
        "atencion-cumplimiento",
        "saludables",
    ]


def test_explicacion_de_motivo_con_pista_y_tendencia():
    texto = explain_motivo_distribution("FACTURAS", "Facturas", 40, 25)
    assert texto.startswith(
        "Facturas representa el 40% de las consultas del período, convirtiéndose"
    )
    assert "gestión documental" in texto
    assert "Aumentó 25%" in texto
    assert "Disminuyó 30%" in explain_motivo_distribution("OTRO", "Otro", 10, -30)
    assert "Aumentó" not in explain_motivo_distribution("OTRO", "Otro", 10, 10)


def _m(name, *, carga_label="Óptimo", completed_pct=90, **extra):
    return {"name": name, "carga_label": carga_label, "completed_pct": completed_pct, **extra}


def test_hallazgos_y_recomendaciones():
    members = [
        _m("Ana", carga_label="Sobrecarga"),
        _m("Niño", carga_label="Subutilización", completed_pct=50),
    ]
    hallazgos = compute_findings(
        avg_cumplimiento=70,
        avg_cumplimiento_delta=-4,
        members=members,
        total_overdue=2,
        top_reason={"label": "Facturas", "pct": 35},
    )
    textos = [h["text"] for h in hallazgos]
    assert (
        textos[0]
        == "El cumplimiento del equipo disminuyó 4 puntos porcentuales respecto al mes anterior."
    )
    assert "subutilizados: Niño." in textos[1]
    assert "sobrecarga: Ana." in textos[2]
    assert "2 tarea(s) vencida(s)" in textos[3]
    assert textos[4].startswith('"Facturas" concentra el 35%')

    recs = compute_recommendations(
        avg_cumplimiento=70, members=members, top_reason={"label": "Facturas", "pct": 35}
    )
    assert [r["id"] for r in recs] == [
        "redistribuir-carga-mixta",
        "revisar-bajo-cumplimiento",
        "reforzar-motivo-concentrado",
    ]
    sano = compute_recommendations(avg_cumplimiento=85, members=[_m("Ana")], top_reason=None)
    assert [r["id"] for r in sano] == ["mantener-planificacion"]


def test_insights_del_equipo():
    members = [{"name": "Ana", "carga_real_hours": 60}, {"name": "Niño", "carga_real_hours": 40}]
    insights = compute_team_insights(
        members=members,
        total_carga_real_hours=100,
        health_by_member=[{"name": "Ana", "score": 70}, {"name": "Niño", "score": 88}],
        variable_consistency_members=["Ana", "Niño", "Otra"],
    )
    assert insights == [
        "Ana concentró el 60% del tiempo ejecutado por el equipo este período.",
        "Niño mantiene el mayor Equilibrio Operativo del equipo (88/100).",
        "Ana presenta variaciones importantes entre semanas.",
        "Niño presenta variaciones importantes entre semanas.",
    ]


def test_periodo_anterior_equivalente():
    inicio, fin = t(3, 1, 0), t(3, 10, 0)
    previo = previous_equivalent_period(inicio, fin)
    assert previo["end"] == inicio - timedelta(microseconds=1)
    assert previo["end"] - previo["start"] == fin - inicio


def test_estado_del_periodo(ana):
    assert resolve_monthly_period_status(10, 2026, AHORA) == "EN_CURSO"
    assert resolve_monthly_period_status(MONTH, YEAR, AHORA) == "HISTORICO"
    _cierre(ana)
    assert resolve_monthly_period_status(MONTH, YEAR, AHORA) == "CERRADO"
    # El mes en curso es el del negocio (UTC-5): el 1 de noviembre a las 02:00
    # UTC todavía es 31 de octubre.
    assert (
        resolve_monthly_period_status(10, 2026, datetime(2026, 11, 1, 2, tzinfo=UTC)) == "EN_CURSO"
    )
    assert resolve_custom_range_period_status(t(3, 1), AHORA) == "HISTORICO"
    assert resolve_custom_range_period_status(AHORA + timedelta(days=1), AHORA) == "EN_CURSO"


def test_tendencias_mensuales(ana):
    tarea(ana, end_date=t(2, 10), status="COMPLETADA", completed_at=t(2, 9))
    tarea(ana, end_date=t(3, 10), status="PENDIENTE")
    tarea(ana, end_date=t(3, 11), status="COMPLETADA", completed_at=t(3, 11))
    puntos = compute_team_monthly_snapshots([ana.id], YEAR, MONTH, 2)
    assert [p["label"] for p in puntos] == ["ene 26", "feb 26", "mar 26"]
    tendencias = compute_trend_comparisons(puntos)
    assert tendencias["mes_anterior"]["compare_value"] == 100
    assert tendencias["mes_anterior"]["delta"] == -50
    assert tendencias["mes_anterior"]["direction"] == "deterioro"
    assert compute_trend_comparisons(puntos[:1])["mes_anterior"]["direction"] == "sin-datos"


# ── Agregado de equipo (`team_report`) ──────────────────────────────────────


def _miembro(i, **extra):
    base = {
        "id": i,
        "name": f"P{i}",
        "role": "ANALISTA_CC",
        "score": 50,
        "completed_pct": 70,
        "carga_pct": 90,
        "carga_label": "Óptimo",
        "total_tasks": 3,
    }
    return {**base, **extra}


def test_alertas_y_rankings():
    members = [
        _miembro(1, completed_pct=40, carga_label="Sobrecarga", carga_pct=130, score=60),
        _miembro(2, completed_pct=40, total_tasks=0, score=60),
        _miembro(3, completed_pct=90, score=70),
    ]
    alertas = compute_team_alerts(members)
    assert [(a["user_id"], a["type"]) for a in alertas] == [(1, "cumplimiento"), (1, "sobrecarga")]
    assert [r["id"] for r in compute_monthly_ranking(members)] == [3, 1, 2]
    assert [r["id"] for r in compute_range_ranking(members)] == [3, 1, 2]
    assert set(compute_monthly_ranking(members)[0]) == {
        "id",
        "name",
        "role",
        "score",
        "completed_pct",
    }


def test_consultas_por_motivo_con_porcentaje_y_tendencia(ana):
    ActivityReason.objects.create(key="FACTURAS", label="Facturas de proveedores")
    seguimiento = tarea(ana, end_date=t(3, 28), type=Task.Type.SEGUIMIENTO)
    for dia in (2, 3, 4):
        actividad(seguimiento, ana, en=t(3, dia), reason="FACTURAS")
    actividad(seguimiento, ana, en=t(3, 5), reason="OTRO")
    actividad(seguimiento, ana, en=t(2, 5), reason="FACTURAS")
    items = compute_consultas_by_reason(
        [ana.id], t(3, 1, 0), t(3, 31, 23), t(2, 1, 0), t(2, 28, 23)
    )
    assert [(i["reason"], i["count"], i["pct"], i["trend_pct"]) for i in items] == [
        ("FACTURAS", 3, 75, 200),
        ("OTRO", 1, 25, None),
    ]
    assert items[0]["interpretation"].startswith("Facturas de proveedores representa el 75%")


def test_alertas_de_rango_por_mayoria_de_meses_activos(ana):
    class U:
        id = ana.id
        first_name = "Ana"
        username = "anunez"

    snaps = [
        {
            "member_snapshots": {
                ana.id: {
                    "total_tasks": 2,
                    "completed_pct": 40,
                    "carga_label": "Óptimo",
                    "carga_pct": 80,
                }
            }
        },
        {
            "member_snapshots": {
                ana.id: {
                    "total_tasks": 0,
                    "completed_pct": 0,
                    "carga_label": "Óptimo",
                    "carga_pct": 0,
                }
            }
        },
        {
            "member_snapshots": {
                ana.id: {
                    "total_tasks": 1,
                    "completed_pct": 100,
                    "carga_label": "Óptimo",
                    "carga_pct": 90,
                }
            }
        },
    ]
    alertas = compute_range_alerts(snaps, [ana])
    assert alertas == [
        {
            "user_id": ana.id,
            "name": "Ana",
            "type": "cumplimiento",
            "value": 40,
            "months_affected": 1,
        }
    ]


def test_agregado_mensual_con_identidad_y_explicaciones(ana):
    nino = make_user("nnoboa", "ASISTENTE_GH", first_name="Niño")
    tarea(ana, end_date=t(3, 10), status="COMPLETADA", completed_at=t(3, 9), real_hours=10)
    tarea(nino, end_date=t(3, 10), status="PENDIENTE")
    bundle = assemble_monthly_team_report(
        user_ids=[ana.id, nino.id], year=YEAR, month=MONTH, now=AHORA
    )
    assert [(m["id"], m["name"], m["role"]) for m in bundle["members"]] == [
        (ana.id, "Ana", "ANALISTA_CC"),
        (nino.id, "Niño", "ASISTENTE_GH"),
    ]
    assert bundle["team_summary"]["avg_cumplimiento"] == 50
    assert bundle["team_summary"]["total_tasks"] == 2
    assert set(bundle["indicator_explanations"]) == {"cumplimiento", "carga", "consultas"}
    assert bundle["period_status"] == "HISTORICO"
    assert bundle["trends"]["mes_anterior"]["direction"] == "sin-datos"


def test_agregados_con_roster_vacio():
    vacio = assemble_monthly_team_report(user_ids=[], year=YEAR, month=MONTH, now=AHORA)
    assert vacio["members"] == [] and vacio["team_summary"]["avg_cumplimiento"] == 0
    rango = assemble_range_team_report(
        user_ids=[], from_year=YEAR, from_month=1, to_year=YEAR, to_month=3, now=AHORA
    )
    assert (
        rango["monthly_evolution"] == []
        and rango["range_trend"]["cumplimiento_trend"] == "estancamiento"
    )
    libre = assemble_custom_range_team_report(
        user_ids=[], period_start=t(3, 1, 0), period_end=t(3, 31, 23), now=AHORA
    )
    assert libre["members"] == []


def test_agregado_de_rango_con_evolucion_y_meses_problematicos(ana):
    tarea(ana, end_date=t(3, 10), status="PENDIENTE")
    tarea(ana, end_date=t(4, 10), status="COMPLETADA", completed_at=t(4, 9))
    bundle = assemble_range_team_report(
        user_ids=[ana.id], from_year=YEAR, from_month=3, to_year=YEAR, to_month=4, now=AHORA
    )
    assert [m["month"] for m in bundle["monthly_evolution"]] == ["2026-03", "2026-04"]
    assert bundle["problematic_months"] == [
        {"month": "2026-03", "label": "marzo de 2026", "team_avg_cumplimiento": 0}
    ]
    assert bundle["range_trend"] == {
        "cumplimiento_trend": "mejora",
        "cumplimiento_change": 100,
        "first_month_avg_cumplimiento": 0,
        "last_month_avg_cumplimiento": 100,
    }
