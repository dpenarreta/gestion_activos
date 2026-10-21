"""Confirmación con contraseña para saltear el bloqueo estructural de un dashboard.

`Dashboard.estructura_bloqueada` congela la estructura del dashboard para todo el mundo. La única
salida es que un **superusuario** vuelva a escribir **su propia contraseña** en la misma operación
que quiere hacer: no alcanza con tener la sesión abierta.

Por qué contraseña y no un permiso más: el caso que motivó esto no fue alguien sin permisos, fue el
propio dueño del dashboard desconfigurando tres KPIs sin darse cuenta mientras miraba otra cosa. Un
permiso no habría cambiado nada —lo tenía—; lo que hace falta es un acto deliberado en el momento
exacto del cambio. Es el mismo patrón que "confirmá tu contraseña para esta acción sensible".

La confirmación vale para UNA operación: no deja al dashboard desbloqueado ni abre una ventana de
tiempo. Encadenar tres cambios estructurales pide la contraseña tres veces, y eso es deliberado —
una ventana abierta es exactamente el descuido que esto viene a evitar.

Los intentos fallidos se cuentan en el MISMO contador que los de login
(`BruteForceProtectionService`): es la misma contraseña, así que un endpoint que la verifica es
otra puerta para adivinarla, y tiene que gastar el mismo presupuesto de intentos. La contraseña
nunca se registra en auditoría ni en logs: los eventos guardan que hubo (o no hubo) confirmación,
nunca el valor.
"""

from apps.cartera.compat import AuditEvent
from apps.cartera.compat import log_event
from apps.cartera.compat import BruteForceProtectionService
from apps.cartera.compat import request_meta

from ..exceptions import CarteraError
from ..models import Dashboard

# La clave del cuerpo de la petición donde viaja la confirmación. `mask_sensitive_fields`
# (`apps.core.audit`) enmascara cualquier clave que contenga "password", así que este nombre no es
# decorativo: es lo que garantiza que un evento de auditoría con el cuerpo crudo no la filtre.
CAMPO_CONFIRMACION = 'password_confirmacion'

CODIGO_BLOQUEADO = 'DASHBOARD_BLOQUEADO'


def esta_bloqueado(dashboard_id):
    return Dashboard.objects.filter(dashboard_id=dashboard_id, estructura_bloqueada=True).exists()


def _fallar(mensaje, codigo, puede_confirmar):
    """`puede_confirmar` le dice al frontend si tiene sentido ofrecer el cuadro de contraseña.

    Sin ese dato la interfaz tendría que deducirlo de `is_superuser`, y quedarían dos lugares
    decidiendo lo mismo: a un usuario común le aparecería el cuadro y su contraseña correcta no
    serviría para nada.
    """
    raise CarteraError(mensaje, codigo=codigo, detalles={'puede_confirmar': puede_confirmar})


def confirmacion_valida(request, dashboard_id, accion):
    """`True` si esta petición trae una confirmación válida para saltear el bloqueo.

    No exige nada por sí sola: devuelve `False` cuando no viene contraseña, para que el llamador
    pueda seguir adelante si el cambio no era estructural. Es lo que evita pedirle la contraseña a
    alguien que solo vino a renombrar un título en un dashboard bloqueado.

    Lo que sí corta de inmediato (con `CarteraError`) es una contraseña PRESENTE y equivocada, o
    una cuenta con demasiados intentos fallidos: son intentos de adivinar, no cambios inocentes.

    `accion` es la descripción de lo que se intentaba ('eliminar un componente', 'restablecer el
    diseño'): va en el mensaje que ve la persona y en el evento de auditoría, para que el registro
    diga qué se desbloqueó y no solo que alguien escribió su contraseña.
    """
    if not esta_bloqueado(dashboard_id):
        # Sin bloqueo no hay nada que confirmar; se responde `True` para que un llamador que use
        # este valor como "puede tocar la estructura" no tenga que preguntar dos cosas.
        return True

    usuario = request.user
    entregada = (request.data or {}).get(CAMPO_CONFIRMACION) or ''
    if not entregada:
        return False
    from apps.permissions.authorization import user_has_permission

    # Desbloquear pide su permiso (21/10/2026; antes, ser superusuario).
    if not user_has_permission(usuario, 'dashboard.desbloquear'):
        _fallar(
            f'El diseño de este dashboard está bloqueado: no se puede {accion}. '
            'Solo quien tiene «Desbloquear el diseño de un dashboard» puede hacerlo.',
            CODIGO_BLOQUEADO, puede_confirmar=False,
        )

    identificador = BruteForceProtectionService.identificador_canonico(None, usuario=usuario)
    ip, user_agent = request_meta(request)
    if BruteForceProtectionService.esta_bloqueado(identificador, ip_address=ip):
        _fallar(
            'Demasiados intentos fallidos. Esperá unos minutos antes de volver a intentarlo.',
            'CUENTA_BLOQUEADA_TEMPORALMENTE', puede_confirmar=False,
        )

    if not usuario.check_password(entregada):
        BruteForceProtectionService.registrar_intento(
            identifier=identificador, ip_address=ip, user=usuario, successful=False,
        )
        log_event(
            domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_DESBLOQUEO_FALLIDO',
            result=AuditEvent.Result.FAILED, actor=usuario, dashboard_id=dashboard_id,
            request=request, metadata={'accion': accion}, ip_address=ip, user_agent=user_agent,
            message=f'Contraseña incorrecta al intentar {accion} en un dashboard bloqueado.',
        )
        _fallar('La contraseña no es correcta.', 'CONFIRMACION_INVALIDA', puede_confirmar=True)


    # Un acierto NO se registra como intento exitoso de login: eso limpiaría el bloqueo por cuenta
    # de `esta_bloqueado` ("hubo un éxito reciente") y convertiría esta puerta en la forma de
    # desactivar la protección de fuerza bruta del login desde adentro.
    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_DESBLOQUEADO',
        actor=usuario, dashboard_id=dashboard_id, request=request,
        metadata={'accion': accion}, ip_address=ip, user_agent=user_agent,
        message=f'Desbloqueo confirmado con contraseña para {accion}.',
    )
    return True


def exigir_desbloqueo(request, dashboard_id, accion):
    """Igual que `confirmacion_valida`, pero corta la operación si no hubo confirmación.

    Es para las operaciones que son estructurales SIEMPRE —agregar un componente, restablecer el
    diseño—, donde no hay una variante inocua que dejar pasar.
    """
    if confirmacion_valida(request, dashboard_id, accion):
        return
    _fallar(
        f'El diseño de este dashboard está bloqueado. Para {accion}, confirmá tu contraseña.',
        CODIGO_BLOQUEADO, puede_confirmar=bool(getattr(request.user, 'is_superuser', False)),
    )
