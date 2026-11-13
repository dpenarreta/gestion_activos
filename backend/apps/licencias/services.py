"""Las reglas de las solicitudes de permiso: quién aprueba cada paso, cómo se
avanza, se rechaza o se escala, y a quién se avisa el resultado.

- **Jefe inmediato**: el cargo de la persona en el organigrama (su «Mi
  perfil») y, de ahí, quien ocupe el cargo de su jefe; si ese cargo está
  vacante, se sube al siguiente.
- **Nadie para aprobar**: si un paso no encuentra a nadie (por ejemplo, la
  persona no tiene cargo asignado), queda en manos de quien administra los
  flujos (`licencias.configurar`), para que la solicitud no se pierda.
- Quien solicita nunca aprueba su propia solicitud, y nadie aprueba dos pasos
  de la misma: quien ya aprobó uno queda fuera de los siguientes (si no queda
  nadie, pasa a quien administra los flujos).
- No se escala a uno mismo: quien ve todas las solicitudes no puede
  asignársela y aprobarla saltándose a los aprobadores del flujo.
- **Ausencias de Gestión Humana (05/11/2026)**: al aprobarse, la solicitud
  genera sus `LeaveRecord` (`apps.ausencias.services.create_from_request`);
  si se cancela una aprobada, se borran y sus días de vacaciones vuelven a
  quedar pendientes, todos o en parte según su momento y la opción elegida
  (US-012, ver «Cancelar una aprobada» más abajo). Todo en la transacción de
  la aprobación o de la cancelación.
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.notificaciones import services as campana
from apps.organizacion import ausencia
from apps.permissions.authorization import user_has_permission
from apps.users.models import User

from . import restricciones
from .models import AccionSolicitud, Destino, FlujoPermiso, PasoFlujo, SolicitudPermiso

ENLACE = "/admin/institucional/permisos"


class SolicitudCerrada(APIException):
    """Cancelar una solicitud ya cancelada o rechazada, o cancelada a la vez
    por otro (US-012, 12/11/2026): 400 con un código propio y estable,
    `solicitud_cerrada`, para que la pantalla lo reconozca sin comparar el
    texto (`core.exceptions` toma el `code` de `default_code`)."""

    status_code = 400
    default_detail = "La solicitud ya está cerrada."
    default_code = "solicitud_cerrada"


def personas_de_la_empresa():
    from apps.chat.services import personas_de_la_empresa as personas

    return personas()


def _nombre(usuario) -> str:
    return usuario.get_full_name().strip() or usuario.username


def ocupantes(cargo) -> list:
    """Quienes ocupan un cargo (según su perfil), activos y de la empresa."""
    from apps.organizacion.models import DatosDeContacto

    ids = DatosDeContacto.objects.filter(cargo=cargo).values_list("usuario_id", flat=True)
    return list(personas_de_la_empresa().filter(pk__in=ids))


def jefes_de(usuario) -> list:
    """El jefe inmediato según el organigrama; si su cargo está vacante, el
    siguiente hacia arriba."""
    from apps.organizacion.models import DatosDeContacto

    perfil = DatosDeContacto.objects.filter(usuario=usuario).select_related("cargo").first()
    cargo = perfil.cargo.jefe if perfil and perfil.cargo_id else None
    vistos = set()
    while cargo is not None and cargo.pk not in vistos:
        vistos.add(cargo.pk)
        encontrados = [u for u in ocupantes(cargo) if u.pk != usuario.pk]
        if encontrados:
            return encontrados
        cargo = cargo.jefe
    return []


def miembros_del_rol(rol) -> list:
    """Quienes tienen el rol, global o en su membresía de esta empresa."""
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    empresa = empresa_actual()
    filtro = Q(groups=rol)
    if empresa not in (None, SIN_EMPRESA):
        filtro |= Q(membresias__empresa=empresa, membresias__roles=rol)
    return list(personas_de_la_empresa().filter(filtro).distinct())


def resolver(destino, solicitud) -> list:
    """Las personas a las que apunta un destino (aprobador o aviso)."""
    tipo = destino.tipo
    if tipo == Destino.SOLICITANTE:
        return [solicitud.solicitante]
    if tipo == Destino.APROBADORES:
        ids = solicitud.acciones.filter(accion=AccionSolicitud.Accion.APROBADA).values_list(
            "actor_id", flat=True
        )
        return list(User.objects.filter(pk__in=ids))
    if tipo == Destino.JEFE_INMEDIATO:
        return jefes_de(solicitud.solicitante)
    if tipo == Destino.PERSONA:
        return [destino.usuario] if destino.usuario_id else []
    if tipo == Destino.ROL:
        return miembros_del_rol(destino.rol) if destino.rol_id else []
    if tipo == Destino.CARGO:
        return ocupantes(destino.cargo) if destino.cargo_id else []
    return []


def administradores() -> list:
    return [u for u in personas_de_la_empresa() if user_has_permission(u, "licencias.configurar")]


def _resumen(solicitud) -> str:
    desde = solicitud.desde.strftime("%d/%m/%Y")
    hasta = solicitud.hasta.strftime("%d/%m/%Y")
    fechas = desde if desde == hasta else f"del {desde} al {hasta}"
    if solicitud.hora_desde and solicitud.hora_hasta:
        fechas = f"{fechas}, de {solicitud.hora_desde:%H:%M} a {solicitud.hora_hasta:%H:%M}"
    return f"{_nombre(solicitud.solicitante)} · {solicitud.flujo.nombre} · {fechas}"


def _enlace(solicitud) -> str:
    return f"{ENLACE}?solicitud={solicitud.id}"


def _registrar(solicitud, accion, actor=None, paso=None, comentario="", detalle=""):
    return AccionSolicitud.objects.create(
        solicitud=solicitud,
        paso=paso,
        actor=actor,
        accion=accion,
        comentario=(comentario or "").strip(),
        detalle=detalle[:300],
    )


def _ya_aprobaron(solicitud) -> set:
    return set(
        solicitud.acciones.filter(accion=AccionSolicitud.Accion.APROBADA).values_list(
            "actor_id", flat=True
        )
    )


def _asignar(solicitud, personas, paso, detalle_extra=""):
    """Deja la solicitud pendiente de esas personas y les avisa."""
    # Nadie aprueba lo suyo, ni dos pasos de la misma solicitud.
    excluidos = _ya_aprobaron(solicitud) | {solicitud.solicitante_id}
    personas = [p for p in personas if p and p.pk not in excluidos]
    # Quien está ausente (vacaciones, permiso de día completo o «Fuera de la
    # oficina») no recibe la solicitud: pasa a su reemplazo, con las mismas
    # exclusiones (11/11/2026, US-001).
    personas, cambios = ausencia.sustituir_ausentes(personas, excluidos)
    sin_nadie = not personas
    if sin_nadie:
        personas = [p for p in administradores() if p.pk not in excluidos]
    unicos = list({p.pk: p for p in personas}.values())
    solicitud.pendiente_de.set(unicos)
    nombres = ", ".join(_nombre(p) for p in unicos) or "nadie"
    detalle = detalle_extra or nombres
    if sin_nadie:
        detalle = (
            f"{nombres} (el paso «{paso.nombre if paso else ''}» no encontró aprobador: "
            "quedó en manos de quien administra los flujos)"
        )
    _registrar(solicitud, AccionSolicitud.Accion.ASIGNADA, paso=paso, detalle=detalle)
    for ausente, reemplazo in cambios:
        _registrar(
            solicitud,
            AccionSolicitud.Accion.ESCALADA,
            paso=paso,
            comentario=ausencia.constancia(reemplazo, ausente),
            detalle=_nombre(reemplazo),
        )
    campana.notificar(
        unicos,
        tipo="licencias.por_aprobar",
        titulo=f"Solicitud de permiso por aprobar: {solicitud.flujo.nombre}",
        resumen=_resumen(solicitud),
        enlace=_enlace(solicitud),
    )


def _aprobadores_del_paso(paso, solicitud) -> list:
    personas = []
    for aprobador in paso.aprobadores.all():
        personas.extend(resolver(aprobador, solicitud))
    return personas


def _iniciar_paso(solicitud, paso):
    solicitud.paso_actual = paso
    solicitud.save(update_fields=["paso_actual", "updated_at"])
    _asignar(solicitud, _aprobadores_del_paso(paso, solicitud), paso)


def _siguiente_paso(solicitud):
    pasos = list(solicitud.flujo.pasos.order_by("orden", "id"))
    if solicitud.paso_actual_id is None:
        return pasos[0] if pasos else None
    for i, paso in enumerate(pasos):
        if paso.pk == solicitud.paso_actual_id:
            return pasos[i + 1] if i + 1 < len(pasos) else None
    return None


def _terminar(solicitud, estado, actor=None):
    solicitud.estado = estado
    solicitud.paso_actual = None
    solicitud.cerrada_en = timezone.now()
    solicitud.save(update_fields=["estado", "paso_actual", "cerrada_en", "updated_at"])
    solicitud.pendiente_de.clear()
    _registrar(
        solicitud,
        AccionSolicitud.Accion.TERMINADA,
        detalle=SolicitudPermiso.Estado(estado).label,
    )
    if estado == SolicitudPermiso.Estado.CANCELADA:
        return
    if estado == SolicitudPermiso.Estado.APROBADA:
        restricciones.registrar_goce(solicitud)
        # Sus ausencias en Gestión Humana, en la misma transacción: si algo
        # falla, la solicitud no queda aprobada sin ellas.
        from apps.ausencias.services import create_from_request

        create_from_request(solicitud, actor=actor or solicitud.solicitante)
        # Si el permiso es de día completo y ya empezó, lo que la persona
        # tenía por aprobar pasa a su reemplazo (11/11/2026, US-001). Tras
        # confirmar: con la transacción abierta el permiso aún no existe para
        # nadie más, y un fallo aquí no debe deshacer la aprobación.
        hoy = timezone.localdate()
        if not solicitud.por_horas and solicitud.desde <= hoy <= solicitud.hasta:
            transaction.on_commit(
                lambda: ausencia.reasignar_pendientes(
                    solicitud.solicitante, empresas=[solicitud.empresa]
                ),
                # Un fallo al reasignar no convierte la aprobación en un 500:
                # queda en el registro y la revisión periódica lo repite.
                robust=True,
            )
    destinatarios, por_correo = [], []
    for aviso in solicitud.flujo.avisos.filter(resultado=estado):
        personas = resolver(aviso, solicitud)
        destinatarios.extend(personas)
        if aviso.correo and estado == SolicitudPermiso.Estado.APROBADA:
            por_correo.extend(personas)
    if por_correo:
        # Tras confirmar: el correo no sale si la aprobación se deshace, y un
        # SMTP caído no la deshace (`eventos.enviar` nunca levanta).
        from . import correos

        transaction.on_commit(lambda: correos.solicitud_aprobada(solicitud, por_correo))
    etiqueta = "aprobada" if estado == SolicitudPermiso.Estado.APROBADA else "rechazada"
    campana.notificar(
        destinatarios,
        tipo=f"licencias.{etiqueta}",
        titulo=f"Solicitud de permiso {etiqueta}: {solicitud.flujo.nombre}",
        resumen=_resumen(solicitud),
        enlace=_enlace(solicitud),
    )


# --- Lo que se puede hacer con una solicitud -------------------------------------------


def validar_horas(flujo, desde, hasta, hora_desde, hora_hasta) -> None:
    """Un tipo por horas pide la hora de inicio y la de fin, en un solo día y
    con el fin después del inicio; uno por días no lleva horas. Lo comprueban
    el serializer y `crear` (por si se llama sin pasar por la API)."""
    if not flujo.por_horas:
        if hora_desde is not None or hora_hasta is not None:
            raise ValidationError(
                {"hora_desde": "Este tipo de permiso es por días: no lleva horas."}
            )
        return
    if hora_desde is None or hora_hasta is None:
        campo = "hora_desde" if hora_desde is None else "hora_hasta"
        raise ValidationError(
            {campo: "Este tipo de permiso es por horas: indique la hora de inicio y la de fin."}
        )
    if desde != hasta:
        raise ValidationError(
            {"hasta": "Un permiso por horas es de un solo día: «Desde» y «Hasta» deben coincidir."}
        )
    if hora_hasta <= hora_desde:
        raise ValidationError({"hora_hasta": "La hora de fin debe ser posterior a la de inicio."})


@transaction.atomic
def crear(
    solicitante,
    flujo,
    *,
    desde,
    hasta,
    motivo="",
    adjunto=None,
    tipo_adjunto="",
    hora_desde=None,
    hora_hasta=None,
):
    if not flujo.activo:
        raise ValidationError({"flujo": "Ese tipo de permiso no está disponible."})
    if hasta < desde:
        raise ValidationError({"hasta": "La fecha de fin no puede ser anterior a la de inicio."})
    validar_horas(flujo, desde, hasta, hora_desde, hora_hasta)
    if flujo.adjunto == flujo.Adjunto.OBLIGATORIO and not adjunto:
        raise ValidationError({"adjunto": "Este permiso pide un documento de respaldo."})
    # Permisos médicos (05/11/2026): motivo y documento son obligatorios y se
    # conservan con la solicitud. El tipo ya los exige (`FlujoSerializer`); el
    # motivo se comprueba aquí porque `pide_motivo` por sí solo no lo exige.
    if flujo.tipo_ausencia == flujo.TipoAusencia.MEDICO and not (motivo or "").strip():
        raise ValidationError(
            {"motivo": "Un permiso médico pide el motivo. No escriba diagnósticos."}
        )
    if not flujo.pasos.exists():
        raise ValidationError(
            {"flujo": "Ese tipo de permiso todavía no tiene pasos de aprobación."}
        )
    # Una solicitud a la vez por persona: dos envíos simultáneos no cuentan
    # los mismos días ni se cruzan entre sí.
    User.objects.select_for_update().filter(pk=solicitante.pk).first()
    restricciones.exigir(solicitante, flujo, desde, hasta)
    if not flujo.pide_motivo:
        motivo = ""
    solicitud = SolicitudPermiso(
        flujo=flujo,
        solicitante=solicitante,
        desde=desde,
        hasta=hasta,
        hora_desde=hora_desde if flujo.por_horas else None,
        hora_hasta=hora_hasta if flujo.por_horas else None,
        motivo=motivo.strip(),
    )
    if adjunto:
        solicitud.adjunto.save(adjunto.name, adjunto, save=False)
        solicitud.adjunto_nombre = adjunto.name[:255]
        solicitud.adjunto_tipo = tipo_adjunto
    solicitud.save()
    _registrar(solicitud, AccionSolicitud.Accion.CREADA, actor=solicitante)
    _iniciar_paso(solicitud, _siguiente_paso(solicitud))
    return solicitud


def _bloquear(solicitud):
    """Bloquea la fila de la solicitud y relee su estado: dos aprobaciones (o
    una aprobación y una cancelación) a la vez no la cierran dos veces ni
    generan dos veces sus días."""
    fila = (
        SolicitudPermiso.objects.select_for_update()
        .filter(pk=solicitud.pk)
        .values("estado", "paso_actual_id")
        .first()
    )
    if fila is not None:
        solicitud.estado = fila["estado"]
        solicitud.paso_actual_id = fila["paso_actual_id"]


def _exigir_pendiente_de(solicitud, usuario):
    _bloquear(solicitud)
    if solicitud.estado != SolicitudPermiso.Estado.PENDIENTE:
        raise ValidationError({"detail": "La solicitud ya está cerrada."})
    if not solicitud.pendiente_de.filter(pk=usuario.pk).exists():
        raise PermissionDenied("Esta solicitud no está pendiente de usted.")


@transaction.atomic
def aprobar(solicitud, usuario, comentario=""):
    _exigir_pendiente_de(solicitud, usuario)
    _registrar(
        solicitud,
        AccionSolicitud.Accion.APROBADA,
        actor=usuario,
        paso=solicitud.paso_actual,
        comentario=comentario,
    )
    siguiente = _siguiente_paso(solicitud)
    if siguiente is None:
        _terminar(solicitud, SolicitudPermiso.Estado.APROBADA, actor=usuario)
    else:
        _iniciar_paso(solicitud, siguiente)
    return solicitud


@transaction.atomic
def rechazar(solicitud, usuario, comentario=""):
    _exigir_pendiente_de(solicitud, usuario)
    if not (comentario or "").strip():
        raise ValidationError({"comentario": "Diga por qué se rechaza."})
    _registrar(
        solicitud,
        AccionSolicitud.Accion.RECHAZADA,
        actor=usuario,
        paso=solicitud.paso_actual,
        comentario=comentario,
    )
    _terminar(solicitud, SolicitudPermiso.Estado.RECHAZADA, actor=usuario)
    return solicitud


@transaction.atomic
def escalar(solicitud, usuario, destino, comentario=""):
    """Pasa el paso en curso a otra persona, rol o cargo. Lo hace quien lo
    tiene pendiente, o quien ve todas las solicitudes."""
    if solicitud.estado != SolicitudPermiso.Estado.PENDIENTE:
        raise ValidationError({"detail": "La solicitud ya está cerrada."})
    puede = solicitud.pendiente_de.filter(pk=usuario.pk).exists() or user_has_permission(
        usuario, "licencias.ver_todas"
    )
    if not puede:
        raise PermissionDenied("Esta solicitud no está pendiente de usted.")
    # No se escala a uno mismo (quien ve todas no se salta así a los
    # aprobadores), ni a quien la pidió o ya aprobó un paso.
    excluidos = _ya_aprobaron(solicitud) | {solicitud.solicitante_id, usuario.pk}
    personas = [p for p in resolver(destino, solicitud) if p.pk not in excluidos]
    if not personas:
        raise ValidationError(
            {
                "destino": "Ahí no hay nadie a quien escalar la solicitud (no se escala a uno "
                "mismo, a quien la pidió ni a quien ya aprobó un paso)."
            }
        )
    _registrar(
        solicitud,
        AccionSolicitud.Accion.ESCALADA,
        actor=usuario,
        paso=solicitud.paso_actual,
        comentario=comentario,
        detalle=", ".join(_nombre(p) for p in personas),
    )
    _asignar(solicitud, personas, solicitud.paso_actual)
    return solicitud


def reasignar_por_ausencia(ausente, base=None) -> int:
    """Pasa al reemplazo de `ausente` las solicitudes pendientes de él en la
    empresa activa, con la constancia «Escalada a X por ausencia de Y» y el
    aviso de siempre al reemplazo. Si no hay reemplazo, se quedan con él.
    Idempotente: lo que ya pasó deja de estar pendiente de él.

    `base` es su reemplazo sin exclusiones, ya calculado por quien llama; se
    usa si no es el solicitante ni alguien que ya aprobó (si no, se
    recalcula con esas exclusiones)."""
    total = 0
    pendientes = SolicitudPermiso.objects.filter(
        estado=SolicitudPermiso.Estado.PENDIENTE, pendiente_de=ausente
    ).select_related("solicitante", "flujo")
    for solicitud in pendientes:
        with transaction.atomic():
            _bloquear(solicitud)
            if solicitud.estado != SolicitudPermiso.Estado.PENDIENTE:
                continue
            if not solicitud.pendiente_de.filter(pk=ausente.pk).exists():
                continue
            excluidos = _ya_aprobaron(solicitud) | {solicitud.solicitante_id}
            reemplazo = (
                base
                if base is not None and base.pk not in excluidos
                else ausencia.reemplazo_para(ausente, excluidos)
            )
            if reemplazo is None:
                continue
            solicitud.pendiente_de.remove(ausente)
            solicitud.pendiente_de.add(reemplazo)
            _registrar(
                solicitud,
                AccionSolicitud.Accion.ESCALADA,
                paso=solicitud.paso_actual,
                comentario=ausencia.constancia(reemplazo, ausente),
                detalle=_nombre(reemplazo),
            )
            campana.notificar(
                [reemplazo],
                tipo="licencias.por_aprobar",
                titulo=f"Solicitud de permiso por aprobar: {solicitud.flujo.nombre}",
                resumen=_resumen(solicitud),
                enlace=_enlace(solicitud),
            )
            total += 1
    return total


PERMISO_ANULAR = "licencias.anular_aprobadas"
PERMISO_CANCELAR_PROPIAS = "licencias.cancelar_aprobadas_propias"


def puede_anular_aprobadas(usuario) -> bool:
    """Gestión Humana: quien tiene `licencias.anular_aprobadas` (decisión del
    usuario, 05/11/2026; antes bastaba `licencias.ver_todas`, y
    `permissions/0049` se lo dio a quien lo tenía). Anular borra sus ausencias
    de Gestión Humana y devuelve los días de vacaciones: no es lo mismo que
    consultarlas. Desde US-012 (12/11/2026) la persona también cancela las
    suyas aprobadas, con otro permiso y menos opciones
    (`opciones_de_cancelacion`)."""
    return user_has_permission(usuario, PERMISO_ANULAR)


# --- Cancelar una aprobada (US-012, 12/11/2026) -----------------------------------------
#
# El momento de la solicitud decide qué se puede hacer con sus días:
#
# - **Por empezar** (`desde` posterior a hoy): se devuelven todos sus días y se
#   borran todas sus ausencias; `devolver` no se pide (se ignora).
# - **En curso** (hoy entre `desde` y `hasta`) o **terminada** (`hasta`
#   anterior a hoy): quien cancela elige qué pasa con los días:
#   - `restantes` (solo en curso): vuelven los días de hoy en adelante; lo ya
#     gozado sigue contando.
#   - `todos`: vuelven todos los días.
#   - `ninguno`: los días siguen contando como gozados.
#
# Las ausencias de Gestión Humana siguen a esa decisión: las de hoy en adelante
# se borran siempre (la persona ya no está ausente: si quedaran, su trabajo
# seguiría pasando a su reemplazo); las pasadas solo se borran con `todos`,
# porque entonces esos días dejan de ser vacaciones. Con `restantes` y con
# `ninguno` las pasadas se quedan: la persona sí faltó esos días.
#
# Quién puede (decisión del usuario, 12/11/2026):
#
# - **La persona**, con `licencias.cancelar_aprobadas_propias`: por empezar,
#   siempre; en curso, solo `restantes`; terminada, no (recuperar días ya
#   gozados es decisión de Gestión Humana).
# - **Gestión Humana**, con `licencias.anular_aprobadas`: cualquier momento y
#   cualquier opción, en las de otra persona. En las suyas tiene las reglas de
#   la persona: nadie decide sobre sus propios días, igual que nadie aprueba su
#   propia solicitud.
#
# Se avisa siempre al jefe inmediato y a la persona (si canceló otro); en curso
# o terminada, también a quienes la aprobaron. Nunca a quien canceló.

POR_EMPEZAR, EN_CURSO, TERMINADA = "por_empezar", "en_curso", "terminada"
MOMENTOS = {POR_EMPEZAR: "Por empezar", EN_CURSO: "En curso", TERMINADA: "Terminada"}
RESTANTES, TODOS, NINGUNO = "restantes", "todos", "ninguno"
OPCIONES_DEVOLVER = {
    RESTANTES: "Devolver los días que faltan",
    TODOS: "Devolver todos los días",
    NINGUNO: "No devolver días",
}
_DE_GESTION_HUMANA = {
    POR_EMPEZAR: [],
    EN_CURSO: [RESTANTES, TODOS, NINGUNO],
    TERMINADA: [TODOS, NINGUNO],
}
_DE_LA_PERSONA = {POR_EMPEZAR: [], EN_CURSO: [RESTANTES]}


def hoy():
    """La fecha de hoy en la zona del proyecto (`TIME_ZONE`)."""
    return timezone.localdate()


def momento(solicitud, dia=None) -> str:
    """`por_empezar`, `en_curso` o `terminada` respecto a `dia` (hoy)."""
    dia = dia or hoy()
    if solicitud.desde > dia:
        return POR_EMPEZAR
    if solicitud.hasta < dia:
        return TERMINADA
    return EN_CURSO


def opciones_de_cancelacion(solicitud, usuario, dia=None) -> tuple[bool, list[str]]:
    """Si `usuario` puede cancelar la solicitud aprobada y qué opciones de
    `devolver` tiene. Una lista vacía con `True` es «no se elige»: por
    empezar (se devuelve todo) o una solicitud que no descuenta vacaciones.
    No mira si la ve (`puede_ver`): eso lo resuelve la API.

    Un permiso que no descuenta vacaciones (médico, con descuento de sueldo…)
    no tiene días que devolver (decisión del Tech Lead, 12/11/2026): nunca
    hay opciones, pero quién puede y cuándo es igual que en las vacaciones."""
    if solicitud.estado != SolicitudPermiso.Estado.APROBADA:
        return False, []
    cuando = momento(solicitud, dia)
    if solicitud.solicitante_id == usuario.pk:
        if cuando in _DE_LA_PERSONA and user_has_permission(usuario, PERMISO_CANCELAR_PROPIAS):
            return True, _con_dias(solicitud, _DE_LA_PERSONA[cuando])
        return False, []
    if puede_anular_aprobadas(usuario):
        return True, _con_dias(solicitud, _DE_GESTION_HUMANA[cuando])
    return False, []


def _con_dias(solicitud, opciones) -> list[str]:
    return list(opciones) if solicitud.descuenta_vacaciones else []


def permiso_para_cancelar(solicitud, usuario, dia=None) -> str | None:
    """El permiso que habría hecho falta para cancelarla, para el 403 y su
    auditoría:

    - Pendiente de otra persona: ninguno (`None`): solo la cancela quien la
      pidió.
    - Aprobada propia: `cancelar_aprobadas_propias`, salvo si ya terminó: esa
      solo la cancela Gestión Humana (`anular_aprobadas`), y no en las suyas.
    - Aprobada de otra persona: `anular_aprobadas`.

    Lee el estado que dejó `_bloquear` en la solicitud."""
    if solicitud.estado != SolicitudPermiso.Estado.APROBADA:
        return None
    if solicitud.solicitante_id != usuario.pk:
        return PERMISO_ANULAR
    if momento(solicitud, dia) == TERMINADA and user_has_permission(
        usuario, PERMISO_CANCELAR_PROPIAS
    ):
        return PERMISO_ANULAR
    return PERMISO_CANCELAR_PROPIAS


class Cancelacion:
    """Lo que hizo una cancelación, para la auditoría de la API
    (`solicitud.cancelacion`). `estado_anterior` es el leído con la fila
    bloqueada; el resto solo aplica a una aprobada."""

    def __init__(
        self, estado_anterior, momento=None, devolver=None, dias_devueltos=0, ausencias_borradas=0
    ):
        self.estado_anterior = estado_anterior
        self.momento = momento
        self.devolver = devolver
        self.dias_devueltos = dias_devueltos
        self.ausencias_borradas = ausencias_borradas

    def como_dict(self) -> dict:
        if self.momento is None:
            return {}
        return {
            "momento": self.momento,
            "devolver": self.devolver,
            "dias_devueltos": self.dias_devueltos,
            "ausencias_borradas": self.ausencias_borradas,
        }


@transaction.atomic
def cancelar(solicitud, usuario, comentario="", devolver=None):
    """Quien la pidió cancela la suya mientras está pendiente, como siempre
    (`devolver` no aplica). Una aprobada, según `opciones_de_cancelacion`, con
    el comentario obligatorio. Todo en esta transacción y con la fila
    bloqueada: dos cancelaciones a la vez no devuelven dos veces los días (la
    segunda encuentra la solicitud cerrada)."""
    _bloquear(solicitud)
    if solicitud.estado == SolicitudPermiso.Estado.APROBADA:
        return _cancelar_aprobada(solicitud, usuario, comentario, devolver)
    if solicitud.estado != SolicitudPermiso.Estado.PENDIENTE:
        raise SolicitudCerrada()
    if solicitud.solicitante_id != usuario.pk:
        raise PermissionDenied("Solo quien la solicitó puede cancelarla.")
    _registrar(solicitud, AccionSolicitud.Accion.CANCELADA, actor=usuario, comentario=comentario)
    _terminar(solicitud, SolicitudPermiso.Estado.CANCELADA, actor=usuario)
    solicitud.cancelacion = Cancelacion(SolicitudPermiso.Estado.PENDIENTE)
    return solicitud


def _negar_cancelacion(solicitud, usuario, cuando):
    if solicitud.solicitante_id != usuario.pk:
        raise PermissionDenied(
            "Solo Gestión Humana cancela una solicitud aprobada de otra persona "
            f"(permiso {PERMISO_ANULAR})."
        )
    if not user_has_permission(usuario, PERMISO_CANCELAR_PROPIAS):
        raise PermissionDenied(f"No tiene el permiso requerido: {PERMISO_CANCELAR_PROPIAS}.")
    if cuando == TERMINADA:
        raise PermissionDenied("Esta solicitud ya terminó: solo Gestión Humana puede cancelarla.")
    raise PermissionDenied("No puede cancelar esta solicitud.")


def _exigir_opcion(devolver, opciones, cuando):
    if devolver in opciones:
        return devolver
    permitidas = "; ".join(f"«{OPCIONES_DEVOLVER[o]}» ({o})" for o in opciones)
    if not devolver:
        mensaje = f"Elija qué pasa con los días: {permitidas}."
    else:
        etapa = "en curso" if cuando == EN_CURSO else "terminada"
        mensaje = (
            f"Con la solicitud {etapa}, usted puede elegir: {permitidas}."
            if len(opciones) > 1
            else f"Con la solicitud {etapa}, usted solo puede elegir {permitidas}."
        )
    raise ValidationError({"devolver": mensaje})


def _plural_dias(n) -> str:
    return f"{n} día" if n == 1 else f"{n} días"


def _cancelar_aprobada(solicitud, usuario, comentario, devolver):
    from apps.ausencias.services import delete_for_request

    dia = hoy()
    cuando = momento(solicitud, dia)
    puede, opciones = opciones_de_cancelacion(solicitud, usuario, dia)
    if not puede:
        _negar_cancelacion(solicitud, usuario, cuando)
    if not (comentario or "").strip():
        raise ValidationError({"comentario": "Diga por qué se cancela una solicitud aprobada."})
    if not solicitud.descuenta_vacaciones:
        return _cancelar_sin_descuento(solicitud, usuario, comentario, cuando, dia)
    devolver = TODOS if cuando == POR_EMPEZAR else _exigir_opcion(devolver, opciones, cuando)

    if devolver == TODOS:
        devueltos = restricciones.devolver_goce(solicitud)
        borradas = delete_for_request(solicitud, actor=usuario)
    else:
        devueltos = (
            restricciones.devolver_goce(solicitud, desde=dia) if devolver == RESTANTES else 0
        )
        borradas = delete_for_request(solicitud, actor=usuario, desde=dia)

    detalle = f"{MOMENTOS[cuando]} · {OPCIONES_DEVOLVER[devolver]}"
    if solicitud.descuenta_vacaciones:
        detalle += f" · {_plural_dias(devueltos)} de vacaciones devueltos"
    _registrar(
        solicitud,
        AccionSolicitud.Accion.CANCELADA,
        actor=usuario,
        comentario=comentario,
        detalle=detalle,
    )
    _terminar(solicitud, SolicitudPermiso.Estado.CANCELADA, actor=usuario)
    solicitud.cancelacion = Cancelacion(
        SolicitudPermiso.Estado.APROBADA, cuando, devolver, devueltos, borradas
    )
    _avisar_cancelacion(solicitud, usuario, cuando, detalle)
    return solicitud


def _cancelar_sin_descuento(solicitud, usuario, comentario, cuando, dia):
    """Un permiso aprobado que no descuenta vacaciones (decisión del Tech
    Lead, 12/11/2026): `devolver` se ignora. Gestión Humana borra todas sus
    ausencias, como antes de US-012; la persona, por empezar, todas, y en
    curso, las de hoy en adelante (las pasadas se quedan: sí faltó)."""
    from apps.ausencias.services import delete_for_request

    desde = dia if solicitud.solicitante_id == usuario.pk and cuando == EN_CURSO else None
    borradas = delete_for_request(solicitud, actor=usuario, desde=desde)
    alcance = "Se borraron sus ausencias desde hoy" if desde else "Se borraron todas sus ausencias"
    detalle = f"{MOMENTOS[cuando]} · {alcance}"
    _registrar(
        solicitud,
        AccionSolicitud.Accion.CANCELADA,
        actor=usuario,
        comentario=comentario,
        detalle=detalle,
    )
    _terminar(solicitud, SolicitudPermiso.Estado.CANCELADA, actor=usuario)
    solicitud.cancelacion = Cancelacion(SolicitudPermiso.Estado.APROBADA, cuando, None, 0, borradas)
    _avisar_cancelacion(solicitud, usuario, cuando, detalle)
    return solicitud


def _avisar_cancelacion(solicitud, usuario, cuando, detalle):
    destinatarios = list(jefes_de(solicitud.solicitante))
    destinatarios.append(solicitud.solicitante)
    if cuando != POR_EMPEZAR:
        destinatarios.extend(User.objects.filter(pk__in=_ya_aprobaron(solicitud)))
    unicos = {p.pk: p for p in destinatarios if p is not None and p.pk != usuario.pk}
    campana.notificar(
        list(unicos.values()),
        tipo="licencias.cancelada",
        titulo=f"Solicitud de permiso cancelada: {solicitud.flujo.nombre}",
        resumen=f"{_resumen(solicitud)} · {detalle}",
        enlace=_enlace(solicitud),
    )


def _dias_por_opcion(goces, dia) -> dict:
    return {
        RESTANTES: restricciones.dias_de_goces(goces, desde=dia),
        TODOS: restricciones.dias_de_goces(goces),
        NINGUNO: 0,
    }


def dias_por_opcion(solicitud, dia=None) -> dict | None:
    """Los días de vacaciones que volverían a quedar pendientes con cada
    opción, para que la confirmación diga cuántos se devuelven. `None` si la
    solicitud no descuenta vacaciones: no hay días que devolver."""
    if not solicitud.descuenta_vacaciones:
        return None
    return _dias_por_opcion(list(restricciones.goces_de(solicitud)), dia or hoy())


#: Hasta cuándo atrás se listan las aprobadas en «Mis vacaciones»: las que
#: terminaron hace más de un año ya no se cancelan en la práctica y harían la
#: lista larga (decisión del Tech Lead, 12/11/2026). Siguen en Solicitud de
#: permisos.
DIAS_DE_APROBADAS_TERMINADAS = 365


def _visibles(solicitudes, persona, usuario) -> set:
    """Cuáles de esas solicitudes aprobadas de `persona` ve `usuario`, como
    `puede_ver`, en una consulta como mucho: las propias o con `ver_todas`,
    todas; si no, aquellas en las que intervino (una aprobada ya no está
    pendiente de nadie, y `ver_por_aprobar` es solo de las pendientes)."""
    ids = {s.id for s in solicitudes}
    if not ids or persona.pk == usuario.pk or user_has_permission(usuario, "licencias.ver_todas"):
        return ids
    return set(
        AccionSolicitud.objects.filter(solicitud_id__in=ids, actor=usuario).values_list(
            "solicitud_id", flat=True
        )
    )


def aprobadas_para(persona, usuario) -> list[dict]:
    """Las vacaciones aprobadas y sin cancelar de `persona` (solicitudes que
    se descuentan de vacaciones), con lo que `usuario` puede hacer con cada
    una: para «Mis vacaciones» (US-012). `puede_cancelar` exige además que la
    vea (`puede_ver`): si no, la API respondería 404 al cancelar.

    Solo las que terminaron hace `DIAS_DE_APROBADAS_TERMINADAS` días o menos.
    Consultas fijas, tenga las que tenga: las solicitudes, sus goces
    (`goces_por_solicitud`) y, si hace falta, en cuáles intervino."""
    dia = hoy()
    solicitudes = list(
        SolicitudPermiso.objects.filter(
            solicitante=persona,
            estado=SolicitudPermiso.Estado.APROBADA,
            descuento=FlujoPermiso.Descuento.VACACIONES,
            hasta__gte=dia - timedelta(days=DIAS_DE_APROBADAS_TERMINADAS),
        ).order_by("desde", "id")
    )
    goces = restricciones.goces_por_solicitud(persona, [s.id for s in solicitudes])
    visibles = _visibles(solicitudes, persona, usuario)
    lista = []
    for solicitud in solicitudes:
        puede, opciones = opciones_de_cancelacion(solicitud, usuario, dia)
        puede = puede and solicitud.id in visibles
        lista.append(
            {
                "id": solicitud.id,
                "desde": solicitud.desde,
                "hasta": solicitud.hasta,
                "dias": solicitud.dias,
                "momento": momento(solicitud, dia),
                "puede_cancelar": puede,
                "opciones_devolver": opciones if puede else [],
                "dias_por_opcion": _dias_por_opcion(goces[solicitud.id], dia),
            }
        )
    return lista


def puede_ver(solicitud, usuario) -> bool:
    return (
        solicitud.solicitante_id == usuario.pk
        or solicitud.pendiente_de.filter(pk=usuario.pk).exists()
        or solicitud.acciones.filter(actor=usuario).exists()
        or user_has_permission(usuario, "licencias.ver_todas")
        or (
            solicitud.estado == SolicitudPermiso.Estado.PENDIENTE
            and user_has_permission(usuario, "licencias.ver_por_aprobar")
        )
    )


def primer_paso(flujo) -> PasoFlujo | None:
    return flujo.pasos.order_by("orden", "id").first()
