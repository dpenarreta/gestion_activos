"""El estado «En reunión» y los recordatorios desde el calendario de Google
(17/11/2026).

Decisiones del usuario: cada persona conecta su calendario de Google si
quiere (solo desde la web, en Mi estado del chat). Mientras tiene una
reunión, su estado pasa solo a «En reunión» hasta la hora en que termina y
al acabar vuelve al que tenía. Además, 10 minutos antes de cada reunión le
llega un recordatorio con su título, en la campana y en el teléfono.

Seguridad y datos personales (LOPDP):

- **Permiso acotado**: `calendar.events.owned.readonly` («ver los eventos de
  sus calendarios», solo lectura y solo los calendarios propios). De cada
  evento se usan solo el título, el inicio y el fin; los invitados, la
  descripción, el lugar y los enlaces no se piden (`fields`) ni se guardan.
  El título no se guarda: va solo en el recordatorio. El correo no se lee.
- **OAuth oficial de Google**: la intranet nunca ve la contraseña. El
  `state` del retorno va firmado, dura 10 minutos y sirve una sola vez.
- **Credencial cifrada** (Fernet con una clave derivada de `SECRET_KEY`).
  Desconectar la revoca en Google y la borra.
- **Lo que la persona eligió se respeta**: solo se pasa a «En reunión» si
  está «Disponible»; si cambia su estado a mano durante la reunión, no se le
  toca al terminar.

La revisión corre cada 5 minutos (`estado_por_calendario`, en la tarea
Intranet-Ciclo): el estado puede tardar hasta 5 minutos en cambiar.
"""

import base64
import datetime
import hashlib
import logging
import secrets
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.utils import timezone

from .models import CalendarioGoogle, EstadoChat

logger = logging.getLogger(__name__)

ALCANCE = "https://www.googleapis.com/auth/calendar.events.owned.readonly"
URL_AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth"
URL_TOKEN = "https://oauth2.googleapis.com/token"
URL_REVOCAR = "https://oauth2.googleapis.com/revoke"
URL_EVENTOS = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
#: Solo lo necesario de cada evento: ni invitados (salvo la respuesta propia),
#: ni descripción, ni lugar, ni enlaces.
CAMPOS_EVENTO = (
    "items(id,summary,status,transparency,eventType,start,end,attendees(self,responseStatus))"
)
RECORDAR_ANTES = datetime.timedelta(minutes=10)
TIPO_RECORDATORIO = "chat.reunion"
SAL_ESTADO = "chat.calendario.estado"
VIGENCIA_ESTADO = 600
TIEMPO_ESPERA = 15
MENSAJE_REUNION = "En una reunión de su calendario"
PERMISO_PERDIDO = (
    "Google ya no permite consultar su calendario. Vuelva a conectarlo si quiere "
    "que su estado cambie solo."
)


class CalendarioNoDisponible(Exception):
    """Google Calendar no está configurado en este servidor."""


class ErrorDeGoogle(Exception):
    """Google rechazó la operación. `permiso_perdido` si la persona retiró el
    acceso o la credencial ya no vale."""

    def __init__(self, mensaje, permiso_perdido=False):
        super().__init__(mensaje)
        self.permiso_perdido = permiso_perdido


def configurado() -> bool:
    return bool(settings.GOOGLE_CALENDAR_CLIENT_ID and settings.GOOGLE_CALENDAR_CLIENT_SECRET)


# --- La credencial, cifrada ---------------------------------------------------------------


def _fernet():
    from cryptography.fernet import Fernet

    clave = hashlib.sha256(f"{settings.SECRET_KEY}:calendario-google".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(clave))


def cifrar(texto: str) -> str:
    return _fernet().encrypt(texto.encode()).decode()


def descifrar(texto: str) -> str:
    return _fernet().decrypt(texto.encode()).decode()


# --- Conectar ----------------------------------------------------------------------------


def _clave_nonce(usuario_id) -> str:
    return f"chat:calendario:nonce:{usuario_id}"


def url_para_conectar(usuario) -> str:
    """La dirección de Google a la que se manda a la persona para que acepte
    («ver su disponibilidad»). El `state` firmado la ata a su cuenta."""
    if not configurado():
        raise CalendarioNoDisponible()
    nonce = secrets.token_urlsafe(16)
    cache.set(_clave_nonce(usuario.pk), nonce, VIGENCIA_ESTADO)
    estado = signing.dumps({"u": usuario.pk, "n": nonce}, salt=SAL_ESTADO)
    parametros = {
        "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_CALENDAR_REDIRECT_URI,
        "response_type": "code",
        "scope": ALCANCE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "false",
        "state": estado,
    }
    if usuario.email:
        parametros["login_hint"] = usuario.email
    return f"{URL_AUTORIZAR}?{urlencode(parametros)}"


def usuario_del_estado(estado: str):
    """La cuenta que pidió conectar, si el `state` es válido, vigente y no se
    usó; si no, None. Un solo uso: el nonce se borra al leerlo."""
    from django.contrib.auth import get_user_model

    try:
        datos = signing.loads(estado or "", salt=SAL_ESTADO, max_age=VIGENCIA_ESTADO)
    except signing.BadSignature:
        return None
    clave = _clave_nonce(datos.get("u"))
    if not datos.get("n") or cache.get(clave) != datos["n"]:
        return None
    cache.delete(clave)
    return get_user_model().objects.filter(pk=datos["u"], is_active=True).first()


def conectar(usuario, codigo: str) -> CalendarioGoogle:
    """Cambia el código del retorno de Google por la credencial y la guarda
    cifrada. Exige que Google haya concedido justo `calendar.freebusy`."""
    respuesta = requests.post(
        URL_TOKEN,
        data={
            "code": codigo,
            "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
            "client_secret": settings.GOOGLE_CALENDAR_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_CALENDAR_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=TIEMPO_ESPERA,
    )
    if respuesta.status_code != 200:
        logger.warning("Calendario: Google rechazó el código (%s)", respuesta.status_code)
        raise ErrorDeGoogle("Google no aceptó la conexión. Intente de nuevo.")
    datos = respuesta.json()
    if ALCANCE not in (datos.get("scope") or "").split():
        raise ErrorDeGoogle("No se concedió el permiso de ver los eventos de su calendario.")
    credencial = datos.get("refresh_token")
    if not credencial:
        raise ErrorDeGoogle("Google no entregó una credencial duradera. Intente de nuevo.")
    registro, _ = CalendarioGoogle.objects.update_or_create(
        usuario=usuario,
        defaults={
            "credencial_cifrada": cifrar(credencial),
            "conectado_en": timezone.now(),
            "error": "",
        },
    )
    return registro


def desconectar(usuario) -> bool:
    """Revoca la credencial en Google (si se puede), la borra y, si el
    calendario había puesto «En reunión», devuelve el estado anterior."""
    registro = CalendarioGoogle.objects.filter(usuario=usuario).first()
    if registro is None:
        return False
    try:
        requests.post(
            URL_REVOCAR,
            data={"token": descifrar(registro.credencial_cifrada)},
            timeout=TIEMPO_ESPERA,
        )
    except Exception:  # noqa: BLE001 — se borra igual; Google la vence sola
        logger.warning("Calendario: no se pudo revocar la credencial de %s", usuario.pk)
    _devolver_estado(registro)
    registro.delete()
    return True


def estado_de(usuario) -> dict:
    registro = CalendarioGoogle.objects.filter(usuario=usuario).first()
    return {
        "disponible": configurado(),
        "conectado": registro is not None,
        "conectado_en": registro.conectado_en if registro else None,
        "error": registro.error if registro else "",
        "en_reunion_hasta": registro.reunion_puesta_hasta if registro else None,
    }


# --- Consultar Google --------------------------------------------------------------------


def _acceso(registro) -> str:
    respuesta = requests.post(
        URL_TOKEN,
        data={
            "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
            "client_secret": settings.GOOGLE_CALENDAR_CLIENT_SECRET,
            "refresh_token": descifrar(registro.credencial_cifrada),
            "grant_type": "refresh_token",
        },
        timeout=TIEMPO_ESPERA,
    )
    if respuesta.status_code == 400 and "invalid_grant" in respuesta.text:
        raise ErrorDeGoogle(PERMISO_PERDIDO, permiso_perdido=True)
    if respuesta.status_code != 200:
        raise ErrorDeGoogle(f"Google respondió {respuesta.status_code} al renovar el acceso.")
    return respuesta.json()["access_token"]


def _fecha(valor: dict):
    """El `dateTime` de un inicio o fin; None en un evento de todo el día."""
    texto = (valor or {}).get("dateTime")
    if not texto:
        return None
    return datetime.datetime.fromisoformat(texto.replace("Z", "+00:00"))


def eventos(registro, ahora=None) -> list[dict]:
    """Las reuniones de las próximas 8 horas: `{id, titulo, inicio, fin}`.
    Sin las canceladas, las marcadas como «libre», las de todo el día, las
    rechazadas por la persona ni las de ubicación de trabajo o fuera de la
    oficina."""
    ahora = ahora or timezone.now()
    respuesta = requests.get(
        URL_EVENTOS,
        headers={"Authorization": f"Bearer {_acceso(registro)}"},
        params={
            "timeMin": ahora.isoformat(),
            "timeMax": (ahora + datetime.timedelta(hours=8)).isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": 50,
            "fields": CAMPOS_EVENTO,
        },
        timeout=TIEMPO_ESPERA,
    )
    if respuesta.status_code in (401, 403):
        raise ErrorDeGoogle(PERMISO_PERDIDO, permiso_perdido=True)
    if respuesta.status_code != 200:
        raise ErrorDeGoogle(f"Google respondió {respuesta.status_code} al consultar.")
    lista = []
    for evento in respuesta.json().get("items", []):
        if evento.get("status") == "cancelled" or evento.get("transparency") == "transparent":
            continue
        if evento.get("eventType") not in (None, "default", "fromGmail"):
            continue
        propia = next((a for a in evento.get("attendees", []) if a.get("self")), None)
        if propia and propia.get("responseStatus") == "declined":
            continue
        inicio, fin = _fecha(evento.get("start")), _fecha(evento.get("end"))
        if inicio is None or fin is None:
            continue
        lista.append(
            {
                "id": evento.get("id", ""),
                "titulo": (evento.get("summary") or "Reunión sin título").strip()[:120],
                "inicio": inicio,
                "fin": fin,
            }
        )
    return lista


def ocupado_hasta(registro, ahora=None, lista=None):
    """Si ahora tiene una reunión, hasta cuándo (el fin del tramo que contiene
    a `ahora`, uniendo reuniones seguidas); si no, None."""
    ahora = ahora or timezone.now()
    lista = eventos(registro, ahora) if lista is None else lista
    tramos = sorted((e["inicio"], e["fin"]) for e in lista)
    fin = None
    for inicio, termina in tramos:
        if fin is None:
            if inicio <= ahora < termina:
                fin = termina
        elif inicio <= fin:
            fin = max(fin, termina)
        else:
            break
    return fin


def _empresa_de(usuario):
    membresia = usuario.membresias.order_by("-es_predeterminada", "id").first()
    return membresia.empresa if membresia else None


def recordar(registro, lista, ahora=None) -> int:
    """El recordatorio de cada reunión que empieza en los próximos 10
    minutos, una sola vez. En la campana va con el título; el push del
    teléfono es genérico (LOPDP)."""
    from apps.notificaciones import services as campana

    from .models import AvisoReunion

    ahora = ahora or timezone.now()
    enviados = 0
    for evento in lista:
        if not (ahora < evento["inicio"] <= ahora + RECORDAR_ANTES):
            continue
        huella = hashlib.sha256(evento["id"].encode()).hexdigest()
        _, nuevo = AvisoReunion.objects.get_or_create(
            calendario=registro, huella_evento=huella, inicio=evento["inicio"]
        )
        if not nuevo:
            continue
        minutos = max(1, round((evento["inicio"] - ahora).total_seconds() / 60))
        hora = timezone.localtime(evento["inicio"]).strftime("%H:%M")
        plural = "minuto" if minutos == 1 else "minutos"
        campana.notificar(
            [registro.usuario],
            tipo=TIPO_RECORDATORIO,
            titulo=f"Reunión a las {hora}: {evento['titulo']}"[:150],
            resumen=f"Empieza en {minutos} {plural}, según su calendario de Google.",
            enlace="/admin/chat",
            empresa=_empresa_de(registro.usuario),
        )
        enviados += 1
    return enviados


# --- Aplicar al estado del chat ----------------------------------------------------------


def _devolver_estado(registro) -> None:
    """Si «En reunión» lo puso el calendario y sigue puesto, vuelve al estado
    de antes. Si la persona lo cambió a mano, no se toca."""
    if not registro.reunion_puesta_hasta:
        return
    estado = EstadoChat.objects.filter(usuario_id=registro.usuario_id).first()
    if estado is not None and estado.estado == EstadoChat.Estado.REUNION:
        estado.estado = registro.estado_previo or EstadoChat.Estado.DISPONIBLE
        estado.mensaje = registro.mensaje_previo
        estado.hasta = registro.hasta_previo
        estado.save(update_fields=["estado", "mensaje", "hasta", "updated_at"])
    registro.reunion_puesta_hasta = None
    registro.estado_previo = registro.mensaje_previo = ""
    registro.hasta_previo = None


def aplicar(registro, fin, ahora=None) -> str:
    """Pone o quita «En reunión» según `fin` (hasta cuándo está ocupada, o
    None). Devuelve qué hizo: «puesto», «extendido», «devuelto» o «nada»."""
    ahora = ahora or timezone.now()
    estado, _ = EstadoChat.objects.get_or_create(usuario_id=registro.usuario_id)
    hecho = "nada"
    if fin is not None:
        if registro.reunion_puesta_hasta:
            if estado.estado != EstadoChat.Estado.REUNION:
                # Lo cambió a mano durante la reunión: se respeta.
                registro.reunion_puesta_hasta = None
            elif fin != registro.reunion_puesta_hasta:
                estado.hasta = fin
                estado.save(update_fields=["hasta", "updated_at"])
                registro.reunion_puesta_hasta = fin
                hecho = "extendido"
        else:
            vencido = estado.hasta is not None and estado.hasta <= ahora
            disponible = estado.estado == EstadoChat.Estado.DISPONIBLE or vencido
            if disponible:
                registro.estado_previo = EstadoChat.Estado.DISPONIBLE
                registro.mensaje_previo = "" if vencido else estado.mensaje
                registro.hasta_previo = None
                estado.estado = EstadoChat.Estado.REUNION
                estado.mensaje = MENSAJE_REUNION
                estado.hasta = fin
                estado.save(update_fields=["estado", "mensaje", "hasta", "updated_at"])
                registro.reunion_puesta_hasta = fin
                hecho = "puesto"
    elif registro.reunion_puesta_hasta:
        _devolver_estado(registro)
        hecho = "devuelto"
    registro.ultimo_chequeo = ahora
    registro.save()
    return hecho


def revisar_todos(ahora=None) -> dict:
    """La revisión de cada 5 minutos: cada calendario conectado y sin
    problemas, uno por uno (el fallo de uno no detiene a los demás)."""
    ahora = ahora or timezone.now()
    resumen = {"revisados": 0, "puestos": 0, "devueltos": 0, "recordatorios": 0, "errores": 0}
    if not configurado():
        return resumen
    from .models import AvisoReunion

    # Los recordatorios ya enviados se olvidan a los dos días.
    AvisoReunion.objects.filter(inicio__lt=ahora - datetime.timedelta(days=2)).delete()
    registros = list(
        CalendarioGoogle.objects.filter(error="", usuario__is_active=True).select_related("usuario")
    )
    for registro in registros:
        try:
            lista = eventos(registro, ahora)
            hecho = aplicar(registro, ocupado_hasta(registro, ahora, lista), ahora)
            resumen["recordatorios"] += recordar(registro, lista, ahora)
        except ErrorDeGoogle as error:
            resumen["errores"] += 1
            if error.permiso_perdido:
                _devolver_estado(registro)
                registro.error = str(error)[:200]
                registro.save()
            logger.warning("Calendario de %s: %s", registro.usuario_id, error)
            continue
        except Exception:  # noqa: BLE001
            resumen["errores"] += 1
            logger.exception("Calendario de %s: error inesperado", registro.usuario_id)
            continue
        resumen["revisados"] += 1
        resumen["puestos"] += hecho == "puesto"
        resumen["devueltos"] += hecho == "devuelto"
    return resumen
