"""El perfil de cada cargo (20/10/2026): su objetivo, sus funciones, las
competencias que pide y los KPIs con que se mide.

Lo escribe quien tiene `institucional.perfil_cargo` (pestaña «Perfiles de
cargo» de Editar estructura) y lo lee cada persona en «Mi perfil», el de su
cargo, en cuanto lo elige o se lo asignan.

Funciones, competencias y KPIs se guardan como texto, una por línea, y se
entregan como listas.

En el mismo editor se marcan las **herramientas y licencias** que necesita el
cargo (las base, herramientas.py): con las que debe venir configurado el
equipo de quien lo ocupa.
"""

from django.db import transaction

#: Los campos del perfil, en el orden en que se muestran.
CAMPOS = ("objetivo", "funciones", "competencias", "kpis")
LISTAS = ("funciones", "competencias", "kpis")


def _lineas(texto: str) -> list[str]:
    return [
        linea.strip(" \t-•·*") for linea in (texto or "").splitlines() if linea.strip(" \t-•·*")
    ]


def tiene_perfil(cargo) -> bool:
    return any((getattr(cargo, campo) or "").strip() for campo in CAMPOS)


def de(cargo, con_herramientas=False) -> dict:
    """El perfil del cargo: el objetivo como texto y lo demás como listas (y,
    si se pide, los ids de sus herramientas base)."""
    perfil = {
        "cargo": {"id": cargo.id, "nombre": cargo.nombre},
        "objetivo": (cargo.objetivo or "").strip(),
        **{campo: _lineas(getattr(cargo, campo)) for campo in LISTAS},
        "completo": all((getattr(cargo, campo) or "").strip() for campo in CAMPOS),
    }
    if con_herramientas:
        from .models import HerramientaDeCargo

        perfil["herramientas"] = sorted(
            HerramientaDeCargo.objects.filter(cargo=cargo).values_list("herramienta_id", flat=True)
        )
    return perfil


def guardar(cargo, datos: dict):
    """Guarda el perfil; las listas llegan como texto (una por línea) o como
    lista, y se guardan limpias, una por línea."""
    with transaction.atomic():
        cargo.objetivo = (datos.get("objetivo") or "").strip()
        for campo in LISTAS:
            valor = datos.get(campo) or ""
            if isinstance(valor, list):
                valor = "\n".join(str(v) for v in valor)
            setattr(cargo, campo, "\n".join(_lineas(valor)))
        cargo.save(update_fields=[*CAMPOS, "updated_at"])
        if datos.get("herramientas") is not None:
            from .herramientas import guardar_base

            guardar_base(cargo, datos["herramientas"])
    return cargo
