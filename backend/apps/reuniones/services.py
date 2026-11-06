"""Lógica de negocio de Reuniones, portada de Nexo (`apps.meetings.services` y
las reglas que allá vivían en las vistas).

Se conserva de Nexo:

- Quien tiene `reuniones.crear` programa una reunión con título, descripción,
  fecha, duración e invitados; el anfitrión nunca queda como invitado de su
  propia reunión.
- Solo el anfitrión la edita y la elimina (aquí también quien administra el
  módulo, ver `access`). El estado (PROGRAMADA, EN_CURSO, FINALIZADA) lo cambia
  él a mano: Nexo no lo movía por la hora, y la pantalla lo ofrecía como tres
  botones.
- El resumen y el enlace a la transcripción (los campos de Otter) los escribe
  el anfitrión a mano al terminar.
- A los invitados les llega el aviso de la invitación.

Lo que cambia, documentado donde ocurre:

1. **Sin Zoom** (decisión del usuario): el enlace y la clave los pega quien
   organiza. El enlace tiene que ser `https://` (`validar_enlace`), igual que el
   de la transcripción: la pantalla los abre en otra pestaña y un `javascript:`
   o un `http://` no deben llegar ahí.
2. **Invitados**: en Nexo se elegían de toda la lista de usuarios. Aquí, de las
   personas activas de la empresa activa con `reuniones.acceder`: invitar a
   quien no puede abrir la reunión no le sirve de nada (`invitables`). Y se
   pueden cambiar al editar (Nexo solo los fijaba al crear): a quien se suma le
   llega la invitación.
3. **Avisos nuevos**: si cambia la fecha, la duración o el enlace, a los
   invitados les llega el aviso; si se elimina, el de la cancelación. En Nexo
   un invitado se enteraba solo si volvía a abrir la reunión.
4. **Asistencia**: el anfitrión la marca (`marcar_asistencia`).
5. **Baja lógica y auditoría común** (`record_audit_event`, módulo
   `reuniones`): crear, editar, eliminar y la asistencia. La clave de la
   reunión nunca va a la auditoría: solo si cambió.
6. **Concurrencia**: la fila se bloquea mientras se edita; dos ediciones a la
   vez no pisan los invitados de la otra.

Las vistas solo resuelven parámetros y delegan aquí.
"""

from datetime import timedelta
from urllib.parse import urlsplit

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.tasks.roles import gh_role_of, in_active_company, role_label

from . import access
from .models import URL_MAX, Meeting, MeetingInvitee

User = get_user_model()
Status = Meeting.Status

AUDIT_MODULE = "reuniones"

TITULO_MAX = 255
DESCRIPCION_MAX = 5000
RESUMEN_MAX = 20000
CLAVE_MAX = 50
#: Un día. En Nexo no había tope (y la pantalla ofrecía 30 o 40 minutos, por el
#: plan gratuito de Zoom, que aquí ya no aplica).
DURACION_MAX = 24 * 60
#: Invitados por reunión: más que el equipo de Gestión Humana entero.
INVITADOS_MAX = 200

#: Adónde llevan los avisos de la campana (ruta del frontend).
ENLACE_REUNION = "/admin/gestion-humana/reuniones"
AVISO_MAX = 300

TITULOS_DE_AVISO = {
    "invitacion": "Reuniones: lo invitaron a una reunión",
    "cambio": "Reuniones: una reunión cambió",
    "cancelada": "Reuniones: una reunión se canceló",
}

#: Lo que cambia para el invitado (y por eso se le avisa).
CAMPOS_QUE_SE_AVISAN = ("meeting_date", "duration", "join_url")

#: Momento de la reunión respecto de ahora, calculado al leer (`momento`). No
#: es el estado: ese lo maneja el anfitrión, como en Nexo. Sirve a la pantalla
#: para separar las próximas de las pasadas sin repetir la cuenta.
PROXIMA = "UPCOMING"
EN_HORARIO = "IN_PROGRESS"
PASADA = "PAST"


class ReunionesError(Exception):
    """Error de negocio controlado: la vista lo traduce al contrato de error
    uniforme (`{"error": {"code", "message", "details"}}`)."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "validation_error",
        status: int = 400,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details


def _invalido(campo: str, mensaje: str) -> ReunionesError:
    return ReunionesError(mensaje, details={campo: [mensaje]})


def _prohibido(mensaje: str) -> ReunionesError:
    return ReunionesError(mensaje, code="permission_denied", status=403)


def _no_encontrada() -> ReunionesError:
    return ReunionesError("Reunión no encontrada.", code="not_found", status=404)


def nombre_corto(user) -> str:
    """El nombre corto de Nexo (`first_name or username`) para los avisos."""
    return (user.first_name or "").strip() or user.username


# ── Validaciones ──────────────────────────────────────────────────────────────


def validar_enlace(valor: str | None, campo: str) -> str | None:
    """Un enlace pegado a mano: vacío (`None`) o una dirección `https://` con
    servidor, sin espacios y sin usuario ni contraseña incrustados. Devuelve el
    enlace limpio."""
    texto = (valor or "").strip()
    if not texto:
        return None
    if len(texto) > URL_MAX:
        raise _invalido(campo, f"El enlace no puede pasar de {URL_MAX} caracteres.")
    mensaje = "El enlace tiene que empezar con https:// (cópielo completo desde la invitación)."
    if any(c.isspace() for c in texto):
        raise _invalido(campo, "El enlace no puede tener espacios.")
    try:
        partes = urlsplit(texto)
    except ValueError as exc:
        raise _invalido(campo, mensaje) from exc
    if partes.scheme.lower() != "https" or not partes.hostname:
        raise _invalido(campo, mensaje)
    if partes.username or partes.password:
        raise _invalido(campo, "El enlace no puede llevar usuario ni contraseña.")
    return texto


def momento(meeting: Meeting, ahora=None) -> str:
    """Si la reunión es próxima, está en su horario o ya pasó (por la hora, no
    por su estado)."""
    ahora = ahora or timezone.now()
    fin = meeting.meeting_date + timedelta(minutes=meeting.duration or 0)
    if ahora < meeting.meeting_date:
        return PROXIMA
    if ahora < fin:
        return EN_HORARIO
    return PASADA


# ── Personas ──────────────────────────────────────────────────────────────────


def invitables(*, excluir=None):
    """Las personas que se pueden invitar en la empresa activa: activas, de la
    empresa y con `reuniones.acceder` (por rol global, de su membresía o
    directo). `excluir` es el anfitrión."""
    from apps.novedades.access import permission_filter

    personas = (
        User.objects.filter(is_active=True)
        .filter(in_active_company())
        .filter(pk__in=User.objects.filter(permission_filter(access.ACCEDER)).values("pk"))
    )
    if excluir is not None:
        personas = personas.exclude(pk=excluir.pk)
    return personas.order_by("first_name", "last_name", "username")


def describir_personas(personas) -> dict[int, dict]:
    """La referencia de cada persona que sale en una respuesta: id, nombres y
    su rol de Gestión Humana. Sin el correo: la pantalla no lo necesita."""
    unicas = {p.pk: p for p in personas if p is not None}
    resultado = {}
    for pk, persona in unicas.items():
        rol = gh_role_of(persona)
        resultado[pk] = {
            "id": pk,
            "username": persona.username,
            "first_name": persona.first_name,
            "last_name": persona.last_name,
            "name": nombre_corto(persona),
            "full_name": (persona.get_full_name() or "").strip() or persona.username,
            "role": rol or None,
            "role_label": role_label(rol) if rol else None,
        }
    return resultado


def _resolver_invitados(ids, anfitrion) -> list:
    """Las personas de `ids` (sin repetir y sin el anfitrión), todas
    invitables. Si alguna no lo es, 400 con cuáles: no se invita a medias."""
    unicos = []
    for pk in ids or []:
        if pk != anfitrion.pk and pk not in unicos:
            unicos.append(pk)
    if len(unicos) > INVITADOS_MAX:
        raise _invalido("invitee_ids", f"Una reunión admite hasta {INVITADOS_MAX} invitados.")
    if not unicos:
        return []
    encontrados = {u.pk: u for u in invitables(excluir=anfitrion).filter(pk__in=unicos)}
    fuera = [pk for pk in unicos if pk not in encontrados]
    if fuera:
        raise ReunionesError(
            "Hay invitados que no tienen acceso a Reuniones en esta empresa.",
            details={"invitee_ids": [f"No se puede invitar a la persona #{pk}." for pk in fuera]},
        )
    return [encontrados[pk] for pk in unicos]


# ── Lectura ───────────────────────────────────────────────────────────────────


def obtener_visible(actor, pk) -> Meeting:
    """La reunión si existe en la empresa activa, no está eliminada y la
    persona la ve; si no, 404 (no se revela que existe)."""
    meeting = access.vigentes().select_related("host").filter(pk=pk).first()
    if meeting is None or not access.puede_ver(actor, meeting):
        raise _no_encontrada()
    return meeting


def resumen_de_acceso(user) -> dict:
    """`GET /reuniones/me/`: qué puede hacer la persona."""
    return {
        "user_id": user.pk,
        "permissions": access.effective_codenames(user),
        "can_create": access.puede_crear(user),
        "can_manage": access.administra(user),
        "statuses": [{"value": v, "label": label} for v, label in Status.choices],
        "limits": {
            "title": TITULO_MAX,
            "description": DESCRIPCION_MAX,
            "summary": RESUMEN_MAX,
            "password": CLAVE_MAX,
            "url": URL_MAX,
            "duration_max": DURACION_MAX,
            "invitees_max": INVITADOS_MAX,
        },
    }


# ── Avisos y auditoría ────────────────────────────────────────────────────────


def _avisar(destinatarios, *, categoria: str, resumen: str, meeting: Meeting, actor):
    """Aviso en la campana, después de confirmar: si la campana falla, la
    operación no se revierte. Nunca a quien actuó."""
    personas = [u for u in destinatarios if u is not None and u.pk != actor.pk]
    if not personas:
        return
    empresa = meeting.empresa
    enlace = ENLACE_REUNION if categoria == "cancelada" else f"{ENLACE_REUNION}/{meeting.pk}"
    texto = resumen if len(resumen) <= AVISO_MAX else resumen[: AVISO_MAX - 1] + "…"

    def enviar():
        from apps.notificaciones.services import notificar

        notificar(
            personas,
            tipo=f"reuniones.{categoria}",
            titulo=TITULOS_DE_AVISO[categoria],
            resumen=texto,
            enlace=enlace,
            empresa=empresa,
        )

    transaction.on_commit(enviar)


def _fecha_legible(instante) -> str:
    local = timezone.localtime(instante)
    return local.strftime("%d/%m/%Y %H:%M")


def _para_auditoria(meeting: Meeting) -> dict:
    """Lo que se guarda de la reunión en la auditoría: sin la clave."""
    return {
        "title": meeting.title,
        "meeting_date": meeting.meeting_date.isoformat() if meeting.meeting_date else None,
        "duration": meeting.duration,
        "status": meeting.status,
        "join_url": meeting.join_url,
        "otter_invited": meeting.otter_invited,
        "otter_transcript_url": meeting.otter_transcript_url,
    }


def _audit(actor, accion: str, meeting: Meeting, *, previo=None, nuevo=None, context=None):
    record_audit_event(
        actor=actor,
        action=f"reuniones.{accion}",
        target=meeting,
        module=AUDIT_MODULE,
        previous_values=previo,
        new_values=nuevo,
        context=context,
    )


# ── Escritura ─────────────────────────────────────────────────────────────────


def crear_reunion(
    *,
    actor,
    title: str,
    meeting_date,
    duration: int,
    description: str | None = None,
    join_url: str | None = None,
    join_password: str | None = None,
    invitee_ids=(),
    context=None,
) -> Meeting:
    """Réplica de `POST /api/meetings` sin Zoom: crea la reunión con el enlace
    que trae quien organiza y avisa a los invitados."""
    if not access.puede_crear(actor):
        raise _prohibido("No tiene permiso para crear reuniones.")
    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        raise ReunionesError("No hay una empresa activa.", code="sin_empresa")
    enlace = validar_enlace(join_url, "join_url")
    invitados = _resolver_invitados(invitee_ids, actor)

    with transaction.atomic():
        meeting = Meeting.objects.create(
            empresa=empresa,
            title=title,
            description=description or None,
            host=actor,
            meeting_date=meeting_date,
            duration=duration,
            join_url=enlace,
            join_password=(join_password or "").strip() or None,
        )
        MeetingInvitee.objects.bulk_create(
            [MeetingInvitee(meeting=meeting, user=persona) for persona in invitados]
        )
        nuevo = _para_auditoria(meeting)
        nuevo["invitees"] = [p.pk for p in invitados]
        nuevo["con_clave"] = bool(meeting.join_password)
        _audit(actor, "creada", meeting, nuevo=nuevo, context=context)
        _avisar(
            invitados,
            categoria="invitacion",
            resumen=(
                f"{nombre_corto(actor)} lo invitó a «{meeting.title}» "
                f"el {_fecha_legible(meeting.meeting_date)}"
            ),
            meeting=meeting,
            actor=actor,
        )
    return meeting


#: Campos que se editan tal cual (los enlaces y los invitados van aparte).
CAMPOS_EDITABLES = (
    "title",
    "description",
    "meeting_date",
    "duration",
    "status",
    "otter_invited",
    "otter_summary",
    "join_password",
)


def editar_reunion(*, actor, meeting_id, cambios: dict, context=None) -> Meeting:
    """Réplica de `PATCH /api/meetings/[id]`, del anfitrión (o de quien
    administra el módulo). `cambios` trae solo lo que se manda; `invitee_ids`,
    si viene, es la lista completa de invitados (se agregan los nuevos, se
    quitan los que faltan y los que siguen conservan su asistencia)."""
    with transaction.atomic():
        # Sin `select_related`: el bloqueo es solo de la fila de la reunión.
        meeting = access.vigentes().select_for_update().filter(pk=meeting_id).first()
        if meeting is None or not access.puede_ver(actor, meeting):
            raise _no_encontrada()
        if not access.puede_editar(actor, meeting):
            raise _prohibido("Solo el anfitrión puede editar la reunión.")

        previo = _para_auditoria(meeting)
        clave_previa = meeting.join_password
        datos = dict(cambios)
        if "join_url" in datos:
            datos["join_url"] = validar_enlace(datos["join_url"], "join_url")
        if "otter_transcript_url" in datos:
            datos["otter_transcript_url"] = validar_enlace(
                datos["otter_transcript_url"], "otter_transcript_url"
            )
        for campo in ("description", "otter_summary", "join_password"):
            if campo in datos:
                datos[campo] = (datos[campo] or "").strip() or None

        cambiados = []
        for campo in (*CAMPOS_EDITABLES, "join_url", "otter_transcript_url"):
            if campo in datos and getattr(meeting, campo) != datos[campo]:
                setattr(meeting, campo, datos[campo])
                cambiados.append(campo)

        actuales = {i.user_id: i for i in meeting.invitees.select_related("user")}
        nuevos, quitados = [], []
        if "invitee_ids" in datos:
            deseados = _resolver_invitados(datos["invitee_ids"], meeting.host)
            ids_deseados = {p.pk for p in deseados}
            nuevos = [p for p in deseados if p.pk not in actuales]
            quitados = [uid for uid in actuales if uid not in ids_deseados]
            if quitados:
                meeting.invitees.filter(user_id__in=quitados).delete()
            MeetingInvitee.objects.bulk_create(
                [MeetingInvitee(meeting=meeting, user=persona) for persona in nuevos]
            )

        if not cambiados and not nuevos and not quitados:
            return meeting

        meeting.save()
        nuevo = {c: v for c, v in _para_auditoria(meeting).items() if c in cambiados}
        anterior = {c: v for c, v in previo.items() if c in cambiados}
        if "join_password" in cambiados:
            # Nunca la clave: solo que cambió.
            nuevo["clave_cambiada"] = True
            anterior["tenia_clave"] = bool(clave_previa)
        if "otter_summary" in cambiados:
            nuevo["otter_summary_changed"] = True
        if nuevos or quitados:
            nuevo["invitees_added"] = [p.pk for p in nuevos]
            nuevo["invitees_removed"] = quitados
        _audit(actor, "editada", meeting, previo=anterior, nuevo=nuevo, context=context)

        if nuevos:
            _avisar(
                nuevos,
                categoria="invitacion",
                resumen=(
                    f"{nombre_corto(actor)} lo invitó a «{meeting.title}» "
                    f"el {_fecha_legible(meeting.meeting_date)}"
                ),
                meeting=meeting,
                actor=actor,
            )
        if set(cambiados) & set(CAMPOS_QUE_SE_AVISAN):
            siguen = [i.user for uid, i in actuales.items() if uid not in quitados]
            # Si quien edita no es el anfitrión, el anfitrión también se entera.
            if meeting.host_id != actor.pk:
                siguen.append(meeting.host)
            _avisar(
                siguen,
                categoria="cambio",
                resumen=(
                    f"La reunión «{meeting.title}» cambió: ahora es el "
                    f"{_fecha_legible(meeting.meeting_date)} ({meeting.duration} min). "
                    "Revise el enlace."
                    if "join_url" in cambiados
                    else f"La reunión «{meeting.title}» cambió: ahora es el "
                    f"{_fecha_legible(meeting.meeting_date)} ({meeting.duration} min)."
                ),
                meeting=meeting,
                actor=actor,
            )
    return meeting


def eliminar_reunion(*, actor, meeting_id, context=None) -> None:
    """Réplica de `DELETE /api/meetings/[id]` con baja lógica: deja de verse,
    queda en la auditoría y a los invitados les llega la cancelación. Eliminar
    una ya eliminada responde 404 (no hay nada que hacer dos veces)."""
    with transaction.atomic():
        # Sin `select_related`: el bloqueo es solo de la fila de la reunión.
        meeting = access.vigentes().select_for_update().filter(pk=meeting_id).first()
        if meeting is None or not access.puede_ver(actor, meeting):
            raise _no_encontrada()
        if not access.puede_editar(actor, meeting):
            raise _prohibido("Solo el anfitrión puede eliminar la reunión.")
        meeting.deleted_at = timezone.now()
        meeting.deleted_by = actor
        meeting.save(update_fields=["deleted_at", "deleted_by", "updated_at"])
        _audit(actor, "eliminada", meeting, previo=_para_auditoria(meeting), context=context)
        invitados = [i.user for i in meeting.invitees.select_related("user")]
        if meeting.host_id != actor.pk:
            invitados.append(meeting.host)
        _avisar(
            invitados,
            categoria="cancelada",
            resumen=(
                f"Se canceló la reunión «{meeting.title}» del "
                f"{_fecha_legible(meeting.meeting_date)}"
            ),
            meeting=meeting,
            actor=actor,
        )


def marcar_asistencia(*, actor, meeting_id, marcas: list[dict], context=None) -> Meeting:
    """El anfitrión (o quien administra) marca quién asistió. `marcas` es una
    lista de `{"user_id", "attended"}`; quien no está invitado es un error (400,
    sin cambiar nada). Volver a mandar lo mismo no cambia nada (idempotente)."""
    with transaction.atomic():
        # Sin `select_related`: el bloqueo es solo de la fila de la reunión.
        meeting = access.vigentes().select_for_update().filter(pk=meeting_id).first()
        if meeting is None or not access.puede_ver(actor, meeting):
            raise _no_encontrada()
        if not access.puede_editar(actor, meeting):
            raise _prohibido("Solo el anfitrión puede marcar la asistencia.")
        invitados = {i.user_id: i for i in meeting.invitees.all()}
        fuera = [m["user_id"] for m in marcas if m["user_id"] not in invitados]
        if fuera:
            raise ReunionesError(
                "Hay personas que no están invitadas a la reunión.",
                details={"attendance": [f"La persona #{pk} no está invitada." for pk in fuera]},
            )
        cambios = {}
        for marca in marcas:
            invitado = invitados[marca["user_id"]]
            if invitado.attended != marca["attended"]:
                invitado.attended = marca["attended"]
                invitado.save(update_fields=["attended", "updated_at"])
                cambios[str(invitado.user_id)] = marca["attended"]
        if cambios:
            _audit(actor, "asistencia", meeting, nuevo={"attended": cambios}, context=context)
    return meeting
