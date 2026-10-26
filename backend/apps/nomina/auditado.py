"""Rol de pagos auditado (26/10/2026, pedido de Talento Humano).

Talento Humano (`roles_pago.historial`) elige una persona por su código y uno
o varios meses. Por cada mes sale un PDF en A4 vertical, **sin clave**:

- **Arriba**, el rol de pagos tal como lo ve la persona (el mismo dibujo de
  `pdf.dibujar`, vuelto a generar desde nómina; no se guarda).
- **Abajo** (y en las hojas que hagan falta), la constancia de todo lo que
  pasó con ese rol, en orden: cuándo se abrió y se aceptaron los términos,
  cuándo se descargó, cuándo se envió al correo, cuándo se aceptó, cada
  observación con su texto, cada corrección de Talento Humano con su nota y
  sus adjuntos, y cuándo quedó resuelta. Con fecha, hora, quién e IP.

Un mes: el PDF. Varios: un ZIP sin clave con un PDF por mes. Si nómina no
tiene el rol de un mes pero sí hubo movimientos, el PDF lleva la constancia y
lo dice; si no hubo nada, ese mes se omite.
"""

import io
import zipfile
from dataclasses import dataclass, field
from datetime import datetime

from django.utils import timezone
from reportlab.lib.colors import Color, black
from reportlab.lib.pagesizes import A4, A5, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas
from rest_framework.exceptions import PermissionDenied, ValidationError

from . import aceptado, fuente, pdf
from .models import ConsultaRolPagos, MensajeObservacion, ObservacionRolPagos

#: Cuántos meses se pueden pedir de una vez.
MAXIMO_MESES = 36
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
GRIS = Color(0.42, 0.45, 0.5)
LINEA = Color(0.82, 0.84, 0.87)


@dataclass
class Evento:
    cuando: datetime
    titulo: str
    detalle: str = ""
    quien: str = ""
    ip: str = ""
    orden: int = 0


@dataclass
class Constancia:
    anio: int
    mes: int
    codigo: str
    persona: str
    eventos: list = field(default_factory=list)
    estado_observacion: str = ""
    rol: object = None
    #: Por qué no está el rol arriba, si no es que nómina no lo tiene.
    sin_rol: str = ""
    #: De dónde sale el rol de arriba (el aceptado o nómina).
    nota_rol: str = ""


def _nombre(usuario) -> str:
    if usuario is None:
        return ""
    return (usuario.get_full_name() or "").strip() or usuario.username


def _nombre_mes(mes: int) -> str:
    return fuente.MESES[mes - 1].capitalize()


def eventos_del_periodo(codigo: str, anio: int, mes: int, persona=None) -> list[Evento]:
    """Todo lo que pasó con el rol de ese código y mes, en orden."""
    from apps.core.models import AuditLog
    from apps.descargas.models import Descarga

    propio = getattr(persona, "pk", None)
    eventos: list[Evento] = []
    consultas = list(
        ConsultaRolPagos.objects.filter(codigo_empleado=codigo, anio=anio, mes=mes)
        .select_related("usuario")
        .order_by("created_at")
    )
    for c in consultas:
        de_talento_humano = c.usuario_id != propio
        eventos.append(
            Evento(
                c.created_at,
                (
                    "Talento Humano abrió el rol y aceptó los términos"
                    if de_talento_humano
                    else "Abrió el rol de pagos y aceptó los términos"
                ),
                f"Versión {c.version_terminos} de los términos.",
                _nombre(c.usuario),
                c.ip or "",
                1,
            )
        )
        if c.conformidad and c.conformidad_en:
            if c.conformidad == ConsultaRolPagos.Conformidad.OBSERVACION:
                titulo, detalle = "Hizo una observación", c.observacion
            elif c.conformidad == ConsultaRolPagos.Conformidad.AL_CERRAR:
                titulo, detalle = "Aceptó el rol al cerrar sin responder", ""
            else:
                titulo, detalle = "Aceptó el rol: estuvo de acuerdo", ""
            eventos.append(
                Evento(
                    c.conformidad_en,
                    titulo,
                    detalle,
                    _nombre(c.usuario),
                    c.conformidad_ip or "",
                    4,
                )
            )

    # Envíos al correo (la auditoría guarda el correo enmascarado).
    ids = {c.id: c for c in consultas}
    if ids:
        for registro in AuditLog.objects.filter(
            action="roles_pago.envio", created_at__gte=consultas[0].created_at
        ).select_related("actor"):
            if (registro.new_values or {}).get("consulta") in ids:
                destino = (registro.new_values or {}).get("a", "")
                eventos.append(
                    Evento(
                        registro.created_at,
                        "Se envió al correo",
                        f"A {destino}." if destino else "",
                        _nombre(registro.actor),
                        registro.ip_address or "",
                        3,
                    )
                )

    # Talento Humano lo abrió desde el historial o lo descargó auditado.
    for registro in AuditLog.objects.filter(
        action__in=["roles_pago.historial.rol_visto", "roles_pago.auditado.descargado"]
    ).select_related("actor"):
        valores = registro.new_values or {}
        if valores.get("codigo") != codigo:
            continue
        if registro.action == "roles_pago.historial.rol_visto":
            if (valores.get("anio"), valores.get("mes")) != (anio, mes):
                continue
            titulo = "Talento Humano abrió el rol desde el historial"
        else:
            if [anio, mes] not in [list(p) for p in valores.get("periodos", [])]:
                continue
            titulo = "Talento Humano descargó el rol auditado"
        eventos.append(
            Evento(
                registro.created_at,
                titulo,
                "",
                _nombre(registro.actor),
                registro.ip_address or "",
                2,
            )
        )

    # Descargas del PDF (registro de descargas).
    for d in Descarga.objects.filter(sin_copia__startswith="Rol de pagos").select_related(
        "usuario"
    ):
        ref = d.referencia or {}
        if ref.get("tipo") == "rol_pagos" and (
            ref.get("codigo"),
            ref.get("anio"),
            ref.get("mes"),
        ) == (
            codigo,
            anio,
            mes,
        ):
            eventos.append(
                Evento(d.created_at, "Descargó el PDF", d.nombre, _nombre(d.usuario), d.ip or "", 2)
            )

    # Correcciones de Talento Humano y cierre de la observación.
    for m in (
        MensajeObservacion.objects.filter(
            observacion__codigo_empleado=codigo, observacion__anio=anio, observacion__mes=mes
        )
        .exclude(tipo=MensajeObservacion.Tipo.OBSERVACION)  # ya está en la conformidad
        .select_related("autor")
        .prefetch_related("adjuntos")
    ):
        if m.tipo == MensajeObservacion.Tipo.CORRECCION:
            adjuntos = [a.nombre_original for a in m.adjuntos.all()]
            detalle = m.texto + (f" Adjuntos: {', '.join(adjuntos)}." if adjuntos else "")
            eventos.append(
                Evento(
                    m.created_at,
                    "Talento Humano corrigió el rol (ajuste)",
                    detalle,
                    _nombre(m.autor),
                    "",
                    5,
                )
            )
        else:
            eventos.append(
                Evento(
                    m.created_at,
                    "Observación resuelta: confirmó que está de acuerdo",
                    "",
                    _nombre(m.autor),
                    "",
                    6,
                )
            )
    return sorted(eventos, key=lambda e: (e.cuando, e.orden))


# --- El PDF -------------------------------------------------------------------------------


def _momento(fecha) -> tuple[str, str]:
    local = timezone.localtime(fecha)
    return f"{DIAS[local.weekday()]} {local:%d/%m/%Y}", f"{local:%H:%M:%S}"


class _Hoja:
    """Escribe de arriba abajo y pasa de hoja cuando no cabe."""

    def __init__(self, c, ancho, alto, encabezado):
        self.c, self.ancho, self.alto = c, ancho, alto
        self.m = 14 * mm
        self.encabezado = encabezado
        self.y = 0

    def nueva(self):
        self.c.showPage()
        self.y = self.alto - self.m
        self.c.setFont("Helvetica", 7)
        self.c.setFillColor(GRIS)
        self.c.drawString(self.m, self.y, self.encabezado)
        self.c.setFillColor(black)
        self.y -= 16

    def espacio(self, alto):
        if self.y - alto < self.m:
            self.nueva()


COLUMNAS = [("Fecha", 34), ("Hora", 16), ("Evento y detalle", 74), ("Quién", 32), ("IP", 26)]


def _fila(hoja, valores, negrita=False):
    c, m = hoja.c, hoja.m
    x, partes = m, []
    for (_, ancho_mm), valor in zip(COLUMNAS, valores, strict=False):
        lineas = []
        for i, texto in enumerate(valor if isinstance(valor, list) else [valor]):
            fuente_ = (
                "Helvetica-Bold"
                if (negrita or (isinstance(valor, list) and i == 0))
                else "Helvetica"
            )
            for linea in simpleSplit(str(texto or ""), fuente_, 7.5, ancho_mm * mm - 3) or [""]:
                lineas.append((linea, fuente_))
        partes.append((x, lineas))
        x += ancho_mm * mm
    alto = max(len(lineas) for _, lineas in partes) * 9.5 + 5
    hoja.espacio(alto)
    for x, lineas in partes:
        y = hoja.y
        for linea, fuente_ in lineas:
            c.setFont(fuente_, 7.5)
            c.drawString(x, y, linea)
            y -= 9.5
    hoja.y -= alto
    c.setStrokeColor(LINEA)
    c.setLineWidth(0.3)
    c.line(m, hoja.y + 6, hoja.ancho - m, hoja.y + 6)
    c.setStrokeColor(black)


def construir(constancia: Constancia, generado_por: str, empresa: str) -> bytes:
    salida = io.BytesIO()
    ancho, alto = A4
    c = canvas.Canvas(salida, pagesize=A4)
    periodo = f"{_nombre_mes(constancia.mes)} {constancia.anio}"
    c.setTitle(f"Rol de pagos auditado {periodo} - {constancia.codigo}")
    c.setAuthor(empresa)

    # Arriba: el rol, en la media hoja de arriba (A5 apaisada).
    ancho_rol, alto_rol = landscape(A5)
    if constancia.rol is not None:
        c.saveState()
        c.translate(0, alto - alto_rol)
        pdf.dibujar(c, constancia.rol, ancho_rol, alto_rol)
        c.restoreState()
    else:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(14 * mm, alto - 20 * mm, f"{empresa} * Rol de Pagos - {periodo}")
        c.setFont("Helvetica", 9)
        c.drawString(
            14 * mm,
            alto - 30 * mm,
            constancia.sin_rol
            or f"Nómina no tiene el rol de pagos de este mes para el código {constancia.codigo}.",
        )
        c.drawString(
            14 * mm, alto - 36 * mm, "Abajo queda la constancia de lo registrado en el sistema."
        )

    # Abajo: la constancia.
    hoja = _Hoja(
        c,
        ancho,
        alto,
        f"Rol de pagos auditado · {constancia.persona} · {constancia.codigo} · {periodo}",
    )
    m = hoja.m
    corte = alto - alto_rol
    c.setDash(3, 2)
    c.setStrokeColor(GRIS)
    c.line(m, corte, ancho - m, corte)
    c.setDash()
    c.setStrokeColor(black)
    hoja.y = corte - 18
    c.setFont("Helvetica-Bold", 11)
    c.drawString(m, hoja.y, f"Constancia de auditoría · {periodo}")
    hoja.y -= 13
    c.setFont("Helvetica", 8)
    dia, hora = _momento(timezone.now())
    for linea in (
        f"Persona: {constancia.persona} · Código de empleado: {constancia.codigo}",
        f"Generada por {generado_por} el {dia} a las {hora}.",
        constancia.nota_rol or "Rol vuelto a generar desde nómina.",
        (
            f"Observación del período: {constancia.estado_observacion}."
            if constancia.estado_observacion
            else "Sin observaciones en el período."
        ),
    ):
        c.drawString(m, hoja.y, linea)
        hoja.y -= 11
    hoja.y -= 6
    if not constancia.eventos:
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(
            m, hoja.y, "No hay movimientos registrados: la persona no ha abierto este rol."
        )
    else:
        _fila(hoja, [t for t, _ in COLUMNAS], negrita=True)
        for e in constancia.eventos:
            dia, hora = _momento(e.cuando)
            _fila(
                hoja,
                [dia, hora, [e.titulo] + ([e.detalle] if e.detalle else []), e.quien, e.ip or "—"],
            )
    c.showPage()
    c.save()
    return salida.getvalue()


# --- Lo que pide la pantalla -----------------------------------------------------------------


def _periodos(periodos) -> list[tuple[int, int]]:
    from .services import _validar_periodo

    elegidos = []
    for p in periodos or []:
        try:
            anio, mes = int(p["anio"]), int(p["mes"])
        except (KeyError, TypeError, ValueError):
            raise ValidationError({"periodos": "Elija meses válidos."}) from None
        _validar_periodo(anio, mes)
        if (anio, mes) not in elegidos:
            elegidos.append((anio, mes))
    if not elegidos:
        raise ValidationError({"periodos": "Elija al menos un mes."})
    if len(elegidos) > MAXIMO_MESES:
        raise ValidationError({"periodos": f"Elija hasta {MAXIMO_MESES} meses a la vez."})
    return sorted(elegidos)


def _nota(rol_aceptado, codigo, anio, mes, empresa) -> str:
    """De dónde sale el rol de arriba. Si es el aceptado y nómina hoy dice
    otra cosa, se avisa."""
    if rol_aceptado is None:
        return "Rol vuelto a generar desde nómina."
    dia, hora = _momento(rol_aceptado.created_at)
    nota = f"Es el rol que la persona aceptó el {dia} a las {hora}, guardado como constancia."
    try:
        actual = fuente.obtener(codigo, anio, mes, empresa)
    except (fuente.RolNoDisponible, fuente.FuenteNoConfigurada):
        return nota
    if aceptado.huella(actual) != rol_aceptado.huella:
        nota += " Atención: hoy nómina tiene valores distintos para este mes."
    return nota


def _nombre_archivo(codigo, anio, mes) -> str:
    return f"Rol auditado - {codigo} - {anio}-{mes:02d} {_nombre_mes(mes)}.pdf"


def generar(actor, codigo, periodos, password) -> dict:
    """`{nombre, contenido, tipo, incluidos, omitidos, periodos}`: un PDF si es
    un mes; un ZIP (sin clave) con un PDF por mes si son varios."""
    from apps.users.models import User

    from .services import _nombre_empresa, ve_historial

    if not ve_historial(actor):
        raise PermissionDenied("No tiene el permiso requerido: roles_pago.historial.")
    if not password or not actor.check_password(password):
        raise PermissionDenied("La contraseña no es correcta.")
    codigo = (codigo or "").strip()
    if not codigo:
        raise ValidationError({"codigo": "Escriba el código de empleado."})
    elegidos = _periodos(periodos)
    persona = User.objects.filter(codigo_empleado__iexact=codigo).first()
    nombre_persona = _nombre(persona) or f"Código {codigo}"
    empresa = _nombre_empresa()
    generado_por = _nombre(actor)

    archivos, omitidos = [], []
    for anio, mes in elegidos:
        sin_rol = ""
        rol_aceptado = None
        try:
            rol, rol_aceptado = aceptado.rol_del_periodo(codigo, anio, mes, empresa)
        except fuente.RolNoDisponible:
            rol = None
        except fuente.FuenteNoConfigurada:
            # Nómina no responde (o aún no está conectada): sale la constancia.
            rol = None
            sin_rol = "No se pudo generar el rol: la consulta a nómina no está disponible."
        eventos = eventos_del_periodo(codigo, anio, mes, persona)
        if rol is None and not eventos:
            omitidos.append(f"{_nombre_mes(mes)} {anio}: sin rol en nómina ni movimientos.")
            continue
        observacion = (
            ObservacionRolPagos.objects.filter(codigo_empleado=codigo, anio=anio, mes=mes)
            .order_by("-updated_at")
            .first()
        )
        constancia = Constancia(
            anio=anio,
            mes=mes,
            codigo=codigo,
            persona=nombre_persona,
            eventos=eventos,
            estado_observacion=observacion.get_estado_display() if observacion else "",
            rol=rol,
            sin_rol=sin_rol,
            nota_rol=_nota(rol_aceptado, codigo, anio, mes, empresa),
        )
        archivos.append(
            (_nombre_archivo(codigo, anio, mes), construir(constancia, generado_por, empresa))
        )
    if not archivos:
        raise ValidationError({"periodos": "Esos meses no tienen rol en nómina ni movimientos."})

    resultado = {
        "incluidos": len(archivos),
        "omitidos": len(omitidos),
        "periodos": [[a, m] for a, m in elegidos],
    }
    if len(elegidos) == 1:
        nombre, contenido = archivos[0]
        return {**resultado, "nombre": nombre, "contenido": contenido, "tipo": "application/pdf"}
    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w", zipfile.ZIP_DEFLATED) as zip_:
        for nombre, contenido in archivos:
            zip_.writestr(nombre, contenido)
        if omitidos:
            zip_.writestr("LEEME.txt", ("\r\n".join(omitidos) + "\r\n").encode("utf-8-sig"))
    desde, hasta = elegidos[0], elegidos[-1]
    nombre = (
        f"Roles auditados - {codigo} - {desde[0]}-{desde[1]:02d} a {hasta[0]}-{hasta[1]:02d}.zip"
    )
    return {
        **resultado,
        "nombre": nombre,
        "contenido": memoria.getvalue(),
        "tipo": "application/zip",
    }


def meses_del_codigo(codigo: str) -> list[dict]:
    """Los meses con movimientos de ese código (consultas u observaciones),
    para marcarlos en la pantalla; lo más reciente primero."""
    hay = set(
        ConsultaRolPagos.objects.filter(codigo_empleado=codigo).values_list("anio", "mes")
    ) | set(ObservacionRolPagos.objects.filter(codigo_empleado=codigo).values_list("anio", "mes"))
    return [{"anio": a, "mes": m} for a, m in sorted(hay, reverse=True)]
