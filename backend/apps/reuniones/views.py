"""Endpoints de Reuniones (`/api/v1/reuniones/`), portados de las rutas
`/api/meetings` de Nexo.

Las vistas solo resuelven parámetros y delegan en `services.py`. Toda vista
exige sesión y algún permiso del módulo (`reuniones.*`); lo que cada acción
pide además (crear, editar, marcar la asistencia) lo comprueba el servicio.
Una reunión que la persona no ve responde 404 (no se revela que existe; Nexo
respondía 403). Los errores salen en el contrato uniforme
`{"error": {"code", "message", "details"}}` (Nexo devolvía `{"error": "..."}`).

La empresa de cada petición la resuelve `X-Empresa` (ver `apps.empresas`). Las
rutas son del módulo Gestión Humana: se apagan con él
(`apps.empresas.modulos`). Las reuniones no se publican en el calendario de
Institucional: solo se ven aquí (decisión del usuario).
"""

from datetime import datetime, time

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.busqueda import filtro_de_busqueda
from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.permissions.permissions import Requiere

from . import access, serializers, services
from .models import Meeting
from .services import ReunionesError

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


def _instante(texto: str | None, campo: str, *, fin_del_dia: bool = False):
    """Un filtro de fecha: ISO-8601 con hora, o solo la fecha (el día entero en
    la hora local). `None` si no viene."""
    if not texto:
        return None
    instante = parse_datetime(texto)
    if instante is None:
        dia = parse_date(texto)
        if dia is None:
            raise ReunionesError(
                "Fecha inválida: use AAAA-MM-DD o una fecha con hora ISO-8601.",
                details={campo: ["Fecha inválida."]},
            )
        instante = datetime.combine(dia, time.max if fin_del_dia else time.min)
    if timezone.is_naive(instante):
        instante = timezone.make_aware(instante)
    return instante


class ReunionesView(APIView):
    permission_classes = [IsAuthenticated, DelModulo]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, ReunionesError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        response = super().handle_exception(exc)
        # Un solo código para los datos inválidos y el primer problema como
        # mensaje: la pantalla lo muestra tal cual.
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


class MeView(ReunionesView):
    """`GET /reuniones/me/`: qué puede hacer la persona y los límites de cada
    campo."""

    def get(self, request):
        return Response(services.resumen_de_acceso(request.user))


class InvitablesView(ReunionesView):
    """`GET /reuniones/invitables/`: a quién se puede invitar (personas activas
    de la empresa con `reuniones.acceder`, sin uno mismo). Solo para quien crea
    o administra reuniones. `?q=` filtra por nombre o usuario."""

    def get(self, request):
        if not access.puede_invitar(request.user):
            raise ReunionesError(
                "No tiene permiso para invitar a reuniones.", code="permission_denied", status=403
            )
        personas = services.invitables(excluir=request.user)
        texto = (request.query_params.get("q") or "").strip()[:100]
        # Palabra por palabra y sin tildes (ver `apps.core.busqueda`).
        personas = filtro_de_busqueda(personas, texto, ("first_name", "last_name", "username"))
        return Response(serializers.personas(personas))


class MeetingListCreateView(ReunionesView):
    """`GET /reuniones/meetings/`: las reuniones que organiza o a las que lo
    invitaron, por fecha. Filtros opcionales: `from` y `to` (AAAA-MM-DD o
    ISO-8601, para el calendario), `status`, `scope=all` (todas las de la
    empresa, con `reuniones.administrar`) y `scope=hosted` (solo las que
    organiza).

    `POST /reuniones/meetings/`: programa una reunión (`reuniones.crear`). JSON
    con `title`, `meeting_date`, `duration`, y opcionales `description`,
    `join_url` (https), `join_password` e `invitee_ids`."""

    def get(self, request):
        params = request.query_params
        alcance = params.get("scope") or ""
        if alcance not in ("", "all", "hosted"):
            raise ReunionesError("Alcance inválido.", details={"scope": ["Use all o hosted."]})
        if alcance == "all" and not access.administra(request.user):
            raise ReunionesError(
                "No tiene permiso para ver todas las reuniones.",
                code="permission_denied",
                status=403,
            )
        reuniones = access.reuniones_visibles(request.user, todas=alcance == "all")
        if alcance == "hosted":
            reuniones = reuniones.filter(host_id=request.user.pk)
        desde = _instante(params.get("from"), "from")
        hasta = _instante(params.get("to"), "to", fin_del_dia=True)
        if desde and hasta and hasta < desde:
            raise ReunionesError(
                "El rango de fechas está invertido.", details={"to": ["Debe ser posterior a from."]}
            )
        if desde:
            reuniones = reuniones.filter(meeting_date__gte=desde)
        if hasta:
            reuniones = reuniones.filter(meeting_date__lte=hasta)
        estado = params.get("status")
        if estado:
            if estado not in Meeting.Status.values:
                raise ReunionesError("Estado inválido.", details={"status": ["Estado inválido."]})
            reuniones = reuniones.filter(status=estado)
        return Response(serializers.lista(reuniones.order_by("meeting_date", "id"), request.user))

    def post(self, request):
        datos = self.validated(serializers.MeetingCreateSerializer)
        meeting = services.crear_reunion(actor=request.user, context=self.context, **datos)
        return Response(
            serializers.detalle(meeting.pk, request.user), status=status.HTTP_201_CREATED
        )


class MeetingDetailView(ReunionesView):
    """`GET /reuniones/meetings/<id>/`: la reunión con sus invitados y su
    asistencia (anfitrión o invitado; o quien administra).

    `PATCH /reuniones/meetings/<id>/`: la edita (anfitrión o quien administra):
    cualquier campo de la creación más `status`, `otter_invited`,
    `otter_summary` y `otter_transcript_url` (https). `invitee_ids` es la lista
    completa de invitados.

    `DELETE /reuniones/meetings/<id>/`: la elimina (baja lógica) y avisa a los
    invitados."""

    def get(self, request, pk):
        services.obtener_visible(request.user, pk)
        return Response(serializers.detalle(pk, request.user))

    def patch(self, request, pk):
        datos = self.validated(serializers.MeetingUpdateSerializer)
        services.editar_reunion(
            actor=request.user, meeting_id=pk, cambios=datos, context=self.context
        )
        return Response(serializers.detalle(pk, request.user))

    def delete(self, request, pk):
        services.eliminar_reunion(actor=request.user, meeting_id=pk, context=self.context)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeetingAttendanceView(ReunionesView):
    """`POST /reuniones/meetings/<id>/attendance/`: marca la asistencia
    (anfitrión o quien administra). Cuerpo:
    `{"attendance": [{"user_id": 7, "attended": true}, ...]}`. Responde la
    reunión."""

    def post(self, request, pk):
        datos = self.validated(serializers.AsistenciaSerializer)
        services.marcar_asistencia(
            actor=request.user, meeting_id=pk, marcas=datos["attendance"], context=self.context
        )
        return Response(serializers.detalle(pk, request.user))
