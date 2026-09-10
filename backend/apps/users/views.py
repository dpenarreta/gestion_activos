from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.authentication.models import Session
from apps.authentication.serializers import AdminPasswordResetSerializer, SessionSerializer
from apps.authentication.services import PasswordResetService
from apps.core.request_meta import get_request_context
from apps.empresas.permissions import EmpresasAsignarPermission
from apps.empresas.servicios import asignar_empresas
from apps.permissions.authorization import user_has_permission

from .filters import filter_users
from .models import User
from .pagination import UserAdminPagination
from .permissions import (
    UsuariosCreatePermission,
    UsuariosDeshabilitarPermission,
    UsuariosPermission,
    UsuariosRestablecerPasswordPermission,
)
from .serializers import (
    EmpresaAssignmentSerializer,
    PermissionAssignmentSerializer,
    RoleAssignmentSerializer,
    UserAdminCreateSerializer,
    UserAdminDetailSerializer,
    UserAdminListSerializer,
    UserAdminUpdateSerializer,
)
from .services import UserAdminService


class UserAdminViewSet(viewsets.ModelViewSet):
    """Módulo administrativo de usuarios. Sin `destroy`: la eliminación
    física está deshabilitada a propósito — solo desactivación lógica vía
    `disable`/`block` (AC: preferir baja lógica a eliminación física cuando
    sea más seguro).

    Cada acción exige un permiso distinto del catálogo (`usuarios.ver` /
    `usuarios.crear` / `usuarios.editar` / `usuarios.deshabilitar` /
    `usuarios.restablecer_password`).
    """

    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = UserAdminPagination
    # `membresias__empresa` se precarga porque el listado pinta en qué
    # empresas trabaja cada cuenta: sin esto son dos consultas por fila.
    queryset = (
        User.objects.all()
        .prefetch_related("membresias__empresa", "membresias__roles")
        .order_by("-created_at")
    )

    ACTION_PERMISSION_CLASSES = {
        "create": [IsAuthenticated, UsuariosCreatePermission],
        # Repartir empresas es dar acceso a información, no editar un
        # perfil: lo gobierna el catálogo de empresas, no el de usuarios.
        "empresas": [IsAuthenticated, EmpresasAsignarPermission],
        "enable": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "disable": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "block": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "unblock": [IsAuthenticated, UsuariosDeshabilitarPermission],
        "reset_password": [IsAuthenticated, UsuariosRestablecerPasswordPermission],
    }
    DEFAULT_PERMISSION_CLASSES = [IsAuthenticated, UsuariosPermission]

    def get_permissions(self):
        permission_classes = self.ACTION_PERMISSION_CLASSES.get(
            self.action, self.DEFAULT_PERMISSION_CLASSES
        )
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        return filter_users(
            self._del_ambito_visible(super().get_queryset()), self.request.query_params
        )

    def _del_ambito_visible(self, queryset):
        """Solo las cuentas que comparten empresa con quien consulta.

        `User` es global —una persona es la misma en todas las empresas a las
        que entra— pero eso no significa que un administrador de una deba ver
        los nombres y correos del personal de la otra. El superusuario sí las ve
        todas: es la cuenta de emergencia.

        Las cuentas **sin ninguna empresa** también se ven, y eso no es una
        excepción cómoda: quien no pertenece a ninguna no es de nadie, así que
        mostrarla no cruza ningún límite, y esconderla la volvería
        inadministrable —para asignarle una empresa hay que poder abrirla
        primero—. Es además la que trabaja en la única empresa existente
        mientras solo haya una, por la misma regla que aplica `empresas_de`.

        Se acota el conjunto de trabajo entero y no solo el listado: si el
        detalle no filtrara, bastaría con teclear un id para abrir la ficha de
        alguien de la otra compañía.
        """
        from django.db.models import Q

        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        if self.request.user.is_superuser:
            return queryset

        empresa = empresa_actual()
        if empresa is None:
            return queryset
        if empresa is SIN_EMPRESA:
            return queryset.none()

        return queryset.filter(
            Q(membresias__empresa=empresa) | Q(membresias__isnull=True)
        ).distinct()

    def get_serializer_class(self):
        if self.action == "list":
            return UserAdminListSerializer
        if self.action == "create":
            return UserAdminCreateSerializer
        if self.action == "partial_update":
            return UserAdminUpdateSerializer
        return UserAdminDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = serializer.validated_data
        # Crear una cuenta y darle acceso a una empresa son dos poderes
        # distintos: quien solo tiene el primero puede dar de alta a alguien,
        # pero no decidir qué información va a ver.
        if datos.get("empresas") and not user_has_permission(request.user, "empresas.asignar"):
            raise PermissionDenied("No tiene el permiso requerido: empresas.asignar.")
        try:
            user = UserAdminService.create_user(
                actor=request.user, context=get_request_context(request), **datos
            )
        except (PermissionError, ValueError) as error:
            raise ValidationError({"empresas": [str(error)]}) from error
        return Response(UserAdminDetailSerializer(user).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = UserAdminService.update_user(
            actor=request.user,
            user=instance,
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None):
        user = UserAdminService.enable(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def disable(self, request, pk=None):
        user = UserAdminService.disable(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def block(self, request, pk=None):
        user = UserAdminService.block(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def unblock(self, request, pk=None):
        user = UserAdminService.unblock(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["get"], url_path="sessions")
    def list_sessions(self, request, pk=None):
        sessions = Session.objects.filter(user=self.get_object(), revoked_at__isnull=True).order_by(
            "-last_used_at"
        )
        return Response(SessionSerializer(sessions, many=True).data)

    @action(detail=True, methods=["post"], url_path="sessions/revoke")
    def revoke_sessions(self, request, pk=None):
        revoked_count = UserAdminService.revoke_sessions(
            actor=request.user, user=self.get_object(), context=get_request_context(request)
        )
        return Response({"revoked_count": revoked_count})

    @action(detail=True, methods=["post"], url_path="password-reset")
    def reset_password(self, request, pk=None):
        serializer = AdminPasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        PasswordResetService.admin_initiate_reset(
            actor=request.user,
            user=self.get_object(),
            context=get_request_context(request),
            **serializer.validated_data,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def roles(self, request, pk=None):
        serializer = RoleAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserAdminService.assign_roles(
            actor=request.user,
            user=self.get_object(),
            role_ids=serializer.validated_data["role_ids"],
            context=get_request_context(request),
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def permissions(self, request, pk=None):
        serializer = PermissionAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserAdminService.assign_permissions(
            actor=request.user,
            user=self.get_object(),
            permissions=serializer.validated_data["permission_codenames"],
            context=get_request_context(request),
        )
        return Response(UserAdminDetailSerializer(user).data)

    @action(detail=True, methods=["post"])
    def empresas(self, request, pk=None):
        serializer = EmpresaAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = asignar_empresas(
                actor=request.user,
                usuario=self.get_object(),
                asignaciones=serializer.validated_data["empresas"],
                context=get_request_context(request),
            )
        except PermissionError as error:
            raise ValidationError({"empresas": [str(error)]}) from error
        except ValueError as error:
            raise ValidationError({"empresas": [str(error)]}) from error
        # Se relee: el usuario se cargó con las membresías precargadas, así que
        # el objeto en memoria sigue teniendo las de antes del cambio.
        actualizado = User.objects.prefetch_related("membresias__empresa", "membresias__roles").get(
            pk=user.pk
        )
        return Response(UserAdminDetailSerializer(actualizado).data)
