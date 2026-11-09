"""Reglas de las solicitudes de derechos sobre datos personales, portadas de
`apps.data_requests.services` de Nexo (`create_data_request`,
`resolve_data_request`, `export_my_data`).

Se conserva de Nexo:

- Cualquier cuenta pide; la solicitud nace PENDIENTE y quien atiende la mueve.
- **Nada irreversible automático.** Una ELIMINACION no borra nada: quien
  atiende la gestiona a mano (baja lógica de la cuenta, depuración puntual con
  sus comandos) y lo cuenta en la respuesta.
- La descarga de «mis datos» es inmediata y queda en la auditoría.

Lo que cambia, documentado donde ocurre:

1. **Estados.** Se suma RECHAZADA (ver `models`). Desde PENDIENTE se pasa a
   EN_PROCESO, RESUELTA o RECHAZADA; desde EN_PROCESO, a RESUELTA o RECHAZADA.
   Cerrar exige respuesta al titular. Una cerrada se puede reabrir (vuelve a
   EN_PROCESO) con su motivo: un cierre por error no debe obligar a pedir de
   nuevo. En Nexo cualquier estado pasaba a cualquiera y sin texto.
2. **Plazo legal.** Cada solicitud guarda su fecha límite
   (`PRIVACIDAD_PLAZO_DIAS`, 15 días corridos por defecto; ver `plazo_dias`).
3. **Idempotencia.** Pedir dos veces lo mismo (mismo tipo y misma descripción,
   todavía abierta) devuelve la que ya existe: un doble clic no crea dos.
   Quien atiende puede mandar el estado que está viendo (`estado_esperado`):
   si otra persona ya la movió, responde 409.
4. **La descarga de «mis datos» no crea una solicitud.** En Nexo cada descarga
   dejaba una solicitud ACCESO ya resuelta, solo para rastrearla; aquí el
   rastro es la auditoría (`privacidad.datos.descargados`) y el registro de
   descargas, y la bandeja queda para lo que hay que atender. Una solicitud de
   ACCESO formal (p. ej. para saber con quién se compartieron sus datos) sigue
   existiendo.
5. **Avisos.** En Nexo, a los ADMINISTRADOR y solo si no era ACCESO. Aquí la
   campana avisa a quienes atienden (`privacidad.atender`) de toda solicitud
   nueva, y al titular de cada cambio de estado, también por correo.
6. **Auditoría sin texto libre.** Se registran el tipo, el estado y si hubo
   respuesta, nunca la descripción ni la respuesta: la auditoría no se borra, y
   una solicitud de rectificación o de eliminación suele traer justo el dato que
   se quiere corregir o borrar.
"""

import logging
import re
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from . import access
from .models import DESCRIPCION_MAX, RESPUESTA_MAX, MovimientoSolicitud, SolicitudDerechos

logger = logging.getLogger("apps.privacidad")
User = get_user_model()

Tipo = SolicitudDerechos.Tipo
Estado = SolicitudDerechos.Estado

AUDIT_MODULE = "privacidad"

#: Plazo por defecto, en días corridos. Ver `plazo_dias`.
PLAZO_POR_DEFECTO = 15

#: Adónde llevan los avisos (rutas del frontend).
ENLACE_BANDEJA = "/admin/privacidad/solicitudes"
ENLACE_TITULAR = "/admin/perfil?seccion=mis-derechos"


def enlace_del_titular(solicitud) -> str:
    """El aviso al titular lleva a su solicitud: «Mis derechos» la enfoca y
    abre su historial."""
    return f"{ENLACE_TITULAR}&solicitud={solicitud.pk}"


#: «LOPDP-00012», «lopdp-12», «00012» o «12»: la búsqueda por número.
_NUMERO = re.compile(r"^(LOPDP-)?0*(\d+)$", re.IGNORECASE)

#: Correo al titular cuando su solicitud cambia de estado.
CLAVE_CORREO = "privacidad.solicitud_actualizada"

#: A dónde puede pasar cada estado.
TRANSICIONES = {
    Estado.PENDIENTE: {Estado.EN_PROCESO, Estado.RESUELTA, Estado.RECHAZADA},
    Estado.EN_PROCESO: {Estado.RESUELTA, Estado.RECHAZADA},
    Estado.RESUELTA: {Estado.EN_PROCESO},
    Estado.RECHAZADA: {Estado.EN_PROCESO},
}


class PrivacidadError(Exception):
    """Error de negocio controlado: la vista lo traduce al contrato de error
    uniforme (`{"error": {"code", "message", "details"}}`)."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "validation_error",
        status: int = 400,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details


def _invalido(campo: str, mensaje: str) -> PrivacidadError:
    return PrivacidadError(mensaje, details={campo: [mensaje]})


def _no_encontrada() -> PrivacidadError:
    return PrivacidadError("Solicitud no encontrada.", code="not_found", status=404)


def plazo_dias() -> int:
    """Los días para responder, desde el ajuste `PRIVACIDAD_PLAZO_DIAS`.

    La LOPDP de Ecuador (Registro Oficial Suplemento 459, 26/05/2021) fija en
    sus artículos 13 (acceso), 14 (rectificación y actualización) y 15
    (eliminación) que el responsable atienda la solicitud en un plazo de
    **quince (15) días**. Se cuentan corridos: si el Reglamento o la autoridad
    los precisan como hábiles, 15 corridos siguen cumpliendo, y el ajuste
    permite cambiarlo sin tocar código. Es una lectura técnica, no un dictamen:
    debe confirmarla el asesor legal (ver `docs/derechos-sobre-datos.md`).
    """
    dias = int(getattr(settings, "PRIVACIDAD_PLAZO_DIAS", PLAZO_POR_DEFECTO) or 0)
    return dias if dias > 0 else PLAZO_POR_DEFECTO


def fecha_limite_desde(momento, dias: int):
    """El último día del plazo, en la fecha local (Ecuador) de la solicitud."""
    return timezone.localdate(momento) + timedelta(days=dias)


def vencida(solicitud: SolicitudDerechos, hoy=None) -> bool:
    """Abierta y pasada su fecha límite (el último día todavía está a tiempo)."""
    hoy = hoy or timezone.localdate()
    return not solicitud.cerrada and solicitud.fecha_limite < hoy


def nombre(usuario) -> str:
    if usuario is None:
        return ""
    return (usuario.get_full_name() or "").strip() or usuario.username


def _audit(actor, accion: str, objetivo=None, *, nuevo=None, previo=None, context=None):
    record_audit_event(
        actor=actor,
        action=f"privacidad.{accion}",
        target=objetivo,
        module=AUDIT_MODULE,
        previous_values=previo,
        new_values=nuevo,
        context=context,
    )


# ── Lectura ───────────────────────────────────────────────────────────────────


def mias(actor):
    """Las solicitudes de la persona en la empresa activa."""
    return SolicitudDerechos.objects.filter(titular=actor).select_related("resuelta_por")


def obtener_propia(actor, pk) -> SolicitudDerechos:
    """Una solicitud de la persona; la ajena responde 404 (no se revela que
    existe)."""
    solicitud = mias(actor).filter(pk=pk).first()
    if solicitud is None:
        raise _no_encontrada()
    return solicitud


def _exigir_bandeja(actor):
    if not access.puede_ver_bandeja(actor):
        raise PrivacidadError(
            "No tiene permiso para ver las solicitudes de datos personales.",
            code="permission_denied",
            status=403,
        )


def _exigir_atender(actor):
    if not access.puede_atender(actor):
        raise PrivacidadError(
            "No tiene permiso para atender solicitudes de datos personales.",
            code="permission_denied",
            status=403,
        )


def bandeja(actor, *, estado: str = "", tipo: str = "", vencidas: bool = False, q: str = ""):
    """Las solicitudes de la empresa activa, lo más urgente primero: las
    abiertas por fecha límite, después las cerradas de la más nueva a la más
    vieja. `q` busca en el titular y, si es un número («LOPDP-00012», «12»),
    también por el número de la solicitud."""
    from django.db.models import Case, IntegerField, Q, Value, When

    from apps.core.busqueda import condicion_de_busqueda

    _exigir_bandeja(actor)
    consulta = SolicitudDerechos.objects.select_related("titular", "resuelta_por")
    if estado:
        if estado not in Estado.values:
            raise _invalido("estado", "Estado inválido.")
        consulta = consulta.filter(estado=estado)
    if tipo:
        if tipo not in Tipo.values:
            raise _invalido("tipo", "Tipo de solicitud inválido.")
        consulta = consulta.filter(tipo=tipo)
    if vencidas:
        consulta = consulta.exclude(estado__in=SolicitudDerechos.FINALES).filter(
            fecha_limite__lt=timezone.localdate()
        )
    condicion = condicion_de_busqueda(
        q,
        ("titular__first_name", "titular__last_name", "titular__username", "titular__email"),
    )
    numero = _NUMERO.match((q or "").strip())
    if numero:
        # El número es el id con ceros; «0» o un número enorme no son ids.
        pk = int(numero.group(2))
        if 0 < pk < 2**31:
            condicion = Q(pk=pk) if condicion is None else condicion | Q(pk=pk)
    if condicion is not None:
        consulta = consulta.filter(condicion)
    cerrada = Case(
        When(estado__in=SolicitudDerechos.FINALES, then=Value(1)),
        default=Value(0),
        output_field=IntegerField(),
    )
    return consulta.annotate(_cerrada=cerrada).order_by("_cerrada", "fecha_limite", "-id")


def obtener_de_bandeja(actor, pk) -> SolicitudDerechos:
    _exigir_bandeja(actor)
    solicitud = (
        SolicitudDerechos.objects.select_related("titular", "resuelta_por").filter(pk=pk).first()
    )
    if solicitud is None:
        raise _no_encontrada()
    return solicitud


def resumen_de_acceso(user) -> dict:
    """Lo que la persona puede hacer en el módulo y el plazo vigente."""
    return {
        "puede_ver_bandeja": access.puede_ver_bandeja(user),
        "puede_atender": access.puede_atender(user),
        "plazo_dias": plazo_dias(),
        "tipos": [{"value": v, "label": label} for v, label in Tipo.choices],
        "estados": [{"value": v, "label": label} for v, label in Estado.choices],
    }


# ── Escritura ─────────────────────────────────────────────────────────────────


def crear_solicitud(*, actor, tipo: str, descripcion: str = "", context=None):
    """Registra una solicitud del titular en la empresa activa y avisa a
    quienes atienden. Devuelve `(solicitud, creada)`: `creada` es falso si ya
    había una abierta idéntica (doble clic)."""
    if tipo not in Tipo.values:
        raise _invalido("tipo", "Tipo de solicitud inválido.")
    descripcion = (descripcion or "").strip()
    if len(descripcion) > DESCRIPCION_MAX:
        raise _invalido("descripcion", f"La descripción admite hasta {DESCRIPCION_MAX} caracteres.")
    if tipo == Tipo.RECTIFICACION and not descripcion:
        # Como en Nexo: sin decir qué dato y por qué, no hay qué corregir.
        raise _invalido("descripcion", "Describa qué dato quiere corregir y por qué.")
    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        raise PrivacidadError(
            "Elija la empresa a la que dirige la solicitud.", code="sin_empresa", status=400
        )

    with transaction.atomic():
        existente = (
            SolicitudDerechos.objects.select_for_update()
            .filter(titular=actor, tipo=tipo, descripcion=descripcion)
            .exclude(estado__in=SolicitudDerechos.FINALES)
            .first()
        )
        if existente is not None:
            return existente, False
        ahora = timezone.now()
        dias = plazo_dias()
        solicitud = SolicitudDerechos.objects.create(
            titular=actor,
            tipo=tipo,
            descripcion=descripcion,
            fecha_limite=fecha_limite_desde(ahora, dias),
            plazo_dias=dias,
        )
        MovimientoSolicitud.objects.create(
            solicitud=solicitud, estado_anterior="", estado_nuevo=Estado.PENDIENTE, actor=actor
        )
        _audit(
            actor,
            "solicitud.creada",
            solicitud,
            nuevo={
                "numero": solicitud.numero,
                "tipo": tipo,
                "fecha_limite": solicitud.fecha_limite.isoformat(),
                "con_descripcion": bool(descripcion),
            },
            context=context,
        )
        _avisar_nueva(solicitud, actor)
    return solicitud, True


def cambiar_estado(
    *,
    actor,
    solicitud_id,
    estado: str,
    respuesta: str = "",
    estado_esperado: str | None = None,
    context=None,
) -> SolicitudDerechos:
    """Mueve la solicitud con su respuesta al titular y le avisa."""
    _exigir_atender(actor)
    if estado not in Estado.values:
        raise _invalido("estado", "Estado inválido.")
    respuesta = (respuesta or "").strip()
    if len(respuesta) > RESPUESTA_MAX:
        raise _invalido("respuesta", f"La respuesta admite hasta {RESPUESTA_MAX} caracteres.")

    with transaction.atomic():
        solicitud = (
            SolicitudDerechos.objects.select_for_update()
            .select_related("titular")
            .filter(pk=solicitud_id)
            .first()
        )
        if solicitud is None:
            raise _no_encontrada()
        anterior = solicitud.estado
        if estado_esperado and estado_esperado != anterior:
            raise PrivacidadError(
                "Otra persona ya cambió esta solicitud. Recargue para ver su estado actual.",
                code="conflicto",
                status=409,
                details={"estado_actual": anterior},
            )
        if estado not in TRANSICIONES.get(anterior, set()):
            raise PrivacidadError(
                f"Una solicitud {Estado(anterior).label.lower()} no puede pasar a "
                f"{Estado(estado).label.lower()}.",
                code="transicion_invalida",
                status=409,
                details={"estado_actual": anterior},
            )
        cierra = estado in SolicitudDerechos.FINALES
        reabre = anterior in SolicitudDerechos.FINALES
        if (cierra or reabre) and not respuesta:
            mensaje = (
                "Escriba la respuesta para el titular."
                if cierra
                else "Escriba por qué se reabre la solicitud."
            )
            raise _invalido("respuesta", mensaje)

        solicitud.estado = estado
        if respuesta:
            solicitud.respuesta = respuesta
        if cierra:
            solicitud.resuelta_por = actor
            solicitud.resuelta_en = timezone.now()
        elif reabre:
            solicitud.resuelta_por = None
            solicitud.resuelta_en = None
        solicitud.save()
        MovimientoSolicitud.objects.create(
            solicitud=solicitud,
            estado_anterior=anterior,
            estado_nuevo=estado,
            actor=actor,
            respuesta=respuesta,
        )
        _audit(
            actor,
            "solicitud.estado",
            solicitud,
            previo={"estado": anterior},
            nuevo={"estado": estado, "con_respuesta": bool(respuesta)},
            context=context,
        )
        _avisar_al_titular(solicitud, actor)
    return solicitud


def registrar_descarga(*, actor, titular, solicitud=None, formato: str, context=None):
    """Deja en la auditoría quién descargó los datos de quién, en qué formato
    y por qué solicitud. Sin el contenido."""
    _audit(
        actor,
        "datos.descargados",
        titular,
        nuevo={
            "titular": titular.pk,
            "formato": formato,
            "solicitud": solicitud.numero if solicitud is not None else "",
            "para_tercero": actor.pk != titular.pk,
        },
        context=context,
    )


# ── Avisos ────────────────────────────────────────────────────────────────────


def quienes_atienden():
    """Cuentas activas que atienden en la empresa activa (`privacidad.atender`
    por rol global, de su membresía o directo). La cuenta de emergencia
    (`is_superuser` sin rol) no recibe avisos: atender es un oficio, no una
    marca técnica."""
    from apps.novedades.access import permission_filter
    from apps.tasks.roles import in_active_company

    return (
        User.objects.filter(is_active=True)
        .filter(in_active_company())
        .filter(permission_filter(access.ATENDER))
        .distinct()
    )


def _avisar_nueva(solicitud: SolicitudDerechos, actor):
    """A quienes atienden, después de confirmar: si la campana falla, la
    solicitud no se pierde. Nunca a quien la pidió."""
    empresa = solicitud.empresa
    texto = (
        f"{nombre(actor)} pidió {Tipo(solicitud.tipo).label.lower()} ({solicitud.numero}). "
        f"Responder hasta el {solicitud.fecha_limite:%d/%m/%Y}."
    )
    enlace = f"{ENLACE_BANDEJA}/{solicitud.pk}"

    def enviar():
        from apps.notificaciones.services import notificar

        destinatarios = [u for u in quienes_atienden() if u.pk != actor.pk]
        notificar(
            destinatarios,
            tipo="privacidad.nueva_solicitud",
            titulo="Protección de datos: nueva solicitud",
            resumen=texto,
            enlace=enlace,
            empresa=empresa,
        )

    transaction.on_commit(enviar)


def _avisar_al_titular(solicitud: SolicitudDerechos, actor):
    """Campana y correo al titular. El correo no lleva la respuesta: sale del
    perímetro y puede contener el dato en cuestión; la respuesta se lee en la
    intranet, con sesión."""
    titular = solicitud.titular
    if titular.pk == actor.pk:
        return
    empresa = solicitud.empresa
    estado = Estado(solicitud.estado).label
    tipo = Tipo(solicitud.tipo).label
    resumen = f"{solicitud.numero} ({tipo}): {estado}."

    def enviar():
        from apps.notificaciones.services import notificar

        notificar(
            [titular],
            tipo="privacidad.solicitud_actualizada",
            titulo="Su solicitud sobre sus datos personales cambió de estado",
            resumen=resumen,
            enlace=enlace_del_titular(solicitud),
            empresa=empresa,
        )
        _correo_al_titular(solicitud, titular, estado=estado, tipo=tipo)

    transaction.on_commit(enviar)


def _correo_al_titular(solicitud, titular, *, estado: str, tipo: str) -> bool:
    """Nunca levanta: un SMTP caído no deshace la respuesta (que ya está en la
    campana y en la intranet). No deja la dirección en el registro."""
    correo_destino = (titular.email or "").strip()
    if not correo_destino:
        return False
    try:
        from django.core.mail import EmailMultiAlternatives

        from apps.correos import servicio

        correo = servicio.renderizar(
            CLAVE_CORREO,
            {
                "nombre": titular.first_name or titular.username,
                "numero": solicitud.numero,
                "tipo": tipo,
                "estado": estado,
                "enlace": settings.FRONTEND_URL.rstrip("/") + enlace_del_titular(solicitud),
            },
        )
        mensaje = EmailMultiAlternatives(
            subject=correo["asunto"],
            body=correo["texto"],
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[correo_destino],
        )
        mensaje.attach_alternative(correo["html"], "text/html")
        mensaje.send(fail_silently=False)
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo enviar el aviso de la solicitud %s", solicitud.numero)
        return False
    return True
