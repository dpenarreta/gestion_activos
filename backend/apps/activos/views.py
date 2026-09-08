from django.db.models import Count, Q
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.mantenimientos.serializers import MantenimientoSerializer
from apps.mantenimientos.services import resumen_costos

from . import etiquetas as etiquetas_mod
from . import etiquetas_pdf
from .models import Activo, TipoDispositivo
from .permissions import ActivosPermission, EtiquetasPermission, TiposDispositivoPermission
from .serializers import (
    ActivoDetailSerializer,
    ActivoListSerializer,
    ActivoWriteSerializer,
    AsignacionSerializer,
    CambioEstadoSerializer,
    MovimientoActivoSerializer,
    TipoDispositivoSerializer,
)
from .services import ActivoService

MODULO = "activos"
MAX_ETIQUETAS_POR_LOTE = 200

# PDF es el formato por defecto: lo abre cualquiera y permite revisar la
# etiqueta antes de imprimirla. ZPL y TSPL siguen disponibles para enviar el
# trabajo directamente a una impresora térmica (RF-08).
FORMATO_POR_DEFECTO = "pdf"
FORMATOS_SOPORTADOS = {"pdf", *etiquetas_mod.CONSTRUCTORES}


class TipoDispositivoViewSet(viewsets.ModelViewSet):
    """Catálogo de tipos de equipo. Sin `DELETE`: los activos lo referencian
    con `PROTECT` y la política de renovación cuelga de él."""

    permission_classes = [IsAuthenticated, TiposDispositivoPermission]
    serializer_class = TipoDispositivoSerializer
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        queryset = (
            TipoDispositivo.objects.annotate(total_activos=Count("activos"))
            .select_related("politica")
            .order_by("nombre")
        )
        busqueda = self.request.query_params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombre__icontains=busqueda) | Q(codigo__icontains=busqueda)
            )
        return queryset


class ActivoViewSet(viewsets.ModelViewSet):
    """Inventario de activos (RF-01).

    Sin `DELETE`: un activo se da de baja (`/cambiar-estado/`), nunca se borra.
    Su expediente es el respaldo de a quién se le entregó qué y cuánto costó
    sostenerlo; eliminarlo destruiría la evidencia que RF-07 usa para
    justificar una compra ante el área financiera.
    """

    permission_classes = [IsAuthenticated, ActivosPermission]
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        queryset = Activo.objects.select_related("tipo", "custodio", "departamento").order_by(
            "-created_at"
        )
        params = self.request.query_params

        busqueda = params.get("q")
        if busqueda:
            termino = busqueda.strip()
            queryset = queryset.filter(
                Q(codigo_barras__iexact=termino)
                | Q(numero_serie__icontains=termino)
                | Q(nombre__icontains=termino)
                | Q(marca__icontains=termino)
                | Q(modelo__icontains=termino)
                | Q(custodio__nombres__icontains=termino)
                | Q(custodio__apellidos__icontains=termino)
            )

        for parametro, campo in (
            ("tipo", "tipo_id"),
            ("departamento", "departamento_id"),
            ("custodio", "custodio_id"),
        ):
            valor = params.get(parametro)
            if valor and valor.isdigit():
                queryset = queryset.filter(**{campo: int(valor)})

        estado = params.get("estado")
        if estado:
            queryset = queryset.filter(estado=estado)

        renovacion = params.get("requiere_renovacion")
        if renovacion in {"true", "false"}:
            queryset = queryset.filter(requiere_renovacion=renovacion == "true")

        return queryset

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return ActivoWriteSerializer
        if self.action == "list":
            return ActivoListSerializer
        return ActivoDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activo = ActivoService.crear_activo(
            actor=request.user,
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(ActivoDetailSerializer(activo).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instancia = self.get_object()
        serializer = self.get_serializer(
            instancia, data=request.data, partial=kwargs.pop("partial", False)
        )
        serializer.is_valid(raise_exception=True)
        activo = ActivoService.actualizar_activo(
            actor=request.user,
            activo=instancia,
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(ActivoDetailSerializer(activo).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="por-codigo/(?P<codigo>[^/.]+)")
    def por_codigo(self, request, codigo=None):
        """Resuelve un activo desde lo que emitió el lector (RF-03).

        Acepta tanto el código de barras como el número de serie porque la
        pistola entrega texto plano y el técnico no siempre sabe cuál de los
        dos está escaneando —hay equipos con la etiqueta del fabricante al lado
        de la nuestra—. Devuelve la ficha con el historial completo para evitar
        el viaje adicional que haría el frontend tras cada escaneo.
        """
        termino = (codigo or "").strip()
        activo = (
            Activo.objects.select_related("tipo", "custodio", "departamento")
            .filter(Q(codigo_barras__iexact=termino) | Q(numero_serie__iexact=termino))
            .first()
        )
        if activo is None:
            return Response(
                {
                    "error": {
                        "code": "activo_no_encontrado",
                        "message": f"Ningún activo corresponde a {termino!r}.",
                    }
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(self._ficha_completa(activo))

    @action(detail=True, methods=["get"])
    def historial(self, request, pk=None):
        """Movimientos y mantenimientos de un activo, en un solo recurso."""
        return Response(self._ficha_completa(self.get_object()))

    def _ficha_completa(self, activo) -> dict:
        movimientos = activo.movimientos.select_related(
            "custodio_anterior", "custodio_nuevo", "departamento_anterior", "departamento_nuevo"
        )
        mantenimientos = activo.mantenimientos.select_related("registrado_por").prefetch_related(
            "componentes__componente"
        )
        return {
            "activo": ActivoDetailSerializer(activo).data,
            "movimientos": MovimientoActivoSerializer(movimientos, many=True).data,
            "mantenimientos": MantenimientoSerializer(mantenimientos, many=True).data,
            "costos": resumen_costos(activo),
        }

    @action(detail=True, methods=["post"])
    def asignar(self, request, pk=None):
        """Asigna, traslada o devuelve un activo (RF-01)."""
        serializer = AsignacionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activo = ActivoService.asignar_custodio(
            actor=request.user,
            activo=self.get_object(),
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(ActivoDetailSerializer(activo).data)

    @action(detail=True, methods=["post"], url_path="cambiar-estado")
    def cambiar_estado(self, request, pk=None):
        serializer = CambioEstadoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activo = ActivoService.cambiar_estado(
            actor=request.user,
            activo=self.get_object(),
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(ActivoDetailSerializer(activo).data)

    @action(
        detail=True,
        methods=["get"],
        url_path="etiqueta",
        permission_classes=[IsAuthenticated, EtiquetasPermission],
    )
    def etiqueta(self, request, pk=None):
        """Etiqueta de un activo (RF-08).

        `?formato=pdf` (por defecto en la descarga) devuelve el documento
        imprimible; `?formato=zpl|tspl` devuelve el trabajo de impresión
        térmica directa. `?descargar=true` fuerza la descarga como adjunto.
        """
        return self._responder_etiquetas(request, [self.get_object()])

    @action(
        detail=False,
        methods=["post"],
        url_path="etiquetas",
        permission_classes=[IsAuthenticated, EtiquetasPermission],
    )
    def etiquetas_lote(self, request):
        """Un solo trabajo con las etiquetas de varios activos."""
        ids = request.data.get("ids") or []
        if not isinstance(ids, list) or not ids:
            return Response(
                {"error": {"code": "invalid", "message": "Envíe una lista 'ids' de activos."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(ids) > MAX_ETIQUETAS_POR_LOTE:
            return Response(
                {
                    "error": {
                        "code": "lote_excedido",
                        "message": (
                            f"Máximo {MAX_ETIQUETAS_POR_LOTE} etiquetas por lote; "
                            f"se solicitaron {len(ids)}."
                        ),
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        activos = list(
            Activo.objects.select_related("departamento")
            .filter(id__in=ids)
            .order_by("codigo_barras")
        )
        if not activos:
            return Response(
                {"error": {"code": "activo_no_encontrado", "message": "Ningún activo coincide."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return self._responder_etiquetas(request, activos)

    def _responder_etiquetas(self, request, activos):
        formato = (request.query_params.get("formato") or FORMATO_POR_DEFECTO).lower()
        if formato not in FORMATOS_SOPORTADOS:
            return Response(
                {
                    "error": {
                        "code": "formato_invalido",
                        "message": (
                            f"Formato de etiqueta no soportado: {formato!r}. "
                            f"Opciones: {', '.join(sorted(FORMATOS_SOPORTADOS))}."
                        ),
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        self._auditar_etiquetas(request, activos, formato)

        if formato == "pdf":
            # El PDF es binario: no cabe en el JSON de vista previa, así que
            # siempre se devuelve como documento. `descargar=false` lo entrega
            # "inline" para poder revisarlo en el visor del navegador antes de
            # gastar consumibles.
            documento = etiquetas_pdf.construir_pdf(activos)
            disposicion = (
                "inline" if request.query_params.get("descargar") == "false" else "attachment"
            )
            respuesta = HttpResponse(documento, content_type="application/pdf")
            respuesta["Content-Disposition"] = (
                f'{disposicion}; filename="{self._nombre_archivo(activos, "pdf")}"'
            )
            return respuesta

        contenido = etiquetas_mod.construir_lote(formato, activos)

        if request.query_params.get("descargar") == "true":
            extension = etiquetas_mod.EXTENSIONES[formato]
            respuesta = HttpResponse(contenido, content_type="text/plain; charset=utf-8")
            respuesta["Content-Disposition"] = (
                f'attachment; filename="{self._nombre_archivo(activos, extension)}"'
            )
            return respuesta

        return Response(
            {
                "formato": formato,
                "cantidad": len(activos),
                "contenido": contenido,
                "activos": [
                    {
                        "id": a.id,
                        "codigo_barras": a.codigo_barras,
                        "nombre": a.nombre,
                        "area": a.departamento.nombre,
                    }
                    for a in activos
                ],
            }
        )

    @staticmethod
    def _nombre_archivo(activos, extension: str) -> str:
        return (
            f"etiqueta-{activos[0].codigo_barras}.{extension}"
            if len(activos) == 1
            else f"etiquetas-{len(activos)}.{extension}"
        )

    def _auditar_etiquetas(self, request, activos, formato: str) -> None:
        record_audit_event(
            actor=request.user,
            action="activo.etiqueta_generada",
            target_type="activo",
            target_id=",".join(str(a.id) for a in activos[:20]),
            module=MODULO,
            new_values={"formato": formato, "cantidad": len(activos)},
            context=get_request_context(request),
        )
