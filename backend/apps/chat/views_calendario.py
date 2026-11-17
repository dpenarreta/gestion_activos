"""API del calendario de Google para el estado «En reunión» (17/11/2026).

- `GET    /chat/calendario/`            → `{disponible, conectado, conectado_en,
  error, en_reunion_hasta}`.
- `POST   /chat/calendario/conectar/`   → `{url}`: la página de Google donde la
  persona acepta «ver su disponibilidad».
- `GET    /chat/calendario/callback/`   ← el retorno de Google (sin sesión: lo
  ata a la persona el `state` firmado). Redirige a la pantalla del chat.
- `DELETE /chat/calendario/`            → desconecta y revoca.

Todo pide `chat.calendario_google`, salvo el retorno, que valida el `state`.
"""

from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpResponseRedirect
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import Requiere

from . import calendario

PERMISO = "chat.calendario_google"


def _volver(resultado: str):
    destino = (
        f"{settings.FRONTEND_URL.rstrip('/')}/admin/chat?{urlencode({'calendario': resultado})}"
    )
    return HttpResponseRedirect(destino)


class CalendarioView(APIView):
    permission_classes = [IsAuthenticated, Requiere(PERMISO)]

    def get(self, request):
        return Response(calendario.estado_de(request.user))

    def delete(self, request):
        if calendario.desconectar(request.user):
            record_audit_event(
                actor=request.user,
                action="chat.calendario.desconectado",
                target=request.user,
                module="chat",
                context=get_request_context(request),
            )
        return Response(calendario.estado_de(request.user))


class ConectarCalendarioView(APIView):
    permission_classes = [IsAuthenticated, Requiere(PERMISO)]

    def post(self, request):
        if not calendario.configurado():
            return Response(
                {
                    "error": {
                        "code": "calendario_no_disponible",
                        "message": "La conexión con Google Calendar todavía no está disponible.",
                        "details": None,
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"url": calendario.url_para_conectar(request.user)})


class RetornoCalendarioView(APIView):
    """El retorno de Google. Sin sesión (es una redirección del navegador):
    el `state` firmado, vigente y de un solo uso dice de quién es."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        if request.query_params.get("error"):
            return _volver("cancelado")
        usuario = calendario.usuario_del_estado(request.query_params.get("state", ""))
        codigo = request.query_params.get("code", "")
        if usuario is None or not codigo:
            return _volver("invalido")
        from apps.permissions.authorization import user_has_permission

        if not user_has_permission(usuario, PERMISO):
            return _volver("sin_permiso")
        try:
            calendario.conectar(usuario, codigo)
        except calendario.ErrorDeGoogle:
            return _volver("error")
        record_audit_event(
            actor=usuario,
            action="chat.calendario.conectado",
            target=usuario,
            module="chat",
            new_values={"alcance": calendario.ALCANCE},
            context=get_request_context(request),
        )
        return _volver("conectado")
