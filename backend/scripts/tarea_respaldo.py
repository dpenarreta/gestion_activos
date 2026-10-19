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

En la misma pasada corre el ciclo de la Matriz de obligaciones
(`ciclo_matriz`): recordatorios, escalamientos y reintentos. Reutiliza esta
tarea en vez de registrar otra para que siga habiendo una sola, oculta y sin
ventana; cada aviso decide su hora por la configuración de su empresa.

Y, como mucho una vez por hora, la actualización automática de los dashboards
de Cartera conectados a una base de datos (`actualizar_fuentes_bd`): cada uno
decide si le toca por su frecuencia, semanal o mensual.

Y el ciclo de la Mesa de ayuda (`ciclo_soporte`): repartir la cola entre quien
empieza su turno, avisar y escalar por SLA, y cerrar lo atendido sin respuesta.

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
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        registro.close()
        return 1

    resultado = 0
    # Cada trabajo por su lado: un respaldo fallido no debe dejar sin
    # recordatorios a nadie, ni al revés.
    for comando, argumentos in (
        ("respaldar", ["--si-toca"]),
        ("ciclo_matriz", []),
        ("actualizar_fuentes_bd", ["--si-toca"]),
        ("ciclo_soporte", []),
        ("limpiar_notificaciones", []),
        ("limpiar_chat", []),
    ):
        try:
            call_command(comando, *argumentos, stdout=registro, stderr=registro)
        except Exception:  # noqa: BLE001
            # El respaldo ya anotó su fallo en la base; aquí queda la traza.
            traceback.print_exc()
            resultado = 1
    registro.flush()
    registro.close()
    return resultado


if __name__ == "__main__":
    sys.exit(main())
