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
- **Fuera de la oficina** (11/11/2026, US-001): uno o varios días, con fecha
  de regreso obligatoria. Igual que las vacaciones en curso, hace que sus
  aprobaciones pasen a su reemplazo (`apps.organizacion.ausencia`).
- **Permisos aprobados** (11/11/2026, US-001): un permiso o vacaciones
  aprobados de día completo se ven solos, aunque la persona no cambie su
  estado: «De vacaciones» si son vacaciones y «Fuera de la oficina» si es
  cualquier otro permiso. El tipo (médico, personal) nunca se muestra.

Mientras la persona está ausente, quien le escribe ve también quién aprueba
por ella (`reemplazo`).

Un estado con fecha u hora de fin vuelve solo a «disponible» al pasar.
"""

import datetime
import logging

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import EstadoChat

logger = logging.getLogger(__name__)

TEXTOS = {
    EstadoChat.Estado.ALMUERZO: "En almuerzo",
    EstadoChat.Estado.VACACIONES: "De vacaciones",
    EstadoChat.Estado.REUNION: "En reunión",
    EstadoChat.Estado.NO_DISPONIBLE: "No disponible",
    EstadoChat.Estado.FUERA_OFICINA: "Fuera de la oficina",
}
#: Los estados que son una ausencia: sus aprobaciones pasan al reemplazo.
AUSENCIAS = (EstadoChat.Estado.VACACIONES, EstadoChat.Estado.FUERA_OFICINA)
#: Cuánto puede durar «Fuera de la oficina» (QA, 11/11/2026): una ausencia
#: más larga es una licencia y va por la Solicitud de permisos.
FUERA_MAXIMO = datetime.timedelta(days=180)
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
    """Lo que ven los demás: `{clave, texto, detalle, mensaje, desde, hasta,
    reemplazo}` o None si está disponible. Las vacaciones en curso mandan
    sobre lo demás; las próximas se avisan mientras tanto si no hay otro
    estado. `reemplazo` lo completa `de()` (aquí siempre es None)."""
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
            "reemplazo": None,
        }
    clave = estado.estado
    fuera = clave == EstadoChat.Estado.FUERA_OFICINA
    # «Fuera de la oficina» siempre lleva fecha de regreso: sin ella no rige.
    if clave in TEXTOS and clave != EstadoChat.Estado.VACACIONES and (estado.hasta or not fuera):
        if not (estado.hasta and estado.hasta <= ahora):
            detalle = TEXTOS[clave]
            if fuera:
                detalle += f" hasta el {timezone.localtime(estado.hasta):%d/%m}"
            elif estado.hasta:
                detalle += f" hasta las {_hora(estado.hasta)}"
            return {
                "clave": clave,
                "texto": TEXTOS[clave],
                "detalle": detalle,
                "mensaje": estado.mensaje,
                "desde": None,
                "hasta": estado.hasta,
                "reemplazo": None,
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
            "reemplazo": None,
        }
    return None


def _de_permiso(permiso: dict) -> dict:
    """Un permiso aprobado de día completo tal como lo ven los demás: solo
    «vacaciones» o «fuera de la oficina» y hasta cuándo. Sin tipo ni motivo
    (LOPDP, `apps.ausencias.access`)."""
    from apps.organizacion import ausencia

    clave = permiso["clave"]
    return {
        "clave": clave,
        "texto": ausencia.TEXTOS[clave],
        "detalle": f"{ausencia.TEXTOS[clave]} hasta el {permiso['hasta']:%d/%m}",
        "mensaje": "",
        "desde": None,
        "hasta": permiso["hasta"],
        "reemplazo": None,
    }


def de(ids) -> dict[int, dict | None]:
    """El estado vigente de cada persona, con sus permisos aprobados de día
    completo en la empresa activa (aunque no haya cambiado su estado) y, si
    está ausente, quién aprueba por ella."""
    from apps.organizacion import ausencia

    ids = list(ids)
    estados = {e.usuario_id: e for e in EstadoChat.objects.filter(usuario_id__in=ids)}
    ahora = timezone.now()
    vigentes = {pk: vigente(estados.get(pk), ahora) for pk in ids}
    for pk, permiso in ausencia.por_permisos(ids, timezone.localdate(ahora)).items():
        actual = vigentes.get(pk)
        # Si ya dijo que está de vacaciones o fuera, se respeta su mensaje.
        if actual is None or actual["clave"] not in AUSENCIAS:
            vigentes[pk] = _de_permiso(permiso)
    ausentes = [pk for pk, v in vigentes.items() if v and v["clave"] in AUSENCIAS]
    # Solo se muestra: sale de la memoria corta de `ausencia` (120 s).
    for pk, mostrado in ausencia.reemplazos_mostrados(ausentes).items():
        vigentes[pk]["reemplazo"] = mostrado
    return vigentes


def vacaciones_sugeridas(usuario) -> dict | None:
    """Su solicitud de vacaciones en curso o por venir (aprobada primero; si
    no, pendiente), para proponer las fechas."""
    from apps.licencias.models import SolicitudPermiso

    hoy = timezone.localdate()
    base = (
        SolicitudPermiso.objects.filter(solicitante=usuario, hasta__gte=hoy)
        .filter(Q(descuento="vacaciones") | Q(flujo__nombre__icontains="vacaci"))
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


def _regreso(hasta, ahora):
    """La fecha de regreso de «Fuera de la oficina»: obligatoria y futura. Una
    fecha sola vale hasta el final de ese día, en hora local."""
    if hasta is None:
        raise ValidationError({"hasta": "Indique hasta cuándo estará fuera de la oficina."})
    if not isinstance(hasta, datetime.datetime):
        hasta = timezone.make_aware(datetime.datetime.combine(hasta, datetime.time(23, 59, 59)))
    elif timezone.is_naive(hasta):
        hasta = timezone.make_aware(hasta)
    if hasta <= ahora:
        raise ValidationError({"hasta": "Elija una fecha de regreso que todavía no pasó."})
    if hasta > ahora + FUERA_MAXIMO:
        raise ValidationError({"hasta": "Elija una fecha dentro de los próximos 6 meses."})
    return hasta


def _reasignar(usuario) -> None:
    """Lo que tenía por aprobar pasa a su reemplazo. Si falla, el estado queda
    guardado igual: la revisión periódica lo vuelve a intentar."""
    from apps.organizacion import ausencia

    try:
        ausencia.reasignar_pendientes(usuario)
    except Exception:  # noqa: BLE001
        logger.exception("No se pudieron reasignar las aprobaciones de %s", usuario.pk)


def guardar(usuario, datos: dict) -> dict:
    """Cambia su estado, sus vacaciones o su horario de almuerzo.

    - `estado` disponible / almuerzo / reunion / no_disponible (con `hasta`
      opcional para los dos últimos). Volver a «disponible» con unas
      vacaciones en curso las termina (regresó antes).
    - `estado` vacaciones: guarda `vacaciones_desde` y `vacaciones_hasta`.
    - `estado` fuera_oficina: `hasta` es obligatorio y futuro; si llega solo
      la fecha, vale hasta el final de ese día (hora local).
    - `quitar_vacaciones`: borra las fechas.

    Si con esto la persona queda ausente (vacaciones en curso o fuera de la
    oficina), lo que tenía por aprobar pasa a su reemplazo.
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
        hasta_nuevo = None
        if clave == EstadoChat.Estado.FUERA_OFICINA:
            # Se valida antes de tocar nada: un 400 no deja el estado a medias.
            hasta_nuevo = _regreso(datos.get("hasta"), ahora)
        estado.estado = clave
        estado.mensaje = (datos.get("mensaje") or "").strip()[:140]
        estado.hasta = None
        if clave == EstadoChat.Estado.ALMUERZO:
            estado.hasta = ahora + datetime.timedelta(minutes=estado.almuerzo_minutos)
        elif clave in (EstadoChat.Estado.REUNION, EstadoChat.Estado.NO_DISPONIBLE):
            hasta = datos.get("hasta")
            if hasta is not None and not isinstance(hasta, datetime.datetime):
                raise ValidationError({"hasta": "Indique también la hora."})
            if hasta is not None and hasta <= ahora:
                raise ValidationError({"hasta": "Elija una hora que todavía no pasó."})
            estado.hasta = hasta
        elif clave == EstadoChat.Estado.FUERA_OFICINA:
            estado.hasta = hasta_nuevo
        elif clave == EstadoChat.Estado.DISPONIBLE and _vacaciones(estado, hoy) == "en_curso":
            estado.vacaciones_desde = estado.vacaciones_hasta = None
            estado.mensaje_vacaciones = ""
    estado.save()
    if clave == EstadoChat.Estado.FUERA_OFICINA or (
        clave == EstadoChat.Estado.VACACIONES and _vacaciones(estado, hoy) == "en_curso"
    ):
        _reasignar(usuario)
    return mio(usuario)
