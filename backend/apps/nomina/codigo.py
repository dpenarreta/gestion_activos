"""El código de 6 dígitos que llega al correo para consultar el rol de pagos.

US-002, 11/11/2026: la consulta del propio rol ya no pide la contraseña de la
cuenta. Al pulsar «Consultar» llega un código al correo de la cuenta
(`User.email`) y, al escribirlo bien, se abre el rol. Las reglas:

- **Solo el hash**: se guarda el HMAC-SHA256 (con `SECRET_KEY`) del código
  atado a la persona, a su código de empleado y al período; nunca el código.
  Se compara en tiempo constante (`hmac.compare_digest`).
- **Un solo uso y corto**: vence a los `VIGENCIA`, admite `INTENTOS` fallos
  (al último se anula) y, al acertar, queda usado.
- **Uno vigente por persona**: pedir otro anula los anteriores, en la misma
  transacción que crea el nuevo; si el correo nuevo no sale, el anterior
  vuelve a valer.
- **Una semana y fuera**: al emitir se borran los de más de `CONSERVAR`.
- **Envíos limitados**: `ESPERA_REENVIO` entre uno y otro y `MAXIMO_POR_HORA`
  por persona. Con 5 intentos por código y 5 códigos por hora, adivinarlo no
  es práctico (25 intentos por hora sobre 1 000 000 de combinaciones), así
  que los fallos no bloquean el inicio de sesión.
- **El correo, después del commit**: con la plantilla
  `roles_pago.codigo_consulta` (editable en Configuración), enviada
  directamente a la cuenta y no por `alertas.eventos.enviar`, que copia el
  asunto a la campana y lo deja en el registro del sistema: el código no se
  guarda en ningún otro sitio.
- **Nunca en registros**: ni en la auditoría, ni en los logs, ni en las
  respuestas de la API.
"""

import datetime
import hashlib
import hmac
import logging
import math
import secrets
from dataclasses import dataclass

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, Throttled, ValidationError

from .models import CodigoConsultaRol

logger = logging.getLogger(__name__)

#: Cuánto dura un código desde que se envía.
VIGENCIA = datetime.timedelta(minutes=10)
#: Fallos que admite un código; al último se anula.
INTENTOS = 5
#: Espera mínima entre un envío y el siguiente.
ESPERA_REENVIO = datetime.timedelta(seconds=60)
#: Códigos que una persona puede pedir en una hora.
MAXIMO_POR_HORA = 5
VENTANA = datetime.timedelta(hours=1)
#: Cuánto se guardan los códigos (ya sin uso) antes de borrarlos.
CONSERVAR = datetime.timedelta(days=7)

#: La plantilla del correo (`apps.correos.catalogo`).
PLANTILLA = "roles_pago.codigo_consulta"

DIGITOS = 6

SIN_CORREO = "Su cuenta no tiene un correo registrado: pídale a Talento Humano que lo registre."
INCORRECTO = "El código no es correcto."
VENCIDO = "El código venció: pida uno nuevo."
AGOTADO = "Ya no quedan intentos con este código: pida uno nuevo."
SIN_CODIGO = "Pida un código para consultar."
CAMPO = "codigo_verificacion"


class EsperaDeCodigo(Throttled):
    """El 429 de los envíos, con su propio mensaje (el genérico del manejador
    dice «Demasiadas solicitudes seguidas») y la espera en `retry_after`."""

    def __init__(self, wait: float, mensaje: str):
        super().__init__(wait=wait, detail=mensaje)
        self.mensaje = mensaje


class CorreoNoEnviado(APIException):
    status_code = 503
    default_detail = "No pudimos enviar el código a su correo. Intente de nuevo en unos minutos."
    default_code = "codigo_no_enviado"


@dataclass(frozen=True)
class CodigoEnviado:
    registro: CodigoConsultaRol
    enviado_a: str

    def respuesta(self) -> dict:
        return {
            "enviado_a": self.enviado_a,
            "vence_en": int(VIGENCIA.total_seconds()),
            "reenviar_en": int(ESPERA_REENVIO.total_seconds()),
        }


def _hash(usuario_id: int, codigo_empleado: str, anio: int, mes: int, codigo: str) -> str:
    """HMAC-SHA256 en hexadecimal. Lleva la persona, su código de empleado y
    el período: el mismo código para otra persona o período da otro hash."""
    mensaje = f"roles_pago.codigo:{usuario_id}:{codigo_empleado}:{anio}:{mes}:{codigo}"
    return hmac.new(settings.SECRET_KEY.encode(), mensaje.encode(), hashlib.sha256).hexdigest()


def _cuanto(segundos: int) -> str:
    if segundos < 60:
        return "1 segundo" if segundos == 1 else f"{segundos} segundos"
    minutos = math.ceil(segundos / 60)
    return "1 minuto" if minutos == 1 else f"{minutos} minutos"


def _exigir_cupo(usuario, ahora) -> None:
    """La espera entre envíos y el máximo por hora, por persona y en todas
    las empresas (es la misma bandeja de correo)."""
    recientes = list(
        CodigoConsultaRol.objects.todas()
        .filter(usuario=usuario, creado_en__gt=ahora - VENTANA)
        .order_by("creado_en")
        .values_list("creado_en", flat=True)
    )
    if not recientes:
        return
    espera = recientes[-1] + ESPERA_REENVIO - ahora
    if espera.total_seconds() > 0:
        segundos = math.ceil(espera.total_seconds())
        raise EsperaDeCodigo(segundos, f"Espere {_cuanto(segundos)} para pedir otro código.")
    if len(recientes) >= MAXIMO_POR_HORA:
        # Se libera un cupo cuando el más antiguo de la hora sale de la ventana.
        libre = recientes[-MAXIMO_POR_HORA] + VENTANA - ahora
        segundos = max(1, math.ceil(libre.total_seconds()))
        raise EsperaDeCodigo(
            segundos,
            f"Ya pidió {MAXIMO_POR_HORA} códigos en la última hora. "
            f"Podrá pedir otro en {_cuanto(segundos)}.",
        )


def emitir(usuario, *, codigo_empleado: str, anio: int, mes: int, enviado_a: str) -> CodigoEnviado:
    """Genera el código, anula los pendientes de la persona y lo envía al
    correo de su cuenta después del commit. Quien llama ya validó términos,
    período y permiso (`services.emitir_codigo`)."""
    correo = (usuario.email or "").strip()
    if not correo:
        raise ValidationError({CAMPO: SIN_CORREO})

    codigo = str(secrets.randbelow(10**DIGITOS)).zfill(DIGITOS)
    resultado: dict = {}
    with transaction.atomic(durable=True):
        # Bloquear la cuenta ordena los pedidos simultáneos (el doble clic):
        # el segundo ve al primero y se queda en la espera de 60 s.
        get_user_model().objects.select_for_update().filter(pk=usuario.pk).first()
        ahora = timezone.now()
        # Minimización (LOPDP): un código vale 10 minutos y el límite mira la
        # última hora; pasada una semana no sirve para nada y la constancia
        # de la consulta ya está en `ConsultaRolPagos` y en la auditoría. Se
        # borran los de todas las personas y empresas, sin tarea aparte.
        CodigoConsultaRol.objects.todas().filter(creado_en__lt=ahora - CONSERVAR).delete()
        _exigir_cupo(usuario, ahora)
        pendientes = CodigoConsultaRol.objects.todas().filter(
            usuario=usuario, usado_en__isnull=True, anulado_en__isnull=True
        )
        anulados = list(pendientes.values_list("pk", flat=True))
        pendientes.update(anulado_en=ahora)
        registro = CodigoConsultaRol.objects.create(
            usuario=usuario,
            codigo_empleado=codigo_empleado,
            anio=anio,
            mes=mes,
            hash_codigo=_hash(usuario.pk, codigo_empleado, anio, mes, codigo),
            vence_en=ahora + VIGENCIA,
            enviado_a=enviado_a,
        )
        transaction.on_commit(
            lambda: resultado.update(enviado=_enviar(usuario, correo, codigo, anio, mes, enviado_a))
        )
    # `on_commit` ya corrió al cerrar el bloque (es durable: no hay otro por
    # fuera). Si el correo no salió, el código nuevo no sirve: se borra (no
    # cuenta para el límite), el que la persona ya tenía vuelve a valer y se
    # dice, en vez de mostrar «Le enviamos un código».
    if resultado.get("enviado") is False:
        with transaction.atomic(durable=True):
            CodigoConsultaRol.objects.todas().filter(pk=registro.pk).delete()
            CodigoConsultaRol.objects.todas().filter(pk__in=anulados, anulado_en=ahora).update(
                anulado_en=None
            )
        raise CorreoNoEnviado()
    return CodigoEnviado(registro=registro, enviado_a=enviado_a)


def _enviar(usuario, correo: str, codigo: str, anio: int, mes: int, enviado_a: str) -> bool:
    """Envía el correo con la plantilla del catálogo. Nunca levanta y nunca
    registra el código: si falla, deja en el log solo el correo enmascarado."""
    from apps.correos import catalogo, servicio

    from .fuente import MESES

    variables = {
        "nombre": usuario.first_name or usuario.username,
        "codigo": codigo,
        "periodo": f"{MESES[mes - 1].lower()} de {anio}",
        "minutos": str(int(VIGENCIA.total_seconds() // 60)),
    }
    try:
        mensaje = servicio.renderizar(PLANTILLA, variables)
        if codigo not in mensaje["texto"]:
            # Una versión personalizada que perdió `{{codigo}}` dejaría a la
            # persona sin poder consultar: sale el diseño por defecto.
            por_defecto = catalogo.obtener(PLANTILLA)
            mensaje = servicio.renderizar(
                PLANTILLA, variables, asunto=por_defecto.asunto, html=por_defecto.html
            )
        send_mail(
            subject=mensaje["asunto"],
            message=mensaje["texto"],
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[correo],
            html_message=mensaje["html"],
        )
    except Exception:  # noqa: BLE001
        # Sin traza: el error del servidor de correo puede citar el mensaje.
        logger.error("No se pudo enviar el código del rol de pagos a %s", enviado_a)
        return False
    return True


def devolver(registro: CodigoConsultaRol) -> None:
    """Deshace el uso de un código cuando la consulta falló después de
    comprobarlo por algo ajeno a la persona (nómina caída, error al armar el
    PDF): sin esto tendría que pedir otro y gastar su cupo por hora. Solo si
    sigue con el uso que se le acaba de poner."""
    CodigoConsultaRol.objects.todas().filter(pk=registro.pk, usado_en=registro.usado_en).update(
        usado_en=None
    )


def verificar(
    usuario, *, codigo_empleado: str, anio: int, mes: int, valor: str
) -> CodigoConsultaRol:
    """Comprueba el código y lo marca usado. Cada fallo cuenta y, al
    `INTENTOS`, el código se anula. Los errores van en `codigo_verificacion`.

    El conteo se confirma antes de levantar el error: un fallo que se
    deshiciera con la excepción permitiría probar sin límite."""
    valor = (valor or "").strip()
    error = None
    with transaction.atomic(durable=True):
        registro = (
            CodigoConsultaRol.objects.select_for_update()
            .filter(usuario=usuario)
            .order_by("-creado_en", "-pk")
            .first()
        )
        ahora = timezone.now()
        if registro is None or registro.usado_en is not None:
            error = SIN_CODIGO
        elif registro.anulado_en is not None:
            error = AGOTADO if registro.intentos >= INTENTOS else SIN_CODIGO
        elif registro.vence_en <= ahora:
            error = VENCIDO
        else:
            # El período y el código de empleado van dentro del hash: uno de
            # otro período no coincide y cuenta como fallo.
            esperado = _hash(usuario.pk, codigo_empleado, anio, mes, valor)
            if hmac.compare_digest(esperado, registro.hash_codigo):
                registro.usado_en = ahora
                registro.save(update_fields=["usado_en", "updated_at"])
                return registro
            registro.intentos += 1
            campos = ["intentos", "updated_at"]
            if registro.intentos >= INTENTOS:
                registro.anulado_en = ahora
                campos.append("anulado_en")
                error = AGOTADO
            else:
                error = INCORRECTO
            registro.save(update_fields=campos)
    raise ValidationError({CAMPO: error})
