"""Ejecuta un script o un comando de manage.py con la configuración de producción.

En el servidor de aplicaciones (docs/despliegue-iis.md) las tareas programadas
no pueden recibir DJANGO_SETTINGS_MODULE por variable de la máquina: ahí corre
también NEXO, que es otro Django, y una variable global le cambiaría la suya.
Por eso cada tarea pasa por aquí:

    python scripts\\produccion.py manage.py recalcular_indicadores
    pythonw scripts\\produccion.py scripts\\tarea_respaldo.py
"""

import os
import runpy
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Uso: produccion.py <script.py> [argumentos...]")
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.production"
    objetivo = BACKEND / sys.argv[1]
    sys.argv = [str(objetivo), *sys.argv[2:]]
    runpy.run_path(str(objetivo), run_name="__main__")


if __name__ == "__main__":
    main()
