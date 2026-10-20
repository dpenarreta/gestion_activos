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
"""

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.notificaciones import services as campana
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


def _terminar(solicitud, estado):
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


@transaction.atomic
def crear(solicitante, flujo, *, desde, hasta, motivo="", adjunto=None, tipo_adjunto=""):
    if not flujo.activo:
        raise ValidationError({"flujo": "Ese tipo de permiso no está disponible."})
    if hasta < desde:
        raise ValidationError({"hasta": "La fecha de fin no puede ser anterior a la de inicio."})
    if flujo.adjunto == flujo.Adjunto.OBLIGATORIO and not adjunto:
        raise ValidationError({"adjunto": "Este permiso pide un documento de respaldo."})
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
        flujo=flujo, solicitante=solicitante, desde=desde, hasta=hasta, motivo=motivo.strip()
    )
    if adjunto:
        solicitud.adjunto.save(adjunto.name, adjunto, save=False)
        solicitud.adjunto_nombre = adjunto.name[:255]
        solicitud.adjunto_tipo = tipo_adjunto
    solicitud.save()
    _registrar(solicitud, AccionSolicitud.Accion.CREADA, actor=solicitante)
    _iniciar_paso(solicitud, _siguiente_paso(solicitud))
    return solicitud


def _exigir_pendiente_de(solicitud, usuario):
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
        _terminar(solicitud, SolicitudPermiso.Estado.APROBADA)
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
    _terminar(solicitud, SolicitudPermiso.Estado.RECHAZADA)
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


@transaction.atomic
def cancelar(solicitud, usuario, comentario=""):
    if solicitud.solicitante_id != usuario.pk:
        raise PermissionDenied("Solo quien la solicitó puede cancelarla.")
    if solicitud.estado != SolicitudPermiso.Estado.PENDIENTE:
        raise ValidationError({"detail": "La solicitud ya está cerrada."})
    _registrar(solicitud, AccionSolicitud.Accion.CANCELADA, actor=usuario, comentario=comentario)
    _terminar(solicitud, SolicitudPermiso.Estado.CANCELADA)
    return solicitud


def puede_ver(solicitud, usuario) -> bool:
    return (
        solicitud.solicitante_id == usuario.pk
        or solicitud.pendiente_de.filter(pk=usuario.pk).exists()
        or solicitud.acciones.filter(actor=usuario).exists()
        or user_has_permission(usuario, "licencias.ver_todas")
    )


def primer_paso(flujo) -> PasoFlujo | None:
    return flujo.pasos.order_by("orden", "id").first()
