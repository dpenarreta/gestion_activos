"""Lógica del envío programado del resumen de alertas (§19).

Vive aquí y no en la vista ni en el comando porque tiene tres puntos de
entrada —el cron, el botón de prueba y las pruebas automatizadas— y las tres
tienen que decidir lo mismo: si toca enviar hoy, a quién, y qué se registra
cuando no se envía.
"""

from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.permissions.authorization import user_has_permission

from .emails import enviar_resumen
from .models import ConfiguracionAlertas, EnvioAlertas
from .reglas import construir_alertas

#: Quien recibe el resumen tiene que poder abrir el centro de alertas: el
#: correo enlaza al listado, y avisar a alguien de algo que no puede consultar
#: es filtrar información del parque a quien el sistema no autorizó a verla.
PERMISO_REQUERIDO = "alertas.ver"


def destinatarios_elegibles():
    """Usuarios que pueden ser destinatarios: activos, con correo y con
    permiso para ver las alertas."""
    User = get_user_model()
    candidatos = (
        User.objects.filter(is_active=True).exclude(email="").order_by("first_name", "username")
    )
    return [usuario for usuario in candidatos if user_has_permission(usuario, PERMISO_REQUERIDO)]


def destinatarios_vigentes(configuracion) -> list:
    """De los elegidos en la configuración, los que hoy siguen cumpliendo.

    El filtro se aplica al enviar y no al guardar a propósito: entre que se
    eligió a alguien y el correo de esta mañana pueden haberle revocado el
    permiso o dado de baja la cuenta, y en ese momento debe dejar de recibir
    sin que nadie tenga que acordarse de editar esta lista.
    """
    elegidos = configuracion.destinatarios.filter(is_active=True).exclude(email="")
    return [usuario for usuario in elegidos if user_has_permission(usuario, PERMISO_REQUERIDO)]


def _registrar(resultado, *, motivo="", destinatarios=None, alertas=None, origen=None):
    con_pendientes = [alerta for alerta in (alertas or []) if alerta.total > 0]
    return EnvioAlertas.objects.create(
        resultado=resultado,
        origen=origen or EnvioAlertas.Origen.PROGRAMADO,
        motivo=motivo,
        destinatarios=[usuario.id for usuario in (destinatarios or [])],
        total_alertas=len(con_pendientes),
        total_elementos=sum(alerta.total for alerta in con_pendientes),
    )


def ejecutar_envio_programado(*, hoy=None, forzar: bool = False) -> EnvioAlertas:
    """Evalúa y, si corresponde, envía el resumen del día.

    Devuelve siempre un registro de la bitácora, incluso cuando no se envía
    nada: el cron corre a diario y necesita dejar constancia de que pasó por
    aquí. Un día sin ninguna fila es un cron que no se ejecutó, y eso hay que
    poder distinguirlo de un día tranquilo.
    """
    hoy = hoy or timezone.localdate()
    configuracion = ConfiguracionAlertas.cargar()

    if not configuracion.notificaciones_activas and not forzar:
        return _registrar(
            EnvioAlertas.Resultado.OMITIDO, motivo="Las notificaciones están desactivadas."
        )

    if not forzar and not configuracion.toca_enviar_hoy(hoy):
        motivo = (
            "Ya se envió hoy."
            if configuracion.ultimo_envio == hoy
            else "Hoy no corresponde según la frecuencia configurada."
        )
        return _registrar(EnvioAlertas.Resultado.OMITIDO, motivo=motivo)

    destinatarios = destinatarios_vigentes(configuracion)
    if not destinatarios:
        return _registrar(
            EnvioAlertas.Resultado.OMITIDO,
            motivo="No hay destinatarios activos con permiso para ver las alertas.",
        )

    alertas = construir_alertas(configuracion)
    hay_pendientes = any(alerta.total > 0 for alerta in alertas)
    if not hay_pendientes and configuracion.omitir_si_no_hay_pendientes:
        # El correo que llega todos los días diciendo lo mismo deja de leerse,
        # y arrastra consigo al que sí traía algo.
        return _registrar(
            EnvioAlertas.Resultado.OMITIDO,
            motivo="No hay alertas pendientes y está configurado omitir esos días.",
            alertas=alertas,
        )

    error = enviar_resumen(alertas=alertas, direcciones=[u.email for u in destinatarios])
    if error:
        # `ultimo_envio` no se mueve: si el envío falló, mañana debe volver a
        # intentarse en vez de darse por hecho.
        return _registrar(
            EnvioAlertas.Resultado.FALLIDO,
            motivo=error,
            destinatarios=destinatarios,
            alertas=alertas,
        )

    ConfiguracionAlertas.objects.filter(pk=configuracion.pk).update(ultimo_envio=hoy)
    return _registrar(EnvioAlertas.Resultado.ENVIADO, destinatarios=destinatarios, alertas=alertas)


def enviar_prueba(*, usuario) -> EnvioAlertas:
    """Envía el resumen de hoy únicamente a quien lo solicita.

    A quien lo solicita y a nadie más, aunque haya destinatarios configurados:
    probar que el correo sale no debería costarle un aviso falso a media
    empresa, y un endpoint que manda correo a terceros es un remitente
    disponible para quien consiga una sesión.

    Tampoco toca `ultimo_envio`: la prueba no sustituye al envío del día.
    """
    configuracion = ConfiguracionAlertas.cargar()
    alertas = construir_alertas(configuracion)
    error = enviar_resumen(alertas=alertas, direcciones=[usuario.email], es_prueba=True)
    return _registrar(
        EnvioAlertas.Resultado.FALLIDO if error else EnvioAlertas.Resultado.ENVIADO,
        motivo=error or "",
        destinatarios=[usuario],
        alertas=alertas,
        origen=EnvioAlertas.Origen.PRUEBA,
    )
