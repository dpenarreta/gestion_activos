import json

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from apps.adjuntos.validators import validar_archivo
from apps.empresas.campos import RelacionDeEmpresa
from apps.organizacion.models import Departamento, Sede

from . import formulario, services
from .models import (
    AusenciaTecnico,
    CampoFormulario,
    CasoAyuda,
    Categoria,
    HorarioTecnico,
    HorasFueraDeHorario,
    MovimientoTicket,
    NivelSoporte,
    ReglaSLA,
    RespuestaPredefinida,
    Tecnico,
    Ticket,
)

User = get_user_model()

#: Adjuntos por envío: los suficientes para un par de capturas y un PDF.
MAX_ADJUNTOS = 3


def _nombre(usuario):
    return (usuario.get_full_name() or usuario.username) if usuario else ""


def validar_adjuntos(archivos):
    if len(archivos) > MAX_ADJUNTOS:
        raise serializers.ValidationError(f"Como máximo {MAX_ADJUNTOS} archivos por envío.")
    for archivo in archivos:
        validar_archivo(archivo)
    return archivos


# --- Formulario público ----------------------------------------------------------------


class FormularioPublicoSerializer(serializers.Serializer):
    """Lo que pide el formulario externo. Los querysets se fijan al construirlo
    (dentro de la empresa del formulario), no al importar."""

    nombre = serializers.CharField(max_length=150)
    # Teléfono, agencia y área pueden no estar en el formulario de la empresa:
    # si son obligatorios lo decide `formulario.validar_envio`.
    telefono = serializers.CharField(max_length=20, required=False, allow_blank=True)
    correo = serializers.EmailField()
    sede = RelacionDeEmpresa(Sede, {"activa": True}, required=False, allow_null=True)
    area = RelacionDeEmpresa(Departamento, {"activo": True}, required=False, allow_null=True)
    caso = RelacionDeEmpresa(CasoAyuda, {"activo": True, "categoria__activa": True})
    descripcion = serializers.CharField(max_length=5000)
    acepta_datos = serializers.BooleanField()
    #: Lo respondido en los campos propios de la empresa: un objeto clave → valor
    #: (en un envío con archivos llega como texto JSON).
    adicionales = serializers.JSONField(required=False, default=dict)
    #: Campo trampa: invisible para una persona; un bot lo llena.
    sitio_web = serializers.CharField(required=False, allow_blank=True)

    def validate_adicionales(self, valor):
        if isinstance(valor, str):
            try:
                valor = json.loads(valor or "{}")
            except ValueError as error:
                raise serializers.ValidationError("Formato no válido.") from error
        if not isinstance(valor, dict):
            raise serializers.ValidationError("Formato no válido.")
        return valor

    def validate_telefono(self, valor):
        if not valor.strip():
            return ""
        digitos = [c for c in valor if c.isdigit()]
        if not 7 <= len(digitos) <= 15:
            raise serializers.ValidationError("Escriba un teléfono de 7 a 15 dígitos.")
        return valor.strip()

    def validate_acepta_datos(self, valor):
        if not valor:
            raise serializers.ValidationError(
                "Para crear el ticket debe aceptar el tratamiento de sus datos."
            )
        return valor


class MensajePublicoSerializer(serializers.Serializer):
    texto = serializers.CharField(max_length=5000)


def adjunto_dict(adjunto, url):
    return {
        "id": adjunto.id,
        "nombre": adjunto.nombre_original,
        "tamano": adjunto.tamano,
        "url": url,
        "interno": adjunto.interno,
    }


def seguimiento(ticket, url_adjunto) -> dict:
    """Lo que ve quien pidió: nada interno ni de otros tickets."""
    mensajes = [
        {
            "id": m.id,
            "texto": m.texto,
            "del_solicitante": m.del_solicitante,
            "autor": "Usted" if m.del_solicitante else (_nombre(m.autor) or "Soporte"),
            "fecha": m.created_at,
            "adjuntos": [
                adjunto_dict(a, url_adjunto(a)) for a in m.adjuntos.all() if not a.interno
            ],
        }
        for m in ticket.mensajes.all()
        if not m.interno
    ]
    return {
        "numero": ticket.numero,
        "empresa": ticket.empresa.nombre if ticket.empresa_id else "",
        "estado": ticket.estado,
        "estado_display": ticket.get_estado_display(),
        "posicion": services.posicion_en_cola(ticket),
        "fuera_de_horario": ticket.fuera_de_horario,
        "categoria": ticket.categoria.nombre,
        "caso": ticket.caso.nombre,
        "prioridad_display": ticket.get_prioridad_display(),
        "descripcion": ticket.descripcion,
        "agencia": ticket.sede.nombre if ticket.sede_id else "",
        "area": ticket.area.nombre if ticket.area_id else "",
        "datos_adicionales": ticket.datos_adicionales or [],
        "atiende": str(ticket.tecnico) if ticket.tecnico_id else "",
        "creado": ticket.created_at,
        "atendido_en": ticket.atendido_en,
        "adjuntos": [
            adjunto_dict(a, url_adjunto(a))
            for a in ticket.adjuntos.all()
            if a.mensaje_id is None and not a.interno
        ],
        "mensajes": mensajes,
        "puede_responder": ticket.estado != Ticket.Estado.CERRADO,
        "puede_confirmar": ticket.estado == Ticket.Estado.ATENDIDO,
    }


# --- Equipo ----------------------------------------------------------------------------


class TicketListaSerializer(serializers.ModelSerializer):
    numero = serializers.CharField(read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    prioridad_display = serializers.CharField(source="get_prioridad_display", read_only=True)
    categoria = serializers.CharField(source="categoria.nombre", read_only=True)
    caso = serializers.CharField(source="caso.nombre", read_only=True)
    agencia = serializers.CharField(source="sede.nombre", read_only=True, default="")
    area = serializers.CharField(source="area.nombre", read_only=True, default="")
    nivel = serializers.CharField(source="nivel.__str__", read_only=True)
    tecnico = serializers.SerializerMethodField()
    posicion = serializers.SerializerMethodField()
    sla = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id",
            "numero",
            "estado",
            "estado_display",
            "prioridad",
            "prioridad_display",
            "categoria",
            "caso",
            "agencia",
            "area",
            "nivel",
            "tecnico",
            "solicitante_nombre",
            "posicion",
            "fuera_de_horario",
            "escalado_por_sla",
            "en_cola_desde",
            "tomado_en",
            "atendido_en",
            "sla",
            "created_at",
        ]

    def get_tecnico(self, ticket):
        return (
            {"id": ticket.tecnico_id, "nombre": str(ticket.tecnico)} if ticket.tecnico_id else None
        )

    def get_posicion(self, ticket):
        return services.posicion_en_cola(ticket)

    def get_sla(self, ticket):
        """En plazo, por vencer, vencido, en pausa o sin correr."""
        ahora = timezone.now()
        if ticket.estado == Ticket.Estado.ESPERANDO_USUARIO:
            estado = "pausado"
        elif ticket.estado in (Ticket.Estado.ATENDIDO, Ticket.Estado.CERRADO):
            cumplido = bool(
                ticket.sla_vence and ticket.atendido_en and ticket.atendido_en <= ticket.sla_vence
            )
            estado = "cumplido" if cumplido or not ticket.sla_vence else "incumplido"
        elif not ticket.sla_vence:
            estado = "sin_correr"
        elif ahora >= ticket.sla_vence:
            estado = "vencido"
        elif ticket.sla_alerta_en and ahora >= ticket.sla_alerta_en:
            estado = "por_vencer"
        else:
            estado = "en_plazo"
        return {"estado": estado, "vence": ticket.sla_vence, "minutos": ticket.sla_minutos}


class MovimientoSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = MovimientoTicket
        fields = [
            "id",
            "descripcion",
            "nota",
            "actor",
            "estado_anterior",
            "estado_nuevo",
            "created_at",
        ]

    def get_actor(self, movimiento):
        return _nombre(movimiento.actor) or "Sistema"


class TicketDetalleSerializer(TicketListaSerializer):
    mensajes = serializers.SerializerMethodField()
    adjuntos = serializers.SerializerMethodField()
    movimientos = MovimientoSerializer(many=True, read_only=True)
    permisos = serializers.SerializerMethodField()

    class Meta(TicketListaSerializer.Meta):
        fields = TicketListaSerializer.Meta.fields + [
            "descripcion",
            "solicitante_telefono",
            "solicitante_correo",
            "datos_adicionales",
            "mensajes",
            "adjuntos",
            "movimientos",
            "permisos",
        ]

    def _url(self, adjunto):
        return f"/soporte/tickets/{adjunto.ticket_id}/adjuntos/{adjunto.id}/"

    def get_adjuntos(self, ticket):
        return [
            adjunto_dict(a, self._url(a)) for a in ticket.adjuntos.all() if a.mensaje_id is None
        ]

    def get_mensajes(self, ticket):
        return [
            {
                "id": m.id,
                "texto": m.texto,
                "interno": m.interno,
                "del_solicitante": m.del_solicitante,
                "autor": (
                    ticket.solicitante_nombre
                    if m.del_solicitante
                    else (_nombre(m.autor) or "Sistema")
                ),
                "fecha": m.created_at,
                "adjuntos": [adjunto_dict(a, self._url(a)) for a in m.adjuntos.all()],
            }
            for m in ticket.mensajes.all()
        ]

    def get_permisos(self, ticket):
        usuario = self.context["request"].user
        trabaja = services.puede_trabajarlo(usuario, ticket)
        return {
            "acciones": services.acciones_disponibles(usuario, ticket),
            "responder": trabaja or services.tiene(usuario, "ver_todos"),
            "escalar": trabaja
            and ticket.estado in Ticket.ABIERTOS_DEL_TECNICO + (Ticket.Estado.ESPERANDO_USUARIO,),
            "asignar": services.tiene(usuario, "asignar")
            and ticket.estado not in (Ticket.Estado.ATENDIDO, Ticket.Estado.CERRADO),
        }


class RespuestaSerializer(serializers.Serializer):
    texto = serializers.CharField(max_length=10000)
    interno = serializers.BooleanField(required=False, default=False)


class CambioEstadoSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(choices=Ticket.Estado.choices)
    nota = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class EscalarSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=2000)


class AsignarSerializer(serializers.Serializer):
    tecnico = RelacionDeEmpresa(Tecnico, {"activo": True})
    nota = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class HorasSerializer(serializers.ModelSerializer):
    tecnico_nombre = serializers.CharField(source="tecnico.__str__", read_only=True)
    ticket_numero = serializers.CharField(source="ticket.numero", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    revisado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = HorasFueraDeHorario
        fields = [
            "id",
            "ticket",
            "ticket_numero",
            "tecnico",
            "tecnico_nombre",
            "fecha",
            "horas",
            "descripcion",
            "estado",
            "estado_display",
            "revisado_por_nombre",
            "revisado_en",
            "nota_revision",
            "created_at",
        ]
        read_only_fields = ["ticket", "tecnico", "estado", "revisado_en", "nota_revision"]

    def get_revisado_por_nombre(self, registro):
        return _nombre(registro.revisado_por)


# --- Configuración ---------------------------------------------------------------------


class NivelSerializer(serializers.ModelSerializer):
    supervisores = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=User.objects.filter(is_active=True)
    )
    supervisores_detalle = serializers.SerializerMethodField()

    class Meta:
        model = NivelSoporte
        fields = ["id", "nombre", "orden", "supervisores", "supervisores_detalle"]

    def get_supervisores_detalle(self, nivel):
        return [{"id": u.id, "nombre": _nombre(u)} for u in nivel.supervisores.all()]


class CasoSerializer(serializers.ModelSerializer):
    categoria = RelacionDeEmpresa(Categoria)
    prioridad_display = serializers.CharField(source="get_prioridad_display", read_only=True)

    class Meta:
        model = CasoAyuda
        fields = ["id", "categoria", "nombre", "prioridad", "prioridad_display", "activo"]


class CategoriaSerializer(serializers.ModelSerializer):
    casos = CasoSerializer(many=True, read_only=True)
    tecnicos = serializers.SerializerMethodField()

    class Meta:
        model = Categoria
        fields = ["id", "nombre", "descripcion", "activa", "casos", "tecnicos"]

    def get_tecnicos(self, categoria):
        return [{"id": t.id, "nombre": str(t)} for t in categoria.tecnicos.all()]


class HorarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = HorarioTecnico
        fields = ["dia_semana", "hora_inicio", "hora_fin"]

    def validate(self, datos):
        if datos["hora_fin"] <= datos["hora_inicio"]:
            raise serializers.ValidationError("La hora de fin debe ser posterior a la de inicio.")
        return datos


class AusenciaSerializer(serializers.ModelSerializer):
    class Meta:
        model = AusenciaTecnico
        fields = ["desde", "hasta", "motivo"]

    def validate(self, datos):
        if datos["hasta"] < datos["desde"]:
            raise serializers.ValidationError("La fecha final no puede ser anterior a la inicial.")
        return datos


class TecnicoSerializer(serializers.ModelSerializer):
    usuario = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))
    nombre = serializers.CharField(source="__str__", read_only=True)
    correo = serializers.CharField(source="usuario.email", read_only=True)
    nivel = RelacionDeEmpresa(NivelSoporte)
    categorias = RelacionDeEmpresa(Categoria, many=True, required=False)
    horarios = HorarioSerializer(many=True, required=False)
    ausencias = AusenciaSerializer(many=True, required=False)
    en_horario = serializers.SerializerMethodField()
    abiertos = serializers.SerializerMethodField()

    class Meta:
        model = Tecnico
        fields = [
            "id",
            "usuario",
            "nombre",
            "correo",
            "nivel",
            "categorias",
            "capacidad",
            "activo",
            "horarios",
            "ausencias",
            "en_horario",
            "abiertos",
        ]

    def get_en_horario(self, tecnico):
        from .horario import Agenda

        return Agenda(tecnico).en_horario()

    def get_abiertos(self, tecnico):
        return services._abiertos(tecnico)

    def validate_usuario(self, usuario):
        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        empresa = empresa_actual()
        if (
            empresa is not None
            and empresa is not SIN_EMPRESA
            and not usuario.is_superuser
            and not usuario.membresias.filter(empresa=empresa).exists()
        ):
            raise serializers.ValidationError("Esa persona no trabaja en esta empresa.")
        return usuario

    def _guardar_agenda(self, tecnico, horarios, ausencias):
        if horarios is not None:
            tecnico.horarios.all().delete()
            HorarioTecnico.objects.bulk_create(
                HorarioTecnico(tecnico=tecnico, **h) for h in horarios
            )
        if ausencias is not None:
            tecnico.ausencias.all().delete()
            AusenciaTecnico.objects.bulk_create(
                AusenciaTecnico(tecnico=tecnico, **a) for a in ausencias
            )

    def create(self, datos):
        horarios = datos.pop("horarios", None)
        ausencias = datos.pop("ausencias", None)
        categorias = datos.pop("categorias", [])
        tecnico = Tecnico.objects.create(**datos)
        tecnico.categorias.set(categorias)
        self._guardar_agenda(tecnico, horarios, ausencias)
        return tecnico

    def update(self, tecnico, datos):
        horarios = datos.pop("horarios", None)
        ausencias = datos.pop("ausencias", None)
        categorias = datos.pop("categorias", None)
        for campo, valor in datos.items():
            setattr(tecnico, campo, valor)
        tecnico.save()
        if categorias is not None:
            tecnico.categorias.set(categorias)
        self._guardar_agenda(tecnico, horarios, ausencias)
        return tecnico


class AgendaPropiaSerializer(serializers.Serializer):
    """«Mi horario»: el técnico edita solo sus franjas y ausencias."""

    horarios = HorarioSerializer(many=True)
    ausencias = AusenciaSerializer(many=True)


class ReglaSLASerializer(serializers.ModelSerializer):
    categoria = RelacionDeEmpresa(Categoria, required=False, allow_null=True)
    area = RelacionDeEmpresa(Departamento, required=False, allow_null=True)
    categoria_nombre = serializers.CharField(source="categoria.nombre", read_only=True, default="")
    area_nombre = serializers.CharField(source="area.nombre", read_only=True, default="")
    prioridad_display = serializers.CharField(source="get_prioridad_display", read_only=True)

    class Meta:
        model = ReglaSLA
        fields = [
            "id",
            "categoria",
            "categoria_nombre",
            "area",
            "area_nombre",
            "prioridad",
            "prioridad_display",
            "minutos",
        ]


class RespuestaPredefinidaSerializer(serializers.ModelSerializer):
    class Meta:
        model = RespuestaPredefinida
        fields = ["id", "atajo", "titulo", "texto"]


class CampoFormularioSerializer(serializers.ModelSerializer):
    """Un campo del formulario, como lo edita la configuración.

    De los campos del sistema solo cambian el texto y el orden (y mostrarlo u
    obligarlo, si es de los que se pueden ocultar): su tipo y sus opciones los
    da el sistema.
    """

    categorias = RelacionDeEmpresa(Categoria, many=True, required=False)
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    bloqueado = serializers.BooleanField(read_only=True)

    class Meta:
        model = CampoFormulario
        fields = [
            "id",
            "clave",
            "etiqueta",
            "ayuda",
            "tipo",
            "tipo_display",
            "opciones",
            "obligatorio",
            "activo",
            "orden",
            "base",
            "bloqueado",
            "categorias",
        ]
        read_only_fields = ["clave", "orden", "base"]

    def validate_opciones(self, valor):
        if not isinstance(valor, list):
            raise serializers.ValidationError("Envíe la lista de opciones.")
        limpias = []
        for opcion in valor:
            texto = str(opcion).strip()
            if not texto:
                continue
            if len(texto) > 100:
                raise serializers.ValidationError("Cada opción admite hasta 100 caracteres.")
            if texto not in limpias:
                limpias.append(texto)
        if len(limpias) > formulario.MAXIMO_OPCIONES:
            raise serializers.ValidationError(f"Como máximo {formulario.MAXIMO_OPCIONES} opciones.")
        return limpias

    def validate(self, datos):
        campo = self.instance
        if campo is not None and campo.base:
            # Lo que el sistema decide no se toca, venga lo que venga.
            for fijo in ("tipo", "opciones", "categorias"):
                datos.pop(fijo, None)
            if campo.bloqueado:
                datos["activo"] = True
                datos["obligatorio"] = True
            return datos
        tipo = datos.get("tipo", campo.tipo if campo else CampoFormulario.Tipo.TEXTO)
        opciones = datos.get("opciones", campo.opciones if campo else [])
        if tipo == CampoFormulario.Tipo.LISTA and not opciones:
            raise serializers.ValidationError(
                {"opciones": "Una lista necesita al menos una opción."}
            )
        if tipo != CampoFormulario.Tipo.LISTA:
            datos["opciones"] = []
        if campo is None:
            propios = CampoFormulario.objects.filter(base=False).count()
            if propios >= formulario.MAXIMO_PROPIOS:
                raise serializers.ValidationError(
                    f"El formulario admite hasta {formulario.MAXIMO_PROPIOS} campos propios."
                )
        return datos

    def create(self, datos):
        categorias = datos.pop("categorias", [])
        datos["clave"] = _clave_libre(datos["etiqueta"])
        datos["orden"] = formulario.siguiente_orden()
        campo = CampoFormulario.objects.create(**datos)
        campo.categorias.set(categorias)
        return campo

    def update(self, campo, datos):
        categorias = datos.pop("categorias", None)
        campo = super().update(campo, datos)
        if categorias is not None:
            campo.categorias.set(categorias)
        return campo


def _clave_libre(etiqueta: str) -> str:
    """Una clave única para un campo propio, a partir de su etiqueta."""
    base = (slugify(etiqueta).replace("-", "_") or "campo")[:32]
    if base in CampoFormulario.BASE:
        base = f"{base}_2"
    clave, numero = base, 2
    while CampoFormulario.objects.filter(clave=clave).exists():
        numero += 1
        clave = f"{base}_{numero}"
    return clave
