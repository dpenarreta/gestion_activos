"""Crear, leer y limpiar las notificaciones de la campana.

Dos caminos llegan aquí:

- `desde_correo`: cada aviso por correo (`alertas.eventos.enviar`, el resumen
  de alertas, los recordatorios de la Matriz) deja también una notificación a
  cada destinatario que tenga cuenta. El título es el nombre del aviso, el
  resumen su asunto y el enlace el mismo del correo.
- `notificar`: lo que solo tiene sentido dentro del sistema, como el ticket que
  le asignaron a un técnico.

Nada de esto puede tumbar lo que lo dispara: si la notificación falla, se deja
en el registro y la operación sigue.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from .models import Notificacion
from .modulos import modulo_de

logger = logging.getLogger("apps.notificaciones")

#: Avisos que nunca van a la campana: el de recuperar la contraseña lleva un
#: enlace de un solo uso que no debe quedar guardado en ningún otro sitio.
EXCLUIDOS = frozenset({"acceso.recuperar_contrasena"})

#: Cuántos días se guardan las notificaciones ya leídas.
DIAS_LEIDAS = 90
#: Y las no leídas: pasado esto ya no son noticia.
DIAS_NO_LEIDAS = 180


def enlace_interno(url: str) -> str:
    """La ruta interna de un enlace del sistema, o vacío si es de afuera.

    Los correos llevan la dirección completa (`https://…/admin/activos/3`); la
    campana guarda solo la ruta, y nunca un enlace a otro sitio.
    """
    url = (url or "").strip()
    if not url:
        return ""
    base = settings.FRONTEND_URL.rstrip("/")
    if url.startswith(base + "/"):
        url = url[len(base) :]
    if not url.startswith("/") or url.startswith("//"):
        return ""
    return url[:300]


def _empresa(empresa):
    if empresa is not None:
        return empresa
    actual = empresa_actual()
    return None if actual is None or actual is SIN_EMPRESA else actual


def notificar(
    usuarios, *, tipo: str, titulo: str, resumen: str = "", enlace: str = "", empresa=None
):
    """Deja una notificación a cada usuario activo. Devuelve cuántas creó."""
    try:
        destino = _empresa(empresa)
        vistos = set()
        nuevas = []
        for usuario in usuarios:
            if usuario is None or not usuario.is_active or usuario.pk in vistos:
                continue
            vistos.add(usuario.pk)
            nuevas.append(
                Notificacion(
                    empresa=destino,
                    usuario=usuario,
                    modulo=modulo_de(tipo),
                    tipo=tipo[:60],
                    titulo=titulo[:150],
                    resumen=(resumen or "")[:300],
                    enlace=enlace_interno(enlace),
                )
            )
        for notificacion in nuevas:
            notificacion.save()
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo registrar la notificación «%s»", tipo)
        return 0
    _programar_push(nuevas)
    return len(nuevas)


def _programar_push(nuevas) -> None:
    """El push de la app, después del commit y fuera del request (US-009,
    12/11/2026): si la transacción de origen se deshace, no sale ningún aviso
    de una notificación que no existe; y Expo nunca demora ni tumba la
    operación que notificó (`robust=True` y `push.programar` no lanzan)."""
    if not nuevas or not settings.PUSH_HABILITADO:
        return
    try:
        datos = [
            {
                "id": n.pk,
                "usuario_id": n.usuario_id,
                "modulo": n.modulo,
                "empresa_id": n.empresa_id,
            }
            for n in nuevas
        ]
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo programar el push de las notificaciones")
        return
    programar_push_de(datos)


def programar_push_de(notificaciones) -> None:
    """El push de notificaciones que ya existen y se actualizaron, como el
    aviso del chat que se reescribe con el último mensaje (US-011, CA-10).

    `notificaciones`: `[{"id", "usuario_id", "modulo", "empresa_id"}]`, tal
    cual lo da `.values("id", "usuario_id", "modulo", "empresa_id")` en una
    sola consulta. Mismas reglas que el de `notificar`: después del commit,
    genérico (`push.mensaje`), respeta `PUSH_HABILITADO` y nunca lanza.
    """
    if not notificaciones or not settings.PUSH_HABILITADO:
        return
    try:
        from . import push

        datos = [
            {
                "id": n["id"],
                "usuario_id": n["usuario_id"],
                "modulo": n["modulo"],
                "empresa_id": n["empresa_id"],
            }
            for n in notificaciones
        ]
        transaction.on_commit(lambda: push.programar(datos), robust=True)
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo programar el push de las notificaciones")


def desde_correo(*, clave: str, asunto: str, variables: dict, direcciones, empresa=None) -> int:
    """La notificación de un aviso por correo, para quienes tienen cuenta."""
    if clave in EXCLUIDOS or not direcciones:
        return 0
    try:
        from apps.correos import catalogo

        plantilla = catalogo.obtener(clave)
        correos = {d.strip().lower() for d in direcciones if d and d.strip()}
        usuarios = (
            get_user_model()
            .objects.annotate(correo=Lower("email"))
            .filter(correo__in=correos, is_active=True)
        )
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo preparar la notificación del aviso «%s»", clave)
        return 0
    return notificar(
        usuarios,
        tipo=clave,
        titulo=plantilla.nombre if plantilla else asunto,
        resumen=asunto,
        enlace=variables.get("enlace", ""),
        empresa=empresa,
    )


# --- Lectura ----------------------------------------------------------------------------


def de(usuario):
    """Las notificaciones de un usuario en la empresa activa, más las que no
    son de ninguna empresa (las de la cuenta)."""
    actual = empresa_actual()
    filtro = Q(empresa__isnull=True)
    if actual is not None and actual is not SIN_EMPRESA:
        filtro |= Q(empresa=actual)
    return Notificacion.objects.todas().filter(filtro, usuario=usuario)


def marcar_leida(notificacion) -> Notificacion:
    if notificacion.leida_en is None:
        notificacion.leida_en = timezone.now()
        notificacion.save(update_fields=["leida_en", "updated_at"])
    return notificacion


def marcar_todas(usuario) -> int:
    return de(usuario).filter(leida_en__isnull=True).update(leida_en=timezone.now())


def limpiar(ahora=None) -> int:
    """Borra las viejas: las leídas a los 90 días y las demás a los 180."""
    ahora = ahora or timezone.now()
    borradas, _ = (
        Notificacion.objects.todas()
        .filter(
            Q(leida_en__isnull=False, created_at__lt=ahora - timedelta(days=DIAS_LEIDAS))
            | Q(created_at__lt=ahora - timedelta(days=DIAS_NO_LEIDAS))
        )
        .delete()
    )
    return borradas


# --- Dispositivos de la app (push) ------------------------------------------------------


#: Cuántas veces se intenta el registro si choca con otro simultáneo.
INTENTOS_REGISTRO = 3


class RegistroEnConflicto(Exception):
    """El mismo teléfono se registró a la vez varias veces y no se resolvió."""

    code = "dispositivo_en_conflicto"
    message = "No se pudo registrar el teléfono para avisos. Intente de nuevo en un momento."
    status = 409


def registrar_dispositivo(*, usuario, session, token: str, plataforma: str, nombre: str = ""):
    """Une el teléfono a la persona y la sesión actuales. Devuelve
    `(dispositivo, creado)`.

    El token es único: si ya existía —de otra cuenta u otro inicio de sesión—
    se mueve aquí, y un teléfono nunca recibe avisos de dos cuentas (US-009,
    12/11/2026). Y una sesión es un teléfono: si la app renueva su token, el
    anterior de esa misma sesión se apaga para no duplicar los avisos.
    """
    from .models import DispositivoPush

    valores = {
        "usuario": usuario,
        "session": session,
        "plataforma": plataforma,
        "nombre": nombre,
        "activo": True,
    }
    # Registros simultáneos del mismo token (la app reintentó): el otro gana
    # la carrera, este choca con el índice único y se vuelve a intentar, ya
    # sobre la fila que existe. Tres choques seguidos no son normales: se
    # responde un error controlado y la app reintenta más tarde.
    for intento in range(1, INTENTOS_REGISTRO + 1):
        try:
            with transaction.atomic():
                dispositivo, creado = DispositivoPush.objects.update_or_create(
                    token=token, defaults=valores
                )
            break
        except IntegrityError:
            if intento == INTENTOS_REGISTRO:
                logger.warning("El registro de un dispositivo push chocó %s veces", intento)
                raise RegistroEnConflicto() from None
    DispositivoPush.objects.filter(session=session, activo=True).exclude(pk=dispositivo.pk).update(
        activo=False, updated_at=timezone.now()
    )
    return dispositivo, creado


def dar_de_baja_dispositivo(*, usuario, token: str) -> int:
    """Apaga el push de un teléfono, solo si es de esta persona. Idempotente:
    un token ajeno o desconocido no hace nada y no se revela."""
    from .models import DispositivoPush

    return DispositivoPush.objects.filter(token=token, usuario=usuario, activo=True).update(
        activo=False, updated_at=timezone.now()
    )


def desactivar_dispositivos_sin_sesion(usuario) -> int:
    """Apaga los teléfonos de la persona cuya sesión ya no está vigente.

    Lo llama `SessionService` al cerrar sesiones (logout, logout-all, cambio de
    contraseña, usuario deshabilitado, cierre desde «Sesiones»). El envío
    igual filtra por sesión vigente (`push.enviar`): esto deja la tabla al día.
    Nunca lanza excepciones: cerrar la sesión es lo importante.
    """
    try:
        from .models import DispositivoPush

        with transaction.atomic():
            return (
                DispositivoPush.objects.filter(usuario=usuario, activo=True)
                .filter(
                    Q(session__revoked_at__isnull=False)
                    | Q(session__expires_at__lte=timezone.now())
                )
                .update(activo=False, updated_at=timezone.now())
            )
    except Exception:  # noqa: BLE001
        logger.exception("No se pudieron desactivar los dispositivos push de una sesión cerrada")
        return 0
