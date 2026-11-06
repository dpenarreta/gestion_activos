"""Búsqueda de texto en los listados, sin distinguir tildes ni mayúsculas.

El frontend compara igual en toda la intranet (`frontend/src/utils/busqueda.js`):
lo escrito se parte en palabras, cada palabra tiene que aparecer en alguno de
los campos de la fila —en cualquier orden— y ni las tildes ni las mayúsculas
cuentan. Los listados que filtran en el servidor tienen que responder lo mismo:
si «ramirez» encuentra a «Ramírez» en una lista filtrada en el navegador y no
en el inventario, que pagina en el servidor, la búsqueda parece rota.

**Por qué una colación y no `icontains` a secas.** En SQL Server, `icontains`
es `UPPER(col) LIKE UPPER(%s)`: lo que decide si «í» es «i» es la colación de
la columna. La base local está en `SQL_Latin1_General_CP1_CI_AS` (servidor y
base, comprobado el 06/11/2026): *CI*, sin mayúsculas, pero *AS*, con tildes.
Producción puede estar en esa misma o en otra, y cambiar la colación de la base
obliga a recrear índices y restricciones; por eso no se depende de ella: cada
campo se compara con `COLLATE Latin1_General_100_CI_AI` explícito, que vale
para `nvarchar` (lo que crea Django) con cualquier colación de base. En ella
«Ñ» se compara como «N» y «Ú» como «u», igual que el `normalize("NFD")` del
frontend; la versión `_100_` es la que tiene los pesos de Unicode más completos.

**Por qué un `Transform` registrado y no una anotación.** Anotar
`Collate(F("responsables__nombres"), ...)` y filtrar por la anotación añade un
`JOIN` propio por cada anotación; sobre una relación de varios valores (los
responsables de un activo) eso multiplica las filas por cada responsable y por
cada palabra. Con el `Transform` el filtro se escribe
`responsables__nombres__sin_tildes__icontains=...`, es decir, como cualquier
otro filtro por palabra clave: Django reutiliza las uniones dentro del mismo
`filter()`, las promueve a `LEFT JOIN` cuando van dentro de un OR (un activo
sin responsables se sigue encontrando por su nombre) y no agrega columnas al
`SELECT`. Quien busque por una relación de varios valores sigue necesitando su
`.distinct()`, exactamente como antes.

**Rendimiento.** Un `LIKE '%…%'` nunca usa un índice, con o sin `COLLATE`: la
búsqueda ya recorría las filas, así que la colación explícita no cambia el
plan. Lo que sí crece es el número de condiciones —una por palabra y campo—,
por eso se toman como mucho `MAXIMO_DE_PALABRAS` palabras.
"""

from __future__ import annotations

from collections.abc import Iterable

from django.db import models
from django.db.models import Q
from django.db.models.functions import Collate

# Colación de comparación: sin mayúsculas (CI) y sin tildes (AI). Ver el
# docstring del módulo.
COLACION_SIN_TILDES = "Latin1_General_100_CI_AI"

# Lo escrito en un buscador es corto; más palabras que esto solo engordaría la
# consulta (cada palabra añade una condición por campo).
MAXIMO_DE_PALABRAS = 8


class SinTildes(models.Transform):
    """`campo__sin_tildes`: el campo con la colación sin tildes ni mayúsculas.

    Se encadena con el lookup de siempre: `nombre__sin_tildes__icontains="jose"`
    encuentra «José». Solo SQL Server tiene colaciones con ese nombre; en otro
    motor (no lo hay en este proyecto, pero el Transform es global) devuelve el
    campo tal cual para no romper la consulta.
    """

    lookup_name = "sin_tildes"

    @property
    def output_field(self):
        return self.lhs.output_field

    def as_sql(self, compiler, connection):
        if connection.vendor != "microsoft":
            return compiler.compile(self.lhs)
        # Se pasa `collation` ya escrita: `Collate` la cita con
        # `connection.ops.quote_name`, y en SQL Server eso da
        # `COLLATE [Latin1_General_100_CI_AI]`, que el motor rechaza como error
        # de sintaxis. Es una constante de este módulo y `Collate` igual valida
        # su forma al construirse, así que no hay nada que escapar.
        return Collate(self.lhs, COLACION_SIN_TILDES).as_sql(
            compiler, connection, collation=COLACION_SIN_TILDES
        )


# Los campos de texto donde se busca. `EmailField`, `SlugField` y demás heredan
# de `CharField` y lo reciben por herencia; `GenericIPAddressField` no, y hay
# listados que buscan por la IP.
for _campo in (models.CharField, models.TextField, models.GenericIPAddressField):
    _campo.register_lookup(SinTildes)


def palabras_de_busqueda(termino) -> list[str]:
    """Las palabras de lo escrito, en el orden en que llegaron.

    No se quitan las tildes aquí: la colación ya las ignora en los dos lados
    de la comparación. Se descartan las repetidas (no cambian el resultado) y
    se toman como mucho `MAXIMO_DE_PALABRAS`.
    """
    palabras = []
    for palabra in str(termino or "").split():
        if palabra not in palabras:
            palabras.append(palabra)
    return palabras[:MAXIMO_DE_PALABRAS]


def condicion_de_busqueda(termino, campos: Iterable[str]) -> Q | None:
    """El `Q` de la búsqueda: cada palabra en alguno de los `campos`.

    `campos` son rutas de campo como en un filtro (`"nombre"`,
    `"responsables__apellidos"`, `"sede__ciudad"`). Devuelve `None` si no se
    escribió nada, para que quien llame no filtre. Sirve para combinarlo con
    otras condiciones (p. ej. la etiqueta escaneada en el inventario):
    `queryset.filter(etiqueta | condicion)`.
    """
    campos = list(campos)
    if not campos:
        raise ValueError("La búsqueda necesita al menos un campo donde buscar.")
    palabras = palabras_de_busqueda(termino)
    if not palabras:
        return None
    condicion = Q()
    for palabra in palabras:
        en_algun_campo = Q()
        for campo in campos:
            en_algun_campo |= Q(**{f"{campo}__sin_tildes__icontains": palabra})
        condicion &= en_algun_campo
    return condicion


def filtro_de_busqueda(queryset, termino, campos: Iterable[str]):
    """Filtra `queryset` por lo escrito, sin distinguir tildes ni mayúsculas.

    «jose perez» encuentra a «Pérez Andrade, José»: cada palabra tiene que
    estar en alguno de los `campos`, en cualquier orden. Con el término vacío
    devuelve el queryset sin tocar. Si algún campo cruza una relación de varios
    valores, quien llama añade `.distinct()` (ver el docstring del módulo).
    """
    condicion = condicion_de_busqueda(termino, campos)
    if condicion is None:
        return queryset
    return queryset.filter(condicion)
