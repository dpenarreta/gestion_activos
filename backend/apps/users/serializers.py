from django.contrib.auth.models import Group, Permission
from django.contrib.auth.password_validation import validate_password
from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from apps.empresas.models import Empresa
from apps.empresas.serializers import MembresiaSerializer
from apps.permissions.authorization import get_user_permission_codenames
from apps.permissions.catalog import all_codenames
from apps.permissions.models import ModulePermission

from .models import User
from .validators import validate_unique_email, validate_unique_username


def _module_permission_content_type() -> ContentType:
    return ContentType.objects.get_for_model(ModulePermission)


class UserPublicSerializer(serializers.ModelSerializer):
    """Representación segura del usuario (sin password ni campos sensibles)."""

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "date_joined",
            "must_change_password",
        ]
        read_only_fields = fields


class _UserRefSerializer(serializers.ModelSerializer):
    """Referencia mínima a un usuario (para created_by/updated_by), evita
    serializar el objeto completo y cualquier recursión sobre `User`."""

    class Meta:
        model = User
        fields = ["id", "username"]
        read_only_fields = fields


class UserAdminListSerializer(serializers.ModelSerializer):
    """Representación de usuario para el listado administrativo."""

    roles = serializers.SerializerMethodField()
    #: En qué empresas trabaja. Va en el listado y no solo en el detalle
    #: porque revisar accesos es justamente recorrer la lista buscando a quién
    #: le sobra una empresa, y abrir ficha por ficha lo vuelve impracticable.
    empresas = MembresiaSerializer(source="membresias", many=True, read_only=True)
    created_by = _UserRefSerializer(read_only=True)
    updated_by = _UserRefSerializer(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "status",
            "is_active",
            "is_superuser",
            "must_change_password",
            "created_at",
            "updated_at",
            "last_login",
            "roles",
            "empresas",
            "created_by",
            "updated_by",
        ]
        read_only_fields = fields

    def get_roles(self, obj: User) -> list[dict]:
        return [{"id": group.id, "name": group.name} for group in obj.groups.all()]


class UserAdminDetailSerializer(UserAdminListSerializer):
    """Detalle de usuario: además del listado, incluye permisos efectivos y
    los asignados individualmente (fuera de los heredados por rol)."""

    permissions = serializers.SerializerMethodField()
    direct_permissions = serializers.SerializerMethodField()

    class Meta(UserAdminListSerializer.Meta):
        fields = UserAdminListSerializer.Meta.fields + ["permissions", "direct_permissions"]

    def get_permissions(self, obj: User) -> list[str]:
        return sorted(get_user_permission_codenames(obj))

    def get_direct_permissions(self, obj: User) -> list[str]:
        return sorted(
            obj.user_permissions.filter(content_type=_module_permission_content_type()).values_list(
                "codename", flat=True
            )
        )


class UserAdminCreateSerializer(serializers.Serializer):
    """Valida la creación administrativa de un usuario (sin autenticarlo ni
    emitir tokens — a diferencia del registro público)."""

    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role_ids = serializers.ListField(child=serializers.IntegerField(), required=False)

    def validate_username(self, value):
        return validate_unique_username(value)

    def validate_email(self, value):
        return validate_unique_email(value)

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_role_ids(self, value):
        found = set(Group.objects.filter(id__in=value).values_list("id", flat=True))
        missing = set(value) - found
        if missing:
            raise serializers.ValidationError(f"Roles inexistentes: {sorted(missing)}.")
        return value


class UserAdminUpdateSerializer(serializers.Serializer):
    """Edición administrativa: solo datos de perfil. Los cambios de estado
    (habilitar/deshabilitar/bloquear) y de roles/permisos tienen sus propios
    endpoints, para que la auditoría registre la acción de negocio real en
    vez de un genérico "campo modificado"."""

    username = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_username(self, value):
        return validate_unique_username(value, exclude_user_id=self.instance.id)

    def validate_email(self, value):
        return validate_unique_email(value, exclude_user_id=self.instance.id)


class RoleAssignmentSerializer(serializers.Serializer):
    role_ids = serializers.ListField(child=serializers.IntegerField())

    def validate_role_ids(self, value):
        found = set(Group.objects.filter(id__in=value).values_list("id", flat=True))
        missing = set(value) - found
        if missing:
            raise serializers.ValidationError(f"Roles inexistentes: {sorted(missing)}.")
        return value


class PermissionAssignmentSerializer(serializers.Serializer):
    """`permission_codenames` usa la convención del catálogo (ver
    apps.permissions.catalog), ej. `usuarios.editar`."""

    permission_codenames = serializers.ListField(child=serializers.CharField())

    def validate_permission_codenames(self, value):
        missing = [entry for entry in value if entry not in all_codenames()]
        if missing:
            raise serializers.ValidationError(f"Permisos inexistentes: {missing}.")
        return list(
            Permission.objects.filter(
                content_type=_module_permission_content_type(), codename__in=value
            )
        )


class EmpresaAssignmentSerializer(serializers.Serializer):
    """Reemplaza la lista completa de empresas de un usuario.

    `empresa_predeterminada` es opcional: si no se indica, el servicio toma la
    primera por nombre. Lo que no se admite es una predeterminada fuera de la
    lista —sería entrar cada día en una empresa que no se puede ver—.
    """

    empresa_ids = serializers.ListField(child=serializers.IntegerField())
    empresa_predeterminada = serializers.IntegerField(required=False, allow_null=True)

    def validate_empresa_ids(self, value):
        encontradas = set(Empresa.objects.filter(id__in=value).values_list("id", flat=True))
        faltantes = set(value) - encontradas
        if faltantes:
            raise serializers.ValidationError(f"Empresas inexistentes: {sorted(faltantes)}.")
        return list(dict.fromkeys(value))
