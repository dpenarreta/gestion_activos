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
        # Lo que aceptó, tal cual, para volver a leerlo.
        "titulo_aceptado": actual.titulo_aceptado if actual else "",
        "texto_aceptado": actual.texto_aceptado if actual else "",
        # Si aceptó una versión anterior: por qué se le vuelve a pedir.
        "aceptado_antes_en": (anterior.aceptado_en if anterior and not actual else None),
    }


ESTADOS = {"vigente": "Aceptó", "antes": "Aceptó antes de un cambio", "nunca": "No ha aceptado"}


def aceptaciones() -> dict:
    """Cada persona activa de la empresa con su última aceptación y su estado
    («vigente», «antes» de un cambio de los documentos o «nunca»)."""
    from django.contrib.auth import get_user_model

    from apps.empresas.contexto import empresa_actual

    vigente = acuerdo().version_documentos
    empresa = empresa_actual()
    personas = get_user_model().objects.filter(is_active=True)
    if getattr(empresa, "pk", None):
        personas = personas.filter(membresias__empresa=empresa).distinct()
    ultimas = {}
    for fila in AceptacionConfidencialidad.objects.order_by("usuario_id", "-aceptado_en"):
        ultimas.setdefault(fila.usuario_id, fila)
    filas = []
    for persona in personas.order_by("first_name", "last_name", "username"):
        ultima = ultimas.get(persona.pk)
        estado_ = (
            "nunca"
            if ultima is None
            else ("vigente" if ultima.version_documentos == vigente else "antes")
        )
        filas.append(
            {
                "id": persona.pk,
                "persona": persona.get_full_name().strip() or persona.username,
                "correo": persona.email,
                "aceptado_en": ultima.aceptado_en if ultima else None,
                "estado": estado_,
                "vigente": estado_ == "vigente",
            }
        )
    aceptaron = sum(1 for f in filas if f["vigente"])
    return {
        "total": len(filas),
        "aceptaron": aceptaron,
        "pendientes": len(filas) - aceptaron,
        "personas": filas,
    }


def aceptaciones_excel(datos):
    """Las aceptaciones en un Excel, para Talento Humano."""
    from io import BytesIO

    from django.http import HttpResponse
    from django.utils import timezone
    from openpyxl import Workbook
    from openpyxl.styles import Font

    libro = Workbook()
    hoja = libro.active
    hoja.title = "Aceptaciones"
    hoja.append(["Persona", "Correo", "Estado", "Aceptó el"])
    for celda in hoja[1]:
        celda.font = Font(bold=True)
    for fila in datos["personas"]:
        fecha = fila["aceptado_en"]
        hoja.append(
            [
                fila["persona"],
                fila["correo"],
                ESTADOS[fila["estado"]],
                timezone.localtime(fecha).strftime("%d/%m/%Y %H:%M") if fecha else "",
            ]
        )
    for columna, ancho in zip("ABCD", (34, 34, 26, 18), strict=True):
        hoja.column_dimensions[columna].width = ancho
    salida = BytesIO()
    libro.save(salida)
    respuesta = HttpResponse(
        salida.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    respuesta["Content-Disposition"] = 'attachment; filename="aceptaciones-confidencialidad.xlsx"'
    return respuesta
