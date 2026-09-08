"""Generación del código de barras único de cada activo (RF-02).

Formato: ``<PREFIJO>-<TIPO>-<SECUENCIA>``, por ejemplo ``GA-LAP-000042``.

Se eligió un correlativo legible por humanos en lugar de un UUID porque la
etiqueta se lee también a simple vista cuando el código está rayado o el
lector falla, y dictar "GA-LAP-42" por teléfono es viable mientras que dictar
un UUID no lo es. El valor solo contiene caracteres del subconjunto B de
Code 128 (mayúsculas, dígitos y guion), así que cualquier lector 1D lo
resuelve sin configuración especial.

La unicidad la garantiza la restricción de la base de datos, no este módulo:
`generar_codigo_barras` calcula el siguiente correlativo leyendo el máximo
existente, lo que es susceptible a una condición de carrera si dos altas
ocurren a la vez. Por eso `ActivoService.crear_activo` reintenta ante
`IntegrityError` en vez de confiar en que el cálculo sea atómico.
"""

import re

from django.db.models import Max

PREFIJO = "GA"
LONGITUD_SECUENCIA = 6
_PATRON = re.compile(r"^[A-Z0-9]+-(?P<tipo>[A-Z0-9]+)-(?P<secuencia>\d+)$")


def _siguiente_secuencia(codigo_tipo: str) -> int:
    """Siguiente correlativo para un tipo de dispositivo.

    Se calcula por tipo y no global para que los códigos de una misma clase de
    equipo queden contiguos: al auditar un lote de laptops, los números
    consecutivos hacen evidente si falta alguna.
    """
    from .models import Activo

    prefijo_tipo = f"{PREFIJO}-{codigo_tipo.upper()}-"
    ultimo = (
        Activo.objects.filter(codigo_barras__startswith=prefijo_tipo)
        .aggregate(maximo=Max("codigo_barras"))
        .get("maximo")
    )
    if not ultimo:
        return 1
    coincidencia = _PATRON.match(ultimo)
    if not coincidencia:
        return 1
    return int(coincidencia.group("secuencia")) + 1


def generar_codigo_barras(codigo_tipo: str, secuencia: int | None = None) -> str:
    """Devuelve el código para un activo del tipo indicado.

    `secuencia` explícita solo se usa en los reintentos de `ActivoService`.
    """
    if secuencia is None:
        secuencia = _siguiente_secuencia(codigo_tipo)
    return f"{PREFIJO}-{codigo_tipo.upper()}-{secuencia:0{LONGITUD_SECUENCIA}d}"


def es_codigo_valido(codigo: str) -> bool:
    """Si el texto tiene la forma de un código emitido por el sistema.

    Lo usa la búsqueda por escáner (RF-03) para distinguir un código de barras
    de un número de serie tecleado, sin consultar la base de datos.
    """
    return bool(_PATRON.match(codigo.strip().upper()))
