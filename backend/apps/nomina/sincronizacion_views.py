"""API de la sincronización de perfiles con nómina (US-021).

- `GET  /api/v1/nomina/sincronizacion/`: la última corrida con su reporte
  (conflictos y cuentas fuera de nómina), las cinco anteriores en resumen,
  si está configurada y cuántas cuentas creadas desde nómina siguen inactivas.
- `POST /api/v1/nomina/sincronizacion/`: corre una ahora («Sincronizar
  ahora»). Responde la corrida.

Las dos con `usuarios.sincronizar_nomina`. El reporte no lleva cédulas.
"""

from django.core.cache import cache
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import Requiere

from . import empleados
from .models import SincronizacionNomina

#: Una a la vez: la corrida recorre cientos de cuentas.
CANDADO = "nomina:sincronizando"
CANDADO_SEGUNDOS = 15 * 60


def resumen(corrida, *, con_detalle=False) -> dict | None:
    if corrida is None:
        return None
    datos = {
        "id": corrida.pk,
        "iniciada_en": corrida.iniciada_en,
        "terminada_en": corrida.terminada_en,
        "automatica": corrida.actor_id is None,
        "actor": (corrida.actor.get_full_name().strip() or corrida.actor.username)
        if corrida.actor_id
        else None,
        "estado": corrida.estado,
        "estado_display": corrida.get_estado_display(),
        "empleados": corrida.empleados,
        "creadas": corrida.creadas,
        "actualizadas": corrida.actualizadas,
        "sin_cambios": corrida.sin_cambios,
        "conflictos_total": len(corrida.conflictos or []),
        "fuera_de_nomina_total": len(corrida.fuera_de_nomina or []),
        "error": corrida.error,
    }
    if con_detalle:
        datos["conflictos"] = corrida.conflictos or []
        datos["fuera_de_nomina"] = corrida.fuera_de_nomina or []
    return datos


def estado() -> dict:
    from apps.users.models import User

    corridas = list(SincronizacionNomina.objects.select_related("actor")[:6])
    return {
        "configurada": empleados.configurada(),
        "corriendo": bool(cache.get(CANDADO)),
        "ultima": resumen(corridas[0], con_detalle=True) if corridas else None,
        "anteriores": [resumen(c) for c in corridas[1:]],
        "inactivas_desde_nomina": User.objects.filter(
            nomina_sincronizada_en__isnull=False, is_active=False
        ).count(),
    }


class SincronizacionNominaView(APIView):
    permission_classes = [IsAuthenticated, Requiere("usuarios.sincronizar_nomina")]

    def get(self, request):
        return Response(estado())

    def post(self, request):
        if not empleados.configurada():
            return Response(
                {
                    "error": {
                        "code": "no_configurada",
                        "message": "La sincronización con nómina no está configurada en este servidor.",
                        "details": None,
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not cache.add(CANDADO, True, CANDADO_SEGUNDOS):
            return Response(
                {
                    "error": {
                        "code": "en_curso",
                        "message": "Ya hay una sincronización en curso. Espere a que termine.",
                        "details": None,
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )
        try:
            corrida = empleados.sincronizar(actor=request.user)
        finally:
            cache.delete(CANDADO)
        record_audit_event(
            actor=request.user,
            action="usuarios.nomina.sincronizada",
            module="usuarios",
            new_values={
                "estado": corrida.estado,
                "creadas": corrida.creadas,
                "actualizadas": corrida.actualizadas,
                "conflictos": len(corrida.conflictos or []),
            },
            context=get_request_context(request),
        )
        return Response(resumen(corrida, con_detalle=True))
