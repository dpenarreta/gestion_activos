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
  si Gestión Humana cancela una aprobada, se borran y sus días de vacaciones
  vuelven a quedar pendientes. Todo en la transacción de la aprobación o de
  la cancelación.
"""

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.notificaciones import services as campana
from apps.organizacion import ausencia
from apps.permissions.authorization import user_has_permission
from apps.users.models import User

from . import restricciones
from .models import AccionSolicitud, Destino, PasoFlujo, SolicitudPermiso

ENLACE = "/admin/institucional/permisos"


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
    destinatarios = []
    for aviso in solicitud.flujo.avisos.filter(resultado=estado):
        destinatarios.extend(resolver(aviso, solicitud))
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


def puede_anular_aprobadas(usuario) -> bool:
    """Quién cancela una solicitud ya aprobada: quien tiene
    `licencias.anular_aprobadas` (decisión del usuario, 05/11/2026; antes
    bastaba `licencias.ver_todas`, y `permissions/0049` se lo dio a quien lo
    tenía). Anular borra sus ausencias de Gestión Humana y devuelve los días de
    vacaciones: no es lo mismo que consultarlas. Quien la pidió solo cancela la
    suya pendiente."""
    return user_has_permission(usuario, "licencias.anular_aprobadas")


@transaction.atomic
def cancelar(solicitud, usuario, comentario=""):
    """Quien la pidió cancela la suya mientras está pendiente. Una aprobada la
    cancela Gestión Humana (`puede_anular_aprobadas`), diciendo por qué: se
    borran sus ausencias de Gestión Humana y, si se descontó de vacaciones,
    sus días vuelven a quedar pendientes, todo en esta misma transacción."""
    _bloquear(solicitud)
    if solicitud.estado == SolicitudPermiso.Estado.APROBADA and puede_anular_aprobadas(usuario):
        return _cancelar_aprobada(solicitud, usuario, comentario)
    if solicitud.solicitante_id != usuario.pk:
        raise PermissionDenied("Solo quien la solicitó puede cancelarla.")
    if solicitud.estado != SolicitudPermiso.Estado.PENDIENTE:
        raise ValidationError({"detail": "La solicitud ya está cerrada."})
    _registrar(solicitud, AccionSolicitud.Accion.CANCELADA, actor=usuario, comentario=comentario)
    _terminar(solicitud, SolicitudPermiso.Estado.CANCELADA, actor=usuario)
    return solicitud


def _cancelar_aprobada(solicitud, usuario, comentario):
    from apps.ausencias.services import delete_for_request

    if not (comentario or "").strip():
        raise ValidationError({"comentario": "Diga por qué se cancela una solicitud aprobada."})
    _registrar(solicitud, AccionSolicitud.Accion.CANCELADA, actor=usuario, comentario=comentario)
    delete_for_request(solicitud, actor=usuario)
    restricciones.anular_goce(solicitud)  # Nada si no descontó vacaciones.
    _terminar(solicitud, SolicitudPermiso.Estado.CANCELADA, actor=usuario)
    campana.notificar(
        [solicitud.solicitante],
        tipo="licencias.cancelada",
        titulo=f"Solicitud de permiso cancelada: {solicitud.flujo.nombre}",
        resumen=_resumen(solicitud),
        enlace=_enlace(solicitud),
    )
    return solicitud


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
