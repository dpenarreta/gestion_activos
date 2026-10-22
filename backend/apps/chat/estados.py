"""El estado de cada persona en el chat (22/10/2026).

Además de «en línea» (que sale de las sesiones, ver `presencia.py`), cada
persona elige cómo está: **disponible**, **almuerzo**, **vacaciones**, **en
reunión** o **no disponible**, con un mensaje opcional. Lo ven quienes le
escriben: en su nombre, en la conversación y, al enviarle un mensaje, un aviso.

- **Almuerzo**: la persona guarda su horario (hora de inicio y cuántos
  minutos); al salir lo marca y el estado dura esos minutos.
- **Vacaciones**: entre dos fechas. Se proponen las de su solicitud de
  vacaciones aprobada (o pendiente) que esté en curso o por venir; ella las
  confirma o las cambia. Antes de empezar, quien le escribe ya ve «Estará de
  vacaciones del… al…».
- **En reunión / No disponible**: hasta una hora, o hasta que lo cambie.

Un estado con fecha u hora de fin vuelve solo a «disponible» al pasar.
"""

import datetime

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import EstadoChat

TEXTOS = {
    EstadoChat.Estado.ALMUERZO: "En almuerzo",
    EstadoChat.Estado.VACACIONES: "De vacaciones",
    EstadoChat.Estado.REUNION: "En reunión",
    EstadoChat.Estado.NO_DISPONIBLE: "No disponible",
}
#: Cuánto puede durar el almuerzo, en minutos.
ALMUERZO_MINIMO, ALMUERZO_MAXIMO = 10, 180


def _fecha(valor) -> str:
    return valor.strftime("%d/%m/%Y")


def _hora(valor) -> str:
    return timezone.localtime(valor).strftime("%H:%M")


def _vacaciones(estado, hoy) -> str:
    """«en_curso», «proximas» o vacío, según las fechas de vacaciones."""
    if not estado.vacaciones_desde or not estado.vacaciones_hasta:
        return ""
    if estado.vacaciones_hasta < hoy:
        return ""
    return "en_curso" if estado.vacaciones_desde <= hoy else "proximas"


def vigente(estado, ahora=None) -> dict | None:
    """Lo que ven los demás: `{clave, texto, detalle, mensaje, desde, hasta}`
    o None si está disponible. Las vacaciones en curso mandan sobre lo demás;
    las próximas se avisan mientras tanto si no hay otro estado."""
    if estado is None:
        return None
    ahora = ahora or timezone.now()
    hoy = timezone.localdate(ahora)
    vacaciones = _vacaciones(estado, hoy)
    if vacaciones == "en_curso":
        return {
            "clave": EstadoChat.Estado.VACACIONES,
            "texto": TEXTOS[EstadoChat.Estado.VACACIONES],
            "detalle": f"De vacaciones hasta el {_fecha(estado.vacaciones_hasta)}",
            "mensaje": estado.mensaje_vacaciones,
            "desde": estado.vacaciones_desde,
            "hasta": estado.vacaciones_hasta,
        }
    clave = estado.estado
    if clave in TEXTOS and clave != EstadoChat.Estado.VACACIONES:
        if not (estado.hasta and estado.hasta <= ahora):
            detalle = TEXTOS[clave]
            if estado.hasta:
                detalle += f" hasta las {_hora(estado.hasta)}"
            return {
                "clave": clave,
                "texto": TEXTOS[clave],
                "detalle": detalle,
                "mensaje": estado.mensaje,
                "desde": None,
                "hasta": estado.hasta,
            }
    if vacaciones == "proximas":
        return {
            "clave": "vacaciones_proximas",
            "texto": "Vacaciones próximas",
            "detalle": (
                f"Estará de vacaciones del {_fecha(estado.vacaciones_desde)} "
                f"al {_fecha(estado.vacaciones_hasta)}"
            ),
            "mensaje": estado.mensaje_vacaciones,
            "desde": estado.vacaciones_desde,
            "hasta": estado.vacaciones_hasta,
        }
    return None


def de(ids) -> dict[int, dict | None]:
    estados = {e.usuario_id: e for e in EstadoChat.objects.filter(usuario_id__in=list(ids))}
    ahora = timezone.now()
    return {pk: vigente(estados.get(pk), ahora) for pk in ids}


def vacaciones_sugeridas(usuario) -> dict | None:
    """Su solicitud de vacaciones en curso o por venir (aprobada primero; si
    no, pendiente), para proponer las fechas."""
    from apps.licencias.models import SolicitudPermiso

    hoy = timezone.localdate()
    base = (
        SolicitudPermiso.objects.filter(solicitante=usuario, hasta__gte=hoy)
        .filter(Q(flujo__descuenta_vacaciones=True) | Q(flujo__nombre__icontains="vacaci"))
        .order_by("desde")
    )
    for estado in (SolicitudPermiso.Estado.APROBADA, SolicitudPermiso.Estado.PENDIENTE):
        solicitud = base.filter(estado=estado).first()
        if solicitud:
            return {
                "desde": solicitud.desde,
                "hasta": solicitud.hasta,
                "aprobada": estado == SolicitudPermiso.Estado.APROBADA,
                "solicitud": solicitud.pk,
            }
    return None


def mio(usuario) -> dict:
    estado = EstadoChat.objects.filter(usuario=usuario).first()
    actual = estado.estado if estado else EstadoChat.Estado.DISPONIBLE
    if estado and estado.hasta and estado.hasta <= timezone.now():
        actual = EstadoChat.Estado.DISPONIBLE
    return {
        "estado": actual,
        "mensaje": estado.mensaje if estado else "",
        "hasta": estado.hasta if estado else None,
        "vacaciones_desde": estado.vacaciones_desde if estado else None,
        "vacaciones_hasta": estado.vacaciones_hasta if estado else None,
        "mensaje_vacaciones": estado.mensaje_vacaciones if estado else "",
        "almuerzo_inicio": (
            estado.almuerzo_inicio.strftime("%H:%M") if estado and estado.almuerzo_inicio else ""
        ),
        "almuerzo_minutos": estado.almuerzo_minutos if estado else 60,
        "vigente": vigente(estado),
        "vacaciones_sugeridas": vacaciones_sugeridas(usuario),
    }


def guardar(usuario, datos: dict) -> dict:
    """Cambia su estado, sus vacaciones o su horario de almuerzo.

    - `estado` disponible / almuerzo / reunion / no_disponible (con `hasta`
      opcional para los dos últimos). Volver a «disponible» con unas
      vacaciones en curso las termina (regresó antes).
    - `estado` vacaciones: guarda `vacaciones_desde` y `vacaciones_hasta`.
    - `quitar_vacaciones`: borra las fechas.
    """
    estado, _ = EstadoChat.objects.get_or_create(usuario=usuario)
    ahora = timezone.now()
    hoy = timezone.localdate(ahora)
    if "almuerzo_inicio" in datos:
        estado.almuerzo_inicio = datos["almuerzo_inicio"]
    if "almuerzo_minutos" in datos:
        minutos = datos["almuerzo_minutos"]
        if not ALMUERZO_MINIMO <= minutos <= ALMUERZO_MAXIMO:
            raise ValidationError(
                {
                    "almuerzo_minutos": f"El almuerzo dura entre {ALMUERZO_MINIMO} y "
                    f"{ALMUERZO_MAXIMO} minutos."
                }
            )
        estado.almuerzo_minutos = minutos
    if datos.get("quitar_vacaciones"):
        estado.vacaciones_desde = estado.vacaciones_hasta = None
        estado.mensaje_vacaciones = ""
    clave = datos.get("estado")
    if clave == EstadoChat.Estado.VACACIONES:
        desde, hasta = datos.get("vacaciones_desde"), datos.get("vacaciones_hasta")
        if not desde or not hasta:
            raise ValidationError({"vacaciones_desde": "Elija desde y hasta qué día."})
        if hasta < desde:
            raise ValidationError(
                {"vacaciones_hasta": "La fecha de regreso va después de la de salida."}
            )
        if hasta < hoy:
            raise ValidationError({"vacaciones_hasta": "Esas vacaciones ya pasaron."})
        estado.vacaciones_desde, estado.vacaciones_hasta = desde, hasta
        estado.mensaje_vacaciones = (datos.get("mensaje") or "").strip()[:140]
    elif clave:
        estado.estado = clave
        estado.mensaje = (datos.get("mensaje") or "").strip()[:140]
        estado.hasta = None
        if clave == EstadoChat.Estado.ALMUERZO:
            estado.hasta = ahora + datetime.timedelta(minutes=estado.almuerzo_minutos)
        elif clave in (EstadoChat.Estado.REUNION, EstadoChat.Estado.NO_DISPONIBLE):
            hasta = datos.get("hasta")
            if hasta is not None and hasta <= ahora:
                raise ValidationError({"hasta": "Elija una hora que todavía no pasó."})
            estado.hasta = hasta
        elif clave == EstadoChat.Estado.DISPONIBLE and _vacaciones(estado, hoy) == "en_curso":
            estado.vacaciones_desde = estado.vacaciones_hasta = None
            estado.mensaje_vacaciones = ""
    estado.save()
    return mio(usuario)
