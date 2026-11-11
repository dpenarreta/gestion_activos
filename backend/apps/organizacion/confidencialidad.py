"""El acuerdo de confidencialidad de los códigos de conducta (19/10/2026).

- Se presenta al entrar a «Códigos de conducta» a quien no lo tenga aceptado.
- Sin aceptarlo, no se entrega el contenido de ningún documento (lo comprueba
  el servidor, no solo la pantalla).
- Aceptarlo vale para todos los documentos, hasta que cualquiera se publique,
  se reemplace o se vuelva a publicar, o hasta que cambie el texto del
  acuerdo: entonces se pide de nuevo.
- Cada aceptación queda guardada con su fecha y el texto que se aceptó.

**Desde US-004 (11/11/2026)** el título y el texto son la clave
`acuerdo_confidencialidad` del catálogo de Protección de datos y se editan
solo allí (`privacidad.textos`); las aceptaciones van al registro común
(`AceptacionTexto`), ahora también con IP y navegador.
`AcuerdoConfidencialidad` y `AceptacionConfidencialidad` dejan de usarse
(`privacidad/0007` copió lo que tenían).

Las dos causas de volver a aceptar se reducen a una sola versión: un cambio
del texto sube la versión del texto (`textos.guardar`) y un cambio de los
documentos abre una versión nueva con el mismo texto
(`documentos_cambiaron` → `textos.nueva_version`, con el motivo en el
historial de versiones). En los dos casos la versión exigida es la nueva, así
que una aceptación vale si es de la versión vigente: la de los documentos de
hoy y la del texto de hoy (la regla de antes de US-004).
"""

from apps.privacidad import textos
from apps.privacidad.catalogo_textos import ACUERDO_CONFIDENCIALIDAD as CLAVE

MOTIVO_DOCUMENTOS = "Cambiaron los documentos de Códigos de conducta: se pide aceptarlo de nuevo."


def acuerdo():
    """El `TextoProteccion` del acuerdo en la empresa activa (se crea con el
    texto inicial si no existe)."""
    return textos.obtener(CLAVE)


def aceptado(usuario) -> bool:
    return textos.acepto_vigente(usuario, CLAVE)


def aceptar(usuario, *, ip=None, navegador="", version=None):
    """Registra la aceptación de la versión vigente (si ya la tenía, devuelve
    esa). Devuelve `(aceptacion, creada)`. Con `version` (la que se le
    mostró), si cambió: 400 en `acepto`."""
    return textos.aceptar_en_campo(usuario, CLAVE, ip=ip, navegador=navegador, version=version)


def documentos_cambiaron(actor=None, context=None) -> None:
    """Se publicó, reemplazó o volvió a publicar un documento: todos aceptan
    de nuevo."""
    textos.nueva_version(CLAVE, motivo=MOTIVO_DOCUMENTOS, actor=actor, context=context)


def estado(usuario) -> dict:
    # Nunca `None` (sin empresa, el texto inicial): la pantalla no se rompe.
    vigente = textos.vigente_o_inicial(CLAVE)
    actual = textos.valida_de(usuario, CLAVE)
    anterior = actual or textos.ultima_de(usuario, CLAVE)
    return {
        "titulo": vigente["titulo"],
        "texto": vigente["texto"],
        "version": vigente["version"],
        "aceptado": actual is not None,
        "aceptado_en": actual.aceptado_en if actual else None,
        # Lo que aceptó, tal cual, para volver a leerlo.
        "titulo_aceptado": actual.titulo_aceptado if actual else "",
        "texto_aceptado": actual.texto_aceptado if actual else "",
        # Si aceptó una versión anterior: por qué se le vuelve a pedir.
        "aceptado_antes_en": (anterior.aceptado_en if anterior and not actual else None),
        # Dónde se edita desde US-004 (CA-7).
        "se_edita_en": "/admin/privacidad/textos",
    }


ESTADOS = {"vigente": "Aceptó", "antes": "Aceptó antes de un cambio", "nunca": "No ha aceptado"}


def aceptaciones() -> dict:
    """Cada persona activa de la empresa con su última aceptación y su estado
    («vigente», «antes» de un cambio de los documentos o del texto, o
    «nunca»). Solo lectura: la lista completa, con IP y navegador, está en
    Protección de datos → Aceptaciones."""
    from django.contrib.auth import get_user_model

    from apps.empresas.contexto import empresa_actual
    from apps.privacidad.models import AceptacionTexto

    vigente = acuerdo()
    empresa = empresa_actual()
    personas = get_user_model().objects.filter(is_active=True)
    if getattr(empresa, "pk", None):
        personas = personas.filter(membresias__empresa=empresa).distinct()
    ultimas, validas = {}, set()
    if vigente is not None:
        for fila in (
            AceptacionTexto.objects.todas()
            .filter(texto_proteccion=vigente)
            .order_by("usuario_id", "-aceptado_en", "-id")
            # Solo lo que se usa: el texto aceptado puede ser largo y son
            # todas las aceptaciones de la empresa.
            .only("id", "usuario_id", "aceptado_en", "version")
        ):
            ultimas.setdefault(fila.usuario_id, fila)
        validas = set(textos.validas(vigente).values_list("usuario_id", flat=True))
    filas = []
    for persona in personas.order_by("first_name", "last_name", "username"):
        ultima = ultimas.get(persona.pk)
        estado_ = "nunca" if ultima is None else ("vigente" if persona.pk in validas else "antes")
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
        "se_consulta_en": "/admin/privacidad/aceptaciones",
    }


def aceptaciones_excel(datos):
    """Las aceptaciones en un Excel, para Talento Humano."""
    from io import BytesIO

    from django.http import HttpResponse
    from django.utils import timezone
    from openpyxl import Workbook
    from openpyxl.styles import Font

    from apps.core.hojas_de_calculo import neutralizar_fila

    libro = Workbook()
    hoja = libro.active
    hoja.title = "Aceptaciones"
    hoja.append(["Persona", "Correo", "Estado", "Aceptó el"])
    for celda in hoja[1]:
        celda.font = Font(bold=True)
    for fila in datos["personas"]:
        fecha = fila["aceptado_en"]
        hoja.append(
            neutralizar_fila(
                [
                    fila["persona"],
                    fila["correo"],
                    ESTADOS[fila["estado"]],
                    timezone.localtime(fecha).strftime("%d/%m/%Y %H:%M") if fecha else "",
                ]
            )
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
