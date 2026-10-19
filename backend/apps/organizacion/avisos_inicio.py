"""El aviso al iniciar sesión: leerlo (se crea vacío la primera vez) y
guardarlo, con su imagen y su versión."""

from .models import AvisoInicio


def actual() -> AvisoInicio:
    aviso = AvisoInicio.objects.first()
    if aviso is None:
        aviso = AvisoInicio.objects.create()
    return aviso


def guardar(aviso, datos) -> AvisoInicio:
    """Aplica lo validado; sube la versión (quien ya lo cerró lo vuelve a ver)
    y no deja en el disco la imagen reemplazada o quitada."""
    anterior = aviso.imagen.name if aviso.imagen else ""
    aviso.activo = datos["activo"]
    aviso.titulo = datos["titulo"].strip()
    aviso.contenido = datos["contenido"].strip()
    if datos.get("imagen"):
        aviso.imagen.save(datos["imagen"].name, datos["imagen"], save=False)
        aviso.content_type = datos["content_type"]
    elif datos.get("quitar_imagen"):
        aviso.imagen = ""
        aviso.content_type = ""
    aviso.version += 1
    aviso.save()
    if anterior and anterior != (aviso.imagen.name if aviso.imagen else ""):
        aviso.imagen.storage.delete(anterior)
    return aviso
