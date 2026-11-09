"""Entradas y salidas de la API de derechos sobre datos personales.

Dos vistas de la misma solicitud, a propósito distintas:

- `del_titular`: lo que ve quien la pidió (su solicitud, el plazo, el estado y
  cada respuesta). No dice quién de la empresa la atendió: el titular trata con
  la empresa, no con una persona, y el nombre de quien atiende no es un dato
  que necesite.
- `de_bandeja`: lo que ve quien atiende, con el titular (nombre, usuario y
  correo, para poder responderle) y quién movió cada estado.
"""

from django.utils import timezone
from rest_framework import serializers

from .models import DESCRIPCION_MAX, RESPUESTA_MAX, SolicitudDerechos
from .services import nombre, vencida


class CrearSolicitudSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(
        choices=SolicitudDerechos.Tipo.choices,
        error_messages={"invalid_choice": "Tipo de solicitud inválido."},
    )
    descripcion = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=DESCRIPCION_MAX
    )


class CambiarEstadoSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(
        choices=SolicitudDerechos.Estado.choices,
        error_messages={"invalid_choice": "Estado inválido."},
    )
    respuesta = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=RESPUESTA_MAX
    )
    estado_esperado = serializers.ChoiceField(
        choices=SolicitudDerechos.Estado.choices,
        required=False,
        allow_null=True,
        error_messages={"invalid_choice": "Estado inválido."},
    )


class FiltrosBandejaSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(
        choices=SolicitudDerechos.Estado.choices, required=False, allow_blank=True
    )
    tipo = serializers.ChoiceField(
        choices=SolicitudDerechos.Tipo.choices, required=False, allow_blank=True
    )
    vencidas = serializers.BooleanField(required=False, default=False)
    q = serializers.CharField(required=False, allow_blank=True, max_length=100)


def _fecha(valor):
    return valor.isoformat() if valor is not None else None


def _momento(valor):
    return timezone.localtime(valor).isoformat() if valor is not None else None


def _base(s: SolicitudDerechos, hoy) -> dict:
    return {
        "id": s.pk,
        "numero": s.numero,
        "tipo": s.tipo,
        "tipo_label": s.get_tipo_display(),
        "descripcion": s.descripcion,
        "estado": s.estado,
        "estado_label": s.get_estado_display(),
        "creada_en": _momento(s.created_at),
        "fecha_limite": _fecha(s.fecha_limite),
        "plazo_dias": s.plazo_dias,
        "dias_restantes": (s.fecha_limite - hoy).days if not s.cerrada else None,
        "vencida": vencida(s, hoy),
        "respuesta": s.respuesta,
        "resuelta_en": _momento(s.resuelta_en),
    }


def _movimientos(s: SolicitudDerechos, *, con_actor: bool) -> list[dict]:
    filas = []
    for m in s.movimientos.select_related("actor").order_by("created_at", "id"):
        fila = {
            "estado_anterior": m.estado_anterior or None,
            "estado_nuevo": m.estado_nuevo,
            "estado_nuevo_label": SolicitudDerechos.Estado(m.estado_nuevo).label,
            "respuesta": m.respuesta,
            "fecha": _momento(m.created_at),
        }
        if con_actor:
            fila["actor"] = {"id": m.actor_id, "nombre": nombre(m.actor)} if m.actor_id else None
        filas.append(fila)
    return filas


def del_titular(s: SolicitudDerechos, *, con_historial: bool = False) -> dict:
    datos = _base(s, timezone.localdate())
    if con_historial:
        datos["historial"] = _movimientos(s, con_actor=False)
    return datos


def de_bandeja(s: SolicitudDerechos, *, con_historial: bool = False, hoy=None) -> dict:
    hoy = hoy or timezone.localdate()
    datos = _base(s, hoy)
    datos["titular"] = {
        "id": s.titular_id,
        "nombre": nombre(s.titular),
        "usuario": s.titular.username,
        "correo": s.titular.email,
    }
    datos["resuelta_por"] = (
        {"id": s.resuelta_por_id, "nombre": nombre(s.resuelta_por)} if s.resuelta_por_id else None
    )
    datos["importada_de_nexo"] = s.id_nexo is not None
    if con_historial:
        datos["historial"] = _movimientos(s, con_actor=True)
    return datos


# ── Consentimiento (ver `consentimiento.py`) ──────────────────────────────────


class AceptarAvisoSerializer(serializers.Serializer):
    version = serializers.IntegerField(
        min_value=1, error_messages={"required": "Falta la versión del aviso que leyó."}
    )


class GuardarAvisoSerializer(serializers.Serializer):
    texto = serializers.CharField(allow_blank=True, trim_whitespace=True)
    pedir_aceptacion_de_nuevo = serializers.BooleanField(required=False, default=False)


class FiltrosConsentimientoSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(
        choices=[("ACEPTADO", "Aceptado"), ("PENDIENTE", "Pendiente")],
        required=False,
        allow_blank=True,
        error_messages={"invalid_choice": "Estado inválido."},
    )
    q = serializers.CharField(required=False, allow_blank=True, max_length=100)


class ConfirmarSerializer(serializers.Serializer):
    confirmar = serializers.BooleanField()
