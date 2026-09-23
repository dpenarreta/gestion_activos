"""Comprobar unas especificaciones contra las características que declara un tipo.

Vive aparte del serializer del activo porque ya no lo usa solo él: una solicitud
de compra describe lo que se pide con las mismas características —«una laptop
con 32 GB y disco NVMe»—, y si cada sitio comprobara por su cuenta acabarían
admitiendo cosas distintas.

Lo que un tipo marca obligatorio se exige **en los dos sitios**: si se declaró
que de una laptop siempre se dice la RAM, una solicitud que no la diga es una
solicitud que habrá que devolver preguntando. Lo que no se quiera exigir al
pedir se desmarca en la característica, que es una casilla, y entonces no se
exige en ninguno de los dos.
"""

from django.core.exceptions import ValidationError as ErrorDeModelo

from .models_caracteristicas import CaracteristicaTipo


def declaradas_de(tipo) -> list[CaracteristicaTipo]:
    """Las características vigentes del tipo, en el orden del formulario."""
    if tipo is None:
        return []
    return list(
        CaracteristicaTipo.objects.filter(tipo=tipo, activa=True).order_by("orden", "nombre")
    )


def validar(tipo, especificaciones, *, heredadas=()):
    """Devuelve `(limpias, errores)` sin levantar: quien llama decide cómo se
    devuelve el fallo.

    **Solo comprueba cuando el tipo declara alguna.** Un tipo sin características
    sigue admitiendo pares libres: obligar a configurarlos todos antes de poder
    registrar nada convertiría una mejora en un bloqueo, y la mitad del
    inventario se cargó cuando esto no existía.

    Las claves que el tipo no declara se rechazan —es lo que impide que vuelva la
    dispersión de «RAM», «Ram» y «Memoria RAM»— salvo las `heredadas`, que son
    las que el registro ya tenía guardadas: al describir un tipo por primera vez,
    lo cargado antes arrastra características que nadie declaró, y hacer que deje
    de poder guardarse castigaría a quien cargó el inventario primero.
    """
    declaradas = declaradas_de(tipo)
    if not declaradas:
        return dict(especificaciones or {}), {}

    por_nombre = {c.nombre: c for c in declaradas}
    heredadas = set(heredadas or ())
    errores: dict[str, str] = {}
    limpias: dict = {}

    for clave, valor in (especificaciones or {}).items():
        caracteristica = por_nombre.get(clave)
        if caracteristica is None:
            if clave in heredadas:
                limpias[clave] = valor
            else:
                errores[clave] = (
                    f"«{tipo.nombre}» no describe «{clave}». Añádala a las "
                    f"características del tipo si hace falta."
                )
            continue
        try:
            normalizado = caracteristica.normalizar(valor)
        except ErrorDeModelo as error:
            errores[clave] = error.messages[0]
            continue
        if normalizado is not None:
            limpias[clave] = normalizado

    for caracteristica in declaradas:
        # Si el valor ya falló por otra razón —una opción que no está en la
        # lista, un texto donde iba un número— ese mensaje dice qué corregir y
        # este lo taparía con un genérico «es obligatoria».
        if caracteristica.nombre in errores:
            continue
        if caracteristica.obligatoria and limpias.get(caracteristica.nombre) in (None, ""):
            errores[caracteristica.nombre] = (
                f"«{caracteristica.nombre}» es obligatoria para un equipo de "
                f"tipo {tipo.nombre}."
            )

    return limpias, errores
