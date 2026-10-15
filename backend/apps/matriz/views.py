from django.db.models.deletion import ProtectedError
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.empresas.servicios import empresas_de

from .acceso import capacidades_en
from .models import Area, EntidadControl
from .permissions import CatalogosPermission
from .serializers import AreaSerializer, EntidadControlSerializer

MODULO = "matriz"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def mis_empresas(request):
    """Las empresas donde la cuenta puede entrar a la Matriz, con su rol y lo
    que puede hacer en cada una (§14.1, `companies/mine/`).

    Solo las que dan alguna capacidad: una membresía sin rol de la Matriz deja
    entrar al inventario, pero no a este módulo.
    """
    membresias = {m.empresa_id: m for m in request.user.membresias.prefetch_related("roles")}
    resultado = []
    for empresa in empresas_de(request.user):
        capacidades = capacidades_en(request.user, empresa)
        if not capacidades:
            continue
        membresia = membresias.get(empresa.id)
        roles = [
            rol.name
            for rol in (membresia.roles.all() if membresia else [])
            if rol.permissions.filter(codename__startswith="matriz.").exists()
        ]
        if not roles and request.user.is_superuser:
            roles = ["Superusuario"]
        resultado.append(
            {
                "id": empresa.id,
                "nombre": empresa.nombre,
                "codigo": empresa.codigo,
                "color": empresa.color,
                "zona_horaria": empresa.zona_horaria,
                "roles": roles,
                "capacidades": capacidades,
            }
        )
    return Response({"empresas": resultado})


class _CatalogoViewSet(viewsets.ModelViewSet):
    """Áreas y entidades de control (§14.6).

    Se pueden eliminar —son catálogos, no registros con historia—, salvo que
    alguna obligación las use: la relación será `PROTECT` y el intento responde
    409 en vez de dejar obligaciones huérfanas.
    """

    permission_classes = [IsAuthenticated, CatalogosPermission]
    pagination_class = None
    accion = ""

    def _auditar(self, accion, instancia, anteriores=None, nuevos=None, **objetivo):
        record_audit_event(
            actor=self.request.user,
            action=f"{self.accion}.{accion}",
            target=instancia,
            module=MODULO,
            previous_values=anteriores,
            new_values=nuevos,
            context=get_request_context(self.request),
            **objetivo,
        )

    def perform_create(self, serializer):
        instancia = serializer.save()
        self._auditar("created", instancia, nuevos=serializer.data)

    def perform_update(self, serializer):
        anteriores = self.get_serializer(serializer.instance).data
        instancia = serializer.save()
        self._auditar("updated", instancia, anteriores=anteriores, nuevos=serializer.data)

    def destroy(self, request, *args, **kwargs):
        instancia = self.get_object()
        datos = self.get_serializer(instancia).data
        tipo, ident = instancia.__class__.__name__.lower(), instancia.pk
        try:
            instancia.delete()
        except ProtectedError:
            return Response(
                {
                    "error": {
                        "code": "en_uso",
                        "message": "No se puede eliminar: hay obligaciones que lo usan.",
                        "details": None,
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )
        self._auditar("deleted", None, anteriores=datos, target_type=tipo, target_id=ident)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AreaViewSet(_CatalogoViewSet):
    queryset = Area.objects.all()
    serializer_class = AreaSerializer
    accion = "matriz.area"


class EntidadControlViewSet(_CatalogoViewSet):
    queryset = EntidadControl.objects.all()
    serializer_class = EntidadControlSerializer
    accion = "matriz.entidad_control"
