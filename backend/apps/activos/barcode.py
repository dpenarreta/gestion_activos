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


#: Caracteres que aparecen en lugar del guion cuando la pistola y el sistema
#: operativo no comparten distribución de teclado.
#:
#: Una pistola USB no envía texto: simula pulsaciones de teclas, y quien las
#: traduce a caracteres es Windows con su propia distribución. La tecla que en
#: un teclado US produce `-` está, en el español, en la posición del `'`; en el
#: francés da `)`, y en el alemán, `ß`. El lector cree haber enviado
#: `GA-LAP-000006` y el sistema recibe `GA'LAP'000006`.
#:
#: No es un problema del código de barras ni del lector: los dos funcionan. Es
#: configuración, y se arregla en la pistola (ver docs/codigos-de-barras.md).
SUSTITUTOS_DEL_GUION = "'´`)ß-–—"


def variantes_de_escaneo(valor: str) -> tuple[str, ...]:
    """Las formas con las que hay que buscar lo que llegó del lector.

    El texto tal cual y, si cambia en algo, el mismo con los sustitutos del
    guion repuestos. **Son candidatos para buscar, no un reemplazo**, y esa es
    toda la diferencia con `normalizar_escaneo`: el original se sigue buscando
    y va primero, así que reponer el guion nunca puede llevar a un equipo
    distinto del que se pidió —solo puede añadir el que la pistola quiso leer—.

    Por eso aquí no se exige que el resultado tenga forma de código nuestro.
    `normalizar_escaneo` sí lo exige porque responde a otra pregunta —«¿esto es
    una etiqueta nuestra mal leída?»— y su respuesta sustituye al original. La
    etiqueta del fabricante casi siempre lleva guiones (`DL5440-0011`), y con
    la regla estricta un número de serie escaneado con la pistola mal
    configurada no se encontraba en ninguna parte.
    """
    original = (valor or "").strip()
    if not original:
        return ()
    # Se traduce sobre el texto original: `"ß".upper()` es `"SS"`, y para
    # entonces el carácter que había que reponer ya no está.
    traduccion = str.maketrans({caracter: "-" for caracter in SUSTITUTOS_DEL_GUION})
    reparado = original.translate(traduccion)
    if reparado == original:
        return (original,)
    return (original, reparado)


def normalizar_escaneo(valor: str) -> tuple[str, bool]:
    """Repara un código escaneado con la distribución de teclado equivocada.

    Devuelve `(valor, hubo_correccion)`. La corrección **solo** se aplica si el
    resultado tiene la forma exacta de un código emitido por el sistema: así no
    se toca la búsqueda por número de serie, donde un apóstrofe o un guion
    largo podrían ser legítimos y sustituirlos encontraría el equipo
    equivocado.

    Que devuelva si hubo corrección no es un detalle: arreglarlo en silencio
    dejaría la pistola mal configurada, y el mismo problema volvería a aparecer
    en la carga masiva, en el buscador y en cualquier campo donde se escanee.
    """
    original = (valor or "").strip()
    if not original or es_codigo_valido(original):
        return original, False

    # Se traduce antes de pasar a mayúsculas: `"ß".upper()` es `"SS"`, y para
    # entonces el carácter que había que reparar ya no está.
    traduccion = str.maketrans({caracter: "-" for caracter in SUSTITUTOS_DEL_GUION})
    reparado = original.translate(traduccion).upper()
    if reparado != original.upper() and es_codigo_valido(reparado):
        return reparado, True
    return original, False
