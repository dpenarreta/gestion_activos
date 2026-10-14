"""Lo que ejecuta la tarea programada del respaldo, sin ventana de consola.

La tarea corre cada cinco minutos (ver docs/respaldos.md). Con `python.exe`,
Windows abre una ventana negra en cada pasada: doce veces por hora una consola
que aparece y desaparece en medio del trabajo de quien usa el equipo. Con
`pythonw.exe` no hay ventana, pero tampoco hay dónde escribir: `sys.stdout` es
`None` y el primer `self.stdout.write` del comando fallaría.

Este script resuelve las dos cosas: corre bajo `pythonw.exe` y manda la salida a
`logs/tarea-respaldo.log`, que es lo único que alguien mirará el día que
pregunte por qué no hay respaldos. El resultado de cada respaldo, además, queda
en la base y se ve en *Configuración → Respaldos*.

    pythonw.exe scripts\\tarea_respaldo.py
"""

import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
REGISTRO = BACKEND / "logs" / "tarea-respaldo.log"

#: Pasado este tamaño el registro se recorta en vez de crecer sin fin: con una
#: línea por pasada, cinco minutos dan unas 300 líneas al día.
TAMANO_MAXIMO = 1024 * 1024


def _no_interrumpir() -> None:
    """Que el respaldo no se note mientras alguien trabaja en el equipo.

    La tarea ya corre con `pythonw.exe` —sin ventana—, oculta y con prioridad
    baja. Esto es la segunda línea, por si alguien la registra con
    `python.exe`: se suelta de la consola (Windows la cierra si nadie más la
    usa) y baja la prioridad del proceso, para que comprimir los adjuntos no le
    quite procesador a lo que se esté haciendo.
    """
    if os.name != "nt":
        return
    import ctypes

    kernel32 = ctypes.windll.kernel32
    if kernel32.GetConsoleWindow():
        kernel32.FreeConsole()
    BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
    kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)


def _abrir_registro():
    REGISTRO.parent.mkdir(parents=True, exist_ok=True)
    if REGISTRO.exists() and REGISTRO.stat().st_size > TAMANO_MAXIMO:
        REGISTRO.replace(REGISTRO.with_suffix(".log.1"))
    return open(REGISTRO, "a", encoding="utf-8")


def main() -> int:
    _no_interrumpir()
    registro = _abrir_registro()
    sys.stdout = sys.stderr = registro
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

    print(f"--- {datetime.now():%Y-%m-%d %H:%M:%S}", flush=True)
    try:
        import django

        django.setup()
        from django.core.management import call_command

        call_command("respaldar", "--si-toca", stdout=registro, stderr=registro)
        return 0
    except Exception:  # noqa: BLE001
        # El comando ya anotó el fallo en la base; aquí queda la traza completa.
        traceback.print_exc()
        return 1
    finally:
        registro.flush()
        registro.close()


if __name__ == "__main__":
    sys.exit(main())
