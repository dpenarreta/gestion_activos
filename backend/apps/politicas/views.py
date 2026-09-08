from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activos.models import Activo
from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context

from .models import VENTANA_MANTENIMIENTOS_MESES, NivelRenovacion, PoliticaObsolescencia
from .permissions import PoliticasPermission
from .services import evaluar_lote, refrescar_indicadores_renovacion

MODULO = "politicas"


class PoliticaObsolescenciaSerializer(serializers.ModelSerializer):
    tipo_dispositivo_nombre = serializers.CharField(
        source="tipo_dispositivo.nombre", read_only=True, default=None
    )
    es_global = serializers.BooleanField(read_only=True)

    class Meta:
        model = PoliticaObsolescencia
        fields = [
            "id",
            "nombre",
            "tipo_dispositivo",
            "tipo_dispositivo_nombre",
            "es_global",
            "max_mantenimientos",
            "ventana_mantenimientos_meses",
            "max_componentes_criticos",
            "vida_util_meses",
            "vida_util_critica_meses",
            "activa",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        """Una política sin ningún umbral no evalúa nada: aceptarla daría la
        falsa impresión de que el tipo está cubierto."""
        umbrales = (
            "max_mantenimientos",
            "max_componentes_criticos",
            "vida_util_meses",
            "vida_util_critica_meses",
        )
        valores = {
            campo: attrs.get(campo, getattr(self.instance, campo, None)) for campo in umbrales
        }
        if all(valor is None for valor in valores.values()):
            raise serializers.ValidationError(
                "Defina al menos un umbral: mantenimientos, componentes críticos o vida útil."
            )

        vida_util = valores["vida_util_meses"]
        critica = valores["vida_util_critica_meses"]
        if vida_util is not None and critica is not None and critica <= vida_util:
            # Al revés, el nivel «recomendado» absorbería al de «evaluar» y el
            # primer aviso no llegaría nunca: todo saltaría ya como urgente.
            raise serializers.ValidationError(
                {
                    "vida_util_critica_meses": (
                        "Debe ser mayor que la vida útil: es el segundo nivel de aviso, "
                        f"posterior a los {vida_util} meses."
                    )
                }
            )

        ventana = attrs.get(
            "ventana_mantenimientos_meses",
            getattr(self.instance, "ventana_mantenimientos_meses", None),
        )
        if ventana is not None and valores["max_mantenimientos"] is None:
            raise serializers.ValidationError(
                {
                    "ventana_mantenimientos_meses": (
                        "La ventana solo tiene sentido junto a un máximo de intervenciones."
                    )
                }
            )
        if ventana == 0:
            raise serializers.ValidationError(
                {
                    "ventana_mantenimientos_meses": "Deje el campo vacío para contar todo el historial."
                }
            )
        return attrs


class PoliticaObsolescenciaViewSet(viewsets.ModelViewSet):
    """Parametrización de los criterios de sustitución (RF-06).

    Tras cada cambio se reevalúan los activos alcanzados: si subir un umbral no
    apagara las alertas ya encendidas, la configuración parecería no haber
    surtido efecto hasta la próxima intervención.
    """

    permission_classes = [IsAuthenticated, PoliticasPermission]
    serializer_class = PoliticaObsolescenciaSerializer
    pagination_class = DefaultPagination
    queryset = PoliticaObsolescencia.objects.select_related("tipo_dispositivo").order_by(
        "tipo_dispositivo__nombre", "nombre"
    )

    def perform_create(self, serializer):
        politica = serializer.save()
        self._auditar(politica, "politica.created", nuevos=serializer.data)
        self._reevaluar(politica)

    def perform_update(self, serializer):
        anteriores = self.get_serializer(serializer.instance).data
        politica = serializer.save()
        cambios = {
            campo: valor
            for campo, valor in serializer.data.items()
            if anteriores.get(campo) != valor
        }
        if cambios:
            self._auditar(
                politica,
                "politica.updated",
                previos={campo: anteriores.get(campo) for campo in cambios},
                nuevos=cambios,
            )
        self._reevaluar(politica)

    def perform_destroy(self, instance):
        tipo_id = instance.tipo_dispositivo_id
        self._auditar(
            instance,
            "politica.deleted",
            previos={"nombre": instance.nombre, "tipo_dispositivo": tipo_id},
        )
        instance.delete()
        # Al desaparecer una política específica, sus activos pasan a regirse
        # por la global: hay que reevaluarlos con la regla que ahora les toca.
        self._reevaluar_queryset(
            Activo.objects.filter(tipo_id=tipo_id) if tipo_id else Activo.objects.all()
        )

    def _auditar(self, politica, accion, previos=None, nuevos=None):
        record_audit_event(
            actor=self.request.user,
            action=accion,
            target=politica,
            module=MODULO,
            previous_values=previos,
            new_values=nuevos,
            context=get_request_context(self.request),
        )

    def _reevaluar(self, politica):
        queryset = (
            Activo.objects.filter(tipo=politica.tipo_dispositivo)
            if politica.tipo_dispositivo_id
            else Activo.objects.all()
        )
        self._reevaluar_queryset(queryset)

    @staticmethod
    def _reevaluar_queryset(queryset):
        activos = queryset.select_related("tipo").exclude(estado=Activo.Estado.DADO_DE_BAJA)
        # Se evalúa en lote para resolver la ventana móvil con una consulta
        # agregada, y luego se persiste el veredicto ya calculado.
        for activo, resultado in evaluar_lote(activos):
            refrescar_indicadores_renovacion(activo, resultado=resultado)

    @action(detail=False, methods=["get"], url_path="sugerencias")
    def sugerencias(self, request):
        """Activos que hoy exceden algún umbral (RF-07).

        Recalcula en vivo en lugar de filtrar por la columna cacheada: el
        criterio de longevidad se cumple por el paso del tiempo, así que la
        caché puede estar desactualizada justo para los casos que interesan.
        """
        nivel_pedido = request.query_params.get("nivel")
        activos = (
            Activo.objects.select_related("tipo", "custodio", "departamento")
            .exclude(estado=Activo.Estado.DADO_DE_BAJA)
            .order_by("-total_mantenimientos", "fecha_adquisicion")
        )
        sugerencias = []
        for activo, resultado in evaluar_lote(activos):
            if not resultado.requiere_renovacion:
                continue
            if nivel_pedido and resultado.nivel != nivel_pedido:
                continue
            sugerencias.append(
                {
                    "id": activo.id,
                    "codigo_barras": activo.codigo_barras,
                    "nombre": activo.nombre,
                    "tipo": activo.tipo.nombre,
                    "marca": activo.marca,
                    "modelo": activo.modelo,
                    "departamento": activo.departamento.nombre,
                    "custodio": activo.custodio.nombre_completo if activo.custodio_id else None,
                    "antiguedad_meses": activo.antiguedad_meses,
                    "total_mantenimientos": activo.total_mantenimientos,
                    "total_componentes_criticos": activo.total_componentes_criticos,
                    **resultado.as_dict(),
                }
            )

        # Lo recomendado primero: es lo que hay que presupuestar, y una lista
        # ordenada solo por antigüedad lo escondería entre los «evaluar».
        sugerencias.sort(key=lambda fila: fila["nivel_renovacion"] != NivelRenovacion.RECOMENDADO)
        return Response(
            {
                "total": len(sugerencias),
                "por_nivel": {
                    nivel.value: sum(1 for fila in sugerencias if fila["nivel_renovacion"] == nivel)
                    for nivel in (NivelRenovacion.RECOMENDADO, NivelRenovacion.EVALUAR)
                },
                "ventana_por_defecto_meses": VENTANA_MANTENIMIENTOS_MESES,
                "resultados": sugerencias,
            }
        )

    @action(detail=False, methods=["post"], url_path="reevaluar")
    def reevaluar(self, request):
        """Fuerza el recálculo de la caché de todos los activos."""
        activos = Activo.objects.select_related("tipo").exclude(estado=Activo.Estado.DADO_DE_BAJA)
        total = 0
        con_alerta = 0
        por_nivel = {NivelRenovacion.EVALUAR: 0, NivelRenovacion.RECOMENDADO: 0}
        for activo, resultado in evaluar_lote(activos):
            refrescar_indicadores_renovacion(activo, resultado=resultado)
            total += 1
            if resultado.requiere_renovacion:
                con_alerta += 1
                por_nivel[resultado.nivel] += 1

        record_audit_event(
            actor=request.user,
            action="politica.reevaluacion_masiva",
            target_type="politicaobsolescencia",
            target_id="all",
            module=MODULO,
            new_values={"activos_evaluados": total, "con_sugerencia": con_alerta},
            context=get_request_context(request),
        )
        return Response(
            {
                "activos_evaluados": total,
                "con_sugerencia": con_alerta,
                "por_nivel": {nivel.value: cuenta for nivel, cuenta in por_nivel.items()},
            },
            status=status.HTTP_200_OK,
        )
