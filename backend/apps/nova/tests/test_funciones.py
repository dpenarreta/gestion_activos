"""Las tres funciones: análisis de KPI, frase del inicio y narrativa de los
informes. Proveedor siempre falso."""

from datetime import UTC, date, datetime

import pytest

from apps.ausencias.models import LeaveRecord, SpecialStatus
from apps.informes.tests.conftest import client_for, congelar, make_user, organigrama, tarea
from apps.nova import inicio, kpi
from apps.nova.models import UsoNova

pytestmark = pytest.mark.django_db

AHORA = datetime(2026, 10, 20, 15, tzinfo=UTC)
ANALISIS = {
    "hallazgoPrincipal": "Persona A sostiene un cumplimiento del 50%.",
    "riesgos": ["Persona A tiene una tarea vencida."],
    "aspectosPositivos": ["Persona A registra avance."],
    "recomendaciones": ["Revisar con Persona A sus pendientes esta semana."],
}


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    congelar(monkeypatch, AHORA)


@pytest.fixture
def ana_completa():
    """Ana con apellido, una tarea con su nombre en el título, un permiso
    médico y un estado especial (datos de salud que nunca deben salir)."""
    persona = make_user("anunez2", "ASISTENTE_GH", first_name="Ana", last_name="Núñez")
    tarea(persona, end_date=datetime(2026, 10, 10, 15, tzinfo=UTC), title="Cierre de Ana Núñez")
    tarea(persona, end_date=datetime(2026, 10, 30, 15, tzinfo=UTC), status="COMPLETADA")
    LeaveRecord.objects.create(
        user=persona,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 10, 15),
        is_full_day=True,
        observation="Cita con el cardiólogo",
        created_by=persona,
    )
    SpecialStatus.objects.create(
        user=persona,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 10, 1),
        created_by=persona,
    )
    return persona


def _sin_datos_personales(enviado: str):
    for prohibido in ("Ana", "Núñez", "anunez", "MATERNIDAD", "aternidad", "MEDICO", "édic"):
        assert prohibido not in enviado, prohibido


# ── KPI ─────────────────────────────────────────────────────────────────────


def test_kpi_completo_para_la_jefatura(jefa, ana_completa, proveedor_falso):
    organigrama(jefa, ana_completa)
    proveedor_falso.respuesta = ANALISIS
    respuesta = client_for(jefa).get(f"/api/v1/nova/kpi/{ana_completa.pk}/")
    assert respuesta.status_code == 200, respuesta.content
    datos = respuesta.json()
    assert datos["variante"] == "completo" and datos["con_ia"]
    assert datos["hallazgo_principal"] == "Ana Núñez sostiene un cumplimiento del 50%."
    assert datos["riesgos"] and datos["recomendaciones"]
    _sin_datos_personales(proveedor_falso.enviado())
    # Se envía el cargo, no el nombre.
    assert "Persona A" in proveedor_falso.enviado()

    # Segunda vez: de la caché, sin otra llamada.
    client_for(jefa).get(f"/api/v1/nova/kpi/{ana_completa.pk}/")
    assert len(proveedor_falso.pedidos) == 1


def test_kpi_motivacional_para_si_misma(ana_completa, proveedor_falso):
    proveedor_falso.respuesta = {"messages": ["Va muy bien.", "Siga así."]}
    datos = client_for(ana_completa).get(f"/api/v1/nova/kpi/{ana_completa.pk}/").json()
    assert datos["variante"] == "motivacional" and datos["mensajes"] == [
        "Va muy bien.",
        "Siga así.",
    ]
    assert proveedor_falso.pedidos[0]["output_config"]["effort"] == "low"
    _sin_datos_personales(proveedor_falso.enviado())


def test_kpi_solo_hallazgos_con_kpi_equipo(
    coordinadora, ana_completa, proveedor_falso, monkeypatch
):
    organigrama(coordinadora, ana_completa)
    proveedor_falso.respuesta = ANALISIS
    monkeypatch.setattr(kpi, "variante", lambda a, t: kpi.SOLO_HALLAZGOS)
    datos = client_for(coordinadora).get(f"/api/v1/nova/kpi/{ana_completa.pk}/").json()
    assert "riesgos" not in datos and "recomendaciones" not in datos
    assert datos["aspectos_positivos"]


def test_kpi_fuera_de_su_ambito_es_403(coordinadora, externo, proveedor_falso):
    respuesta = client_for(coordinadora).get(f"/api/v1/nova/kpi/{externo.pk}/")
    assert respuesta.status_code == 403
    assert proveedor_falso.pedidos == []


def test_kpi_sin_permiso_de_nova_es_403(jefa, ana_completa):
    from django.contrib.auth.models import Group

    organigrama(jefa, ana_completa)
    for rol in Group.objects.filter(user=jefa):
        rol.permissions.remove(*rol.permissions.filter(codename="nova.analisis_kpi"))
    assert client_for(jefa).get(f"/api/v1/nova/kpi/{ana_completa.pk}/").status_code == 403


def test_kpi_sin_clave_da_la_version_sin_ia(jefa, ana_completa):
    organigrama(jefa, ana_completa)
    datos = client_for(jefa).get(f"/api/v1/nova/kpi/{ana_completa.pk}/").json()
    assert datos["con_ia"] is False and datos["motivo"] == "sin_clave"
    assert datos["hallazgo_principal"].startswith("Equilibrio Operativo:")
    assert datos["riesgos"] and datos["aspectos_positivos"] and datos["recomendaciones"]


def test_variantes_por_permiso(jefa, ana, nino):
    """Jefatura (`kpi.ejecutivo`) → completo; analista con `kpi.equipo` →
    solo hallazgos, también sobre sí (como el nivel 2 de Nexo); sin equipo,
    sobre sí → motivacional."""
    assert kpi.variante(jefa, ana) == kpi.COMPLETO
    assert kpi.variante(ana, ana) == kpi.SOLO_HALLAZGOS
    assert kpi.variante(nino, nino) == kpi.MOTIVACIONAL


# ── Inicio ──────────────────────────────────────────────────────────────────


def test_frase_sin_ia_sigue_las_reglas_de_nexo():
    base = {
        "tareasVencidas": 0,
        "tareasPorVencer": 0,
        "cargaHoyPct": 100,
        "cargaHoyHoras": 8,
        "cargaHoyBase": 8,
        "esFinDeSemana": False,
        "completadasMes": 0,
        "esLiderazgo": False,
    }
    assert inicio.frase_sin_ia({**base, "tareasVencidas": 2}).startswith("Revisión urgente")
    assert "1 tarea próxima" in inicio.frase_sin_ia({**base, "tareasPorVencer": 1})
    assert "130%" in inicio.frase_sin_ia({**base, "cargaHoyPct": 130})
    assert "130%" not in inicio.frase_sin_ia({**base, "cargaHoyPct": 130, "esLiderazgo": True})
    assert "completó 3 tareas" in inicio.frase_sin_ia({**base, "completadasMes": 3})
    assert inicio.frase_sin_ia(base) == inicio.FRASE_GENERICA


def test_inicio_solo_cifras_y_maximo_25_palabras(ana_completa, proveedor_falso):
    proveedor_falso.respuesta = " ".join(["palabra"] * 40)
    datos = client_for(ana_completa).get("/api/v1/nova/inicio/").json()
    assert datos["con_ia"] and len(datos["mensaje"].split()) == 25
    (pedido,) = proveedor_falso.pedidos
    assert pedido["output_config"] == {"effort": "low"}
    enviado = proveedor_falso.enviado()
    _sin_datos_personales(enviado)
    assert "Cierre" not in enviado and '"tareasVencidas": 1' in enviado


def test_inicio_sin_ia(ana_completa):
    datos = client_for(ana_completa).get("/api/v1/nova/inicio/").json()
    assert datos["con_ia"] is False
    assert datos["mensaje"] == "Revisión urgente: tiene 1 tarea vencida."


def test_inicio_sin_permiso_es_403():
    persona = make_user("sinrol")
    assert client_for(persona).get("/api/v1/nova/inicio/").status_code == 403


def test_me(ana, proveedor_falso):
    datos = client_for(ana).get("/api/v1/nova/me/").json()
    assert datos["proveedor"] == "anthropic" and datos["disponible"]
    assert "nova.analisis_kpi" in datos["permisos"]
    assert datos["limite_diario"] == 40


# ── Informes ────────────────────────────────────────────────────────────────


def _respuesta_de_seccion(parametros):
    requeridos = parametros["output_config"]["format"]["schema"]["required"]
    if requeridos == ["enriquecimiento"]:
        return {"enriquecimiento": []}
    textos = {
        c: "Persona A lidera; Persona B requiere apoyo."
        for c in ("situacionGeneral", "fortalezas", "aspectosAtencion", "conclusion")
    }
    if "situacionGeneral" in requeridos:
        return textos
    if "patrones" in requeridos:
        return {c: ["Persona A concentra el avance."] for c in requeridos}
    return "no es JSON"  # la evaluación falla: queda sin IA


def test_narrativa_del_informe_con_ia(coordinadora, proveedor_falso):
    ana = make_user("ana3", "ANALISTA_CC", first_name="Ana", last_name="Núñez")
    nino = make_user("nino3", "ASISTENTE_GH", first_name="Niño", last_name="Peñaherrera")
    organigrama(coordinadora, ana, nino)
    tarea(ana, end_date=datetime(2026, 3, 10, 15, tzinfo=UTC), status="COMPLETADA")
    tarea(nino, end_date=datetime(2026, 3, 12, 15, tzinfo=UTC), title="Revisar con Ana Núñez")
    proveedor_falso.respuesta = _respuesta_de_seccion

    respuesta = client_for(coordinadora).post(
        "/api/v1/informes/executive/", {"tipo": "MENSUAL", "mes": "2026-03"}, format="json"
    )
    assert respuesta.status_code == 201, respuesta.content
    informe = respuesta.json()
    doc = informe["data"]
    assert doc["novaOrigen"] == "NOVA"
    assert set(doc["novaSeccionesSinIa"]) == {"executiveAssessment", "recommendationEnrichment"}
    assert doc["novaDegraded"] is True and informe["nova_degraded"] is True
    resumen = doc["nova"]["executiveSummary"]["situacionGeneral"]
    assert "Persona" not in resumen and ("Ana" in resumen or "Niño" in resumen)
    assert len(proveedor_falso.pedidos) == 4
    _sin_datos_personales(proveedor_falso.enviado())
    assert "Niño" not in proveedor_falso.enviado()

    paginas = {p["kind"]: p for p in informe["pages"]}
    assert paginas["executiveSummary"]["conIa"] is True
    assert paginas["assessment"]["conIa"] is False
    assert UsoNova.objects.filter(funcion="informe", llamada=True).count() == 4


def test_narrativa_sin_permiso_no_llama(coordinadora, equipo, proveedor_falso):
    from django.contrib.auth.models import Group

    for rol in Group.objects.filter(user=coordinadora):
        rol.permissions.remove(*rol.permissions.filter(codename="nova.narrativa_informes"))
    tarea(equipo[0], end_date=datetime(2026, 3, 10, 15, tzinfo=UTC))
    informe = (
        client_for(coordinadora)
        .post("/api/v1/informes/executive/", {"tipo": "MENSUAL", "mes": "2026-03"}, format="json")
        .json()
    )
    assert informe["data"]["novaOrigen"] == "DETERMINISTA"
    assert informe["data"]["novaDegraded"] is False
    assert proveedor_falso.pedidos == []
