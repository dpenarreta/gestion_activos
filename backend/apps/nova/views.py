"""Endpoints de Nova, montados en `/api/v1/nova/` (parte del módulo Gestión
Humana: se apagan con él, ver `apps.empresas.modulos`).

- `GET me/`: qué funciones de Nova tiene la persona y su estado (proveedor
  configurado, aviso de datos aceptado, límite diario y lo usado hoy).
- `GET kpi/<user_id>/`: el análisis de Nova de los KPI de una persona de su
  ámbito (mismas reglas que `analytics/kpis/<user_id>/`: 404 fuera de la
  empresa activa, 403 fuera de su ámbito).
- `GET inicio/`: la frase del inicio de Gestión Humana.
- `POST chat/`: una respuesta del chat (`chat.py`). Cuerpo: `modo`
  («general», «tareas» o «equipo»), `mensaje` e `historial` (los turnos
  anteriores, que guarda solo el navegador). 400 si el mensaje o el
  historial no son válidos; 403 en el modo Equipo sin `nova.chat_equipo` o
  sin equipo.
- `GET/POST conocimiento/documentos/`: la base de conocimiento (listar con
  `?q=`, sin distinguir tildes; subir un PDF, multipart `archivo` y
  `titulo`).
- `DELETE conocimiento/documentos/<id>/`: eliminarlo (archivo y fragmentos).
- `GET conocimiento/documentos/<id>/archivo/`: el PDF, para el visor.
- `GET conocimiento/documentos/<id>/fragmentos/`: el texto extraído, solo
  para quien gestiona la base (en Nexo bastaba con estar autenticado).

La narrativa de los informes no tiene endpoint propio: se genera con el
informe (`apps.informes.services.generar_informe`).

Las de IA responden 200 también sin IA: `con_ia` dice si el texto es de la IA
y `mensaje`/`aviso` por qué no (sin clave, límite, fallo…).
"""

from urllib.parse import quote

from django.db.models import Count
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.analytics import access as kpi_access
from apps.analytics import ajustes
from apps.analytics.errores import AnalyticsError
from apps.core.audit import record_audit_event
from apps.core.busqueda import filtro_de_busqueda
from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import Requiere

from . import access, chat, cliente, conocimiento, inicio, kpi, nucleo
from .models import DocumentoConocimiento

#: El módulo de los eventos de auditoría de Nova.
MODULO_AUDITORIA = "nova"


class _Base(APIView):
    permission_classes = [IsAuthenticated]

    def handle_exception(self, exc):
        if isinstance(exc, AnalyticsError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        return super().handle_exception(exc)


class MeView(_Base):
    def get(self, request):
        user = request.user
        return Response(
            {
                "permisos": [c for c in access.TODOS if user_has_permission(user, c)],
                # El modo Equipo del chat (el permiso y equipo a cargo o verlo).
                "chat_equipo": access.puede_chat_equipo(user),
                "proveedor": cliente.proveedor(),
                **nucleo.estado(user),
            }
        )


class KpiView(_Base):
    permission_classes = [
        IsAuthenticated,
        Requiere(kpi_access.ACCEDER),
        Requiere(access.ANALISIS_KPI),
    ]

    def get(self, request, user_id: int):
        target = ajustes.member_or_404(user_id)
        if not kpi_access.can_view_target(request.user, target):
            return error_response(
                "permission_denied", "No tiene permiso para ver los KPI de esta persona.", 403
            )
        return Response(kpi.analizar(request.user, target))


class InicioView(_Base):
    permission_classes = [IsAuthenticated, Requiere(access.MENSAJE_INICIO)]

    def get(self, request):
        return Response(inicio.mensaje(request.user))


# ── Chat ─────────────────────────────────────────────────────────────────────


class ChatView(_Base):
    permission_classes = [IsAuthenticated, Requiere(access.CHAT)]

    def post(self, request):
        try:
            modo, mensaje, historial = chat.validar(request.data)
        except chat.PedidoInvalido as error:
            return error_response(
                "validation_error", error.mensaje, 400, {error.campo: [error.mensaje]}
            )
        if modo == chat.EQUIPO and not access.puede_chat_equipo(request.user):
            return error_response(
                "permission_denied",
                "El modo Equipo es para quien tiene personas a cargo en el organigrama.",
                403,
            )
        return Response(chat.conversar(request.user, modo, mensaje, historial))


# ── Base de conocimiento ─────────────────────────────────────────────────────


def _documento(documento: DocumentoConocimiento) -> dict:
    subio = documento.subido_por
    return {
        "id": documento.pk,
        "titulo": documento.titulo,
        "nombre_original": documento.nombre_original,
        "tamano_bytes": documento.tamano_bytes,
        "paginas": documento.paginas,
        "fragmentos": getattr(documento, "total_fragmentos", None),
        "subido_por": (subio.get_full_name() or subio.username) if subio else None,
        "creado": documento.created_at.isoformat() if documento.created_at else None,
    }


def _auditar(request, accion: str, documento, **nuevos) -> None:
    record_audit_event(
        actor=request.user,
        action=f"nova.conocimiento.{accion}",
        target_type="DocumentoConocimiento",
        target_id=documento.pk,
        module=MODULO_AUDITORIA,
        new_values={"titulo": documento.titulo, **nuevos},
        context=get_request_context(request),
    )


def _gestiona(user) -> bool:
    return user_has_permission(user, access.CONOCIMIENTO_GESTIONAR)


class DocumentosView(_Base):
    """Listar (ver o gestionar) y subir (gestionar)."""

    permission_classes = [
        IsAuthenticated,
        Requiere(access.CONOCIMIENTO_VER, access.CONOCIMIENTO_GESTIONAR),
    ]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        documentos = filtro_de_busqueda(
            DocumentoConocimiento.objects.select_related("subido_por").annotate(
                total_fragmentos=Count("fragmentos")
            ),
            request.query_params.get("q"),
            ["titulo", "nombre_original"],
        ).order_by("titulo", "pk")
        return Response(
            {
                "resultados": [_documento(d) for d in documentos],
                "gestionar": _gestiona(request.user),
            }
        )

    def post(self, request):
        if not _gestiona(request.user):
            return error_response(
                "permission_denied",
                "No tiene permiso para gestionar la base de conocimiento de Nova.",
                403,
            )
        archivo = request.FILES.get("archivo")
        if archivo is None:
            mensaje = "Elija el documento PDF que quiere subir."
            return error_response("validation_error", mensaje, 400, {"archivo": [mensaje]})
        titulo = str(request.data.get("titulo") or "").strip()
        if len(titulo) > 200:
            mensaje = "El título admite hasta 200 caracteres."
            return error_response("validation_error", mensaje, 400, {"titulo": [mensaje]})
        try:
            documento = conocimiento.crear_documento(archivo, titulo, request.user)
        except conocimiento.DocumentoInvalido as error:
            return error_response(
                "validation_error", error.mensaje, 400, {"archivo": [error.mensaje]}
            )
        documento.total_fragmentos = documento.fragmentos.count()
        _auditar(
            request,
            "subido",
            documento,
            paginas=documento.paginas,
            fragmentos=documento.total_fragmentos,
        )
        return Response(_documento(documento), status=status.HTTP_201_CREATED)


class DocumentoView(_Base):
    permission_classes = [IsAuthenticated, Requiere(access.CONOCIMIENTO_GESTIONAR)]

    def delete(self, request, pk: int):
        documento = get_object_or_404(DocumentoConocimiento, pk=pk)
        _auditar(request, "eliminado", documento)
        documento.borrar_archivo()
        documento.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentoArchivoView(_Base):
    """El PDF para el visor del sistema (lo pide como blob)."""

    permission_classes = [
        IsAuthenticated,
        Requiere(access.CONOCIMIENTO_VER, access.CONOCIMIENTO_GESTIONAR),
    ]

    def get(self, request, pk: int):
        documento = get_object_or_404(DocumentoConocimiento, pk=pk)
        try:
            fichero = documento.archivo.open("rb")
        except FileNotFoundError as error:
            raise Http404("El archivo ya no está disponible en el servidor.") from error
        respuesta = FileResponse(fichero, content_type="application/pdf")
        # Como los demás documentos: el visor lo pide como blob; servido como
        # adjunto y sin adivinar el tipo, el navegador no lo ejecuta solo.
        nombre = quote(documento.nombre_original)
        respuesta["Content-Disposition"] = f"attachment; filename*=UTF-8''{nombre}"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class DocumentoFragmentosView(_Base):
    """El texto extraído de un documento, para revisar que se leyó bien. Solo
    quien gestiona la base (hallazgo de Nexo: bastaba con la sesión)."""

    permission_classes = [IsAuthenticated, Requiere(access.CONOCIMIENTO_GESTIONAR)]

    def get(self, request, pk: int):
        documento = get_object_or_404(DocumentoConocimiento, pk=pk)
        return Response(
            {
                "documento": documento.pk,
                "fragmentos": [
                    {"orden": f.orden, "pagina": f.pagina, "texto": f.texto}
                    for f in documento.fragmentos.order_by("orden")
                ],
            }
        )
