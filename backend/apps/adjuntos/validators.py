"""Validación de los archivos que entran al sistema.

Tres comprobaciones, en este orden: tamaño, extensión y firma del contenido.
El orden importa —rechazar por tamaño antes de leer nada evita cargar un
archivo enorme para descubrir después que además tenía la extensión mal.
"""

from pathlib import PurePath

from rest_framework import serializers

from .models import EXTENSIONES_PERMITIDAS, FIRMAS, TAMANO_MAXIMO_BYTES

#: Cuántos bytes se leen para comprobar la firma. Con 8 basta para todas las
#: que se aceptan; leer el archivo entero no aportaría nada.
BYTES_DE_FIRMA = 8


def validar_archivo(archivo):
    """Valida un `UploadedFile` y devuelve su extensión normalizada."""
    if archivo.size == 0:
        raise serializers.ValidationError("El archivo está vacío.")

    if archivo.size > TAMANO_MAXIMO_BYTES:
        megas = TAMANO_MAXIMO_BYTES // (1024 * 1024)
        raise serializers.ValidationError(
            f"El archivo pesa {archivo.size / (1024 * 1024):.1f} MB y el máximo es {megas} MB."
        )

    extension = PurePath(archivo.name).suffix.lower()
    if extension not in EXTENSIONES_PERMITIDAS:
        permitidas = ", ".join(sorted(EXTENSIONES_PERMITIDAS))
        raise serializers.ValidationError(
            f"No se admiten archivos «{extension or 'sin extensión'}». Permitidos: {permitidas}."
        )

    cabecera = archivo.read(BYTES_DE_FIRMA)
    # Se devuelve el puntero al inicio: si no, el archivo se guardaría sin sus
    # primeros bytes y quedaría corrupto.
    archivo.seek(0)
    if not any(cabecera.startswith(firma) for firma in FIRMAS[extension]):
        raise serializers.ValidationError(
            f"El contenido del archivo no corresponde a un {extension}. "
            "Verifique que no se haya renombrado la extensión."
        )

    return extension
