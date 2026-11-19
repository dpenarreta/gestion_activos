"""Acta de recepción de equipo AEE-LC-01, en Word y PDF (16/11/2026).

Replica la plantilla «Inventarios de Sistemas» con la que TI documentaba cada
entrega: encabezado con el código del formato, datos del usuario, la tabla de
equipos (Parte 1), la prueba de funcionalidad (Parte 2), las observaciones y
las firmas. El sistema la completa con lo que se entregó —las asignaciones
de esa persona ese día— y con lo que el técnico marcó al generarla.

Los dos formatos salen de los mismos datos (`datos_del_acta`) y no uno del
otro: convertir un .docx a PDF en el servidor exigiría Word o LibreOffice
instalados allí. El Word es el editable; el PDF, el que se imprime tal cual.

El encabezado (código, revisión y fecha del formato) es fijo, como en la
plantilla, por decisión del usuario: una revisión nueva del formato pide una
actualización del sistema.
"""

from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from .models import ActaEntrega

CODIGO_FORMATO = "AEE-LC-01"
REVISION_FORMATO = "0"
FECHA_FORMATO = "08/octubre 2026"
TITULO = "Acta de Recepción de Equipo"
LOGO = Path(__file__).resolve().parent / "recursos" / "laarcourier.png"

#: Filas mínimas de la tabla de equipos: la plantilla deja el espacio para
#: anotar a mano algo que no está en el sistema.
FILAS_MINIMAS = 12

#: La Parte 2 va en dos columnas, como en la plantilla.
PRUEBAS_IZQUIERDA = ("on_off", "sistema_operativo", "aplicaciones", "unidad_optica", "impresora")
PRUEBAS_DERECHA = ("sonido", "pantalla", "teclado", "mouse")

GRIS = "BFBFBF"
GRIS_CLARO = "E7E6E6"


@dataclass
class FilaEquipo:
    equipo: str
    marca: str
    referencia: str
    modelo: str
    serial: str


@dataclass
class DatosActa:
    numero: int
    usuario: str
    cargo_usuario: str
    area: str
    fecha: str
    tecnico: str
    cargo_tecnico: str
    codigo_it: str
    modelo_equipo: str
    origen: str
    destino: str
    observaciones: str
    nuevo_de_paquete: bool | None
    pruebas: dict = field(default_factory=dict)
    equipos: list = field(default_factory=list)


ETIQUETAS_PRUEBA = dict(ActaEntrega.PRUEBAS)


def _nombre_usuario(usuario) -> str:
    if usuario is None:
        return ""
    return usuario.get_full_name() or usuario.username


def _cargo_usuario(usuario) -> str:
    empleado = getattr(usuario, "empleado", None) if usuario is not None else None
    return getattr(empleado, "cargo", "") or ""


def _lugar(sede, departamento=None) -> str:
    if sede is not None:
        return sede.ciudad or sede.nombre
    return departamento.nombre if departamento is not None else ""


def datos_del_acta(acta: ActaEntrega) -> DatosActa:
    """Todo lo que el acta muestra, ya en texto."""
    movimientos = list(
        acta.movimientos.select_related(
            "activo__tipo",
            "departamento_nuevo",
            "departamento_anterior",
            "sede_nueva",
            "sede_anterior",
        ).order_by("created_at", "id")
    )
    activos = [m.activo for m in movimientos]
    primero = movimientos[0] if movimientos else None
    area = (
        primero.departamento_nuevo.nombre
        if primero is not None and primero.departamento_nuevo is not None
        else acta.custodio.departamento.nombre
    )
    tipos = []
    nombres = [a.tipo.nombre for a in activos] + [
        item.get("equipo", "") for item in acta.items_sin_codigo or []
    ]
    for nombre in nombres:
        if nombre and nombre not in tipos:
            tipos.append(nombre)
    origen = ""
    destino = area
    if primero is not None:
        origen = _lugar(primero.sede_anterior) or "Bodega"
        destino = _lugar(primero.sede_nueva, primero.departamento_nuevo) or area
    return DatosActa(
        numero=acta.id,
        usuario=acta.custodio.nombre_completo,
        cargo_usuario=acta.custodio.cargo or "",
        area=area,
        fecha=acta.fecha.strftime("%d/%m/%Y"),
        tecnico=_nombre_usuario(acta.tecnico),
        cargo_tecnico=_cargo_usuario(acta.tecnico),
        codigo_it=", ".join(a.codigo_barras for a in activos),
        modelo_equipo=", ".join(tipos),
        origen=origen,
        destino=destino,
        observaciones=acta.observaciones.strip(),
        nuevo_de_paquete=acta.nuevo_de_paquete,
        pruebas=dict(acta.pruebas or {}),
        equipos=[
            FilaEquipo(
                equipo=a.tipo.nombre,
                marca=a.marca,
                referencia=a.codigo_barras,
                modelo=a.modelo,
                serial=a.numero_serie,
            )
            for a in activos
        ]
        + [_fila_sin_codigo(item) for item in acta.items_sin_codigo or []],
    )


def _fila_sin_codigo(item: dict) -> FilaEquipo:
    """Una fila de lo entregado sin estar en el inventario (19/11/2026): va
    en la misma tabla, con la cantidad si es más de uno y «Sin código» como
    referencia."""
    cantidad = item.get("cantidad") or 1
    nombre = item.get("equipo", "")
    return FilaEquipo(
        equipo=f"{nombre} ({cantidad})" if cantidad > 1 else nombre,
        marca=item.get("marca", ""),
        referencia="Sin código",
        modelo=item.get("modelo", ""),
        serial=item.get("serial", ""),
    )


def nombre_de_archivo(acta: ActaEntrega, extension: str) -> str:
    return f"acta-entrega-{CODIGO_FORMATO}-{acta.id}.{extension}"


def _filas_de_pruebas(datos: DatosActa):
    """Cinco filas de dos pruebas: (etiqueta, valor) a cada lado. La última
    de la derecha es «Nuevo de paquete», que es Sí/No y no Ok/Falla."""
    filas = []
    for i, clave in enumerate(PRUEBAS_IZQUIERDA):
        izquierda = (ETIQUETAS_PRUEBA[clave], datos.pruebas.get(clave, ""))
        if i < len(PRUEBAS_DERECHA):
            derecha_clave = PRUEBAS_DERECHA[i]
            derecha = (ETIQUETAS_PRUEBA[derecha_clave], datos.pruebas.get(derecha_clave, ""))
        else:
            derecha = ("Nuevo de Paquete", "paquete")
        filas.append((izquierda, derecha))
    return filas


def _paquete(datos: DatosActa):
    """(marca en «Sí», marca en «No»)."""
    return datos.nuevo_de_paquete is True, datos.nuevo_de_paquete is False


# --------------------------------------------------------------------------
# Word
# --------------------------------------------------------------------------


def generar_docx(acta: ActaEntrega) -> bytes:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt

    datos = datos_del_acta(acta)
    documento = Document()
    seccion = documento.sections[0]
    seccion.page_width, seccion.page_height = Cm(21), Cm(29.7)
    for lado in ("left_margin", "right_margin"):
        setattr(seccion, lado, Cm(1.5))
    seccion.top_margin = Cm(1.2)
    seccion.bottom_margin = Cm(1.2)
    estilo = documento.styles["Normal"]
    estilo.font.name = "Arial"
    estilo.font.size = Pt(8)
    estilo.paragraph_format.space_after = Pt(0)

    def sombrear(celda, color):
        propiedades = celda._tc.get_or_add_tcPr()
        sombra = OxmlElement("w:shd")
        sombra.set(qn("w:val"), "clear")
        sombra.set(qn("w:color"), "auto")
        sombra.set(qn("w:fill"), color)
        propiedades.append(sombra)

    def escribir(celda, texto, negrita=False, centrado=False, tamano=8, color=None):
        celda.text = ""
        parrafo = celda.paragraphs[0]
        if centrado:
            parrafo.alignment = WD_ALIGN_PARAGRAPH.CENTER
        corrida = parrafo.add_run(texto or "")
        corrida.bold = negrita
        corrida.font.size = Pt(tamano)
        if color:
            sombrear(celda, color)

    def tabla(filas, columnas, anchos):
        t = documento.add_table(rows=filas, cols=columnas)
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        for fila in t.rows:
            for i, ancho in enumerate(anchos):
                fila.cells[i].width = Cm(ancho)
        return t

    def espacio():
        p = documento.add_paragraph()
        p.paragraph_format.space_after = Pt(4)

    # Encabezado: logo, título y el cuadro del formato.
    t = tabla(4, 4, [5.5, 6.5, 2.5, 3.5])
    logo = t.cell(0, 0).merge(t.cell(3, 0))
    logo.text = ""
    if LOGO.exists():
        logo.paragraphs[0].add_run().add_picture(str(LOGO), width=Cm(4.5))
    titulo = t.cell(0, 1).merge(t.cell(3, 1))
    escribir(titulo, TITULO, negrita=True, centrado=True, tamano=11)
    for i, (etiqueta, valor) in enumerate(
        (
            ("Código:", CODIGO_FORMATO),
            ("Revisión:", REVISION_FORMATO),
            ("Fecha:", FECHA_FORMATO),
            ("Página:", "1 de 1"),
        )
    ):
        escribir(t.cell(i, 2), etiqueta, centrado=True)
        escribir(t.cell(i, 3), valor, centrado=True)
    espacio()

    # Datos del usuario.
    t = tabla(3, 4, [5.5, 6.5, 2.5, 3.5])
    escribir(t.cell(0, 0), "USUARIO:", negrita=True, centrado=True, color=GRIS)
    escribir(t.cell(0, 1).merge(t.cell(0, 3)), f"{datos.usuario} — {datos.area}", centrado=True)
    escribir(t.cell(1, 0), "FECHA DE ENTREGA:", negrita=True, centrado=True, color=GRIS)
    escribir(t.cell(1, 1).merge(t.cell(1, 3)), datos.fecha, centrado=True)
    escribir(t.cell(2, 0), "TÉCNICO(S) ASIGNADO(S):", negrita=True, centrado=True, color=GRIS)
    escribir(t.cell(2, 1), datos.tecnico, negrita=True, centrado=True)
    escribir(t.cell(2, 2), "Código IT:", negrita=True, centrado=True)
    escribir(t.cell(2, 3), datos.codigo_it)
    espacio()

    # Parte 1.
    t = tabla(2, 2, [5.5, 12.5])
    escribir(
        t.cell(0, 0).merge(t.cell(0, 1)),
        "PARTE 1: ESPECIFICACIONES DEL EQUIPO A ENTREGAR",
        negrita=True,
        centrado=True,
        color=GRIS,
    )
    escribir(t.cell(1, 0), "MODELO DEL EQUIPO A ENTREGAR:", negrita=True, centrado=True, color=GRIS)
    escribir(t.cell(1, 1), datos.modelo_equipo, centrado=True)
    espacio()

    filas = max(FILAS_MINIMAS, len(datos.equipos))
    t = tabla(filas + 1, 5, [3.6, 3.0, 2.8, 3.0, 5.6])
    for i, encabezado in enumerate(("EQUIPO", "MARCA", "REFERENCIA", "MODELO", "SERIAL")):
        escribir(t.cell(0, i), encabezado, negrita=True, centrado=True, color=GRIS)
    for fila, equipo in enumerate(datos.equipos, start=1):
        for i, valor in enumerate(
            (equipo.equipo, equipo.marca, equipo.referencia, equipo.modelo, equipo.serial)
        ):
            escribir(t.cell(fila, i), valor)
    espacio()

    # Parte 2.
    t = tabla(7, 6, [3.6, 2.3, 2.3, 3.6, 3.1, 3.1])
    escribir(
        t.cell(0, 0).merge(t.cell(0, 5)),
        "PARTE 2: PRUEBA DE FUNCIONALIDAD",
        negrita=True,
        centrado=True,
        color=GRIS,
    )
    escribir(t.cell(1, 0), "DESCRIPCIÓN", negrita=True, centrado=True, color=GRIS)
    escribir(
        t.cell(1, 1).merge(t.cell(1, 2)), "CALIFICACIÓN", negrita=True, centrado=True, color=GRIS
    )
    escribir(t.cell(1, 3), "DESCRIPCIÓN", negrita=True, centrado=True, color=GRIS)
    escribir(
        t.cell(1, 4).merge(t.cell(1, 5)), "CALIFICACIÓN", negrita=True, centrado=True, color=GRIS
    )

    def marca(activa, texto):
        return f"{'☒' if activa else '☐'} {texto}"

    si, no = _paquete(datos)
    for fila, (izquierda, derecha) in enumerate(_filas_de_pruebas(datos), start=2):
        escribir(t.cell(fila, 0), izquierda[0], centrado=True)
        escribir(t.cell(fila, 1), marca(izquierda[1] == "ok", "Ok"), centrado=True)
        escribir(t.cell(fila, 2), marca(izquierda[1] == "falla", "Falla"), centrado=True)
        escribir(t.cell(fila, 3), derecha[0], centrado=True)
        if derecha[1] == "paquete":
            escribir(t.cell(fila, 4), marca(si, "Sí"), centrado=True)
            escribir(t.cell(fila, 5), marca(no, "No"), centrado=True)
        else:
            escribir(t.cell(fila, 4), marca(derecha[1] == "ok", "Ok"), centrado=True)
            escribir(t.cell(fila, 5), marca(derecha[1] == "falla", "Falla"), centrado=True)
    espacio()

    # Observaciones.
    t = tabla(2, 1, [18])
    escribir(
        t.cell(0, 0),
        "OBSERVACIONES / RECOMENDACIONES TÉCNICAS / PROCESOS REALIZADOS",
        negrita=True,
        centrado=True,
        color=GRIS,
    )
    celda = t.cell(1, 0)
    celda.text = ""
    celda.paragraphs[0].add_run(
        f"- Origen: {datos.origen or '—'}        - Destino: {datos.destino or '—'}        {datos.fecha}"
    )
    celda.add_paragraph("")
    celda.add_paragraph(f"Observaciones: {datos.observaciones}")
    celda.add_paragraph("")
    espacio()

    # Firmas y estado del equipo.
    t = tabla(6, 4, [4.5, 4.5, 4.5, 4.5])
    escribir(
        t.cell(0, 0).merge(t.cell(0, 1)), "Entregado por:", negrita=True, centrado=True, color=GRIS
    )
    escribir(
        t.cell(0, 2).merge(t.cell(0, 3)),
        "Recibido a Satisfacción:",
        negrita=True,
        centrado=True,
        color=GRIS,
    )
    escribir(t.cell(1, 0).merge(t.cell(1, 1)), datos.tecnico, tamano=10)
    escribir(t.cell(1, 2).merge(t.cell(1, 3)), "")
    escribir(t.cell(2, 0), "Nombre y Cargo:", negrita=True)
    escribir(t.cell(2, 1), " — ".join(x for x in (datos.tecnico, datos.cargo_tecnico) if x))
    escribir(t.cell(2, 2), "Empresa – Usuario:", negrita=True)
    escribir(
        t.cell(2, 3), " — ".join(x for x in (datos.usuario, datos.cargo_usuario) if x), negrita=True
    )
    escribir(
        t.cell(3, 0).merge(t.cell(3, 1)),
        "Estado del equipo:",
        negrita=True,
        centrado=True,
        color=GRIS,
    )
    escribir(t.cell(3, 2).merge(t.cell(4, 3)), "FIRMA:")
    escribir(t.cell(4, 0), marca(True, "Asignado"))
    escribir(t.cell(4, 1), marca(False, "Devuelto"))
    escribir(t.cell(5, 0).merge(t.cell(5, 1)), "")
    escribir(t.cell(5, 2).merge(t.cell(5, 3)), "NOMBRE:")

    pie = documento.add_paragraph()
    pie.paragraph_format.space_before = Pt(8)
    corrida = pie.add_run(f"Acta N.º {datos.numero} · Generada por la Intranet LCE")
    corrida.font.size = Pt(7)

    salida = BytesIO()
    documento.save(salida)
    return salida.getvalue()


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------


def generar_pdf(acta: ActaEntrega) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    datos = datos_del_acta(acta)
    gris = colors.HexColor(f"#{GRIS}")
    normal = ParagraphStyle("normal", fontName="Helvetica", fontSize=7.5, leading=9)
    centrado = ParagraphStyle("centrado", parent=normal, alignment=TA_CENTER)
    negrita = ParagraphStyle("negrita", parent=centrado, fontName="Helvetica-Bold")
    negrita_izq = ParagraphStyle("negrita_izq", parent=normal, fontName="Helvetica-Bold")
    titulo = ParagraphStyle("titulo", parent=negrita, fontSize=11, leading=13)

    def p(texto, estilo=normal):
        return Paragraph(escape(texto or ""), estilo)

    def marca(activa, texto):
        # ZapfDingbats «4» es ✔; sin marca, el texto en gris.
        if activa:
            return Paragraph(f'<font name="ZapfDingbats">4</font> {texto}', negrita)
        return Paragraph(f'<font color="#808080">{texto}</font>', centrado)

    rejilla = [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    elementos = []

    if LOGO.exists():
        ancho_px, alto_px = ImageReader(str(LOGO)).getSize()
        logo = Image(str(LOGO), width=4.5 * cm, height=4.5 * cm * alto_px / ancho_px)
    else:
        logo = p("")
    encabezado = Table(
        [
            [logo, p(TITULO, titulo), p("Código:", centrado), p(CODIGO_FORMATO, centrado)],
            ["", "", p("Revisión:", centrado), p(REVISION_FORMATO, centrado)],
            ["", "", p("Fecha:", centrado), p(FECHA_FORMATO, centrado)],
            ["", "", p("Página:", centrado), p("1 de 1", centrado)],
        ],
        colWidths=[5.5 * cm, 6.5 * cm, 2.5 * cm, 3.5 * cm],
    )
    encabezado.setStyle(
        TableStyle(
            rejilla
            + [
                ("SPAN", (0, 0), (0, 3)),
                ("SPAN", (1, 0), (1, 3)),
                ("ALIGN", (0, 0), (0, 3), "CENTER"),
            ]
        )
    )
    elementos += [encabezado, Spacer(1, 0.3 * cm)]

    usuario = Table(
        [
            [p("USUARIO:", negrita), p(f"{datos.usuario} — {datos.area}", centrado), "", ""],
            [p("FECHA DE ENTREGA:", negrita), p(datos.fecha, centrado), "", ""],
            [
                p("TÉCNICO(S) ASIGNADO(S):", negrita),
                p(datos.tecnico, negrita),
                p("Código IT:", negrita),
                p(datos.codigo_it),
            ],
        ],
        colWidths=[5.5 * cm, 6.5 * cm, 2.5 * cm, 3.5 * cm],
    )
    usuario.setStyle(
        TableStyle(
            rejilla
            + [
                ("SPAN", (1, 0), (3, 0)),
                ("SPAN", (1, 1), (3, 1)),
                ("BACKGROUND", (0, 0), (0, 2), gris),
            ]
        )
    )
    elementos += [usuario, Spacer(1, 0.3 * cm)]

    parte1 = Table(
        [
            [p("PARTE 1: ESPECIFICACIONES DEL EQUIPO A ENTREGAR", negrita), ""],
            [p("MODELO DEL EQUIPO A ENTREGAR:", negrita), p(datos.modelo_equipo, centrado)],
        ],
        colWidths=[5.5 * cm, 12.5 * cm],
    )
    parte1.setStyle(
        TableStyle(
            rejilla
            + [
                ("SPAN", (0, 0), (1, 0)),
                ("BACKGROUND", (0, 0), (1, 0), gris),
                ("BACKGROUND", (0, 1), (0, 1), gris),
            ]
        )
    )
    elementos += [parte1, Spacer(1, 0.3 * cm)]

    filas = [[p(t, negrita) for t in ("EQUIPO", "MARCA", "REFERENCIA", "MODELO", "SERIAL")]]
    for e in datos.equipos:
        filas.append([p(e.equipo), p(e.marca), p(e.referencia), p(e.modelo), p(e.serial)])
    while len(filas) < FILAS_MINIMAS + 1:
        filas.append(["", "", "", "", ""])
    equipos = Table(
        filas,
        colWidths=[3.6 * cm, 3.0 * cm, 2.8 * cm, 3.0 * cm, 5.6 * cm],
        rowHeights=[None] + [0.45 * cm] * (len(filas) - 1),
    )
    equipos.setStyle(TableStyle(rejilla + [("BACKGROUND", (0, 0), (-1, 0), gris)]))
    elementos += [equipos, Spacer(1, 0.3 * cm)]

    si, no = _paquete(datos)
    filas = [
        [p("PARTE 2: PRUEBA DE FUNCIONALIDAD", negrita), "", "", "", "", ""],
        [
            p("DESCRIPCIÓN", negrita),
            p("CALIFICACIÓN", negrita),
            "",
            p("DESCRIPCIÓN", negrita),
            p("CALIFICACIÓN", negrita),
            "",
        ],
    ]
    for izquierda, derecha in _filas_de_pruebas(datos):
        fila = [
            p(izquierda[0], centrado),
            marca(izquierda[1] == "ok", "Ok"),
            marca(izquierda[1] == "falla", "Falla"),
            p(derecha[0], centrado),
        ]
        if derecha[1] == "paquete":
            fila += [marca(si, "Sí"), marca(no, "No")]
        else:
            fila += [marca(derecha[1] == "ok", "Ok"), marca(derecha[1] == "falla", "Falla")]
        filas.append(fila)
    parte2 = Table(filas, colWidths=[3.6 * cm, 2.3 * cm, 2.3 * cm, 3.6 * cm, 3.1 * cm, 3.1 * cm])
    parte2.setStyle(
        TableStyle(
            rejilla
            + [
                ("SPAN", (0, 0), (5, 0)),
                ("SPAN", (1, 1), (2, 1)),
                ("SPAN", (4, 1), (5, 1)),
                ("BACKGROUND", (0, 0), (5, 1), gris),
            ]
        )
    )
    elementos += [parte2, Spacer(1, 0.3 * cm)]

    separacion = "&nbsp;" * 6
    texto = (
        f"- Origen: {escape(datos.origen or '—')}{separacion}"
        f"- Destino: {escape(datos.destino or '—')}{separacion}{datos.fecha}"
        "<br/><br/>Observaciones: " + escape(datos.observaciones).replace("\n", "<br/>")
    )
    observaciones = Table(
        [
            [p("OBSERVACIONES / RECOMENDACIONES TÉCNICAS / PROCESOS REALIZADOS", negrita)],
            [Paragraph(texto, normal)],
        ],
        colWidths=[18 * cm],
        rowHeights=[None, 1.8 * cm],
    )
    observaciones.setStyle(
        TableStyle(
            rejilla + [("BACKGROUND", (0, 0), (0, 0), gris), ("VALIGN", (0, 1), (0, 1), "TOP")]
        )
    )
    elementos += [observaciones, Spacer(1, 0.3 * cm)]

    firmas = Table(
        [
            [p("Entregado por:", negrita), "", p("Recibido a Satisfacción:", negrita), ""],
            [p(datos.tecnico, ParagraphStyle("t", parent=normal, fontSize=10)), "", "", ""],
            [
                p("Nombre y Cargo:", negrita_izq),
                p(" — ".join(x for x in (datos.tecnico, datos.cargo_tecnico) if x)),
                p("Empresa – Usuario:", negrita_izq),
                p(" — ".join(x for x in (datos.usuario, datos.cargo_usuario) if x), negrita_izq),
            ],
            [p("Estado del equipo:", negrita), "", p("FIRMA:"), ""],
            [marca(True, "Asignado"), marca(False, "Devuelto"), "", ""],
            ["", "", p("NOMBRE:"), ""],
        ],
        colWidths=[4.5 * cm] * 4,
        rowHeights=[None, 0.8 * cm, None, None, 0.8 * cm, 0.6 * cm],
    )
    firmas.setStyle(
        TableStyle(
            rejilla
            + [
                ("SPAN", (0, 0), (1, 0)),
                ("SPAN", (2, 0), (3, 0)),
                ("SPAN", (0, 1), (1, 1)),
                ("SPAN", (2, 1), (3, 1)),
                ("SPAN", (0, 3), (1, 3)),
                ("SPAN", (2, 3), (3, 4)),
                ("SPAN", (0, 5), (1, 5)),
                ("SPAN", (2, 5), (3, 5)),
                ("BACKGROUND", (0, 0), (3, 0), gris),
                ("BACKGROUND", (0, 3), (1, 3), gris),
                ("VALIGN", (2, 3), (3, 4), "TOP"),
            ]
        )
    )
    elementos += [
        firmas,
        Spacer(1, 0.3 * cm),
        p(
            f"Acta N.º {datos.numero} · Generada por la Intranet LCE",
            ParagraphStyle("pie", parent=normal, fontSize=6.5),
        ),
    ]

    salida = BytesIO()
    documento = SimpleDocTemplate(
        salida,
        pagesize=A4,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.2 * cm,
        title=f"{TITULO} {CODIGO_FORMATO} N.º {datos.numero}",
    )
    documento.build(elementos)
    return salida.getvalue()
