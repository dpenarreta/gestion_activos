"""El PDF del rol de pagos, con el formato del rol impreso de la empresa:
cabecera con la empresa y el mes; a la derecha la sucursal, el departamento,
el período y la cuenta de depósito; los datos del empleado; lo informativo;
ingresos a la izquierda y egresos a la derecha con sus totales; el neto a
recibir y la línea de «Recibí conforme». Media hoja A4 apaisada (A5)."""

import io

from reportlab.lib.colors import Color, black
from reportlab.lib.pagesizes import A5, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def _dinero(valor) -> str:
    return f"${valor:,.2f}"


def _numero(valor) -> str:
    return f"{valor:,.2f}"


def construir(rol) -> bytes:
    salida = io.BytesIO()
    ancho, alto = landscape(A5)
    c = canvas.Canvas(salida, pagesize=(ancho, alto))
    c.setTitle(f"Rol de pagos {rol.nombre_mes} {rol.anio} - {rol.codigo}")
    c.setAuthor(rol.empresa)
    dibujar(c, rol, ancho, alto)
    c.showPage()
    c.save()
    return salida.getvalue()


def dibujar(c, rol, ancho, alto):
    """El rol sobre una hoja de `ancho` × `alto` (la de A5 apaisada), desde
    la esquina inferior izquierda del lienzo. El rol auditado lo dibuja en la
    mitad de arriba de una A4 (`auditado.py`)."""
    m = 12 * mm
    y = alto - m

    if rol.ejemplo:
        # Discreta, para ver el formato tal cual; pero que no se confunda con
        # un rol real (el real sale del procedimiento almacenado).
        c.saveState()
        c.setFillColor(Color(0.8, 0.1, 0.1))
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(ancho / 2, alto - 6 * mm, "VISTA PREVIA · DATOS DE EJEMPLO")
        c.restoreState()

    # Cabecera
    c.setFont("Helvetica-Bold", 11)
    c.drawString(m, y, f"{rol.empresa} * Rol de Pagos - {rol.nombre_mes} {rol.anio}")
    c.setFont("Helvetica", 7.5)
    derecha = ancho - m
    for i, linea in enumerate(
        [
            rol.sucursal,
            rol.departamento,
            f"Fecha: [{rol.periodo_desde}] - [{rol.periodo_hasta}]",
            f"Depósito: {rol.deposito}",
            f"Código: {rol.codigo_rubro}",
        ]
    ):
        if linea and not linea.endswith(": "):
            c.drawRightString(derecha, y - i * 9, linea)

    # Datos del empleado, debajo del bloque de la derecha (cinco líneas).
    y -= 50
    c.setFont("Helvetica", 8.5)
    columnas = [m, m + 26 * mm, m + 56 * mm, m + 110 * mm]
    for x, valor in zip(
        columnas, [rol.codigo, rol.cedula, rol.apellidos, rol.nombres], strict=False
    ):
        c.drawString(x, y, valor)
    y -= 8
    c.setFont("Helvetica", 6.5)
    for x, titulo in zip(columnas, ["Código", "Cédula", "Apellidos", "Nombres"], strict=False):
        c.drawString(x, y, titulo)
    y -= 10
    c.setFont("Helvetica", 7.5)
    estado = f"{rol.estado} [{rol.fecha_ingreso}]" if rol.fecha_ingreso else rol.estado
    c.drawString(m, y, estado)
    c.drawString(columnas[2], y, "Nombre Rub.")
    c.drawRightString(derecha, y, "Valor")
    c.setLineWidth(0.4)
    c.line(m, y - 2, derecha, y - 2)

    # Informativo
    y -= 14
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(m, y, "Informativo")
    c.setFont("Helvetica", 8.5)
    for rubro in rol.informativo:
        y -= 11
        c.drawString(m + 4 * mm, y, rubro.nombre)
        c.drawRightString(m + 95 * mm, y, _numero(rubro.valor))

    # Ingresos (izquierda) y egresos (derecha)
    y -= 18
    mitad = ancho / 2 + 2 * mm
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(m, y, "Ingreso")
    c.drawString(mitad, y, "Egreso")
    c.setFont("Helvetica", 8.5)
    filas = max(len(rol.ingresos), len(rol.egresos))
    for i in range(filas):
        y -= 11
        if i < len(rol.ingresos):
            c.drawString(m + 4 * mm, y, rol.ingresos[i].nombre)
            c.drawRightString(mitad - 8 * mm, y, _numero(rol.ingresos[i].valor))
        if i < len(rol.egresos):
            c.drawString(mitad + 4 * mm, y, rol.egresos[i].nombre)
            c.drawRightString(derecha, y, _numero(rol.egresos[i].valor))
    y -= 5
    c.line(mitad - 40 * mm, y, mitad - 8 * mm, y)
    c.line(derecha - 32 * mm, y, derecha, y)
    y -= 10
    c.setFont("Helvetica-Bold", 8.5)
    c.drawRightString(mitad - 42 * mm, y, "Total 'Ingreso'")
    c.drawRightString(mitad - 8 * mm, y, _dinero(rol.total_ingresos))
    c.drawRightString(derecha - 34 * mm, y, "Total 'Egreso'")
    c.drawRightString(derecha, y, _dinero(rol.total_egresos))

    # Neto y firma
    y -= 22
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(m + 20 * mm, y, f"Total empleado '{rol.apellidos} {rol.nombres}'")
    c.drawRightString(m + 150 * mm, y, _dinero(rol.neto))
    y -= 26
    c.setStrokeColor(black)
    c.line(ancho - m - 70 * mm, y, ancho - m - 10 * mm, y)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(
        ancho - m - 40 * mm, y - 10, f"Recibí Conforme CI {rol.cedula.replace('-', '')}"
    )
