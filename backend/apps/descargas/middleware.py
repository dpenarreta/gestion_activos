"""Anota cada archivo que entrega la API, con su huella (26/10/2026).

No es el registro de descargas: ver un PDF en pantalla también pasa por aquí.
Es la constancia del servidor con la que se coteja lo que el navegador dice
que guardó (`services.registrar`). Un archivo es toda respuesta correcta de
la API que trae `Content-Disposition` o que no es JSON ni HTML.

Los archivos que se envían por partes (`FileResponse`) se miden mientras
salen: la huella se anota al terminar de enviarlos.
"""

import hashlib
import logging
import re

logger = logging.getLogger("apps.descargas")

NO_SON_ARCHIVO = ("application/json", "text/html", "application/problem+json")
_NOMBRE = re.compile(r"""filename\*?=(?:UTF-8'')?["']?([^"';]+)""", re.IGNORECASE)


def marcar(request, **referencia):
    """Lo que una vista dice del archivo que devuelve: queda junto a su huella.
    Con `sin_copia="…"`, la descarga se registra sin copia (los roles de
    pagos)."""
    destino = getattr(request, "_request", request)
    destino.descarga_referencia = referencia


def _es_archivo(request, response) -> bool:
    if response.status_code != 200 or not request.path.startswith("/api/"):
        return False
    if response.has_header("Content-Disposition"):
        return True
    tipo = (response.get("Content-Type") or "").split(";")[0].strip().lower()
    return bool(tipo) and tipo not in NO_SON_ARCHIVO


def _nombre(response) -> str:
    from urllib.parse import unquote

    encontrado = _NOMBRE.search(response.get("Content-Disposition", ""))
    return unquote(encontrado.group(1)).strip()[:255] if encontrado else ""


def _anotar(request, response, huella: str, tamano: int):
    from .models import ArchivoServido

    usuario = getattr(request, "user", None)
    if usuario is None or not usuario.is_authenticated:
        return
    try:
        ArchivoServido.objects.create(
            usuario=usuario,
            ruta=request.path[:300],
            sha256=huella,
            tamano=tamano,
            content_type=(response.get("Content-Type") or "")[:120],
            nombre=_nombre(response),
            referencia=getattr(request, "descarga_referencia", {}) or {},
        )
    except Exception:  # noqa: BLE001 — anotar nunca debe tumbar la respuesta
        logger.exception("No se pudo anotar el archivo servido %s", request.path)


class ArchivosServidosMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not _es_archivo(request, response):
            return response
        if response.streaming:
            original = response.streaming_content

            def medir():
                huella, tamano = hashlib.sha256(), 0
                for parte in original:
                    huella.update(parte)
                    tamano += len(parte)
                    yield parte
                _anotar(request, response, huella.hexdigest(), tamano)

            response.streaming_content = medir()
        else:
            contenido = response.content
            _anotar(request, response, hashlib.sha256(contenido).hexdigest(), len(contenido))
        return response
