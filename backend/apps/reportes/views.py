"""Catálogo de reportes (§16), su vista previa y su descarga.

Un solo par de endpoints para los trece: el catálogo dice qué reportes hay y
qué parámetros admite cada uno, y la ejecución los resuelve por clave. El
frontend no conoce ningún reporte en particular — se dibuja a partir del
catálogo, así que un reporte nuevo aparece en la pantalla sin tocar el
frontend.
"""

from django.http import HttpResponse
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context

from . import render_csv, render_excel, render_pdf
from .catalogo import CATALOGO, MAX_FILAS, MAX_FILAS_PDF, obtener
from .consultas import generar_filas
from .permissions import ReportesPermission

MODULO = "reportes"

#: Filas de la vista previa. Suficientes para reconocer que el reporte es el
#: que se buscaba antes de descargarlo, pocas para que la pantalla abra rápido.
FILAS_VISTA_PREVIA = 50

FORMATOS = {
    "xlsx": (
        render_excel.exportar,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
    ),
    "csv": (render_csv.exportar, "text/csv; charset=utf-8", "csv"),
    "pdf": (render_pdf.exportar, "application/pdf", "pdf"),
}

#: Cómo se nombra cada filtro en la línea de contexto del archivo. Lo que no
#: esté aquí no se describe: un archivo que dice «filtros: tipo=3» no informa
#: más que uno que no dice nada.
ETIQUETAS_PARAMETROS = {
    "desde": "desde",
    "hasta": "hasta",
    "dias": "días de anticipación",
    "antiguedad_min_meses": "antigüedad mínima (meses)",
    "antiguedad_max_meses": "antigüedad máxima (meses)",
    "criticidad": "criticidad",
    "uso": "uso",
}


def _describir_filtros(reporte, parametros: dict) -> str:
    """Frase legible con lo que el usuario filtró, para la cabecera del archivo."""
    partes = []
    for clave in reporte.parametros:
        valor = parametros.get(clave)
        if not valor:
            continue
        etiqueta = ETIQUETAS_PARAMETROS.get(clave)
        if etiqueta:
            partes.append(f"{etiqueta}: {valor}")
    return "; ".join(partes)


def _serializar(reporte) -> dict:
    return {
        "clave": reporte.clave,
        "nombre": reporte.nombre,
        "descripcion": reporte.descripcion,
        "fuente": reporte.fuente,
        "parametros": list(reporte.parametros),
        "columnas": [
            {"clave": columna.clave, "etiqueta": columna.etiqueta} for columna in reporte.columnas
        ],
    }


class CatalogoReportesView(APIView):
    """Los trece reportes disponibles, con sus parámetros."""

    permission_classes = [IsAuthenticated, ReportesPermission]

    def get(self, request):
        return Response(
            {
                "reportes": [_serializar(reporte) for reporte in CATALOGO],
                "formatos": list(FORMATOS),
                "max_filas": MAX_FILAS,
                "max_filas_pdf": MAX_FILAS_PDF,
            }
        )


class EjecutarReporteView(APIView):
    """Vista previa (JSON) o descarga (xlsx, csv, pdf) de un reporte."""

    permission_classes = [IsAuthenticated, ReportesPermission]

    def get(self, request, clave: str):
        reporte = obtener(clave)
        if reporte is None:
            return Response({"detail": f"No existe el reporte {clave!r}."}, status=404)

        parametros = request.query_params.dict()
        formato = parametros.pop("formato", "json")
        if formato not in FORMATOS and formato != "json":
            return Response({"detail": f"Formato no soportado: {formato!r}."}, status=400)

        if formato == "json":
            return self._vista_previa(reporte, parametros)
        return self._descargar(request, reporte, parametros, formato)

    def _vista_previa(self, reporte, parametros: dict):
        resultado = generar_filas(reporte, parametros, formato="json")
        filas = resultado["filas"][:FILAS_VISTA_PREVIA]
        return Response(
            {
                "reporte": _serializar(reporte),
                "columnas": [
                    {"clave": columna.clave, "etiqueta": columna.etiqueta}
                    for columna in resultado["columnas"]
                ],
                "filas": [
                    ["" if valor is None else str(valor) for valor in fila] for fila in filas
                ],
                "total": resultado["total"],
                "mostradas": len(filas),
                "filtros": _describir_filtros(reporte, parametros),
            }
        )

    def _descargar(self, request, reporte, parametros: dict, formato: str):
        exportar, content_type, extension = FORMATOS[formato]
        resultado = generar_filas(reporte, parametros, formato=formato)
        descripcion = _describir_filtros(reporte, parametros)
        contenido = exportar(reporte, resultado, descripcion)

        # Auditado como cualquier otra salida de datos del sistema: un reporte
        # es información del parque que sale en un archivo, igual que la
        # exportación del inventario.
        record_audit_event(
            actor=request.user,
            action="reporte.exportado",
            target_type="reporte",
            target_id=reporte.clave,
            module=MODULO,
            new_values={
                "formato": formato,
                "filas": resultado["total"],
                "truncado": resultado["truncado"],
                "filtros": {k: v for k, v in parametros.items() if v},
            },
            context=get_request_context(request),
        )

        respuesta = HttpResponse(contenido, content_type=content_type)
        fecha = timezone.localdate()
        respuesta["Content-Disposition"] = (
            f'attachment; filename="{reporte.clave}-{fecha.isoformat()}.{extension}"'
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta
