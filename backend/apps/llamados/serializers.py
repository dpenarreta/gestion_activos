"""Entradas y salidas de la API de llamados de atención (US-013).

Los identificadores (persona, causa, nivel) entran como enteros y los resuelve
el servicio con el gestor por empresa en el momento de la petición: un
`PrimaryKeyRelatedField(queryset=Modelo.objects.all())` fija el filtro de
empresa al importar el módulo, y dejaría elegir lo de otra empresa.
"""

from decimal import Decimal, InvalidOperation

from rest_framework import serializers

from apps.adjuntos.validators import tipo_por_extension, validar_archivo

from . import services
from .models import (
    AccionLlamado,
    CausaLlamado,
    FormaSancion,
    LlamadoAtencion,
    NivelLlamado,
    TipoNivel,
)

# --- Campos que aceptan vacío en multipart ----------------------------------------------------


class EnteroOpcional(serializers.Field):
    """Un entero o nada: en un formulario multipart lo vacío llega como «»."""

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def validate_empty_values(self, data):
        if data == "":
            return True, None
        return super().validate_empty_values(data)

    def to_internal_value(self, data):
        try:
            valor = int(str(data).strip())
        except (TypeError, ValueError):
            raise serializers.ValidationError("Debe ser un número entero.") from None
        if valor < 1:
            raise serializers.ValidationError("Debe ser un número entero.")
        return valor

    def to_representation(self, value):
        return value


class MontoOpcional(serializers.Field):
    """Un monto con hasta dos decimales (acepta coma o punto) o nada."""

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def validate_empty_values(self, data):
        if data == "":
            return True, None
        return super().validate_empty_values(data)

    def to_internal_value(self, data):
        texto = str(data).strip().replace(",", ".")
        try:
            valor = Decimal(texto)
        except (InvalidOperation, ValueError):
            raise serializers.ValidationError(
                "Escriba un monto válido, por ejemplo 25,00."
            ) from None
        if not valor.is_finite():
            raise serializers.ValidationError("Escriba un monto válido, por ejemplo 25,00.")
        if valor.as_tuple().exponent < -2:
            raise serializers.ValidationError("Use como máximo dos decimales.")
        if valor < 0:
            raise serializers.ValidationError("El monto no puede ser negativo.")
        if valor > services.MONTO_MAX:
            raise serializers.ValidationError("El monto es demasiado alto.")
        return valor.quantize(Decimal("0.01"))

    def to_representation(self, value):
        return None if value is None else f"{value:.2f}"


class PorcentajeOpcional(serializers.Field):
    """Un porcentaje con hasta dos decimales (acepta coma o punto) o nada. El
    rango (mayor que 0, hasta 100 y el tope de la empresa) lo valida el
    servicio, para que el error salga igual por cualquier camino."""

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def validate_empty_values(self, data):
        if data == "":
            if not self.allow_null:
                self.fail("null")
            return True, None
        return super().validate_empty_values(data)

    def to_internal_value(self, data):
        texto = str(data).strip().replace(",", ".").rstrip("%").strip()
        try:
            valor = Decimal(texto)
        except (InvalidOperation, ValueError):
            raise serializers.ValidationError(
                "Escriba un porcentaje válido, por ejemplo 5 o 12,5."
            ) from None
        if not valor.is_finite() or abs(valor) >= 1000:
            raise serializers.ValidationError("Escriba un porcentaje válido, por ejemplo 5 o 12,5.")
        if valor.as_tuple().exponent < -2:
            raise serializers.ValidationError("Use como máximo dos decimales.")
        return valor

    def to_representation(self, value):
        return _decimal(value)


def _decimal(valor) -> str | None:
    return None if valor is None else f"{valor:.2f}"


def _persona(usuario) -> dict | None:
    if usuario is None:
        return None
    return {"id": usuario.pk, "nombre": services.nombre(usuario)}


def _monto(valor) -> str | None:
    return None if valor is None else f"{valor:.2f}"


# --- Causas y niveles -------------------------------------------------------------------------


class NivelEntradaSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False, allow_null=True)
    #: Su posición; sin ella, la de la lista. Se renumeran 1, 2, 3…
    orden = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    nombre = serializers.CharField(max_length=120, allow_blank=True)
    tipo = serializers.ChoiceField(choices=TipoNivel.choices)
    envia_correo = serializers.BooleanField(default=True)
    asunto = serializers.CharField(max_length=255, allow_blank=True, required=False, default="")
    cuerpo = serializers.CharField(
        max_length=services.CUERPO_MAX,
        allow_blank=True,
        required=False,
        default="",
        trim_whitespace=False,
    )
    monto_sugerido = MontoOpcional()
    #: Solo en las sanciones económicas, en lugar del monto (US-033, CA-7).
    porcentaje_sugerido = PorcentajeOpcional()
    copia_jefe = serializers.BooleanField(default=False)
    activo = serializers.BooleanField(default=True)


class CausaEntradaSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=150, allow_blank=True)
    descripcion = serializers.CharField(max_length=2000, allow_blank=True, required=False)
    plazo_reincidencia_meses = serializers.IntegerField(min_value=1, max_value=120, required=False)
    activa = serializers.BooleanField(required=False)
    niveles = NivelEntradaSerializer(many=True, required=False)


def nivel_completo(nivel: NivelLlamado, usados: set, *, con_textos: bool = True) -> dict:
    """`con_textos=False` (quien solo solicita) quita el asunto y el cuerpo."""
    datos = {
        "id": nivel.pk,
        "orden": nivel.orden,
        "nombre": nivel.nombre,
        "tipo": nivel.tipo,
        "tipo_display": TipoNivel(nivel.tipo).label,
        "envia_correo": nivel.envia_correo,
        "asunto": nivel.asunto,
        "cuerpo": nivel.cuerpo,
        "monto_sugerido": _monto(nivel.monto_sugerido),
        "porcentaje_sugerido": _decimal(nivel.porcentaje_sugerido),
        "forma_sugerida": forma_sugerida(nivel),
        "copia_jefe": nivel.copia_jefe,
        "activo": nivel.activo,
        "en_uso": nivel.pk in usados,
    }
    if not con_textos:
        datos.pop("asunto")
        datos.pop("cuerpo")
    return datos


def nivel_resumen(nivel: NivelLlamado) -> dict:
    """Lo que necesita quien emite o solicita (sin los textos del correo)."""
    return {
        "id": nivel.pk,
        "orden": nivel.orden,
        "nombre": nivel.nombre,
        "tipo": nivel.tipo,
        "tipo_display": TipoNivel(nivel.tipo).label,
        "envia_correo": nivel.envia_correo,
        "monto_sugerido": _monto(nivel.monto_sugerido),
        "porcentaje_sugerido": _decimal(nivel.porcentaje_sugerido),
        "forma_sugerida": forma_sugerida(nivel),
        "copia_jefe": nivel.copia_jefe,
    }


def forma_sugerida(nivel: NivelLlamado) -> str | None:
    """Con qué forma parte el formulario de una sanción económica: `porcentaje`
    si el nivel sugiere un porcentaje; si no, `monto`. None fuera de las
    sanciones."""
    if nivel.tipo != TipoNivel.SANCION_ECONOMICA:
        return None
    if nivel.porcentaje_sugerido is not None:
        return FormaSancion.PORCENTAJE.value
    return FormaSancion.MONTO.value


def causa_completa(
    causa: CausaLlamado,
    usados: set,
    num_llamados: int,
    *,
    solo_activos: bool = False,
    con_textos: bool = True,
) -> dict:
    """La causa con sus niveles. `solo_activos`: para el formulario de emitir o
    solicitar, sin los niveles desactivados. `con_textos=False`: sin el asunto
    ni el cuerpo de los correos (para quien solo solicita)."""
    niveles = [n for n in causa.niveles.all() if n.activo or not solo_activos]
    return {
        "id": causa.pk,
        "nombre": causa.nombre,
        "descripcion": causa.descripcion,
        "plazo_reincidencia_meses": causa.meses_reincidencia,
        "activa": causa.activa,
        "en_uso": num_llamados > 0,
        "num_llamados": num_llamados,
        "niveles": [nivel_completo(n, usados, con_textos=con_textos) for n in niveles],
    }


class VistaPreviaSerializer(serializers.Serializer):
    asunto = serializers.CharField(max_length=255, allow_blank=True, required=False, default="")
    cuerpo = serializers.CharField(
        max_length=services.CUERPO_MAX,
        allow_blank=True,
        required=False,
        default="",
        trim_whitespace=False,
    )


# --- Llamados ---------------------------------------------------------------------------------


class NuevoLlamadoSerializer(serializers.Serializer):
    """`POST llamados/`, JSON o multipart (con la evidencia)."""

    modo = serializers.ChoiceField(
        choices=[services.Modo.EMITIR, services.Modo.SOLICITAR], required=False, allow_blank=True
    )
    persona = EnteroOpcional(required=True, allow_null=False)
    causa = EnteroOpcional(required=True, allow_null=False)
    fecha_hecho = serializers.DateField()
    descripcion = serializers.CharField(
        max_length=services.DESCRIPCION_MAX, allow_blank=True, trim_whitespace=False
    )
    nivel = EnteroOpcional()
    justificacion_cambio = serializers.CharField(
        max_length=services.MOTIVO_MAX, allow_blank=True, required=False, default=""
    )
    monto = MontoOpcional()
    #: US-033: `monto` (fijo, USD) o `porcentaje` (del sueldo). Sin ella, la
    #: del valor que llegue o la que sugiere el nivel.
    forma_sancion = serializers.ChoiceField(
        choices=FormaSancion.choices, required=False, allow_blank=True, allow_null=True
    )
    porcentaje = PorcentajeOpcional()
    #: La razón del reglamento: un documento institucional activo y el artículo.
    documento = EnteroOpcional()
    articulo = serializers.CharField(
        max_length=services.ARTICULO_MAX, allow_blank=True, required=False, default=""
    )
    adjunto = serializers.FileField(required=False, allow_null=True, allow_empty_file=False)

    def validate_adjunto(self, archivo):
        if not archivo:
            return None
        validar_archivo(archivo)
        self._tipo = tipo_por_extension(archivo.name)
        return archivo


class ConfirmarSerializer(serializers.Serializer):
    nivel = EnteroOpcional()
    #: El nivel propuesto que mostraba la pantalla (ver `services.confirmar`).
    nivel_esperado = EnteroOpcional()
    justificacion_cambio = serializers.CharField(
        max_length=services.MOTIVO_MAX, allow_blank=True, required=False, default=""
    )
    monto = MontoOpcional()
    forma_sancion = serializers.ChoiceField(
        choices=FormaSancion.choices, required=False, allow_blank=True, allow_null=True
    )
    porcentaje = PorcentajeOpcional()
    descripcion = serializers.CharField(
        max_length=services.DESCRIPCION_MAX, required=False, allow_blank=True
    )
    #: Si llegan (aunque vacíos), reemplazan la razón que registró el jefe; si
    #: no llegan, se conserva.
    documento = EnteroOpcional()
    articulo = serializers.CharField(
        max_length=services.ARTICULO_MAX, allow_blank=True, required=False
    )


class ConfiguracionSerializer(serializers.Serializer):
    """`PUT configuracion/`: el tope en % del sueldo; null o «» = sin tope."""

    tope_porcentaje = PorcentajeOpcional(required=True)


def configuracion(config) -> dict:
    """La configuración del módulo; `config` None = aún sin guardar (sin tope)."""
    if config is None:
        return {"tope_porcentaje": None, "actualizado_por": None, "actualizado_en": None}
    return {
        "tope_porcentaje": _decimal(config.tope_porcentaje),
        "actualizado_por": _persona(config.actualizado_por),
        "actualizado_en": _fecha(config.updated_at) if config.actualizado_por_id else None,
    }


def documento_elegible(documento) -> dict:
    """Un documento de la lista para elegir la razón del reglamento."""
    return {
        "id": documento.pk,
        "titulo": documento.titulo,
        "categoria": documento.categoria,
        "categoria_display": documento.get_categoria_display(),
        "version": documento.version,
        "es_pdf": documento.extension == ".pdf",
    }


class MotivoSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=services.MOTIVO_MAX, allow_blank=True)


def adjunto(llamado: LlamadoAtencion) -> dict | None:
    if not llamado.adjunto:
        return None
    return {
        "nombre": llamado.adjunto_nombre,
        "tipo": llamado.adjunto_tipo,
        "tamano": llamado.adjunto_tamano,
        "visor": visor_de(llamado.adjunto_tipo),
        "url": f"/llamados/llamados/{llamado.pk}/adjunto/",
    }


#: Cómo se ve la evidencia dentro del sistema (visor interno): el PDF en el
#: visor de PDF y las imágenes en línea; Word y Excel se descargan.
VISORES = {
    "application/pdf": "pdf",
    "image/png": "imagen",
    "image/jpeg": "imagen",
    "image/webp": "imagen",
}


def visor_de(tipo: str) -> str | None:
    return VISORES.get(tipo or "")


def _nivel(nivel_id, nombre, tipo) -> dict | None:
    if not nivel_id:
        return None
    return {
        "id": nivel_id,
        "nombre": nombre,
        "tipo": tipo,
        "tipo_display": TipoNivel(tipo).label if tipo else "",
    }


def _fecha(valor):
    return valor.isoformat() if valor else None


#: Dónde se abre un documento institucional en el visor interno (la API de
#: Códigos de conducta: exige el acuerdo de confidencialidad aceptado).
URL_DOCUMENTO = "/organizacion/documentos/{}/archivo/"


def documento_de(llamado: LlamadoAtencion) -> dict | None:
    """El documento de la razón (US-033, CA-6). `disponible`: si todavía se
    puede abrir (sigue existiendo y activo); el título es el que tenía al
    registrarse el llamado."""
    if not llamado.documento_titulo:
        return None
    documento = llamado.documento
    disponible = documento is not None and documento.activo
    return {
        "id": llamado.documento_id,
        "titulo": llamado.documento_titulo,
        "categoria": documento.categoria if documento else None,
        "categoria_display": documento.get_categoria_display() if documento else None,
        "es_pdf": documento.extension == ".pdf" if documento else False,
        "disponible": disponible,
        "url": URL_DOCUMENTO.format(documento.pk) if disponible else None,
    }


def sancion_y_razon(llamado: LlamadoAtencion) -> dict:
    """Los campos de US-033 que llevan la fila, el detalle y «Mi perfil»."""
    forma = llamado.forma_sancion or None
    return {
        "forma_sancion": forma,
        "forma_sancion_display": FormaSancion(forma).label if forma else "",
        "porcentaje": _decimal(llamado.porcentaje),
        # Con porcentaje el monto queda por calcular: el sueldo aún no está en
        # el sistema (llegará con nómina).
        "monto_por_calcular": forma == FormaSancion.PORCENTAJE and llamado.monto is None,
        "sancion_texto": services.texto_sancion(
            llamado.forma_sancion, llamado.monto, llamado.porcentaje
        ),
        "documento": documento_de(llamado),
        "articulo": llamado.articulo,
        "razon": services.texto_razon(llamado.documento_titulo, llamado.articulo),
    }


def llamado_fila(llamado: LlamadoAtencion) -> dict:
    """Una fila de la lista (el detalle añade el historial y el correo)."""
    emitido = llamado.estado in (LlamadoAtencion.Estado.EMITIDO, LlamadoAtencion.Estado.ANULADO)
    propuesto = llamado.nivel_propuesto
    return {
        "id": llamado.pk,
        "numero": llamado.numero,
        "persona": _persona(llamado.persona),
        "causa": {"id": llamado.causa_id, "nombre": llamado.causa_nombre},
        "nivel_aplicado": _nivel(llamado.nivel_id, llamado.nivel_nombre, llamado.nivel_tipo),
        "nivel_propuesto": (
            _nivel(propuesto.pk, propuesto.nombre, propuesto.tipo) if propuesto else None
        ),
        "estado": llamado.estado,
        "estado_display": LlamadoAtencion.Estado(llamado.estado).label,
        "fecha_hecho": llamado.fecha_hecho.isoformat(),
        "descripcion": llamado.descripcion,
        "monto": _monto(llamado.monto),
        **sancion_y_razon(llamado),
        "justificacion_cambio": llamado.justificacion_nivel,
        # El motivo del rechazo o de la anulación, según el estado.
        "motivo": (
            llamado.motivo_rechazo
            if llamado.estado == LlamadoAtencion.Estado.RECHAZADO
            else (
                llamado.motivo_anulacion if llamado.estado == LlamadoAtencion.Estado.ANULADO else ""
            )
        ),
        "solicitado_por": _persona(llamado.solicitado_por),
        "solicitado_en": _fecha(llamado.solicitado_en),
        "emitido_por": _persona(llamado.emitido_por) if emitido else None,
        "emitido_en": _fecha(llamado.emitido_en),
        "adjunto": adjunto(llamado),
        "creado_en": llamado.created_at.isoformat(),
    }


def _accion(accion: AccionLlamado) -> dict:
    return {
        "id": accion.pk,
        "accion": accion.accion,
        "accion_display": AccionLlamado.Accion(accion.accion).label,
        "usuario": _persona(accion.actor),
        "fecha": accion.created_at.isoformat(),
        "comentario": accion.comentario,
        "detalle": accion.detalle,
    }


def llamado_detalle(llamado: LlamadoAtencion, usuario) -> dict:
    datos = llamado_fila(llamado)
    datos.update(
        {
            "rechazado_por": _persona(llamado.rechazado_por),
            "rechazado_en": _fecha(llamado.rechazado_en),
            "anulado_por": _persona(llamado.anulado_por),
            "anulado_en": _fecha(llamado.anulado_en),
            "notificado_en": _fecha(llamado.notificado_en),
            # `enviado` solo si salió; `estado` dice por qué no: `no_aplica`
            # (el nivel no envía o aún no se emite), `sin_direccion`, `fallido`.
            "correo": {
                "enviado": llamado.correo_estado == LlamadoAtencion.EstadoCorreo.ENVIADO,
                "estado": llamado.correo_estado,
                "estado_display": LlamadoAtencion.EstadoCorreo(llamado.correo_estado).label,
                "fecha": _fecha(llamado.correo_enviado_en),
                "asunto": llamado.correo_asunto,
                "cuerpo": llamado.correo_cuerpo,
                "para": llamado.correo_para,
                "copia": llamado.correo_copia,
            },
            "historial": [
                _accion(a)
                for a in llamado.acciones.select_related("actor").order_by("created_at", "id")
            ],
            "puede": services.puede_decidir(usuario, llamado),
            "propuesta_vigente": None,
        }
    )
    if datos["puede"]["confirmar"]:
        vigente = services.propuesta_vigente(llamado)
        if vigente is not None:
            nivel = vigente.nivel
            datos["propuesta_vigente"] = {
                "nivel": _nivel(nivel.pk, nivel.nombre, nivel.tipo),
                "monto_sugerido": _monto(nivel.monto_sugerido),
                "porcentaje_sugerido": _decimal(nivel.porcentaje_sugerido),
                "forma_sugerida": forma_sugerida(nivel),
                "tope_porcentaje": _decimal(services.tope_porcentaje()),
                "es_ultimo_nivel": vigente.es_ultimo,
                "cambio": nivel.pk != llamado.nivel_propuesto_id,
                "niveles": [nivel_resumen(n) for n in vigente.niveles],
                **services.destinatarios_previstos(llamado.persona),
            }
    return datos


def mio(llamado: LlamadoAtencion) -> dict:
    """Lo que la persona ve de un llamado suyo en «Mi perfil»: sin quién lo
    solicitó, sin el correo y sin la evidencia (puede traer datos de otros)."""
    return {
        "id": llamado.pk,
        "numero": llamado.numero,
        "fecha_hecho": llamado.fecha_hecho.isoformat(),
        "causa": llamado.causa_nombre,
        "nivel": llamado.nivel_nombre,
        "nivel_tipo": llamado.nivel_tipo,
        "nivel_tipo_display": TipoNivel(llamado.nivel_tipo).label,
        "descripcion": llamado.descripcion,
        "monto": _monto(llamado.monto),
        **sancion_y_razon(llamado),
        "estado": llamado.estado,
        "anulado": llamado.estado == LlamadoAtencion.Estado.ANULADO,
        "emitido_en": _fecha(llamado.emitido_en),
        "anulado_en": _fecha(llamado.anulado_en),
    }
