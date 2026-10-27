"""El nivel jerárquico de cada cargo (27/10/2026).

Gestión Humana ordena los cargos en seis niveles, de arriba hacia abajo:

    Gerencia General › Gerencia de Área › Jefatura › Coordinación
    › Operativo de área › Asistente de área

El nivel es del **cargo** (el Jefe TI y el Asistente de Sistemas están en la
misma unidad y en niveles distintos); el nivel de la unidad (`NivelJerarquico`)
sigue ordenando las unidades del organigrama.

- `sugerido` deduce el nivel del nombre del cargo; lo usan la migración que
  los asignó y los cargos que se crean sin indicarlo. Los Supervisores, los
  Analistas, los Auxiliares, etc. son operativos.
- `validar_jefe` impide que un cargo reporte a uno de nivel más bajo (una
  Jefatura debajo de una Coordinación). Del mismo nivel sí se puede (el
  Analista Programador reporta al Analista Programador Senior).
"""

from rest_framework.exceptions import ValidationError

from .models import NivelCargo
from .permisos_por_cargo import normalizar

#: Valor → posición (0 es lo más alto).
ORDEN = {valor: i for i, valor in enumerate(NivelCargo.values)}
NOMBRES = dict(NivelCargo.choices)


def sugerido(nombre: str, jefe=None) -> str:
    """El nivel que corresponde al nombre; con `jefe`, nunca por encima del
    de él (un «Analista» que reporta a un Asistente queda como Asistente)."""
    nivel = _por_nombre(nombre)
    if jefe is not None and ORDEN.get(jefe.nivel, 0) > ORDEN[nivel]:
        return jefe.nivel
    return nivel


def _por_nombre(nombre: str) -> str:
    texto = normalizar(nombre)
    if texto.startswith(("gerente general", "gerenta general", "presidente", "presidenta")):
        return NivelCargo.GERENCIA_GENERAL
    if texto.startswith(("gerente", "gerenta", "director", "directora")):
        return NivelCargo.GERENCIA_AREA
    if texto.startswith(("jefe", "jefa")):
        return NivelCargo.JEFATURA
    if texto.startswith(("coordinador", "coordinadora")):
        return NivelCargo.COORDINACION
    if texto.startswith(("asistente", "pasante")):
        return NivelCargo.ASISTENTE
    return NivelCargo.OPERATIVO


def lista() -> list[dict]:
    """Los niveles para las pantallas, en orden."""
    return [{"valor": v, "nombre": n, "orden": ORDEN[v]} for v, n in NivelCargo.choices]


def validar_jefe(nivel: str, jefe) -> None:
    if jefe is None or not nivel:
        return
    if ORDEN.get(jefe.nivel, 0) > ORDEN.get(nivel, 0):
        raise ValidationError(
            {
                "jefe": (
                    f"«{jefe.nombre}» es {NOMBRES[jefe.nivel]}: un cargo de nivel "
                    f"{NOMBRES[nivel]} no puede reportarle. Elija un jefe del mismo "
                    "nivel o de uno superior."
                )
            }
        )
