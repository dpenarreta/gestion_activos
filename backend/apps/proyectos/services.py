"""Las reglas de las solicitudes de proyecto: el formulario, quién decide cada
paso y cómo se avanza, se rechaza o se escala.

Siguen las de la Solicitud de permisos (`apps.licencias.services`), de donde
se toman el jefe inmediato, los ocupantes de un cargo y los miembros de un
rol:

- **Nadie para decidir**: si un paso no encuentra a nadie, queda en manos de
  quien administra los tipos de proyecto (`proyectos.configurar`), para que la
  solicitud no se pierda.
- Quien solicita nunca decide su propia solicitud, y nadie decide dos pasos
  de la misma: quien ya aprobó uno queda fuera de los siguientes.
- No se escala a uno mismo.
- Quien solicita recibe en la campana cada paso aprobado y el resultado.
"""

import json

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.licencias.models import Destino
from apps.licencias.services import jefes_de, miembros_del_rol, ocupantes, personas_de_la_empresa
from apps.notificaciones import services as campana
from apps.permissions.authorization import user_has_permission
from apps.soporte.formulario import _normalizar, _vacio

from .models import AccionProyecto, SolicitudProyecto, TipoCampo

ENLACE = "/admin/institucional/proyectos"


def _nombre(usuario) -> str:
    return (usuario.get_full_name().strip() or usuario.username) if usuario else ""


def resolver(destino, solicitud) -> list:
    """Las personas a las que apunta quien decide un paso."""
    tipo = destino.tipo
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
    return [u for u in personas_de_la_empresa() if user_has_permission(u, "proyectos.configurar")]


# --- El formulario --------------------------------------------------------------------------


def leer_respuestas(texto) -> dict:
    """Las respuestas llegan como JSON (clave del campo → valor) dentro del
    envío con el archivo."""
    if isinstance(texto, dict):
        return texto
    if not texto:
        return {}
    try:
        datos = json.loads(texto)
    except (TypeError, ValueError) as error:
        raise ValidationError({"respuestas": "Las respuestas no llegaron bien."}) from error
    if not isinstance(datos, dict):
        raise ValidationError({"respuestas": "Las respuestas no llegaron bien."})
    return datos


def validar_respuestas(tipo_proyecto, respuestas: dict) -> list:
    """Aplica el formulario del tipo a lo respondido: exige los obligatorios,
    valida cada valor según su tipo y devuelve la copia que guarda la
    solicitud. Si falta algo, lo dice campo por campo."""
    errores = {}
    copia = []
    for campo in tipo_proyecto.campos.order_by("orden", "id"):
        valor = respuestas.get(campo.clave)
        if campo.tipo == TipoCampo.CASILLA:
            valor = valor or False  # sin marcar también es una respuesta
        elif _vacio(valor):
            if campo.obligatorio:
                errores[campo.clave] = ["Este campo es obligatorio."]
            continue
        try:
            texto = _normalizar(campo, valor)
        except serializers.ValidationError as error:
            errores[campo.clave] = error.detail
            continue
        copia.append({"etiqueta": campo.etiqueta, "tipo": campo.tipo, "valor": texto})
    if errores:
        raise ValidationError({"respuestas": errores})
    return copia


# --- El recorrido de los pasos -------------------------------------------------------------


def _resumen(solicitud) -> str:
    return f"{solicitud.numero} · {_nombre(solicitud.solicitante)} · {solicitud.titulo}"


def _enlace(solicitud) -> str:
    return f"{ENLACE}?solicitud={solicitud.id}"


def _registrar(solicitud, accion, actor=None, paso=None, comentario="", detalle=""):
    return AccionProyecto.objects.create(
        solicitud=solicitud,
        paso=paso,
        actor=actor,
        accion=accion,
        comentario=(comentario or "").strip(),
        detalle=detalle[:300],
    )


def _ya_aprobaron(solicitud) -> set:
    return set(
        solicitud.acciones.filter(accion=AccionProyecto.Accion.APROBADA).values_list(
            "actor_id", flat=True
        )
    )


def _asignar(solicitud, personas, paso):
    """Deja la solicitud pendiente de esas personas y les avisa."""
    excluidos = _ya_aprobaron(solicitud) | {solicitud.solicitante_id}
    personas = [p for p in personas if p and p.pk not in excluidos]
    sin_nadie = not personas
    if sin_nadie:
        personas = [p for p in administradores() if p.pk not in excluidos]
    unicos = list({p.pk: p for p in personas}.values())
    solicitud.pendiente_de.set(unicos)
    nombres = ", ".join(_nombre(p) for p in unicos) or "nadie"
    detalle = nombres
    if sin_nadie:
        detalle = (
            f"{nombres} (el paso «{paso.nombre if paso else ''}» no encontró a nadie: "
            "quedó en manos de quien administra los tipos de proyecto)"
        )
    _registrar(solicitud, AccionProyecto.Accion.ASIGNADA, paso=paso, detalle=detalle)
    campana.notificar(
        unicos,
        tipo="proyectos.por_atender",
        titulo=f"Solicitud de proyecto por atender ({paso.nombre if paso else ''})",
        resumen=_resumen(solicitud),
        enlace=_enlace(solicitud),
    )


def _iniciar_paso(solicitud, paso):
    solicitud.paso_actual = paso
    solicitud.save(update_fields=["paso_actual", "updated_at"])
    personas = []
    for aprobador in paso.aprobadores.all():
        personas.extend(resolver(aprobador, solicitud))
    _asignar(solicitud, personas, paso)


def _siguiente_paso(solicitud):
    pasos = list(solicitud.tipo_proyecto.pasos.order_by("orden", "id"))
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
        AccionProyecto.Accion.TERMINADA,
        detalle=SolicitudProyecto.Estado(estado).label,
    )
    if estado == SolicitudProyecto.Estado.CANCELADA:
        return
    aprobada = estado == SolicitudProyecto.Estado.APROBADA
    campana.notificar(
        [solicitud.solicitante],
        tipo=f"proyectos.{estado}",
        titulo=(
            "Su proyecto fue aprobado: se puede iniciar"
            if aprobada
            else "Su solicitud de proyecto fue rechazada"
        ),
        resumen=_resumen(solicitud),
        enlace=_enlace(solicitud),
    )


# --- Lo que se puede hacer con una solicitud -------------------------------------------


@transaction.atomic
def crear(solicitante, tipo_proyecto, *, titulo, respuestas, archivo, tipo_archivo=""):
    if not tipo_proyecto.activo:
        raise ValidationError({"tipo_proyecto": "Ese tipo de proyecto no está disponible."})
    if not tipo_proyecto.pasos.exists():
        raise ValidationError(
            {"tipo_proyecto": "Ese tipo de proyecto todavía no tiene pasos de aprobación."}
        )
    if not archivo:
        raise ValidationError(
            {"archivo": "Cargue la plantilla llena: descárguela, complétela y súbala aquí."}
        )
    titulo = (titulo or "").strip()
    if not titulo:
        raise ValidationError({"titulo": "Escriba el nombre del proyecto."})
    copia = validar_respuestas(tipo_proyecto, respuestas)
    solicitud = SolicitudProyecto(
        tipo_proyecto=tipo_proyecto,
        solicitante=solicitante,
        titulo=titulo[:200],
        respuestas=copia,
        archivo_nombre=archivo.name[:255],
        archivo_tipo=tipo_archivo,
        archivo_tamano=archivo.size,
    )
    solicitud.archivo.save(archivo.name, archivo, save=False)
    solicitud.save()
    solicitud.numero = f"PRY-{solicitud.created_at:%Y}-{solicitud.pk:04d}"
    solicitud.save(update_fields=["numero"])
    _registrar(solicitud, AccionProyecto.Accion.CREADA, actor=solicitante)
    _iniciar_paso(solicitud, _siguiente_paso(solicitud))
    return solicitud


def _exigir_pendiente_de(solicitud, usuario):
    if solicitud.estado != SolicitudProyecto.Estado.PENDIENTE:
        raise ValidationError({"detail": "La solicitud ya está cerrada."})
    if not solicitud.pendiente_de.filter(pk=usuario.pk).exists():
        raise PermissionDenied("Esta solicitud no está pendiente de usted.")


@transaction.atomic
def aprobar(solicitud, usuario, comentario=""):
    _exigir_pendiente_de(solicitud, usuario)
    paso = solicitud.paso_actual
    _registrar(
        solicitud, AccionProyecto.Accion.APROBADA, actor=usuario, paso=paso, comentario=comentario
    )
    siguiente = _siguiente_paso(solicitud)
    if siguiente is None:
        _terminar(solicitud, SolicitudProyecto.Estado.APROBADA)
        return solicitud
    campana.notificar(
        [solicitud.solicitante],
        tipo="proyectos.avanza",
        titulo=f"Su solicitud de proyecto pasó «{paso.nombre if paso else ''}»",
        resumen=f"{_resumen(solicitud)} · ahora en «{siguiente.nombre}»",
        enlace=_enlace(solicitud),
    )
    _iniciar_paso(solicitud, siguiente)
    return solicitud


@transaction.atomic
def rechazar(solicitud, usuario, comentario=""):
    _exigir_pendiente_de(solicitud, usuario)
    if not (comentario or "").strip():
        raise ValidationError({"comentario": "Diga por qué se rechaza."})
    _registrar(
        solicitud,
        AccionProyecto.Accion.RECHAZADA,
        actor=usuario,
        paso=solicitud.paso_actual,
        comentario=comentario,
    )
    _terminar(solicitud, SolicitudProyecto.Estado.RECHAZADA)
    return solicitud


@transaction.atomic
def escalar(solicitud, usuario, destino, comentario=""):
    """Pasa el paso en curso a otra persona, rol o cargo. Lo hace quien lo
    tiene pendiente, o quien ve todas las solicitudes."""
    if solicitud.estado != SolicitudProyecto.Estado.PENDIENTE:
        raise ValidationError({"detail": "La solicitud ya está cerrada."})
    puede = solicitud.pendiente_de.filter(pk=usuario.pk).exists() or user_has_permission(
        usuario, "proyectos.ver_todas"
    )
    if not puede:
        raise PermissionDenied("Esta solicitud no está pendiente de usted.")
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
        AccionProyecto.Accion.ESCALADA,
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
    if solicitud.estado != SolicitudProyecto.Estado.PENDIENTE:
        raise ValidationError({"detail": "La solicitud ya está cerrada."})
    _registrar(solicitud, AccionProyecto.Accion.CANCELADA, actor=usuario, comentario=comentario)
    _terminar(solicitud, SolicitudProyecto.Estado.CANCELADA)
    return solicitud


def puede_ver(solicitud, usuario) -> bool:
    return (
        solicitud.solicitante_id == usuario.pk
        or solicitud.pendiente_de.filter(pk=usuario.pk).exists()
        or solicitud.acciones.filter(actor=usuario).exists()
        or user_has_permission(usuario, "proyectos.ver_todas")
    )
