"""Extracción de metadatos de red/dispositivo del request, reutilizable
entre apps (autenticación, auditoría, etc.)."""


def get_client_ip(request) -> str | None:
    """La IP del cliente según los proxies de confianza (`NUM_PROXIES`).

    X-Forwarded-For lo puede mandar cualquiera, así que su primer valor es lo
    que el cliente quiso poner: tomarlo dejaba falsificar la IP de la auditoría
    y saltarse el bloqueo por IP del inicio de sesión. Cada proxy **agrega** al
    final la dirección de quien se le conectó; con `NUM_PROXIES` proxies
    delante (en producción, uno: IIS con ARR) la buena es la que agregó el más
    externo, la N-ésima contando desde el final. Es el mismo criterio que usa
    DRF para el throttling, así que la IP de la auditoría y la del límite de
    peticiones coinciden (auditoría de seguridad, 29/10/2026).

    Sin cabecera, o con `NUM_PROXIES=0`, vale REMOTE_ADDR.
    """
    from rest_framework.settings import api_settings

    remote_addr = request.META.get("REMOTE_ADDR")
    num_proxies = api_settings.NUM_PROXIES
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if not forwarded_for or not num_proxies:
        return remote_addr
    direcciones = [d.strip() for d in forwarded_for.split(",") if d.strip()]
    if not direcciones:
        return remote_addr
    return direcciones[-min(num_proxies, len(direcciones))]


def get_user_agent(request) -> str:
    return request.META.get("HTTP_USER_AGENT", "")


_BROWSER_MARKERS = [
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Chrome/", "Chrome"),
    ("Firefox/", "Firefox"),
    ("Safari/", "Safari"),
]

_OS_MARKERS = [
    ("Windows", "Windows"),
    ("Mac OS", "macOS"),
    ("Android", "Android"),
    ("iPhone", "iOS"),
    ("iPad", "iOS"),
    ("Linux", "Linux"),
]


def parse_user_agent(user_agent: str) -> dict:
    """Heurística simple de "mejor esfuerzo" por substrings — no reemplaza
    una librería dedicada de parsing de user-agent. Suficiente para mostrar
    contexto legible en auditoría, no para decisiones de seguridad."""
    ua = user_agent or ""

    browser = next((label for marker, label in _BROWSER_MARKERS if marker in ua), "Desconocido")
    operating_system = next((label for marker, label in _OS_MARKERS if marker in ua), "Desconocido")

    ua_lower = ua.lower()
    if "mobile" in ua_lower:
        device = "Móvil"
    elif "tablet" in ua_lower or "ipad" in ua_lower:
        device = "Tablet"
    else:
        device = "Escritorio"

    return {"browser": browser, "operating_system": operating_system, "device": device}


def get_request_context(request) -> dict:
    """Contexto completo de un request, para pasar a `record_audit_event`:
    IP, user-agent crudo, navegador/SO/dispositivo (mejor esfuerzo) y el
    correlation id ya propagado por `apps.core.middleware.RequestIDMiddleware`."""
    user_agent = get_user_agent(request)
    parsed = parse_user_agent(user_agent)
    return {
        "ip_address": get_client_ip(request),
        "user_agent": user_agent,
        "browser": parsed["browser"],
        "operating_system": parsed["operating_system"],
        "device": parsed["device"],
        "correlation_id": getattr(request, "request_id", ""),
    }
