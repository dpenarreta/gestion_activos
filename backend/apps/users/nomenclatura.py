"""De qué se compone el nombre de usuario.

Lo escribía quien daba de alta la cuenta, y así conviven en la misma lista
`dpenarreta`, `d.penarreta`, `diegop` y `DPenarreta`: cuatro formas de nombrar a
la misma persona, ninguna deducible desde la otra. Quien busca a alguien en el
registro de auditoría tiene que adivinar cuál le tocó.

Ahora se deriva del nombre: inicial del primero y apellido completo, sin tildes
ni eñes. «Diego Peñarreta» es `dpenarreta`, y quien lea `dpenarreta` en un acta
de entrega sabe de quién habla sin abrir su ficha.
"""

import re
import unicodedata

#: Si el nombre no deja ninguna letra utilizable —un apellido escrito solo con
#: signos, un dato heredado en blanco—, la cuenta necesita igual un nombre con
#: el que entrar.
RESERVA = "usuario"

#: `max_length` de `User.username`, dejando sitio al sufijo de desempate.
LARGO_MAXIMO = 150
MARGEN_SUFIJO = 4


def sin_tildes(texto: str) -> str:
    """«Peñarreta» → «Penarreta», «Muñoz» → «Munoz».

    Se descompone cada carácter en su letra base más el signo (NFKD) y se tiran
    los signos. Es preferible a una tabla de reemplazos porque cubre de una vez
    la eñe, las tildes, la diéresis y lo que traiga un apellido extranjero.
    """
    descompuesto = unicodedata.normalize("NFKD", texto)
    return "".join(caracter for caracter in descompuesto if not unicodedata.combining(caracter))


def _solo_letras(texto: str) -> str:
    """Lo que queda es lo que puede escribirse en una casilla de inicio de sesión."""
    return re.sub(r"[^a-z0-9]", "", sin_tildes(texto).lower())


def base_de_username(nombres: str, apellidos: str) -> str:
    """`dpenarreta` a partir de «Diego» y «Peñarreta».

    Los apellidos van completos y pegados —«Peñarreta Vaca» es
    `penarretavaca`—: cortar por el primero convertiría en la misma cuenta a
    dos hermanos que trabajen aquí.
    """
    inicial = _solo_letras(nombres or "")[:1]
    apellido = _solo_letras(apellidos or "")
    return f"{inicial}{apellido}"[: LARGO_MAXIMO - MARGEN_SUFIJO] or RESERVA


def generar_username(nombres: str, apellidos: str) -> str:
    """El nombre de usuario libre para esa persona.

    Dos «Pérez» con la misma inicial dan la misma base, así que al segundo se le
    añade un número: `dperez`, `dperez2`. Se numera en vez de meter la segunda
    inicial del nombre porque no todo el mundo tiene dos, y una regla que a
    veces no aplica es peor que un número que siempre se entiende.

    No es atómico —dos altas simultáneas pueden proponer el mismo— pero la
    unicidad de la columna es la que manda; esto solo propone un valor libre.
    """
    from .models import User

    base = base_de_username(nombres, apellidos)
    tomados = {
        nombre.lower()
        for nombre in User.objects.filter(username__istartswith=base).values_list(
            "username", flat=True
        )
    }
    if base not in tomados:
        return base
    numero = 2
    while f"{base}{numero}" in tomados:
        numero += 1
    return f"{base}{numero}"
