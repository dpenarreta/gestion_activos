"""Creación diferida de los directorios de trabajo de `cartera`.

`settings.py` creaba `CARTERA_TEMP_UPLOADS_DIR` y `CARTERA_ARCHIVOS_DIR` con `.mkdir()` al
importarse. Importar el módulo de configuración pasaba así a tocar el sistema de archivos, lo que
rompe en cualquier contexto donde no se pueda escribir (una imagen de contenedor en construcción,
un `manage.py --help`, un despliegue con el volumen todavía sin montar) aunque el comando no fuera
a escribir ningún archivo. Y creaba los directorios incluso para comandos que nunca los usan.

Se crean ahora justo antes de escribir, que es el único momento en que hacen falta.
"""


def asegurar_directorio(ruta):
    """Crea el directorio si no existe y devuelve la ruta, para poder encadenar:

        ruta = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre
    """
    ruta.mkdir(parents=True, exist_ok=True)
    return ruta
