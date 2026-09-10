"""Cabecera Content-Security-Policy.

El sistema guarda el token de sesión en `localStorage`, que es legible por
cualquier script que llegue a ejecutarse en la página. Hoy no hay por dónde
inyectar uno —React escapa por defecto y no se usa `dangerouslySetInnerHTML` en
ninguna parte— pero eso es una propiedad del código de hoy, no una garantía: una
dependencia comprometida o un campo que alguien decida renderizar como HTML
convertirían un XSS en robo de sesión inmediato.

La política declara de dónde puede venir cada cosa, así que un script inyectado
desde otro origen no llega a ejecutarse. Se sirve desde Django porque es quien
responde a `/api/` y al panel de administración; el servidor que sirva el
frontend compilado debe publicar la suya, y ese es el punto que de verdad
protege al usuario (ver docs/security-review.md).
"""

from django.conf import settings

#: `default-src 'none'` obliga a declarar cada tipo de recurso: lo que no está
#: escrito no carga, en vez de colarse por una directiva olvidada.
POLITICA = (
    "default-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'; "
    # El panel de Django trae estilos e imágenes propios y algún script en
    # línea; sin `unsafe-inline` en `style-src` deja de verse.
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'"
)


class ContentSecurityPolicyMiddleware:
    """Añade la cabecera a toda respuesta que no la traiga ya.

    Se respeta una cabecera existente para que un proxy o el servidor de
    estáticos puedan imponer la suya —más restrictiva o adaptada al frontend—
    sin que esta la pise.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        respuesta = self.get_response(request)
        if "Content-Security-Policy" not in respuesta:
            respuesta["Content-Security-Policy"] = (
                getattr(settings, "CONTENT_SECURITY_POLICY", "") or POLITICA
            )
        return respuesta
