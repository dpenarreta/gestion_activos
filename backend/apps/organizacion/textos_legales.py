"""Los textos de tratamiento de datos personales de Configuración → Textos
legales (26/10/2026, Ley Orgánica de Protección de Datos Personales).

Desde US-004 (11/11/2026) viven en el catálogo de Protección de datos
(`apps.privacidad.textos`) y se editan solo allí (CA-7). Lo que queda aquí es
la lectura con la forma de siempre, para la pantalla vieja mientras exista:
`TextosLegalesView` ya no guarda (responde 410). `organizacion.TextoLegal`
deja de usarse (`privacidad/0007` copió su texto y su versión).
"""

from apps.privacidad import catalogo_textos as catalogo
from apps.privacidad import textos

#: Cada texto con su nombre (el del catálogo de Protección de datos).
TEXTOS = {
    catalogo.AUTORIZACION_TELEFONO: {
        "nombre": "Autorización para guardar el teléfono",
        "descripcion": catalogo.POR_CLAVE[catalogo.AUTORIZACION_TELEFONO].descripcion,
    },
}


def de(clave: str) -> dict:
    vigente = textos.obtener(clave)
    leido = textos.vigente_o_inicial(clave)
    return {
        "clave": clave,
        "nombre": TEXTOS[clave]["nombre"],
        "descripcion": TEXTOS[clave]["descripcion"],
        "texto": leido["texto"],
        "version": leido["version"],
        "actualizado": (vigente.editado_en or vigente.updated_at) if vigente else None,
        # Desde US-004 se edita en Protección de datos (CA-7).
        "solo_lectura": True,
        "se_edita_en": "/admin/privacidad/textos",
    }


def todos() -> list[dict]:
    return [de(clave) for clave in TEXTOS]
