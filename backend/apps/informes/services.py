"""Lógica de negocio de los informes ejecutivos: generar, listar, leer y
auditar. Las vistas validan la entrada y el permiso y delegan aquí.

Reemplaza a `src/app/api/reports/executive/route.ts` (generación) y a
`snapshotStore.ts` de Nexo (persistencia y bitácora), más el `services.py` de
su `apps.reports` (lectura).
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from . import access
from .documento import construir_paginas
from .models import (
    ExecutiveReportAuditLog,
    ExecutiveReportIntegrityIncident,
    ExecutiveReportSnapshot,
)
from .snapshot import build_custom_range, build_monthly, build_range, generate_report_id

logger = logging.getLogger("apps.informes")

#: Reintentos ante la colisión (improbable) de un Report ID.
MAX_REPORT_ID_ATTEMPTS = 5

#: Ventana en que una segunda petición idéntica de la misma persona devuelve el
#: informe recién emitido en vez de emitir otro (doble clic, reintento de red).
VENTANA_IDEMPOTENCIA = timedelta(seconds=30)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


class InformeError(Exception):
    """Error de negocio, traducido por las vistas al contrato uniforme
    `{"error": {"code", "message", "details"}}`."""

    def __init__(self, message: str, *, code: str = "validation_error", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


@dataclass(frozen=True)
class Pedido:
    """Lo que se pidió, ya validado (ver `serializers.GenerarInformeSerializer`)."""

    tipo: str
    #: MENSUAL: `(año, mes)`; RANGO_MESES: `((año, mes), (año, mes))`;
    #: RANGO_PERSONALIZADO: `(date, date)`.
    periodo: tuple
    fecha_corte: datetime | None
    roles: tuple[str, ...] = ()
    areas: tuple[int, ...] = ()
    colaboradores: tuple[int, ...] = ()

    def filtros(self) -> dict:
        """Los filtros tal como quedan guardados en el informe (la forma de
        `ExecutiveReportFilters` de Nexo, serializable)."""
        if self.tipo == ExecutiveReportSnapshot.Type.MENSUAL:
            year, month = self.periodo
            periodo = {"tipoReporte": self.tipo, "month": month, "year": year}
        elif self.tipo == ExecutiveReportSnapshot.Type.RANGO_MESES:
            (fy, fm), (ty, tm) = self.periodo
            periodo = {"tipoReporte": self.tipo, "from": f"{fy}-{fm:02d}", "to": f"{ty}-{tm:02d}"}
        else:
            desde, hasta = self.periodo
            periodo = {"tipoReporte": self.tipo, "from": desde.isoformat(), "to": hasta.isoformat()}
        return {
            "periodo": periodo,
            "fechaCorte": self.fecha_corte.isoformat() if self.fecha_corte else None,
            "roles": list(self.roles),
            "areas": list(self.areas),
            "colaboradores": list(self.colaboradores),
        }


# ── Bitácora ────────────────────────────────────────────────────────────────


def log_report_audit(*, report_id: str, action: str, user, **campos) -> None:
    """Nunca lanza: la bitácora no puede tumbar lo que audita (como
    `logReportAudit` de Nexo). Corre en su propio punto de guardado para que un
    fallo no deje rota la transacción de quien la llama."""
    try:
        with transaction.atomic():
            ExecutiveReportAuditLog.objects.create(
                report_id=report_id, action=action, user=user, **campos
            )
    except Exception:  # noqa: BLE001
        logger.exception("[informes] no se pudo registrar el evento de auditoría")


# ── Generación ──────────────────────────────────────────────────────────────


def _construir(actor, pedido: Pedido, roster: dict, now: datetime, report_id: str):
    comun = {
        "actor": actor,
        "roster": roster,
        "fecha_corte": pedido.fecha_corte,
        "now": now,
        "report_id": report_id,
    }
    if pedido.tipo == ExecutiveReportSnapshot.Type.MENSUAL:
        year, month = pedido.periodo
        return build_monthly(year=year, month=month, **comun)
    if pedido.tipo == ExecutiveReportSnapshot.Type.RANGO_MESES:
        desde, hasta = pedido.periodo
        return build_range(desde=desde, hasta=hasta, **comun)
    desde, hasta = pedido.periodo
    return build_custom_range(desde=desde, hasta=hasta, **comun)


def _reciente_identico(actor, filtros: dict, now: datetime):
    """El informe que esta persona emitió con los mismos filtros hace menos de
    `VENTANA_IDEMPOTENCIA`, si lo hay."""
    candidatos = ExecutiveReportSnapshot.objects.filter(
        generated_by=actor, generated_at__gte=now - VENTANA_IDEMPOTENCIA
    ).order_by("-generated_at")
    for snap in candidatos.only("id", "report_id", "filters", "generated_by_id"):
        if snap.filters == filtros:
            return ExecutiveReportSnapshot.objects.select_related("generated_by").get(pk=snap.pk)
    return None


def _guardar(actor, doc: dict, filtros: dict, roster: dict, now: datetime):
    """Inserta el informe; ante una colisión del Report ID genera otro y
    reintenta (la unicidad la garantiza la base, no el generador)."""
    meta = doc["meta"]
    for _ in range(MAX_REPORT_ID_ATTEMPTS):
        try:
            with transaction.atomic():
                return ExecutiveReportSnapshot.objects.create(
                    report_id=meta["reportId"],
                    type=meta["type"],
                    scope=meta["scope"],
                    origin=meta["origin"],
                    integrity_flag=meta["integrityFlag"],
                    generated_by=actor,
                    generated_at=now,
                    period_label=meta["periodLabel"],
                    period_start=_desde_iso(meta["periodStart"]),
                    period_end=_desde_iso(meta["periodEnd"]),
                    fecha_corte=_desde_iso(meta["fechaCorte"]),
                    period_status=meta["periodStatus"],
                    filters=filtros,
                    collaborator_ids=list(roster["user_ids"]),
                    collaborator_count=len(roster["user_ids"]),
                    analytics_engine_version=meta["versions"]["analyticsEngineVersion"],
                    formula_set_version=meta["versions"]["formulaSetVersion"],
                    reporting_engine_version=meta["versions"]["reportingEngineVersion"],
                    nexo_version=meta["versions"]["nexoVersion"],
                    data=doc,
                    nova=doc["nova"],
                    nova_degraded=doc["novaDegraded"],
                    data_quality=doc["estadoGeneral"]["dataQuality"],
                    generation_ms=meta["generationMs"],
                )
        except IntegrityError:
            if (
                not ExecutiveReportSnapshot.objects.todas()
                .filter(report_id=meta["reportId"])
                .exists()
            ):
                raise
            meta["reportId"] = generate_report_id(timezone.now())
    raise InformeError(
        "No se pudo asignar un Report ID único al informe. Intente de nuevo.",
        code="report_id_no_disponible",
        status=503,
    )


def _desde_iso(texto: str) -> datetime:
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))


def generar_informe(actor, pedido: Pedido) -> tuple[ExecutiveReportSnapshot, bool]:
    """Resuelve el roster, construye el documento, lo guarda inmutable con su
    Report ID, registra los incidentes de integridad y audita. Devuelve
    `(informe, creado)`: `creado` es False si se devolvió el que la misma
    persona acababa de emitir con los mismos filtros (idempotencia)."""
    now = timezone.now()
    filtros = pedido.filtros()

    previo = _reciente_identico(actor, filtros, now)
    if previo is not None:
        return previo, False

    roster = access.resolver_roster(
        actor, roles=pedido.roles, areas=pedido.areas, colaboradores=pedido.colaboradores
    )
    if not roster["user_ids"]:
        raise InformeError(
            "No hay colaboradores en su alcance con esos filtros: revise el rol, el área o las "
            "personas elegidas. Un informe sin colaboradores no se emite.",
            code="roster_vacio",
            status=422,
        )

    # Report ID provisional: si la generación falla antes de tener el suyo,
    # la bitácora igual registra el intento con un identificador.
    provisional = generate_report_id(now)
    inicio = timezone.now()
    try:
        doc, incidentes = _construir(actor, pedido, roster, now, provisional)
        snapshot = _guardar(actor, doc, filtros, roster, now)
    except InformeError:
        raise
    except Exception as exc:
        # El detalle técnico va al log, nunca a la respuesta (como Nexo).
        logger.exception("[informes] falló la generación del informe %s", provisional)
        log_report_audit(
            report_id=provisional,
            action=ExecutiveReportAuditLog.Action.GENERATION_FAILED,
            user=actor,
            step="construir_informe",
            message=type(exc).__name__,
            filters_applied=filtros,
            generation_ms=int((timezone.now() - inicio).total_seconds() * 1000),
        )
        raise InformeError(
            "No se pudo generar el informe. Intente de nuevo; si persiste, avise a quien "
            "administra el sistema.",
            code="generacion_fallida",
            status=500,
        ) from exc

    for incidente in incidentes:
        try:
            with transaction.atomic():
                ExecutiveReportIntegrityIncident.objects.create(
                    report_id=snapshot.report_id,
                    source=ExecutiveReportIntegrityIncident.Source.KPIS_TEAM,
                    detected_at=now,
                    **incidente,
                )
        except Exception:  # noqa: BLE001 — la validación nunca bloquea el informe
            logger.exception("[informes] no se pudo registrar un incidente de integridad")

    log_report_audit(
        report_id=snapshot.report_id,
        action=ExecutiveReportAuditLog.Action.GENERATED,
        user=actor,
        period=snapshot.period_label,
        fecha_corte=snapshot.fecha_corte,
        filters_applied=filtros,
        collaborator_count=snapshot.collaborator_count,
        generation_ms=snapshot.generation_ms,
        analytics_engine_version=snapshot.analytics_engine_version,
        formula_set_version=snapshot.formula_set_version,
        nexo_version=snapshot.nexo_version,
    )
    return snapshot, True


# ── Lectura ─────────────────────────────────────────────────────────────────


def ensure_snapshot_meta(snapshot: ExecutiveReportSnapshot) -> dict:
    """Los informes LEGACY_MIGRATION de Nexo se guardaron sin `meta` en `data`
    (fallo de su propio backfill). Se repara AL LEER, con las columnas de la
    fila, sin reescribir nada: `data` sale siempre completo."""
    data = snapshot.data if isinstance(snapshot.data, dict) else {}
    if data.get("meta"):
        return data
    autor = snapshot.generated_by
    return {
        **data,
        "meta": {
            "reportId": snapshot.report_id,
            "origin": snapshot.origin,
            "integrityFlag": snapshot.integrity_flag,
            "type": snapshot.type,
            # El informe mensual antiguo nunca filtró el roster: CONSOLIDADO.
            "rosterKind": "CONSOLIDADO",
            "scope": snapshot.scope,
            "periodLabel": snapshot.period_label,
            "periodStart": snapshot.period_start.isoformat(),
            "periodEnd": snapshot.period_end.isoformat(),
            "fechaCorte": snapshot.fecha_corte.isoformat(),
            "periodStatus": snapshot.period_status,
            "closure": None,
            "collaboratorIds": snapshot.collaborator_ids,
            "collaboratorCount": snapshot.collaborator_count,
            "generatedBy": {"userId": autor.pk, "name": autor.first_name or autor.username},
            "generatedAt": snapshot.generated_at.isoformat(),
            "generationMs": snapshot.generation_ms,
            "versions": {
                "analyticsEngineVersion": snapshot.analytics_engine_version,
                "formulaSetVersion": snapshot.formula_set_version,
                "reportingEngineVersion": snapshot.reporting_engine_version,
                "nexoVersion": snapshot.nexo_version,
            },
        },
    }


def _autor(snapshot) -> dict:
    autor = snapshot.generated_by
    return {"id": autor.pk, "name": autor.get_full_name() or autor.username}


def fila_del_listado(snapshot: ExecutiveReportSnapshot) -> dict:
    """Solo metadatos: el listado nunca trae el documento."""
    return {
        "report_id": snapshot.report_id,
        "type": snapshot.type,
        "type_label": snapshot.get_type_display(),
        "scope": snapshot.scope,
        "origin": snapshot.origin,
        "integrity_flag": snapshot.integrity_flag,
        "period_label": snapshot.period_label,
        "period_start": snapshot.period_start,
        "period_end": snapshot.period_end,
        "fecha_corte": snapshot.fecha_corte,
        "period_status": snapshot.period_status,
        "period_status_label": snapshot.get_period_status_display(),
        "collaborator_count": snapshot.collaborator_count,
        "generated_by": _autor(snapshot),
        "generated_at": snapshot.generated_at,
    }


def detalle(snapshot: ExecutiveReportSnapshot) -> dict:
    """El informe completo: sus metadatos, el documento congelado (`data`) y
    las once páginas ya armadas (`pages`) para la vista imprimible."""
    data = ensure_snapshot_meta(snapshot)
    return {
        **fila_del_listado(snapshot),
        "generation_ms": snapshot.generation_ms,
        "analytics_engine_version": snapshot.analytics_engine_version,
        "formula_set_version": snapshot.formula_set_version,
        "reporting_engine_version": snapshot.reporting_engine_version,
        "nexo_version": snapshot.nexo_version,
        "filters": snapshot.filters,
        "data": data,
        "pages": construir_paginas(data),
        "nova": snapshot.nova,
        "nova_degraded": snapshot.nova_degraded,
        "data_quality": snapshot.data_quality,
    }


def informes_visibles(viewer, *, tipo=None, estado=None):
    """Los informes de la empresa activa que `viewer` puede abrir, del más
    reciente al más antiguo. El filtro de visibilidad corre en Python (necesita
    el equipo de `viewer` y la lista de personas de cada informe) sobre
    columnas livianas: nunca carga los documentos."""
    qs = ExecutiveReportSnapshot.objects.all()
    if tipo:
        qs = qs.filter(type=tipo)
    if estado:
        qs = qs.filter(period_status=estado)
    puede = access.visibles_para(viewer)
    ids = [
        pk
        for pk, autor, colaboradores in qs.order_by("-generated_at", "-pk").values_list(
            "pk", "generated_by_id", "collaborator_ids"
        )
        if puede(autor, colaboradores)
    ]
    return ids


def pagina_de_informes(ids: list[int], page: int, page_size: int) -> list[ExecutiveReportSnapshot]:
    tramo = ids[(page - 1) * page_size : page * page_size]
    por_id = {
        s.pk: s
        for s in ExecutiveReportSnapshot.objects.filter(pk__in=tramo)
        .select_related("generated_by")
        .defer("data", "nova", "data_quality")
    }
    return [por_id[pk] for pk in tramo if pk in por_id]


def informe_visible(viewer, report_id: str) -> ExecutiveReportSnapshot:
    """El informe, si es de la empresa activa y `viewer` puede abrirlo. Si
    no, 404 en ambos casos: no se revela que existe."""
    snapshot = (
        ExecutiveReportSnapshot.objects.select_related("generated_by")
        .filter(report_id=report_id)
        .first()
    )
    if snapshot is None or not access.puede_ver_informe(viewer, snapshot):
        raise InformeError("Informe no encontrado.", code="not_found", status=404)
    return snapshot


__all__ = [
    "InformeError",
    "Pedido",
    "date",
    "detalle",
    "ensure_snapshot_meta",
    "generar_informe",
    "informe_visible",
    "informes_visibles",
    "log_report_audit",
]
