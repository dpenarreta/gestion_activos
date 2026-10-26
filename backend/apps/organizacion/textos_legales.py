"""Los textos de tratamiento de datos personales que aceptan las personas
(26/10/2026, Ley Orgánica de Protección de Datos Personales).

Cada texto es parametrizable: se edita en Configuración → Textos legales, con
`configuracion.textos_legales`, y lleva una **versión** que sube con cada
cambio. Cada aceptación guarda la fecha y hora, la IP, el texto exacto y su
versión; si el texto cambia, la persona vuelve a aceptarlo la próxima vez (su
constancia anterior queda igual). Los cambios quedan en la auditoría con el
texto anterior y el nuevo.
"""

from .models import TextoLegal

#: Cada texto con su nombre y su redacción inicial (la que rige hasta que alguien
#: la cambie).
TEXTOS = {
    TextoLegal.Clave.AUTORIZACION_TELEFONO: {
        "nombre": "Autorización para guardar el teléfono",
        "descripcion": (
            "Lo acepta quien escribe su teléfono en «Mi perfil» o en «Complete su "
            "información». Sin aceptarlo no se guarda el número."
        ),
        "inicial": (
            "Autorizo a la empresa a guardar mi número de teléfono de contacto, sea "
            "personal o empresarial, y a que otras personas de la empresa lo usen para "
            "contactarme, conforme a la Ley Orgánica de Protección de Datos Personales. "
            "Puedo retirar esta autorización en cualquier momento."
        ),
    },
}


def actual(clave: str) -> TextoLegal:
    """El texto vigente de la empresa activa; la primera vez, el inicial."""
    texto = TextoLegal.objects.filter(clave=clave).first()
    if texto is None:
        texto = TextoLegal.objects.create(clave=clave, texto=TEXTOS[clave]["inicial"], version=1)
    return texto


def guardar(clave: str, texto: str) -> tuple[TextoLegal, str]:
    """Cambia el texto; si cambió de verdad, sube la versión. Devuelve el texto
    guardado y el anterior."""
    vigente = actual(clave)
    anterior = vigente.texto
    nuevo = (texto or "").strip()
    if nuevo and nuevo != anterior:
        vigente.texto = nuevo
        vigente.version += 1
        vigente.save(update_fields=["texto", "version", "updated_at"])
    return vigente, anterior


def de(clave: str) -> dict:
    vigente = actual(clave)
    return {
        "clave": clave,
        "nombre": TEXTOS[clave]["nombre"],
        "descripcion": TEXTOS[clave]["descripcion"],
        "texto": vigente.texto,
        "version": vigente.version,
        "actualizado": vigente.updated_at,
    }


def todos() -> list[dict]:
    return [de(clave) for clave in TEXTOS]
