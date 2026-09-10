"""Caché de los resúmenes del parque.

El panel y el centro de alertas recorren el inventario completo para agregarlo,
y ese trabajo es CPU de Python: con 10.000 activos cuesta cientos de
milisegundos por llamada y, medido con cinco usuarios simultáneos, se acumula
hasta varios segundos porque el intérprete lo serializa (ver
`docs/rendimiento.md`).

Son cifras agregadas de todo el parque: entre una consulta y la siguiente no
cambian salvo que alguien registre un equipo, y un par de minutos de retraso en
«cuántos equipos hay en bodega» no cambia ninguna decisión. Lo que sí importa
es que un cambio de configuración se vea de inmediato —si alguien apaga una
alerta y sigue apareciendo, el sistema parece roto—, y para eso está
`invalidar`.
"""

from django.conf import settings
from django.core.cache import cache


def recordar(clave: str, calcular):
    """Devuelve el valor cacheado o lo calcula y lo guarda.

    Con `CACHE_AGREGADOS_SEGUNDOS = 0` no cachea nada: es el modo de
    desarrollo, donde ver el efecto inmediato de un cambio vale más que el
    tiempo de respuesta.
    """
    segundos = getattr(settings, "CACHE_AGREGADOS_SEGUNDOS", 0)
    if not segundos:
        return calcular()

    valor = cache.get(clave)
    if valor is None:
        valor = calcular()
        cache.set(clave, valor, segundos)
    return valor


def invalidar(*claves: str) -> None:
    """Olvida lo cacheado. Se llama cuando cambia algo que lo afecta."""
    for clave in claves:
        cache.delete(clave)
