"""Lógica de negocio de Mejora continua, portada de Nexo (`apps.ideas.services`
y las reglas que allá vivían en las vistas).

Se conserva de Nexo:

- **La máquina de etapas.** Lineal de PROPUESTA a IMPLEMENTADA, de a un paso
  (avanzar o retroceder); RECHAZADA es lateral: se llega desde cualquier etapa
  salvo IMPLEMENTADA, con motivo obligatorio, y desde ella solo se reabre (vuelve
  a EN_REVISION). Cada cambio deja una fila en el historial.
- **El voto** tipo «me gusta», uno por persona; el conteo se calcula al leer.
- **Los avisos**: a quienes revisan cuando llega una idea nueva y al autor cuando
  su idea cambia de etapa (nunca a quien hizo el cambio).

Lo que cambia, documentado donde ocurre:

1. **IMPLEMENTADA es final.** En Nexo la pantalla no ofrecía ninguna acción
   sobre una idea implementada, pero la API sí dejaba retrocederla; aquí la
   regla de la pantalla la impone el servidor. Así la insignia «innovador»
   (que en Nexo nunca se quitaba) no queda colgando de una idea que ya no está
   implementada.
2. **La insignia «innovador»** no se guarda: la intranet no tiene insignias de
   usuario y crear un modelo genérico solo para esta no se justifica. Se deriva
   (`innovadores`): quien tiene en la empresa una idea que llegó a IMPLEMENTADA.
3. **El adjunto** es un archivo validado (tamaño, extensión y firma del
   contenido; un .docx o .xlsx, además, por dentro) y no se borra al salir de
   PROPUESTA (ver `models`).
4. **Idempotencia.** Quien mueve una idea puede mandar la etapa que está viendo
   (`expected_status`): si otra persona ya la movió, responde 409 en vez de
   avanzarla dos veces por un doble clic. El voto, además del alternar de Nexo,
   admite votar y quitar el voto de forma idempotente.
5. **Auditoría común** (`record_audit_event`, módulo `mejora_continua`) de lo que
   cambia una idea: crearla, moverla de etapa y su avance. Los votos no se
   auditan: son una preferencia, no una decisión.

Las vistas solo resuelven parámetros y delegan aquí.
"""

import base64
import binascii
import logging
import zipfile
from pathlib import PurePath

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import serializers as drf_serializers

from apps.adjuntos.validators import validar_archivo
from apps.core.archivos import mensaje_de_tamano
from apps.core.audit import record_audit_event
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.tasks.roles import gh_role_of, in_active_company, role_label

from . import access
from .models import IdeaStatusHistory, IdeaVote, ImprovementIdea

logger = logging.getLogger(__name__)
User = get_user_model()

Status = ImprovementIdea.Status

AUDIT_MODULE = "mejora_continua"

#: La etapa siguiente de cada una, en orden. RECHAZADA no está: es lateral.
ORDEN_DE_ETAPAS = [
    Status.PROPUESTA,
    Status.EN_REVISION,
    Status.APROBADA,
    Status.EN_DESARROLLO,
    Status.EN_PRUEBAS,
    Status.IMPLEMENTADA,
]

#: Las acciones de Nexo (`PATCH /api/ideas/[id]/status`).
AVANZAR = "ADVANCE"
RETROCEDER = "RETREAT"
RECHAZAR = "REJECT"
REABRIR = "REOPEN"
ACCIONES = (AVANZAR, RETROCEDER, RECHAZAR, REABRIR)

TITULO_MAX = 255
DESCRIPCION_MAX = 5000
COMENTARIO_MAX = 2000

# ── Adjuntos ──────────────────────────────────────────────────────────────────

#: El tope de Nexo (`MAX_SIZE_BYTES` de `src/lib/storage.ts`): 8 MB. Es menor que
#: el general de la intranet (`apps.adjuntos.models.TAMANO_MAXIMO_BYTES`), que
#: igual se comprueba.
TAMANO_MAXIMO_ADJUNTO = 8 * 1024 * 1024

FIRMA_PDF = [b"%PDF-"]
FIRMA_ZIP = [b"PK\x03\x04"]
FIRMA_OLE = [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"]

#: Lo que Nexo aceptaba (`ALLOWED_EXTENSIONS`): imágenes, PDF, Word y Excel.
#: Extensión → (tipo con que se guarda y se sirve, firmas aceptadas).
FORMATOS_DE_ADJUNTO: dict[str, tuple[str, list[bytes]]] = {
    ".pdf": ("application/pdf", FIRMA_PDF),
    ".png": ("image/png", [b"\x89PNG\r\n\x1a\n"]),
    ".jpg": ("image/jpeg", [b"\xff\xd8\xff"]),
    ".jpeg": ("image/jpeg", [b"\xff\xd8\xff"]),
    ".doc": ("application/msword", FIRMA_OLE),
    ".docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        FIRMA_ZIP,
    ),
    ".xls": ("application/vnd.ms-excel", FIRMA_OLE),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", FIRMA_ZIP),
}

#: Un OOXML no es cualquier ZIP: trae `[Content_Types].xml` y la carpeta de su
#: aplicación. Así un .zip renombrado a .docx no entra aunque su firma sea ZIP.
CARPETAS_OOXML = {".docx": "word/", ".xlsx": "xl/"}

#: Cómo se ve cada adjunto dentro del sistema: el PDF en el visor de PDF y las
#: imágenes en línea. Word y Excel, que el navegador no dibuja, se descargan.
VISORES = {"application/pdf": "pdf", "image/png": "imagen", "image/jpeg": "imagen"}

# ── Avisos ────────────────────────────────────────────────────────────────────

#: Adónde llevan los avisos de la campana (ruta del frontend).
ENLACE_IDEA = "/admin/gestion-humana/mejora-continua"
RESUMEN_MAX = 300

TITULOS_DE_AVISO = {
    "nueva_idea": "Mejora continua: nueva idea",
    "estado": "Mejora continua: su idea cambió de etapa",
}


class MejoraContinuaError(Exception):
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


def _invalido(campo: str, mensaje: str) -> MejoraContinuaError:
    return MejoraContinuaError(mensaje, details={campo: [mensaje]})


def _prohibido(mensaje: str) -> MejoraContinuaError:
    return MejoraContinuaError(mensaje, code="permission_denied", status=403)


def _no_encontrada() -> MejoraContinuaError:
    return MejoraContinuaError("Idea no encontrada.", code="not_found", status=404)


def etiqueta_de_etapa(status: str) -> str:
    return Status(status).label if status in Status.values else status


def nombre_corto(user) -> str:
    """El nombre corto de Nexo (`first_name or username`) para los avisos."""
    return (user.first_name or "").strip() or user.username


def _audit(actor, accion: str, idea: ImprovementIdea, *, previo=None, nuevo=None, context=None):
    record_audit_event(
        actor=actor,
        action=f"mejora_continua.{accion}",
        target=idea,
        module=AUDIT_MODULE,
        previous_values=previo,
        new_values=nuevo,
        context=context,
    )


# ── Máquina de etapas ─────────────────────────────────────────────────────────


def etapa_siguiente(actual: str) -> str | None:
    if actual not in ORDEN_DE_ETAPAS:
        return None
    indice = ORDEN_DE_ETAPAS.index(actual)
    return ORDEN_DE_ETAPAS[indice + 1] if indice + 1 < len(ORDEN_DE_ETAPAS) else None


def etapa_anterior(actual: str) -> str | None:
    """IMPLEMENTADA es final: no retrocede (ver el punto 1 del módulo)."""
    if actual not in ORDEN_DE_ETAPAS or actual == Status.IMPLEMENTADA:
        return None
    indice = ORDEN_DE_ETAPAS.index(actual)
    return ORDEN_DE_ETAPAS[indice - 1] if indice > 0 else None


def se_puede_rechazar(actual: str) -> bool:
    return actual not in (Status.IMPLEMENTADA, Status.RECHAZADA)


def acciones_posibles(status: str) -> list[str]:
    """Las acciones válidas desde una etapa, para que la pantalla muestre solo
    los botones que el servidor va a aceptar."""
    acciones = []
    if etapa_siguiente(status):
        acciones.append(AVANZAR)
    if etapa_anterior(status):
        acciones.append(RETROCEDER)
    if se_puede_rechazar(status):
        acciones.append(RECHAZAR)
    if status == Status.RECHAZADA:
        acciones.append(REABRIR)
    return acciones


def _destino(accion: str, actual: str, comentario: str | None) -> str:
    if accion == AVANZAR:
        destino = etapa_siguiente(actual)
        if destino is None:
            raise MejoraContinuaError(
                "No se puede avanzar desde esta etapa.", code="invalid_transition"
            )
        return destino
    if accion == RETROCEDER:
        destino = etapa_anterior(actual)
        if destino is None:
            raise MejoraContinuaError(
                "No se puede retroceder desde esta etapa.", code="invalid_transition"
            )
        return destino
    if accion == RECHAZAR:
        if not se_puede_rechazar(actual):
            raise MejoraContinuaError(
                "No se puede rechazar esta idea desde su etapa actual.",
                code="invalid_transition",
            )
        if not comentario:
            raise _invalido("comment", "El motivo del rechazo es obligatorio.")
        return Status.RECHAZADA
    if accion == REABRIR:
        if actual != Status.RECHAZADA:
            raise MejoraContinuaError(
                "Solo se puede reabrir una idea rechazada.", code="invalid_transition"
            )
        return Status.EN_REVISION
    raise _invalido("action", "Acción inválida.")


# ── Lectura ───────────────────────────────────────────────────────────────────


def obtener_visible(actor, pk) -> ImprovementIdea:
    """La idea si existe en la empresa activa y la persona la ve; si no, 404
    (no se revela que existe)."""
    idea = ImprovementIdea.objects.select_related("author").filter(pk=pk).first()
    if idea is None or not access.puede_ver(actor, idea):
        raise _no_encontrada()
    return idea


def innovadores(user_ids) -> set[int]:
    """Quiénes de `user_ids` tienen la insignia «innovador» en la empresa
    activa: una idea suya llegó a IMPLEMENTADA (en Nexo, `User.badges`, que se
    daba al implementarse y nunca se quitaba). Se mira el historial y, por las
    ideas que llegaron de Nexo sin historial, también la etapa actual."""
    ids = {int(i) for i in user_ids if i is not None}
    if not ids:
        return set()
    implementada = Q(status=Status.IMPLEMENTADA) | Q(history__to_status=Status.IMPLEMENTADA)
    return set(
        ImprovementIdea.objects.filter(implementada, author_id__in=ids)
        .values_list("author_id", flat=True)
        .distinct()
    )


def es_innovador(user) -> bool:
    return user.pk in innovadores([user.pk])


def describir_personas(personas) -> dict[int, dict]:
    """La referencia de cada persona que sale en una respuesta, calculada una
    vez por persona (y no por idea): id, nombres, su rol de Gestión Humana y la
    insignia. Sin el correo: el tablero no lo necesita."""
    unicas = {p.pk: p for p in personas if p is not None}
    con_insignia = innovadores(unicas)
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
            "innovador": pk in con_insignia,
        }
    return resultado


def resumen_de_acceso(user) -> dict:
    """`GET /mejora-continua/me/`: qué puede hacer la persona."""
    return {
        "user_id": user.pk,
        "permissions": access.effective_codenames(user),
        "can_propose": access.puede_proponer(user),
        "can_vote": access.puede_votar(user),
        "can_manage": access.puede_gestionar(user),
        "sees_all": access.ve_todas(user),
        "innovador": es_innovador(user),
        "attachment": {
            "extensions": sorted(FORMATOS_DE_ADJUNTO),
            "max_bytes": TAMANO_MAXIMO_ADJUNTO,
        },
    }


def visor_de(mime: str) -> str | None:
    """Con qué visor interno se abre el adjunto: «pdf», «imagen» o `None` (se
    descarga)."""
    return VISORES.get(mime or "")


# ── Adjuntos ──────────────────────────────────────────────────────────────────


def _comprobar_ooxml(archivo, extension: str) -> None:
    """Un .docx o .xlsx tiene que ser un OOXML de verdad (ver `CARPETAS_OOXML`).
    Solo se lee el índice del ZIP, sin descomprimir nada."""
    carpeta = CARPETAS_OOXML.get(extension)
    if carpeta is None:
        return
    try:
        with zipfile.ZipFile(archivo) as contenedor:
            nombres = contenedor.namelist()
    except (zipfile.BadZipFile, OSError, ValueError):
        nombres = []
    finally:
        archivo.seek(0)
    if "[Content_Types].xml" not in nombres or not any(n.startswith(carpeta) for n in nombres):
        raise _invalido(
            "attachment",
            f"El contenido del archivo no corresponde a un {extension}. "
            "Verifique que no se haya renombrado la extensión.",
        )


def validar_adjunto(archivo) -> tuple[str, str]:
    """Valida el adjunto (tamaño de Nexo, extensión, firma y, en un OOXML, su
    índice) y devuelve `(extensión, tipo)`. Un ejecutable renombrado a .pdf no
    entra."""
    nombre = PurePath((getattr(archivo, "name", "") or "").strip()).name
    if not nombre:
        raise _invalido("attachment", "Falta el nombre del archivo.")
    archivo.name = nombre
    if archivo.size > TAMANO_MAXIMO_ADJUNTO:
        raise _invalido(
            "attachment", mensaje_de_tamano("El archivo", archivo.size, TAMANO_MAXIMO_ADJUNTO)
        )
    try:
        extension = validar_archivo(
            archivo, formatos={ext: firmas for ext, (_, firmas) in FORMATOS_DE_ADJUNTO.items()}
        )
    except drf_serializers.ValidationError as exc:
        mensaje = exc.detail[0] if isinstance(exc.detail, list) else exc.detail
        raise _invalido("attachment", str(mensaje)) from exc
    _comprobar_ooxml(archivo, extension)
    return extension, FORMATOS_DE_ADJUNTO[extension][0]


def archivo_desde_base64(nombre: str, datos: str) -> ContentFile:
    """El base64 de Nexo (`attachment_data`, a veces una URL de datos
    `data:application/pdf;base64,...`) como archivo. Lo usa la importación."""
    texto = (datos or "").strip()
    if texto.startswith("data:") and "," in texto:
        texto = texto.split(",", 1)[1]
    try:
        contenido = base64.b64decode("".join(texto.split()), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise _invalido("attachment", "El contenido del adjunto no es base64 válido.") from exc
    if not contenido:
        raise _invalido("attachment", "El adjunto está vacío.")
    return ContentFile(contenido, name=PurePath(nombre or "").name or "adjunto")


# ── Avisos ────────────────────────────────────────────────────────────────────


def _resumen(texto: str) -> str:
    return texto if len(texto) <= RESUMEN_MAX else texto[: RESUMEN_MAX - 1] + "…"


def _avisar(destinatarios, *, categoria: str, resumen: str, idea: ImprovementIdea, actor):
    """Aviso en la campana, después de confirmar: si la campana falla, la
    operación no se revierte. Nunca a quien actuó."""
    personas = [u for u in destinatarios if u is not None and u.pk != actor.pk]
    if not personas:
        return
    empresa = idea.empresa
    enlace = f"{ENLACE_IDEA}/{idea.pk}"
    texto = _resumen(resumen)

    def enviar():
        from apps.notificaciones.services import notificar

        notificar(
            personas,
            tipo=f"mejora_continua.{categoria}",
            titulo=TITULOS_DE_AVISO[categoria],
            resumen=texto,
            enlace=enlace,
            empresa=empresa,
        )

    transaction.on_commit(enviar)


def revisores():
    """Quienes revisan ideas en la empresa activa (`mejora_continua.gestionar`,
    por rol global, de su membresía o directo), activos. En Nexo, todos los que
    tenían `mejora_continua.revisar` más el superusuario; aquí el superusuario
    solo si tiene el permiso por un rol (el de TI no revisa ideas)."""
    from apps.novedades.access import permission_filter

    return (
        User.objects.filter(is_active=True)
        .filter(in_active_company())
        .filter(permission_filter(access.GESTIONAR))
        .distinct()
    )


# ── Escritura ─────────────────────────────────────────────────────────────────


def crear_idea(
    *, actor, title: str, description: str, impact: str, adjunto=None, context=None
) -> ImprovementIdea:
    """Réplica de `POST /api/ideas`: cualquiera con `mejora_continua.acceder`
    propone; avisa a quienes revisan."""
    if not access.puede_proponer(actor):
        raise _prohibido("No tiene permiso para proponer ideas.")
    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        raise MejoraContinuaError("No hay una empresa activa.", code="sin_empresa")
    mime = ""
    if adjunto is not None:
        _, mime = validar_adjunto(adjunto)

    idea = ImprovementIdea(
        empresa=empresa,
        title=title,
        description=description,
        impact=impact,
        author=actor,
    )
    try:
        with transaction.atomic():
            if adjunto is not None:
                idea.attachment_name = adjunto.name[:255]
                idea.attachment_mime = mime
                idea.attachment_size = adjunto.size
                idea.attachment.save(adjunto.name, adjunto, save=False)
            idea.save()
            _audit(
                actor,
                "idea_propuesta",
                idea,
                nuevo={
                    "title": idea.title,
                    "impact": idea.impact,
                    "attachment": idea.attachment_name or None,
                },
                context=context,
            )
            _avisar(
                revisores(),
                categoria="nueva_idea",
                resumen=f"{nombre_corto(actor)} propuso una nueva idea: «{idea.title}»",
                idea=idea,
                actor=actor,
            )
    except Exception:
        # Si la fila no se confirmó, el archivo ya escrito no puede quedar
        # huérfano en el almacenamiento.
        if idea.attachment:
            idea.attachment.delete(save=False)
        raise
    return idea


def cambiar_etapa(
    *,
    actor,
    idea_id,
    action: str,
    comment: str | None = None,
    expected_status: str | None = None,
    context=None,
) -> ImprovementIdea:
    """Réplica de `PATCH /api/ideas/[id]/status`: valida la transición, deja el
    historial, cambia la etapa y avisa al autor (si no fue quien la movió). La
    fila se bloquea mientras dura: dos revisores a la vez no la avanzan dos
    pasos."""
    if not access.puede_gestionar(actor):
        raise _prohibido("No tiene permiso para mover ideas.")
    with transaction.atomic():
        # Sin `select_related`: el bloqueo es solo de la fila de la idea.
        idea = ImprovementIdea.objects.select_for_update().filter(pk=idea_id).first()
        if idea is None:
            raise _no_encontrada()
        actual = idea.status
        if expected_status and expected_status != actual:
            raise MejoraContinuaError(
                f"La idea ya está en «{etiqueta_de_etapa(actual)}»: alguien la movió. "
                "Actualice la pantalla.",
                code="conflict",
                status=409,
                details={"status": [actual]},
            )
        destino = _destino(action, actual, comment)

        IdeaStatusHistory.objects.create(
            idea=idea, from_status=actual, to_status=destino, changed_by=actor, comment=comment
        )
        idea.status = destino
        idea.save(update_fields=["status", "updated_at"])
        _audit(
            actor,
            "etapa_cambiada",
            idea,
            previo={"status": actual},
            nuevo={"status": destino, "action": action, "comment": comment},
            context=context,
        )

        if action == RECHAZAR:
            mensaje = f"Su idea «{idea.title}» fue rechazada: {comment}"
        elif destino == Status.IMPLEMENTADA:
            mensaje = f"¡Felicidades! Su idea «{idea.title}» fue implementada"
        else:
            mensaje = f"Su idea «{idea.title}» pasó a {etiqueta_de_etapa(destino)}"
        _avisar([idea.author], categoria="estado", resumen=mensaje, idea=idea, actor=actor)
    return idea


def actualizar_avance(*, actor, idea_id, progress: int, context=None) -> ImprovementIdea:
    """Réplica de `PATCH /api/ideas/[id]`: solo el avance (0 a 100), de
    quien revisa. Como en Nexo, en cualquier etapa (la pantalla lo muestra en
    EN_DESARROLLO)."""
    if not access.puede_gestionar(actor):
        raise _prohibido("No tiene permiso para actualizar el avance.")
    with transaction.atomic():
        idea = ImprovementIdea.objects.select_for_update().filter(pk=idea_id).first()
        if idea is None:
            raise _no_encontrada()
        previo = idea.progress
        if previo != progress:
            idea.progress = progress
            idea.save(update_fields=["progress", "updated_at"])
            _audit(
                actor,
                "avance_actualizado",
                idea,
                previo={"progress": previo},
                nuevo={"progress": progress},
                context=context,
            )
    return idea


def votar(*, actor, idea: ImprovementIdea, querer: bool | None = None) -> tuple[int, bool]:
    """El voto de `actor` en `idea` (que ya se comprobó que ve). `querer=None`
    alterna, como el `POST /api/ideas/[id]/vote` de Nexo; `True` vota y
    `False` quita el voto, sin efecto si ya estaba así (idempotente). Devuelve
    `(vote_count, voted_by_me)`."""
    if not access.puede_votar(actor):
        raise _prohibido("No tiene permiso para votar.")
    existente = IdeaVote.objects.filter(idea=idea, user=actor).first()
    if querer is None:
        querer = existente is None
    if querer and existente is None:
        try:
            with transaction.atomic():
                IdeaVote.objects.create(idea=idea, user=actor)
        except IntegrityError:
            # Otro clic llegó antes: el voto ya está, que es lo que se pedía.
            pass
    elif not querer and existente is not None:
        IdeaVote.objects.filter(idea=idea, user=actor).delete()
    total = IdeaVote.objects.filter(idea=idea).count()
    return total, bool(querer)
