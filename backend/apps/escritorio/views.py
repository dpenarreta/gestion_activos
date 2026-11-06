"""Endpoints del Escritorio (`/api/v1/escritorio/`), portados de las rutas
`/api/desk-notes`, `/api/desk-reminders` y `/api/desk` de Nexo.

Las vistas solo resuelven parámetros y delegan en `services.py`. Toda vista
exige sesión y `escritorio.acceder`. Lo ajeno responde 404 (no se revela que
existe): una nota en que la persona no participa o un recordatorio de otro.
Lo que es de la otra parte de una nota (leerla, fijarla, archivarla, que son
del destinatario) responde 403. Los errores salen en el contrato uniforme
`{"error": {"code", "message", "details"}}` (Nexo devolvía `{"error": "..."}`).

La empresa de cada petición la resuelve `X-Empresa` (ver `apps.empresas`). Las
rutas son del módulo Gestión Humana: se apagan con él
(`apps.empresas.modulos`).
"""

from urllib.parse import quote

from django.http import FileResponse, Http404
from django.utils.dateparse import parse_date
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
from .models import DeskAuditLog, PersonalReminder
from .services import EscritorioError

DelModulo = Requiere(*access.ALL_CODENAMES)

#: Lo que se ve en cada pestaña de notas (`view` de Nexo, más `pinned`).
VISTAS_DE_NOTAS = ("desk", "pinned", "archive", "sent")


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


def _limite(texto: str | None, maximo: int) -> int | None:
    if not texto:
        return None
    try:
        return max(1, min(maximo, int(texto)))
    except ValueError as exc:
        raise EscritorioError(
            "El límite tiene que ser un número.", details={"limit": ["Número inválido."]}
        ) from exc


def _instante(texto: str | None, campo: str):
    """Un filtro de fecha con hora ISO-8601 (o solo la fecha, a medianoche)."""
    from datetime import datetime, time

    from django.utils import timezone
    from django.utils.dateparse import parse_datetime

    if not texto:
        return None
    instante = parse_datetime(texto)
    if instante is None:
        dia = parse_date(texto)
        if dia is None:
            raise EscritorioError("Fecha inválida.", details={campo: ["Fecha inválida."]})
        instante = datetime.combine(dia, time.min)
    if timezone.is_naive(instante):
        instante = timezone.make_aware(instante)
    return instante


def _servir(request, objeto, *, referencia: dict):
    """El adjunto de una nota o de un recordatorio. El PDF y las imágenes se
    entregan en línea, para verlos dentro del sistema; Word y Excel (o
    cualquiera con `?download=1`), como adjunto. El tipo sale de la extensión
    validada, nunca del navegador."""
    if not objeto.attachment:
        raise EscritorioError("No tiene adjunto.", code="not_found", status=404)
    try:
        fichero = objeto.attachment.open("rb")
    except FileNotFoundError as error:
        raise Http404("El archivo ya no está disponible en el servidor.") from error
    en_linea = (
        services.visor_de(objeto.attachment_mime) is not None
        and request.query_params.get("download") != "1"
    )
    # Sin copia en la auditoría de descargas: es una nota entre dos personas
    # o la agenda de una, no un documento de la empresa.
    marcar(request, modulo="escritorio", sin_copia="Adjunto personal del Escritorio", **referencia)
    respuesta = FileResponse(
        fichero, content_type=objeto.attachment_mime or "application/octet-stream"
    )
    disposicion = "inline" if en_linea else "attachment"
    nombre = objeto.attachment_name or "adjunto"
    respuesta["Content-Disposition"] = f"{disposicion}; filename*=UTF-8''{quote(nombre)}"
    respuesta["X-Content-Type-Options"] = "nosniff"
    return respuesta


class EscritorioView(APIView):
    permission_classes = [IsAuthenticated, DelModulo]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, EscritorioError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        response = super().handle_exception(exc)
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            error = response.data.get("error")
            if isinstance(error, dict):
                error["code"] = "validation_error"
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response

    def validated(self, serializer_class, data=None):
        serializer = serializer_class(data=self.request.data if data is None else data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class MeView(EscritorioView):
    """`GET /escritorio/me/`: permisos, ajustes del módulo (respuestas por
    nota, retenciones, atajos de posponer), adjuntos aceptados, opciones con su
    etiqueta y cuántas notas tiene sin leer."""

    def get(self, request):
        return Response(services.resumen_de_acceso(request.user))


# ── Notas ─────────────────────────────────────────────────────────────────────


class NoteListCreateView(EscritorioView):
    """`GET /escritorio/notes/?view=desk|pinned|archive|sent&limit=N`: las
    notas recibidas sin archivar (`desk`, por defecto), las fijadas
    (`pinned`), las archivadas (`archive`) o las enviadas (`sent`); fijadas
    primero y de la más nueva a la más antigua. `limit` hasta 100.

    `POST /escritorio/notes/`: deja una nota. Multipart con `recipient`,
    `message`, `priority`, `color` y `attachment` opcional; o JSON sin adjunto."""

    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        vista = request.query_params.get("view") or "desk"
        if vista not in VISTAS_DE_NOTAS:
            raise EscritorioError(
                "Vista inválida.", details={"view": ["Use desk, pinned, archive o sent."]}
            )
        base = services.notas_vigentes()
        if vista == "sent":
            consulta = base.filter(sender_id=request.user.pk)
        elif vista == "archive":
            consulta = base.filter(recipient_id=request.user.pk, archived=True)
        else:
            consulta = base.filter(recipient_id=request.user.pk, archived=False)
            if vista == "pinned":
                consulta = consulta.filter(pinned=True)
        consulta = serializers.con_respuestas(consulta).order_by("-pinned", "-created_at", "-id")
        limite = _limite(request.query_params.get("limit"), 100)
        if limite:
            consulta = consulta[:limite]
        return Response(serializers.notas(consulta, request.user))

    def post(self, request):
        datos = self.validated(serializers.NotaCreateSerializer)
        nota = services.crear_nota(
            actor=request.user,
            recipient_id=datos["recipient"],
            message=datos["message"],
            priority=datos["priority"],
            color=datos["color"],
            adjunto_=datos.get("attachment"),
        )
        return Response(serializers.nota(nota, request.user), status=status.HTTP_201_CREATED)


class RecipientsView(EscritorioView):
    """`GET /escritorio/notes/recipients/`: a quién puede dejar una nota
    (personas activas de la empresa con `escritorio.acceder`, sin uno mismo)."""

    def get(self, request):
        return Response(serializers.destinatarios(access.destinatarios(request.user)))


class UnreadCountView(EscritorioView):
    """`GET /escritorio/notes/unread-count/`: `{"unread": n}` para el globo del
    menú."""

    def get(self, request):
        return Response({"unread": services.notas_sin_leer(request.user)})


class NoteDetailView(EscritorioView):
    """`GET /escritorio/notes/<id>/`: la nota (remitente o destinatario).

    `PATCH /escritorio/notes/<id>/`: `{"action": "read|pin|unpin|archive|unarchive"}`,
    solo el destinatario. Responde la nota.

    `DELETE /escritorio/notes/<id>/`: el remitente la manda a la papelera; el
    destinatario la elimina definitivamente si ya está archivada (409 si no)."""

    def get(self, request, pk):
        nota = services.obtener_nota(request.user, pk)
        return Response(serializers.nota(nota, request.user))

    def patch(self, request, pk):
        datos = self.validated(serializers.AccionDeNotaSerializer)
        nota = services.accion_de_nota(actor=request.user, pk=pk, action=datos["action"])
        return Response(serializers.nota(nota, request.user))

    def delete(self, request, pk):
        services.eliminar_nota(actor=request.user, pk=pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class NoteRepliesView(EscritorioView):
    """`GET /escritorio/notes/<id>/replies/`: las respuestas, en orden.
    `POST`: responde (`{"message"}`); 409 al llegar al tope por nota."""

    def get(self, request, pk):
        nota = services.obtener_nota(request.user, pk)
        return Response(serializers.respuestas(nota.replies.select_related("author")))

    def post(self, request, pk):
        services.obtener_nota(request.user, pk)
        datos = self.validated(serializers.RespuestaSerializer)
        respuesta = services.responder(actor=request.user, pk=pk, message=datos["message"])
        return Response(serializers.respuestas([respuesta])[0], status=status.HTTP_201_CREATED)


class NoteHistoryView(EscritorioView):
    """`GET /escritorio/notes/<id>/history/`: la bitácora de la nota."""

    def get(self, request, pk):
        nota = services.obtener_nota(request.user, pk)
        eventos = DeskAuditLog.objects.filter(
            entity_type=services.NOTA, entity_id=nota.pk
        ).select_related("user")
        return Response(serializers.bitacora(eventos))


class NoteAttachmentView(EscritorioView):
    """`GET /escritorio/notes/<id>/attachment/`: el adjunto, para el remitente
    y el destinatario."""

    def get(self, request, pk):
        nota = services.obtener_nota(request.user, pk)
        return _servir(request, nota, referencia={"nota": nota.pk})


class NoteToReminderView(EscritorioView):
    """`POST /escritorio/notes/<id>/convert-to-reminder/`: solo el
    destinatario, una vez (409). Cuerpo: `due_at` y, opcionales, `title` y
    `priority`. Responde `{"reminder_id", "reminder_title", "reminder"}`."""

    def post(self, request, pk):
        services.obtener_nota(request.user, pk)
        datos = self.validated(serializers.NotaARecordatorioSerializer)
        recordatorio = services.convertir_en_recordatorio(actor=request.user, pk=pk, **datos)
        return Response(
            {
                "reminder_id": recordatorio.pk,
                "reminder_title": recordatorio.title,
                "reminder": serializers.recordatorio(recordatorio),
            },
            status=status.HTTP_201_CREATED,
        )


# ── Recordatorios ─────────────────────────────────────────────────────────────


class ReminderListCreateView(EscritorioView):
    """`GET /escritorio/reminders/`: los recordatorios propios, por
    vencimiento. Filtros: `archived=true` (los archivados; por defecto, los no
    archivados), `status=PENDIENTE|COMPLETADO`, `from` y `to` (ISO-8601, para el
    calendario) y `limit` (hasta 200). Antes de leer avisa los vencidos de la
    persona (como en Nexo), además del ciclo programado.

    `POST /escritorio/reminders/`: `title`, `due_at` y, opcionales,
    `description`, `priority` y `repeat`."""

    def get(self, request):
        services.avisar_vencidos(user=request.user)
        params = request.query_params
        consulta = services.recordatorios_de(request.user).filter(
            archived=params.get("archived") == "true"
        )
        estado = params.get("status")
        if estado:
            if estado not in PersonalReminder.Status.values:
                raise EscritorioError("Estado inválido.", details={"status": ["Estado inválido."]})
            consulta = consulta.filter(status=estado)
        desde, hasta = _instante(params.get("from"), "from"), _instante(params.get("to"), "to")
        if desde:
            consulta = consulta.filter(due_at__gte=desde)
        if hasta:
            consulta = consulta.filter(due_at__lte=hasta)
        consulta = consulta.order_by("due_at", "id")
        limite = _limite(params.get("limit"), services.LISTA_MAX)
        if limite:
            consulta = consulta[:limite]
        return Response([serializers.recordatorio(r) for r in consulta])

    def post(self, request):
        datos = self.validated(serializers.RecordatorioCreateSerializer)
        recordatorio = services.crear_recordatorio(actor=request.user, **datos)
        return Response(serializers.recordatorio(recordatorio), status=status.HTTP_201_CREATED)


class ReminderDetailView(EscritorioView):
    """`GET /escritorio/reminders/<id>/`.

    `PATCH /escritorio/reminders/<id>/`: con `action` (`complete`, `postpone`
    con `due_at`, `reopen` con `due_at` opcional, `archive`, `unarchive`) o, sin
    ella, la edición de `title`, `description`, `due_at`, `priority` y `repeat`.
    Completar uno ya completado o reabrir uno pendiente: 409.

    `DELETE /escritorio/reminders/<id>/`."""

    def get(self, request, pk):
        return Response(serializers.recordatorio(services.obtener_recordatorio(request.user, pk)))

    def patch(self, request, pk):
        services.obtener_recordatorio(request.user, pk)
        if "action" in request.data:
            datos = self.validated(serializers.AccionDeRecordatorioSerializer)
            recordatorio = services.accion_de_recordatorio(
                actor=request.user, pk=pk, action=datos["action"], due_at=datos.get("due_at")
            )
        else:
            serializer = serializers.RecordatorioUpdateSerializer(data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            recordatorio = services.editar_recordatorio(
                actor=request.user, pk=pk, cambios=dict(serializer.validated_data)
            )
        return Response(serializers.recordatorio(recordatorio))

    def delete(self, request, pk):
        services.eliminar_recordatorio(actor=request.user, pk=pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReminderHistoryView(EscritorioView):
    """`GET /escritorio/reminders/<id>/history/`: la bitácora del recordatorio."""

    def get(self, request, pk):
        recordatorio = services.obtener_recordatorio(request.user, pk)
        eventos = DeskAuditLog.objects.filter(
            entity_type=services.RECORDATORIO, entity_id=recordatorio.pk
        ).select_related("user")
        return Response(serializers.bitacora(eventos))


class ReminderAttachmentView(EscritorioView):
    """`GET /escritorio/reminders/<id>/attachment/`: el adjunto que trajo de su
    nota (solo el dueño)."""

    def get(self, request, pk):
        recordatorio = services.obtener_recordatorio(request.user, pk)
        return _servir(request, recordatorio, referencia={"recordatorio": recordatorio.pk})


class ReminderToTaskView(EscritorioView):
    """`POST /escritorio/reminders/<id>/convert-to-task/` (pide además
    `tareas.acceder`): `start_date`, `end_date`, `estimated_hours` y,
    opcionales, `title`, `type` y `frequency`. Una vez (409). Responde
    `{"task_id", "task_title"}`."""

    def post(self, request, pk):
        services.obtener_recordatorio(request.user, pk)
        datos = self.validated(serializers.RecordatorioATareaSerializer)
        tarea = services.convertir_en_tarea(
            actor=request.user, pk=pk, context=self.context, **datos
        )
        return Response(
            {"task_id": tarea.pk, "task_title": tarea.title}, status=status.HTTP_201_CREATED
        )


# ── Hoy y el buscador ─────────────────────────────────────────────────────────


class TodayView(EscritorioView):
    """`GET /escritorio/today/`: la bandeja «Hoy» (ver `services.hoy`)."""

    def get(self, request):
        services.avisar_vencidos(user=request.user)
        return Response(serializers.bandeja_de_hoy(services.hoy(request.user)))


class SearchView(EscritorioView):
    """`GET /escritorio/search/`: `q`, `priority`, `date` (AAAA-MM-DD),
    `sender`, `recipient` y `status` (PENDIENTE, LEIDA, ARCHIVADA o
    COMPLETADO). Hasta 50 notas y 50 recordatorios."""

    def get(self, request):
        params = request.query_params
        dia = None
        if params.get("date"):
            dia = parse_date(params["date"])
            if dia is None:
                raise EscritorioError(
                    "Fecha inválida: use AAAA-MM-DD.", details={"date": ["Fecha inválida."]}
                )
        resultado = services.buscar(
            request.user,
            q=(params.get("q") or "").strip()[:200],
            priority=params.get("priority") or "",
            dia=dia,
            sender=(params.get("sender") or "").strip()[:100],
            recipient=(params.get("recipient") or "").strip()[:100],
            status=params.get("status") or "",
        )
        return Response(serializers.resultados_de_busqueda(resultado, request.user))
