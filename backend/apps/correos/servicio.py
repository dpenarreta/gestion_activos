"""Armar un correo del sistema: asunto, HTML y texto, desde su plantilla.

Todo correo que sale pasa por aquí, y la vista previa también: así lo que se
previsualiza en Configuración es exactamente lo que llega.
"""

from django.conf import settings
from django.utils import timezone

from . import catalogo, motor
from .models import PlantillaCorreo


class PlantillaDesconocida(KeyError):
    pass


def _comunes(plantilla: catalogo.Plantilla) -> dict:
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    empresa = empresa_actual()
    return {
        "sistema": settings.SYSTEM_NAME,
        "empresa": empresa.nombre if empresa is not None and empresa is not SIN_EMPRESA else "",
        "modulo": plantilla.modulo,
        "fecha": timezone.localdate().strftime("%d/%m/%Y"),
        "enlace_sistema": settings.FRONTEND_URL.rstrip("/"),
        "razon": plantilla.razon,
    }


def vigente(clave: str) -> tuple[str, str, bool]:
    """El asunto y el HTML que se usan hoy, y si son personalizados."""
    plantilla = catalogo.obtener(clave)
    if plantilla is None:
        raise PlantillaDesconocida(clave)
    propia = PlantillaCorreo.objects.filter(clave=clave).first()
    if propia is not None:
        return propia.asunto, propia.html, True
    return plantilla.asunto, plantilla.html, False


def renderizar(
    clave: str, variables: dict, *, asunto: str | None = None, html: str | None = None
) -> dict:
    """`asunto`, `html` y `texto` del correo, con las variables puestas.

    `asunto`/`html` permiten renderizar un borrador (la vista previa del
    editor) en lugar de la plantilla guardada.
    """
    plantilla = catalogo.obtener(clave)
    if plantilla is None:
        raise PlantillaDesconocida(clave)
    asunto_vigente, html_vigente, _ = vigente(clave)
    asunto_fuente = asunto if asunto is not None else asunto_vigente
    html_fuente = html if html is not None else html_vigente

    contexto = {**_comunes(plantilla), **{k: v for k, v in variables.items() if v is not None}}
    crudas = frozenset(v.nombre for v in plantilla.todas_las_variables() if v.html)
    asunto_final = " ".join(
        motor.renderizar(asunto_fuente, contexto, html_crudo=crudas, escapar=False).split()
    )
    contexto["asunto"] = asunto_final
    cuerpo = motor.renderizar(html_fuente, contexto, html_crudo=crudas)
    return {"asunto": asunto_final, "html": cuerpo, "texto": motor.a_texto_plano(cuerpo)}


def ejemplo(clave: str) -> dict:
    """Las variables de ejemplo del catálogo: alimentan la vista previa y la
    prueba."""
    plantilla = catalogo.obtener(clave)
    if plantilla is None:
        raise PlantillaDesconocida(clave)
    return {v.nombre: v.ejemplo for v in plantilla.variables}


def variables_desconocidas(clave: str, *textos: str) -> list[str]:
    """Las que la plantilla nombra y el correo no tiene: quedarían vacías."""
    plantilla = catalogo.obtener(clave)
    conocidas = {v.nombre for v in plantilla.todas_las_variables()}
    usadas = set()
    for texto in textos:
        usadas |= motor.variables_usadas(texto)
    return sorted(usadas - conocidas)


def guardar(*, clave: str, actor, asunto: str, html: str) -> dict:
    """Guarda la versión personalizada. Devuelve lo que había (para auditar)."""
    anterior = PlantillaCorreo.objects.filter(clave=clave).first()
    PlantillaCorreo.objects.update_or_create(
        clave=clave, defaults={"asunto": asunto, "html": html, "actualizado_por": actor}
    )
    if anterior is None:
        return {"asunto": "(por defecto)"}
    return {"asunto": anterior.asunto, "bytes_html": len(anterior.html)}


def restablecer(clave: str) -> bool:
    """Vuelve al diseño por defecto. Devuelve si había algo personalizado."""
    borradas, _ = PlantillaCorreo.objects.filter(clave=clave).delete()
    return bool(borradas)
