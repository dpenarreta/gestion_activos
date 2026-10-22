from django.http import FileResponse, Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context

from . import services
from .models import Material
from .serializers import (
    AsignarSerializer,
    DevolverSerializer,
    MaterialSerializer,
    PreguntasSerializer,
    RespuestasSerializer,
)

MODULO = "capacitacion"


class GestionarPermission(BasePermission):
    def has_permission(self, request, view) -> bool:
        return services.gestiona(request.user)


class ResultadosPermission(BasePermission):
    def has_permission(self, request, view) -> bool:
        return services.ve_resultados(request.user)


def _auditar(request, accion, objetivo, datos=None):
    record_audit_event(
        actor=request.user,
        action=f"capacitacion.{accion}",
        target=objetivo,
        module=MODULO,
        new_values=datos or {},
        context=get_request_context(request),
    )


def _pdf(material):
    """El archivo del material (PDF o presentación), con su tipo."""
    from urllib.parse import quote

    if not material.archivo:
        raise Http404("El material no tiene archivo.")
    try:
        fichero = material.archivo.open("rb")
    except FileNotFoundError as error:
        raise Http404("El archivo ya no está disponible.") from error
    tipo = material.archivo_tipo or "application/octet-stream"
    respuesta = FileResponse(fichero, content_type=tipo)
    if tipo != "application/pdf":
        respuesta["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(material.archivo_nombre or 'material')}"
        )
    respuesta["X-Content-Type-Options"] = "nosniff"
    return respuesta


# --- Lo de cada persona ------------------------------------------------------------------


class MiOnboardingView(APIView):
    """Mi onboarding: el plan (empresa, área y cargo) con su avance."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(services.progreso(request.user))


class MiMaterialView(APIView):
    """Abrir un material del plan (queda visto), su archivo, su evaluación y
    responderla."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk, que):
        if que == "archivo":
            material = services.marcar_visto(request.user, pk)
            return _pdf(material)
        if que == "evaluacion":
            return Response(services.evaluacion(request.user, pk))
        raise Http404()

    def post(self, request, pk, que):
        if que == "visto":
            services.marcar_visto(request.user, pk)
            return Response({"visto": True})
        if que == "responder":
            entrada = RespuestasSerializer(data=request.data)
            entrada.is_valid(raise_exception=True)
            resultado = services.responder(
                request.user,
                pk,
                entrada.validated_data["respuestas"],
                tiempo_agotado=entrada.validated_data["tiempo_agotado"],
            )
            _auditar(
                request,
                "evaluacion.rendida",
                request.user,
                {
                    "material": int(pk),
                    "puntaje": resultado["puntaje"],
                    "aprobado": resultado["aprobado"],
                    "por_tiempo": resultado["por_tiempo"],
                },
            )
            return Response(resultado)
        if que == "borrador":
            entrada = RespuestasSerializer(data=request.data)
            entrada.is_valid(raise_exception=True)
            return Response(
                services.guardar_borrador(request.user, pk, entrada.validated_data["respuestas"])
            )
        raise Http404()


# --- Gestión de materiales ---------------------------------------------------------------


class MaterialViewSet(viewsets.ModelViewSet):
    """Los materiales y sus evaluaciones (`capacitacion.gestionar`)."""

    permission_classes = [IsAuthenticated, GestionarPermission]
    serializer_class = MaterialSerializer
    parser_classes = [JSONParser, MultiPartParser]
    pagination_class = None

    def get_queryset(self):
        return Material.objects.select_related("unidad", "cargo").order_by(
            "alcance", "orden", "titulo"
        )

    def perform_create(self, serializer):
        material = serializer.save()
        _auditar(self.request, "material.creado", material, {"titulo": material.titulo})

    def perform_update(self, serializer):
        material = serializer.save()
        _auditar(self.request, "material.editado", material, {"titulo": material.titulo})

    def perform_destroy(self, instance):
        if instance.intentos.exists():
            from rest_framework.exceptions import ValidationError

            raise ValidationError(
                {
                    "detail": "Ya hay evaluaciones rendidas de este material: desactívelo en vez de borrarlo."
                }
            )
        _auditar(self.request, "material.borrado", instance, {"titulo": instance.titulo})
        instance.delete()

    @action(detail=True, methods=["get", "put"])
    def preguntas(self, request, pk=None):
        material = self.get_object()
        if request.method == "PUT":
            entrada = PreguntasSerializer(data=request.data)
            entrada.is_valid(raise_exception=True)
            services.guardar_preguntas(material, entrada.validated_data["preguntas"])
            _auditar(
                request,
                "evaluacion.editada",
                material,
                {"preguntas": len(entrada.validated_data["preguntas"])},
            )
        return Response(services.preguntas_completas(material))

    @action(detail=True, methods=["get"])
    def archivo(self, request, pk=None):
        return _pdf(self.get_object())


# --- Resultados (Talento Humano) ---------------------------------------------------------


class ResultadosView(APIView):
    permission_classes = [IsAuthenticated, ResultadosPermission]

    def get(self, request):
        return Response({"personas": services.resultados(), "materiales": services.estadisticas()})


class AsignarView(APIView):
    """Asignar el onboarding a cuentas que ya existían."""

    permission_classes = [IsAuthenticated, ResultadosPermission]

    def get(self, request):
        from apps.chat.services import buscar_personas

        return Response(
            [
                {"id": u.id, "nombre": u.get_full_name().strip() or u.username, "correo": u.email}
                for u in buscar_personas(request.query_params.get("q", ""), limite=20)
            ]
        )

    def post(self, request):
        from apps.chat.services import personas_de_la_empresa

        entrada = AsignarSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        personas = list(personas_de_la_empresa().filter(pk__in=entrada.validated_data["usuarios"]))
        for persona in personas:
            services.asignar(persona, actor=request.user, dias=entrada.validated_data["dias"])
            _auditar(request, "onboarding.asignado", persona)
        return Response({"asignados": len(personas)}, status=status.HTTP_200_OK)


class DevolverIntentosView(APIView):
    permission_classes = [IsAuthenticated, ResultadosPermission]

    def post(self, request):
        entrada = DevolverSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        services.devolver_intentos(
            request.user, entrada.validated_data["usuario"], entrada.validated_data["material"]
        )
        _auditar(request, "intentos.devueltos", None, dict(entrada.validated_data))
        return Response({"devueltos": True})
