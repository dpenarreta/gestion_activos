import io
from urllib.parse import quote

from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.hojas_de_calculo import neutralizar_fila
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import Requiere

from . import services

MODULO = "auditoria"
#: Tope de filas en el Excel, como la exportación de la auditoría.
FILAS_EXPORTAR = 5000


def _filtros(request) -> dict:
    p = request.query_params
    return {
        "q": p.get("q", ""),
        "desde": p.get("desde", ""),
        "hasta": p.get("hasta", ""),
        "modulo": p.get("modulo", ""),
        "usuario": p.get("usuario") or None,
    }


class _Registro(serializers.Serializer):
    nombre = serializers.CharField(max_length=255)
    archivo = serializers.FileField(required=False, allow_empty_file=True)
    tamano = serializers.IntegerField(required=False, min_value=0, default=0)
    tipo = serializers.CharField(required=False, allow_blank=True, max_length=120, default="")
    pantalla = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")


class DescargasView(APIView):
    """POST: toda persona avisa que guardó un archivo (y lo manda). GET: el
    reporte (`auditoria.descargas`)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_scope = "descargas"

    def get_throttles(self):
        return [ScopedRateThrottle()] if self.request.method == "POST" else super().get_throttles()

    def get(self, request):
        descargas = services.consulta(request.user, **_filtros(request))
        paginador = DefaultPagination()
        pagina = paginador.paginate_queryset(descargas, request, view=self)
        return paginador.get_paginated_response([services.fila(d) for d in pagina])

    def post(self, request):
        entrada = _Registro(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        contexto = get_request_context(request)
        descarga = services.registrar(
            request.user,
            nombre=datos["nombre"],
            archivo=datos.get("archivo"),
            tamano=datos["tamano"],
            content_type=datos["tipo"],
            pantalla=datos["pantalla"],
            ip=contexto.get("ip_address") or None,
            navegador=request.META.get("HTTP_USER_AGENT", ""),
        )
        return Response({"id": descarga.id}, status=status.HTTP_201_CREATED)


class ModulosView(APIView):
    permission_classes = [IsAuthenticated, Requiere(services.PERMISO)]

    def get(self, request):
        return Response(services.modulos(request.user))


class CopiaView(APIView):
    """La copia exacta del archivo que se descargó."""

    permission_classes = [IsAuthenticated, Requiere(services.PERMISO)]

    def get(self, request, pk):
        descarga = services.copia_de(request.user, pk)
        record_audit_event(
            actor=request.user,
            action="descargas.copia_abierta",
            target=descarga,
            module=MODULO,
            new_values={"descarga": descarga.id, "archivo": descarga.nombre},
            context=get_request_context(request),
        )
        respuesta = FileResponse(
            descarga.copia.archivo.open("rb"),
            content_type=descarga.content_type or "application/octet-stream",
        )
        respuesta["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(descarga.nombre)}"
        respuesta["Cache-Control"] = "no-store, private"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class ExportarView(APIView):
    """El reporte con los mismos filtros, en Excel."""

    permission_classes = [IsAuthenticated, Requiere(services.PERMISO)]

    def get(self, request):
        from openpyxl import Workbook

        libro = Workbook()
        hoja = libro.active
        hoja.title = "Descargas"
        hoja.append(
            [
                "Fecha",
                "Hora",
                "Persona",
                "Correo",
                "Archivo",
                "Tamaño (bytes)",
                "Módulo",
                "Pantalla",
                "IP",
                "Comprobada con el servidor",
                "Copia",
                "Huella SHA-256",
            ]
        )
        for d in services.consulta(request.user, **_filtros(request))[:FILAS_EXPORTAR]:
            f = services.fila(d)
            hoja.append(
                neutralizar_fila(
                    [
                        f["momento"]["fecha"],
                        f["momento"]["hora"],
                        f["usuario"]["nombre"],
                        f["usuario"]["correo"],
                        f["nombre"],
                        f["tamano"],
                        f["modulo"],
                        f["pantalla"],
                        f["ip"] or "",
                        "Sí" if f["verificada"] else "No",
                        "Guardada" if f["tiene_copia"] else f["sin_copia"],
                        f["sha256"],
                    ]
                )
            )
        memoria = io.BytesIO()
        libro.save(memoria)
        nombre = f"descargas-{timezone.localdate():%Y-%m-%d}.xlsx"
        respuesta = HttpResponse(
            memoria.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        respuesta["Content-Disposition"] = f'attachment; filename="{nombre}"'
        return respuesta
