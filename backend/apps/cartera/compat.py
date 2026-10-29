"""Adaptadores entre el módulo de Dashboards y este sistema.

(La app se llama `cartera` por dentro —su etiqueta, sus tablas y su API—
porque así venía del sistema de origen, donde nació para la cartera; en
pantalla es el módulo de Dashboards de cualquier área.)

El módulo se portó desde `cms_dashboards` conservando su código (la
especificación pide replicarlo, no reinterpretarlo). Lo único que cambia es a
qué piezas del sistema anfitrión se conecta, y eso vive todo aquí:

- **Auditoría**: el módulo escribe con `log_event(domain, action, ...)`; aquí
  se traduce a la bitácora única del sistema (`record_audit_event`), con el
  dominio y el resultado del módulo guardados en los valores del evento.
- **Permisos**: `require_permission` e `IsSuperuser` sobre la resolución de
  permisos del sistema (roles generales y de la empresa activa).
- **Fuerza bruta**: la confirmación de contraseña de un dashboard bloqueado
  gasta el mismo contador de intentos que el login.
"""

from django.db import models
from rest_framework.permissions import BasePermission

from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.core.request_meta import get_request_context
from apps.permissions.authorization import user_has_permission

#: Cómo aparece el módulo en la Auditoría.
MODULO = "dashboards"

#: Los nombres anteriores, para leer los eventos registrados antes del cambio
#: de nombre (16 de octubre de 2026).
MODULOS_ANTERIORES = ("cartera",)
CLAVES_DETALLE_ANTERIORES = ("detalle_cartera",)

#: Dónde guarda `log_event` el dominio, el resultado y el resto de lo que la
#: bitácora del sistema no tiene como columna.
CLAVE_DETALLE = "detalle_dashboard"


def detalle_de(registro) -> dict:
    """El detalle del módulo en un evento, con su nombre actual o el anterior."""
    valores = registro.new_values or {}
    for clave in (CLAVE_DETALLE, *CLAVES_DETALLE_ANTERIORES):
        if valores.get(clave):
            return valores[clave]
    return {}


class AuditEvent:
    """Los catálogos de la auditoría del módulo de origen, sin su tabla."""

    class Domain(models.TextChoices):
        SECURITY = "SECURITY", "Seguridad"
        AUTHENTICATION = "AUTHENTICATION", "Autenticación"
        USER_MANAGEMENT = "USER_MANAGEMENT", "Gestión de usuarios"
        ROLE_MANAGEMENT = "ROLE_MANAGEMENT", "Gestión de roles"
        PERMISSION_MANAGEMENT = "PERMISSION_MANAGEMENT", "Gestión de permisos"
        DASHBOARD_ACCESS = "DASHBOARD_ACCESS", "Acceso a dashboard"
        DASHBOARD_LAYOUT = "DASHBOARD_LAYOUT", "Diseño de dashboard"
        DASHBOARD_CONFIGURATION = "DASHBOARD_CONFIGURATION", "Configuración de dashboard"
        DATA_SOURCE = "DATA_SOURCE", "Fuente de datos"
        EXPORT = "EXPORT", "Exportación"
        FILE_UPLOAD = "FILE_UPLOAD", "Carga de archivo"
        SYSTEM_CONFIGURATION = "SYSTEM_CONFIGURATION", "Configuración del sistema"

    class Result(models.TextChoices):
        SUCCESS = "SUCCESS", "Éxito"
        FAILED = "FAILED", "Fallido"
        DENIED = "DENIED", "Denegado"
        WARNING = "WARNING", "Advertencia"

    class Severity(models.TextChoices):
        INFO = "INFO", "Info"
        LOW = "LOW", "Baja"
        MEDIUM = "MEDIUM", "Media"
        HIGH = "HIGH", "Alta"
        CRITICAL = "CRITICAL", "Crítica"


def log_event(
    *,
    domain,
    action,
    result=AuditEvent.Result.SUCCESS,
    severity=None,
    actor=None,
    entity_type="",
    entity_id="",
    entity_name="",
    dashboard_id="",
    component_id="",
    request=None,
    request_id="",
    session_id="",
    ip_address=None,
    user_agent="",
    previous_values=None,
    new_values=None,
    metadata=None,
    message="",
):
    """Registra el evento en la bitácora del sistema. Nunca lanza, como el
    original: una falla al auditar no interrumpe la operación de negocio."""
    try:
        usuario = actor if (actor and getattr(actor, "is_authenticated", False)) else None
        contexto = get_request_context(request) if request is not None else None
        # Lo propio del módulo va aparte, bajo `CLAVE_DETALLE`, para que los
        # valores de antes y de después queden tal como los pasó quien audita.
        valores = dict(new_values or {})
        valores[CLAVE_DETALLE] = {
            "dominio": str(domain),
            "resultado": str(result),
            **({"severidad": str(severity)} if severity else {}),
            **({"dashboard_id": dashboard_id} if dashboard_id else {}),
            **({"component_id": component_id} if component_id else {}),
            **({"entidad": entity_name} if entity_name else {}),
            **({"metadata": metadata} if metadata else {}),
            **({"mensaje": message} if message else {}),
        }
        fallo = result in (AuditEvent.Result.FAILED, AuditEvent.Result.DENIED)
        return record_audit_event(
            actor=usuario,
            # Los rechazos de acceso del módulo se registran con la acción común
            # del sistema, para que aparezcan con los demás en la auditoría.
            action="access_denied" if action == "ACCESS_DENIED" else action,
            target_type=entity_type or ("dashboard" if dashboard_id else ""),
            target_id=entity_id or dashboard_id or None,
            module=MODULO,
            previous_values=previous_values,
            new_values=valores,
            result=AuditLog.Result.FAILURE if fallo else AuditLog.Result.SUCCESS,
            context=contexto,
        )
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger("apps.cartera").exception("No se pudo auditar %s", action)
        return None


def request_meta(request):
    """IP y agente de usuario de la petición, como el `request_meta` original."""
    contexto = get_request_context(request) or {}
    return contexto.get("ip_address"), contexto.get("user_agent", "")


def require_permission(codename):
    """Fábrica de permisos DRF: exige un codename del catálogo y audita el
    rechazo como el resto del sistema."""

    class _RequierePermiso(BasePermission):
        message = "No tiene permiso para realizar esta acción."

        def has_permission(self, request, view):
            usuario = request.user
            if user_has_permission(usuario, codename):
                return True
            if usuario and usuario.is_authenticated:
                record_audit_event(
                    actor=usuario,
                    action="access_denied",
                    target_type="endpoint",
                    target_id=request.path,
                    module=MODULO,
                    new_values={"required_permission": codename, "method": request.method},
                    result=AuditLog.Result.FAILURE,
                    context=get_request_context(request),
                )
            return False

    _RequierePermiso.__name__ = f"Requiere_{codename.replace('.', '_')}"
    return _RequierePermiso


class IsSuperuser(BasePermission):
    """Solo el superusuario: donde ningún permiso asignable debe bastar."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


class BruteForceProtectionService:
    """La interfaz del original sobre el contador de intentos del login."""

    @staticmethod
    def identificador_canonico(identifier, usuario=None):
        if usuario is not None:
            return usuario.username
        return (identifier or "").strip().lower()

    @staticmethod
    def esta_bloqueado(identificador_canonico, ip_address=None):
        from apps.authentication.services import BruteForceProtectionService as Servicio

        # Con la IP: el bloqueo es por identificador + IP (auditoría de
        # seguridad, 29/10/2026); sin ella, por identificador como antes.
        return Servicio.is_locked_out(identificador_canonico, ip_address)

    @staticmethod
    def registrar_intento(*, identifier, ip_address, user=None, successful):
        from apps.authentication.services import BruteForceProtectionService as Servicio

        Servicio.record_attempt(
            identifier=identifier, ip_address=ip_address, user=user, successful=successful
        )
