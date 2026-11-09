"""El reporte secundario de Cartera y Gestión Humana (09/11/2026).

Decisión del usuario: la Jefa de Cartera y la Gerente de Gestión Humana
reportan al Gerente General (su jefe inmediato, como dejaron `cartera_2026` y
`financiero_2026`) y **también** al Jefe Financiero Administrativo, en línea
punteada (`Cargo.jefes_secundarios`, ver `reportes.py`).

En cada empresa, solo si existen los cargos:

- el «Jefe Financiero Administrativo» (activo) es el jefe secundario de
- el «Jefe de Cartera» de la unidad Cartera, y
- el cargo más alto de «Gestión de Talento Humano» (el de mayor nivel; si
  empatan, el que reporta fuera del área): la Gerente de Gestión Humana.

Lo aplica la migración 0046 y deja el cambio en la bitácora del organigrama.
Repetirlo no cambia nada; un cargo que ya tiene ese reporte no se toca.
"""

from . import niveles_cargo, reportes, versiones
from .models import Cargo
from .permisos_por_cargo import normalizar as _normal

JEFE = "Jefe Financiero Administrativo"
CARTERA = ("Cartera", "Jefe de Cartera")
TALENTO_HUMANO = "Gestión de Talento Humano"

MOTIVO = (
    "Decisión del usuario: la Jefatura de Cartera y la Gerencia de Gestión Humana "
    "reportan al Gerente General y también, en línea punteada, al Jefe "
    "Financiero Administrativo."
)


def aplicar() -> list[str]:
    """Lo deja así en la empresa activa y lo anota en la bitácora. Devuelve lo
    que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def _activos():
    return list(Cargo.objects.filter(activo=True).select_related("unidad"))


def _jefe_de_cartera(cargos):
    unidad, nombre = (_normal(x) for x in CARTERA)
    return next(
        (
            c
            for c in sorted(cargos, key=lambda c: c.id)
            if c.unidad_id and _normal(c.unidad.nombre) == unidad and _normal(c.nombre) == nombre
        ),
        None,
    )


def _cabeza_de_talento_humano(cargos):
    del_area = [
        c for c in cargos if c.unidad_id and _normal(c.unidad.nombre) == _normal(TALENTO_HUMANO)
    ]
    if not del_area:
        return None
    ids = {c.id for c in del_area}
    return min(
        del_area,
        key=lambda c: (niveles_cargo.ORDEN.get(c.nivel, 99), c.jefe_id in ids, c.id),
    )


def cambiar() -> None:
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración)."""
    cargos = _activos()
    jefe = next(
        (c for c in sorted(cargos, key=lambda c: c.id) if _normal(c.nombre) == _normal(JEFE)),
        None,
    )
    if jefe is None:
        return
    for cargo in (_jefe_de_cartera(cargos), _cabeza_de_talento_humano(cargos)):
        if cargo is None or cargo.pk == jefe.pk or cargo.jefe_id == jefe.pk:
            continue
        if cargo.jefes_secundarios.filter(pk=jefe.pk).exists():
            continue
        # Un círculo no se cierra ni aquí (el Jefe Financiero dependiendo del
        # cargo): se salta en vez de romper la migración.
        if jefe.pk in reportes.debajo(cargo.pk, cargo.empresa_id):
            continue
        cargo.jefes_secundarios.add(jefe)
