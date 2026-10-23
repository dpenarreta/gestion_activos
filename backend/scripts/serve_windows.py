"""Arranca el backend en el servidor de aplicaciones Windows (docs/despliegue-iis.md).

Lo ejecuta el servicio de Windows `IntranetBackend` (NSSM). Escucha solo en
127.0.0.1: el único que le habla es IIS, que reenvía `/api/` desde el puerto
público. Nadie de la red llega a este puerto directamente.

    python scripts\\serve_windows.py

Variables (en backend\\.env o en el entorno del servicio):
- BACKEND_PORT: puerto interno (8010 en SER-WEBAI).
- WAITRESS_THREADS: hilos que atienden peticiones a la vez (16 por defecto).
"""

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")


def main() -> None:
    from django.conf import settings
    from waitress import serve

    from config.wsgi import application

    puerto = int(os.environ.get("BACKEND_PORT") or getattr(settings, "BACKEND_PORT", 8010))
    hilos = int(os.environ.get("WAITRESS_THREADS", "16"))
    print(f"Backend en http://127.0.0.1:{puerto} ({hilos} hilos)", flush=True)
    serve(
        application,
        host="127.0.0.1",
        port=puerto,
        threads=hilos,
        # IIS (ARR) agrega X-Forwarded-For/Proto: así la auditoría registra la
        # IP real de quien hizo la petición y no la del propio servidor.
        trusted_proxy="127.0.0.1",
        trusted_proxy_headers={"x-forwarded-for", "x-forwarded-proto"},
        clear_untrusted_proxy_headers=True,
        # Las cargas masivas y los respaldos generan respuestas largas.
        channel_timeout=300,
    )


if __name__ == "__main__":
    main()
