"""La API de solicitudes: lo que pedí, lo que me toca gestionar y su recorrido."""

from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as ErrorDeModelo
from django.db.models import Q
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context

from . import notificaciones
from .encargados import encargados_posibles
from .models import Solicitud
from .permissions import SolicitudesPermission
from .serializers import (
    CambioDeEstadoSerializer,
    EncargadoSerializer,
    SolicitudSerializer,
    SolicitudWriteSerializer,
)
from .services import SolicitudService, administra, puede_gestionarla

MODULO = "solicitudes"


class SolicitudViewSet(viewsets.ModelViewSet):
    """Peticiones de compra.

    Sin `DELETE`: una solicitud que ya no hace falta **se cancela**, y así
    queda escrito que se pidió y que se retiró. Borrarla haría desaparecer de
    los conteos lo que un área llegó a necesitar, que es medio motivo por el
    que este módulo existe.
    """

    permission_classes = [IsAuthenticated, SolicitudesPermission]
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        """Lo que cada quien puede ver, y el ámbito que pida la pantalla.

        Por defecto, lo propio: lo que pedí y lo que me asignaron. Quien
        administra compras ve todo, porque su trabajo es justamente que ninguna
        se quede parada en la bandeja de alguien que está de vacaciones.
        """
        usuario = self.request.user
        queryset = Solicitud.objects.select_related(
            "solicitante", "encargado", "tipo_dispositivo", "componente"
        )
        if self.action in {"retrieve", "partial_update"}:
            queryset = queryset.prefetch_related("movimientos__actor")

        ambito = self.request.query_params.get("ambito")
        if ambito == "mias":
            queryset = queryset.filter(solicitante=usuario)
        elif ambito == "recibidas":
            # Con permiso para administrarlas, la bandeja es la de todos: es lo
            # que permite ver la que nadie ha tocado en tres semanas.
            if not administra(usuario):
                queryset = queryset.filter(encargado=usuario)
        elif not administra(usuario):
            queryset = queryset.filter(Q(solicitante=usuario) | Q(encargado=usuario))

        estado = self.request.query_params.get("estado")
        if estado in Solicitud.Estado.values:
            queryset = queryset.filter(estado=estado)

        # «Lo que sigue vivo» es la pregunta de todos los días: una bandeja que
        # arrastra lo entregado hace seis meses deja de leerse.
        abiertas = self.request.query_params.get("abiertas")
        if abiertas == "true":
            queryset = queryset.exclude(estado__in=Solicitud.FINALES)
        elif abiertas == "false":
            queryset = queryset.filter(estado__in=Solicitud.FINALES)

        busqueda = self.request.query_params.get("q")
        if busqueda:
            termino = busqueda.strip()
            queryset = queryset.filter(
                Q(detalle__icontains=termino)
                | Q(justificacion__icontains=termino)
                | Q(tipo_dispositivo__nombre__icontains=termino)
                | Q(componente__nombre__icontains=termino)
                | Q(solicitante__first_name__icontains=termino)
                | Q(solicitante__last_name__icontains=termino)
                | Q(encargado__first_name__icontains=termino)
                | Q(encargado__last_name__icontains=termino)
            )
        return queryset

    def get_serializer_class(self):
        if self.action in {"create", "partial_update"}:
            return SolicitudWriteSerializer
        return SolicitudSerializer

    def create(self, request, *args, **kwargs):
        entrada = self.get_serializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            solicitud = SolicitudService.crear(actor=request.user, **entrada.validated_data)
        except ErrorDeModelo as error:
            raise serializers.ValidationError(self._como_errores(error)) from error

        aviso = notificaciones.al_recibirla(solicitud)
        self._auditar("solicitud.created", solicitud, SolicitudSerializer(solicitud).data)
        return Response(self._con_el_aviso(solicitud, aviso), status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        """Corregir lo que se pidió, mientras nadie la haya tomado.

        Solo el solicitante y solo en «pendiente»: cambiar qué se pide después
        de que alguien fue a cotizarlo le hace perder el trabajo hecho, y
        cambiarlo después de comprado reescribe una compra que ya ocurrió.
        """
        solicitud = self.get_object()
        if solicitud.solicitante_id != request.user.id:
            raise PermissionDenied("Una solicitud la corrige quien la pidió.")
        if solicitud.estado != Solicitud.Estado.PENDIENTE:
            raise serializers.ValidationError(
                {
                    "estado": (
                        f"La solicitud ya está {solicitud.get_estado_display().lower()}: "
                        "para cambiar lo que se pide, cancélela y haga una nueva."
                    )
                }
            )

        entrada = self.get_serializer(solicitud, data=request.data, partial=True)
        entrada.is_valid(raise_exception=True)
        anteriores = SolicitudSerializer(solicitud).data
        solicitud = entrada.save()
        try:
            solicitud.full_clean(exclude=["empresa"])
        except ErrorDeModelo as error:
            raise serializers.ValidationError(self._como_errores(error)) from error

        nuevos = SolicitudSerializer(solicitud).data
        cambios = {
            campo: valor for campo, valor in nuevos.items() if anteriores.get(campo) != valor
        }
        if cambios:
            self._auditar(
                "solicitud.updated",
                solicitud,
                cambios,
                previos={campo: anteriores.get(campo) for campo in cambios},
            )
        return Response(nuevos)

    @action(detail=True, methods=["post"], url_path="cambiar-estado")
    def cambiar_estado(self, request, pk=None):
        """Un paso del recorrido: tomarla, comprarla, entregarla, rechazarla o
        cancelarla."""
        solicitud = self.get_object()
        entrada = CambioDeEstadoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)

        anterior = solicitud.estado
        try:
            solicitud = SolicitudService.cambiar_estado(
                solicitud=solicitud,
                actor=request.user,
                estado=entrada.validated_data["estado"],
                nota=entrada.validated_data.get("nota", ""),
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(self._como_errores(error)) from error

        aviso = None
        # A quien pidió se le avisa de lo que le pasa a lo suyo; avisarle de su
        # propia cancelación sería contarle lo que acaba de hacer.
        if solicitud.solicitante_id != request.user.id:
            aviso = notificaciones.al_cambiar_de_estado(
                solicitud, entrada.validated_data.get("nota", "")
            )

        self._auditar(
            "solicitud.estado_changed",
            solicitud,
            {"estado": solicitud.estado, "nota": entrada.validated_data.get("nota", "")},
            previos={"estado": anterior},
        )
        return Response(self._con_el_aviso(solicitud, aviso))

    @action(detail=False, methods=["get"])
    def catalogo(self, request):
        """Lo que se puede elegir al pedir: tipos de equipo y componentes.

        Va por aquí y no por los endpoints del inventario a propósito: quien
        solo pide no tiene —ni debería tener— permiso para ver el parque ni el
        catálogo de repuestos, y sin esto el desplegable le llegaría vacío por
        un 403 que nadie ve.

        Cada tipo trae **sus características declaradas**, que es con lo que se
        describe lo que se pide: «una laptop» y «una laptop con 32 GB y disco
        NVMe» son dos compras distintas. Viajan aquí y no en una consulta por
        tipo porque son pocas y se necesitan justo al cambiar el desplegable:
        una petición por cada cambio dejaría el formulario parpadeando.
        """
        from apps.activos.especificaciones import declaradas_de
        from apps.activos.models import TipoDispositivo
        from apps.mantenimientos.models import CatalogoComponente

        from .serializers import CaracteristicaParaPedirSerializer

        tipos = [
            {
                "id": tipo.id,
                "nombre": tipo.nombre,
                "caracteristicas": CaracteristicaParaPedirSerializer(
                    declaradas_de(tipo), many=True
                ).data,
            }
            for tipo in TipoDispositivo.objects.filter(activo=True).order_by("nombre")
        ]
        componentes = [
            {"id": fila.id, "nombre": fila.nombre}
            for fila in CatalogoComponente.objects.filter(activo=True).order_by("nombre")
        ]
        return Response({"tipos_dispositivo": tipos, "componentes": componentes})

    @action(detail=False, methods=["get"])
    def encargados(self, request):
        """A quién se le puede asignar una solicitud en esta empresa."""
        return Response(EncargadoSerializer(encargados_posibles(), many=True).data)

    def _con_el_aviso(self, solicitud, aviso) -> dict:
        """La solicitud y, si hubo correo, a quién se avisó.

        Se dice en la misma respuesta para poder mostrarlo: que el encargado no
        tenga correo en su cuenta es algo que quien pide debe saber en el acto,
        no cuando pregunte por qué nadie atendió su solicitud.
        """
        datos = SolicitudSerializer(solicitud).data
        if aviso is not None:
            datos["aviso"] = {
                "enviado_a": len(aviso.direcciones),
                "sin_correo": aviso.sin_correo,
            }
        return datos

    @staticmethod
    def _como_errores(error) -> dict | list:
        return error.message_dict if hasattr(error, "message_dict") else error.messages

    def _auditar(self, accion, solicitud, nuevos, previos=None):
        record_audit_event(
            actor=self.request.user,
            action=accion,
            target=solicitud,
            module=MODULO,
            previous_values=previos,
            new_values=nuevos,
            context=get_request_context(self.request),
        )

    def get_object(self):
        """La ficha, con la comprobación de quién puede verla.

        El queryset ya filtra por ámbito, así que una solicitud ajena devuelve
        404 y no 403: quien no participa en ella no tiene por qué enterarse de
        que existe.
        """
        solicitud = super().get_object()
        if self.action == "cambiar_estado":
            # Se comprueba aquí además de en el servicio para que el 403 salga
            # antes de tocar nada; el servicio sigue siendo el que manda,
            # porque también se le llama desde fuera de una petición.
            usuario = self.request.user
            if solicitud.solicitante_id != usuario.id and not puede_gestionarla(usuario, solicitud):
                raise PermissionDenied("Esta solicitud no es suya ni la tiene asignada.")
        return solicitud
