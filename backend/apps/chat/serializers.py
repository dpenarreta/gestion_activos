from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.empresas.campos import RelacionDeEmpresa
from apps.organizacion.models import Departamento

from . import services

User = get_user_model()


def persona_dict(usuario) -> dict:
    empleado = getattr(usuario, "empleado", None)
    departamento = getattr(empleado, "departamento", None) if empleado else None
    return {
        "id": usuario.id,
        "nombre": services.nombre(usuario),
        "correo": usuario.email,
        "area": departamento.nombre if departamento else "",
        "cargo": getattr(empleado, "cargo", "") if empleado else "",
    }


def mensaje_dict(mensaje, usuario) -> dict:
    return {
        "id": mensaje.id,
        "conversacion": mensaje.conversacion_id,
        "autor": (
            {"id": mensaje.autor_id, "nombre": services.nombre(mensaje.autor)}
            if mensaje.autor_id
            else None
        ),
        "propio": mensaje.autor_id == usuario.id,
        "texto": mensaje.texto,
        "archivo": (
            {
                "nombre": mensaje.nombre_archivo,
                "tamano": mensaje.tamano,
                "es_imagen": mensaje.es_imagen,
                "url": f"/chat/archivos/{mensaje.id}/",
            }
            if mensaje.archivo
            else None
        ),
        "fecha": mensaje.created_at,
    }


class DirectaSerializer(serializers.Serializer):
    usuario = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))


class GrupoSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=120)
    participantes = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), many=True, required=False
    )
    departamento = RelacionDeEmpresa(Departamento, required=False, allow_null=True)


class EditarGrupoSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=120, required=False)
    agregar = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), many=True, required=False
    )
    quitar = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), many=True, required=False
    )


class MensajeSerializer(serializers.Serializer):
    texto = serializers.CharField(
        max_length=services.LARGO_MAXIMO, required=False, allow_blank=True
    )


class LeerSerializer(serializers.Serializer):
    hasta = serializers.IntegerField(required=False, min_value=1)
