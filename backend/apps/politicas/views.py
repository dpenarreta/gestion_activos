from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activos.models import Activo
from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context

from .models import (
    VENTANA_MANTENIMIENTOS_MESES,
    NivelRenovacion,
    PoliticaDepreciacion,
    PoliticaObsolescencia,
)
from .permissions import PoliticasPermission
from .services import candidatos_a_renovacion, evaluar_lote, refrescar_indicadores_renovacion

#: Sugerencias que viajan en la respuesta. El recuento sigue siendo el
#: total; para llevárselas todas está el reporte del §16.
TOPE_SUGERENCIAS = 200

MODULO = "politicas"


def validar_alcance_unico(modelo, attrs, instancia):
    """Solo puede haber una política global por empresa.

    La restricción existe en la base, pero llegar hasta ella devuelve un 500:
    la interfaz deshabilita la opción cuando ya hay una, y quien llame a la API
    directamente —o tenga dos pestañas abiertas— merece el mismo «ya existe»
    que cualquier otra validación, no un error del servidor.

    Con dos políticas globales «la global» dejaría de ser una referencia
    unívoca y cuál se aplica dependería del orden de la tabla.
    """
    if "tipo_dispositivo" in attrs:
        tipo = attrs["tipo_dispositivo"]
    else:
        tipo = getattr(instancia, "tipo_dispositivo", None)
    if tipo is not None:
        return

    otras = modelo.objects.filter(tipo_dispositivo__isnull=True)
    if instancia is not None:
        otras = otras.exclude(pk=instancia.pk)
    if otras.exists():
        raise serializers.ValidationError(
            {
                "tipo_dispositivo": (
                    "Ya existe una política global. Edite la que hay o elija un tipo "
                    "de dispositivo para esta."
                )
            }
        )


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
        validar_alcance_unico(PoliticaObsolescencia, attrs, self.instance)

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

    def get_queryset(self):
        """En un método y no como atributo de clase: un `queryset` en el cuerpo
        se construye al importar el módulo, cuando todavía no hay petición ni
        empresa activa, y se quedaría con ese filtro para siempre."""
        return PoliticaObsolescencia.objects.select_related("tipo_dispositivo").order_by(
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
        activos = queryset.select_related("tipo").operativos()
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
            Activo.objects.select_related("tipo", "departamento")
            .prefetch_related("responsables")
            .operativos()
            .order_by("-total_mantenimientos", "fecha_adquisicion")
        )
        # El prefiltro deja en SQL a los que no superan ningún umbral. Los dos
        # endpoints de reevaluación de más abajo no lo usan: ellos sí tienen
        # que recorrer el parque entero, porque además de encender la marca
        # deben apagarla en los que dejaron de calificar.
        candidatos, politicas = candidatos_a_renovacion(activos)
        sugerencias = []
        for activo, resultado in evaluar_lote(candidatos, politicas):
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
                    "custodio": activo.resumen_de_responsables or None,
                    "antiguedad_meses": activo.antiguedad_meses,
                    "total_mantenimientos": activo.total_mantenimientos,
                    "total_componentes_criticos": activo.total_componentes_criticos,
                    **resultado.as_dict(),
                }
            )

        # Lo recomendado primero: es lo que hay que presupuestar, y una lista
        # ordenada solo por antigüedad lo escondería entre los «evaluar».
        sugerencias.sort(key=lambda fila: fila["nivel_renovacion"] != NivelRenovacion.RECOMENDADO)
        # El recuento se calcula sobre todas, pero solo viajan las primeras: en
        # un parque de 10.000 equipos con la mitad pasada de vida útil, esta
        # respuesta llegaba a miles de filas que nadie recorre en pantalla.
        # Para llevárselas todas está el reporte «Activos próximos a
        # reemplazo», que además exporta a Excel.
        mostradas = sugerencias[:TOPE_SUGERENCIAS]
        return Response(
            {
                "total": len(sugerencias),
                "mostradas": len(mostradas),
                "truncado": len(sugerencias) > len(mostradas),
                "por_nivel": {
                    nivel.value: sum(1 for fila in sugerencias if fila["nivel_renovacion"] == nivel)
                    for nivel in (NivelRenovacion.RECOMENDADO, NivelRenovacion.EVALUAR)
                },
                "ventana_por_defecto_meses": VENTANA_MANTENIMIENTOS_MESES,
                "resultados": mostradas,
            }
        )

    @action(detail=False, methods=["post"], url_path="reevaluar")
    def reevaluar(self, request):
        """Fuerza el recálculo de la caché de todos los activos."""
        activos = Activo.objects.select_related("tipo").operativos()
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


class PoliticaDepreciacionSerializer(serializers.ModelSerializer):
    tipo_dispositivo_nombre = serializers.CharField(
        source="tipo_dispositivo.nombre", read_only=True, default=None
    )
    es_global = serializers.BooleanField(read_only=True)

    class Meta:
        model = PoliticaDepreciacion
        fields = [
            "id",
            "nombre",
            "tipo_dispositivo",
            "tipo_dispositivo_nombre",
            "es_global",
            "meses_vida_contable",
            "porcentaje_residual",
            "activa",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        validar_alcance_unico(PoliticaDepreciacion, attrs, self.instance)
        return attrs

    def validate_meses_vida_contable(self, valor):
        if valor <= 0:
            # Con cero meses la cuota mensual sería una división por cero, y con
            # «vacío» el equipo no se depreciaría nunca: para eso está `activa`.
            raise serializers.ValidationError(
                "Debe ser al menos un mes. Para dejar de depreciar un tipo, desactive la política."
            )
        return valor

    def validate_porcentaje_residual(self, valor):
        if valor < 0 or valor >= 100:
            raise serializers.ValidationError(
                "Es el porcentaje del costo que el equipo conserva al final: entre 0 y 99,99."
            )
        return valor


class PoliticaDepreciacionViewSet(viewsets.ModelViewSet):
    """Cuánto vale en libros cada tipo de equipo (§22.3).

    No hay reevaluación tras guardar, a diferencia de las políticas de
    obsolescencia: la depreciación se calcula al leer y no se cachea en ninguna
    columna, así que un cambio se ve en la siguiente consulta sin recorrer el
    parque.
    """

    permission_classes = [IsAuthenticated, PoliticasPermission]
    serializer_class = PoliticaDepreciacionSerializer
    pagination_class = DefaultPagination

    def get_queryset(self):
        return PoliticaDepreciacion.objects.select_related("tipo_dispositivo").order_by(
            "tipo_dispositivo__nombre", "nombre"
        )

    def perform_create(self, serializer):
        politica = serializer.save()
        self._auditar(politica, "politica_depreciacion.created", nuevos=serializer.data)

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
                "politica_depreciacion.updated",
                previos={campo: anteriores.get(campo) for campo in cambios},
                nuevos=cambios,
            )

    def perform_destroy(self, instance):
        self._auditar(
            instance,
            "politica_depreciacion.deleted",
            previos={
                "nombre": instance.nombre,
                "tipo_dispositivo": instance.tipo_dispositivo_id,
            },
        )
        instance.delete()

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
