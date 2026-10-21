import json

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from apps.adjuntos.validators import validar_archivo
from apps.empresas.campos import RelacionDeEmpresa
from apps.organizacion.models import Departamento, Sede

from . import etiquetas, formulario, services, sla
from .models import (
    AusenciaTecnico,
    CampoFormulario,
    Canal,
    CasoAyuda,
    Categoria,
    HorarioTecnico,
    HorasFueraDeHorario,
    Impacto,
    MovimientoTicket,
    NivelSoporte,
    Prioridad,
    ReglaSLA,
    RespuestaPredefinida,
    Tecnico,
    Ticket,
    Urgencia,
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


class SolicitudSerializer(serializers.Serializer):
    """Lo que pide el formulario de «Soporte TI». Los datos de contacto no van
    aquí: salen de «Mis datos» de quien pide."""

    caso = RelacionDeEmpresa(CasoAyuda, {"activo": True, "categoria__activa": True})
    descripcion = serializers.CharField(max_length=5000)
    impacto = serializers.ChoiceField(Impacto.choices, required=False, allow_blank=True)
    urgencia = serializers.ChoiceField(Urgencia.choices, required=False, allow_blank=True)
    #: Lo respondido en los campos propios de la empresa: un objeto clave → valor
    #: (en un envío con archivos llega como texto JSON).
    adicionales = serializers.JSONField(required=False, default=dict)

    def validate_adicionales(self, valor):
        if isinstance(valor, str):
            try:
                valor = json.loads(valor or "{}")
            except ValueError as error:
                raise serializers.ValidationError("Formato no válido.") from error
        if not isinstance(valor, dict):
            raise serializers.ValidationError("Formato no válido.")
        return valor


class TicketInternoSerializer(SolicitudSerializer):
    """El ticket que registra alguien del equipo en nombre de una persona
    registrada (una llamada, un WhatsApp, una visita). Sus datos salen de «Mis
    datos»; lo que le falte se completa aquí, solo para este ticket."""

    solicitante = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))
    telefono = serializers.CharField(max_length=20, required=False, allow_blank=True)
    sede = RelacionDeEmpresa(Sede, {"activa": True}, required=False, allow_null=True)
    area = RelacionDeEmpresa(Departamento, {"activo": True}, required=False, allow_null=True)
    canal = serializers.ChoiceField(Canal.choices)
    #: Si quien registra se lo queda (lo atiende en la misma llamada).
    asignarme = serializers.BooleanField(required=False, default=False)

    def validate_telefono(self, valor):
        if not valor.strip():
            return ""
        digitos = [c for c in valor if c.isdigit()]
        if not 7 <= len(digitos) <= 15:
            raise serializers.ValidationError("Escriba un teléfono de 7 a 15 dígitos.")
        return valor.strip()


class MensajePublicoSerializer(serializers.Serializer):
    texto = serializers.CharField(max_length=5000)


class EncuestaSerializer(serializers.Serializer):
    calificacion = serializers.IntegerField(min_value=1, max_value=5)
    resuelto = serializers.BooleanField()
    comentario = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class CambioPrioridadSerializer(serializers.Serializer):
    prioridad = serializers.ChoiceField(Prioridad.choices, required=False, allow_blank=True)
    impacto = serializers.ChoiceField(Impacto.choices, required=False, allow_blank=True)
    urgencia = serializers.ChoiceField(Urgencia.choices, required=False, allow_blank=True)
    justificacion = serializers.CharField(max_length=1000)

    def validate(self, datos):
        if not datos.get("prioridad") and not (datos.get("impacto") and datos.get("urgencia")):
            raise serializers.ValidationError(
                "Elija la prioridad, o el impacto y la urgencia para calcularla."
            )
        return datos


def encuesta_dict(ticket):
    encuesta = getattr(ticket, "encuesta", None)
    if encuesta is None:
        return None
    return {
        "calificacion": encuesta.calificacion,
        "resuelto": encuesta.resuelto,
        "comentario": encuesta.comentario,
        "fecha": encuesta.created_at,
    }


def adjunto_dict(adjunto, url):
    return {
        "id": adjunto.id,
        "nombre": adjunto.nombre_original,
        "tamano": adjunto.tamano,
        "url": url,
        "interno": adjunto.interno,
    }


def aprobaciones_dict(ticket) -> list:
    return [
        {
            "id": a.id,
            "rol": a.rol,
            "estado": a.estado,
            "estado_display": a.get_estado_display(),
            "aprobador": _nombre(a.aprobador) if a.aprobador_id else "",
            "decidido_por": _nombre(a.decidido_por) if a.decidido_por_id else "",
            "decidido_en": a.decidido_en,
            "nota": a.nota,
        }
        for a in ticket.aprobaciones.all()
    ]


def seguimiento(ticket, url_adjunto) -> dict:
    """Lo que ve quien pidió: nada interno ni de otros tickets."""
    nombres = etiquetas.de_la_empresa(ticket.empresa_id)
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
        "estado_display": nombres["estados"][ticket.estado],
        "posicion": services.posicion_en_cola(ticket),
        "fuera_de_horario": ticket.fuera_de_horario,
        "categoria": ticket.categoria.nombre,
        "caso": ticket.caso.nombre,
        "prioridad_display": nombres["prioridades"][ticket.prioridad],
        "criticidad": ticket.criticidad,
        "criticidad_display": ticket.get_criticidad_display(),
        "tipo_display": ticket.get_tipo_display(),
        "aprobaciones": [
            {"rol": a["rol"], "estado": a["estado"], "estado_display": a["estado_display"]}
            for a in aprobaciones_dict(ticket)
        ],
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
        "encuesta": encuesta_dict(ticket),
        "puede_encuestar": ticket.estado in (Ticket.Estado.ATENDIDO, Ticket.Estado.CERRADO)
        and encuesta_dict(ticket) is None,
    }


# --- Equipo ----------------------------------------------------------------------------


class TicketListaSerializer(serializers.ModelSerializer):
    numero = serializers.CharField(read_only=True)
    estado_display = serializers.SerializerMethodField()
    prioridad_display = serializers.SerializerMethodField()
    categoria = serializers.CharField(source="categoria.nombre", read_only=True)
    caso = serializers.CharField(source="caso.nombre", read_only=True)
    codigo = serializers.CharField(source="caso.codigo", read_only=True, default="")
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    canal_display = serializers.CharField(source="get_canal_display", read_only=True)
    agencia = serializers.CharField(source="sede.nombre", read_only=True, default="")
    area = serializers.CharField(source="area.nombre", read_only=True, default="")
    nivel = serializers.CharField(source="nivel.__str__", read_only=True)
    tecnico = serializers.SerializerMethodField()
    posicion = serializers.SerializerMethodField()
    sla = serializers.SerializerMethodField()
    #: Solo el nivel: el puntaje no sale de la base (ver `criticidad.py`).
    criticidad_display = serializers.CharField(source="get_criticidad_display", read_only=True)

    class Meta:
        model = Ticket
        fields = [
            "id",
            "numero",
            "estado",
            "estado_display",
            "criticidad",
            "criticidad_display",
            "prioridad",
            "prioridad_display",
            "prioridad_base",
            "tipo",
            "tipo_display",
            "canal",
            "canal_display",
            "categoria",
            "caso",
            "codigo",
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

    def _nombres(self, ticket):
        """Los nombres propios de la empresa, una vez por listado."""
        cache = self.context.setdefault("_nombres_soporte", {})
        if ticket.empresa_id not in cache:
            cache[ticket.empresa_id] = etiquetas.de_la_empresa(ticket.empresa_id)
        return cache[ticket.empresa_id]

    def get_estado_display(self, ticket):
        return self._nombres(ticket)["estados"].get(ticket.estado, ticket.estado)

    def get_prioridad_display(self, ticket):
        return self._nombres(ticket)["prioridades"].get(ticket.prioridad, ticket.prioridad)

    def get_tecnico(self, ticket):
        return (
            {"id": ticket.tecnico_id, "nombre": str(ticket.tecnico)} if ticket.tecnico_id else None
        )

    def get_posicion(self, ticket):
        return services.posicion_en_cola(ticket)

    def get_sla(self, ticket):
        """Los dos relojes. Solución: en plazo, por vencer, vencido, en pausa,
        cumplido, incumplido o sin correr. Respuesta: ver `sla.estado_de_la_respuesta`."""
        ahora = timezone.now()
        if ticket.estado in (Ticket.Estado.ATENDIDO, Ticket.Estado.CERRADO):
            estado = "incumplido" if ticket.sla_cumplido is False else "cumplido"
        elif ticket.estado == Ticket.Estado.ESPERANDO_USUARIO:
            estado = "pausado"
        elif not ticket.sla_vence:
            estado = "sin_correr"
        elif ahora >= ticket.sla_vence:
            estado = "vencido"
        elif ticket.sla_alerta_en and ahora >= ticket.sla_alerta_en:
            estado = "por_vencer"
        else:
            estado = "en_plazo"
        return {
            "estado": estado,
            "vence": ticket.sla_vence if ticket.estado in sla.CORRE else None,
            "minutos": ticket.sla_minutos,
            "restante_en_pausa": (
                ticket.sla_restante_al_pausar if ticket.estado not in sla.CORRE else None
            ),
            "respuesta": {
                "estado": sla.estado_de_la_respuesta(ticket, ahora),
                "vence": ticket.sla_respuesta_vence,
                "minutos": ticket.sla_respuesta_minutos,
                "respondido_en": ticket.respondido_en,
            },
        }


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
    impacto_display = serializers.CharField(source="get_impacto_display", read_only=True)
    urgencia_display = serializers.CharField(source="get_urgencia_display", read_only=True)
    registrado_por = serializers.SerializerMethodField()
    encuesta = serializers.SerializerMethodField()
    aprobaciones = serializers.SerializerMethodField()

    class Meta(TicketListaSerializer.Meta):
        fields = TicketListaSerializer.Meta.fields + [
            "descripcion",
            "solicitante_telefono",
            "solicitante_correo",
            "impacto",
            "impacto_display",
            "urgencia",
            "urgencia_display",
            "registrado_por",
            "respondido_en",
            "reaperturas",
            "escalamientos",
            "encuesta",
            "aprobaciones",
            "datos_adicionales",
            "mensajes",
            "adjuntos",
            "movimientos",
            "permisos",
        ]

    def get_registrado_por(self, ticket):
        return _nombre(ticket.registrado_por) if ticket.registrado_por_id else ""

    def get_encuesta(self, ticket):
        return encuesta_dict(ticket)

    def get_aprobaciones(self, ticket):
        return aprobaciones_dict(ticket)

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
            "prioridad": trabaja
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
    nivel_inicial = RelacionDeEmpresa(NivelSoporte, required=False, allow_null=True)
    aprueban = RelacionDeEmpresa(Departamento, many=True, required=False)
    prioridad_display = serializers.CharField(source="get_prioridad_display", read_only=True)
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)

    class Meta:
        model = CasoAyuda
        fields = [
            "id",
            "categoria",
            "codigo",
            "nombre",
            "tipo",
            "tipo_display",
            "prioridad",
            "prioridad_display",
            "nivel_inicial",
            "minutos_plazo",
            "aprueba_jefe_area",
            "aprueban",
            "activo",
            "peso",
        ]
        read_only_fields = ["peso"]

    def create(self, datos):
        aprueban = datos.pop("aprueban", [])
        caso = CasoAyuda.objects.create(**datos)
        caso.aprueban.set(aprueban)
        return caso

    def update(self, caso, datos):
        aprueban = datos.pop("aprueban", None)
        caso = super().update(caso, datos)
        if aprueban is not None:
            caso.aprueban.set(aprueban)
        return caso


class CategoriaSerializer(serializers.ModelSerializer):
    casos = CasoSerializer(many=True, read_only=True)
    tecnicos = serializers.SerializerMethodField()

    class Meta:
        model = Categoria
        fields = ["id", "nombre", "descripcion", "activa", "peso", "casos", "tecnicos"]
        read_only_fields = ["peso"]

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
            "minutos_respuesta",
        ]


class MesaSerializer(serializers.Serializer):
    """Configuración → Mesa de ayuda → Horario y metas."""

    meta_sla = serializers.IntegerField(min_value=1, max_value=100)
    meta_sla_critica = serializers.IntegerField(min_value=1, max_value=100)
    critica_24x7 = serializers.BooleanField()
    etiquetas = serializers.JSONField(required=False)
    horarios = HorarioSerializer(many=True)
    feriados = AusenciaSerializer(many=True)

    def validate_etiquetas(self, valor):
        return etiquetas.limpiar(valor)


class DecisionSerializer(serializers.Serializer):
    aprobar = serializers.BooleanField()
    nota = serializers.CharField(max_length=500, required=False, allow_blank=True)


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
            # Lo que el sistema decide no se toca, venga lo que venga; de
            # impacto y urgencia se puede cambiar el texto de cada opción.
            fijas = formulario.OPCIONES_DEL_SISTEMA.get(campo.clave)
            if fijas and "opciones" in datos:
                if len(datos["opciones"]) != len(fijas):
                    raise serializers.ValidationError(
                        {"opciones": f"Escriba las {len(fijas)} opciones, una distinta por línea."}
                    )
            else:
                datos.pop("opciones", None)
            for fijo in ("tipo", "categorias"):
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

    def to_representation(self, campo):
        datos = super().to_representation(campo)
        if campo.base and campo.clave in formulario.OPCIONES_DEL_SISTEMA:
            datos["opciones"] = [texto for _, texto in formulario.opciones_de(campo.clave, campo)]
            datos["valores"] = [valor for valor, _ in formulario.opciones_de(campo.clave, campo)]
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
