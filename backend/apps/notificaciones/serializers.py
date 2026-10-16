from rest_framework import serializers

from .models import Notificacion
from .modulos import describir


class NotificacionSerializer(serializers.ModelSerializer):
    modulo_nombre = serializers.SerializerMethodField()
    icono = serializers.SerializerMethodField()
    leida = serializers.SerializerMethodField()

    class Meta:
        model = Notificacion
        fields = [
            "id",
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
