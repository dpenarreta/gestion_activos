"""Centro de alertas (§19) y sus umbrales."""

from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context

from .models import ConfiguracionAlertas
from .permissions import AlertasPermission
from .reglas import Severidad, construir_alertas

MODULO = "alertas"

#: Peso de cada severidad al resumir. Se ordena de más grave a menos para que
#: la primera tarjeta sea siempre la que hay que atender antes.
ORDEN_SEVERIDAD = {Severidad.ALTA: 0, Severidad.MEDIA: 1, Severidad.BAJA: 2}


class ConfiguracionAlertasSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfiguracionAlertas
        fields = [
            "dias_sin_asignar",
            "dias_reparacion_pendiente",
            "dias_sin_actualizacion",
            "avisar_proximos_a_reemplazo",
            "avisar_garantias_por_vencer",
            "avisar_demasiadas_reparaciones",
            "avisar_sin_asignar",
            "avisar_reparaciones_pendientes",
            "avisar_custodios_inactivos",
            "avisar_sin_actualizacion",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def validate(self, attrs):
        """Un umbral en cero avisaría de todo el parque desde el primer día,
        que es indistinguible de no tener la alerta."""
        for campo in ("dias_sin_asignar", "dias_reparacion_pendiente", "dias_sin_actualizacion"):
            valor = attrs.get(campo, getattr(self.instance, campo, None))
            if valor is not None and valor < 1:
                raise serializers.ValidationError(
                    {campo: "Debe ser al menos 1 día. Desactive la alerta si no la quiere."}
                )
        return attrs


class AlertasView(APIView):
    """Resumen de las alertas vigentes.

    Se calcula en cada petición, no se guarda: una alerta persistida hay que
    retirarla cuando la situación se resuelve, y la que nadie retira envejece
    hasta que el usuario deja de mirar la pantalla entera.
    """

    permission_classes = [IsAuthenticated, AlertasPermission]

    def get(self, request):
        configuracion = ConfiguracionAlertas.cargar()
        alertas = construir_alertas(configuracion)
        alertas.sort(key=lambda alerta: (ORDEN_SEVERIDAD[alerta.severidad], -alerta.total))

        con_pendientes = [alerta for alerta in alertas if alerta.total > 0]
        return Response(
            {
                "total_alertas": len(con_pendientes),
                "total_elementos": sum(alerta.total for alerta in con_pendientes),
                "por_severidad": {
                    severidad: sum(1 for a in con_pendientes if a.severidad == severidad)
                    for severidad in (Severidad.ALTA, Severidad.MEDIA, Severidad.BAJA)
                },
                # Se devuelven también las que están en cero: «revisado, nada
                # pendiente» es información, y es distinto de una alerta
                # apagada, que sencillamente no aparece.
                "alertas": [alerta.as_dict() for alerta in alertas],
                "configuracion": ConfiguracionAlertasSerializer(configuracion).data,
            }
        )


class ConfiguracionAlertasView(APIView):
    """Umbrales y encendido/apagado de cada alerta."""

    permission_classes = [IsAuthenticated, AlertasPermission]

    def get(self, request):
        configuracion = ConfiguracionAlertas.cargar()
        return Response(ConfiguracionAlertasSerializer(configuracion).data)

    def patch(self, request):
        configuracion = ConfiguracionAlertas.cargar()
        anteriores = ConfiguracionAlertasSerializer(configuracion).data
        serializer = ConfiguracionAlertasSerializer(configuracion, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        cambios = {
            campo: valor
            for campo, valor in serializer.data.items()
            if anteriores.get(campo) != valor
        }
        if cambios:
            record_audit_event(
                actor=request.user,
                action="alertas.configuracion_actualizada",
                target=configuracion,
                module=MODULO,
                previous_values={campo: anteriores.get(campo) for campo in cambios},
                new_values=cambios,
                context=get_request_context(request),
            )
        return Response(serializer.data)
