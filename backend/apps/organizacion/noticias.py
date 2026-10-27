"""El carrusel de noticias de Inicio (19/10/2026).

Imágenes (JPG, PNG o WebP, hasta 5 MB) que Talento Humano publica con un día
de inicio y uno de fin: fuera de esas fechas no se muestran. La velocidad del
carrusel (segundos por imagen) es un ajuste de la empresa.
"""

from pathlib import PurePath

from django.utils import timezone
from rest_framework import serializers

from apps.adjuntos.models import FIRMAS

from .models import AjustesCarrusel, NoticiaInicio

EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp"}
TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024
TIPOS = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
# 5 como mínimo: menos no alcanza para leer una noticia (auditoría UX/UI).
SEGUNDOS_MIN, SEGUNDOS_MAX = 5, 60


def validar_imagen(archivo) -> str:
    if archivo.size == 0:
        raise serializers.ValidationError("La imagen está vacía.")
    if archivo.size > TAMANO_MAXIMO_BYTES:
        raise serializers.ValidationError(
            f"La imagen pesa {archivo.size / (1024 * 1024):.1f} MB y el máximo es 5 MB."
        )
    extension = PurePath(archivo.name).suffix.lower()
    if extension not in EXTENSIONES:
        raise serializers.ValidationError("Solo se admiten imágenes JPG, PNG o WebP.")
    cabecera = archivo.read(12)
    archivo.seek(0)
    valida = any(cabecera.startswith(firma) for firma in FIRMAS[extension])
    if extension == ".webp":
        valida = valida and cabecera[8:12] == b"WEBP"
    if not valida:
        raise serializers.ValidationError(
            f"El contenido no corresponde a una imagen {extension}. "
            "Verifique que no se haya renombrado la extensión."
        )
    return extension


def hoy():
    return timezone.localdate()


def vigentes():
    """Las que se muestran hoy en Inicio, en su orden."""
    dia = hoy()
    return NoticiaInicio.objects.filter(publicar_desde__lte=dia, publicar_hasta__gte=dia)


def estado(noticia) -> str:
    dia = hoy()
    if noticia.publicar_desde > dia:
        return "programada"
    if noticia.publicar_hasta < dia:
        return "vencida"
    return "publicada"


def ajustes() -> AjustesCarrusel:
    actual = AjustesCarrusel.objects.first()
    if actual is None:
        actual = AjustesCarrusel.objects.create()
    return actual
