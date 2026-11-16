"""API del acta de entrega AEE-LC-01 (16/11/2026).

- `GET  /api/v1/activos/actas-entrega/preparar/?movimiento=<id>`: lo que el
  formulario necesita para una asignación: los equipos entregados a esa
  persona ese día (para elegir cuáles van) y, si ya hay acta, cuál es.
- `POST /api/v1/activos/actas-entrega/`: crea el acta con los movimientos
  elegidos, la prueba de funcionalidad y las observaciones.
- `GET/PATCH /api/v1/activos/actas-entrega/<id>/`: verla o corregirla.
- `GET  /api/v1/activos/actas-entrega/<id>/documento/?formato=docx|pdf`.

Todo pide `activos.acta_entrega`.
"""

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import HasActionPermission

from . import actas_entrega
from .models import ActaEntrega, Activo, MovimientoActivo

MODULO = "activos"
CLAVES_PRUEBA = {clave for clave, _ in ActaEntrega.PRUEBAS}
VALORES_PRUEBA = set(ActaEntrega.Prueba.values)
TIPOS_DE_DOCUMENTO = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


class ActaEntregaPermission(HasActionPermission):
    def get_required_permission(self, request, view) -> str:
        return "activos.acta_entrega"


def _fecha_de(movimiento) -> "timezone.datetime.date":
    return timezone.localtime(movimiento.created_at).date()


def _movimientos_visibles():
    """Los movimientos de los activos de la empresa activa: `Activo` filtra
    por empresa y `MovimientoActivo` no (cuelga del activo)."""
    return MovimientoActivo.objects.filter(activo__in=Activo.objects.all())


def _movimientos_del_dia(movimiento):
    """Las asignaciones a la misma persona el mismo día (la de partida
    incluida), de la más vieja a la más nueva."""
    fecha = _fecha_de(movimiento)
    candidatos = (
        _movimientos_visibles()
        .filter(
            tipo=MovimientoActivo.Tipo.ASIGNACION,
            custodio_nuevo_id=movimiento.custodio_nuevo_id,
            activo__empresa_id=movimiento.activo.empresa_id,
        )
        .select_related("activo__tipo")
        .order_by("created_at", "id")
    )
    return [m for m in candidatos if _fecha_de(m) == fecha]


class MovimientoEnActaSerializer(serializers.ModelSerializer):
    activo = serializers.SerializerMethodField()
    acta_id = serializers.SerializerMethodField()

    class Meta:
        model = MovimientoActivo
        fields = ["id", "created_at", "activo", "acta_id"]

    def get_activo(self, obj):
        activo = obj.activo
        return {
            "id": activo.id,
            "codigo_barras": activo.codigo_barras,
            "nombre": activo.nombre,
            "tipo": activo.tipo.nombre,
            "marca": activo.marca,
            "modelo": activo.modelo,
            "numero_serie": activo.numero_serie,
        }

    def get_acta_id(self, obj):
        acta = obj.actas_entrega.first()
        return acta.id if acta else None


class ActaEntregaSerializer(serializers.ModelSerializer):
    custodio = serializers.SerializerMethodField()
    tecnico = serializers.SerializerMethodField()
    movimientos = MovimientoEnActaSerializer(many=True, read_only=True)

    class Meta:
        model = ActaEntrega
        fields = [
            "id",
            "fecha",
            "custodio",
            "tecnico",
            "movimientos",
            "pruebas",
            "nuevo_de_paquete",
            "observaciones",
            "created_at",
            "updated_at",
        ]

    def get_custodio(self, obj):
        return {
            "id": obj.custodio_id,
            "nombre": obj.custodio.nombre_completo,
            "cargo": obj.custodio.cargo,
        }

    def get_tecnico(self, obj):
        if obj.tecnico is None:
            return None
        return {"id": obj.tecnico_id, "nombre": obj.tecnico.get_full_name() or obj.tecnico.username}


class GuardarActaSerializer(serializers.Serializer):
    movimientos = serializers.ListField(
        child=serializers.IntegerField(min_value=1), allow_empty=False, max_length=50
    )
    pruebas = serializers.DictField(child=serializers.CharField(), required=False, default=dict)
    nuevo_de_paquete = serializers.BooleanField(required=False, allow_null=True, default=None)
    observaciones = serializers.CharField(
        required=False, allow_blank=True, max_length=1000, default=""
    )

    def validate_pruebas(self, valor):
        desconocidas = set(valor) - CLAVES_PRUEBA
        if desconocidas:
            raise serializers.ValidationError(
                f"Pruebas desconocidas: {', '.join(sorted(desconocidas))}."
            )
        invalidas = [clave for clave, v in valor.items() if v not in VALORES_PRUEBA]
        if invalidas:
            raise serializers.ValidationError("Cada prueba es «ok», «falla» o «na».")
        return {clave: v for clave, v in valor.items() if v != ActaEntrega.Prueba.NO_APLICA}


class ActaEntregaViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated, ActaEntregaPermission]
    serializer_class = ActaEntregaSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return ActaEntrega.objects.select_related(
            "custodio__departamento", "tecnico"
        ).prefetch_related("movimientos__activo__tipo", "movimientos__actas_entrega")

    # --- Preparar -----------------------------------------------------------

    @action(detail=False, methods=["get"])
    def preparar(self, request):
        movimiento = get_object_or_404(
            _movimientos_visibles().select_related("activo", "custodio_nuevo"),
            pk=request.query_params.get("movimiento") or 0,
        )
        if movimiento.tipo != MovimientoActivo.Tipo.ASIGNACION or not movimiento.custodio_nuevo_id:
            return Response(
                {"movimiento": "Solo una asignación a una persona tiene acta de entrega."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        del_dia = _movimientos_del_dia(movimiento)
        acta = movimiento.actas_entrega.first()
        return Response(
            {
                "movimiento": movimiento.id,
                "fecha": _fecha_de(movimiento),
                "custodio": {
                    "id": movimiento.custodio_nuevo_id,
                    "nombre": movimiento.custodio_nuevo.nombre_completo,
                },
                "candidatos": MovimientoEnActaSerializer(del_dia, many=True).data,
                "acta": ActaEntregaSerializer(acta).data if acta else None,
                "pruebas": [{"clave": c, "etiqueta": e} for c, e in ActaEntrega.PRUEBAS],
            }
        )

    # --- Crear y corregir ---------------------------------------------------

    def _validar_movimientos(self, ids, acta=None):
        movimientos = list(
            _movimientos_visibles()
            .select_related("activo", "custodio_nuevo", "registrado_por")
            .filter(pk__in=ids, tipo=MovimientoActivo.Tipo.ASIGNACION)
            .order_by("created_at", "id")
        )
        if len(movimientos) != len(set(ids)):
            raise serializers.ValidationError(
                {"movimientos": "Solo van en el acta asignaciones que existen."}
            )
        custodios = {m.custodio_nuevo_id for m in movimientos}
        fechas = {_fecha_de(m) for m in movimientos}
        if len(custodios) != 1 or None in custodios:
            raise serializers.ValidationError(
                {"movimientos": "Un acta es de una sola persona: todos los equipos, para ella."}
            )
        if len(fechas) != 1:
            raise serializers.ValidationError(
                {"movimientos": "Un acta es de un solo día: los equipos entregados esa fecha."}
            )
        ocupados = (
            ActaEntrega.objects.filter(movimientos__in=movimientos)
            .exclude(pk=acta.pk if acta else None)
            .distinct()
        )
        if ocupados.exists():
            raise serializers.ValidationError(
                {"movimientos": f"Algún equipo ya está en el acta N.º {ocupados.first().id}."}
            )
        return movimientos, custodios.pop(), fechas.pop()

    def create(self, request, *args, **kwargs):
        entrada = GuardarActaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        movimientos, custodio_id, fecha = self._validar_movimientos(datos["movimientos"])
        with transaction.atomic():
            acta = ActaEntrega.objects.create(
                empresa_id=movimientos[0].activo.empresa_id,
                custodio_id=custodio_id,
                fecha=fecha,
                # El técnico es quien hizo la entrega en el sistema.
                tecnico=movimientos[0].registrado_por or request.user,
                pruebas=datos["pruebas"],
                nuevo_de_paquete=datos["nuevo_de_paquete"],
                observaciones=datos["observaciones"],
            )
            acta.movimientos.set(movimientos)
        record_audit_event(
            actor=request.user,
            action="activo.acta_entrega.creada",
            target=acta,
            module=MODULO,
            new_values={
                "custodio_id": custodio_id,
                "fecha": fecha.isoformat(),
                "activos": sorted(m.activo.codigo_barras for m in movimientos),
            },
            context=get_request_context(request),
        )
        acta = self.get_queryset().get(pk=acta.pk)
        return Response(ActaEntregaSerializer(acta).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        acta = self.get_object()
        actuales = list(acta.movimientos.values_list("id", flat=True))
        entrada = GuardarActaSerializer(data={"movimientos": actuales, **request.data})
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        antes = {
            "pruebas": acta.pruebas,
            "nuevo_de_paquete": acta.nuevo_de_paquete,
            "observaciones": acta.observaciones,
        }
        with transaction.atomic():
            if "movimientos" in request.data:
                movimientos, custodio_id, fecha = self._validar_movimientos(
                    datos["movimientos"], acta
                )
                if custodio_id != acta.custodio_id or fecha != acta.fecha:
                    raise serializers.ValidationError(
                        {"movimientos": "Los equipos deben ser de la misma persona y día del acta."}
                    )
                acta.movimientos.set(movimientos)
            for campo in ("pruebas", "nuevo_de_paquete", "observaciones"):
                if campo in request.data:
                    setattr(acta, campo, datos[campo])
            acta.save()
        record_audit_event(
            actor=request.user,
            action="activo.acta_entrega.editada",
            target=acta,
            module=MODULO,
            previous_values=antes,
            new_values={
                "pruebas": acta.pruebas,
                "nuevo_de_paquete": acta.nuevo_de_paquete,
                "observaciones": acta.observaciones,
            },
            context=get_request_context(request),
        )
        return Response(ActaEntregaSerializer(self.get_queryset().get(pk=acta.pk)).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    # --- Documento ----------------------------------------------------------

    @action(detail=True, methods=["get"])
    def documento(self, request, pk=None):
        acta = self.get_object()
        formato = request.query_params.get("formato", "pdf")
        if formato not in TIPOS_DE_DOCUMENTO:
            return Response(
                {"formato": "El formato es «docx» (Word) o «pdf»."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        contenido = (
            actas_entrega.generar_docx(acta)
            if formato == "docx"
            else actas_entrega.generar_pdf(acta)
        )
        nombre = actas_entrega.nombre_de_archivo(acta, formato)
        respuesta = HttpResponse(contenido, content_type=TIPOS_DE_DOCUMENTO[formato])
        respuesta["Content-Disposition"] = f'attachment; filename="{nombre}"'
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta
