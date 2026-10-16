"""Avisos de entrada y salida del taller.

Se disparan por el hecho, no por un reloj: quien responde por un equipo se
entera de que se lo llevaron a reparar en el momento en que se registra, y de
que volvió cuando vuelve. Un resumen diario llegaría cuando ya lo había
notado por el hueco en su escritorio.

Un mantenimiento **abierto** —sin fecha de salida— significa que el equipo está
en el taller; ponerle la fecha es sacarlo. De ahí salen los dos avisos, y de ahí
sale también el caso de la reparación que se registra ya cerrada —se arregló en
el sitio, en diez minutos—: esa manda un solo aviso, el de salida, porque
contar que entró y salió en el mismo correo es contar que se hizo.

El envío va **después de confirmar la transacción**: si se mandara dentro, un
servidor de correo lento retrasaría el guardado, y uno caído podría deshacer
una reparación ya registrada por no haber podido avisar de ella.
"""

from django.conf import settings
from django.db import transaction

from apps.alertas import eventos


def _activado() -> bool:
    """Se pueden apagar sin tocar el resumen del §19, que es otra cosa."""
    return getattr(settings, "AVISAR_EVENTOS_DE_MANTENIMIENTO", True)


def _fecha(valor) -> str:
    return valor.strftime("%d/%m/%Y") if valor else ""


def variables(mantenimiento) -> dict:
    """Las variables de los avisos de entrada y salida del taller."""
    from apps.activos.notificaciones import variables_del_equipo

    activo = mantenimiento.activo
    return {
        **variables_del_equipo(activo),
        "responsables": activo.resumen_de_responsables or "nadie",
        "fecha_ingreso": _fecha(mantenimiento.fecha_intervencion),
        "tipo_mantenimiento": mantenimiento.get_tipo_display(),
        "atiende": str(mantenimiento.responsable or ""),
        "causa": mantenimiento.causa or "",
        "fecha_salida": _fecha(mantenimiento.fecha_salida),
        "dias_fuera": str(mantenimiento.dias_fuera_de_operacion or 0),
        "resultado": (
            mantenimiento.get_estado_final_display() if mantenimiento.estado_final else ""
        ),
        "solucion": mantenimiento.solucion or "",
    }


def al_entrar_al_taller(mantenimiento, actor) -> eventos.Destinatarios:
    """Avisa de que el equipo entró a reparación."""
    return _avisar(mantenimiento, actor, clave="mantenimientos.entrada")


def al_salir_del_taller(mantenimiento, actor) -> eventos.Destinatarios:
    """Avisa de que el equipo volvió, y en qué estado."""
    return _avisar(mantenimiento, actor, clave="mantenimientos.salida")


def _avisar(mantenimiento, actor, *, clave: str) -> eventos.Destinatarios:
    """Resuelve a quién y programa el envío para después del `commit`.

    Devuelve el reparto **en el acto**, aunque el correo salga más tarde: la
    pantalla tiene que poder decir «a Fulano no se le avisará» en la misma
    respuesta, y eso se sabe sin haber enviado nada.
    """
    destinatarios = eventos.resolver(mantenimiento.activo.responsables_ordenados, actor)
    if not _activado():
        return destinatarios

    datos = variables(mantenimiento)
    transaction.on_commit(
        lambda: eventos.enviar(clave=clave, variables=datos, destinatarios=destinatarios)
    )
    return destinatarios
