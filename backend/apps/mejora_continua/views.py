"""Endpoints de Mejora continua (`/api/v1/mejora-continua/`), portados de las
rutas `/api/ideas` de Nexo.

Las vistas solo resuelven parámetros y delegan en `services.py`. Toda vista
exige sesión y algún permiso del módulo (`mejora_continua.*`); lo que cada
acción pide además (proponer, votar, mover de etapa) lo comprueba el servicio.
Una idea que la persona no ve responde 404 (no se revela que existe, como en
Nexo). Los errores salen en el contrato uniforme
`{"error": {"code", "message", "details"}}`.

La empresa de cada petición la resuelve `X-Empresa` (ver `apps.empresas`): los
gestores de los modelos ya acotan cada consulta a ella. Las rutas son del
módulo Gestión Humana: se apagan con él (`apps.empresas.modulos`).
"""

from urllib.parse import quote

from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.descargas.middleware import marcar
from apps.permissions.permissions import Requiere

from . import access, serializers, services
from .models import ImprovementIdea
from .services import MejoraContinuaError

DelModulo = Requiere(*access.ALL_CODENAMES)


def _primer_mensaje(detalle) -> str | None:
    if isinstance(detalle, str):
        return detalle
    if isinstance(detalle, dict):
        for valor in detalle.values():
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    if isinstance(detalle, (list, tuple)):
        for valor in detalle:
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    return None


class MejoraContinuaView(APIView):
    permission_classes = [IsAuthenticated, DelModulo]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, MejoraContinuaError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        response = super().handle_exception(exc)
        # El mensaje general dice cuál es el primer problema, no «Error en la
        # solicitud»: la pantalla lo muestra tal cual. Y un solo código para
        # los datos inválidos, vengan del serializador («invalid» en DRF) o del
        # servicio.
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            error = response.data.get("error")
            if isinstance(error, dict):
                error["code"] = "validation_error"
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response

    def validated(self, serializer_class):
        serializer = serializer_class(data=self.request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class MeView(MejoraContinuaView):
    """`GET /mejora-continua/me/`: qué puede hacer la persona en el módulo, su
    insignia «innovador» y qué adjuntos se aceptan."""

    def get(self, request):
        return Response(services.resumen_de_acceso(request.user))


class IdeaListCreateView(MejoraContinuaView):
    """`GET /mejora-continua/ideas/`: el tablero (las ideas que ve, de la más
    nueva a la más antigua). Filtros opcionales: `status=<etapa>` y `mine=1`
    (solo las propias, la pestaña «Mis ideas» de Nexo).

    `POST /mejora-continua/ideas/`: propone una idea (`mejora_continua.acceder`).
    Multipart con `title`, `description`, `impact` y `attachment` opcional; o
    JSON sin adjunto."""

    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        ideas = access.ideas_visibles(request.user)
        etapa = request.query_params.get("status")
        if etapa:
            if etapa not in ImprovementIdea.Status.values:
                raise MejoraContinuaError(
                    "Etapa inválida.", details={"status": ["Etapa inválida."]}
                )
            ideas = ideas.filter(status=etapa)
        if request.query_params.get("mine") in ("1", "true"):
            ideas = ideas.filter(author_id=request.user.pk)
        return Response(
            serializers.lista(serializers.con_conteos(ideas, request.user), request.user)
        )

    def post(self, request):
        datos = self.validated(serializers.IdeaCreateSerializer)
        idea = services.crear_idea(
            actor=request.user,
            title=datos["title"],
            description=datos["description"],
            impact=datos["impact"],
            adjunto=datos.get("attachment"),
            context=self.context,
        )
        return Response(serializers.detalle(idea.pk, request.user), status=status.HTTP_201_CREATED)


class IdeaDetailView(MejoraContinuaView):
    """`GET /mejora-continua/ideas/<id>/`: la idea con su historial, sus votos y
    lo que la persona puede hacer con ella.

    `PATCH /mejora-continua/ideas/<id>/`: solo el avance (`progress`, 0 a 100),
    de quien revisa (`mejora_continua.gestionar`)."""

    def get(self, request, pk):
        services.obtener_visible(request.user, pk)
        return Response(serializers.detalle(pk, request.user))

    def patch(self, request, pk):
        if not access.puede_gestionar(request.user):
            raise MejoraContinuaError(
                "No tiene permiso para actualizar el avance.",
                code="permission_denied",
                status=403,
            )
        services.obtener_visible(request.user, pk)
        datos = self.validated(serializers.ProgresoSerializer)
        services.actualizar_avance(
            actor=request.user, idea_id=pk, progress=datos["progress"], context=self.context
        )
        return Response(serializers.detalle(pk, request.user))


class IdeaStatusView(MejoraContinuaView):
    """`POST` (o `PATCH`, como en Nexo) `/mejora-continua/ideas/<id>/status/`:
    mueve la idea de etapa (`mejora_continua.gestionar`). Cuerpo: `action`
    (ADVANCE, RETREAT, REJECT, REOPEN), `comment` (obligatorio en REJECT) y
    `expected_status` (opcional; si la etapa ya cambió, 409)."""

    def post(self, request, pk):
        if not access.puede_gestionar(request.user):
            # Antes que el 404: quien no revisa no tiene por qué saber si existe.
            raise MejoraContinuaError(
                "No tiene permiso para mover ideas.", code="permission_denied", status=403
            )
        services.obtener_visible(request.user, pk)
        datos = self.validated(serializers.CambioDeEtapaSerializer)
        services.cambiar_etapa(
            actor=request.user,
            idea_id=pk,
            action=datos["action"],
            comment=datos.get("comment"),
            expected_status=datos.get("expected_status"),
            context=self.context,
        )
        return Response(serializers.detalle(pk, request.user))

    def patch(self, request, pk):
        return self.post(request, pk)


class IdeaVoteView(MejoraContinuaView):
    """`/mejora-continua/ideas/<id>/vote/` (`mejora_continua.acceder` y ver la
    idea): `POST` alterna el voto (como en Nexo), `PUT` vota y `DELETE` lo
    quita; los dos últimos son idempotentes (un doble clic no deshace nada).
    Responde `{"vote_count", "voted_by_me"}`."""

    def _votar(self, request, pk, querer):
        idea = services.obtener_visible(request.user, pk)
        total, votado = services.votar(actor=request.user, idea=idea, querer=querer)
        return Response({"vote_count": total, "voted_by_me": votado})

    def post(self, request, pk):
        return self._votar(request, pk, None)

    def put(self, request, pk):
        return self._votar(request, pk, True)

    def delete(self, request, pk):
        return self._votar(request, pk, False)


class IdeaHistoryView(MejoraContinuaView):
    """`GET /mejora-continua/ideas/<id>/history/`: los cambios de etapa, del
    primero al último."""

    def get(self, request, pk):
        idea = services.obtener_visible(request.user, pk)
        entradas = idea.history.select_related("changed_by").order_by("created_at", "id")
        return Response(serializers.historial(entradas))


class IdeaAttachmentView(MejoraContinuaView):
    """`GET /mejora-continua/ideas/<id>/attachment/`: el adjunto, con la misma
    visibilidad que la idea. El PDF y las imágenes se entregan en línea, para
    verlos dentro del sistema; Word y Excel (o cualquiera con `?download=1`),
    como adjunto. El tipo sale de la extensión validada, nunca del navegador."""

    def get(self, request, pk):
        idea = services.obtener_visible(request.user, pk)
        if not idea.attachment:
            raise MejoraContinuaError("La idea no tiene adjunto.", code="not_found", status=404)
        try:
            fichero = idea.attachment.open("rb")
        except FileNotFoundError as error:
            raise Http404("El archivo ya no está disponible en el servidor.") from error
        en_linea = (
            services.visor_de(idea.attachment_mime) is not None
            and request.query_params.get("download") != "1"
        )
        marcar(request, modulo="mejora_continua", idea=idea.pk)
        respuesta = FileResponse(
            fichero, content_type=idea.attachment_mime or "application/octet-stream"
        )
        disposicion = "inline" if en_linea else "attachment"
        nombre = idea.attachment_name or "adjunto"
        respuesta["Content-Disposition"] = f"{disposicion}; filename*=UTF-8''{quote(nombre)}"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta
