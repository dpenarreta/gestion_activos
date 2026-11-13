"""El aviso push de la app «Intranet LCE», por el Expo Push Service.

Cada notificación de la campana le llega además, como push, a los teléfonos de
la persona que tienen la app con una sesión vigente (US-009, 12/11/2026).

Reglas que no se negocian:

- **Push genérico (LOPDP, 12/11/2026).** El mensaje pasa por Expo, Google y
  Apple: solo lleva «Tiene una notificación nueva de {módulo}» y los IDs
  (`notificacion_id`, `modulo`). Nunca el título, el resumen, el enlace ni un
  dato de la persona: eso se lee dentro de la app, con sesión.
- **Nunca tumba lo que lo dispara.** Se envía después del commit y en un hilo
  aparte (`programar`), con un timeout corto; cualquier fallo queda en el log
  `apps.notificaciones` y nada más. No hay Celery en el proyecto.
- **Solo sesiones vigentes.** Un teléfono cuya sesión se revocó o venció no
  recibe nada, aunque su fila siga activa (`Session.revoke` no la apaga).
- **Hilos con tope.** Un solo grupo de 2 hilos por proceso (`_grupo`): mil
  avisos seguidos no abren mil hilos ni mil conexiones a SQL Server; esperan
  en cola. Los hilos no son daemon, así que el intérprete espera la cola al
  salir y el push de los comandos programados (`ciclo_matriz`,
  `ciclo_escritorio`, que terminan enseguida) no se pierde (12/11/2026).
- **Sin reintentos agresivos.** Un intento por lote; los recibos de Expo
  (receipts) quedan para después: aquí se tratan solo los errores del ticket.
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db import connection
from django.utils import timezone

from .modulos import describir

logger = logging.getLogger("apps.notificaciones")

#: Expo acepta hasta 100 mensajes por petición.
TAMANO_LOTE = 100
#: Segundos de conexión y de lectura: Expo que no responde no debe dejar
#: hilos colgados. Un lote tarda como mucho unos 8 s.
TIMEOUT = (3, 5)
#: Tras un fallo de red (sin conexión o sin respuesta), el envío se pausa en
#: el proceso: si el servidor no tiene salida a exp.host, cada aviso esperaría
#: su timeout y un comando programado tardaría N × 8 s en cerrar (12/11/2026,
#: ronda 2 de la US-009).
PAUSA_SEGUNDOS = 60
#: Hasta cuándo (reloj `time.monotonic`) está en pausa. 0: sin pausa.
_pausa_hasta = 0.0
#: El reloj de la pausa (las pruebas lo sustituyen).
_reloj = time.monotonic

TITULO = "Intranet LCE"
CUERPO = "Tiene una notificación nueva de {modulo}"
#: El error del ticket que dice que el token ya no sirve (app desinstalada).
DEVICE_NOT_REGISTERED = "DeviceNotRegistered"


def mensaje(token: str, *, notificacion_id: int, modulo: str, empresa: int | None = None) -> dict:
    """El mensaje de Expo para un teléfono. Solo el nombre del módulo y los IDs.

    `empresa` es el id de la empresa de la notificación (o None si es de la
    cuenta): la app lo usa como `X-Empresa` al abrir el detalle. Un id no es un
    dato personal (decisión del Tech Lead, US-009).
    """
    return {
        "to": token,
        "title": TITULO,
        "body": CUERPO.format(modulo=describir(modulo)[0]),
        "data": {"notificacion_id": notificacion_id, "modulo": modulo, "empresa": empresa},
        "sound": "default",
        "channelId": "default",
    }


def _pausar() -> None:
    global _pausa_hasta
    _pausa_hasta = _reloj() + PAUSA_SEGUNDOS


def en_pausa() -> bool:
    return _reloj() < _pausa_hasta


def _cabeceras() -> dict:
    cabeceras = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
    }
    # El token de acceso de Expo es opcional (seguridad del envío en la
    # cuenta de Expo); vive solo en el .env del servidor, nunca en `mobile/`.
    if settings.EXPO_ACCESS_TOKEN:
        cabeceras["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    return cabeceras


def _lotes(elementos: list, tamano: int = TAMANO_LOTE):
    for inicio in range(0, len(elementos), tamano):
        yield elementos[inicio : inicio + tamano]


def _enviar_lote(sesion, lote: list[tuple[int, dict]]) -> tuple[list[int], list[int]]:
    """Manda un lote. Devuelve (ids enviados, ids con `DeviceNotRegistered`).

    Ante cualquier fallo de red o una respuesta que no se entiende, registra
    y devuelve listas vacías: el lote se pierde, no se reintenta.
    """
    import requests

    try:
        respuesta = sesion.post(
            settings.EXPO_PUSH_URL,
            json=[m for _, m in lote],
            headers=_cabeceras(),
            timeout=TIMEOUT,
        )
    except (requests.ConnectionError, requests.Timeout) as exc:
        _pausar()
        logger.warning(
            "Expo no respondió al push de %s dispositivos; se pausa el envío %s s: %s",
            len(lote),
            PAUSA_SEGUNDOS,
            exc,
        )
        return [], []
    except requests.RequestException as exc:
        logger.warning("No se pudo enviar el push de %s dispositivos: %s", len(lote), exc)
        return [], []

    if respuesta.status_code >= 400:
        logger.warning(
            "Expo rechazó el push de %s dispositivos (HTTP %s)",
            len(lote),
            respuesta.status_code,
        )
        return [], []

    try:
        tickets = respuesta.json().get("data")
    except (ValueError, AttributeError):
        tickets = None
    if not isinstance(tickets, list) or len(tickets) != len(lote):
        logger.warning("Respuesta de Expo inesperada para %s dispositivos", len(lote))
        return [], []

    enviados, no_registrados = [], []
    for (dispositivo_id, _), ticket in zip(lote, tickets, strict=True):
        ticket = ticket if isinstance(ticket, dict) else {}
        if ticket.get("status") == "ok":
            enviados.append(dispositivo_id)
            continue
        detalles = ticket.get("details")
        error = detalles.get("error") if isinstance(detalles, dict) else None
        if error == DEVICE_NOT_REGISTERED:
            no_registrados.append(dispositivo_id)
        else:
            # Sin el token en el log: identifica un teléfono.
            logger.warning(
                "Expo no aceptó el push del dispositivo %s: %s",
                dispositivo_id,
                error or ticket.get("message") or "sin detalle",
            )
    return enviados, no_registrados


def enviar(notificaciones: list[dict]) -> int:
    """Envía el push de cada notificación a los teléfonos vigentes de su dueño.

    `notificaciones`: `[{"id", "usuario_id", "modulo"}]`. Devuelve cuántos
    mensajes aceptó Expo. Nunca lanza excepciones.
    """
    try:
        from .models import DispositivoPush

        if not notificaciones:
            return 0
        ahora = timezone.now()
        por_usuario: dict[int, list[dict]] = {}
        for notificacion in notificaciones:
            por_usuario.setdefault(notificacion["usuario_id"], []).append(notificacion)

        dispositivos = DispositivoPush.objects.filter(
            usuario_id__in=list(por_usuario),
            usuario__is_active=True,
            activo=True,
            # La sesión tiene que seguir vigente: revocar una sesión (logout,
            # cambio de contraseña, cierre desde «Sesiones»…) corta el push
            # aunque la fila no se haya apagado.
            session__revoked_at__isnull=True,
            session__expires_at__gt=ahora,
        ).values_list("id", "usuario_id", "token")

        mensajes = [
            (
                dispositivo_id,
                mensaje(
                    token,
                    notificacion_id=n["id"],
                    modulo=n["modulo"],
                    empresa=n.get("empresa_id"),
                ),
            )
            for dispositivo_id, usuario_id, token in dispositivos
            for n in por_usuario.get(usuario_id, [])
        ]
        if not mensajes:
            return 0

        enviados, no_registrados = set(), set()
        # Una conexión HTTP para todos los lotes de este envío (no global: el
        # `Session` de requests no es seguro entre hilos).
        import requests

        with requests.Session() as sesion:
            for lote in _lotes(mensajes):
                if en_pausa():
                    # Sin red hacia Expo: los lotes que faltan no esperan su
                    # timeout uno por uno.
                    break
                ok, fuera = _enviar_lote(sesion, lote)
                enviados.update(ok)
                no_registrados.update(fuera)

        if no_registrados:
            DispositivoPush.objects.filter(pk__in=list(no_registrados)).update(
                activo=False, updated_at=timezone.now()
            )
            logger.info("Se desactivaron %s dispositivos sin registro en Expo", len(no_registrados))
        enviados -= no_registrados
        if enviados:
            DispositivoPush.objects.filter(pk__in=list(enviados)).update(
                ultimo_envio_en=timezone.now()
            )
        return sum(1 for dispositivo_id, _ in mensajes if dispositivo_id in enviados)
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo enviar el push de %s notificaciones", len(notificaciones))
        return 0


def _en_hilo(notificaciones: list[dict]) -> None:
    try:
        if en_pausa():
            logger.info(
                "Push de %s notificaciones omitido: envío en pausa tras un fallo de red",
                len(notificaciones),
            )
            return
        enviar(notificaciones)
    finally:
        # Cada hilo abre su propia conexión a la base: se cierra al terminar
        # para no dejarla abierta en SQL Server.
        connection.close()


#: Los hilos del push, compartidos por todo el proceso; se crean al primer uso.
_GRUPO: ThreadPoolExecutor | None = None
_GRUPO_CANDADO = threading.Lock()
HILOS = 2


def _grupo() -> ThreadPoolExecutor:
    """El grupo de hilos del proceso.

    Sin `atexit` propio: `concurrent.futures` ya registra el suyo, que al salir
    el intérprete espera los envíos en cola (sus hilos no son daemon). El
    timeout es de conexión y de lectura (3 + 5 s), así que cada lote tarda como
    mucho unos 8 s; y tras un fallo de red el envío se pausa (`PAUSA_SEGUNDOS`)
    y lo que queda en cola se omite sin esperar, así que la espera al cerrar un
    comando o el servidor es acotada.
    """
    global _GRUPO
    if _GRUPO is None:
        with _GRUPO_CANDADO:
            if _GRUPO is None:
                _GRUPO = ThreadPoolExecutor(max_workers=HILOS, thread_name_prefix="push-expo")
    return _GRUPO


def _lanzar(notificaciones: list[dict]) -> None:
    """Punto de inyección: las pruebas lo sustituyen para enviar sin hilo."""
    _grupo().submit(_en_hilo, notificaciones)


def programar(notificaciones: list[dict]) -> None:
    """Lanza el envío fuera del request. Lo llama `services.notificar` en el
    `on_commit`: la notificación ya está guardada cuando esto corre."""
    try:
        if not settings.PUSH_HABILITADO or not notificaciones:
            return
        _lanzar(notificaciones)
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo programar el push")
