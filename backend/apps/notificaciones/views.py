"""La campana: cada quien ve y marca solo sus propias notificaciones."""

from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotAuthenticated, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from apps.core.pagination import DefaultPagination
from apps.core.responses import error_response

from . import services
from .modulos import MODULOS, describir
from .serializers import (
    BajaDispositivoSerializer,
    DispositivoSerializer,
    NotificacionSerializer,
    RegistroDispositivoSerializer,
)

#: Cuántas trae la campana al abrirse.
RECIENTES = 8


class NotificacionViewSet(viewsets.ReadOnlyModelViewSet):
    """`GET /notificaciones/`: el historial, con `modulo` y `estado=no_leidas`.
    `GET /notificaciones/resumen/`: lo de la campana (contador y recientes)."""

    serializer_class = NotificacionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = DefaultPagination

    def get_queryset(self):
        consulta = services.de(self.request.user)
        modulo = self.request.query_params.get("modulo")
        if modulo:
            consulta = consulta.filter(modulo=modulo)
        if self.request.query_params.get("estado") == "no_leidas":
            consulta = consulta.filter(leida_en__isnull=True)
        return consulta.order_by("-created_at", "-id")

    def get_throttles(self):
        # La campana consulta el resumen sola cada pocos segundos: va con el
        # límite de los sondeos, no con el general de la persona.
        if getattr(self, "action", None) == "resumen":
            self.throttle_scope = "sondeo"
            return [ScopedRateThrottle()]
        return super().get_throttles()

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        propias = services.de(request.user)
        return Response(
            {
                "no_leidas": propias.filter(leida_en__isnull=True).count(),
                "recientes": NotificacionSerializer(
                    propias.order_by("-created_at", "-id")[:RECIENTES], many=True
                ).data,
            }
        )

    @action(detail=False, methods=["get"])
    def modulos(self, request):
        """Los módulos para el filtro del historial."""
        return Response([{"id": clave, "nombre": describir(clave)[0]} for clave in MODULOS])

    @action(detail=True, methods=["post"])
    def leer(self, request, pk=None):
        notificacion = get_object_or_404(services.de(request.user), pk=pk)
        return Response(NotificacionSerializer(services.marcar_leida(notificacion)).data)

    @action(detail=False, methods=["post"], url_path="leer-todas")
    def leer_todas(self, request):
        return Response({"marcadas": services.marcar_todas(request.user)})


class _DispositivoView(APIView):
    """Base de las vistas del push de la app: autenticadas y con su propio
    límite (`dispositivos_push`), además del general por persona."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [UserRateThrottle, ScopedRateThrottle]
    throttle_scope = "dispositivos_push"

    def handle_exception(self, exc):
        if isinstance(exc, services.RegistroEnConflicto):
            return error_response(exc.code, exc.message, exc.status)
        # Un solo código para los datos inválidos (`validation_error`, como en
        # el contrato de la US-009) y el primer problema como mensaje, para que
        # la app lo muestre tal cual en vez de «Error en la solicitud».
        response = super().handle_exception(exc)
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            error = response.data.get("error")
            if isinstance(error, dict):
                error["code"] = "validation_error"
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response


def _primer_mensaje(detalle) -> str:
    if isinstance(detalle, dict):
        detalle = next(iter(detalle.values()), "")
    if isinstance(detalle, list):
        detalle = detalle[0] if detalle else ""
    if isinstance(detalle, (dict, list)):
        return _primer_mensaje(detalle)
    return str(detalle or "")


class DispositivoRegistroView(_DispositivoView):
    """`POST /notificaciones/dispositivos/`: registra el teléfono para el push.

    Acceso: autenticado (JWT con sesión). Entrada: `{token, plataforma,
    nombre?}`. Une el token a la persona y a la sesión del access token; si
    ya existía (otra cuenta u otra sesión), lo mueve aquí. Responde 201 si es
    nuevo y 200 si ya existía: `{id, plataforma, nombre, creado}`.
    Errores: 400 `validation_error` (token sin formato de Expo, plataforma
    distinta de android/ios, nombre de más de 100), 401 sin sesión, 409
    `dispositivo_en_conflicto` si el mismo token choca tres veces seguidas con
    registros simultáneos, 429.
    """

    def post(self, request):
        session = getattr(request.auth, "session", None)
        if session is None:
            # Sin la sesión del token no hay a qué unir el teléfono, y revocarla
            # no cortaría su push.
            raise NotAuthenticated("Inicie sesión para recibir avisos en este teléfono.")
        entrada = RegistroDispositivoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        dispositivo, creado = services.registrar_dispositivo(
            usuario=request.user, session=session, **entrada.validated_data
        )
        return Response(
            DispositivoSerializer(dispositivo, context={"creado": creado}).data,
            status=status.HTTP_201_CREATED if creado else status.HTTP_200_OK,
        )


class DispositivoBajaView(_DispositivoView):
    """`POST /notificaciones/dispositivos/baja/`: el teléfono deja de recibir push.

    Acceso: autenticado. Entrada: `{token}`. Siempre 204, sea o no de la
    persona: un token ajeno no se toca y no se revela si existe. Errores: 400
    sin `token`, 401 sin sesión, 429.
    """

    def post(self, request):
        entrada = BajaDispositivoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        services.dar_de_baja_dispositivo(
            usuario=request.user, token=entrada.validated_data["token"]
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
