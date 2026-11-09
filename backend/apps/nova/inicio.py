"""La frase de Nova en el inicio de Gestión Humana (Nexo:
`src/app/api/dashboard/nova-message/route.ts`).

Una frase de hasta 25 palabras sobre las tareas y la carga del día de la
propia persona. A la IA van **solo cifras** (cuántas vencidas, por vencer,
completadas en el mes, el porcentaje de carga de hoy y si es fin de semana):
ni nombres ni títulos de tareas. Caché por persona (`NOVA_CACHE_MINUTOS`).

Sin clave, sin permiso de la IA o si falla, la frase sale de las mismas reglas
de Nexo (`frase_sin_ia`), en el mismo orden de prioridad.
"""

from datetime import timedelta

from django.utils import timezone

from apps.analytics import access as kpi_access
from apps.analytics.utils import is_task_overdue
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task
from apps.tasks.roles import ROLE_LEVEL, gh_role_of

from . import nucleo
from .seudonimos import Seudonimizador

FUNCION = "inicio"
MAXIMO_PALABRAS = 25

FRASE_GENERICA = "Bienvenido a Gestión Humana. Revise sus tareas pendientes para comenzar el día."

SISTEMA = (
    "Eres Nova, asistente de la intranet. Genera UN mensaje corto (máximo 25 palabras) para el "
    "inicio de Gestión Humana de la persona, en español, tratando de usted, sin saludo, directo y "
    "accionable. Basa el mensaje ÚNICAMENTE en los datos que te doy, usando los números exactos, "
    "sin inventar nada. Prioriza en este orden: (1) si hay tareas vencidas, alerta sobre eso "
    "primero con tono de urgencia; (2) si no hay vencidas pero hay tareas por vencer esta "
    "semana, menciónalas; (3) si no hay ninguna de las dos, hoy NO es fin de semana "
    "(esFinDeSemana=false) y la carga laboral de hoy es mayor a 120% o menor a 60%, coméntalo "
    "con el porcentaje y las horas; si esFinDeSemana=true, nunca comentes la carga de hoy y pasa "
    "a la regla (4); (4) si todo está en orden, felicita por las tareas completadas este mes. "
    "Si esLiderazgo=true (dirige equipos y no ejecuta tareas operativas), IGNORA la regla (3): "
    "nunca menciones su carga, horas ni porcentajes individuales; pasa a la regla (4) o, si "
    "tampoco aplica, sugiere revisar los indicadores del equipo. Ejemplos de estilo: «Revisión "
    "urgente: tiene 3 tareas vencidas», «Tiene 2 tareas próximas a vencer esta semana», «Su "
    "carga laboral hoy es del 130% (10.4 h de 8 h)», «Buen ritmo: completó 5 tareas este mes». "
    "Responde solo con la frase, sin comillas."
)


def _plural(n: int, singular: str, plural: str) -> str:
    return singular if n == 1 else plural


def frase_sin_ia(ctx: dict) -> str:
    """Las reglas de Nexo (`buildFallback`), en el mismo orden."""
    vencidas, por_vencer = ctx["tareasVencidas"], ctx["tareasPorVencer"]
    if vencidas > 0:
        return (
            f"Revisión urgente: tiene {vencidas} "
            f"{_plural(vencidas, 'tarea vencida', 'tareas vencidas')}."
        )
    if por_vencer > 0:
        return (
            f"Tiene {por_vencer} "
            f"{_plural(por_vencer, 'tarea próxima a vencer', 'tareas próximas a vencer')} "
            "esta semana."
        )
    if (
        not ctx["esLiderazgo"]
        and not ctx["esFinDeSemana"]
        and (ctx["cargaHoyPct"] > 120 or ctx["cargaHoyPct"] < 60)
    ):
        return (
            f"Su carga laboral hoy es del {ctx['cargaHoyPct']}% "
            f"({ctx['cargaHoyHoras']} h de {ctx['cargaHoyBase']} h)."
        )
    completadas = ctx["completadasMes"]
    if completadas > 0:
        return (
            f"Buen ritmo: completó {completadas} {_plural(completadas, 'tarea', 'tareas')} "
            "este mes."
        )
    if ctx["esLiderazgo"]:
        return (
            "Bienvenido a Gestión Humana. Revise los indicadores del equipo para comenzar el día."
        )
    return FRASE_GENERICA


def contexto(usuario, now=None) -> dict:
    """Las cifras del día de la persona (solo números y banderas)."""
    from apps.analytics.workload import compute_carga_tiempo

    now = now or timezone.now()
    hoy = business_calendar_day(now)
    fin_de_semana = hoy + timedelta(days=6 - hoy.weekday())
    inicio_de_mes = hoy.replace(day=1)
    tareas = list(
        Task.objects.filter(assigned_to=usuario, archived_month__isnull=True).only(
            "status", "end_date"
        )
    )

    def dia(t):
        return business_calendar_day(t.end_date)

    vencidas = sum(1 for t in tareas if is_task_overdue(t.end_date, t.status, now))
    por_vencer = sum(
        1 for t in tareas if t.status != Task.Status.COMPLETADA and hoy <= dia(t) <= fin_de_semana
    )
    # Como Nexo: completadas cuyo vencimiento cae en el mes en curso.
    completadas = sum(
        1
        for t in tareas
        if t.status == Task.Status.COMPLETADA
        and (dia(t).year, dia(t).month) == (inicio_de_mes.year, inicio_de_mes.month)
    )
    try:
        diaria = compute_carga_tiempo(user=usuario, now=now)["diaria"]
    except Exception:  # noqa: BLE001 — sin carga, la frase sigue con las tareas
        diaria = {}
    rol = gh_role_of(usuario)
    return {
        "tareasVencidas": vencidas,
        "tareasPorVencer": por_vencer,
        "cargaHoyPct": int(diaria.get("pct") or 0),
        "cargaHoyHoras": round(float(diaria.get("real_hours") or 0), 1),
        "cargaHoyBase": round(float(diaria.get("base_hours") or 0), 1),
        "esFinDeSemana": bool(diaria.get("is_weekend")) or hoy.weekday() >= 5,
        "completadasMes": completadas,
        "esLiderazgo": bool(rol) and ROLE_LEVEL.get(rol, 0) >= kpi_access.LEADERSHIP_LEVEL,
    }


def _recortar(frase: str) -> str:
    """Una sola línea y como mucho `MAXIMO_PALABRAS` palabras."""
    frase = " ".join((frase or "").replace("\n", " ").split()).strip("«»\"' ")
    palabras = frase.split(" ")
    if len(palabras) > MAXIMO_PALABRAS:
        frase = " ".join(palabras[:MAXIMO_PALABRAS]).rstrip(",;:") + "…"
    return frase


def mensaje(usuario) -> dict:
    clave = nucleo.clave_cache(FUNCION, usuario.pk)
    guardado = nucleo.leer_cache(clave)
    if guardado is not None:
        return {**guardado, "en_cache": True}

    ctx = contexto(usuario)
    respaldo = frase_sin_ia(ctx)
    resultado = nucleo.generar(
        usuario,
        FUNCION,
        nucleo.Pedido(
            sistema=SISTEMA,
            datos=ctx,
            respuesta_json=False,
            max_tokens=2048,
            temperatura=0.5,
            esfuerzo="low",
        ),
        Seudonimizador(),
    )
    frase = _recortar(resultado.texto) if resultado.con_ia else ""
    respuesta = {
        "mensaje": frase or respaldo,
        "con_ia": bool(frase),
        "motivo": None if frase else (resultado.motivo or nucleo.R.FALLO),
        "aviso": None if frase else (resultado.mensaje or nucleo.MENSAJES[nucleo.R.FALLO]),
        "generado_en": timezone.now().isoformat(),
    }
    if respuesta["con_ia"]:
        nucleo.guardar_cache(clave, respuesta)
    return {**respuesta, "en_cache": False}
