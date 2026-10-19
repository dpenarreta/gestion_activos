"""Los documentos institucionales (códigos de conducta y reglamentos): qué
archivos se aceptan y cómo se validan.

PDF para leer en el visor del sistema, y Word por si la norma solo existe
así (se descarga). La firma del contenido se comprueba como en los adjuntos:
no es un antivirus, pero evita un ejecutable renombrado a `.pdf`.
"""

from pathlib import PurePath

from rest_framework import serializers

from apps.adjuntos.models import FIRMAS

EXTENSIONES = {".pdf", ".docx"}

#: 20 MB: un reglamento escaneado pesa más que una factura.
TAMANO_MAXIMO_BYTES = 20 * 1024 * 1024

TIPOS = {
    ".pdf": "application/pdf",
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
}


def validar(archivo) -> str:
    """Valida un `UploadedFile` y devuelve su extensión."""
    if archivo.size == 0:
        raise serializers.ValidationError("El archivo está vacío.")
    if archivo.size > TAMANO_MAXIMO_BYTES:
        raise serializers.ValidationError(
            f"El archivo pesa {archivo.size / (1024 * 1024):.1f} MB y el máximo es "
            f"{TAMANO_MAXIMO_BYTES // (1024 * 1024)} MB."
        )
    extension = PurePath(archivo.name).suffix.lower()
    if extension not in EXTENSIONES:
        raise serializers.ValidationError(
            f"No se admiten archivos «{extension or 'sin extensión'}». Permitidos: PDF y Word (.docx)."
        )
    cabecera = archivo.read(8)
    archivo.seek(0)
    if not any(cabecera.startswith(firma) for firma in FIRMAS[extension]):
        raise serializers.ValidationError(
            f"El contenido del archivo no corresponde a un {extension}. "
            "Verifique que no se haya renombrado la extensión."
        )
    return extension
