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
        return len(nuevas)
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo registrar la notificación «%s»", tipo)
        return 0


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
