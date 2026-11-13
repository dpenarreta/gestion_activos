import re

from rest_framework import serializers

from .models import DispositivoPush, Notificacion
from .modulos import describir


class NotificacionSerializer(serializers.ModelSerializer):
    modulo_nombre = serializers.SerializerMethodField()
    icono = serializers.SerializerMethodField()
    leida = serializers.SerializerMethodField()
    #: El id de la empresa, o null si es de la cuenta. La app la añade como
    #: `?empresa=ID` al abrir el enlace en el navegador (US-009, CA-7).
    empresa = serializers.IntegerField(source="empresa_id", read_only=True, allow_null=True)

    class Meta:
        model = Notificacion
        fields = [
            "id",
            "empresa",
            "modulo",
            "modulo_nombre",
            "icono",
            "tipo",
            "titulo",
            "resumen",
            "enlace",
            "leida",
            "leida_en",
            "created_at",
        ]

    def get_modulo_nombre(self, notificacion):
        return describir(notificacion.modulo)[0]

    def get_icono(self, notificacion):
        return describir(notificacion.modulo)[1]

    def get_leida(self, notificacion):
        return notificacion.leida_en is not None


#: El Expo push token: «ExponentPushToken[…]» (o el más nuevo «ExpoPushToken[…]»).
FORMATO_TOKEN_EXPO = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[^\[\]\s]+\]$")


class RegistroDispositivoSerializer(serializers.Serializer):
    """Entrada de `POST /notificaciones/dispositivos/`."""

    token = serializers.CharField(max_length=200, trim_whitespace=True)
    plataforma = serializers.ChoiceField(
        choices=DispositivoPush.PLATAFORMAS,
        error_messages={"invalid_choice": "La plataforma debe ser «android» o «ios»."},
    )
    #: Solo el modelo genérico del teléfono (LOPDP): lo manda la app.
    nombre = serializers.CharField(
        max_length=100, required=False, allow_blank=True, default="", trim_whitespace=True
    )

    def validate_token(self, valor):
        if not FORMATO_TOKEN_EXPO.match(valor):
            raise serializers.ValidationError(
                "El token no tiene el formato de Expo («ExponentPushToken[…]»)."
            )
        return valor


class BajaDispositivoSerializer(serializers.Serializer):
    """Entrada de `POST /notificaciones/dispositivos/baja/`. Sin validar el
    formato: dar de baja algo que no existe no hace nada."""

    token = serializers.CharField(max_length=200, trim_whitespace=True)


class DispositivoSerializer(serializers.ModelSerializer):
    """Salida del registro. Sin el token: la app ya lo tiene."""

    creado = serializers.SerializerMethodField()

    class Meta:
        model = DispositivoPush
        fields = ["id", "plataforma", "nombre", "creado"]

    def get_creado(self, dispositivo) -> bool:
        return bool(self.context.get("creado"))
