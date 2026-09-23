"""Cuándo se respalda solo: la política y el estado de lo último que se hizo.

Una sola fila para todo el despliegue, así que no hay listado ni identificador:
se lee y se corrige, como el tema del sitio. Quien puede tocar la configuración
del sistema puede tocar esto; no lleva permiso propio porque decidir cada cuánto
se respalda es exactamente ese oficio.
"""

import datetime

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.branding.permissions import ConfiguracionPermission
from apps.core.audit import record_audit_event
from apps.core.management.commands.respaldar import fecha_del_ultimo_respaldo
from apps.core.models import PoliticaDeRespaldo
from apps.core.request_meta import get_request_context

MODULO = "core"


class PoliticaDeRespaldoSerializer(serializers.ModelSerializer):
    frecuencia_display = serializers.CharField(source="get_frecuencia_display", read_only=True)

    class Meta:
        model = PoliticaDeRespaldo
        fields = [
            "activo",
            "frecuencia",
            "frecuencia_display",
            "dia_semanal",
            "hora",
            "destino",
            "conservar",
            "ultimo_respaldo",
        ]
        read_only_fields = ["frecuencia_display", "ultimo_respaldo"]

    def validate_conservar(self, value):
        if value < 1:
            raise serializers.ValidationError(
                "Hay que conservar al menos uno: cero sería no respaldar."
            )
        return value

    def validate_dia_semanal(self, value):
        if not 0 <= value <= 6:
            raise serializers.ValidationError("El día va de 0 (lunes) a 6 (domingo).")
        return value

    def validate_destino(self, value):
        limpio = (value or "").strip()
        if not limpio:
            raise serializers.ValidationError("Hace falta una carpeta donde escribir.")
        return limpio


class PoliticaDeRespaldoView(APIView):
    """Lee y corrige cuándo se respalda."""

    permission_classes = [IsAuthenticated, ConfiguracionPermission]

    def get(self, request):
        politica = PoliticaDeRespaldo.vigente()
        datos = PoliticaDeRespaldoSerializer(politica).data
        # Lo último que hay en disco, que no es lo mismo que lo último que hizo
        # la tarea: un respaldo a mano también cuenta para saber de cuándo se
        # puede volver, y es la pregunta que se hace al abrir esta pantalla.
        ultimo = fecha_del_ultimo_respaldo(politica.destino)
        datos["ultimo_en_disco"] = ultimo.isoformat() if ultimo else None
        datos["proximo"] = self._proximo(politica)
        return Response(datos)

    def patch(self, request):
        politica = PoliticaDeRespaldo.vigente()
        anterior = PoliticaDeRespaldoSerializer(politica).data

        entrada = PoliticaDeRespaldoSerializer(politica, data=request.data, partial=True)
        entrada.is_valid(raise_exception=True)
        politica = entrada.save()

        cambios = {
            campo: valor for campo, valor in entrada.data.items() if anterior.get(campo) != valor
        }
        if cambios:
            record_audit_event(
                actor=request.user,
                action="respaldo.politica_changed",
                target=politica,
                module=MODULO,
                previous_values={campo: anterior.get(campo) for campo in cambios},
                new_values=cambios,
                context=get_request_context(request),
            )
        return Response(self.get(request).data, status=status.HTTP_200_OK)

    @staticmethod
    def _proximo(politica) -> str | None:
        """Cuándo le toca, en texto, para que la pantalla no lo calcule aparte.

        Es la comprobación que alguien hace después de cambiar la frecuencia: si
        la pantalla no lo dice, se queda esperando al día siguiente para saber
        si lo configuró bien.
        """
        if not politica.activo:
            return None
        from django.utils import timezone

        ahora = timezone.localtime()
        for dentro_de in range(0, 8):
            dia = (ahora + datetime.timedelta(days=dentro_de)).date()
            if politica.ultimo_respaldo == dia:
                continue
            if (
                politica.frecuencia == PoliticaDeRespaldo.Frecuencia.SEMANAL
                and dia.weekday() != politica.dia_semanal
            ):
                continue
            if dentro_de == 0 and ahora.time() >= politica.hora:
                continue
            return f"{dia.isoformat()} {politica.hora:%H:%M}"
        return None
