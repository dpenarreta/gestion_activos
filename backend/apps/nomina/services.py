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


# --- Conformidad con el rol -------------------------------------------------------------

VIGENCIA_CONFORMIDAD = datetime.timedelta(hours=24)


DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def constancia_de_conformidad(consulta) -> dict:
    """Cuándo (día, fecha y hora local) y desde dónde se respondió."""
    if not consulta.conformidad_en:
        return {}
    local = timezone.localtime(consulta.conformidad_en)
    return {
        "conformidad": consulta.conformidad,
        "conformidad_display": consulta.get_conformidad_display(),
        "conformidad_en": consulta.conformidad_en,
        "dia": DIAS_SEMANA[local.weekday()],
        "fecha": local.strftime("%d/%m/%Y"),
        "hora": local.strftime("%H:%M:%S"),
        "ip": consulta.conformidad_ip,
    }


def registrar_conformidad(usuario, consulta_id, conformidad, observacion="", ip=None, navegador=""):
    """La persona dice si está de acuerdo con su rol: una sola vez por
    consulta y solo del suyo. Una observación se avisa a Talento Humano (sin
    montos)."""

    consulta = ConsultaRolPagos.objects.filter(pk=consulta_id, usuario=usuario).first()
    if consulta is None:
        raise NotFound("No se encontró la consulta.")
    if consulta.codigo_empleado != codigo_de(usuario):
        raise ValidationError({"detail": "La conformidad es solo del rol propio."})
    if consulta.conformidad:
        raise ValidationError({"detail": "Ya respondió sobre este rol de pagos."})
    if timezone.now() - consulta.created_at > VIGENCIA_CONFORMIDAD:
        raise ValidationError({"detail": "La consulta venció: vuelva a consultar su rol."})
    if conformidad not in ConsultaRolPagos.Conformidad.values:
        raise ValidationError({"conformidad": "Respuesta desconocida."})
    observacion = (observacion or "").strip()
    if conformidad == ConsultaRolPagos.Conformidad.OBSERVACION and not observacion:
        raise ValidationError({"observacion": "Cuente qué no está correcto."})
    consulta.conformidad = conformidad
    consulta.conformidad_en = timezone.now()
    consulta.conformidad_ip = ip
    consulta.conformidad_navegador = (navegador or "")[:300]
    consulta.observacion = observacion[:2000]
    consulta.save(
        update_fields=[
            "conformidad",
            "conformidad_en",
            "conformidad_ip",
            "conformidad_navegador",
            "observacion",
            "updated_at",
        ]
    )
    if conformidad == ConsultaRolPagos.Conformidad.OBSERVACION:
        _observar(usuario, consulta, observacion)
    else:
        _confirmar(usuario, consulta)
    return consulta


# --- Observaciones (Talento Humano) --------------------------------------------------------

ENLACE_OBSERVACIONES = "/admin/institucional/rol-pagos/observaciones"


def atiende_observaciones(usuario) -> bool:
    return user_has_permission(usuario, "roles_pago.observaciones")


def _talento_humano(excepto=None):
    from apps.chat.services import personas_de_la_empresa

    return [
        u
        for u in personas_de_la_empresa()
        if atiende_observaciones(u) and (excepto is None or u.pk != excepto.pk)
    ]


def _nombre(usuario) -> str:
    return usuario.get_full_name().strip() or usuario.username


def _periodo(observacion) -> str:
    from .fuente import MESES

    return f"{MESES[observacion.mes - 1].lower()} {observacion.anio}"


def _observar(usuario, consulta, texto):
    """Crea (o reabre) la observación del período y avisa a Talento Humano."""
    from apps.notificaciones import services as campana

    from .models import MensajeObservacion, ObservacionRolPagos

    observacion = (
        ObservacionRolPagos.objects.filter(
            usuario=usuario,
            codigo_empleado=consulta.codigo_empleado,
            anio=consulta.anio,
            mes=consulta.mes,
        )
        .order_by("-created_at")
        .first()
    )
    if observacion is None:
        observacion = ObservacionRolPagos.objects.create(
            usuario=usuario,
            codigo_empleado=consulta.codigo_empleado,
            anio=consulta.anio,
            mes=consulta.mes,
        )
        titulo = "Nueva observación a un rol de pagos"
    else:
        observacion.estado = ObservacionRolPagos.Estado.ABIERTA
        observacion.cerrada_en = None
        observacion.save(update_fields=["estado", "cerrada_en", "updated_at"])
        titulo = "Reabrieron una observación al rol de pagos"
    MensajeObservacion.objects.create(
        observacion=observacion,
        autor=usuario,
        tipo=MensajeObservacion.Tipo.OBSERVACION,
        texto=texto,
    )
    campana.notificar(
        _talento_humano(excepto=usuario),
        tipo="roles_pago.observacion",
        titulo=titulo,
        resumen=f"{_nombre(usuario)} · {_periodo(observacion)}: {texto[:160]}",
        enlace=f"{ENLACE_OBSERVACIONES}?observacion={observacion.pk}",
    )
    return observacion


def _confirmar(usuario, consulta):
    """Si había una observación de ese período, la persona ya está de acuerdo:
    se cierra y se avisa a Talento Humano."""
    from apps.notificaciones import services as campana

    from .models import MensajeObservacion, ObservacionRolPagos

    observacion = (
        ObservacionRolPagos.objects.filter(
            usuario=usuario,
            codigo_empleado=consulta.codigo_empleado,
            anio=consulta.anio,
            mes=consulta.mes,
        )
        .exclude(estado=ObservacionRolPagos.Estado.CERRADA)
        .first()
    )
    if observacion is None:
        return None
    observacion.estado = ObservacionRolPagos.Estado.CERRADA
    observacion.cerrada_en = timezone.now()
    observacion.save(update_fields=["estado", "cerrada_en", "updated_at"])
    MensajeObservacion.objects.create(
        observacion=observacion,
        autor=usuario,
        tipo=MensajeObservacion.Tipo.CONFIRMACION,
        texto=consulta.get_conformidad_display(),
    )
    campana.notificar(
        _talento_humano(excepto=usuario),
        tipo="roles_pago.observacion",
        titulo="Confirmaron un rol de pagos corregido",
        resumen=f"{_nombre(usuario)} está de acuerdo con su rol de {_periodo(observacion)}.",
        enlace=f"{ENLACE_OBSERVACIONES}?observacion={observacion.pk}",
    )
    return observacion


def corregir(actor, observacion_id, nota):
    """Talento Humano corrigió el rol: pide a la persona que vuelva a
    revisarlo y confirmar; avisa a ella y al resto de Talento Humano."""
    from apps.notificaciones import services as campana

    from .models import MensajeObservacion, ObservacionRolPagos

    if not atiende_observaciones(actor):
        raise PermissionDenied("No tiene el permiso requerido: roles_pago.observaciones.")
    observacion = ObservacionRolPagos.objects.filter(pk=observacion_id).first()
    if observacion is None:
        raise NotFound("No se encontró la observación.")
    if observacion.estado != ObservacionRolPagos.Estado.ABIERTA:
        raise ValidationError({"detail": "La observación no está por atender."})
    nota = (nota or "").strip()
    if not nota:
        raise ValidationError({"nota": "Cuente qué se corrigió."})
    observacion.estado = ObservacionRolPagos.Estado.CORREGIDA
    observacion.corregida_por = actor
    observacion.corregida_en = timezone.now()
    observacion.save(update_fields=["estado", "corregida_por", "corregida_en", "updated_at"])
    MensajeObservacion.objects.create(
        observacion=observacion, autor=actor, tipo=MensajeObservacion.Tipo.CORRECCION, texto=nota
    )
    campana.notificar(
        [observacion.usuario],
        tipo="roles_pago.corregido",
        titulo=f"Su rol de pagos de {_periodo(observacion)} fue corregido",
        resumen=f"{nota[:160]} Revíselo y confirme si está de acuerdo.",
        enlace=f"/admin/institucional/rol-pagos?anio={observacion.anio}&mes={observacion.mes}",
    )
    campana.notificar(
        _talento_humano(excepto=actor),
        tipo="roles_pago.observacion",
        titulo="Observación al rol de pagos corregida",
        resumen=f"{_nombre(actor)} corrigió el rol de {_nombre(observacion.usuario)} "
        f"({_periodo(observacion)}).",
        enlace=f"{ENLACE_OBSERVACIONES}?observacion={observacion.pk}",
    )
    return observacion


def _fila(observacion, con_mensajes=False) -> dict:
    datos = {
        "id": observacion.id,
        "persona": {"id": observacion.usuario_id, "nombre": _nombre(observacion.usuario)},
        "codigo": observacion.codigo_empleado,
        "anio": observacion.anio,
        "mes": observacion.mes,
        "estado": observacion.estado,
        "estado_display": observacion.get_estado_display(),
        "actualizada": observacion.updated_at,
        "ultima": "",
    }
    mensajes = list(observacion.mensajes.select_related("autor"))
    observaciones = [m for m in mensajes if m.tipo == "observacion"]
    if observaciones:
        datos["ultima"] = observaciones[-1].texto
    if con_mensajes:
        datos["mensajes"] = [
            {
                "id": m.id,
                "tipo": m.tipo,
                "tipo_display": m.get_tipo_display(),
                "autor": _nombre(m.autor) if m.autor_id else "",
                "texto": m.texto,
                "fecha": m.created_at,
            }
            for m in mensajes
        ]
    return datos


def observaciones(actor, estado=None) -> list[dict]:
    from .models import ObservacionRolPagos

    if not atiende_observaciones(actor):
        raise PermissionDenied("No tiene el permiso requerido: roles_pago.observaciones.")
    consulta = ObservacionRolPagos.objects.select_related("usuario")
    if estado:
        consulta = consulta.filter(estado=estado)
    return [_fila(o) for o in consulta[:300]]


def observacion(actor, observacion_id) -> dict:
    from .models import ObservacionRolPagos

    if not atiende_observaciones(actor):
        raise PermissionDenied("No tiene el permiso requerido: roles_pago.observaciones.")
    encontrada = (
        ObservacionRolPagos.objects.select_related("usuario").filter(pk=observacion_id).first()
    )
    if encontrada is None:
        raise NotFound("No se encontró la observación.")
    return _fila(encontrada, con_mensajes=True)


def por_confirmar(usuario) -> list[dict]:
    """Las correcciones que la persona tiene pendientes de confirmar."""
    from .models import ObservacionRolPagos

    filas = []
    for o in ObservacionRolPagos.objects.filter(
        usuario=usuario, estado=ObservacionRolPagos.Estado.CORREGIDA
    ):
        correccion = o.mensajes.filter(tipo="correccion").order_by("-created_at").first()
        filas.append(
            {
                "id": o.id,
                "anio": o.anio,
                "mes": o.mes,
                "nota": correccion.texto if correccion else "",
            }
        )
    return filas


# --- Historial por código de empleado (Talento Humano) -------------------------------------


def ve_historial(usuario) -> bool:
    return user_has_permission(usuario, "roles_pago.historial")


def _momento(fecha):
    if not fecha:
        return None
    local = timezone.localtime(fecha)
    return {
        "fecha_hora": fecha,
        "dia": DIAS_SEMANA[local.weekday()],
        "fecha": local.strftime("%d/%m/%Y"),
        "hora": local.strftime("%H:%M:%S"),
    }


def historial(actor, codigo: str) -> dict:
    """Todo lo de un código de empleado, por período (lo más reciente
    primero): cada consulta (quién, cuándo aceptó los términos y desde dónde),
    su conformidad (cuándo y desde dónde) y, si hubo, la observación con su
    corrección y su confirmación. Nunca montos."""
    from apps.users.models import User

    from .models import ObservacionRolPagos

    if not ve_historial(actor):
        raise PermissionDenied("No tiene el permiso requerido: roles_pago.historial.")
    codigo = (codigo or "").strip()
    if not codigo:
        raise ValidationError({"codigo": "Escriba el código de empleado."})
    persona = User.objects.filter(codigo_empleado__iexact=codigo).first()

    periodos: dict[tuple, dict] = {}

    def periodo(anio, mes):
        import calendar

        ultimo = calendar.monthrange(anio, mes)[1]
        return periodos.setdefault(
            (anio, mes),
            {
                "anio": anio,
                "mes": mes,
                # Los días que cubre ese rol de pagos.
                "desde": f"01/{mes:02d}/{anio}",
                "hasta": f"{ultimo:02d}/{mes:02d}/{anio}",
                "consultas": [],
                "observacion": None,
            },
        )

    for c in ConsultaRolPagos.objects.filter(codigo_empleado=codigo).select_related("usuario"):
        periodo(c.anio, c.mes)["consultas"].append(
            {
                "id": c.id,
                "por": _nombre(c.usuario),
                "propia": c.usuario_id == getattr(persona, "pk", None),
                "consultada": _momento(c.created_at),
                "ip": c.ip,
                "version_terminos": c.version_terminos,
                "envios": c.envios,
                "conformidad": c.conformidad,
                "conformidad_display": c.get_conformidad_display() if c.conformidad else "",
                "conformidad_en": _momento(c.conformidad_en),
                "conformidad_ip": c.conformidad_ip,
            }
        )
    for o in ObservacionRolPagos.objects.filter(codigo_empleado=codigo).prefetch_related(
        "mensajes__autor"
    ):
        periodo(o.anio, o.mes)["observacion"] = {
            "id": o.id,
            "estado": o.estado,
            "estado_display": o.get_estado_display(),
            "mensajes": [
                {
                    "tipo": m.tipo,
                    "tipo_display": m.get_tipo_display(),
                    "autor": _nombre(m.autor) if m.autor_id else "",
                    "texto": m.texto,
                    "momento": _momento(m.created_at),
                }
                for m in o.mensajes.all()
            ],
        }
    ordenados = sorted(periodos.values(), key=lambda p: (p["anio"], p["mes"]), reverse=True)
    for p in ordenados:
        p["consultas"].sort(key=lambda c: c["consultada"]["fecha_hora"], reverse=True)
    return {
        "codigo": codigo,
        "persona": (
            {"id": persona.id, "nombre": _nombre(persona), "correo": persona.email}
            if persona
            else None
        ),
        "periodos": ordenados,
    }


def rol_desde_historial(actor, codigo, anio, mes, password) -> bytes:
    """El PDF de un rol del historial, vuelto a generar desde nómina (no se
    guarda). Pide `roles_pago.historial` y la contraseña de quien lo abre."""
    if not ve_historial(actor):
        raise PermissionDenied("No tiene el permiso requerido: roles_pago.historial.")
    if not password or not actor.check_password(password):
        raise PermissionDenied("La contraseña no es correcta.")
    codigo = (codigo or "").strip()
    if not codigo:
        raise ValidationError({"codigo": "Falta el código de empleado."})
    _validar_periodo(anio, mes)
    return pdf.construir(fuente.obtener(codigo, anio, mes, _nombre_empresa()))
