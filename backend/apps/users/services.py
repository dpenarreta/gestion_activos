"""Lógica de negocio del módulo administrativo de usuarios.

Las vistas (controladores) delegan aquí — nunca acceden al ORM ni aplican
reglas de negocio directamente.
"""

import logging

from django.contrib.auth.models import Group, Permission
from rest_framework import serializers

from apps.authentication.services import AuthenticationService, SessionService
from apps.core.audit import record_audit_event
from apps.permissions.authorization import permisos_que_no_tiene

from .models import User
from .nomenclatura import generar_username

logger = logging.getLogger(__name__)


# AC-038: el sistema nunca debe quedar sin al menos un administrador activo
# (definido como `is_superuser=True` — el único bypass real de autorización,
# ver `apps.permissions.authorization.user_has_permission`).
def _vigilando_gestores(cambio):
    """La regla del último gestor de la Matriz (§8.9), como error del formulario."""
    from apps.empresas.servicios import EmpresaSinGestor, sin_dejar_empresas_sin_gestor

    try:
        return sin_dejar_empresas_sin_gestor(cambio)
    except EmpresaSinGestor as error:
        raise serializers.ValidationError({"detail": str(error)}) from error


def _roles_sin_alcance(actor: User, groups) -> None:
    """Nadie reparte lo que no tiene, tampoco envuelto en un rol.

    `assign_permissions` y `RoleService._comprobar_alcance` ya lo exigían permiso
    por permiso; dar un rol entero sin mirar qué trae era la puerta de al lado:
    con solo `usuarios.editar` uno se ponía el rol de administrador
    (auditoría de seguridad, 29/10/2026).
    """
    codenames = {perm.codename for group in groups for perm in group.permissions.all()}
    faltantes = permisos_que_no_tiene(actor, codenames)
    if faltantes:
        raise serializers.ValidationError(
            {
                "role_ids": [
                    "No puede conceder permisos que usted no tiene: " + ", ".join(faltantes) + "."
                ]
            }
        )


CUENTA_FUERA_DE_ALCANCE = (
    "Solo un superusuario puede modificar esta cuenta: tiene más permisos que usted."
)


def exigir_alcance_sobre(actor: User, user: User) -> None:
    """Solo se administra una cuenta que no tenga más poder que quien la toca.

    Cambiarle el correo, restablecerle la contraseña, deshabilitarla o cerrarle
    las sesiones a un superusuario (o a quien tenga permisos que el actor no
    tiene) es la forma de quedarse con su cuenta o de dejar el sistema sin
    administrador: eso queda para otro superusuario (auditoría de seguridad,
    29/10/2026). Sobre la propia cuenta no aplica: nadie tiene más que uno mismo.
    """
    from rest_framework.exceptions import PermissionDenied

    from apps.permissions.authorization import get_user_permission_codenames

    if actor is None or actor.is_superuser or actor.pk == user.pk:
        return
    if user.is_superuser or permisos_que_no_tiene(actor, get_user_permission_codenames(user)):
        raise PermissionDenied(CUENTA_FUERA_DE_ALCANCE)


def exigir_alcance_en_todas_sus_empresas(actor: User, user: User) -> None:
    """`exigir_alcance_sobre`, pero en **cada** empresa del objetivo (US-015,
    QA-TECH, 13/11/2026).

    Los roles cuelgan de la membresía: Ana puede ser básica en A y
    Administradora en B. Mirar solo la empresa activa dejaba al administrador
    de A cambiarle la contraseña a Ana y entrar con ella a B como
    Administrador, una escalada entre empresas. Por eso, para tocar las
    credenciales de una cuenta, el actor tiene que estar en cada empresa del
    objetivo y no tener allí menos permisos que él; los dos se evalúan dentro
    de esa empresa (`usando_empresa`). Cuentan todas sus membresías, también
    las de una empresa inactiva: reactivarla devolvería esos permisos.

    Se salta con una sola empresa (no hay entre qué escalar: queda la regla de
    la empresa activa, como antes) y para el superusuario. Sobre la propia
    cuenta no decide: eso lo resuelve quien llama.
    """
    from rest_framework.exceptions import PermissionDenied

    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa, MembresiaEmpresa
    from apps.permissions.authorization import get_user_permission_codenames

    exigir_alcance_sobre(actor, user)
    if actor is None or actor.is_superuser or actor.pk == user.pk:
        return
    if Empresa.objects.count() <= 1:
        return

    empresas_del_objetivo = list(
        Empresa.objects.filter(membresias__usuario=user).distinct().order_by("pk")
    )
    del_actor = set(
        MembresiaEmpresa.objects.filter(usuario=actor).values_list("empresa_id", flat=True)
    )
    for empresa in empresas_del_objetivo:
        if empresa.pk not in del_actor:
            raise PermissionDenied(CUENTA_FUERA_DE_ALCANCE)
        with usando_empresa(empresa):
            if permisos_que_no_tiene(actor, get_user_permission_codenames(user)):
                raise PermissionDenied(CUENTA_FUERA_DE_ALCANCE)


LAST_ACTIVE_ADMIN_ERROR = (
    "No es posible deshabilitar/bloquear a este usuario: es el único "
    "administrador activo del sistema."
)


class UserAdminService:
    """Toda operación queda auditada (`apps.core.audit.record_audit_event`) y
    las que deban invalidar sesiones activas (deshabilitar, bloquear) lo
    hacen a través de `status`, que ya dispara la señal existente
    `apps.users.signals.revoke_sessions_when_user_disabled`."""

    @staticmethod
    def create_user(
        *,
        actor: User,
        email: str,
        password: str = "",
        first_name: str = "",
        last_name: str = "",
        codigo_empleado: str | None = None,
        role_ids: list[int] | None = None,
        empresas: list[dict] | None = None,
        context: dict | None = None,
    ) -> User:
        """Crea la cuenta y, si se indica, la deja ya dentro de sus empresas.

        La empresa y el rol van en el alta y no en un segundo paso porque una
        cuenta sin ninguna de las dos no puede hacer nada: quien entrara así
        vería un sistema vacío y llamaría a soporte. Separarlos garantiza que
        alguna se quede a medias el día que a alguien lo interrumpan entre un
        paso y el otro.

        El nombre de usuario no se recibe: se deriva del nombre de la persona
        (ver `apps.users.nomenclatura`).

        Sin contraseña, la cuenta nace con la clave temporal
        (`CLAVE_INICIAL_USUARIOS`, del .env); si tampoco hay clave temporal,
        sin contraseña utilizable. Toda cuenta nueva queda obligada a cambiar
        su contraseña en el primer inicio de sesión (26/10/2026).
        """
        from apps.authentication.validators import clave_temporal

        # Los roles se comprueban antes de crear nada: si no se pueden dar, la
        # cuenta no debe quedar creada a medias.
        groups = (
            list(Group.objects.filter(id__in=role_ids, cargo_organigrama__isnull=True))
            if role_ids
            else []
        )
        _roles_sin_alcance(actor, groups)
        password = password or clave_temporal()
        if codigo_empleado:
            from rest_framework.exceptions import PermissionDenied

            from apps.permissions.authorization import user_has_permission

            # Como al editar: el código lo pone nómina (22/10/2026).
            if not user_has_permission(actor, "roles_pago.habilitar"):
                raise PermissionDenied(
                    "El código de empleado lo asigna quien habilita el rol de pagos "
                    "(roles_pago.habilitar)."
                )
        username = generar_username(first_name, last_name)
        user = AuthenticationService.register_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )
        user.created_by = actor
        user.updated_by = actor
        user.codigo_empleado = codigo_empleado or None
        user.must_change_password = True
        if not password:
            user.set_unusable_password()
        user.save(
            update_fields=[
                "created_by",
                "updated_by",
                "codigo_empleado",
                "must_change_password",
                "password",
            ]
        )

        if role_ids:
            # Los roles de cargo del organigrama no son globales: van por empresa.
            user.groups.set(groups)

        record_audit_event(
            actor=actor,
            action="user.created",
            target=user,
            module="usuarios",
            new_values={"username": username, "email": email, "role_ids": role_ids or []},
            context=context,
        )

        # Después del alta y con su propio evento de auditoría: son dos hechos
        # distintos —se creó la cuenta, se le dio acceso a estas empresas— y
        # quien revise el historial busca cada uno por su lado.
        if empresas:
            from apps.empresas.servicios import asignar_empresas

            asignar_empresas(actor=actor, usuario=user, asignaciones=empresas, context=context)
        return user

    @staticmethod
    def update_user(*, actor: User, user: User, context: dict | None = None, **fields) -> User:
        exigir_alcance_sobre(actor, user)
        # El código de empleado (con él se consulta el rol de pagos) lo cambia
        # solo quien habilita el rol de pagos (22/10/2026).
        if "codigo_empleado" in fields and (fields["codigo_empleado"] or None) != (
            user.codigo_empleado or None
        ):
            from rest_framework.exceptions import PermissionDenied

            from apps.permissions.authorization import user_has_permission

            if not user_has_permission(actor, "roles_pago.habilitar"):
                raise PermissionDenied(
                    "El código de empleado lo cambia quien habilita el rol de pagos "
                    "(roles_pago.habilitar)."
                )
        previous_values = {}
        new_values = {}
        for field, value in fields.items():
            old = getattr(user, field)
            if old != value:
                previous_values[field] = old
                new_values[field] = value
                setattr(user, field, value)

        if new_values:
            user.updated_by = actor
            user.save(update_fields=[*new_values.keys(), "updated_by", "updated_at"])
            record_audit_event(
                actor=actor,
                action="user.updated",
                target=user,
                module="usuarios",
                previous_values=previous_values,
                new_values=new_values,
                context=context,
            )
        return user

    @staticmethod
    def _is_last_active_admin(user: User) -> bool:
        """AC-038: `user` es el único administrador (`is_superuser=True`)
        que sigue con `status=ACTIVE` en todo el sistema."""
        if not user.is_superuser:
            return False
        return not (
            User.objects.filter(is_superuser=True, status=User.Status.ACTIVE)
            .exclude(pk=user.pk)
            .exists()
        )

    @staticmethod
    def _set_status(
        *, actor: User, user: User, status: str, action: str, context: dict | None = None
    ) -> User:
        exigir_alcance_sobre(actor, user)
        if status != User.Status.ACTIVE and UserAdminService._is_last_active_admin(user):
            raise serializers.ValidationError({"non_field_errors": [LAST_ACTIVE_ADMIN_ERROR]})

        previous_status = user.status
        user.status = status
        user.updated_by = actor
        # Deshabilitar o bloquear al único gestor dejaría a su empresa sin
        # nadie que pueda dar roles en la Matriz.
        _vigilando_gestores(
            lambda: user.save(update_fields=["status", "is_active", "updated_by", "updated_at"])
        )
        record_audit_event(
            actor=actor,
            action=action,
            target=user,
            module="usuarios",
            previous_values={"status": previous_status},
            new_values={"status": status},
            context=context,
        )
        return user

    @staticmethod
    def enable(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.ACTIVE,
            action="user.enabled",
            context=context,
        )

    @staticmethod
    def disable(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.DISABLED,
            action="user.disabled",
            context=context,
        )

    @staticmethod
    def block(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.BLOCKED,
            action="user.blocked",
            context=context,
        )

    @staticmethod
    def unblock(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.ACTIVE,
            action="user.unblocked",
            context=context,
        )

    @staticmethod
    def revoke_sessions(*, actor: User, user: User, context: dict | None = None) -> int:
        exigir_alcance_sobre(actor, user)
        revoked_count = SessionService.logout_all(user)
        record_audit_event(
            actor=actor,
            action="user.sessions_revoked",
            target=user,
            module="usuarios",
            new_values={"revoked_count": revoked_count},
            context=context,
        )
        return revoked_count

    @staticmethod
    def assign_roles(
        *, actor: User, user: User, role_ids: list[int], context: dict | None = None
    ) -> User:
        previous_groups = list(user.groups.all())
        # Los roles de nivel del organigrama no son globales: los pone el cargo,
        # en la empresa de ese organigrama.
        groups = list(Group.objects.filter(id__in=role_ids, cargo_organigrama__isnull=True))
        # Solo cuentan los que se añaden: conservar un rol que ya tenía no es
        # repartirlo, y exigirlo impediría tocar los demás roles de esa persona.
        _roles_sin_alcance(actor, [g for g in groups if g not in previous_groups])
        _vigilando_gestores(lambda: user.groups.set(groups))
        user.updated_by = actor
        user.save(update_fields=["updated_by", "updated_at"])
        record_audit_event(
            actor=actor,
            action="user.roles_assigned",
            target=user,
            module="usuarios",
            previous_values={
                "role_ids": [g.id for g in previous_groups],
                "role_names": [g.name for g in previous_groups],
            },
            new_values={"role_ids": role_ids, "role_names": [g.name for g in groups]},
            context=context,
        )
        return user

    @staticmethod
    def assign_permissions(
        *, actor: User, user: User, permissions: list[Permission], context: dict | None = None
    ) -> User:
        # Misma regla que en los roles: nadie reparte lo que no tiene. Sin esto,
        # `usuarios.editar` bastaría para darse a uno mismo el catálogo entero
        # por la puerta de al lado.
        faltantes = permisos_que_no_tiene(actor, [p.codename for p in permissions])
        if faltantes:
            raise serializers.ValidationError(
                {
                    "permission_codenames": [
                        "No puede conceder permisos que usted no tiene: "
                        + ", ".join(faltantes)
                        + "."
                    ]
                }
            )
        previous_permissions = list(user.user_permissions.all())
        _vigilando_gestores(lambda: user.user_permissions.set(permissions))
        user.updated_by = actor
        user.save(update_fields=["updated_by", "updated_at"])
        record_audit_event(
            actor=actor,
            action="user.permissions_assigned",
            target=user,
            module="usuarios",
            previous_values={"permissions": [p.codename for p in previous_permissions]},
            new_values={"permissions": [p.codename for p in permissions]},
            context=context,
        )
        return user


# --- Quién aprueba por la persona mientras está ausente (US-018) ----------------------


def reemplazo_de(usuario) -> dict:
    """Lo que muestra la tarjeta «Mientras no está» de la ficha:
    `{modo, persona, jefe, ausencia}` de la empresa activa. `ausencia` es
    `{clave, texto, hasta}` si hoy está ausente (nunca el tipo de permiso)."""
    from apps.organizacion import ausencia

    _exigir_de_la_empresa_activa(usuario)
    datos = ausencia.mi_reemplazo(usuario)
    hoy = ausencia.ausencias_de([usuario], con_reemplazo=False).get(usuario.pk)
    datos["ausencia"] = (
        {"clave": hoy["clave"], "texto": hoy["texto"], "hasta": hoy["hasta"]} if hoy else None
    )
    return datos


def _exigir_de_la_empresa_activa(usuario) -> None:
    from rest_framework.exceptions import ValidationError

    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
    from apps.organizacion import ausencia

    if empresa_actual() in (None, SIN_EMPRESA):
        raise ValidationError(
            {"detail": "Elija una empresa para ver quién aprueba por esta persona."}
        )
    if ausencia._miembro_activo(usuario.pk) is None:
        raise ValidationError(
            {
                "detail": "Esta persona no tiene una cuenta activa en la empresa en la que "
                "está trabajando: cambie de empresa para configurar quién aprueba por ella."
            }
        )


def configurar_reemplazo(*, actor, usuario, modo, persona_id=None, context=None) -> dict:
    """Guarda, por un administrador, quién aprueba por `usuario` mientras está
    ausente (la misma configuración de «Mi estado»). Avisa a la persona en la
    campana, lo deja en la auditoría y, si hoy está ausente, pasa enseguida
    sus aprobaciones pendientes al nuevo reemplazo."""
    from django.db import transaction
    from rest_framework.exceptions import PermissionDenied

    from apps.notificaciones import services as campana
    from apps.organizacion import ausencia

    if usuario.is_superuser and not actor.is_superuser:
        raise PermissionDenied("Solo un superusuario configura esto para otro superusuario.")
    _exigir_de_la_empresa_activa(usuario)
    antes = ausencia.mi_reemplazo(usuario)
    ausencia.guardar_reemplazo(usuario, modo=modo, persona_id=persona_id, por_otra=True)
    resultado = reemplazo_de(usuario)

    def _id(datos):
        return datos["persona"]["id"] if datos["persona"] else None

    record_audit_event(
        actor=actor,
        action="usuarios.reemplazo.configurado",
        target=usuario,
        module="usuarios",
        previous_values={"modo": antes["modo"], "persona": _id(antes)},
        new_values={"modo": resultado["modo"], "persona": _id(resultado)},
        context=context,
    )
    if actor.pk != usuario.pk:
        if resultado["modo"] == "persona" and resultado["persona"]:
            quien = resultado["persona"]["nombre"]
        elif resultado["jefe"]:
            quien = f"su jefe inmediato ({resultado['jefe']['nombre']})"
        else:
            quien = "su jefe inmediato"
        nombre_actor = actor.get_full_name() or actor.username
        transaction.on_commit(
            lambda: campana.notificar(
                [usuario],
                tipo="organizacion.reemplazo_configurado",
                titulo="Cambió quién aprueba por usted",
                resumen=f"{nombre_actor} configuró que, mientras usted no esté, apruebe "
                f"por usted {quien}. Puede cambiarlo en Chat › Mi estado.",
                enlace="/admin/chat",
            )
        )
    if resultado["ausencia"]:
        # Como al guardar «Mi estado» (`chat.estados._reasignar`): si falla, la
        # configuración queda igual y la revisión periódica lo reintenta.
        try:
            ausencia.reasignar_pendientes(usuario)
        except Exception:  # noqa: BLE001
            logger.exception("No se pudieron reasignar las aprobaciones de %s", usuario.pk)
    return resultado
