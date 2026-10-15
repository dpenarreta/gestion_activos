"""El flujo de cierre de un período y sus evidencias (§10, §11.4).

    Sin iniciar ──(primera evidencia)──▶ En preparación ──(Enviar)──▶
    Pendiente de validación ──(Validar)──▶ FINALIZADO
                                   └──────(Devolver)──────┘

Todas las acciones corren en transacción; enviar y validar bloquean la fila
del período, para que dos clics seguidos —o dos personas a la vez— no cierren
dos veces. Cada una deja una línea de historial y un evento de auditoría. Los
motivos exigen al menos 10 caracteres: «ok» no explica nada el día que alguien
pregunta por qué se devolvió.

Las comprobaciones de permiso las hace la vista (`acceso.exigir`); aquí las
reglas del negocio, que valen igual llegue la orden por donde llegue.
"""

import datetime
import hashlib
from pathlib import PurePath

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.core.audit import record_audit_event

from . import estados, fechas
from .models import Documento, EstadoDocumento, Etapa, Periodo
from .servicios import registrar_evento

MINIMO_MOTIVO = 10
FIRMA_PDF = b"%PDF-"


def _error(mensaje):
    raise ValidationError({"detail": mensaje})


def _motivo(texto: str) -> str:
    limpio = (texto or "").strip()
    if len(limpio) < MINIMO_MOTIVO:
        raise ValidationError(
            {"reason": f"Explique el motivo con al menos {MINIMO_MOTIVO} caracteres."}
        )
    return limpio


def _auditar(actor, accion, objetivo, contexto, **valores):
    record_audit_event(
        actor=actor, action=accion, target=objetivo, module="matriz", context=contexto, **valores
    )


def _bloquear(periodo) -> Periodo:
    return (
        Periodo.objects.select_for_update()
        .select_related("empresa", "obligacion")
        .get(pk=periodo.pk)
    )


def _abierto(periodo, mensaje="El período ya está cerrado."):
    if periodo.cerrado:
        _error(mensaje)


def tiene_evidencia_valida(periodo) -> bool:
    return periodo.documentos.filter(estado=EstadoDocumento.VALIDO).exists()


# --- Evidencias (§11.4) ----------------------------------------------------------


def validar_pdf(archivo):
    """En el servidor y en este orden: extensión, tamaño, firma.

    La extensión y el tamaño también los mira el navegador, pero eso es
    comodidad: lo que decide es esto. Y la firma `%PDF-` es lo único que
    distingue un PDF de cualquier cosa renombrada a `.pdf`.
    """
    if PurePath(archivo.name).suffix.lower() != ".pdf":
        _error("Formato no permitido. Solo se aceptan archivos PDF.")
    maximo = getattr(settings, "DOCUMENT_MAX_UPLOAD_MB", 10)
    if archivo.size > maximo * 1024 * 1024:
        _error(f"Supera el tamaño máximo permitido ({maximo} MB).")
    archivo.seek(0)
    if archivo.read(len(FIRMA_PDF)) != FIRMA_PDF:
        _error("El archivo no es un PDF válido.")
    archivo.seek(0)


@transaction.atomic
def cargar_evidencia(*, periodo, archivo, actor, contexto=None) -> Documento:
    """Guarda un PDF como evidencia del período.

    Con el mismo nombre que otro del período —sin distinguir mayúsculas—, es
    la versión siguiente. La primera evidencia saca al período de «sin
    iniciar»: ya hay trabajo hecho.
    """
    periodo = _bloquear(periodo)
    _abierto(periodo, "No se cargan documentos en un período cerrado.")
    validar_pdf(archivo)

    contenido = archivo.read()
    nombre = PurePath(archivo.name).name[:255]
    anteriores = periodo.documentos.filter(nombre_original__iexact=nombre)
    version = (max(anteriores.values_list("version", flat=True), default=0)) + 1

    documento = Documento(
        periodo=periodo,
        nombre_original=nombre,
        version=version,
        tamano=len(contenido),
        content_type="application/pdf",
        sha256=hashlib.sha256(contenido).hexdigest(),
        subido_por=actor,
    )
    documento.archivo.save(nombre, ContentFile(contenido), save=False)
    documento.save()

    if periodo.etapa == Etapa.SIN_INICIAR:
        periodo.etapa = Etapa.EN_PREPARACION
        periodo.avance = max(periodo.avance, 25)
        periodo.save(update_fields=["etapa", "avance", "updated_at"])

    registrar_evento(
        periodo, actor, "document.uploaded", f"Evidencia cargada: {nombre} (v{version})"
    )
    _auditar(actor, "document.uploaded", documento, contexto, new_values={"nombre": nombre})
    return documento


@transaction.atomic
def rechazar_documento(*, documento, motivo, actor, contexto=None) -> Documento:
    motivo = _motivo(motivo)
    periodo = _bloquear(documento.periodo)
    _abierto(periodo)
    documento = Documento.objects.select_for_update().get(pk=documento.pk)
    if documento.estado != EstadoDocumento.VALIDO:
        _error("Solo se rechaza un documento válido.")
    documento.estado = EstadoDocumento.RECHAZADO
    documento.motivo_rechazo = motivo
    documento.rechazado_por = actor
    documento.rechazado_en = timezone.now()
    documento.save()
    registrar_evento(
        periodo,
        actor,
        "document.rejected",
        f"Evidencia rechazada: {documento.nombre_original}",
        motivo=motivo,
    )
    _auditar(actor, "document.rejected", documento, contexto, new_values={"motivo": motivo})
    return documento


@transaction.atomic
def eliminar_documento(*, documento, actor, contexto=None) -> Documento:
    """Borrado **lógico** de un documento rechazado: el archivo se conserva."""
    documento = Documento.objects.select_for_update().get(pk=documento.pk)
    if documento.estado != EstadoDocumento.RECHAZADO:
        _error("Solo se eliminan documentos rechazados.")
    documento.estado = EstadoDocumento.ELIMINADO
    documento.eliminado_por = actor
    documento.eliminado_en = timezone.now()
    documento.save()
    registrar_evento(
        documento.periodo,
        actor,
        "document.deleted",
        f"Documento rechazado eliminado: {documento.nombre_original}",
    )
    _auditar(actor, "document.deleted", documento, contexto)
    return documento


# --- Cierre (§10) -----------------------------------------------------------------


@transaction.atomic
def enviar(*, periodo, actor, contexto=None) -> Periodo:
    periodo = _bloquear(periodo)
    _abierto(periodo)
    if periodo.etapa == Etapa.PENDIENTE_VALIDACION:
        _error("El período ya está pendiente de validación.")
    if not tiene_evidencia_valida(periodo):
        _error(
            "Debe cargar la evidencia requerida "
            f"({periodo.obligacion.evidencia_esperada}) antes de enviar a validación."
        )
    periodo.etapa = Etapa.PENDIENTE_VALIDACION
    periodo.avance = max(periodo.avance, 95)
    periodo.enviado_en = timezone.now()
    periodo.enviado_por = actor
    periodo.save()
    registrar_evento(periodo, actor, "period.submitted", "Enviado a validación")
    _auditar(actor, "period.submitted", periodo, contexto)
    return periodo


def separacion_de_funciones(periodo, usuario) -> bool:
    """Quien envió el período o cargó alguna de sus evidencias válidas no
    puede validarlo (§8.8), aunque su rol tenga `validar`."""
    if periodo.enviado_por_id == usuario.pk:
        return False
    return not periodo.documentos.filter(estado=EstadoDocumento.VALIDO, subido_por=usuario).exists()


@transaction.atomic
def validar(*, periodo, actor, contexto=None) -> Periodo:
    periodo = _bloquear(periodo)
    _abierto(periodo)
    if periodo.etapa != Etapa.PENDIENTE_VALIDACION:
        _error("Solo se valida un período pendiente de validación.")
    if not tiene_evidencia_valida(periodo):
        _error("No se puede finalizar sin evidencia válida cargada.")
    if not separacion_de_funciones(periodo, actor):
        raise PermissionDenied(
            "Separación de funciones: quien cargó la evidencia o envió el período "
            "no puede validar ese mismo cierre."
        )

    ahora = timezone.now()
    periodo.cerrado = True
    periodo.avance = 100
    periodo.recordatorios_suspendidos = True
    periodo.validado_en = ahora
    periodo.validado_por = actor
    # Qué fecha cuenta como cumplimiento lo decide la empresa (§4.1).
    por_envio = periodo.empresa.base_cumplimiento == "envio"
    periodo.cumplido_en = periodo.enviado_en if por_envio and periodo.enviado_en else ahora
    periodo.save()

    tarde = estados.estado(periodo, ahora)["is_late"]
    registrar_evento(
        periodo,
        actor,
        "period.validated",
        "Cierre validado" + (" — Finalizada fuera de plazo" if tarde else ""),
        motivo="Se conserva el atraso para efectos de reportes." if tarde else "",
    )
    _auditar(actor, "period.validated", periodo, contexto, new_values={"tarde": tarde})
    return periodo


@transaction.atomic
def devolver(*, periodo, motivo, actor, contexto=None) -> Periodo:
    motivo = _motivo(motivo)
    periodo = _bloquear(periodo)
    _abierto(periodo)
    if periodo.etapa != Etapa.PENDIENTE_VALIDACION:
        _error("Solo se devuelve un período pendiente de validación.")
    periodo.etapa = Etapa.EN_PREPARACION
    periodo.avance = min(periodo.avance, 50)
    periodo.enviado_en = None
    periodo.enviado_por = None
    periodo.save()
    registrar_evento(periodo, actor, "period.returned", "Devuelto a preparación", motivo=motivo)
    _auditar(actor, "period.returned", periodo, contexto, new_values={"motivo": motivo})
    return periodo


@transaction.atomic
def cambiar_vencimiento(*, periodo, fecha, hora, motivo, actor, contexto=None) -> Periodo:
    """Nueva fecha de vencimiento, con justificación (§10).

    El cambio queda en el historial con la fecha anterior y no se puede
    borrar. El estado se recalcula solo: un período vencido al que se le da
    más plazo vuelve a estar en progreso.
    """
    motivo = _motivo(motivo)
    periodo = _bloquear(periodo)
    _abierto(periodo, "No se cambia la fecha de un período cerrado.")
    if fecha < periodo.fecha_inicio:
        raise ValidationError(
            {"due_date": "El vencimiento no puede ser anterior a la fecha de inicio."}
        )
    zona = estados.zona_de(periodo.empresa)
    hora = hora or datetime.time(17, 0)
    anterior = periodo.vence_en.astimezone(zona)
    periodo.vence_en = fechas.instante(fecha, hora, zona)
    periodo.save(update_fields=["vence_en", "updated_at"])
    formato = "%d/%m/%Y %H:%M"
    registrar_evento(
        periodo,
        actor,
        "period.due_date_changed",
        "Cambio de fecha de vencimiento",
        motivo=motivo,
        valor_anterior=anterior.strftime(formato),
        valor_nuevo=periodo.vence_en.astimezone(zona).strftime(formato),
    )
    _auditar(
        actor,
        "period.due_date_changed",
        periodo,
        contexto,
        previous_values={"vence_en": anterior.isoformat()},
        new_values={"vence_en": periodo.vence_en.isoformat(), "motivo": motivo},
    )
    return periodo
