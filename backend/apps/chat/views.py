"""La API del chat. Toda persona con sesión y membresía en la empresa activa
lo usa: no hay permisos que pedir, solo estar en la conversación."""

from django.core.exceptions import ValidationError as ErrorDeModelo
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import APIException
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.adjuntos.models import TAMANO_MAXIMO_BYTES
from apps.adjuntos.validators import validar_archivo
from apps.organizacion.models import Departamento
from apps.permissions.authorization import user_has_permission

from . import estados, presencia, services
from .models import Conversacion, EstadoChat, Mensaje
from .serializers import (
    DirectaSerializer,
    EditarGrupoSerializer,
    GrupoSerializer,
    LeerSerializer,
    MensajeSerializer,
    mensaje_dict,
    persona_dict,
)

Tipo = Conversacion.Tipo


class ArchivoGrande(APIException):
    """Un archivo que pasa el límite: la pantalla sugiere mandarlo por correo
    y muestra a quién."""

    status_code = 400
    default_code = "archivo_grande"


def _errores(error):
    return error.message_dict if hasattr(error, "message_dict") else error.messages


def _conversacion(request, pk):
    conversacion = get_object_or_404(Conversacion, pk=pk)
    services.participacion(request.user, conversacion)
    return conversacion


def resumen(conversacion, usuario, no_leidos) -> dict:
    """Una fila de la lista de conversaciones."""
    ultimo = (
        services.visibles(usuario, conversacion).select_related("autor").order_by("-id").first()
    )
    lugar = conversacion.participantes.filter(usuario=usuario).first()
    otro = None
    if conversacion.tipo == Tipo.DIRECTA:
        fila = conversacion.participantes.exclude(usuario=usuario).select_related("usuario").first()
        otro = persona_dict(fila.usuario) if fila else None
    return {
        "id": conversacion.id,
        "tipo": conversacion.tipo,
        "nombre": otro["nombre"] if otro else services.nombre_de(conversacion),
        "otro": otro,
        "departamento": conversacion.departamento_id,
        "miembros": conversacion.participantes.count(),
        "administra": bool(lugar and lugar.administra),
        "no_leidos": no_leidos.get(conversacion.id, 0),
        "ultimo": (
            {
                "texto": ultimo.texto[:120] or (f"📎 {ultimo.nombre_archivo}"),
                "autor": services.nombre(ultimo.autor),
                "propio": ultimo.autor_id == usuario.id,
                "fecha": ultimo.created_at,
            }
            if ultimo
            else None
        ),
    }


class ConversacionesView(APIView):
    """`GET`: mis conversaciones (lo más reciente primero). `POST`: un grupo."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        services.sincronizar(request.user)
        no_leidos = services.conteo_sin_leer(request.user)
        conversaciones = (
            Conversacion.objects.filter(participantes__usuario=request.user)
            .select_related("departamento")
            .order_by("-ultimo_mensaje_en", "-id")
        )
        filas = [resumen(c, request.user, no_leidos) for c in conversaciones]
        # El canal general, siempre arriba.
        filas.sort(key=lambda f: f["tipo"] != Tipo.GENERAL)
        return Response(filas)

    def post(self, request):
        entrada = GrupoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            conversacion = services.crear_grupo(
                request.user,
                nombre_grupo=datos["nombre"],
                participantes=datos.get("participantes", []),
                departamento=datos.get("departamento"),
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        return Response(resumen(conversacion, request.user, {}), status=status.HTTP_201_CREATED)


class DirectaView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        entrada = DirectaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            conversacion = services.directa(request.user, entrada.validated_data["usuario"])
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        return Response(resumen(conversacion, request.user, services.conteo_sin_leer(request.user)))


class ConversacionView(APIView):
    """`GET`: la conversación con sus miembros. `PATCH`: editar un grupo."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        conversacion = _conversacion(request, pk)
        datos = resumen(conversacion, request.user, services.conteo_sin_leer(request.user))
        datos["participantes"] = [
            {**persona_dict(p.usuario), "administra": p.administra}
            for p in conversacion.participantes.select_related("usuario__empleado__departamento")
        ]
        return Response(datos)

    def patch(self, request, pk):
        conversacion = _conversacion(request, pk)
        entrada = EditarGrupoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            services.editar_grupo(
                request.user,
                conversacion,
                nombre_grupo=datos.get("nombre"),
                agregar=datos.get("agregar", []),
                quitar=datos.get("quitar", []),
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        return self.get(request, pk)


class SalirView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        conversacion = _conversacion(request, pk)
        try:
            services.salir(request.user, conversacion)
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        return Response(status=status.HTTP_204_NO_CONTENT)


class MensajesView(APIView):
    """`GET`: los mensajes, de a 50 (`antes=<id>` para los anteriores).
    `POST`: enviar texto y, si se quiere, un archivo."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    POR_PAGINA = 50

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "chat"
            return [ScopedRateThrottle()]
        return []

    def get(self, request, pk):
        conversacion = _conversacion(request, pk)
        mensajes = services.visibles(request.user, conversacion).select_related("autor")
        antes = request.query_params.get("antes", "")
        if antes.isdigit():
            mensajes = mensajes.filter(id__lt=int(antes))
        pagina = list(mensajes.order_by("-id")[: self.POR_PAGINA + 1])
        hay_mas = len(pagina) > self.POR_PAGINA
        pagina = list(reversed(pagina[: self.POR_PAGINA]))
        lugar = conversacion.participantes.get(usuario=request.user)
        return Response(
            {
                "mensajes": [mensaje_dict(m, request.user) for m in pagina],
                "hay_mas": hay_mas,
                "ultimo_leido": lugar.ultimo_leido_id,
                "lecturas": services.lecturas(request.user, conversacion),
            }
        )

    def post(self, request, pk):
        conversacion = _conversacion(request, pk)
        entrada = MensajeSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        archivo = request.FILES.get("archivo")
        if archivo is not None:
            if archivo.size > TAMANO_MAXIMO_BYTES:
                # Se sugiere el correo, con las direcciones de quienes lo recibirían.
                correos = list(
                    conversacion.participantes.exclude(usuario=request.user)
                    .exclude(usuario__email="")
                    .values_list("usuario__email", flat=True)[:20]
                )
                raise ArchivoGrande(
                    {
                        "archivo": [
                            f"El archivo pesa {archivo.size / (1024 * 1024):.1f} MB y el máximo "
                            f"es {TAMANO_MAXIMO_BYTES // (1024 * 1024)} MB. Envíelo por correo."
                        ],
                        "correos": correos,
                        "limite_mb": TAMANO_MAXIMO_BYTES // (1024 * 1024),
                    }
                )
            validar_archivo(archivo)
        try:
            mensaje = services.enviar(
                request.user,
                conversacion,
                texto=entrada.validated_data.get("texto", ""),
                archivo=archivo,
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        return Response(
            {**mensaje_dict(mensaje, request.user), "avisos": _avisos(conversacion, request.user)},
            status=status.HTTP_201_CREATED,
        )


class LeerView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        conversacion = _conversacion(request, pk)
        entrada = LeerSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        ultimo = services.marcar_leido(
            request.user, conversacion, entrada.validated_data.get("hasta")
        )
        return Response({"ultimo_leido": ultimo})


class LecturasView(APIView):
    """`GET`: hasta dónde leyó cada una de las demás personas, para la
    confirmación de lectura de los mensajes propios (22/10/2026)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        conversacion = _conversacion(request, pk)
        return Response(services.lecturas(request.user, conversacion))


class NovedadesView(APIView):
    """Lo que consulta la pantalla cada pocos segundos: los mensajes nuevos de
    mis conversaciones desde `desde` y cuántos tengo sin leer. Sin `desde`
    devuelve solo el punto de partida, para no traer todo el historial."""

    permission_classes = [IsAuthenticated]
    # Su propio límite: no gasta el general de la persona (ver «sondeo»).
    throttle_scope = "sondeo"
    throttle_classes = [ScopedRateThrottle]

    def get(self, request):
        desde = request.query_params.get("desde", "")
        no_leidos = services.conteo_sin_leer(request.user)
        if not desde.isdigit():
            return Response(
                {
                    "cursor": services.cursor_actual(request.user),
                    "mensajes": [],
                    "no_leidos": no_leidos,
                    "total_no_leidos": sum(no_leidos.values()),
                }
            )
        mensajes = list(services.novedades(request.user, int(desde)))
        return Response(
            {
                "cursor": mensajes[-1].id if mensajes else int(desde),
                "mensajes": [
                    {**mensaje_dict(m, request.user), "conversacion_tipo": m.conversacion.tipo}
                    for m in mensajes
                ],
                "no_leidos": no_leidos,
                "total_no_leidos": sum(no_leidos.values()),
            }
        )


class PresenciaView(APIView):
    """`GET ?ids=1,2,3`: si cada persona está en línea y cuándo se conectó por
    última vez (ver `presencia.py`). Solo de personas de la empresa activa."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        pedidos = [p for p in request.query_params.get("ids", "").split(",") if p.isdigit()]
        de_la_empresa = set(
            services.personas_de_la_empresa().filter(pk__in=pedidos).values_list("pk", flat=True)
        )
        return Response({str(pk): estado for pk, estado in presencia.de(de_la_empresa).items()})


class DirectorioView(APIView):
    """Las personas de la empresa, para empezar un chat o armar un grupo."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        personas = services.buscar_personas(request.query_params.get("q", ""))
        return Response([persona_dict(p) for p in personas if p.pk != request.user.pk])


class AreasView(APIView):
    """Las áreas, para crear un grupo por área (con su permiso)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not user_has_permission(request.user, "chat.grupos_por_area"):
            return Response([])
        return Response(
            [
                {"id": d.id, "nombre": d.nombre}
                for d in Departamento.objects.filter(activo=True).order_by("nombre")
            ]
        )


class ArchivoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        mensaje = get_object_or_404(Mensaje.objects.select_related("conversacion"), pk=pk)
        services.participacion(request.user, mensaje.conversacion)
        if not mensaje.archivo or mensaje.created_at < services.ventana(request.user):
            raise serializers.ValidationError("El archivo ya no está disponible.")
        respuesta = FileResponse(
            mensaje.archivo.open("rb"),
            as_attachment=not mensaje.es_imagen,
            filename=mensaje.nombre_archivo,
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


#: En grupos más grandes no se avisa de cada estado: sería ruido.
AVISOS_HASTA = 25


def _avisos(conversacion, autor) -> list[dict]:
    """Al enviar: quiénes de la conversación están en almuerzo, de vacaciones,
    en reunión o no disponibles (o saldrán pronto de vacaciones), para
    decírselo a quien escribe. No en el canal general."""
    if conversacion.tipo == Conversacion.Tipo.GENERAL:
        return []
    ids = list(
        conversacion.participantes.exclude(usuario=autor).values_list("usuario_id", flat=True)[
            : AVISOS_HASTA + 1
        ]
    )
    if len(ids) > AVISOS_HASTA:
        return []
    vigentes = {pk: e for pk, e in estados.de(ids).items() if e}
    if not vigentes:
        return []
    from apps.users.models import User

    nombres = {u.pk: services.nombre(u) for u in User.objects.filter(pk__in=vigentes)}
    return [
        {"usuario": pk, "nombre": nombres.get(pk, ""), **vigentes[pk]}
        for pk in sorted(vigentes, key=lambda pk: nombres.get(pk, ""))
    ]


class _MiEstado(serializers.Serializer):
    estado = serializers.ChoiceField(choices=EstadoChat.Estado.choices, required=False)
    mensaje = serializers.CharField(max_length=140, required=False, allow_blank=True)
    hasta = serializers.DateTimeField(required=False, allow_null=True)
    vacaciones_desde = serializers.DateField(required=False, allow_null=True)
    vacaciones_hasta = serializers.DateField(required=False, allow_null=True)
    quitar_vacaciones = serializers.BooleanField(required=False)
    almuerzo_inicio = serializers.TimeField(required=False, allow_null=True)
    almuerzo_minutos = serializers.IntegerField(required=False)


class MiEstadoView(APIView):
    """Mi estado en el chat (22/10/2026): `GET` lo actual, con las fechas de
    vacaciones que se proponen; `PUT` lo cambia (ver `estados.py`)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(estados.mio(request.user))

    def put(self, request):
        entrada = _MiEstado(data=request.data)
        entrada.is_valid(raise_exception=True)
        return Response(estados.guardar(request.user, entrada.validated_data))
