"""La API de la Mesa de ayuda.

- **Quien pide soporte**: toda persona con sesión, sin permisos («Soporte TI»):
  crear un ticket con sus datos de «Mi perfil» y seguir los suyos. Desde el
  20/10/2026 no hay formulario público ni enlace de seguimiento sin sesión.
- **Del equipo**: bandeja, ficha y acciones sobre los tickets.
- **Configuración**: niveles, categorías y casos, técnicos con su horario, SLA,
  respuestas predefinidas y los campos del formulario.
"""

from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as ErrorDeModelo
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.organizacion import contacto
from apps.organizacion.models import Departamento, Sede
from apps.permissions.permissions import HasActionPermission, HasModulePermission

from . import criticidad, etiquetas, formulario, services, sla
from .models import (
    AdjuntoTicket,
    AprobacionTicket,
    CampoFormulario,
    Canal,
    CasoAyuda,
    Categoria,
    ConfiguracionMesa,
    FeriadoMesa,
    HorarioMesa,
    HorasFueraDeHorario,
    NivelSoporte,
    ReglaSLA,
    RespuestaPredefinida,
    Tecnico,
    Ticket,
    PesoArea,
)
from .serializers import (
    AgendaPropiaSerializer,
    AsignarSerializer,
    CambioEstadoSerializer,
    CambioPrioridadSerializer,
    CampoFormularioSerializer,
    CasoSerializer,
    CategoriaSerializer,
    DecisionSerializer,
    EncuestaSerializer,
    EscalarSerializer,
    HorasSerializer,
    MensajePublicoSerializer,
    MesaSerializer,
    NivelSerializer,
    ReglaSLASerializer,
    RespuestaPredefinidaSerializer,
    RespuestaSerializer,
    SolicitudSerializer,
    TecnicoSerializer,
    TicketDetalleSerializer,
    TicketInternoSerializer,
    TicketListaSerializer,
    seguimiento,
    validar_adjuntos,
)

MODULO = "soporte"


def _errores(error):
    return error.message_dict if hasattr(error, "message_dict") else error.messages


def _descargar(adjunto):
    respuesta = FileResponse(
        adjunto.archivo.open("rb"), as_attachment=True, filename=adjunto.nombre_original
    )
    respuesta["X-Content-Type-Options"] = "nosniff"
    return respuesta


# --- Quien pide soporte (con sesión) ---------------------------------------------------


def datos_del_formulario(empresa_nombre) -> dict:
    """Lo que necesita el formulario (el público y el de alta interna) de la
    empresa activa: sus campos, agencias, áreas, categorías con sus casos y las
    opciones de la matriz de prioridad."""
    categorias = Categoria.objects.filter(activa=True).prefetch_related("casos").order_by("nombre")
    nombres = etiquetas.de_la_empresa()
    return {
        "empresa": empresa_nombre,
        "disponible": NivelSoporte.objects.exists(),
        "campos": formulario.visibles(),
        "agencias": [
            {"id": s.id, "nombre": s.nombre, "ciudad": s.ciudad}
            for s in Sede.objects.filter(activa=True).order_by("nombre")
        ],
        "areas": [
            {"id": d.id, "nombre": d.nombre}
            for d in Departamento.objects.filter(activo=True).order_by("nombre")
        ],
        "categorias": [
            {
                "id": c.id,
                "nombre": c.nombre,
                "descripcion": c.descripcion,
                "casos": [
                    {
                        "id": caso.id,
                        "codigo": caso.codigo,
                        "nombre": caso.nombre,
                        "tipo": caso.tipo,
                        "tipo_display": caso.get_tipo_display(),
                        "prioridad": caso.prioridad,
                        "prioridad_display": nombres["prioridades"][caso.prioridad],
                    }
                    for caso in c.casos.all()
                    if caso.activo
                ],
            }
            for c in categorias
        ],
        "impactos": [{"id": v, "nombre": n} for v, n in formulario.opciones_de("impacto")],
        "urgencias": [{"id": v, "nombre": n} for v, n in formulario.opciones_de("urgencia")],
    }


def _datos_del_ticket(datos, adicionales) -> dict:
    """Lo validado del formulario, con los nombres de las columnas del ticket."""
    return {
        "solicitante_nombre": datos["nombre"].strip(),
        "solicitante_telefono": datos.get("telefono") or "",
        "solicitante_correo": datos["correo"],
        "sede": datos.get("sede"),
        "area": datos.get("area"),
        "caso": datos["caso"],
        "descripcion": datos["descripcion"].strip(),
        "impacto": datos.get("impacto") or "",
        "urgencia": datos.get("urgencia") or "",
        "datos_adicionales": adicionales,
    }


class FaltanDatos(APIException):
    """A quien pide le falta algo en «Mi perfil»: la pantalla le pide
    completarlo antes de crear el ticket."""

    status_code = 400
    default_code = "faltan_datos"


def datos_de_la_persona(usuario, extra=None):
    """Nombre, correo, teléfono, área y agencia de quien pide, desde «Mis
    datos» (decidido el 20/10/2026). En el alta interna, `extra` completa lo
    que falte solo para ese ticket. Devuelve los datos y lo que sigue faltando."""
    perfil = contacto.de(usuario)
    extra = extra or {}
    area = extra.get("area") or (
        Departamento.objects.filter(pk=perfil["area"]["id"]).first() if perfil["area"] else None
    )
    sede = extra.get("sede") or (
        Sede.objects.filter(pk=perfil["agencia"]["id"]).first() if perfil["agencia"] else None
    )
    persona = {
        "nombre": perfil["nombre"],
        "correo": usuario.email,
        "telefono": extra.get("telefono") or perfil["telefono"],
        "area": area,
        "sede": sede,
    }
    faltan = [
        contacto.ETIQUETAS[clave]
        for clave, valor in (
            ("nombre", persona["nombre"]),
            ("telefono", persona["telefono"]),
            ("area", area),
            ("agencia", sede),
        )
        if not valor
    ]
    return persona, faltan


def _mis_tickets(usuario):
    """Los tickets que pidió la persona (los de antes de tener sesión, por su
    correo)."""
    return Ticket.objects.filter(
        Q(solicitante=usuario)
        | Q(solicitante__isnull=True, solicitante_correo__iexact=usuario.email)
    )


def _mi_ticket(request, pk):
    ticket = (
        _mis_tickets(request.user)
        .select_related("empresa", "sede", "area", "categoria", "caso", "tecnico__usuario")
        .prefetch_related("mensajes__autor", "mensajes__adjuntos", "adjuntos", "aprobaciones")
        .filter(pk=pk)
        .first()
    )
    if ticket is None:
        raise Http404("No encontramos ese ticket entre los suyos.")
    return ticket


def _url_mia(ticket):
    return lambda adjunto: f"/soporte/mis-tickets/{ticket.id}/adjuntos/{adjunto.id}/"


class SolicitarView(APIView):
    """«Soporte TI → Nuevo ticket». Toda persona con sesión, sin permisos: sus
    datos de contacto salen de «Mi perfil»; si falta algo, se le pide antes."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "soporte_formulario"
            return [ScopedRateThrottle()]
        return []

    def get(self, request):
        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        empresa = empresa_actual()
        datos = datos_del_formulario("" if empresa in (None, SIN_EMPRESA) else empresa.nombre)
        datos["campos"] = formulario.visibles(excluir_personales=True)
        # Con los cargos para elegir: el cargo es obligatorio en «Mi perfil».
        datos["mis_datos"] = {
            **contacto.de(request.user),
            "cargos": contacto.opciones()["cargos"],
        }
        return Response(datos)

    def post(self, request):
        entrada = SolicitudSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        persona, faltan = datos_de_la_persona(request.user)
        if faltan:
            raise FaltanDatos(
                {
                    "faltan": faltan,
                    "mis_datos": [
                        "Complete su perfil (" + ", ".join(faltan) + ") para crear el ticket."
                    ],
                }
            )
        datos = {**entrada.validated_data, **persona}
        datos, adicionales = formulario.validar_envio(datos, datos.get("adicionales") or {})
        archivos = validar_adjuntos(request.FILES.getlist("adjuntos"))
        contexto = get_request_context(request) or {}
        try:
            with transaction.atomic():
                ticket = services.crear_ticket(
                    datos=_datos_del_ticket(datos, adicionales),
                    solicitante=request.user,
                    ip=contexto.get("ip_address"),
                )
                services.guardar_adjuntos(ticket, archivos, del_solicitante=True)
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        ticket.refresh_from_db()
        return Response(
            {
                "id": ticket.id,
                "numero": ticket.numero,
                "posicion": services.posicion_en_cola(ticket),
                "estado": ticket.estado,
                "fuera_de_horario": ticket.fuera_de_horario,
            },
            status=status.HTTP_201_CREATED,
        )


class MisTicketsView(APIView):
    """«Soporte TI → Mis tickets»: lo que pidió, lo más reciente primero."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        nombres = etiquetas.de_la_empresa()
        tickets = _mis_tickets(request.user).select_related("caso", "categoria")[:100]
        return Response(
            [
                {
                    "id": t.id,
                    "numero": t.numero,
                    "categoria": t.categoria.nombre,
                    "caso": t.caso.nombre,
                    "estado": t.estado,
                    "estado_display": nombres["estados"][t.estado],
                    "criticidad": t.criticidad,
                    "criticidad_display": t.get_criticidad_display(),
                    "posicion": services.posicion_en_cola(t),
                    "creado": t.created_at,
                    "atendido_en": t.atendido_en,
                }
                for t in tickets
            ]
        )


class MiTicketView(APIView):
    """La ficha de un ticket propio: estado, posición en la cola y respuestas.
    `POST`: responder (con adjuntos) o confirmar la solución."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, pk):
        ticket = _mi_ticket(request, pk)
        return Response(seguimiento(ticket, _url_mia(ticket)))

    def post(self, request, pk):
        ticket = _mi_ticket(request, pk)
        try:
            with transaction.atomic():
                if str(request.data.get("confirmar", "")).lower() in {"true", "1"}:
                    services.confirmar_solucion(ticket)
                else:
                    entrada = MensajePublicoSerializer(data=request.data)
                    entrada.is_valid(raise_exception=True)
                    archivos = validar_adjuntos(request.FILES.getlist("adjuntos"))
                    mensaje = services.mensaje_del_solicitante(
                        ticket, entrada.validated_data["texto"]
                    )
                    services.guardar_adjuntos(
                        ticket, archivos, mensaje=mensaje, del_solicitante=True
                    )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        return self.get(request, pk)


class MiEncuestaView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        ticket = _mi_ticket(request, pk)
        entrada = EncuestaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            services.responder_encuesta(ticket, **entrada.validated_data)
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        ticket = _mi_ticket(request, pk)
        return Response(seguimiento(ticket, _url_mia(ticket)), status=201)


class MiAdjuntoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, adjunto_id):
        ticket = _mi_ticket(request, pk)
        adjunto = get_object_or_404(AdjuntoTicket, pk=adjunto_id, ticket=ticket, interno=False)
        return _descargar(adjunto)


# --- Equipo ----------------------------------------------------------------------------


class TicketsPermission(HasActionPermission):
    """Ver la bandeja exige ser del equipo; qué ticket puede mover cada quien lo
    decide `services`."""

    def get_required_permission(self, request, view) -> str:
        if getattr(view, "action", None) == "todos":
            return "soporte.ver_todos"
        return "soporte.atender"

    def has_permission(self, request, view) -> bool:
        usuario = request.user
        if not (usuario and usuario.is_authenticated):
            return False
        # Quien solo registra entra para el alta interna; ve los tickets que le
        # toquen (ninguno, si no es técnico).
        return any(
            services.tiene(usuario, p) for p in ("atender", "ver_todos", "asignar", "registrar")
        )


class TicketViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, TicketsPermission]
    pagination_class = DefaultPagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        usuario = self.request.user
        queryset = Ticket.objects.select_related(
            "sede", "area", "categoria", "caso", "nivel", "tecnico__usuario", "registrado_por"
        )
        if self.action == "retrieve":
            queryset = queryset.prefetch_related(
                "mensajes__autor",
                "mensajes__adjuntos",
                "adjuntos",
                "movimientos__actor",
                "aprobaciones__aprobador",
                "aprobaciones__decidido_por",
            )
        ve_todo = services.tiene(usuario, "ver_todos") or services.tiene(usuario, "asignar")
        tecnico = services.tecnico_de(usuario)
        if not ve_todo:
            visibles = Q(tecnico__usuario=usuario)
            if tecnico:
                # La cola que le puede tocar: su nivel y sus categorías.
                visibles |= Q(
                    estado=Ticket.Estado.NUEVO,
                    nivel_id=tecnico.nivel_id,
                    categoria__in=tecnico.categorias.all(),
                )
            queryset = queryset.filter(visibles)

        if self.action != "list":
            return queryset
        params = self.request.query_params
        ambito = params.get("ambito", "mios")
        if ambito == "mios":
            queryset = queryset.filter(tecnico__usuario=usuario)
        elif ambito == "cola":
            # El más crítico primero (ver `criticidad.py`).
            queryset = queryset.filter(estado=Ticket.Estado.NUEVO).order_by(
                "-puntaje", "en_cola_desde"
            )
        estado = params.get("estado")
        if estado in Ticket.Estado.values:
            queryset = queryset.filter(estado=estado)
        elif params.get("abiertos", "true") == "true" and ambito != "cola":
            queryset = queryset.exclude(estado=Ticket.Estado.CERRADO)
        if params.get("categoria", "").isdigit():
            queryset = queryset.filter(categoria_id=int(params["categoria"]))
        if params.get("prioridad") in dict(Ticket._meta.get_field("prioridad").choices):
            queryset = queryset.filter(prioridad=params["prioridad"])
        busqueda = (params.get("q") or "").strip()
        if busqueda:
            filtro = Q(solicitante_nombre__icontains=busqueda) | Q(descripcion__icontains=busqueda)
            ultimo = busqueda.upper().replace("TCK-", "").split("-")[-1]
            if ultimo.isdigit():
                filtro |= Q(secuencia=int(ultimo))
            queryset = queryset.filter(filtro)
        return queryset

    def get_serializer_class(self):
        return TicketDetalleSerializer if self.action == "retrieve" else TicketListaSerializer

    def _detalle(self, ticket, **extra):
        visible = (
            self.get_queryset()
            .prefetch_related(
                "mensajes__autor", "mensajes__adjuntos", "adjuntos", "movimientos__actor"
            )
            .filter(pk=ticket.pk)
            .first()
        )
        if visible is None:
            # Tras escalarlo o reasignarlo, quien actuó puede dejar de verlo.
            ticket.refresh_from_db()
            return {
                "id": ticket.id,
                "numero": ticket.numero,
                "estado": ticket.estado,
                "visible": False,
            }
        ticket = visible
        datos = TicketDetalleSerializer(ticket, context=self.get_serializer_context()).data
        tecnico = services.tecnico_de(self.request.user)
        # Si quien actúa está fuera de su horario, la pantalla le pide registrar
        # el tiempo que le dedica (horas fuera de horario).
        datos["registrar_horas"] = bool(
            ticket.tecnico_id
            and tecnico
            and ticket.tecnico_id == tecnico.id
            and services.fuera_de_su_horario(tecnico)
        )
        datos.update(extra)
        return datos

    def _auditar(self, accion, ticket, nuevos, previos=None):
        record_audit_event(
            actor=self.request.user,
            action=accion,
            target_type="ticket",
            target_id=ticket.numero,
            module=MODULO,
            previous_values=previos,
            new_values=nuevos,
            context=get_request_context(self.request),
        )

    def retrieve(self, request, *args, **kwargs):
        return Response(self._detalle(self.get_object()))

    @action(detail=False, methods=["get"])
    def bandeja(self, request):
        """Lo que pinta la cabecera de la bandeja: mi perfil y la cola."""
        tecnico = services.tecnico_de(request.user)
        from .horario import Agenda

        return Response(
            {
                "tecnico": (
                    {
                        "id": tecnico.id,
                        "nivel": str(tecnico.nivel),
                        "categorias": [c.nombre for c in tecnico.categorias.all()],
                        "capacidad": tecnico.capacidad,
                        "en_horario": Agenda(tecnico).en_horario(),
                        "abiertos": services._abiertos(tecnico),
                        "cola_para_mi": services.en_cola_para(tecnico),
                    }
                    if tecnico
                    else None
                ),
                "cola_total": Ticket.objects.filter(estado=Ticket.Estado.NUEVO).count(),
                "puede": {
                    "ver_todos": services.tiene(request.user, "ver_todos"),
                    "asignar": services.tiene(request.user, "asignar"),
                    "registrar": services.tiene(request.user, "registrar"),
                    "aprobar_horas": services.tiene(request.user, "aprobar_horas"),
                },
            }
        )

    @action(detail=False, methods=["get"])
    def formulario(self, request):
        """Lo que pide el alta interna: el formulario de la empresa y los canales."""
        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        empresa = empresa_actual()
        nombre = "" if empresa in (None, SIN_EMPRESA) else empresa.nombre
        datos = datos_del_formulario(nombre)
        datos["canales"] = [
            {"id": valor, "nombre": etiqueta}
            for valor, etiqueta in Canal.choices
            if valor != Canal.PORTAL
        ]
        datos["campos"] = formulario.visibles(excluir_personales=True)
        datos["soy_tecnico"] = services.tecnico_de(request.user) is not None
        return Response(datos)

    @action(detail=False, methods=["get"])
    def personas(self, request):
        """Las personas registradas de la empresa, con sus datos de contacto,
        para el alta interna: solo se registran tickets de personas con cuenta."""
        if not services.tiene(request.user, "registrar"):
            raise PermissionDenied("No tiene el permiso requerido: soporte.registrar.")
        from apps.chat.services import buscar_personas

        return Response(
            [
                {"id": p.id, **contacto.de(p)}
                for p in buscar_personas(request.query_params.get("q", ""), limite=20)
            ]
        )

    @action(detail=False, methods=["post"])
    def registrar(self, request):
        """Alta interna: un ticket que llegó por teléfono, WhatsApp o en persona,
        registrado por el equipo en nombre de quien pide."""
        if not services.tiene(request.user, "registrar"):
            raise PermissionDenied("No tiene el permiso requerido: soporte.registrar.")
        entrada = TicketInternoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        canal, asignarme, solicitante = datos["canal"], datos["asignarme"], datos["solicitante"]
        from apps.chat.services import personas_de_la_empresa

        if not personas_de_la_empresa().filter(pk=solicitante.pk).exists():
            raise serializers.ValidationError(
                {"solicitante": "Esa persona no está registrada en esta empresa."}
            )
        persona, faltan = datos_de_la_persona(
            solicitante,
            {
                "telefono": datos.get("telefono"),
                "area": datos.get("area"),
                "sede": datos.get("sede"),
            },
        )
        if faltan:
            raise FaltanDatos(
                {
                    "faltan": faltan,
                    "solicitante": [
                        "A esta persona le falta " + ", ".join(faltan) + ": complételo en el "
                        "formulario."
                    ],
                }
            )
        datos = {**datos, **persona}
        datos, adicionales = formulario.validar_envio(datos, datos.get("adicionales") or {})
        archivos = validar_adjuntos(request.FILES.getlist("adjuntos"))
        try:
            with transaction.atomic():
                ticket = services.registrar_ticket(
                    datos=_datos_del_ticket(datos, adicionales),
                    actor=request.user,
                    canal=canal,
                    asignarme=asignarme,
                    solicitante=solicitante,
                )
                services.guardar_adjuntos(ticket, archivos)
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        self._auditar("ticket.registrado", ticket, {"canal": canal, "asignarme": asignarme})
        return Response(self._detalle(ticket), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def prioridad(self, request, pk=None):
        """Ajustar la prioridad (o calcularla por impacto y urgencia), con
        justificación."""
        ticket = self.get_object()
        entrada = CambioPrioridadSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        anterior = ticket.prioridad
        return self._accion(
            "ticket.prioridad_changed",
            lambda: services.cambiar_prioridad(
                ticket,
                request.user,
                prioridad=datos.get("prioridad") or anterior,
                justificacion=datos["justificacion"],
                impacto=datos.get("impacto", ""),
                urgencia=datos.get("urgencia", ""),
            ),
            ticket,
            {"anterior": anterior, "justificacion": datos["justificacion"]},
        )

    @action(detail=False, methods=["get"])
    def tecnicos(self, request):
        """A quién se puede asignar (para quien coordina): los técnicos activos,
        con su nivel y cuántos tickets tienen abiertos."""
        if not services.tiene(request.user, "asignar"):
            raise PermissionDenied("Ver el equipo para asignar es de quien coordina.")
        return Response(
            [
                {
                    "id": t.id,
                    "nombre": str(t),
                    "nivel": str(t.nivel),
                    "abiertos": services._abiertos(t),
                }
                for t in Tecnico.objects.filter(activo=True).select_related("usuario", "nivel")
            ]
        )

    @action(detail=False, methods=["get"])
    def todos(self, request):
        """Todos los tickets de la empresa (coordinación)."""
        return self.list(request)

    @action(detail=False, methods=["post"], url_path="tomar-siguiente")
    def tomar_siguiente(self, request):
        tecnico = services.tecnico_de(request.user)
        if tecnico is None:
            raise PermissionDenied("Solo un técnico de la mesa toma tickets de la cola.")
        ticket = services.tomar_siguiente(tecnico, request.user)
        if ticket is None:
            return Response(
                {"detail": "No hay tickets en la cola que usted pueda atender."}, status=404
            )
        self._auditar("ticket.tomado", ticket, {"tecnico": str(tecnico)})
        return Response(self._detalle(ticket))

    def _accion(self, nombre_auditoria, funcion, ticket, nuevos):
        previos = {"estado": ticket.estado, "tecnico": str(ticket.tecnico or "")}
        try:
            with transaction.atomic():
                funcion()
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        ticket.refresh_from_db()
        self._auditar(nombre_auditoria, ticket, nuevos, previos)
        return Response(self._detalle(ticket))

    @action(detail=True, methods=["post"], url_path="cambiar-estado")
    def cambiar_estado(self, request, pk=None):
        ticket = self.get_object()
        entrada = CambioEstadoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        return self._accion(
            "ticket.estado_changed",
            lambda: services.cambiar_estado(
                ticket, request.user, datos["estado"], datos.get("nota", "")
            ),
            ticket,
            {"estado": datos["estado"]},
        )

    @action(detail=True, methods=["post"])
    def escalar(self, request, pk=None):
        ticket = self.get_object()
        entrada = EscalarSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        return self._accion(
            "ticket.escalado",
            lambda: services.escalar(ticket, request.user, entrada.validated_data["motivo"]),
            ticket,
            {"motivo": entrada.validated_data["motivo"]},
        )

    @action(detail=True, methods=["post"])
    def asignar(self, request, pk=None):
        ticket = self.get_object()
        entrada = AsignarSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        return self._accion(
            "ticket.asignado",
            lambda: services.asignar_manual(
                ticket, datos["tecnico"], request.user, datos.get("nota", "")
            ),
            ticket,
            {"tecnico": str(datos["tecnico"])},
        )

    @action(detail=True, methods=["post"])
    def responder(self, request, pk=None):
        ticket = self.get_object()
        entrada = RespuestaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        archivos = validar_adjuntos(request.FILES.getlist("adjuntos"))

        def responder():
            mensaje = services.responder(
                ticket, request.user, datos["texto"], interno=datos["interno"]
            )
            services.guardar_adjuntos(ticket, archivos, mensaje=mensaje, interno=datos["interno"])

        return self._accion("ticket.respondido", responder, ticket, {"interno": datos["interno"]})

    @action(detail=True, methods=["post"])
    def horas(self, request, pk=None):
        """Registrar el tiempo dedicado fuera del horario."""
        ticket = self.get_object()
        entrada = HorasSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            registro = services.registrar_horas(
                ticket,
                services.tecnico_de(request.user),
                fecha=datos["fecha"],
                horas=datos["horas"],
                descripcion=datos["descripcion"],
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        self._auditar("ticket.horas_registradas", ticket, {"horas": str(registro.horas)})
        return Response(HorasSerializer(registro).data, status=201)

    @action(detail=True, methods=["get"], url_path=r"adjuntos/(?P<adjunto_id>\d+)")
    def adjunto(self, request, pk=None, adjunto_id=None):
        ticket = self.get_object()
        return _descargar(get_object_or_404(AdjuntoTicket, pk=adjunto_id, ticket=ticket))


class HorasViewSet(viewsets.ReadOnlyModelViewSet):
    """Horas fuera de horario: cada técnico ve las suyas; quien aprueba, todas."""

    permission_classes = [IsAuthenticated, TicketsPermission]
    serializer_class = HorasSerializer
    pagination_class = DefaultPagination

    def get_queryset(self):
        queryset = HorasFueraDeHorario.objects.select_related(
            "ticket", "tecnico__usuario", "revisado_por"
        )
        if not services.tiene(self.request.user, "aprobar_horas"):
            queryset = queryset.filter(tecnico__usuario=self.request.user)
        estado = self.request.query_params.get("estado")
        if estado in HorasFueraDeHorario.Estado.values:
            queryset = queryset.filter(estado=estado)
        return queryset

    @action(detail=True, methods=["post"])
    def revisar(self, request, pk=None):
        registro = self.get_object()
        aprobar = bool(request.data.get("aprobar"))
        try:
            services.revisar_horas(
                registro, request.user, aprobar=aprobar, nota=request.data.get("nota", "")
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        record_audit_event(
            actor=request.user,
            action="horas_fuera.revisadas",
            target_type="horas_fuera_de_horario",
            target_id=registro.id,
            module=MODULO,
            new_values={"estado": registro.estado},
            context=get_request_context(request),
        )
        return Response(HorasSerializer(registro).data)


class MiAgendaView(APIView):
    """«Mi horario»: el técnico ve y cambia sus franjas y ausencias."""

    permission_classes = [IsAuthenticated, TicketsPermission]

    def _tecnico(self, request):
        tecnico = services.tecnico_de(request.user)
        if tecnico is None:
            raise Http404("Usted no es parte del equipo de soporte de esta empresa.")
        return tecnico

    def get(self, request):
        tecnico = self._tecnico(request)
        return Response(TecnicoSerializer(tecnico).data)

    def put(self, request):
        tecnico = self._tecnico(request)
        entrada = AgendaPropiaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        with transaction.atomic():
            TecnicoSerializer()._guardar_agenda(tecnico, datos["horarios"], datos["ausencias"])
        record_audit_event(
            actor=request.user,
            action="soporte.horario_actualizado",
            target_type="tecnico",
            target_id=tecnico.id,
            module=MODULO,
            new_values={"franjas": len(datos["horarios"]), "ausencias": len(datos["ausencias"])},
            context=get_request_context(request),
        )
        transaction.on_commit(services.repartir)
        return Response(TecnicoSerializer(services.tecnico_de(request.user)).data)


# --- Configuración ---------------------------------------------------------------------


class ConfiguracionPermission(HasModulePermission):
    view_permission = "soporte.configurar"
    write_permission = "soporte.configurar"


class FormularioPermission(HasModulePermission):
    view_permission = "soporte.formulario"
    write_permission = "soporte.formulario"


class VerCategoriasPermission(BasePermission):
    """Las categorías se leen para filtrar la bandeja, para configurarlas y
    para decir a qué categorías aplica un campo del formulario."""

    def has_permission(self, request, view) -> bool:
        return TicketsPermission().has_permission(request, view) or any(
            services.tiene(request.user, p) for p in ("configurar", "formulario")
        )


class _Config(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, ConfiguracionPermission]
    entidad = ""

    def _auditar(self, accion, objeto, datos=None):
        record_audit_event(
            actor=self.request.user,
            action=f"soporte.{self.entidad}.{accion}",
            target_type=self.entidad,
            target_id=objeto.pk,
            module=MODULO,
            new_values=datos or {},
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        objeto = serializer.save()
        self._auditar("created", objeto, serializer.data)

    def perform_update(self, serializer):
        objeto = serializer.save()
        self._auditar("updated", objeto, serializer.data)

    def perform_destroy(self, instance):
        self._auditar("deleted", instance)
        instance.delete()


class NivelViewSet(_Config):
    serializer_class = NivelSerializer
    entidad = "nivel"

    @action(detail=False, methods=["get"])
    def formulario(self, request):
        """El código de la empresa activa, para armar el enlace público del
        formulario (`/soporte/<codigo>`)."""
        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        empresa = empresa_actual()
        if empresa is None or empresa is SIN_EMPRESA:
            return Response({"codigo": None})
        return Response({"codigo": empresa.codigo, "empresa": empresa.nombre})

    def get_queryset(self):
        return NivelSoporte.objects.prefetch_related("supervisores")

    def perform_destroy(self, instance):
        if instance.tecnicos.exists() or instance.tickets.exists():
            raise serializers.ValidationError(
                "El nivel tiene técnicos o tickets: reasígnelos antes de borrarlo."
            )
        super().perform_destroy(instance)


class _ConPeso(_Config):
    """Categorías y casos llevan un peso de 1 a N que ordena la criticidad de
    los tickets (ver `criticidad.py`): al crear, borrar o reordenar se
    renumeran y los tickets abiertos se reordenan."""

    def _grupo(self, objeto):
        raise NotImplementedError

    def _reponderar(self, objeto):
        criticidad.renumerar(self._grupo(objeto))
        empresa_id = getattr(objeto, "empresa_id", None) or objeto.categoria.empresa_id
        criticidad.recalcular_abiertos(empresa_id)

    def perform_create(self, serializer):
        with transaction.atomic():
            super().perform_create(serializer)
            self._reponderar(serializer.instance)

    def perform_destroy(self, instance):
        with transaction.atomic():
            grupo = self._grupo(instance)
            empresa_id = getattr(instance, "empresa_id", None) or instance.categoria.empresa_id
            super().perform_destroy(instance)
            criticidad.renumerar(grupo)
            criticidad.recalcular_abiertos(empresa_id)


class CriticidadView(APIView):
    """Los pesos de quien pide en la criticidad: el de cada área (se
    reordena) y el de cada nivel jerárquico (automático, por el orden del
    organigrama). Ver `criticidad.py`."""

    permission_classes = [IsAuthenticated, ConfiguracionPermission]

    def _empresa_id(self):
        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        empresa = empresa_actual()
        if empresa in (None, SIN_EMPRESA):
            raise serializers.ValidationError("No hay una empresa activa.")
        return empresa.id

    def get(self, request):
        empresa_id = self._empresa_id()
        return Response(
            {"areas": criticidad.areas(empresa_id), "niveles": criticidad.niveles(empresa_id)}
        )

    def post(self, request):
        """El orden de las áreas, de menos a más crítica (por id de área)."""
        empresa_id = self._empresa_id()
        ids = request.data.get("ids") or []
        criticidad.asegurar_areas(empresa_id)
        with transaction.atomic():
            criticidad.ponderar(PesoArea.objects.filter(area__activo=True), ids, campo="area_id")
            criticidad.recalcular_abiertos(empresa_id)
        record_audit_event(
            actor=request.user,
            action="soporte.areas.ponderadas",
            target_type="criticidad",
            target_id=empresa_id,
            module=MODULO,
            new_values={"ids": ids},
            context=get_request_context(request),
        )
        return self.get(request)


class CategoriaViewSet(_ConPeso):
    serializer_class = CategoriaSerializer
    entidad = "categoria"

    def _grupo(self, objeto):
        return Categoria.objects.all()

    @action(detail=False, methods=["post"])
    def ponderar(self, request):
        """El orden de menos a más crítica: la primera vale 1."""
        ids = request.data.get("ids") or []
        categorias = Categoria.objects.all()
        primera = categorias.first()
        if primera is None:
            raise serializers.ValidationError({"ids": "No hay categorías."})
        with transaction.atomic():
            criticidad.ponderar(categorias, ids)
            criticidad.recalcular_abiertos(primera.empresa_id)
        self._auditar("ponderadas", primera, {"ids": ids})
        return Response(self.get_serializer(self.get_queryset(), many=True).data)

    def get_permissions(self):
        # Ver las categorías lo necesita también quien atiende (filtros) y
        # quien edita el formulario (a qué categorías aplica cada campo).
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated(), VerCategoriasPermission()]
        return super().get_permissions()

    def get_queryset(self):
        return Categoria.objects.prefetch_related("casos", "tecnicos__usuario")

    def perform_destroy(self, instance):
        if instance.tickets.exists():
            raise serializers.ValidationError(
                "La categoría tiene tickets: desactívela en lugar de borrarla."
            )
        super().perform_destroy(instance)


class CasoViewSet(_ConPeso):
    serializer_class = CasoSerializer
    entidad = "caso"

    def _grupo(self, objeto):
        return CasoAyuda.objects.filter(categoria_id=objeto.categoria_id)

    @action(detail=False, methods=["post"])
    def ponderar(self, request):
        """El orden de los casos de una categoría, de menos a más crítico."""
        categoria = Categoria.objects.filter(pk=request.data.get("categoria")).first()
        if categoria is None:
            raise serializers.ValidationError({"categoria": "Elija la categoría."})
        ids = request.data.get("ids") or []
        with transaction.atomic():
            criticidad.ponderar(CasoAyuda.objects.filter(categoria=categoria), ids)
            criticidad.recalcular_abiertos(categoria.empresa_id)
        self._auditar("ponderados", categoria, {"categoria": categoria.id, "ids": ids})
        return Response(CasoSerializer(categoria.casos.order_by("peso", "nombre"), many=True).data)

    def get_queryset(self):
        return CasoAyuda.objects.select_related("categoria")

    def perform_destroy(self, instance):
        if instance.tickets.exists():
            raise serializers.ValidationError(
                "El caso tiene tickets: desactívelo en lugar de borrarlo."
            )
        super().perform_destroy(instance)


class TecnicoViewSet(_Config):
    serializer_class = TecnicoSerializer
    entidad = "tecnico"

    def get_queryset(self):
        return Tecnico.objects.select_related("usuario", "nivel").prefetch_related(
            "categorias", "horarios", "ausencias"
        )

    def perform_update(self, serializer):
        super().perform_update(serializer)
        transaction.on_commit(services.repartir)

    def perform_destroy(self, instance):
        if instance.tickets.exclude(estado__in=["atendido", "cerrado"]).exists():
            raise serializers.ValidationError(
                "El técnico tiene tickets abiertos: reasígnelos o desactívelo."
            )
        if instance.tickets.exists():
            raise serializers.ValidationError(
                "El técnico tiene historial de tickets: desactívelo en lugar de borrarlo."
            )
        super().perform_destroy(instance)

    @action(detail=False, methods=["get"])
    def personas(self, request):
        """Quién puede ser técnico o supervisor: las cuentas de la empresa."""
        from django.contrib.auth import get_user_model

        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        usuarios = get_user_model().objects.filter(is_active=True)
        empresa = empresa_actual()
        if empresa is not None and empresa is not SIN_EMPRESA:
            usuarios = usuarios.filter(membresias__empresa=empresa)
        return Response(
            [
                {"id": u.id, "nombre": u.get_full_name() or u.username, "correo": u.email}
                for u in usuarios.distinct().order_by("first_name", "last_name", "username")
            ]
        )


class ReglaSLAViewSet(_Config):
    serializer_class = ReglaSLASerializer
    entidad = "regla_sla"

    @action(detail=False, methods=["get"])
    def areas(self, request):
        """Las áreas solicitantes (departamentos) para elegir en una regla, sin
        exigir el permiso de ver los catálogos de la organización."""
        return Response(
            [
                {"id": d.id, "nombre": d.nombre}
                for d in Departamento.objects.filter(activo=True).order_by("nombre")
            ]
        )

    def get_queryset(self):
        return ReglaSLA.objects.select_related("categoria", "area")


class RespuestaPredefinidaViewSet(_Config):
    serializer_class = RespuestaPredefinidaSerializer
    entidad = "respuesta"

    def get_permissions(self):
        # Usarlas es de quien atiende; crearlas, de quien configura.
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated(), TicketsPermission()]
        return super().get_permissions()

    def get_queryset(self):
        return RespuestaPredefinida.objects.all()


class EtiquetasView(APIView):
    """Los nombres de estados y prioridades de la empresa, para las pantallas."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        nombres = etiquetas.de_la_empresa()
        return Response(
            {
                "estados": list(nombres["estados"].items()),
                "prioridades": list(nombres["prioridades"].items()),
            }
        )


class AprobacionesView(APIView):
    """Las solicitudes que esperan el visto bueno de quien entra. Llega aquí
    desde el correo: un jefe de área no necesita permisos de la mesa de ayuda,
    solo ser el aprobador."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        nombres = etiquetas.de_la_empresa()
        pendientes = services.aprobaciones_de(request.user).select_related(
            "ticket__caso", "ticket__categoria", "ticket__area", "ticket__sede", "aprobador"
        )
        return Response(
            [
                {
                    "id": a.id,
                    "rol": a.rol,
                    "sin_aprobador": a.aprobador_id is None,
                    "creada": a.created_at,
                    "ticket": {
                        "numero": a.ticket.numero,
                        "solicitante": a.ticket.solicitante_nombre,
                        "correo": a.ticket.solicitante_correo,
                        "area": a.ticket.area.nombre if a.ticket.area_id else "",
                        "agencia": a.ticket.sede.nombre if a.ticket.sede_id else "",
                        "categoria": a.ticket.categoria.nombre,
                        "codigo": a.ticket.caso.codigo,
                        "caso": a.ticket.caso.nombre,
                        "prioridad_display": nombres["prioridades"][a.ticket.prioridad],
                        "descripcion": a.ticket.descripcion,
                        "datos_adicionales": a.ticket.datos_adicionales or [],
                    },
                }
                for a in pendientes
            ]
        )


class DecidirAprobacionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        aprobacion = get_object_or_404(
            AprobacionTicket.objects.select_related("ticket__caso", "ticket__nivel"), pk=pk
        )
        entrada = DecisionSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            ticket = services.decidir_aprobacion(
                aprobacion, request.user, aprobar=datos["aprobar"], nota=datos.get("nota", "")
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        record_audit_event(
            actor=request.user,
            action="ticket.aprobado" if datos["aprobar"] else "ticket.rechazado",
            target_type="ticket",
            target_id=ticket.numero,
            module=MODULO,
            new_values={"rol": aprobacion.rol, "nota": datos.get("nota", "")},
            context=get_request_context(request),
        )
        return Response({"numero": ticket.numero, "estado": ticket.estado})


class MesaView(APIView):
    """Configuración → Mesa de ayuda → Horario y metas: el horario hábil con
    que se miden los plazos de P2 a P4, los feriados, las metas de
    cumplimiento y si los P1 corren 24/7."""

    permission_classes = [IsAuthenticated, ConfiguracionPermission]

    def _datos(self):
        from django.db.models import F

        configuracion = ConfiguracionMesa.objects.first() or ConfiguracionMesa()
        horarios = list(HorarioMesa.objects.values("dia_semana", "hora_inicio", "hora_fin"))
        return {
            "meta_sla": configuracion.meta_sla,
            "meta_sla_critica": configuracion.meta_sla_critica,
            "critica_24x7": configuracion.critica_24x7,
            "etiquetas": configuracion.etiquetas or {},
            "etiquetas_por_defecto": {
                "estados": dict(Ticket.Estado.choices),
                "prioridades": dict(Ticket._meta.get_field("prioridad").choices),
            },
            "horarios": horarios
            or [
                {"dia_semana": d, "hora_inicio": i, "hora_fin": f}
                for d, i, f in sla.HORARIO_POR_DEFECTO
            ],
            "horario_por_defecto": not horarios,
            "feriados": list(
                FeriadoMesa.objects.order_by(F("desde")).values("desde", "hasta", "motivo")
            ),
        }

    def get(self, request):
        return Response(self._datos())

    def put(self, request):
        entrada = MesaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        services.guardar_mesa(entrada.validated_data)
        record_audit_event(
            actor=request.user,
            action="soporte.mesa.updated",
            target_type="mesa",
            target_id=None,
            module=MODULO,
            new_values={
                "meta_sla": entrada.validated_data["meta_sla"],
                "meta_sla_critica": entrada.validated_data["meta_sla_critica"],
                "critica_24x7": entrada.validated_data["critica_24x7"],
                "franjas": len(entrada.validated_data["horarios"]),
                "feriados": len(entrada.validated_data["feriados"]),
            },
            context=get_request_context(request),
        )
        return Response(self._datos())


class CampoFormularioViewSet(_Config):
    """Los campos del formulario de «Soporte TI» (menú Mesa de ayuda →
    Formulario). Su propio permiso: no exige configurar la mesa."""

    permission_classes = [IsAuthenticated, FormularioPermission]
    serializer_class = CampoFormularioSerializer
    entidad = "campo_formulario"

    def get_queryset(self):
        return CampoFormulario.objects.prefetch_related("categorias").order_by("orden", "id")

    def list(self, request, *args, **kwargs):
        formulario.asegurar_base()
        return super().list(request, *args, **kwargs)

    def perform_destroy(self, instance):
        if instance.base:
            raise serializers.ValidationError(
                "Es un campo del sistema: puede ocultarlo, pero no borrarlo."
            )
        super().perform_destroy(instance)

    @action(detail=False, methods=["post"])
    def ordenar(self, request):
        """`{"ids": [...]}`: deja los campos en ese orden."""
        formulario.ordenar(request.data.get("ids") or [])
        record_audit_event(
            actor=request.user,
            action="soporte.campo_formulario.reordered",
            target_type="campo_formulario",
            target_id=None,
            module=MODULO,
            new_values={"ids": request.data.get("ids")},
            context=get_request_context(request),
        )
        return Response(self.get_serializer(self.get_queryset(), many=True).data)


def _hoy():
    return timezone.localdate()


class ReportesPermission(HasModulePermission):
    view_permission = "soporte.reportes"
    write_permission = "soporte.reportes"


class ReportesSoporteView(APIView):
    """Reportes → Mesa de ayuda."""

    permission_classes = [IsAuthenticated, ReportesPermission]

    def get(self, request):
        from . import estadisticas

        base = estadisticas.filtrar(Ticket.objects.all(), request.query_params)
        return Response(estadisticas.resumen(base))
