"""Exportación del KPI a Excel (decisión del usuario, 05/11/2026).

Tres archivos, cada uno con **el mismo ámbito y los mismos permisos que su
pantalla** (las vistas `Kpi*ExportView` reutilizan los mismos cálculos):

- **Mis KPI del mes** (`build_kpi_payload` con actor = titular): una hoja de
  resumen con los indicadores, una con las tareas del mes y otra con las horas
  por semana.
- **KPI del equipo** (`build_team_kpi_rows`, `kpi.equipo`): una fila por
  persona del equipo ejecutor según el organigrama.
- **Resumen ejecutivo** (`build_executive_dashboard_payload`,
  `kpi.ejecutivo`): resumen, personas, tendencia de seis meses, alertas, y
  cambios y puntos de atención.

Convenciones:

- **Horas en número**, con la unidad en la cabecera («Horas reales (h)»), con
  dos decimales: así se suman y se filtran en la hoja. Los porcentajes, igual
  («Cumplimiento (%)»).
- **LOPDP.** Las ausencias van como horas de ausencia; el desglose (permiso
  médico, personal, vacaciones) solo para quien puede ver el tipo
  (`access.leave_detail_visible`: el titular o `ausencias.medicas_ver`), igual
  que en pantalla. Los estados especiales (maternidad, lactancia) no se
  exportan.
- **Inyección de fórmulas.** Todo texto pasa por `neutralizar`
  (`apps.core.hojas_de_calculo`), como los demás Excel de la intranet: lo que
  empieza por `=`, `+`, `-` o `@` queda como texto.
"""

from datetime import date, datetime
from datetime import timezone as dt_timezone
from io import BytesIO

from django.contrib.auth import get_user_model
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from apps.core.hojas_de_calculo import neutralizar
from apps.tasks.models import Task
from apps.tasks.roles import role_label
from apps.tasks.rounding import round_half_up

from . import access
from .configuracion import (
    get_effective_horas_efectivas,
    get_team_leave_minutes_by_day,
    total_leave_minutes,
)
from .services import _month_bounds
from .workload import _MONTH_NAMES

CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
RELLENO_CABECERA = PatternFill("solid", fgColor="D9E2F3")

SEMAFORO = {
    "green": "Verde",
    "yellow": "Amarillo",
    "orange": "Naranja",
    "red": "Rojo",
    "gray": "Gris",
}
ESTADO_EQUIPO = {"green": "Saludable", "yellow": "Atención", "red": "Crítico"}


# ── Utilidades ──────────────────────────────────────────────────────────────


def nombre_del_periodo(year: int, month: int) -> str:
    return f"{_MONTH_NAMES[month - 1]} de {year}"


def clave_del_periodo(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _horas(minutos) -> float:
    return round_half_up((minutos or 0) / 60, 2)


def _nombre_completo(usuario) -> str:
    return usuario.get_full_name() or usuario.username


def _rol(codigo: str) -> str:
    return role_label(codigo) if codigo else ""


def _hoja(libro, titulo: str, columnas: list[tuple[str, int]]):
    """Una hoja con su cabecera en negrita, anchos y la primera fila fija."""
    hoja = libro.create_sheet(titulo)
    cabecera = []
    for indice, (nombre, ancho) in enumerate(columnas, start=1):
        celda = WriteOnlyCell(hoja, value=nombre)
        celda.font = Font(bold=True)
        celda.fill = RELLENO_CABECERA
        celda.alignment = Alignment(vertical="center", wrap_text=True)
        cabecera.append(celda)
        hoja.column_dimensions[get_column_letter(indice)].width = ancho
    hoja.freeze_panes = "A2"
    hoja.append(cabecera)
    return hoja


def _fila(hoja, valores) -> None:
    hoja.append([neutralizar(valor) for valor in valores])


def _guardar(libro) -> bytes:
    buffer = BytesIO()
    libro.save(buffer)
    return buffer.getvalue()


def _hoja_de_indicadores(libro, titulo: str, filas: list[tuple[str, object]]) -> None:
    hoja = _hoja(libro, titulo, [("Indicador", 52), ("Valor", 24)])
    for indicador, valor in filas:
        _fila(hoja, [indicador, valor])


# ── Ausencias del mes (LOPDP) ───────────────────────────────────────────────


def ausencias_del_mes(usuarios, year: int, month: int, now: datetime) -> dict[int, dict]:
    """Los minutos de ausencia de cada persona en el mes, con el desglose por
    tipo (dato de salud: enmascarar antes de mostrarlo, ver `_columnas_de_ausencia`)."""
    inicio = date(year, month, 1)
    _, fin_del_mes = _month_bounds(year, month)
    fin = fin_del_mes.date()
    referencia = fin_del_mes if fin_del_mes < now else now
    horas_por_dia = get_effective_horas_efectivas(referencia)
    por_persona = get_team_leave_minutes_by_day(usuarios, inicio, fin)
    return {
        usuario.pk: total_leave_minutes(por_persona.get(usuario.pk, {}), inicio, fin, horas_por_dia)
        for usuario in usuarios
    }


def _total_de_ausencia(totales: dict) -> int:
    return (
        (totales.get("medico_minutes") or 0)
        + (totales.get("personal_minutes") or 0)
        + (totales.get("vacaciones_minutes") or 0)
    )


# ── Mis KPI del mes ─────────────────────────────────────────────────────────


def mis_kpi(*, actor, target, payload: dict, year: int, month: int, now: datetime) -> bytes:
    """El libro de «Mis KPI» del mes: Resumen, Tareas y Horas por semana."""
    libro = Workbook(write_only=True)
    cumplimiento = payload["cumplimiento"]
    calidad = payload["calidad"]
    actividad = payload["actividad"]
    horas_semana = payload["horas_by_week"]

    totales = ausencias_del_mes([target], year, month, now)[target.pk]
    ve_el_tipo = access.leave_detail_visible(actor, target)

    filas: list[tuple[str, object]] = [
        ("Persona", _nombre_completo(target)),
        ("Rol de Gestión Humana", _rol(payload["user"]["role"])),
        ("Período", nombre_del_periodo(year, month)),
        ("Puntaje del mes (0 a 100)", payload["score"]),
        ("Cumplimiento a tiempo (%)", cumplimiento["completed_pct"]),
        ("Semáforo de cumplimiento", SEMAFORO.get(cumplimiento["color"], "")),
        ("Tareas del período", cumplimiento["total"]),
        ("Completadas", cumplimiento["completed"]),
        ("Completadas a tiempo", cumplimiento["completed_on_time"]),
        ("En progreso", cumplimiento["in_progress"]),
        ("Pendientes", cumplimiento["pending"]),
        ("Vencidas", cumplimiento["overdue"]),
        ("Vencidas (%)", cumplimiento["overdue_pct"]),
        ("Atraso promedio de las vencidas (días)", cumplimiento["avg_delay_days"]),
        ("Progreso promedio de las tareas en curso (%)", calidad["avg_progress"]),
        ("Tareas recurrentes completadas (%)", calidad["recurring_pct"]),
        ("Actividades de seguimiento", payload["seguimiento"]["total"]),
        ("Comentarios", actividad["total_comments"]),
        ("Tareas asignadas por otras personas", actividad["assigned_by_others"]),
        ("Tareas propias", actividad["own_tasks"]),
        (
            "Horas estimadas de las tareas (h)",
            round_half_up(sum(s["estimated"] for s in horas_semana), 2),
        ),
        ("Horas reales de las tareas (h)", round_half_up(sum(s["real"] for s in horas_semana), 2)),
        ("Horas de ausencia (h)", _horas(_total_de_ausencia(totales))),
    ]
    if ve_el_tipo:
        filas += [
            ("De ellas, permiso médico (h)", _horas(totales["medico_minutes"])),
            ("De ellas, permiso personal (h)", _horas(totales["personal_minutes"])),
            ("De ellas, vacaciones (h)", _horas(totales["vacaciones_minutes"])),
        ]
    if (year, month) == (now.year, now.month):
        # La carga laboral del motor es la del mes en curso: solo se exporta
        # cuando el período es ese, para no mezclar meses.
        filas += [
            ("Carga laboral del mes en curso (%)", payload["carga_laboral"]["ratio"]),
            ("Horas registradas en el mes en curso (h)", payload["carga_laboral"]["real_hours"]),
            ("Horas base del mes en curso (h)", payload["carga_laboral"]["estimated_hours"]),
        ]
    filas += [
        ("Cumplimiento del mes anterior (%)", payload["prev_month"]["completed_pct"]),
        ("Tareas del mes anterior", payload["prev_month"]["total_tasks"]),
    ]
    _hoja_de_indicadores(libro, "Resumen", filas)

    _hoja_de_tareas(libro, target, payload, year, month)

    hoja = _hoja(
        libro,
        "Horas por semana",
        [("Semana del mes", 18), ("Horas estimadas (h)", 20), ("Horas reales (h)", 18)],
    )
    for semana in horas_semana:
        _fila(hoja, [semana["week"].replace("Sem", "Semana"), semana["estimated"], semana["real"]])
    return _guardar(libro)


def _hoja_de_tareas(libro, target, payload: dict, year: int, month: int) -> None:
    """Las tareas del mes, las mismas del payload (asignadas a la persona y con
    fecha fin en el mes), con sus horas y su progreso."""
    inicio, fin = _month_bounds(year, month)
    por_id = {fila["id"]: fila for fila in payload["tasks"]}
    tareas = Task.objects.filter(
        assigned_to=target, end_date__gte=inicio, end_date__lte=fin
    ).order_by("end_date", "pk")
    hoja = _hoja(
        libro,
        "Tareas",
        [
            ("Tarea", 48),
            ("Tipo", 14),
            ("Prioridad", 12),
            ("Estado", 14),
            ("Fecha fin", 14),
            ("Horas estimadas (h)", 18),
            ("Horas reales (h)", 16),
            ("Progreso (%)", 13),
            ("Días de atraso", 14),
            ("Semáforo", 12),
        ],
    )
    for tarea in tareas:
        fila = por_id.get(tarea.pk, {})
        _fila(
            hoja,
            [
                tarea.title,
                tarea.get_type_display(),
                tarea.get_priority_display(),
                tarea.get_status_display(),
                tarea.end_date.astimezone(dt_timezone.utc).date(),
                round_half_up(tarea.estimated_hours or 0, 2),
                round_half_up(tarea.real_hours or 0, 2),
                tarea.progress,
                fila.get("delay_days", 0),
                SEMAFORO.get(fila.get("color", ""), ""),
            ],
        )


# ── KPI del equipo ──────────────────────────────────────────────────────────


def kpi_del_equipo(*, actor, filas: list[dict], year: int, month: int, now: datetime) -> bytes:
    """Una fila por persona del equipo ejecutor, con sus indicadores del mes y
    sus horas de ausencia (el tipo solo si quien exporta puede verlo)."""
    User = get_user_model()
    personas = {u.pk: u for u in User.objects.filter(pk__in=[f["id"] for f in filas])}
    ausencias = ausencias_del_mes(list(personas.values()), year, month, now)
    # El desglose va por columna: solo si quien exporta ve el tipo de todas.
    con_tipo = bool(filas) and all(
        access.leave_detail_visible(actor, personas[f["id"]]) for f in filas
    )

    columnas = [
        ("Persona", 32),
        ("Rol de Gestión Humana", 30),
        ("Puntaje (0 a 100)", 14),
        ("Cumplimiento (%)", 15),
        ("Semáforo de cumplimiento", 16),
        ("Tareas del mes", 12),
        ("Vencidas", 10),
        ("Horas reales / estimadas (%)", 16),
        ("Carga laboral (%)", 14),
        ("Estado de carga", 18),
        ("Horas registradas (h)", 16),
        ("Horas base del mes (h)", 16),
        ("Horas disponibles (h)", 16),
        ("Capacidad disponible (%)", 16),
        ("Horas de ausencia (h)", 16),
    ]
    if con_tipo:
        columnas += [
            ("De ellas, permiso médico (h)", 18),
            ("De ellas, permiso personal (h)", 18),
            ("De ellas, vacaciones (h)", 16),
        ]
    libro = Workbook(write_only=True)
    hoja = _hoja(libro, "Equipo", columnas)
    for f in filas:
        persona = personas[f["id"]]
        totales = ausencias.get(persona.pk, {})
        valores = [
            _nombre_completo(persona),
            _rol(f["role"]),
            f["score"],
            f["completed_pct"],
            SEMAFORO.get(f["color"], ""),
            f["total_tasks"],
            f["overdue_count"],
            f["carga_ratio"],
            f["carga_pct"],
            f["carga_label"],
            f["carga_real_hours"],
            f["carga_base_hours"],
            f["horas_disponibles"],
            f["capacidad_disponible_pct"],
            _horas(_total_de_ausencia(totales)),
        ]
        if con_tipo:
            valores += [
                _horas(totales.get("medico_minutes")),
                _horas(totales.get("personal_minutes")),
                _horas(totales.get("vacaciones_minutes")),
            ]
        _fila(hoja, valores)

    _hoja_de_indicadores(
        libro,
        "Acerca de",
        [
            ("Período", nombre_del_periodo(year, month)),
            ("Personas", len(filas)),
            (
                "Ámbito",
                "Su equipo ejecutor según el organigrama (sin el liderazgo de Gestión Humana)",
            ),
        ],
    )
    return _guardar(libro)


# ── Resumen ejecutivo ───────────────────────────────────────────────────────


def resumen_ejecutivo(*, payload: dict, year: int, month: int) -> bytes:
    """El resumen ejecutivo del equipo: lo que muestra la pantalla, en hojas."""
    libro = Workbook(write_only=True)
    overview = payload["overview"]
    ceo = payload["ceo"]
    tendencia = payload["trend"]

    _hoja_de_indicadores(
        libro,
        "Resumen",
        [
            ("Período", nombre_del_periodo(year, month)),
            (
                "Tendencia desde",
                tendencia[0]["month"] if tendencia else clave_del_periodo(year, month),
            ),
            ("Estado del equipo", ceo["estado_label"] or ESTADO_EQUIPO.get(ceo["estado"], "")),
            ("Cumplimiento promedio (%)", overview["avg_cumplimiento"]),
            ("Variación frente al mes anterior (puntos)", payload["trend_delta"]),
            ("Personas en sobrecarga", overview["sobrecarga_count"]),
            ("Personas en subutilización", overview["subutilizacion_count"]),
            ("Horas registradas del equipo (h)", overview["total_horas"]),
            ("Actividades de seguimiento", overview["total_consultas"]),
            ("Performance Score promedio", ceo["performance"]["avg"]),
            ("Clasificación del Performance Score", ceo["performance"]["classification"]),
            ("Riesgo operativo promedio", ceo["operational_risk"]["avg"]),
            ("Clasificación del riesgo operativo", ceo["operational_risk"]["classification"]),
        ],
    )

    hoja = _hoja(
        libro,
        "Personas",
        [
            ("Posición", 10),
            ("Persona", 32),
            ("Rol de Gestión Humana", 30),
            ("Puntaje (0 a 100)", 14),
            ("Variación del puntaje (puntos)", 16),
            ("Cumplimiento (%)", 15),
            ("Tareas del mes", 12),
            ("Completadas", 12),
            ("Carga laboral (%)", 14),
            ("Estado de carga", 18),
            ("Horas registradas (h)", 16),
            ("Horas base del mes (h)", 16),
        ],
    )
    User = get_user_model()
    ids = [m["id"] for m in payload["ranking"]]
    nombres = {u.pk: _nombre_completo(u) for u in User.objects.filter(pk__in=ids)}
    for posicion, m in enumerate(payload["ranking"], start=1):
        _fila(
            hoja,
            [
                posicion,
                nombres.get(m["id"], m["name"]),
                _rol(m["role"]),
                m["score"],
                m["score_trend"],
                m["completed_pct"],
                m["total_tasks"],
                m["completed"],
                m["carga_pct"],
                m["carga_label"],
                m["carga_real_hours"],
                m["carga_base_hours"],
            ],
        )

    hoja = _hoja(libro, "Tendencia", [("Mes", 12), ("Cumplimiento promedio (%)", 24)])
    for punto in tendencia:
        _fila(hoja, [punto["month"], punto["avg_cumplimiento"]])

    hoja = _hoja(libro, "Alertas", [("Alerta", 26), ("Persona", 32), ("Valor (%)", 12)])
    for alerta in payload["alerts"]["low_cumplimiento"]:
        _fila(hoja, ["Cumplimiento bajo", alerta["name"], alerta["value"]])
    for alerta in payload["alerts"]["sobrecarga"]:
        _fila(hoja, ["Sobrecarga", alerta["name"], alerta["value"]])

    hoja = _hoja(libro, "Cambios y atención", [("Tipo", 22), ("Detalle", 80)])
    for cambio in ceo["cambios"]:
        tipo = "Cambio positivo" if cambio["positive"] else "Cambio negativo"
        _fila(hoja, [tipo, cambio["text"]])
    for texto in ceo["atender"]:
        _fila(hoja, ["Atender", texto])
    return _guardar(libro)
