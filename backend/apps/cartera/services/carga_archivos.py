"""Acceso al archivo de una carga ya procesada.

Vive en `services/` y no en `views.py` porque hay dos consumidores que no son vistas: el reproceso
(`services/reproceso.py`) y la propia vista de configuración de componentes. `views.py` lo
reexporta con el nombre que ya usaba, igual que hace con `_aplicar_alias_columnas`.
"""

from django.conf import settings

from ..exceptions import CarteraError
from . import excel_reader

# Nombre de hoja con el que se escribe la copia permanente (`_guardar_archivo_permanente`). Es
# fijo y propio del proyecto: no tiene por qué coincidir con el nombre de hoja del Excel original,
# que se conserva aparte en `CargaArchivo.nombre_hoja` para poder releer el temporal.
HOJA_ARCHIVO_PERMANENTE = 'Datos'


def leer_archivo_de_carga(carga):
    """Lee el archivo de una carga — preferentemente su copia permanente
    (`archivo_permanente_nombre`, escrita al aplicar la plantilla, nunca se limpia
    automáticamente) para que el mapeo de columnas se pueda seguir ajustando mucho después de
    subir el archivo; si todavía no se aplicó ningún mapeo, cae al archivo temporal (se limpia a
    las 24h, `clean_temp_uploads`).

    Devuelve `(ruta, dataframe)`.
    """
    if carga.archivo_permanente_nombre:
        ruta = settings.CARTERA_ARCHIVOS_DIR / carga.archivo_permanente_nombre
        return ruta, excel_reader.leer_hoja(str(ruta), HOJA_ARCHIVO_PERMANENTE)
    if not carga.archivo_temp_nombre:
        raise CarteraError('El archivo temporal ya no está disponible; vuelve a cargarlo.', codigo='ARCHIVO_NO_DISPONIBLE')
    ruta_temp = settings.CARTERA_TEMP_UPLOADS_DIR / carga.archivo_temp_nombre
    return ruta_temp, excel_reader.leer_hoja(str(ruta_temp), carga.nombre_hoja)
