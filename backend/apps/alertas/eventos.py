"""A quién se avisa cuando pasa algo, y qué hacer si no se le puede avisar.

Esto **no es el resumen de alertas** del §19, que se manda cada día o cada
semana con lo que haya pendiente. Son avisos sueltos que dispara un hecho —un
equipo que entra al taller, uno que sale— y por eso no tienen frecuencia: o
salen cuando ocurre, o ya no tienen sentido.

La regla de a quién se le manda es la que vale la pena leer despacio, porque
tiene una parte que no es obvia:

1. Se avisa a **quien responde por el equipo**, al correo de su ficha de
   empleado.
2. Ese correo es opcional, y quien no lo tiene **no recibe nada**. No se
   silencia: la operación que disparó el aviso devuelve sus nombres para que la
   pantalla lo diga. Un aviso que no llega y nadie sabe que no llegó es peor que
   no tener avisos.
3. Si **nadie** pudo ser avisado, el correo va a quien hizo la acción —el
   técnico que registró la reparación, quien ingresó la compra—. Su cuenta
   siempre tiene correo, así que ese camino nunca se queda sin destinatario, y
   quien acaba de tocar el equipo es el que puede hacer algo con la noticia.

El punto 3 se aplica solo cuando **no se avisó a nadie**. Si de tres
responsables dos tienen correo y uno no, los dos reciben el aviso y el tercero
se reporta como no avisado: ya hay quien se entere, y sumar al técnico a cada
aviso convertiría su buzón en una copia del registro del sistema.
"""

import logging
from dataclasses import dataclass, field

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

logger = logging.getLogger("apps.alertas")


@dataclass
class Destinatarios:
    """El reparto de un aviso: quién lo recibe y quién se queda fuera."""

    #: Correos a los que se manda.
    direcciones: list[str] = field(default_factory=list)
    #: Nombres de quienes responden por el equipo y no tienen correo en su
    #: ficha. Viaja a la pantalla para poder decirlo.
    sin_correo: list[str] = field(default_factory=list)
    #: Si se recurrió a quien hizo la acción por no haber nadie más.
    por_defecto: bool = False

    @property
    def hay_a_quien_avisar(self) -> bool:
        return bool(self.direcciones)


def resolver(responsables, actor) -> Destinatarios:
    """Reparte el aviso entre los responsables y, si no hay, quien actuó.

    `responsables` son fichas de empleado —las que llevan el correo opcional—;
    `actor` es la cuenta que ejecutó la acción.
    """
    reparto = Destinatarios()
    vistos = set()

    for empleado in responsables or []:
        correo = (getattr(empleado, "correo", "") or "").strip()
        if not correo:
            reparto.sin_correo.append(empleado.nombre_completo)
        elif correo.lower() not in vistos:
            vistos.add(correo.lower())
            reparto.direcciones.append(correo)

    if not reparto.direcciones:
        correo_actor = (getattr(actor, "email", "") or "").strip()
        if correo_actor:
            reparto.direcciones.append(correo_actor)
            reparto.por_defecto = True

    return reparto


def enviar(
    *, clave: str, variables: dict, destinatarios: Destinatarios, prefijo_asunto: str = ""
) -> bool:
    """Manda el aviso con su plantilla (`apps.correos`). Devuelve si salió algo.

    Nunca levanta: un servidor de correo caído no puede impedir que se registre
    una reparación. El fallo se deja en el registro del sistema, que es donde
    se mira cuando alguien dice que no le llegó nada.
    """
    if not destinatarios.hay_a_quien_avisar:
        return False

    from apps.correos import servicio

    correo = servicio.renderizar(clave, variables)
    asunto = f"{prefijo_asunto}{correo['asunto']}"
    # La campana recibe el aviso aunque el correo no salga: así quien tiene
    # cuenta se entera igual si el SMTP está caído.
    from apps.notificaciones import services as campana

    campana.desde_correo(
        clave=clave, asunto=asunto, variables=variables, direcciones=destinatarios.direcciones
    )
    try:
        mensaje = EmailMultiAlternatives(
            subject=asunto,
            body=correo["texto"],
            from_email=settings.DEFAULT_FROM_EMAIL,
            # En copia oculta, como el resumen: quién más responde por un
            # equipo no es algo que cada destinatario necesite saber.
            bcc=destinatarios.direcciones,
        )
        mensaje.attach_alternative(correo["html"], "text/html")
        mensaje.send(fail_silently=False)
    except Exception:
        logger.exception(
            "No se pudo enviar el aviso «%s» a %s destinatario(s)",
            asunto,
            len(destinatarios.direcciones),
        )
        return False

    logger.info(
        "Aviso «%s» enviado a %s destinatario(s)%s",
        asunto,
        len(destinatarios.direcciones),
        " (a quien registró la acción, por no haber correo)" if destinatarios.por_defecto else "",
    )
    return True
