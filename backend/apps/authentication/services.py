"""Lógica de negocio del dominio de autenticación (login, sesiones, JWT,
recuperación de contraseña). Las vistas delegan aquí — nunca acceden al ORM
ni aplican reglas de negocio directamente."""

import hashlib
import logging
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import update_last_login
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.core.request_meta import parse_user_agent
from apps.users.models import User

from .authentication import SessionIdleTimeout
from .emails import send_password_changed_notification, send_password_reset_email
from .models import LoginAttempt, PasswordResetToken, Session
from .tokens import issue_token_pair

logger = logging.getLogger("apps.authentication")

# Un único mensaje para credenciales inválidas, sin importar si el motivo
# fue "no existe", "password incorrecta" o "usuario deshabilitado" — evita
# que la respuesta permita enumerar usuarios existentes.
GENERIC_AUTH_ERROR = "No fue posible iniciar sesión con esas credenciales."
LOCKOUT_ERROR = "Demasiados intentos fallidos. Intente nuevamente en unos minutos."

# Hash "señuelo" calculado una sola vez al importar el módulo. Cuando el
# identificador no resuelve a ningún usuario, igual se ejecuta un chequeo
# de password contra este hash para que el costo (tiempo) de la respuesta
# sea equivalente al de un usuario real, mitigando ataques de temporización
# que de otro modo revelarían si la cuenta existe.
_DUMMY_PASSWORD_HASH = make_password(uuid.uuid4().hex)


class BruteForceProtectionService:
    """Bloqueo temporal tras demasiados intentos fallidos.

    El conteo se hace sobre `identifier` (el texto tecleado), no sobre el
    usuario resuelto: así un nombre de usuario inexistente se "bloquea"
    exactamente igual que uno real tras el mismo número de intentos, sin
    filtrar si la cuenta existe.

    Son dos límites (auditoría de seguridad, 29/10/2026). El bajo
    (`LOGIN_MAX_FAILED_ATTEMPTS`) cuenta por identificador **desde una IP**:
    antes contaba solo por identificador, y cinco intentos con el usuario de
    otra persona la dejaban fuera quince minutos, repetible sin fin. El alto
    (`LOGIN_MAX_FAILED_ATTEMPTS_GLOBAL`) suma todas las IP y frena el ataque
    repartido entre muchas. Sin IP conocida se aplica el bajo al identificador
    solo, como antes: es lo más prudente cuando no se sabe de dónde viene.
    """

    @staticmethod
    def _fallidos(identifier: str):
        window_start = timezone.now() - timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
        return LoginAttempt.objects.filter(
            identifier__iexact=identifier,
            successful=False,
            created_at__gte=window_start,
        )

    @staticmethod
    def is_locked_out(identifier: str, ip_address: str | None = None) -> bool:
        fallidos = BruteForceProtectionService._fallidos(identifier)
        if ip_address is None:
            return fallidos.count() >= settings.LOGIN_MAX_FAILED_ATTEMPTS
        if fallidos.filter(ip_address=ip_address).count() >= settings.LOGIN_MAX_FAILED_ATTEMPTS:
            return True
        return fallidos.count() >= settings.LOGIN_MAX_FAILED_ATTEMPTS_GLOBAL

    @staticmethod
    def record_attempt(
        *, identifier: str, ip_address: str | None, user: User | None, successful: bool
    ) -> None:
        LoginAttempt.objects.create(
            identifier=identifier, ip_address=ip_address, user=user, successful=successful
        )
        if not successful:
            logger.warning(
                "Intento de inicio de sesión fallido para identificador=%r desde ip=%s",
                identifier,
                ip_address,
            )

    @staticmethod
    def desbloquear(user: User) -> tuple[int, list[str]]:
        """Quita el bloqueo por intentos fallidos de la cuenta (US-015, 13/11/2026).

        El bloqueo no es un estado guardado: se calcula contando los fallos
        recientes por el texto tecleado (`_fallidos`) y hasta hoy solo se
        levantaba al pasar `LOGIN_LOCKOUT_MINUTES`. Para levantarlo ya se
        borran los fallos que siguen dentro de la ventana y que se escribieron
        con el usuario o el correo de la cuenta, como hace `django-axes` al
        reiniciar un bloqueo. Los anteriores a la ventana ya no cuentan y se
        conservan. Devuelve cuántos se borraron y desde qué IP distintas, leídas
        antes de borrar, para que queden en la auditoría de quien llama (un
        ataque se reconoce por sus IP); cada fallo dejó además en su momento su
        línea en el log de seguridad.

        No toca `User.status`: el bloqueo manual («Bloquear») es una decisión
        de administración y se levanta con «Desbloquear».
        """
        window_start = timezone.now() - timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
        identificadores = Q(identifier__iexact=user.username)
        if user.email:
            identificadores |= Q(identifier__iexact=user.email)
        fallidos = LoginAttempt.objects.filter(identificadores).filter(
            successful=False, created_at__gte=window_start
        )
        ips = sorted({ip for ip in fallidos.values_list("ip_address", flat=True) if ip})
        borrados, _ = fallidos.delete()
        return borrados, ips


#: El user-agent de la app móvil: «IntranetLCE/<versión> (<android|ios>)».
APP_MOVIL_PREFIJO = "IntranetLCE/"


def dispositivo_de(user_agent: str) -> str:
    """Cómo se ve la sesión en «Sesiones»: la app se nombra por sí misma
    («Intranet LCE · Android/iOS», US-009, 12/11/2026); lo demás, como antes."""
    ua = user_agent or ""
    if ua.startswith(APP_MOVIL_PREFIJO):
        resto = ua[len(APP_MOVIL_PREFIJO) :].lower()
        if "android" in resto:
            return "Intranet LCE · Android"
        if "ios" in resto:
            return "Intranet LCE · iOS"
        return "Intranet LCE"
    return parse_user_agent(user_agent)["device"]


def _cortar_push(user: User) -> None:
    """Los teléfonos de las sesiones recién cerradas dejan de recibir push
    (US-009). No lanza: cerrar la sesión es lo que importa."""
    from apps.notificaciones.services import desactivar_dispositivos_sin_sesion

    desactivar_dispositivos_sin_sesion(user)


class SessionService:
    @staticmethod
    def create_session(*, user: User, ip_address: str | None, user_agent: str) -> Session:
        refresh_lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
        return Session.objects.create(
            user=user,
            # Placeholder único y temporal: se reemplaza por el jti real del
            # refresh token justo después de emitirlo (ver AuthenticationService).
            refresh_token_jti=f"pending:{uuid.uuid4()}",
            device=dispositivo_de(user_agent),
            user_agent=(user_agent or "")[:255],
            ip_address=ip_address,
            expires_at=timezone.now() + refresh_lifetime,
        )

    @staticmethod
    def logout(session: Session) -> None:
        session.revoke()
        _cortar_push(session.user)

    @staticmethod
    def logout_all(user: User, *, exclude_session_id=None) -> int:
        now = timezone.now()
        queryset = Session.objects.filter(user=user, revoked_at__isnull=True)
        if exclude_session_id is not None:
            queryset = queryset.exclude(id=exclude_session_id)
        revocadas = queryset.update(revoked_at=now)
        if revocadas:
            _cortar_push(user)
        return revocadas


class AuthenticationService:
    @staticmethod
    def register_user(
        *, username: str, email: str, password: str, first_name: str = "", last_name: str = ""
    ) -> User:
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )
        return user

    @staticmethod
    def _resolve_user(identifier: str) -> User | None:
        return User.objects.filter(
            Q(username__iexact=identifier) | Q(email__iexact=identifier)
        ).first()

    @staticmethod
    def _issue_tokens_for_new_session(
        *, user: User, ip_address: str | None, user_agent: str
    ) -> dict:
        session = SessionService.create_session(
            user=user, ip_address=ip_address, user_agent=user_agent
        )
        tokens = issue_token_pair(user, session)
        session.refresh_token_jti = tokens.pop("refresh_jti")
        session.save(update_fields=["refresh_token_jti"])
        # La última conexión se anota aquí y no en la vista de login porque
        # aquí pasa **toda** sesión nueva, venga del formulario o de un cambio
        # de contraseña forzado. Refrescar el token no cuenta: reutiliza la
        # sesión que ya existe, y contarlo haría que una pestaña olvidada
        # abierta pareciera alguien trabajando.
        update_last_login(None, user)
        return tokens

    @staticmethod
    def issue_tokens_for(
        user: User, *, ip_address: str | None = None, user_agent: str = ""
    ) -> dict:
        return AuthenticationService._issue_tokens_for_new_session(
            user=user, ip_address=ip_address, user_agent=user_agent
        )

    @staticmethod
    def authenticate_and_issue_tokens(
        *, identifier: str, password: str, ip_address: str | None = None, user_agent: str = ""
    ) -> dict:
        if BruteForceProtectionService.is_locked_out(identifier, ip_address):
            # El intento bloqueado no se guarda como fallo: si contara, quien
            # siguiera insistiendo desde una sola IP llegaría solo al límite
            # global y dejaría fuera al dueño de la cuenta desde cualquier
            # equipo, que es justo lo que el bloqueo por IP quiere evitar.
            logger.warning(
                "Bloqueo por fuerza bruta activo para identificador=%r desde ip=%s",
                identifier,
                ip_address,
            )
            raise AuthenticationFailed(LOCKOUT_ERROR, code="account_locked")

        user = AuthenticationService._resolve_user(identifier)

        if user is None:
            # Chequeo de costo equivalente contra un hash señuelo (timing-safe).
            check_password(password, _DUMMY_PASSWORD_HASH)
            BruteForceProtectionService.record_attempt(
                identifier=identifier, ip_address=ip_address, user=None, successful=False
            )
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, code="invalid_credentials")

        if not user.check_password(password) or not user.is_active:
            BruteForceProtectionService.record_attempt(
                identifier=identifier, ip_address=ip_address, user=user, successful=False
            )
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, code="invalid_credentials")

        tokens = AuthenticationService._issue_tokens_for_new_session(
            user=user, ip_address=ip_address, user_agent=user_agent
        )
        BruteForceProtectionService.record_attempt(
            identifier=identifier, ip_address=ip_address, user=user, successful=True
        )
        return tokens

    @staticmethod
    def refresh_tokens(*, refresh_token_str: str, ip_address: str | None = None) -> dict:
        try:
            refresh = RefreshToken(refresh_token_str)
        except TokenError:
            raise AuthenticationFailed(
                "El token de actualización es inválido o expiró.", code="invalid_refresh"
            ) from None

        session = Session.objects.filter(id=refresh.get("sid")).select_related("user").first()

        if session is None:
            raise AuthenticationFailed(
                "El token de actualización es inválido.", code="invalid_refresh"
            )

        if not session.is_active:
            raise AuthenticationFailed("La sesión ya no es válida.", code="session_revoked")

        # También aquí: si el plazo venció, renovar el token resucitaría una
        # sesión que ya debería estar cerrada. Renovar no es actividad de
        # nadie —lo hace el navegador solo—, así que no reinicia la cuenta: la
        # reinician las peticiones que sí pidió alguien.
        if session.vencida_por_inactividad():
            session.revoke()
            raise SessionIdleTimeout()

        if session.refresh_token_jti != refresh.get("jti"):
            # El jti presentado no coincide con el vigente: es un refresh
            # token ya rotado que se está reutilizando. Se revoca la sesión
            # completa como medida de contención ante un posible robo.
            session.revoke()
            logger.error("Reutilización de refresh token detectada para sesión=%s", session.id)
            raise AuthenticationFailed(
                "El token de actualización ya no es válido.", code="refresh_reused"
            )

        if not session.user.is_active:
            session.revoke()
            raise AuthenticationFailed("La sesión ya no es válida.", code="session_revoked")

        tokens = issue_token_pair(session.user, session)
        session.refresh_token_jti = tokens.pop("refresh_jti")
        if ip_address:
            session.ip_address = ip_address
        # `last_used_at` queda fuera a propósito: renovar el token lo hace el
        # navegador, no la persona. Lo que reinicia la cuenta de inactividad es
        # la petición que venía detrás —la que provocó el 401—, que sí pidió
        # alguien. Es `auto_now`, así que basta con no incluirlo aquí.
        session.save(update_fields=["refresh_token_jti", "ip_address"])
        return tokens


PASSWORD_RESET_GENERIC_MESSAGE = (
    "Si el dato ingresado corresponde a una cuenta, se enviará un enlace de "
    "recuperación al correo asociado."
)
PASSWORD_RESET_INVALID_TOKEN_ERROR = "El enlace de recuperación no es válido o expiró."


class PropiaCuenta(PermissionDenied):
    """Cambiar o restablecer desde Configuración › Usuarios la contraseña de
    la cuenta con la que se está trabajando (US-015). La propia se cambia en
    «Mi perfil», que pide la actual. 403 con el código estable `propia_cuenta`."""

    default_code = "propia_cuenta"
    default_detail = "Su propia contraseña se cambia en «Mi perfil», no desde aquí."


class SinClaveTemporal(APIException):
    """El servidor no tiene `CLAVE_INICIAL_USUARIOS` (US-015, CA-2): no hay a
    qué restablecer. 400 con el código estable `sin_clave_temporal`."""

    status_code = 400
    default_code = "sin_clave_temporal"
    default_detail = (
        "El servidor no tiene una clave temporal configurada. Use «Cambiar contraseña» "
        "o pida a TI que la configure."
    )


#: Las acciones de auditoría de US-015; el rechazo lleva el sufijo «_rejected».
ACCION_CAMBIAR = "user.password_set_by_admin"
ACCION_TEMPORAL = "user.password_temporal_by_admin"


def _generate_raw_reset_token() -> str:
    return secrets.token_urlsafe(32)


def _hash_reset_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


class PasswordResetService:
    """Recuperación autónoma (token de un solo uso enviado por correo) y
    restablecimiento administrativo de contraseña.

    `request_reset` nunca revela si un identificador corresponde a una
    cuenta real: la vista responde siempre el mismo mensaje genérico sin
    importar qué rama de este servicio se ejecutó.
    """

    @staticmethod
    def _issue_reset_token(user: User) -> str:
        # Invalida cualquier enlace anterior no usado: solo el más reciente
        # sirve para restablecer la contraseña.
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        raw_token = _generate_raw_reset_token()
        expires_at = timezone.now() + timedelta(
            minutes=settings.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES
        )
        PasswordResetToken.objects.create(
            user=user, token_hash=_hash_reset_token(raw_token), expires_at=expires_at
        )
        return raw_token

    @staticmethod
    def request_reset(*, identifier: str, context: dict | None = None) -> None:
        user = AuthenticationService._resolve_user(identifier)
        if user is None or user.status != User.Status.ACTIVE:
            # Ninguna escritura, ningún correo: la cuenta no existe, o existe
            # pero no está activa. La respuesta de la vista es idéntica.
            return

        raw_token = PasswordResetService._issue_reset_token(user)
        send_password_reset_email(user=user, raw_token=raw_token)
        record_audit_event(
            actor=user,
            action="user.password_reset_requested",
            target=user,
            module="usuarios",
            context=context,
        )

    @staticmethod
    def confirm_reset(*, raw_token: str, new_password: str, context: dict | None = None) -> None:
        token = (
            PasswordResetToken.objects.select_related("user")
            .filter(token_hash=_hash_reset_token(raw_token))
            .first()
        )

        if token is None:
            record_audit_event(
                actor=None,
                action="user.password_reset_rejected",
                module="usuarios",
                result=AuditLog.Result.FAILURE,
                new_values={"reason": "token_not_found"},
                context=context,
            )
            raise serializers.ValidationError({"token": [PASSWORD_RESET_INVALID_TOKEN_ERROR]})

        if not token.is_valid:
            record_audit_event(
                actor=token.user,
                action="user.password_reset_rejected",
                target=token.user,
                module="usuarios",
                result=AuditLog.Result.FAILURE,
                new_values={"reason": "used" if token.used_at else "expired"},
                context=context,
            )
            raise serializers.ValidationError({"token": [PASSWORD_RESET_INVALID_TOKEN_ERROR]})

        user = token.user
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password", "updated_at"])

        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])

        revoked_count = SessionService.logout_all(user)

        record_audit_event(
            actor=user,
            action="user.password_reset_completed",
            target=user,
            module="usuarios",
            new_values={"revoked_sessions": revoked_count},
            context=context,
        )
        send_password_changed_notification(user=user)

    @staticmethod
    def admin_initiate_reset(
        *,
        actor: User,
        user: User,
        send_link: bool,
        force_change_on_next_login: bool,
        revoke_sessions: bool,
        context: dict | None = None,
    ) -> None:
        """El administrador nunca ve ni define la nueva contraseña: solo
        dispara el envío del enlace, activa el flag de cambio obligatorio
        y/o revoca sesiones. Al menos una de las tres opciones debe venir en
        `True` (validado en el serializer, no aquí).

        La cuenta de un superusuario (o de quien tenga permisos que el actor
        no tiene) solo la restablece otro superusuario (auditoría de
        seguridad, 29/10/2026)."""
        from apps.users.services import exigir_alcance_sobre

        exigir_alcance_sobre(actor, user)
        revoked_count = 0

        if send_link:
            raw_token = PasswordResetService._issue_reset_token(user)
            send_password_reset_email(user=user, raw_token=raw_token)

        if force_change_on_next_login:
            user.must_change_password = True
            user.save(update_fields=["must_change_password", "updated_at"])

        if revoke_sessions:
            revoked_count = SessionService.logout_all(user)

        record_audit_event(
            actor=actor,
            action="user.password_reset_admin_initiated",
            target=user,
            module="usuarios",
            new_values={
                "send_link": send_link,
                "force_change_on_next_login": force_change_on_next_login,
                "revoke_sessions": revoke_sessions,
                "revoked_sessions_count": revoked_count,
            },
            context=context,
        )

    @staticmethod
    def exigir_limites_por_administracion(
        *, actor: User, user: User, accion: str, context: dict | None = None
    ) -> None:
        """Los límites de cambiar o restablecer la contraseña de otra cuenta
        (US-015, CA-3), con el rechazo auditado:

        - nadie actúa sobre su propia cuenta (403 `propia_cuenta`);
        - sobre un superusuario, o sobre quien tiene en alguna de sus empresas
          permisos que el actor no tiene allí, solo un superusuario
          (`exigir_alcance_en_todas_sus_empresas`, 403 `permission_denied`).

        La vista la llama **antes** de validar la contraseña (QA-FUNC,
        13/11/2026): una clave débil enviada a un superusuario es un 403, no un
        400 que invite a corregirla. El servicio la repite con la fila
        bloqueada. El evento de rechazo va en su propia transacción y fuera de
        la del cambio: si fuera dentro, el rollback lo borraría.
        """
        from apps.users.services import exigir_alcance_en_todas_sus_empresas

        try:
            if actor.pk == user.pk:
                raise PropiaCuenta()
            exigir_alcance_en_todas_sus_empresas(actor, user)
        except PermissionDenied as error:
            motivo = "propia_cuenta" if isinstance(error, PropiaCuenta) else "fuera_de_alcance"
            with transaction.atomic():
                record_audit_event(
                    actor=actor,
                    action=f"{accion}_rejected",
                    target=user,
                    module="usuarios",
                    result=AuditLog.Result.FAILURE,
                    new_values={"motivo": motivo},
                    context=context,
                )
            raise

    @staticmethod
    def _fijar_por_administracion(
        *,
        actor: User,
        user: User,
        clave: str,
        forzar_cambio: bool,
        cerrar_sesiones: bool,
        accion: str,
        context: dict | None = None,
    ) -> dict:
        """Lo común a cambiar la contraseña de otra cuenta y a restablecerla a
        la temporal (US-015, 13/11/2026).

        Dentro de una transacción y con la fila del usuario bloqueada: dos
        administradores a la vez sobre la misma cuenta no se pisan a medias
        (uno espera al otro y el último gana entero). Los límites
        (`exigir_limites_por_administracion`) se comprueban antes de abrirla,
        para que el rechazo quede auditado, y otra vez sobre la fila ya
        bloqueada por si la cuenta cambió entretanto (rara vez falla aquí; si
        falla, se audita después del rollback).

        No cambia `status`: una cuenta deshabilitada sigue deshabilitada
        (CA-3). La contraseña nunca entra en la auditoría ni en el correo, que
        sale solo si la transacción se confirma.
        """
        from apps.users.services import exigir_alcance_en_todas_sus_empresas

        PasswordResetService.exigir_limites_por_administracion(
            actor=actor, user=user, accion=accion, context=context
        )
        try:
            with transaction.atomic():
                objetivo = User.objects.select_for_update().get(pk=user.pk)
                exigir_alcance_en_todas_sus_empresas(actor, objetivo)

                objetivo.set_password(clave)
                objetivo.must_change_password = forzar_cambio
                objetivo.updated_by = actor
                objetivo.save(
                    update_fields=["password", "must_change_password", "updated_by", "updated_at"]
                )

                # Ningún enlace de «Recuperar contraseña» enviado antes sirve ya.
                enlaces = PasswordResetToken.objects.filter(
                    user=objetivo, used_at__isnull=True
                ).update(used_at=timezone.now())
                sesiones = SessionService.logout_all(objetivo) if cerrar_sesiones else 0
                intentos, ips = BruteForceProtectionService.desbloquear(objetivo)

                # Ojo con los nombres: `record_audit_event` enmascara toda
                # clave que contenga «password», «token» o «key».
                resumen = {
                    "forzar_cambio": forzar_cambio,
                    "cerrar_sesiones": cerrar_sesiones,
                    "sesiones_cerradas": sesiones,
                    "enlaces_invalidados": enlaces,
                    "intentos_fallidos_descartados": intentos,
                }
                record_audit_event(
                    actor=actor,
                    action=accion,
                    target=objetivo,
                    module="usuarios",
                    # Las IP de los intentos borrados solo van a la auditoría,
                    # no a la respuesta.
                    new_values={**resumen, "ips_de_intentos_descartados": ips},
                    context=context,
                )
                transaction.on_commit(
                    lambda: send_password_changed_notification(
                        user=objetivo, por_administracion=True, debe_cambiarla=forzar_cambio
                    )
                )
        except PermissionDenied:
            with transaction.atomic():
                record_audit_event(
                    actor=actor,
                    action=f"{accion}_rejected",
                    target=user,
                    module="usuarios",
                    result=AuditLog.Result.FAILURE,
                    new_values={"motivo": "fuera_de_alcance"},
                    context=context,
                )
            raise
        return resumen

    @staticmethod
    def admin_set_password(
        *,
        actor: User,
        user: User,
        password: str,
        forzar_cambio: bool = True,
        cerrar_sesiones: bool = True,
        context: dict | None = None,
    ) -> dict:
        """Cambia la contraseña de otra cuenta por la que indica el
        administrador (US-015, CA-1, permiso `usuarios.cambiar_password`).

        `password` llega ya validada por `AdminSetPasswordSerializer` con
        todos los validadores del sistema y la cuenta destino."""
        return PasswordResetService._fijar_por_administracion(
            actor=actor,
            user=user,
            clave=password,
            forzar_cambio=forzar_cambio,
            cerrar_sesiones=cerrar_sesiones,
            accion=ACCION_CAMBIAR,
            context=context,
        )

    @staticmethod
    def admin_set_temporal(*, actor: User, user: User, context: dict | None = None) -> dict:
        """Restablece la contraseña de otra cuenta a la clave temporal del
        servidor (US-015, CA-2, permiso `usuarios.clave_temporal`).

        La pone el sistema, como al crear cuentas: no pasa por los
        validadores (la temporal es justo la que `NoClaveTemporalValidator`
        rechaza). Por ser una clave conocida, siempre obliga a cambiarla al
        entrar y siempre cierra las sesiones (riesgo aceptado y mitigado,
        decisión del usuario del 13/11/2026). Los límites van primero; sin
        clave configurada, 400 `sin_clave_temporal` sin tocar nada."""
        from .validators import clave_temporal

        PasswordResetService.exigir_limites_por_administracion(
            actor=actor, user=user, accion=ACCION_TEMPORAL, context=context
        )
        temporal = clave_temporal()
        if not temporal:
            raise SinClaveTemporal()
        return PasswordResetService._fijar_por_administracion(
            actor=actor,
            user=user,
            clave=temporal,
            forzar_cambio=True,
            cerrar_sesiones=True,
            accion=ACCION_TEMPORAL,
            context=context,
        )

    @staticmethod
    def change_own_password(
        *,
        user: User,
        new_password: str,
        keep_session_id=None,
        context: dict | None = None,
    ) -> None:
        """Usado por el flujo de cambio obligatorio (`must_change_password`).
        Revoca las demás sesiones activas pero preserva `keep_session_id`
        (la sesión recién usada para autenticarse), para no desloguear al
        usuario justo después de cumplir el requisito."""
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password", "updated_at"])

        revoked_count = SessionService.logout_all(user, exclude_session_id=keep_session_id)

        record_audit_event(
            actor=user,
            action="user.password_changed_self",
            target=user,
            module="usuarios",
            new_values={"revoked_other_sessions": revoked_count},
            context=context,
        )
        send_password_changed_notification(user=user)
