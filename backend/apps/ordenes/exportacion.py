"""Exportación de las órdenes a Excel y PDF, con los renderizadores de Reportes.

Usa los mismos que los reportes del inventario (`apps.reportes.render_*`):
cabecera con el nombre, los filtros y la fecha de emisión, y el corte de filas
en el PDF. El teléfono sale enmascarado salvo para quien tiene
`ordenes.ver_contacto`, igual que en pantalla.
"""

from decimal import Decimal

from apps.reportes.catalogo import MAX_FILAS, MAX_FILAS_PDF, Columna, Reporte

from .serializers import enmascarar_telefono

CUMPLIMIENTO = {
    "cerrada": "Cerrada",
    "vencida": "Vencida",
    "en_plazo": "En plazo",
    "sin_fecha": "Sin fecha",
}


def _responsable(orden):
    if not orden.tecnico_id:
        return "Sin asignar"
    nombre = orden.tecnico.get_full_name() or orden.tecnico.username
    return f"{nombre} ({orden.proveedor.nombre})" if orden.proveedor_id else nombre


def reporte(ver_contacto: bool) -> Reporte:
    def contacto(orden):
        return (
            orden.telefono_contacto
            if ver_contacto
            else enmascarar_telefono(orden.telefono_contacto)
        )

    columnas = (
        Columna("numero", "N.º orden", lambda o: o.numero, 18),
        Columna("sede", "Sede", lambda o: o.sede.nombre, 26),
        Columna("ciudad", "Ciudad", lambda o: o.sede.ciudad, 16),
        Columna("region", "Región", lambda o: o.sede.get_region_display(), 12),
        Columna("provincia", "Provincia", lambda o: o.sede.provincia, 16),
        Columna("categoria", "Categoría", lambda o: o.get_categoria_display(), 16),
        Columna("prioridad", "Prioridad", lambda o: o.get_prioridad_display(), 11),
        Columna("estado", "Estado", lambda o: o.get_estado_display(), 18),
        Columna("titulo", "Trabajo", lambda o: o.titulo, 36),
        Columna("responsable", "Responsable", _responsable, 26),
        Columna(
            "programada",
            "Programada",
            lambda o: o.fecha_programada.isoformat() if o.fecha_programada else "",
            12,
        ),
        Columna("cumplimiento", "Cumplimiento", lambda o: CUMPLIMIENTO[o.cumplimiento()], 13),
        Columna("contacto", "Contacto solicitante", contacto, 16),
        Columna("total", "Total (con IVA)", lambda o: o.costos()["total"], 14),
    )
    return Reporte(
        clave="ordenes_de_trabajo",
        nombre="Órdenes de trabajo",
        descripcion="Mantenimiento de sedes: órdenes, estado, cumplimiento y costo con IVA.",
        fuente="ordenes",
        columnas=columnas,
        columnas_pdf=(
            "numero",
            "sede",
            "categoria",
            "prioridad",
            "estado",
            "responsable",
            "programada",
            "cumplimiento",
            "total",
        ),
        totalizar=("total",),
    )


def resultado(reporte_, ordenes, formato: str) -> dict:
    """Las filas en la forma que esperan los renderizadores de Reportes."""
    columnas = reporte_.columnas_para(formato)
    tope = MAX_FILAS_PDF if formato == "pdf" else MAX_FILAS
    seleccion = ordenes[:tope]
    filas = [[columna.valor(orden) for columna in columnas] for orden in seleccion]
    totales = {}
    for posicion, columna in enumerate(columnas):
        if columna.clave in reporte_.totalizar:
            totales[posicion] = sum((fila[posicion] for fila in filas), Decimal("0"))
    return {
        "columnas": columnas,
        "filas": filas,
        "total": len(ordenes),
        "truncado": len(ordenes) > tope,
        "totales": totales,
    }
