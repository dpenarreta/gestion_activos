"""Actas de entrega y devolución en PDF (§6 y §18 del documento funcional).

El sistema ya registra quién recibió qué equipo y cuándo; el acta convierte
ese registro en el papel que se firma. Se genera a partir de un
`MovimientoActivo` concreto —no del estado actual del activo— porque el acta
documenta un hecho con fecha: si se rehiciera desde la ficha, un equipo que ya
cambió de custodio produciría un acta con el nombre equivocado.

Se dibuja con ReportLab, igual que las etiquetas, para no sumar una
dependencia de plantillas HTML a PDF por un documento de una página.
"""

from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from apps.activos.models import MovimientoActivo

MARGEN = 20 * mm
ANCHO, ALTO = A4

TIPOS_CON_ACTA = {
    MovimientoActivo.Tipo.ASIGNACION: "ACTA DE ENTREGA DE EQUIPO",
    MovimientoActivo.Tipo.DEVOLUCION: "ACTA DE DEVOLUCIÓN DE EQUIPO",
}


class ActaNoAplicable(ValueError):
    """El movimiento no representa una entrega ni una devolución."""


def _linea(pdf, y: float) -> float:
    pdf.setLineWidth(0.5)
    pdf.line(MARGEN, y, ANCHO - MARGEN, y)
    return y - 6 * mm


def _campo(pdf, y: float, etiqueta: str, valor: str) -> float:
    """Una fila «etiqueta: valor». Devuelve la nueva posición vertical."""
    pdf.setFont("Helvetica", 9)
    pdf.drawString(MARGEN, y, etiqueta.upper())
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(MARGEN + 55 * mm, y, valor or "—")
    return y - 8 * mm


def _parrafo(pdf, y: float, texto: str, ancho_util: float) -> float:
    """Texto justificado a la izquierda con salto de línea manual.

    ReportLab no reparte líneas por sí solo en el canvas de bajo nivel, y
    montar un `Paragraph` con estilos para tres frases traería más código del
    que ahorra.
    """
    pdf.setFont("Helvetica", 10)
    palabras = texto.split()
    linea = ""
    for palabra in palabras:
        tentativa = f"{linea} {palabra}".strip()
        if pdf.stringWidth(tentativa, "Helvetica", 10) > ancho_util:
            pdf.drawString(MARGEN, y, linea)
            y -= 5 * mm
            linea = palabra
        else:
            linea = tentativa
    if linea:
        pdf.drawString(MARGEN, y, linea)
        y -= 5 * mm
    return y


def _firma(pdf, y: float, x: float, ancho: float, titulo: str, nombre: str) -> None:
    pdf.setLineWidth(0.5)
    pdf.line(x, y, x + ancho, y)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawCentredString(x + ancho / 2, y - 5 * mm, nombre or "—")
    pdf.setFont("Helvetica", 8)
    pdf.drawCentredString(x + ancho / 2, y - 10 * mm, titulo)


def generar_acta(movimiento: MovimientoActivo, nombre_empresa: str = "") -> bytes:
    """Devuelve el PDF del acta correspondiente a un movimiento."""
    titulo = TIPOS_CON_ACTA.get(movimiento.tipo)
    if titulo is None:
        raise ActaNoAplicable(
            "Solo las asignaciones y devoluciones generan acta; "
            f"este movimiento es «{movimiento.get_tipo_display()}»."
        )

    activo = movimiento.activo
    es_entrega = movimiento.tipo == MovimientoActivo.Tipo.ASIGNACION
    # En una entrega el responsable es el nuevo custodio; en una devolución,
    # quien tenía el equipo hasta ese momento.
    empleado = movimiento.custodio_nuevo if es_entrega else movimiento.custodio_anterior

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle(f"{titulo} - {activo.codigo_barras}")

    y = ALTO - MARGEN
    if nombre_empresa:
        pdf.setFont("Helvetica-Bold", 12)
        pdf.drawString(MARGEN, y, nombre_empresa)
        y -= 7 * mm

    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(MARGEN, y, titulo)
    y -= 5 * mm
    pdf.setFont("Helvetica", 9)
    pdf.drawString(MARGEN, y, f"Documento N.º {movimiento.id} · {activo.codigo_barras}")
    y -= 8 * mm
    y = _linea(pdf, y)

    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(MARGEN, y, "DATOS DEL EQUIPO")
    y -= 8 * mm
    y = _campo(pdf, y, "Código interno", activo.codigo_barras)
    y = _campo(pdf, y, "Equipo", f"{activo.nombre}")
    y = _campo(
        pdf, y, "Tipo / marca / modelo", f"{activo.tipo.nombre} · {activo.marca} {activo.modelo}"
    )
    y = _campo(pdf, y, "Número de serie", activo.numero_serie)
    if activo.especificaciones:
        detalle = " · ".join(f"{k}: {v}" for k, v in list(activo.especificaciones.items())[:4])
        y = _campo(pdf, y, "Características", detalle)

    y -= 2 * mm
    y = _linea(pdf, y)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(MARGEN, y, "RESPONSABLE" if es_entrega else "DEVUELTO POR")
    y -= 8 * mm
    y = _campo(pdf, y, "Nombre", empleado.nombre_completo if empleado else "—")
    y = _campo(pdf, y, "Código de empleado", empleado.codigo_empleado if empleado else "—")
    y = _campo(
        pdf,
        y,
        "Área",
        (
            movimiento.departamento_nuevo or movimiento.departamento_anterior or activo.departamento
        ).nombre,
    )
    y = _campo(pdf, y, "Fecha", movimiento.created_at.strftime("%d/%m/%Y"))
    if movimiento.motivo:
        y = _campo(pdf, y, "Motivo", movimiento.motivo[:80])

    y -= 2 * mm
    y = _linea(pdf, y)

    texto = (
        "Declaro haber recibido el equipo descrito en este documento en buen estado de "
        "funcionamiento, y me comprometo a utilizarlo para las funciones propias de mi cargo, "
        "a custodiarlo con la diligencia debida y a informar de inmediato cualquier daño, "
        "pérdida o robo. El equipo es propiedad de la empresa y deberá ser devuelto cuando "
        "esta lo solicite o al término de la relación laboral."
        if es_entrega
        else "Se deja constancia de la devolución del equipo descrito en este documento. "
        "El área de TI verificará su estado y dejará registro de cualquier novedad "
        "encontrada en la revisión."
    )
    y = _parrafo(pdf, y, texto, ANCHO - 2 * MARGEN)

    # Las firmas van ancladas al pie y no debajo del texto: así el documento
    # sale siempre igual, aunque el párrafo ocupe una línea más o menos.
    y_firmas = MARGEN + 25 * mm
    ancho_firma = (ANCHO - 2 * MARGEN - 15 * mm) / 2
    _firma(
        pdf,
        y_firmas,
        MARGEN,
        ancho_firma,
        "Recibe conforme" if es_entrega else "Entrega",
        empleado.nombre_completo if empleado else "",
    )
    _firma(
        pdf,
        y_firmas,
        MARGEN + ancho_firma + 15 * mm,
        ancho_firma,
        "Por Tecnología",
        (
            movimiento.registrado_por.get_full_name() or movimiento.registrado_por.username
            if movimiento.registrado_por
            else ""
        ),
    )

    pdf.setFont("Helvetica", 7)
    pdf.drawCentredString(
        ANCHO / 2,
        MARGEN - 5 * mm,
        f"Generado por el sistema de gestión de activos · {movimiento.created_at.strftime('%d/%m/%Y %H:%M')}",
    )

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def nombre_de_archivo(movimiento: MovimientoActivo) -> str:
    prefijo = (
        "acta-entrega" if movimiento.tipo == MovimientoActivo.Tipo.ASIGNACION else "acta-devolucion"
    )
    return f"{prefijo}-{movimiento.activo.codigo_barras}-{movimiento.id}.pdf"
