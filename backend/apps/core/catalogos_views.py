"""Descarga y carga masiva de los catálogos, uno por archivo.

Tres endpoints y ningún viewset: no hay un recurso REST detrás —cada catálogo
ya tiene el suyo—, sino dos operaciones sobre un archivo.
"""

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import user_has_permission

from .catalogos_masivos import CATALOGOS, POR_CLAVE
from .importacion_catalogos import MAX_BYTES, importar, validar_archivo
from .plantillas_catalogos import construir_plantilla

TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _error(code: str, message: str, http=status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"error": {"code": code, "message": message}}, status=http)


def _catalogo_o_error(clave: str, request):
    """Resuelve el catálogo y comprueba el permiso que le corresponde.

    Cada catálogo trae el suyo: cargar tipos de dispositivo es editar el
    inventario, cargar empleados es editar la organización. Un permiso único
    para «carga masiva» daría acceso a los dos a quien solo necesita uno.
    """
    catalogo = POR_CLAVE.get(clave)
    if catalogo is None:
        return None, _error(
            "catalogo_desconocido",
            f"No hay una carga masiva de {clave!r}.",
            status.HTTP_404_NOT_FOUND,
        )
    if not user_has_permission(request.user, catalogo.permiso):
        return None, _error(
            "sin_permiso",
            f"No tiene el permiso requerido: {catalogo.permiso}.",
            status.HTTP_403_FORBIDDEN,
        )
    return catalogo, None


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def listar_catalogos(request):
    """Qué se puede cargar masivamente y con qué permiso.

    La pantalla se dibuja desde aquí: un catálogo nuevo aparece sin tocar el
    frontend, igual que un reporte nuevo.
    """
    return Response(
        {
            "catalogos": [
                {
                    "clave": catalogo.clave,
                    "nombre": catalogo.nombre,
                    "plural": catalogo.plural,
                    "permiso": catalogo.permiso,
                    "puede": user_has_permission(request.user, catalogo.permiso),
                    "nota": catalogo.nota,
                    "columnas": [
                        {"etiqueta": columna.etiqueta, "obligatoria": columna.obligatoria}
                        for columna in catalogo.columnas
                    ],
                }
                for catalogo in CATALOGOS
            ]
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def plantilla(request, clave):
    catalogo, error = _catalogo_o_error(clave, request)
    if error:
        return error

    contenido = construir_plantilla(catalogo)
    respuesta = HttpResponse(contenido, content_type=TIPO_XLSX)
    respuesta["Content-Disposition"] = f'attachment; filename="plantilla-{catalogo.clave}.xlsx"'
    return respuesta


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def importar_catalogo(request, clave):
    """Valida el archivo y, solo si se confirma, crea los registros.

    Dos pasos a propósito, como en la carga de activos: importar directamente
    dejaría al usuario descubriendo los errores cuando ya hay registros
    creados, y sin saber cuáles.
    """
    catalogo, error = _catalogo_o_error(clave, request)
    if error:
        return error

    archivo = request.FILES.get("archivo")
    if archivo is None:
        return _error("archivo_requerido", "Adjunte el archivo .xlsx a cargar.")
    if not archivo.name.lower().endswith(".xlsx"):
        return _error("formato_invalido", "El archivo debe ser .xlsx.")
    if archivo.size > MAX_BYTES:
        return _error("archivo_muy_grande", "El archivo supera los 5 MB.")

    try:
        resultado = validar_archivo(archivo, catalogo)
    except Exception:
        return _error(
            "archivo_ilegible",
            "No se pudo leer el archivo. Descargue la plantilla y vuelva a intentarlo.",
        )

    reporte = resultado.as_dict(catalogo)
    if request.data.get("confirmar") not in {"true", "True", True}:
        return Response(reporte)

    if not resultado.es_importable:
        return _error("importacion_con_errores", "Corrija los errores antes de importar.")

    creados = importar(
        resultado.filas_validas,
        catalogo,
        actor=request.user,
        context=get_request_context(request),
    )
    record_audit_event(
        actor=request.user,
        action="catalogo.importacion_confirmada",
        target_type=catalogo.clave,
        target_id=str(creados),
        module="core",
        new_values={"catalogo": catalogo.clave, "creados": creados},
        context=get_request_context(request),
    )
    return Response({**reporte, "creados": creados}, status=status.HTTP_201_CREATED)
