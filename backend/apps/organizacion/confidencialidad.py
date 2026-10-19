"""El acuerdo de confidencialidad de los códigos de conducta (19/10/2026).

- Se presenta al entrar a «Códigos de conducta» a quien no lo tenga aceptado.
- Sin aceptarlo, no se entrega el contenido de ningún documento (lo comprueba
  el servidor, no solo la pantalla).
- Aceptarlo vale para todos los documentos, hasta que cualquiera se agregue,
  modifique o borre: entonces se pide de nuevo.
- Cada aceptación queda guardada con su fecha y el texto que se aceptó.
"""

from django.db.models import F

from .models import AcuerdoConfidencialidad, AceptacionConfidencialidad

TITULO = "Acuerdo de confidencialidad"
TEXTO = (
    "Los códigos de conducta, reglamentos y demás documentos de esta sección "
    "son de uso interno de la empresa.\n\n"
    "Al aceptar, me comprometo a:\n"
    "• Usar su contenido solo para fines laborales.\n"
    "• No copiarlos, reenviarlos ni compartirlos fuera de la empresa sin "
    "autorización.\n"
    "• Cumplir las normas que contienen.\n\n"
    "La fecha de esta aceptación queda registrada."
)


def acuerdo() -> AcuerdoConfidencialidad:
    """El de la empresa activa; si no existe, se crea con el texto inicial."""
    actual = AcuerdoConfidencialidad.objects.first()
    if actual is None:
        actual = AcuerdoConfidencialidad.objects.create(titulo=TITULO, texto=TEXTO)
    return actual


def ultima_aceptacion(usuario, version=None):
    filas = AceptacionConfidencialidad.objects.filter(usuario=usuario)
    if version is not None:
        filas = filas.filter(version_documentos=version)
    return filas.order_by("-aceptado_en").first()


def aceptado(usuario) -> bool:
    return ultima_aceptacion(usuario, acuerdo().version_documentos) is not None


def aceptar(usuario) -> AceptacionConfidencialidad:
    vigente = acuerdo()
    ya = ultima_aceptacion(usuario, vigente.version_documentos)
    if ya is not None:
        return ya
    return AceptacionConfidencialidad.objects.create(
        usuario=usuario,
        version_documentos=vigente.version_documentos,
        titulo_aceptado=vigente.titulo,
        texto_aceptado=vigente.texto,
    )


def documentos_cambiaron() -> None:
    """Se agregó, modificó o borró un documento: todos aceptan de nuevo."""
    vigente = acuerdo()
    AcuerdoConfidencialidad.objects.filter(pk=vigente.pk).update(
        version_documentos=F("version_documentos") + 1
    )


def estado(usuario) -> dict:
    vigente = acuerdo()
    actual = ultima_aceptacion(usuario, vigente.version_documentos)
    anterior = actual or ultima_aceptacion(usuario)
    return {
        "titulo": vigente.titulo,
        "texto": vigente.texto,
        "version": vigente.version_documentos,
        "aceptado": actual is not None,
        "aceptado_en": actual.aceptado_en if actual else None,
        # Si aceptó una versión anterior: por qué se le vuelve a pedir.
        "aceptado_antes_en": (anterior.aceptado_en if anterior and not actual else None),
    }
