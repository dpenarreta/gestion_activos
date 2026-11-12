"""Lógica de las ausencias (permisos y estados especiales), portada de
`apps.configuration` de Nexo.

Dos partes:

1. **Las consultas del KPI** (`get_leave_minutes_by_day`,
   `leave_hours_for_day`, `total_leave_minutes`,
   `get_special_status_day_map`, `get_team_special_status_day_map`), réplica
   1:1 de Nexo, acotadas a la empresa activa por el gestor de los modelos.
   Devuelven el detalle por tipo: quien las use para mostrar algo tiene que
   enmascararlo con `redact_leave_totals` / `redact_leave_day` según
   `access.can_see_leave_detail`.
2. **El registro**: crear (un registro por día laborable del rango), eliminar
   y listar con el enmascarado de `access.py`; los estados especiales.

Los feriados son los del calendario institucional de la empresa
(`apps.nomina.dias_habiles.feriados`), los mismos que usan Novedades, Tareas y
el rol de pagos (en Nexo, su tabla `Holiday`).

Auditoría sin datos de salud: las acciones son genéricas
(`ausencias.registro_*`, objetivo «ausencia») y no llevan tipo ni
observación; un estado especial se audita igual que un permiso, para que no
se distinga cuál de los dos se registró.
"""

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.nomina.dias_habiles import feriados
from apps.tasks.business_time import business_calendar_day
from apps.tasks.rounding import round_half_up

from . import access
from .models import LeaveRecord, SpecialStatus

User = get_user_model()

AUDIT_MODULE = "ausencias"
AUDIT_TARGET = "ausencia"

#: Tope de un rango de permisos: un año. Un rango mayor es casi seguro un
#: error de digitación y crearía cientos de filas.
MAX_RANGE_DAYS = 366


class AusenciasError(Exception):
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


def _not_found(message: str) -> AusenciasError:
    return AusenciasError(message, code="not_found", status=404)


def _forbidden(message: str) -> AusenciasError:
    return AusenciasError(message, code="permission_denied", status=403)


def display_name(user) -> str:
    if user is None:
        return ""
    return (user.get_full_name() or "").strip() or user.username


def _audit(actor, action: str, *, target_id, previous=None, new=None, context=None) -> None:
    record_audit_event(
        actor=actor,
        action=f"ausencias.{action}",
        target_type=AUDIT_TARGET,
        target_id=target_id,
        module=AUDIT_MODULE,
        previous_values=previous,
        new_values=new,
        context=context,
    )


def member_of_company(user_id) -> User | None:
    """La cuenta, si trabaja en la empresa activa (si no, como si no
    existiera)."""
    personas = User.objects.filter(pk=user_id)
    empresa = empresa_actual()
    if empresa is SIN_EMPRESA:
        return None
    if empresa is not None:
        personas = personas.filter(membresias__empresa=empresa)
    return personas.distinct().first()


# ── Consultas del KPI (réplica 1:1 de Nexo) ─────────────────────────────────


def _empty_day() -> dict:
    return {
        "medico_minutes": 0,
        "medico_full_day": False,
        "personal_minutes": 0,
        "personal_full_day": False,
        "vacaciones_full_day": False,
    }


def _add_to_day(entry: dict, record: LeaveRecord) -> None:
    if record.type == LeaveRecord.Type.MEDICO:
        if record.is_full_day:
            entry["medico_full_day"] = True
        else:
            entry["medico_minutes"] += record.duration_minutes or 0
    elif record.type == LeaveRecord.Type.PERSONAL:
        if record.is_full_day:
            entry["personal_full_day"] = True
        else:
            entry["personal_minutes"] += record.duration_minutes or 0
    else:
        entry["vacaciones_full_day"] = True


def get_leave_minutes_by_day(user, range_start: date, range_end: date) -> dict[date, dict]:
    """Permisos de `user` por día dentro de `[range_start, range_end]`."""
    records = LeaveRecord.objects.filter(user=user, date__gte=range_start, date__lte=range_end)
    day_map: dict[date, dict] = {}
    for record in records:
        _add_to_day(day_map.setdefault(record.date, _empty_day()), record)
    return day_map


def get_team_leave_minutes_by_day(
    users, range_start: date, range_end: date
) -> dict[int, dict[date, dict]]:
    """Igual que `get_leave_minutes_by_day` para varias personas en una sola
    consulta (para el KPI de un equipo). Solo trae a quien tiene permisos."""
    user_ids = [u.pk for u in users]
    if not user_ids:
        return {}
    result: dict[int, dict[date, dict]] = {}
    records = LeaveRecord.objects.filter(
        user_id__in=user_ids, date__gte=range_start, date__lte=range_end
    )
    for record in records:
        day_map = result.setdefault(record.user_id, {})
        _add_to_day(day_map.setdefault(record.date, _empty_day()), record)
    return result


def leave_hours_for_day(info: dict | None, hours_per_day: float) -> float:
    """Horas de base a descontar ese día: un día completo descuenta la base
    entera; los parciales, sus minutos, con la base como tope."""
    if not info:
        return 0.0
    if info["medico_full_day"] or info["personal_full_day"] or info["vacaciones_full_day"]:
        return hours_per_day
    hours = info["medico_minutes"] / 60 + info["personal_minutes"] / 60
    return min(hours, hours_per_day)


def total_leave_minutes(
    day_map: dict[date, dict], start: date, end: date, hours_per_day: float
) -> dict:
    """Minutos de permiso médico, personal y de vacaciones en un rango (el
    desglose del KPI mensual). Contiene el dato de salud: para mostrarlo a
    quien no es el titular, pasarlo por `redact_leave_totals`."""
    medico = personal = vacaciones = 0.0
    current = start
    while current <= end:
        info = day_map.get(current)
        if info:
            medico += hours_per_day * 60 if info["medico_full_day"] else info["medico_minutes"]
            personal += (
                hours_per_day * 60 if info["personal_full_day"] else info["personal_minutes"]
            )
            vacaciones += hours_per_day * 60 if info["vacaciones_full_day"] else 0
        current += timedelta(days=1)
    return {
        "medico_minutes": round_half_up(medico),
        "personal_minutes": round_half_up(personal),
        "vacaciones_minutes": round_half_up(vacaciones),
    }


def redact_leave_totals(totals: dict) -> dict:
    """El desglose de `total_leave_minutes` reducido a «ausencia» (lo que
    hacía `redact_sensitive_workload_detail` de Nexo con el mensual)."""
    return {
        "medico_minutes": 0,
        "personal_minutes": 0,
        "vacaciones_minutes": 0,
        "ausencia_minutes": (
            (totals.get("medico_minutes") or 0)
            + (totals.get("personal_minutes") or 0)
            + (totals.get("vacaciones_minutes") or 0)
        ),
    }


def redact_leave_day(info: dict | None) -> dict | None:
    """Un día de `get_leave_minutes_by_day` reducido a «ausencia»: los
    minutos parciales sumados y «día completo» si lo fue por cualquier tipo.
    Las horas que descuenta (`leave_hours_for_day`) no cambian."""
    if not info:
        return info
    return {
        "medico_minutes": 0,
        "medico_full_day": False,
        "personal_minutes": info["medico_minutes"] + info["personal_minutes"],
        "personal_full_day": (
            info["medico_full_day"] or info["personal_full_day"] or info["vacaciones_full_day"]
        ),
        "vacaciones_full_day": False,
    }


def _special_status_day_config(record: SpecialStatus) -> dict:
    return {
        "type": record.type,
        "daily_hours": record.daily_hours,
        "limit_low": record.limit_low,
        "limit_base": record.limit_base,
        "limit_high": record.limit_high,
        "limit_overload": record.limit_overload,
    }


def _overlapping_statuses(range_start: date, range_end: date):
    """Como en Nexo, no se filtra por `is_active`: finalizar un estado
    especial le pone fecha fin, y hasta ese día sigue rigiendo."""
    return SpecialStatus.objects.filter(start_date__lte=range_end).filter(
        Q(end_date__isnull=True) | Q(end_date__gte=range_start)
    )


def _fill_days(day_map: dict, record: SpecialStatus, range_start: date, range_end: date) -> None:
    day_from = max(record.start_date, range_start)
    day_to = min(record.end_date, range_end) if record.end_date else range_end
    config = _special_status_day_config(record)
    current = day_from
    while current <= day_to:
        day_map[current] = config
        current += timedelta(days=1)


def get_special_status_day_map(user, range_start: date, range_end: date) -> dict[date, dict]:
    """Días con estado especial de `user` en el rango, con su configuración."""
    day_map: dict[date, dict] = {}
    for record in _overlapping_statuses(range_start, range_end).filter(user=user):
        _fill_days(day_map, record, range_start, range_end)
    return day_map


def get_team_special_status_day_map(
    users, range_start: date, range_end: date
) -> dict[int, dict[date, dict]]:
    """Lo mismo para varias personas en una sola consulta; solo trae a quien
    tiene algún estado especial en el rango."""
    user_ids = [u.id for u in users]
    if not user_ids:
        return {}
    result: dict[int, dict[date, dict]] = {}
    for record in _overlapping_statuses(range_start, range_end).filter(user_id__in=user_ids):
        _fill_days(result.setdefault(record.user_id, {}), record, range_start, range_end)
    return result


def redact_special_status_day(config: dict | None) -> dict | None:
    """La configuración de un día sin el tipo (maternidad o lactancia), para
    quien no es el titular: la base y los límites siguen valiendo."""
    if not config:
        return config
    return {**config, "type": None}


# ── Permisos: registro, consulta y borrado ──────────────────────────────────


def business_days_between(start: date, end: date) -> list[date]:
    """Días de lunes a viernes que no son feriado de la empresa."""
    no_laborables = feriados(start, end)
    dias, current = [], start
    while current <= end:
        if current.weekday() < 5 and current not in no_laborables:
            dias.append(current)
        current += timedelta(days=1)
    return dias


def serialize_leave_record(record: LeaveRecord, viewer) -> dict:
    """El registro como lo ve `viewer`: enmascarado si no es el titular ni
    tiene `ausencias.medicas_ver`. Mismas claves que Nexo."""
    detalle = access.can_see_leave_detail(viewer, record.user_id)
    return {
        "id": record.id,
        "userId": record.user_id,
        "user": {"id": record.user_id, "name": display_name(record.user)},
        "type": record.type if detalle else access.MASKED_TYPE,
        "date": record.date.isoformat(),
        "isFullDay": record.is_full_day,
        "durationMinutes": record.duration_minutes,
        "observation": record.observation if detalle else None,
        "masked": not detalle,
        # Lo que viene de una solicitud se gestiona desde ella (409 aquí).
        "solicitudId": record.solicitud_id,
        "descuento": record.descuento,
        "canDelete": record.solicitud_id is None and access.can_delete(viewer, record),
    }


class LeaveRecordService:
    @staticmethod
    def list_for(viewer, *, user_id=None, month: str | None = None, leave_type: str | None = None):
        """Las ausencias que `viewer` ve, más recientes primero."""
        if leave_type and not access.can(viewer, access.MEDICAS_VER):
            raise _forbidden("No tiene permiso para consultar las ausencias por tipo.")
        queryset = LeaveRecord.objects.select_related("user")
        ids = access.visible_user_ids(viewer)
        if ids is not None:
            queryset = queryset.filter(user_id__in=ids)
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        if leave_type:
            queryset = queryset.filter(type=leave_type)
        if month and len(month) == 7 and month[4] == "-":
            try:
                year, mm = int(month[:4]), int(month[5:7])
                month_start = date(year, mm, 1)
                month_end = (
                    date(year + 1, 1, 1) if mm == 12 else date(year, mm + 1, 1)
                ) - timedelta(days=1)
                queryset = queryset.filter(date__gte=month_start, date__lte=month_end)
            except ValueError:
                pass
        return [serialize_leave_record(r, viewer) for r in queryset.order_by("-date", "-id")]

    @staticmethod
    def create_range(
        *,
        actor,
        user_id: int,
        leave_type: str,
        start_date: date,
        end_date: date,
        is_full_day: bool,
        duration_minutes: int | None = None,
        observation: str | None = None,
        context=None,
    ) -> list[LeaveRecord]:
        """Un registro por cada día laborable del rango (nunca uno solo por
        todo el rango), como en Nexo."""
        if not access.can_create(actor, leave_type):
            raise _forbidden("No tiene permiso para registrar este tipo de ausencia.")
        user = member_of_company(user_id)
        if user is None:
            raise _not_found("Usuario no encontrado")
        if (end_date - start_date).days >= MAX_RANGE_DAYS:
            raise AusenciasError(
                "El rango no puede superar un año.",
                details={"end_date": ["El rango no puede superar un año."]},
            )
        business_days = business_days_between(start_date, end_date)
        if not business_days:
            raise AusenciasError(
                "El rango seleccionado no incluye días laborables",
                details={"start_date": ["El rango seleccionado no incluye días laborables"]},
            )
        trimmed_observation = (observation or "").strip() or None
        with transaction.atomic():
            records = [
                LeaveRecord.objects.create(
                    user=user,
                    type=leave_type,
                    date=day,
                    is_full_day=is_full_day,
                    duration_minutes=None if is_full_day else duration_minutes,
                    observation=trimmed_observation,
                    created_by=actor,
                )
                for day in business_days
            ]
            _audit(
                actor,
                "registro_creado",
                target_id=user.pk,
                new={
                    "user_id": user.pk,
                    "desde": business_days[0].isoformat(),
                    "hasta": business_days[-1].isoformat(),
                    "dias": len(business_days),
                    "dia_completo": is_full_day,
                    "minutos": None if is_full_day else duration_minutes,
                },
                context=context,
            )
        return records

    @staticmethod
    def delete(*, actor, pk, context=None) -> None:
        """404 si no la ve; 403, con el mismo mensaje para cualquier tipo, si
        la ve y no puede eliminarla."""
        record = LeaveRecord.objects.filter(pk=pk).first()
        ids = access.visible_user_ids(actor) if record else None
        if record is None or (ids is not None and record.user_id not in ids):
            raise _not_found("Ausencia no encontrada.")
        if record.solicitud_id is not None:
            # Antes que el permiso: sea quien sea, se gestiona desde la
            # solicitud (y el mensaje no depende del tipo).
            raise _linked_to_request(record)
        if not access.can_delete(actor, record):
            raise _forbidden("Solo puede eliminar las ausencias que registró usted.")
        # El objetivo de la auditoría es la persona, como al registrar: así no
        # se distingue en ella un permiso de un estado especial.
        previous = {"user_id": record.user_id, "desde": record.date.isoformat()}
        with transaction.atomic():
            record.delete()
            _audit(
                actor,
                "registro_eliminado",
                target_id=previous["user_id"],
                previous=previous,
                context=context,
            )


# ── Desde la Solicitud de permisos (apps.licencias) ────────────────────────


def days_for_request(flujo, desde: date, hasta: date, descuento: str | None = None) -> list[date]:
    """Los días de una solicitud por días que se registran como ausencia.

    Como se cuentan hoy los días del permiso (`licencias.restricciones`): el
    rango completo, de `desde` a `hasta`. Sin los feriados de la empresa, que
    no son día de trabajo. Los sábados y domingos, solo si el tipo los cuenta:
    con descuento de vacaciones y su regla de sábados (o de domingos) por
    período, porque entonces salen de las vacaciones como cualquier otro día;
    en los demás tipos (y en vacaciones sin esa regla) no se registran."""
    descuento = flujo.descuento if descuento is None else descuento
    vacaciones = descuento == flujo.Descuento.VACACIONES
    cuenta = {
        5: vacaciones and flujo.sabados_por_periodo > 0,
        6: vacaciones and flujo.domingos_por_periodo > 0,
    }
    no_laborables = feriados(desde, hasta)
    dias, current = [], desde
    while current <= hasta:
        weekday = current.weekday()
        if current not in no_laborables and (weekday < 5 or cuenta[weekday]):
            dias.append(current)
        current += timedelta(days=1)
    return dias


def create_from_request(solicitud, *, actor) -> list[LeaveRecord]:
    """Las ausencias de una solicitud que acaba de aprobarse. Corre dentro de
    la transacción de la aprobación (`licencias.services._terminar`).

    - Por días: una de día completo por cada día de `days_for_request`.
    - Por horas: una sola, en su día, con `duration_minutes`.

    Cada una lleva el tipo de ausencia y el descuento del tipo de permiso, y
    la solicitud. **LOPDP:** el motivo y el adjunto de la solicitud no se
    copian (la observación queda vacía); una MÉDICA queda protegida igual que
    una registrada a mano (`access.py`); la auditoría es la genérica, sin
    tipo, y no hay aviso (el de la solicitud ya lo da Institucional).

    Idempotente: si la solicitud ya tiene sus ausencias no crea más (y la
    restricción única `(solicitud, date)` lo garantiza en la base)."""
    existentes = list(LeaveRecord.objects.todas().filter(solicitud=solicitud))
    if existentes:
        return existentes
    # La clasificación de la solicitud (copiada del tipo al pedirla): si el
    # tipo cambió después, la solicitud sigue siendo lo que se pidió.
    flujo = solicitud.flujo
    if solicitud.por_horas:
        minutos = solicitud.minutos
        if not minutos or minutos <= 0:
            return []
        dias, dia_completo = [solicitud.desde], False
    else:
        dias, dia_completo, minutos = (
            days_for_request(
                flujo, solicitud.desde, solicitud.hasta, descuento=solicitud.descuento
            ),
            True,
            None,
        )
    if not dias:
        return []
    records = LeaveRecord.objects.bulk_create(
        [
            LeaveRecord(
                empresa_id=solicitud.empresa_id,
                user_id=solicitud.solicitante_id,
                type=solicitud.tipo_ausencia,
                date=day,
                is_full_day=dia_completo,
                duration_minutes=minutos,
                observation=None,
                created_by=actor,
                solicitud=solicitud,
                descuento=solicitud.descuento,
            )
            for day in dias
        ]
    )
    _audit(
        actor,
        "registro_creado",
        target_id=solicitud.solicitante_id,
        new={
            "user_id": solicitud.solicitante_id,
            "desde": dias[0].isoformat(),
            "hasta": dias[-1].isoformat(),
            "dias": len(dias),
            "dia_completo": dia_completo,
            "minutos": minutos,
            "origen": "solicitud",
        },
    )
    return records


def delete_for_request(solicitud, *, actor, desde: date | None = None) -> int:
    """Al cancelarse una solicitud aprobada: borra sus ausencias, dentro de la
    transacción de la cancelación. Auditoría genérica, sin tipo.

    Con `desde`, solo las de esa fecha en adelante (US-012, 12/11/2026): al
    cancelar unas vacaciones en curso, las de los días ya pasados se quedan
    (la persona faltó esos días) y siguen ligadas a la solicitud."""
    registros = LeaveRecord.objects.todas().filter(solicitud=solicitud)
    if desde is not None:
        registros = registros.filter(date__gte=desde)
    fechas = list(registros.order_by("date").values_list("date", flat=True))
    if not fechas:
        return 0
    borradas, _ = registros.delete()
    _audit(
        actor,
        "registro_eliminado",
        target_id=solicitud.solicitante_id,
        previous={
            "user_id": solicitud.solicitante_id,
            "desde": fechas[0].isoformat(),
            "hasta": fechas[-1].isoformat(),
            "dias": len(fechas),
            "origen": "solicitud",
        },
    )
    return borradas


def _linked_to_request(record: LeaveRecord) -> AusenciasError:
    return AusenciasError(
        f"Este registro viene de la solicitud N.º {record.solicitud_id}; gestiónelo desde "
        "Solicitud de permisos.",
        code="linked_to_request",
        status=409,
        details={"solicitud_id": record.solicitud_id},
    )


# ── Estados especiales ──────────────────────────────────────────────────────


def serialize_special_status(record: SpecialStatus) -> dict:
    return {
        "id": record.id,
        "userId": record.user_id,
        "user": {"id": record.user_id, "name": display_name(record.user)},
        "type": record.type,
        "startDate": record.start_date.isoformat(),
        "endDate": record.end_date.isoformat() if record.end_date else None,
        "isActive": record.is_active,
        "dailyHours": record.daily_hours,
        "limitLow": record.limit_low,
        "limitBase": record.limit_base,
        "limitHigh": record.limit_high,
        "limitOverload": record.limit_overload,
    }


class SpecialStatusService:
    """Todo exige `ausencias.estados_gestionar` (lo comprueba la vista)."""

    @staticmethod
    def list(*, user_id=None) -> list[dict]:
        queryset = SpecialStatus.objects.select_related("user")
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        return [serialize_special_status(s) for s in queryset.order_by("-start_date", "-id")]

    @staticmethod
    def get(pk) -> SpecialStatus:
        record = SpecialStatus.objects.select_related("user").filter(pk=pk).first()
        if record is None:
            raise _not_found("Estado especial no encontrado.")
        return record

    @staticmethod
    def create(*, actor, data: dict, context=None) -> SpecialStatus:
        user = member_of_company(data["user_id"])
        if user is None:
            raise _not_found("Usuario no encontrado")
        with transaction.atomic():
            record = SpecialStatus.objects.create(
                user=user,
                type=data["type"],
                start_date=data["start_date"],
                end_date=data.get("end_date"),
                daily_hours=data["daily_hours"],
                limit_low=data["limit_low"],
                limit_base=data["limit_base"],
                limit_high=data["limit_high"],
                limit_overload=data["limit_overload"],
                created_by=actor,
            )
            _audit(
                actor,
                "registro_creado",
                target_id=user.pk,
                new={
                    "user_id": user.pk,
                    "desde": record.start_date.isoformat(),
                    "hasta": record.end_date.isoformat() if record.end_date else None,
                },
                context=context,
            )
        return record

    @staticmethod
    def finalize(*, actor, pk, context=None) -> SpecialStatus:
        """Lo finaliza hoy (o en su fecha fin, si ya pasó): nunca lo
        extiende."""
        record = SpecialStatusService.get(pk)
        today = business_calendar_day(timezone.now())
        end_date = today if record.end_date is None or record.end_date > today else record.end_date
        previous = {"hasta": record.end_date.isoformat() if record.end_date else None}
        with transaction.atomic():
            record.is_active = False
            record.end_date = end_date
            record.save(update_fields=["is_active", "end_date", "updated_at"])
            _audit(
                actor,
                "registro_finalizado",
                target_id=record.user_id,
                previous=previous,
                new={"user_id": record.user_id, "hasta": end_date.isoformat()},
                context=context,
            )
        return record

    @staticmethod
    def delete(*, actor, pk, context=None) -> None:
        record = SpecialStatusService.get(pk)
        previous = {"user_id": record.user_id, "desde": record.start_date.isoformat()}
        with transaction.atomic():
            record.delete()
            _audit(
                actor,
                "registro_eliminado",
                target_id=previous["user_id"],
                previous=previous,
                context=context,
            )


def access_summary(user) -> dict:
    return {
        "permissions": access.effective_codenames(user),
        "sees_whole_company": access.sees_whole_company(user),
        "can_see_medical": access.can(user, access.MEDICAS_VER),
        "can_manage_special_status": access.can(user, access.ESTADOS_GESTIONAR),
    }


# ── Retención de las ausencias médicas (LOPDP) ──────────────────────────────

#: Cuánto se conservan los permisos MÉDICOS (decisión del usuario del
#: 05/11/2026): cinco años desde el día de la ausencia. Pasado ese plazo se
#: borran (`manage.py purgar_ausencias_medicas`, en la tarea de cada 5 min).
MEDICAL_RETENTION_YEARS = 5


def medical_retention_cutoff(today: date) -> date:
    """El primer día que todavía se conserva: lo de antes se borra. El 29 de
    febrero, si el año del corte no es bisiesto, pasa al 28."""
    year = today.year - MEDICAL_RETENTION_YEARS
    try:
        return today.replace(year=year)
    except ValueError:
        return today.replace(year=year, day=28)


def purge_expired_medical_leaves(
    *, today: date | None = None, simulate: bool = False
) -> list[dict]:
    """Borra los `LeaveRecord` MÉDICOS de hace más de cinco años, de todas
    las empresas (corre desde un comando, sin petición: `todas()` a
    propósito).

    Barato cuando no hay nada: una sola consulta `exists()` sobre el índice
    `(type, date)`. Si hay, por empresa y en una transacción, borra y deja en
    la auditoría de esa empresa una constancia **agregada**: cuántos registros
    y entre qué fechas, sin personas, sin observaciones y sin nada que
    identifique a alguien (`ausencias.retencion_purgada`).

    Devuelve un resumen por empresa: `{"empresa_id", "registros", "desde",
    "hasta"}`. Con `simulate`, solo cuenta."""
    from contextlib import nullcontext

    from django.db.models import Count, Max, Min

    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa

    today = today or business_calendar_day(timezone.now())
    cutoff = medical_retention_cutoff(today)
    vencidas = LeaveRecord.objects.todas().filter(type=LeaveRecord.Type.MEDICO, date__lt=cutoff)
    if not vencidas.exists():
        return []

    resumen = []
    grupos = (
        vencidas.values("empresa_id")
        .annotate(registros=Count("id"), desde=Min("date"), hasta=Max("date"))
        .order_by("empresa_id")
    )
    for grupo in grupos:
        empresa_id = grupo["empresa_id"]
        fila = {
            "empresa_id": empresa_id,
            "registros": grupo["registros"],
            "desde": grupo["desde"].isoformat(),
            "hasta": grupo["hasta"].isoformat(),
        }
        resumen.append(fila)
        if simulate:
            continue
        empresa = Empresa.objects.filter(pk=empresa_id).first() if empresa_id else None
        with usando_empresa(empresa) if empresa else nullcontext():
            with transaction.atomic():
                borradas, _ = vencidas.filter(empresa_id=empresa_id).delete()
                record_audit_event(
                    actor=None,
                    action="ausencias.retencion_purgada",
                    target_type=AUDIT_TARGET,
                    target_id=None,
                    module=AUDIT_MODULE,
                    new_values={
                        "registros": borradas,
                        "desde": fila["desde"],
                        "hasta": fila["hasta"],
                        "corte": cutoff.isoformat(),
                        "plazo_anios": MEDICAL_RETENTION_YEARS,
                    },
                )
        fila["registros"] = borradas
    return resumen
