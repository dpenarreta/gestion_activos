"""Las reglas de las sugerencias y los errores reportados.

- Cualquiera con cuenta reporta, pero **los reportes son reservados**: solo
  los ve quien tiene `sugerencias.gestionar` (ni siquiera quien los envió).
- Quien gestiona ve todo, comenta (la conversación es interna) y cambia el
  estado.
- Al llegar un reporte se avisa a quienes gestionan; cada cambio de estado se
  avisa a quien lo reportó, sin el detalle de la conversación.
- Lo resuelto o descartado queda cerrado: se puede reabrir pasándolo a otro
  estado.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.notificaciones import services as campana
from apps.permissions.authorization import user_has_permission

from .models import ComentarioReporte, Reporte

ENLACE = "/admin/institucional/sugerencias"
CERRADOS = {Reporte.Estado.RESUELTO, Reporte.Estado.DESCARTADO}


def gestiona(usuario) -> bool:
    return user_has_permission(usuario, "sugerencias.gestionar")


def puede_ver(reporte, usuario) -> bool:
    """Los reportes son reservados: solo los ve quien gestiona."""
    return gestiona(usuario)


def _gestores():
    from apps.chat.services import personas_de_la_empresa

    return [u for u in personas_de_la_empresa() if gestiona(u)]


def _enlace(reporte) -> str:
    return f"{ENLACE}?reporte={reporte.pk}"


def _avisar(destinatarios, reporte, titulo, resumen=""):
    campana.notificar(
        destinatarios,
        tipo="sugerencias.reporte",
        titulo=titulo,
        resumen=resumen or f"#{reporte.pk} · {reporte.titulo}",
        enlace=_enlace(reporte),
    )


@transaction.atomic
def crear(autor, *, tipo, titulo, descripcion, modulo, impacto="", captura=None, captura_tipo=""):
    reporte = Reporte(
        autor=autor,
        tipo=tipo,
        titulo=titulo.strip(),
        descripcion=descripcion.strip(),
        modulo=modulo,
        impacto=impacto if tipo == Reporte.Tipo.ERROR else "",
    )
    if captura:
        reporte.captura.save(captura.name, captura, save=False)
        reporte.captura_tipo = captura_tipo
    reporte.save()
    nombre = "Nuevo error reportado" if tipo == Reporte.Tipo.ERROR else "Nueva sugerencia"
    _avisar([u for u in _gestores() if u.pk != autor.pk], reporte, nombre)
    return reporte


@transaction.atomic
def comentar(reporte, usuario, texto):
    if not gestiona(usuario):
        raise PermissionDenied("No tiene el permiso requerido: sugerencias.gestionar.")
    texto = (texto or "").strip()
    if not texto:
        raise ValidationError({"texto": "Escriba el comentario."})
    return ComentarioReporte.objects.create(reporte=reporte, autor=usuario, texto=texto)


@transaction.atomic
def cambiar_estado(reporte, usuario, estado, texto=""):
    if not gestiona(usuario):
        raise PermissionDenied("No tiene el permiso requerido: sugerencias.gestionar.")
    if estado not in Reporte.Estado.values:
        raise ValidationError({"estado": "Estado desconocido."})
    if estado == reporte.estado:
        raise ValidationError({"estado": "El reporte ya está en ese estado."})
    if estado in CERRADOS and not (texto or "").strip():
        raise ValidationError(
            {"texto": "Al cerrarlo, diga cómo se resolvió o por qué se descarta."}
        )
    reporte.estado = estado
    reporte.cerrado_en = timezone.now() if estado in CERRADOS else None
    reporte.save(update_fields=["estado", "cerrado_en", "updated_at"])
    ComentarioReporte.objects.create(
        reporte=reporte, autor=usuario, texto=(texto or "").strip(), estado_nuevo=estado
    )
    if reporte.autor_id != usuario.pk:
        # A quien reportó solo se le dice el nuevo estado: el reporte y su
        # conversación son reservados.
        campana.notificar(
            [reporte.autor],
            tipo="sugerencias.reporte",
            titulo=f"Su reporte #{reporte.pk} pasó a «{Reporte.Estado(estado).label}»",
            resumen=reporte.titulo,
            enlace=ENLACE,
        )
    return reporte
