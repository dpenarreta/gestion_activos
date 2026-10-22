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
import io
import re
import zipfile
from pathlib import PurePath

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMessage
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.core.audit import record_audit_event
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


#: Cuántos archivos puede llevar una respuesta a una observación.
ADJUNTOS_POR_RESPUESTA = 5
_IMAGENES = {".jpg", ".jpeg", ".png", ".webp"}


def _validar_adjuntos(archivos) -> list:
    """Imágenes, PDF, Word o Excel de hasta 10 MB, con el contenido que dice
    su extensión (las mismas reglas que los adjuntos de los activos)."""
    from rest_framework import serializers

    from apps.adjuntos.validators import validar_archivo

    archivos = list(archivos or [])
    if len(archivos) > ADJUNTOS_POR_RESPUESTA:
        raise ValidationError(
            {"archivos": f"Adjunte hasta {ADJUNTOS_POR_RESPUESTA} archivos por respuesta."}
        )
    for archivo in archivos:
        try:
            validar_archivo(archivo)
        except serializers.ValidationError as error:
            raise ValidationError({"archivos": f"«{archivo.name}»: {error.detail[0]}"}) from None
    return archivos


def corregir(actor, observacion_id, nota, archivos=None):
    """Talento Humano corrigió el rol: pide a la persona que vuelva a
    revisarlo y confirmar; avisa a ella y al resto de Talento Humano. La
    respuesta puede llevar imágenes o archivos, que quedan en el historial."""
    from apps.notificaciones import services as campana

    from .models import AdjuntoObservacion, MensajeObservacion, ObservacionRolPagos

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
    archivos = _validar_adjuntos(archivos)
    observacion.estado = ObservacionRolPagos.Estado.CORREGIDA
    observacion.corregida_por = actor
    observacion.corregida_en = timezone.now()
    observacion.save(update_fields=["estado", "corregida_por", "corregida_en", "updated_at"])
    mensaje = MensajeObservacion.objects.create(
        observacion=observacion, autor=actor, tipo=MensajeObservacion.Tipo.CORRECCION, texto=nota
    )
    for archivo in archivos:
        AdjuntoObservacion.objects.create(
            mensaje=mensaje,
            archivo=archivo,
            nombre_original=(archivo.name or "archivo")[:255],
            content_type=(getattr(archivo, "content_type", "") or "")[:120],
            tamano=archivo.size,
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


def _adjuntos(mensaje) -> list[dict]:
    return [
        {
            "id": a.id,
            "nombre": a.nombre_original,
            "tamano": a.tamano,
            "es_imagen": PurePath(a.nombre_original).suffix.lower() in _IMAGENES,
        }
        for a in mensaje.adjuntos.all()
    ]


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
    mensajes = list(observacion.mensajes.select_related("autor").prefetch_related("adjuntos"))
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
                "adjuntos": _adjuntos(m),
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
        "mensajes__autor", "mensajes__adjuntos"
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
                    "adjuntos": _adjuntos(m),
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


# --- Lista de habilitados (22/10/2026) --------------------------------------------------
#
# Consultar el rol de pagos no se da por rol ni por cargo: se da a las personas
# que aceptaron recibir y validar su rol de pagos virtual, una por una, con el
# permiso directo `roles_pago.consultar`. Lo gestiona quien tiene
# `roles_pago.habilitar` (nómina), que también edita el código de empleado.

PERMISO_CONSULTA = "roles_pago.consultar"
MODULO = "roles_pago"


def habilitado(usuario) -> bool:
    return user_has_permission(usuario, PERMISO_CONSULTA)


def gestiona_habilitados(usuario) -> bool:
    return user_has_permission(usuario, "roles_pago.habilitar")


def _exigir_gestion(actor):
    if not gestiona_habilitados(actor):
        raise PermissionDenied("No tiene el permiso requerido: roles_pago.habilitar.")


def _permiso_consulta():
    from django.contrib.auth.models import Permission

    return Permission.objects.get(content_type__app_label="permissions", codename=PERMISO_CONSULTA)


def _persona_dict(usuario) -> dict:
    return {
        "id": usuario.id,
        "nombre": _nombre(usuario),
        "correo": usuario.email,
        "codigo": usuario.codigo_empleado or "",
        "habilitado": usuario.user_permissions.filter(codename=PERMISO_CONSULTA).exists(),
    }


def habilitados(actor, buscar: str = "") -> list[dict]:
    """Las personas de la empresa: primero las habilitadas, con su código."""
    from django.db.models import Q

    from apps.chat.services import personas_de_la_empresa

    _exigir_gestion(actor)
    personas = personas_de_la_empresa().prefetch_related("user_permissions")
    buscar = (buscar or "").strip()
    if buscar:
        personas = personas.filter(
            Q(first_name__icontains=buscar)
            | Q(last_name__icontains=buscar)
            | Q(email__icontains=buscar)
            | Q(codigo_empleado__icontains=buscar)
        )
    filas = [_persona_dict(p) for p in personas.order_by("first_name", "last_name")[:300]]
    return sorted(filas, key=lambda f: (not f["habilitado"], f["nombre"].lower()))


@transaction.atomic
def habilitar(actor, usuario, *, habilitado_: bool, codigo: str | None = None) -> dict:
    """Agrega o quita a la persona de la lista y, si se indica, fija su código."""
    from apps.users.serializers import validar_codigo_empleado

    _exigir_gestion(actor)
    permiso = _permiso_consulta()
    antes = _persona_dict(usuario)
    if codigo is not None:
        codigo = (codigo or "").strip()
        try:
            usuario.codigo_empleado = (
                validar_codigo_empleado(codigo, exclude_user_id=usuario.pk) if codigo else None
            )
        except ValidationError as error:
            raise ValidationError({"codigo": error.detail}) from error
        usuario.save(update_fields=["codigo_empleado", "updated_at"])
    if habilitado_:
        if not (usuario.codigo_empleado or "").strip():
            raise ValidationError({"codigo": "Para habilitarla, escriba su código de empleado."})
        usuario.user_permissions.add(permiso)
    else:
        usuario.user_permissions.remove(permiso)
    despues = _persona_dict(usuario)
    record_audit_event(
        actor=actor,
        action="roles_pago.habilitados.cambiado",
        target=usuario,
        module=MODULO,
        previous_values={"habilitado": antes["habilitado"], "codigo": antes["codigo"]},
        new_values={"habilitado": despues["habilitado"], "codigo": despues["codigo"]},
    )
    return despues


def adjunto_de_observacion(actor, adjunto_id):
    """Un adjunto de una respuesta: lo abren la persona de la observación y
    Talento Humano (quien atiende observaciones o ve el historial)."""
    from .models import AdjuntoObservacion

    adjunto = (
        AdjuntoObservacion.objects.select_related("mensaje__observacion")
        .filter(pk=adjunto_id)
        .first()
    )
    if adjunto is None:
        raise NotFound("No se encontró el archivo.")
    propia = adjunto.mensaje.observacion.usuario_id == actor.pk
    if not (propia or atiende_observaciones(actor) or ve_historial(actor)):
        raise NotFound("No se encontró el archivo.")
    return adjunto


def mis_observaciones(usuario) -> list[dict]:
    """Las observaciones de la persona a sus roles de pagos, en todos sus
    estados y con su conversación. Solo las suyas."""
    from .models import ObservacionRolPagos

    return [
        _fila(o, con_mensajes=True)
        for o in ObservacionRolPagos.objects.filter(usuario=usuario).select_related("usuario")
    ]


# --- Descarga masiva por área (22/10/2026) ----------------------------------------------
#
# Talento Humano (`roles_pago.descarga_masiva`: nómina, Administrador y
# Superusuario) elige un área del organigrama y un mes, y descarga un ZIP sin
# clave con un PDF por persona. El área incluye las unidades que dependen de
# ella, como el organigrama por área. Los PDF se arman al vuelo desde nómina
# (no se guardan); quien no tiene código o no tiene rol ese mes queda en
# «LEEME.txt» dentro del archivo. Pide la contraseña de quien descarga.

PERMISO_MASIVA = "roles_pago.descarga_masiva"
_NO_VALE_EN_ARCHIVO = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def descarga_masiva_permitida(usuario) -> bool:
    return user_has_permission(usuario, PERMISO_MASIVA)


def _exigir_masiva(actor):
    if not descarga_masiva_permitida(actor):
        raise PermissionDenied(f"No tiene el permiso requerido: {PERMISO_MASIVA}.")


def _rama(unidad_id, unidades) -> set[int]:
    hijas = {}
    for u in unidades:
        hijas.setdefault(u.padre_id, []).append(u.id)
    rama, pendientes = set(), [unidad_id]
    while pendientes:
        actual = pendientes.pop()
        if actual not in rama:
            rama.add(actual)
            pendientes.extend(hijas.get(actual, []))
    return rama


def _personas_de(unidades_ids) -> list:
    """Las personas activas cuyo cargo está en esas unidades (una vez cada
    una), ordenadas por apellido."""
    from apps.organizacion.models import DatosDeContacto

    vistas, personas = set(), []
    filas = (
        DatosDeContacto.objects.filter(cargo__unidad_id__in=unidades_ids, usuario__is_active=True)
        .select_related("usuario")
        .order_by("usuario__last_name", "usuario__first_name")
    )
    for fila in filas:
        if fila.usuario_id not in vistas:
            vistas.add(fila.usuario_id)
            personas.append(fila.usuario)
    return personas


def areas_para_descarga(actor) -> list[dict]:
    """Las áreas del organigrama, con cuántas personas tienen (con y sin
    código de empleado), para elegir de cuál descargar."""
    from apps.organizacion.models import UnidadOrganizacional

    _exigir_masiva(actor)
    unidades = list(UnidadOrganizacional.objects.select_related("nivel"))
    filas = []
    for u in sorted(unidades, key=lambda x: (x.nivel.orden, x.nombre)):
        personas = _personas_de(_rama(u.id, unidades))
        filas.append(
            {
                "id": u.id,
                "nombre": u.nombre,
                "nivel": u.nivel.nombre,
                "personas": len(personas),
                "con_codigo": sum(1 for p in personas if codigo_de(p)),
            }
        )
    return filas


def _nombre_de_archivo(texto: str) -> str:
    limpio = _NO_VALE_EN_ARCHIVO.sub(" ", texto or "")
    return re.sub(r"\s+", " ", limpio).strip(" .")[:120] or "sin nombre"


def descarga_masiva(actor, unidad_id, anio, mes, password) -> dict:
    """El ZIP con los roles de pagos del área en ese mes: `{nombre, contenido,
    incluidos, omitidos}`."""
    from apps.organizacion.models import UnidadOrganizacional

    _exigir_masiva(actor)
    if not password or not actor.check_password(password):
        raise PermissionDenied("La contraseña no es correcta.")
    _validar_periodo(anio, mes)
    unidades = list(UnidadOrganizacional.objects.all())
    unidad = next((u for u in unidades if u.id == unidad_id), None)
    if unidad is None:
        raise NotFound("Esa área no existe en el organigrama.")
    personas = _personas_de(_rama(unidad.id, unidades))
    if not personas:
        raise ValidationError({"unidad": "Nadie ocupa un cargo en esa área."})

    empresa = _nombre_empresa()
    archivos, omitidos, usados = [], [], set()
    for persona in personas:
        nombre = persona.get_full_name().strip() or persona.username
        codigo = codigo_de(persona)
        if not codigo:
            omitidos.append(f"{nombre}: no tiene código de empleado.")
            continue
        try:
            rol = fuente.obtener(codigo, anio, mes, empresa)
        except fuente.RolNoDisponible:
            omitidos.append(f"{nombre} ({codigo}): no tiene rol de pagos en ese mes.")
            continue
        completo = f"{rol.apellidos} {rol.nombres}".strip() or nombre
        base = _nombre_de_archivo(f"{codigo} - {completo}")
        archivo, n = f"{base}.pdf", 2
        while archivo.lower() in usados:
            archivo, n = f"{base} ({n}).pdf", n + 1
        usados.add(archivo.lower())
        archivos.append((archivo, pdf.construir(rol)))
    if not archivos:
        raise ValidationError(
            {"mes": "Nadie de esa área tiene rol de pagos en ese mes: no hay nada que descargar."}
        )

    periodo = f"{fuente.MESES[mes - 1].capitalize()} {anio}"
    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w", zipfile.ZIP_DEFLATED) as zip_:
        for archivo, contenido in archivos:
            zip_.writestr(archivo, contenido)
        if omitidos:
            leeme = (
                f"Roles de pago de {unidad.nombre} - {periodo}\r\n"
                f"Incluidos: {len(archivos)} - Sin rol de pagos: {len(omitidos)}\r\n\r\n"
                + "\r\n".join(omitidos)
                + "\r\n"
            )
            zip_.writestr("LEEME.txt", leeme.encode("utf-8-sig"))
    return {
        "nombre": _nombre_de_archivo(f"Roles de pago - {unidad.nombre} - {periodo}") + ".zip",
        "contenido": memoria.getvalue(),
        "unidad": unidad,
        "incluidos": len(archivos),
        "omitidos": len(omitidos),
    }
