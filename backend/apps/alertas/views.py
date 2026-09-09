"""Centro de alertas (§19), sus umbrales y el envío por correo."""

from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context

from .models import ConfiguracionAlertas, EnvioAlertas
from .permissions import AlertasPermission, ConfiguracionAlertasPermission
from .reglas import Severidad, construir_alertas
from .services import destinatarios_elegibles, enviar_prueba

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
            "notificaciones_activas",
            "frecuencia",
            "dia_envio_semanal",
            "omitir_si_no_hay_pendientes",
            "destinatarios",
            "ultimo_envio",
            "updated_at",
        ]
        # `ultimo_envio` lo escribe el envío, no el formulario: si se pudiera
        # editar, mover esa fecha saltaría el resumen de un día sin dejar
        # rastro de quién lo hizo.
        read_only_fields = ["ultimo_envio", "updated_at"]

    def validate_destinatarios(self, usuarios):
        """Solo puede recibir el resumen quien podría abrir el centro de alertas.

        Se valida aquí, además de al enviar, para que el error se vea al
        guardar: una lista que el envío descarta en silencio da la impresión
        de que alguien está avisado cuando no lo está.
        """
        elegibles = {usuario.id for usuario in destinatarios_elegibles()}
        invalidos = [usuario.username for usuario in usuarios if usuario.id not in elegibles]
        if invalidos:
            raise serializers.ValidationError(
                "Estos usuarios no pueden recibir alertas porque no tienen permiso para "
                f"verlas, están inactivos o no tienen correo: {', '.join(sorted(invalidos))}."
            )
        return usuarios

    def validate(self, attrs):
        """Un umbral en cero avisaría de todo el parque desde el primer día,
        que es indistinguible de no tener la alerta."""
        for campo in ("dias_sin_asignar", "dias_reparacion_pendiente", "dias_sin_actualizacion"):
            valor = attrs.get(campo, getattr(self.instance, campo, None))
            if valor is not None and valor < 1:
                raise serializers.ValidationError(
                    {campo: "Debe ser al menos 1 día. Desactive la alerta si no la quiere."}
                )

        activas = attrs.get(
            "notificaciones_activas", getattr(self.instance, "notificaciones_activas", False)
        )
        if activas:
            destinatarios = attrs.get("destinatarios")
            if destinatarios is None and self.instance is not None:
                destinatarios = list(self.instance.destinatarios.all())
            if not destinatarios:
                raise serializers.ValidationError(
                    {
                        "destinatarios": (
                            "Elija al menos un destinatario antes de activar el envío por correo."
                        )
                    }
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


def _correo_enmascarado(correo: str) -> str:
    """`daniel@empresa.com` → `d****@empresa.com`.

    Quien configura las alertas necesita reconocer a quién le está enviando,
    no necesita la dirección completa: el catálogo de correos del personal es
    un dato de contacto y este endpoint no exige `usuarios.ver`
    (ver `docs/data-protection-review.md`).
    """
    usuario, separador, dominio = correo.partition("@")
    if not separador or not usuario:
        return correo
    return f"{usuario[0]}{'*' * max(len(usuario) - 1, 1)}@{dominio}"


class DestinatariosDisponiblesView(APIView):
    """Usuarios a los que se les puede enviar el resumen."""

    permission_classes = [IsAuthenticated, ConfiguracionAlertasPermission]

    def get(self, request):
        return Response(
            [
                {
                    "id": usuario.id,
                    "username": usuario.username,
                    "nombre": usuario.get_full_name() or usuario.username,
                    "correo": _correo_enmascarado(usuario.email),
                }
                for usuario in destinatarios_elegibles()
            ]
        )


class EnvioAlertasSerializer(serializers.ModelSerializer):
    resultado_display = serializers.CharField(source="get_resultado_display", read_only=True)
    origen_display = serializers.CharField(source="get_origen_display", read_only=True)
    total_destinatarios = serializers.SerializerMethodField()

    class Meta:
        model = EnvioAlertas
        fields = [
            "id",
            "resultado",
            "resultado_display",
            "origen",
            "origen_display",
            "motivo",
            "total_alertas",
            "total_elementos",
            "total_destinatarios",
            "created_at",
        ]

    def get_total_destinatarios(self, envio) -> int:
        return len(envio.destinatarios)


class HistorialEnviosView(APIView):
    """Últimos intentos de envío, incluidos los omitidos y los fallidos.

    Un envío que falla en silencio es peor que no tener envío: hace creer que
    alguien fue advertido. Esta pantalla es donde se ve que no lo fue.
    """

    permission_classes = [IsAuthenticated, AlertasPermission]

    #: Suficiente para ver si el envío de esta semana salió y qué pasó los
    #: días anteriores. El histórico completo no tiene un uso operativo.
    LIMITE = 15

    def get(self, request):
        envios = EnvioAlertas.objects.all()[: self.LIMITE]
        return Response(EnvioAlertasSerializer(envios, many=True).data)


class EnviarPruebaView(APIView):
    """Envía el resumen de hoy a quien lo solicita, y a nadie más.

    Con su propio límite de frecuencia: un endpoint que dispara correos es un
    remitente disponible para quien consiga una sesión, y aunque solo escriba
    al buzón del propio solicitante, permitirlo mil veces por hora convierte
    el sistema en la herramienta para inundarlo.
    """

    permission_classes = [IsAuthenticated, AlertasPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "alertas_prueba"

    def post(self, request):
        if not request.user.email:
            return Response(
                {"detail": "Tu cuenta no tiene un correo registrado al que enviar la prueba."},
                status=400,
            )

        envio = enviar_prueba(usuario=request.user)
        record_audit_event(
            actor=request.user,
            action="alertas.prueba_enviada",
            target=envio,
            module=MODULO,
            new_values={"resultado": envio.resultado, "motivo": envio.motivo},
            context=get_request_context(request),
        )

        if envio.resultado == EnvioAlertas.Resultado.FALLIDO:
            return Response(
                {
                    "detail": (
                        "No se pudo enviar el correo. Revise la configuración del servidor "
                        "de salida (SMTP)."
                    ),
                    "motivo": envio.motivo,
                },
                status=502,
            )
        return Response(
            {
                "detail": f"Se envió el resumen de prueba a {request.user.email}.",
                "envio": EnvioAlertasSerializer(envio).data,
            }
        )
