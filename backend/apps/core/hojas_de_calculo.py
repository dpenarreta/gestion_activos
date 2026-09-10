"""Que un valor del inventario no se vuelva una fórmula al abrir el archivo.

Excel, LibreOffice y Google Sheets interpretan como fórmula toda celda que
empiece por `=`, `+`, `-` o `@`. Un activo llamado
`=HYPERLINK("http://…"&A1;"Ver ficha")` no hace nada dentro del sistema —es
texto— pero se ejecuta en el equipo de quien abre el reporte exportado, que es
justo donde el sistema ya no puede protegerlo: filtración del contenido de la
hoja con `WEBSERVICE`, enlaces engañosos, o ejecución vía DDE en instalaciones
antiguas.

La defensa es una comilla simple delante: la hoja la muestra como texto, no la
imprime, y el archivo sigue leyéndose igual. Se aplica **al escribir**, no al
guardar el dato: el nombre del equipo es el que el usuario eligió, y cambiarlo
en la base para protegerse de una herramienta ajena sería corregir el sitio
equivocado.
"""

#: Los cuatro que abren fórmula, más los dos espacios que algunas versiones
#: recortan antes de decidir (`\t=1+1` llega a la hoja como `=1+1`).
PELIGROSOS = ("=", "+", "-", "@", "\t", "\r")


def neutralizar(valor):
    """Devuelve el valor tal cual, salvo el texto que la hoja tomaría por fórmula."""
    if isinstance(valor, str) and valor.startswith(PELIGROSOS):
        return f"'{valor}"
    return valor


def neutralizar_fila(fila):
    return [neutralizar(valor) for valor in fila]
