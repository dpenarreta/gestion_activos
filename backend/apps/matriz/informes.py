"""Reportes de la Matriz y sus exportaciones a Excel y PDF (§16).

Los archivos se dibujan con los mismos renderizadores que los reportes del
inventario (`apps/reportes`): misma cabecera, mismo aspecto y la misma
neutralización de fórmulas en Excel. Aquí solo se arma lo que llevan.

Las exportaciones tienen **las mismas filas y filtros que la pantalla**: se
construyen con la misma consulta que la vista, no con una propia, para que el
archivo no pueda decir algo distinto de lo que se veía al exportar.
"""

from dataclasses import dataclass

from django.http import HttpResponse
from django.utils import timezone

from apps.reportes import render_excel, render_pdf

from . import estados
from .fechas import MESES

#: Tope de filas de un archivo: más que eso no se revisa ni se imprime.
MAXIMO_FILAS = 5000


@dataclass(frozen=True)
class Columna:
    etiqueta: str
    ancho: int


@dataclass(frozen=True)
class Encabezado:
    nombre: str
    descripcion: str


# --- El reporte (§15.8, §16) -------------------------------------------------------------


def _porcentaje(parte: int, total: int) -> int:
    return round(parte * 100 / total) if total else 0


def calcular(periodos, ahora=None) -> dict:
    """Indicadores y conteos por área y por entidad de los períodos dados."""
    ahora = ahora or timezone.now()
    cerrados = a_tiempo = tarde = incumplidos = en_progreso = 0
    por_area, por_entidad = {}, {}
    for periodo in periodos:
        situacion = estados.estado(periodo, ahora)
        grupo = situacion["group"]
        if grupo == estados.FINALIZADO:
            cerrados += 1
            if situacion["is_late"]:
                tarde += 1
            else:
                a_tiempo += 1
        elif grupo == estados.INCUMPLIDO:
            incumplidos += 1
        else:
            en_progreso += 1
        for destino, nombre in (
            (por_area, periodo.obligacion.area.nombre),
            (por_entidad, periodo.obligacion.entidad.nombre),
        ):
            fila = destino.setdefault(
                nombre,
                {
                    "name": nombre,
                    estados.FINALIZADO: 0,
                    estados.EN_PROGRESO: 0,
                    estados.INCUMPLIDO: 0,
                    "total": 0,
                },
            )
            fila[grupo] += 1
            fila["total"] += 1

    def ordenadas(filas):
        return sorted(filas.values(), key=lambda fila: fila["name"].lower())

    return {
        "kpis": {
            "on_time_pct": _porcentaje(a_tiempo, cerrados),
            "late_pct": _porcentaje(tarde, cerrados),
            "overdue": incumplidos,
            "in_progress": en_progreso,
            "closed": cerrados,
            "closed_on_time": a_tiempo,
            "closed_late": tarde,
            "total": cerrados + incumplidos + en_progreso,
        },
        "by_area": ordenadas(por_area),
        "by_entity": ordenadas(por_entidad),
    }


# --- Los archivos -----------------------------------------------------------------------


def _contexto(empresa, usuario, filtros: str) -> str:
    """Empresa, fecha de corte y quién exportó, más los filtros (§16)."""
    ahora = timezone.now().astimezone(estados.zona_de(empresa))
    partes = [
        empresa.nombre,
        f"corte {ahora:%Y-%m-%d %H:%M} ({empresa.zona_horaria})",
        f"exportado por {usuario.get_full_name() or usuario.username}",
    ]
    if filtros:
        partes.append(filtros)
    return " · ".join(partes)


def _vence(periodo) -> str:
    local = periodo.vence_en.astimezone(estados.zona_de(periodo.empresa))
    return f"{local.day} {MESES[local.month - 1][:3].lower()} {local.year} {local:%H:%M}"


def _archivo(formato: str, encabezado, resultado, contexto: str, nombre: str) -> HttpResponse:
    if formato == "pdf":
        contenido = render_pdf.exportar(encabezado, resultado, contexto)
        tipo, extension = "application/pdf", "pdf"
    else:
        contenido = render_excel.exportar(encabezado, resultado, contexto)
        tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        extension = "xlsx"
    respuesta = HttpResponse(contenido, content_type=tipo)
    respuesta["Content-Disposition"] = f'attachment; filename="{nombre}.{extension}"'
    return respuesta


COLUMNAS_MATRIZ = [
    Columna("Código", 11),
    Columna("Obligación", 34),
    Columna("Período", 14),
    Columna("Tema", 20),
    Columna("Entidad", 22),
    Columna("Responsable", 20),
    Columna("Prioridad", 9),
    Columna("Vence", 17),
    Columna("Estado", 18),
    Columna("Avance", 8),
]


def exportar_matriz(periodos, *, empresa, usuario, formato: str, filtros: str) -> HttpResponse:
    """La matriz, con las filas y el orden de la pantalla."""
    ahora = timezone.now()
    total = periodos.count()
    filas = [
        [
            p.codigo,
            p.obligacion.nombre,
            p.etiqueta,
            p.obligacion.area.nombre,
            p.obligacion.entidad.nombre,
            p.responsable.get_full_name() or p.responsable.username,
            p.get_prioridad_display(),
            _vence(p),
            estados.estado(p, ahora)["label"],
            f"{p.avance}%",
        ]
        for p in periodos[:MAXIMO_FILAS]
    ]
    resultado = {
        "columnas": COLUMNAS_MATRIZ,
        "filas": filas,
        "total": total,
        "truncado": total > MAXIMO_FILAS,
        "totales": {},
    }
    encabezado = Encabezado(
        "Matriz de obligaciones", "Períodos de la empresa con los filtros de la pantalla."
    )
    return _archivo(
        formato,
        encabezado,
        resultado,
        _contexto(empresa, usuario, filtros),
        f"matriz-{empresa.codigo}-{timezone.now():%Y%m%d}",
    )


COLUMNAS_REPORTE = [
    Columna("Agrupación", 12),
    Columna("Nombre", 40),
    Columna("Finalizados", 12),
    Columna("En progreso", 12),
    Columna("Incumplidos", 12),
    Columna("Total", 10),
]


def exportar_reporte(datos, *, empresa, usuario, formato: str, filtros: str) -> HttpResponse:
    """Los indicadores y las tablas por área y por entidad."""
    kpis = datos["kpis"]
    filas = [
        [
            grupo,
            fila["name"],
            fila[estados.FINALIZADO],
            fila[estados.EN_PROGRESO],
            fila[estados.INCUMPLIDO],
            fila["total"],
        ]
        for grupo, clave in (("Tema", "by_area"), ("Entidad", "by_entity"))
        for fila in datos[clave]
    ]
    resultado = {
        "columnas": COLUMNAS_REPORTE,
        "filas": filas,
        "total": len(filas),
        "truncado": False,
        "totales": {},
    }
    encabezado = Encabezado(
        "Reporte de cumplimiento",
        f"A tiempo {kpis['on_time_pct']} % · fuera de plazo {kpis['late_pct']} % · "
        f"incumplidas {kpis['overdue']} · en progreso {kpis['in_progress']} · "
        f"cerradas {kpis['closed']}",
    )
    return _archivo(
        formato,
        encabezado,
        resultado,
        _contexto(empresa, usuario, filtros),
        f"reporte-matriz-{empresa.codigo}-{timezone.now():%Y%m%d}",
    )
