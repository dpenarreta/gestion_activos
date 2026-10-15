"""Las operaciones de la Matriz que tocan varias tablas a la vez.

Corren en transacción: una obligación sin su primer período, o un período sin
la línea de historial que dice quién lo creó, son estados que nadie debería
poder ver.
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.core.audit import record_audit_event

from . import fechas
from .estados import zona_de
from .models import EventoPeriodo, Obligacion, Periodo, SecuenciaCodigo

NOMBRE_SECUENCIA = "periodo"


def siguiente_codigo() -> str:
    """`OBL-0001`, `OBL-0002`… con bloqueo de fila (§4.6).

    `select_for_update` dentro de la transacción del llamador: dos altas al
    mismo tiempo esperan una a la otra en vez de leer el mismo último valor y
    repetir código.
    """
    prefijo = getattr(settings, "PERIOD_CODE_PREFIX", "OBL")
    secuencia, _ = SecuenciaCodigo.objects.get_or_create(nombre=NOMBRE_SECUENCIA)
    secuencia = SecuenciaCodigo.objects.select_for_update().get(pk=secuencia.pk)
    secuencia.ultimo_valor += 1
    secuencia.save(update_fields=["ultimo_valor"])
    return f"{prefijo}-{secuencia.ultimo_valor:04d}"


def registrar_evento(periodo, actor, accion, descripcion, **campos) -> EventoPeriodo:
    """Una línea del historial del período (§17). Sin actor, «Sistema»."""
    return EventoPeriodo.objects.create(
        periodo=periodo, actor=actor, accion=accion, descripcion=descripcion, **campos
    )


@transaction.atomic
def crear_obligacion(*, empresa, actor, plantilla: dict, periodo: dict, contexto=None):
    """Crea la obligación **y su primer período** (§11.1).

    Si no se indica fecha, el primer vencimiento sale de la regla de la
    plantilla. Por defecto: inicio 30 días antes, preparación 5 días antes,
    vencimiento a la hora de la plantilla y aprobador = gerente general.
    """
    obligacion = Obligacion.objects.create(empresa=empresa, creado_por=actor, **plantilla)

    zona = zona_de(empresa)
    hoy = timezone.now().astimezone(zona).date()
    fecha = periodo.pop("fecha_vencimiento", None) or fechas.primer_vencimiento(obligacion, hoy)
    hora = periodo.pop("hora_vencimiento", None) or obligacion.hora_vencimiento
    inicio_defecto, preparacion_defecto = fechas.fechas_por_defecto(fecha)

    nuevo = Periodo.objects.create(
        empresa=empresa,
        obligacion=obligacion,
        codigo=siguiente_codigo(),
        etiqueta=periodo.pop("etiqueta", None) or fechas.etiqueta(obligacion.periodicidad, fecha),
        fecha_inicio=periodo.pop("fecha_inicio", None) or inicio_defecto,
        fecha_preparacion=periodo.pop("fecha_preparacion", None) or preparacion_defecto,
        vence_en=fechas.instante(fecha, hora, zona),
        aprobador=periodo.pop("aprobador", None) or empresa.gerente_general,
        prioridad=periodo.pop("prioridad", None) or obligacion.prioridad_defecto,
        **periodo,
    )
    registrar_evento(nuevo, actor, "period.created", "Obligación creada")
    record_audit_event(
        actor=actor,
        action="obligation.created",
        target=obligacion,
        module="matriz",
        new_values={"nombre": obligacion.nombre, "periodo": nuevo.codigo},
        context=contexto,
    )
    return obligacion, nuevo


#: Lo que se puede cambiar del seguimiento, con su nombre para el historial.
CAMPOS_SEGUIMIENTO = {
    "responsable": "responsable",
    "suplente": "suplente",
    "supervisor": "supervisor",
    "aprobador": "aprobador",
    "prioridad": "prioridad",
    "avance": "avance",
    "observaciones": "observaciones",
    "sede": "sucursal",
}


def _legible(valor) -> str:
    if valor is None or valor == "":
        return "—"
    if hasattr(valor, "get_full_name"):
        return valor.get_full_name() or valor.username
    return str(valor)[:255]


@transaction.atomic
def editar_seguimiento(*, periodo, actor, cambios: dict, contexto=None):
    """Edita el seguimiento de un período abierto (§10).

    Un evento de historial por campo cambiado, con el valor anterior y el nuevo:
    «quién cambió al responsable y cuándo» tiene que poder leerse sin comparar
    versiones.
    """
    periodo = Periodo.objects.select_for_update().get(pk=periodo.pk)
    anteriores, nuevos = {}, {}
    for campo, valor in cambios.items():
        anterior = getattr(periodo, campo)
        if anterior == valor:
            continue
        setattr(periodo, campo, valor)
        anteriores[campo], nuevos[campo] = _legible(anterior), _legible(valor)
        registrar_evento(
            periodo,
            actor,
            "period.updated",
            f"Cambio de {CAMPOS_SEGUIMIENTO[campo]}",
            valor_anterior=anteriores[campo],
            valor_nuevo=nuevos[campo],
        )
    if nuevos:
        periodo.save()
        record_audit_event(
            actor=actor,
            action="period.updated",
            target=periodo,
            module="matriz",
            previous_values=anteriores,
            new_values=nuevos,
            context=contexto,
        )
    return periodo
