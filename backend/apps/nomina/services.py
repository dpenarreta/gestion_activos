"""Las reglas de la consulta del rol de pagos.

- **De quién**: el código de empleado sale de la sesión (su ficha de empleado
  o, si no la tiene, su usuario de inicio de sesión); nunca de lo que mande la
  pantalla. Otro código solo con `roles_pago.consultar_todos`.
- **Para ver**: en cada consulta se aceptan los términos vigentes (se guarda
  el texto tal cual se aceptó) y se confirma la contraseña de la cuenta. Los
  intentos se limitan y los fallidos quedan en la auditoría.
- **El PDF no se guarda**: se arma al vuelo y se vuelve a armar para enviarlo.
- **Enviarlo**: al correo que la persona escriba en ese momento o al que
  guardó. Solo se envía lo que consultó en los últimos 15 minutos. El correo
  escrito no se guarda salvo que lo pida y acepte el tratamiento de datos.
"""

import datetime

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMessage
from django.core.validators import validate_email
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.permissions.authorization import user_has_permission

from . import fuente, pdf
from .models import ConfiguracionRolPagos, ConsultaRolPagos

VIGENCIA_ENVIO = datetime.timedelta(minutes=15)
ENVIOS_POR_CONSULTA = 3


def configuracion() -> ConfiguracionRolPagos:
    actual = ConfiguracionRolPagos.objects.first()
    return actual or ConfiguracionRolPagos.objects.create()


def guardar_configuracion(terminos: str, consentimiento_correo: str) -> ConfiguracionRolPagos:
    """Guarda los textos; si cambian los términos, sube su versión (quien
    consulte después los acepta de nuevo)."""
    config = configuracion()
    terminos = terminos.strip()
    if terminos != config.terminos:
        config.version += 1
    config.terminos = terminos
    config.consentimiento_correo = consentimiento_correo.strip()
    config.save()
    return config


def codigo_de(usuario) -> str:
    """El código de empleado de la sesión: el que la administración le
    asignó a su cuenta (Configuración → Usuarios). Vacío si no tiene."""
    return (usuario.codigo_empleado or "").strip()


def consulta_otros(usuario) -> bool:
    return user_has_permission(usuario, "roles_pago.consultar_todos")


def _nombre_empresa() -> str:
    empresa = empresa_actual()
    return "" if empresa in (None, SIN_EMPRESA) else empresa.nombre


def _validar_periodo(anio, mes):
    hoy = timezone.localdate()
    if not 1 <= mes <= 12 or anio < 2000:
        raise ValidationError({"mes": "Elija un año y un mes válidos."})
    if (anio, mes) > (hoy.year, hoy.month):
        raise ValidationError({"mes": "Ese mes todavía no ha llegado."})


def consultar(usuario, *, anio, mes, acepto, version, password, codigo=None, ip=None, navegador=""):
    """Valida todo, deja la constancia y devuelve `(consulta, pdf_bytes)`."""
    config = configuracion()
    if not acepto:
        raise ValidationError({"acepto": "Para ver su rol de pagos, acepte los términos."})
    if version != config.version:
        raise ValidationError(
            {"acepto": "Los términos cambiaron mientras los leía: revíselos y acéptelos de nuevo."}
        )
    if not password or not usuario.check_password(password):
        raise PermissionDenied("La contraseña no es correcta.")
    propio = codigo_de(usuario)
    codigo = (codigo or "").strip() or propio
    if not codigo:
        raise ValidationError(
            {"codigo": "Su cuenta no tiene código de empleado: pídalo a Talento Humano."}
        )
    if codigo != propio and not consulta_otros(usuario):
        raise PermissionDenied("Solo puede consultar su propio rol de pagos.")
    _validar_periodo(anio, mes)
    rol = fuente.obtener(codigo, anio, mes, _nombre_empresa())
    contenido = pdf.construir(rol)
    consulta = ConsultaRolPagos.objects.create(
        usuario=usuario,
        codigo_empleado=codigo,
        anio=anio,
        mes=mes,
        version_terminos=config.version,
        terminos_aceptados=config.terminos,
        ip=ip,
        navegador=(navegador or "")[:300],
    )
    return consulta, contenido


def enmascarar(correo: str) -> str:
    """«d***@gmail.com»: para mostrar o registrar sin exponer el correo."""
    if not correo or "@" not in correo:
        return ""
    usuario, dominio = correo.split("@", 1)
    return f"{usuario[:1]}***@{dominio}"


def correo_guardado(usuario) -> str:
    from apps.organizacion.models import DatosDeContacto

    perfil = DatosDeContacto.objects.filter(usuario=usuario).first()
    return perfil.correo_personal if perfil else ""


def guardar_correo(usuario, correo: str | None):
    """Guarda (con consentimiento) o borra el correo personal."""
    from apps.organizacion.models import DatosDeContacto

    perfil = DatosDeContacto.objects.filter(usuario=usuario).first()
    if perfil is None:
        if not correo:
            return
        perfil = DatosDeContacto(usuario=usuario)
    perfil.correo_personal = correo or ""
    perfil.correo_personal_aceptado_en = timezone.now() if correo else None
    perfil.save()


def enviar(usuario, consulta_id, *, correo="", guardar=False, acepto_guardar=False):
    """Vuelve a generar el PDF de una consulta reciente y lo envía. Devuelve el
    correo enmascarado al que se envió."""
    consulta = ConsultaRolPagos.objects.filter(pk=consulta_id, usuario=usuario).first()
    if consulta is None:
        raise NotFound("No se encontró la consulta.")
    if timezone.now() - consulta.created_at > VIGENCIA_ENVIO:
        raise ValidationError({"detail": "La consulta venció: vuelva a consultar su rol de pagos."})
    if consulta.envios >= ENVIOS_POR_CONSULTA:
        raise ValidationError({"detail": "Ya envió este rol varias veces: vuelva a consultarlo."})
    correo = (correo or "").strip().lower()
    if correo:
        try:
            validate_email(correo)
        except DjangoValidationError:
            raise ValidationError({"correo": "Escriba un correo válido."}) from None
        if guardar and not acepto_guardar:
            raise ValidationError(
                {"acepto_guardar": "Para guardar su correo, acepte el tratamiento de datos."}
            )
    else:
        correo = correo_guardado(usuario)
        if not correo:
            raise ValidationError({"correo": "Escriba el correo al que quiere enviarlo."})

    rol = fuente.obtener(consulta.codigo_empleado, consulta.anio, consulta.mes, _nombre_empresa())
    contenido = pdf.construir(rol)
    nombre = f"rol-de-pagos-{consulta.anio}-{consulta.mes:02d}.pdf"
    mensaje = EmailMessage(
        subject=f"Su rol de pagos de {rol.nombre_mes.lower()} {consulta.anio}",
        body=(
            "Adjuntamos el rol de pagos que solicitó desde el sistema.\n\n"
            "Es información personal y confidencial. Si usted no lo pidió, "
            "comuníquelo a Talento Humano."
        ),
        to=[correo],
    )
    mensaje.attach(nombre, contenido, "application/pdf")
    mensaje.send(fail_silently=False)
    consulta.envios += 1
    consulta.save(update_fields=["envios", "updated_at"])
    if guardar and acepto_guardar:
        guardar_correo(usuario, correo)
    return enmascarar(correo)
