"""Carga, listado y descarga de adjuntos (§18)."""

from urllib.parse import quote

from django.core.files.base import ContentFile
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activos.models import Activo, MovimientoActivo
from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.mantenimientos.models import Mantenimiento

from .actas import ActaNoAplicable, generar_acta, nombre_de_archivo
from .models import Adjunto
from .permissions import AdjuntosPermission
from .validators import validar_archivo

MODULO = "adjuntos"


class AdjuntoSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    subido_por_nombre = serializers.CharField(
        source="subido_por.username", read_only=True, default=None
    )
    codigo_barras = serializers.CharField(source="activo.codigo_barras", read_only=True)

    class Meta:
        model = Adjunto
        fields = [
            "id",
            "activo",
            "codigo_barras",
            "mantenimiento",
            "tipo",
            "tipo_display",
            "nombre_original",
            "tamano_bytes",
            "descripcion",
            "generado_por_el_sistema",
            "subido_por_nombre",
            "created_at",
        ]
        read_only_fields = fields


class AdjuntoCreateSerializer(serializers.Serializer):
    activo = serializers.PrimaryKeyRelatedField(queryset=Activo.objects.all())
    mantenimiento = serializers.PrimaryKeyRelatedField(
        queryset=Mantenimiento.objects.all(), required=False, allow_null=True
    )
    tipo = serializers.ChoiceField(choices=Adjunto.Tipo.choices)
    archivo = serializers.FileField()
    descripcion = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate_archivo(self, value):
        validar_archivo(value)
        return value

    def validate(self, attrs):
        """Una intervención de otro equipo no puede colgarse de este activo:
        el adjunto quedaría visible en una ficha y perteneciendo a otra."""
        mantenimiento = attrs.get("mantenimiento")
        if mantenimiento and mantenimiento.activo_id != attrs["activo"].id:
            raise serializers.ValidationError(
                {"mantenimiento": "La intervención pertenece a otro activo."}
            )
        return attrs


class AdjuntoViewSet(viewsets.ModelViewSet):
    """Documentos y evidencias de los activos.

    La descarga pasa por aquí y no por el servidor de estáticos: así exige
    autenticación y permiso, y queda registrada. Los archivos guardados son
    facturas, actas firmadas y fotos de equipos de la empresa.
    """

    permission_classes = [IsAuthenticated, AdjuntosPermission]
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        queryset = Adjunto.objects.select_related("activo", "subido_por").order_by("-created_at")
        params = self.request.query_params

        for parametro, campo in (("activo", "activo_id"), ("mantenimiento", "mantenimiento_id")):
            valor = params.get(parametro)
            if valor and valor.isdigit():
                queryset = queryset.filter(**{campo: int(valor)})

        tipo = params.get("tipo")
        if tipo:
            queryset = queryset.filter(tipo=tipo)

        return queryset

    def get_serializer_class(self):
        return AdjuntoCreateSerializer if self.action == "create" else AdjuntoSerializer

    def create(self, request, *args, **kwargs):
        serializer = AdjuntoCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        archivo = serializer.validated_data["archivo"]

        adjunto = Adjunto.objects.create(
            activo=serializer.validated_data["activo"],
            mantenimiento=serializer.validated_data.get("mantenimiento"),
            tipo=serializer.validated_data["tipo"],
            archivo=archivo,
            # El nombre del cliente se guarda como dato, nunca como ruta: el
            # archivo se almacena con un nombre generado (ver `ruta_adjunto`).
            nombre_original=archivo.name[:255],
            tamano_bytes=archivo.size,
            content_type=(archivo.content_type or "")[:100],
            descripcion=serializer.validated_data.get("descripcion", ""),
            subido_por=request.user,
        )

        self._auditar(request, adjunto, "adjunto.created")
        return Response(AdjuntoSerializer(adjunto).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        # Se audita antes de borrar: después, el registro ya no existe para
        # sacar de él quién lo había subido ni de qué activo era.
        self._auditar(self.request, instance, "adjunto.deleted")
        instance.borrar_archivo()
        instance.delete()

    @action(detail=True, methods=["get"], url_path="descargar")
    def descargar(self, request, pk=None):
        adjunto = self.get_object()
        try:
            fichero = adjunto.archivo.open("rb")
        except FileNotFoundError as error:
            # El registro existe pero el fichero no: se dice tal cual, en vez
            # de un 500 que haría pensar en una caída del sistema.
            raise Http404("El archivo ya no está disponible en el servidor.") from error

        self._auditar(request, adjunto, "adjunto.descargado")

        respuesta = FileResponse(
            fichero,
            as_attachment=True,
            filename=adjunto.nombre_original,
            content_type=adjunto.content_type or "application/octet-stream",
        )
        # Se fuerza la descarga y se prohíbe adivinar el tipo: un archivo
        # subido por un usuario no debe poder ejecutarse en el navegador de
        # otro. `filename*` mantiene legibles los acentos del nombre.
        respuesta["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(adjunto.nombre_original)}"
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta

    def _auditar(self, request, adjunto, accion):
        record_audit_event(
            actor=request.user,
            action=accion,
            target=adjunto,
            module=MODULO,
            new_values={
                "activo": adjunto.activo.codigo_barras,
                "tipo": adjunto.tipo,
                "nombre": adjunto.nombre_original,
                "tamano_bytes": adjunto.tamano_bytes,
            },
            context=get_request_context(request),
        )

    # --- Actas de entrega y devolución (§6, §18) ---------------------------

    @action(detail=False, methods=["get", "post"], url_path="acta")
    def acta(self, request):
        """Acta de entrega o devolución de un movimiento.

        `GET` la genera y la devuelve sin guardar nada —sirve para revisarla
        antes de imprimirla—; `POST` la archiva como adjunto del activo, que
        es lo que hace falta cuando ya está firmada y escaneada... o cuando
        se quiere dejar constancia de la versión que se imprimió.
        """
        movimiento_id = request.query_params.get("movimiento") or request.data.get("movimiento")
        if not movimiento_id:
            return Response(
                {"movimiento": "Indique el movimiento del que se genera el acta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        movimiento = get_object_or_404(
            MovimientoActivo.objects.select_related(
                "activo__tipo",
                "activo__departamento",
                "custodio_nuevo",
                "custodio_anterior",
                "departamento_nuevo",
                "departamento_anterior",
                "registrado_por",
            ),
            pk=movimiento_id,
        )

        try:
            contenido = generar_acta(movimiento, nombre_empresa=_nombre_empresa())
        except ActaNoAplicable as error:
            return Response({"movimiento": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        nombre = nombre_de_archivo(movimiento)

        if request.method == "GET":
            respuesta = HttpResponse(contenido, content_type="application/pdf")
            respuesta["Content-Disposition"] = f'attachment; filename="{nombre}"'
            respuesta["X-Content-Type-Options"] = "nosniff"
            return respuesta

        tipo = (
            Adjunto.Tipo.ACTA_ENTREGA
            if movimiento.tipo == MovimientoActivo.Tipo.ASIGNACION
            else Adjunto.Tipo.ACTA_DEVOLUCION
        )
        # Un acta ya archivada no se duplica: el documento del movimiento es
        # uno solo, y dos copias en la ficha harían dudar de cuál se firmó.
        existente = Adjunto.objects.filter(
            activo=movimiento.activo, tipo=tipo, descripcion=f"Movimiento {movimiento.id}"
        ).first()
        if existente is not None:
            return Response(AdjuntoSerializer(existente).data, status=status.HTTP_200_OK)

        adjunto = Adjunto(
            activo=movimiento.activo,
            tipo=tipo,
            nombre_original=nombre,
            tamano_bytes=len(contenido),
            content_type="application/pdf",
            descripcion=f"Movimiento {movimiento.id}",
            generado_por_el_sistema=True,
            subido_por=request.user,
        )
        adjunto.archivo.save(nombre, ContentFile(contenido), save=False)
        adjunto.save()

        self._auditar(request, adjunto, "adjunto.acta_generada")
        return Response(AdjuntoSerializer(adjunto).data, status=status.HTTP_201_CREATED)


def _nombre_empresa() -> str:
    """Nombre institucional configurado, si lo hay.

    Se lee del tema y no de un ajuste propio para que el acta lleve el mismo
    nombre que el resto del sistema; si no está configurado, el documento sale
    sin encabezado en vez de con un texto inventado.
    """
    from apps.branding.models import SiteTheme

    tema = SiteTheme.objects.first()
    return tema.site_name if tema else ""
