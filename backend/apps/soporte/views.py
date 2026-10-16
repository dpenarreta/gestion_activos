"""La API de la Mesa de ayuda.

- **Pública** (sin sesión): el formulario de cada empresa y la página de
  seguimiento por enlace secreto. Va acotada a la empresa del formulario o del
  ticket con `usando_empresa`, porque sin sesión no hay empresa activa.
- **Del equipo**: bandeja, ficha y acciones sobre los tickets.
- **Configuración**: niveles, categorías y casos, técnicos con su horario, SLA,
  respuestas predefinidas y los campos del formulario público.
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
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS, AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.organizacion.models import Departamento, Sede
from apps.permissions.permissions import HasActionPermission, HasModulePermission

from . import formulario, services
from .models import (
    AdjuntoTicket,
    CampoFormulario,
    CasoAyuda,
    Categoria,
    HorasFueraDeHorario,
    NivelSoporte,
    ReglaSLA,
    RespuestaPredefinida,
    Tecnico,
    Ticket,
)
from .serializers import (
    AgendaPropiaSerializer,
    AsignarSerializer,
    CambioEstadoSerializer,
    CampoFormularioSerializer,
    CasoSerializer,
    CategoriaSerializer,
    EscalarSerializer,
    FormularioPublicoSerializer,
    HorasSerializer,
    MensajePublicoSerializer,
    NivelSerializer,
    ReglaSLASerializer,
    RespuestaPredefinidaSerializer,
    RespuestaSerializer,
    TecnicoSerializer,
    TicketDetalleSerializer,
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


# --- Pública ---------------------------------------------------------------------------


def _empresa_del_formulario(codigo):
    empresa = Empresa.objects.filter(codigo__iexact=codigo, activa=True).first()
    if empresa is None:
        raise Http404("No existe una mesa de ayuda con ese código.")
    return empresa


class FormularioPublicoView(APIView):
    """`GET`: lo que muestra el formulario. `POST`: crea el ticket."""

    permission_classes = [AllowAny]
    authentication_classes = []
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "soporte_formulario"
            return [ScopedRateThrottle()]
        return []

    def get(self, request, codigo):
        empresa = _empresa_del_formulario(codigo)
        with usando_empresa(empresa):
            configurado = NivelSoporte.objects.exists()
            categorias = (
                Categoria.objects.filter(activa=True).prefetch_related("casos").order_by("nombre")
            )
            return Response(
                {
                    "empresa": empresa.nombre,
                    "disponible": configurado,
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
                                    "nombre": caso.nombre,
                                    "prioridad": caso.prioridad,
                                    "prioridad_display": caso.get_prioridad_display(),
                                }
                                for caso in c.casos.all()
                                if caso.activo
                            ],
                        }
                        for c in categorias
                    ],
                }
            )

    def post(self, request, codigo):
        empresa = _empresa_del_formulario(codigo)
        with usando_empresa(empresa):
            entrada = FormularioPublicoSerializer(data=request.data)
            entrada.is_valid(raise_exception=True)
            datos = entrada.validated_data
            if datos.get("sitio_web"):
                # Un bot llenó el campo trampa: se responde como si nada para
                # no enseñarle qué lo delató, y no se crea nada.
                return Response({"numero": "", "posicion": None, "token": ""}, status=201)
            datos, adicionales = formulario.validar_envio(datos, datos.get("adicionales") or {})
            archivos = validar_adjuntos(request.FILES.getlist("adjuntos"))
            contexto = get_request_context(request) or {}
            try:
                with transaction.atomic():
                    ticket = services.crear_ticket(
                        datos={
                            "solicitante_nombre": datos["nombre"].strip(),
                            "solicitante_telefono": datos.get("telefono") or "",
                            "solicitante_correo": datos["correo"],
                            "sede": datos.get("sede"),
                            "area": datos.get("area"),
                            "caso": datos["caso"],
                            "descripcion": datos["descripcion"].strip(),
                            "datos_adicionales": adicionales,
                        },
                        ip=contexto.get("ip_address"),
                    )
                    services.guardar_adjuntos(ticket, archivos, del_solicitante=True)
            except ErrorDeModelo as error:
                raise serializers.ValidationError(_errores(error)) from error
            ticket.refresh_from_db()
            return Response(
                {
                    "numero": ticket.numero,
                    "posicion": services.posicion_en_cola(ticket),
                    "estado": ticket.estado,
                    "fuera_de_horario": ticket.fuera_de_horario,
                    "token": ticket.token,
                },
                status=status.HTTP_201_CREATED,
            )


def _ticket_del_enlace(token):
    ticket = (
        Ticket.objects.todas()
        .select_related("empresa", "sede", "area", "categoria", "caso", "tecnico__usuario")
        .filter(token=token)
        .first()
    )
    if ticket is None:
        raise Http404("El enlace no corresponde a ningún ticket.")
    return ticket


def _url_publica(token):
    return lambda adjunto: f"/soporte/seguimiento/{token}/adjuntos/{adjunto.id}/"


class SeguimientoView(APIView):
    """La página de seguimiento de quien pidió, por su enlace secreto."""

    permission_classes = [AllowAny]
    authentication_classes = []
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "soporte_formulario"
            return [ScopedRateThrottle()]
        return []

    def get(self, request, token):
        ticket = _ticket_del_enlace(token)
        with usando_empresa(ticket.empresa):
            ticket = Ticket.objects.prefetch_related(
                "mensajes__autor", "mensajes__adjuntos", "adjuntos"
            ).get(pk=ticket.pk)
            return Response(seguimiento(ticket, _url_publica(token)))

    def post(self, request, token):
        """Responder (con adjuntos) o confirmar la solución (`confirmar: true`)."""
        ticket = _ticket_del_enlace(token)
        with usando_empresa(ticket.empresa):
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
            return self.get(request, token)


class AdjuntoPublicoView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token, adjunto_id):
        ticket = _ticket_del_enlace(token)
        with usando_empresa(ticket.empresa):
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
        return any(services.tiene(usuario, p) for p in ("atender", "ver_todos", "asignar"))


class TicketViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, TicketsPermission]
    pagination_class = DefaultPagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        usuario = self.request.user
        queryset = Ticket.objects.select_related(
            "sede", "area", "categoria", "caso", "nivel", "tecnico__usuario"
        )
        if self.action == "retrieve":
            queryset = queryset.prefetch_related(
                "mensajes__autor", "mensajes__adjuntos", "adjuntos", "movimientos__actor"
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
            queryset = queryset.filter(estado=Ticket.Estado.NUEVO).order_by("en_cola_desde")
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
                    "aprobar_horas": services.tiene(request.user, "aprobar_horas"),
                },
            }
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


class CategoriaViewSet(_Config):
    serializer_class = CategoriaSerializer
    entidad = "categoria"

    def get_permissions(self):
        # Ver las categorías lo necesita también quien atiende (filtros).
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated(), TicketsPermission()]
        return super().get_permissions()

    def get_queryset(self):
        return Categoria.objects.prefetch_related("casos", "tecnicos__usuario")

    def perform_destroy(self, instance):
        if instance.tickets.exists():
            raise serializers.ValidationError(
                "La categoría tiene tickets: desactívela en lugar de borrarla."
            )
        super().perform_destroy(instance)


class CasoViewSet(_Config):
    serializer_class = CasoSerializer
    entidad = "caso"

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


class CampoFormularioViewSet(_Config):
    """Los campos del formulario público (menú Mesa de ayuda → Formulario)."""

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
