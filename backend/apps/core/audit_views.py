import csv
import io

from django.http import HttpResponse
from django.utils import timezone as django_timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import HasModulePermission

from .audit_filters import filter_audit_logs
from .hojas_de_calculo import neutralizar_fila
from .models import AuditLog
from .pagination import DefaultPagination

# Tope defensivo de filas exportadas en una sola llamada — evita que un
# volumen de auditoría muy grande degrade el request.
EXPORT_ROW_LIMIT = 5000


class AuditoriaPermission(HasModulePermission):
    view_permission = "auditoria.ver"
    write_permission = None  # solo lectura: el registro se crea internamente, nunca vía API


class AuditoriaExportarPermission(HasModulePermission):
    view_permission = "auditoria.exportar"
    write_permission = None


class AuditLogSerializer(serializers.ModelSerializer):
    """`previous_values`/`new_values` (el diff) y `location` se ocultan a
    nivel de campo si el usuario no tiene `auditoria.ver_detalle`/
    `auditoria.ver_ubicacion` respectivamente — la lista sigue siendo
    visible con solo `auditoria.ver`, pero sin esos dos campos."""

    actor_username = serializers.CharField(source="actor.username", default=None, read_only=True)
    created_at_local = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor",
            "actor_username",
            "action",
            "module",
            "target_type",
            "target_id",
            "result",
            "previous_values",
            "new_values",
            "ip_address",
            "browser",
            "operating_system",
            "device",
            "location",
            "correlation_id",
            "created_at",
            "created_at_local",
        ]
        read_only_fields = fields

    def get_created_at_local(self, obj: AuditLog) -> str:
        # La zona horaria ya resuelta server-side (settings.TIME_ZONE) —
        # el frontend nunca hace matemática de zonas horarias, solo pinta
        # este string.
        return django_timezone.localtime(obj.created_at).isoformat()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None

        if not user_has_permission(user, "auditoria.ver_detalle"):
            data.pop("previous_values", None)
            data.pop("new_values", None)

        if not user_has_permission(user, "auditoria.ver_ubicacion"):
            data.pop("location", None)

        return data


#: Módulos cuyos datos pertenecen a una empresa. Un evento suyo sin empresa es
#: un huérfano —el objeto que describía ya no existe— y no se le puede atribuir
#: dueño, así que no se muestra fuera del superusuario.
MODULOS_POR_EMPRESA = frozenset(
    {"activos", "organizacion", "mantenimientos", "politicas", "alertas", "adjuntos", "reportes"}
)


def _de_la_empresa_activa(queryset, usuario):
    """El historial de la empresa en la que se está trabajando.

    `AuditLog` no hereda de `ModeloDeEmpresa` —lleva su propia columna, que
    puede quedar nula— así que el filtro se escribe aquí, en el único sitio que
    lo expone.

    Un evento sin empresa puede ser de dos clases y se tratan distinto. Los de
    un módulo que no pertenece a ninguna empresa —iniciar sesión, administrar
    cuentas, cambiar el tema— siguen visibles: ocultarlos dejaría a quien revisa
    accesos sin ver quién entró. Los de un módulo que sí tiene dueño y aun así
    quedaron sin empresa son eventos cuyo objeto ya se eliminó, así que no hay a
    quién preguntar de quién eran: se ocultan, porque mostrarlos sería exponer
    el rastro de la otra compañía por la puerta de los registros huérfanos.
    """
    from django.db.models import Q

    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    if usuario is not None and usuario.is_superuser:
        return queryset

    empresa = empresa_actual()
    if empresa is None:
        return queryset
    if empresa is SIN_EMPRESA:
        return queryset.none()
    return queryset.filter(
        Q(empresa=empresa) | (Q(empresa__isnull=True) & ~Q(module__in=MODULOS_POR_EMPRESA))
    )


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Consulta de auditoría, de solo lectura — nunca se crea ni modifica
    vía API, solo internamente desde `apps.core.audit.record_audit_event`."""

    permission_classes = [IsAuthenticated, AuditoriaPermission]
    serializer_class = AuditLogSerializer
    pagination_class = DefaultPagination
    queryset = AuditLog.objects.all().order_by("-created_at")

    def get_queryset(self):
        return filter_audit_logs(
            _de_la_empresa_activa(super().get_queryset(), self.request.user),
            self.request.query_params,
        )

    @action(
        detail=False,
        methods=["get"],
        permission_classes=[IsAuthenticated, AuditoriaExportarPermission],
    )
    def export(self, request):
        queryset = filter_audit_logs(
            _de_la_empresa_activa(AuditLog.objects.all().order_by("-created_at"), request.user),
            request.query_params,
        )[:EXPORT_ROW_LIMIT]

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            ["id", "fecha", "usuario", "accion", "modulo", "entidad", "id_entidad", "resultado"]
        )
        for entry in queryset:
            writer.writerow(
                neutralizar_fila(
                    [
                        entry.id,
                        django_timezone.localtime(entry.created_at).isoformat(),
                        entry.actor.username if entry.actor else "",
                        entry.action,
                        entry.module,
                        entry.target_type,
                        entry.target_id,
                        entry.result,
                    ]
                )
            )

        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="audit_log.csv"'
        return response
