"""Cómo se muestra el peso de un archivo en los mensajes de tamaño (US-007).

Antes cada validador escribía `f"{size / 1048576:.1f} MB"`, que redondea al
más cercano: un archivo de 5 242 881 bytes (apenas más de 5 MB) salía como
«5.0 MB y el máximo es 5 MB», y el usuario no entendía por qué se rechazaba.
Aquí el peso se redondea **hacia arriba** a dos decimales, con coma decimal
como se escribe en Ecuador, así que nunca parece igual o menor que el máximo.
"""

BYTES_POR_MEGA = 1024 * 1024


def megas_para_mostrar(tamano_bytes: int) -> str:
    """El peso en MB con dos decimales, redondeado hacia arriba y con coma.

    5 290 000 → «5,05»; 5 242 881 → «5,01»; 5 242 880 → «5,00». Se calcula
    con enteros para que la coma flotante no reste un céntimo."""
    centesimas = -(-max(0, int(tamano_bytes)) * 100 // BYTES_POR_MEGA)
    enteros, decimales = divmod(centesimas, 100)
    return f"{enteros},{decimales:02d}"


def maximo_para_mostrar(maximo_bytes: int) -> str:
    """El máximo en MB: entero si es exacto («5»), si no como el peso."""
    if maximo_bytes % BYTES_POR_MEGA == 0:
        return str(maximo_bytes // BYTES_POR_MEGA)
    return megas_para_mostrar(maximo_bytes)


def mensaje_de_tamano(sujeto: str, tamano_bytes: int, maximo_bytes: int) -> str:
    """«{sujeto} pesa 5,01 MB y el máximo es 5 MB.»

    `sujeto` va con su artículo: «El archivo», «La imagen»."""
    return (
        f"{sujeto} pesa {megas_para_mostrar(tamano_bytes)} MB y el máximo es "
        f"{maximo_para_mostrar(maximo_bytes)} MB."
    )
