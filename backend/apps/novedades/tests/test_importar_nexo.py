"""`manage.py importar_nexo`: migración de Novedades desde Nexo.

Sin base de Nexo: el comando recibe un lector en memoria (`LectorEnMemoria`)
con los mismos métodos que `LectorNexoSQL`. Los ids de Nexo son altos a
propósito, para que un id copiado sin remapear se note.
"""

import copy
from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management import CommandError, call_command

from apps.empresas.contexto import empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.novedades.models import (
    ClosedPeriodCorrection,
    Collaborator,
    CollaboratorAssignment,
    CollaboratorExitNotification,
    CollaboratorStatusChange,
    DepuratedOvertime,
    NovedadEvent,
    OperationalPeriod,
    OvertimeRecord,
    PermissionOverride,
    SettingHistory,
    SupervisorPeriod,
    WorkedDay,
)
from apps.novedades.nexo.importador import MODELOS, Enmascarador, normalizar_nombre
from apps.novedades.nexo.lector import TABLAS, ErrorDeNexo, LectorNexoSQL, convertir
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User
from config.db_routers import (
    EscrituraEnNexo,
    NexoSoloLecturaRouter,
    es_select,
    solo_select,
)


def t(dia, hora=13, minuto=0):
    return datetime(2026, 10, dia, hora, minuto, tzinfo=UTC)


# Usuarios de Nexo: 9010 supervisor, 9011 administrador, 9012 asistente;
# 9099 no aparece en ningún registro (solo tiene un rol).
SUP, ADM, ASIS, AJENO = 9010, 9011, 9012, 9099
USUARIOS_NEXO = [
    {"id": SUP, "username": "sup.uno", "email": "Sup.Uno@LAAR.com"},
    {"id": ADM, "username": "admin", "email": "admin.nexo@laar.com"},
    {"id": ASIS, "username": "asistente", "email": "asistente@laar.com"},
    {"id": AJENO, "username": "ajeno", "email": "ajeno@laar.com"},
]
ROLES_NEXO = [
    {"user_id": SUP, "rol": "SUPERVISOR_OPERACIONES"},
    {"user_id": ASIS, "rol": "ASISTENTE_OPERACIONES"},
    {"user_id": AJENO, "rol": "JEFE_OPERACIONES"},
]

CEDULA_JOSE = "0102030405"
CEDULA_ANTERIOR = "0911111111"


def datos_nexo() -> dict[str, list[dict]]:
    base_ot = {
        "saturday_hours": Decimal("0.00"),
        "is_saturday": False,
        "is_sunday": False,
        "is_holiday": False,
        "work_done": "Inventario de bodega",
        "observations": "",
        "version": 1,
        "created_by_id": SUP,
        "updated_by_id": SUP,
        "deleted_at": None,
        "deleted_by_id": None,
        "created_at": t(4),
        "updated_at": t(4, 15),
    }
    return {
        "collaborator": [
            {
                "id": 5001,
                "cedula": CEDULA_JOSE,
                "full_name": "PÉREZ ÑÚÑEZ JOSÉ",
                "regional": "Sierra",
                "area": "Bodega",
                "cargo": "Operador",
                "status": "ACTIVE",
                "current_supervisor_id": SUP,
                "created_by_id": ADM,
                "created_at": t(1, 8),
                "updated_at": t(2, 9),
                "worked_days_removed_at": None,
                "worked_days_removed_by_id": None,
                "worked_days_removed_reason": "",
            },
            {
                "id": 5002,
                "cedula": "1712345678",
                "full_name": "María López",
                "regional": "Costa",
                "area": "Despacho",
                "cargo": "Auxiliar",
                "status": "ACTIVE",
                "current_supervisor_id": SUP,
                "created_by_id": ADM,
                "created_at": t(1, 8, 5),
                "updated_at": t(1, 8, 5),
                "worked_days_removed_at": None,
                "worked_days_removed_by_id": None,
                "worked_days_removed_reason": "",
            },
            {
                "id": 5003,
                "cedula": "0923456789",
                "full_name": "Ana Inexistente",
                "regional": "Costa",
                "area": "Despacho",
                "cargo": "Auxiliar",
                "status": "INACTIVE",
                "current_supervisor_id": SUP,
                "created_by_id": ADM,
                "created_at": t(1, 8, 10),
                "updated_at": t(5, 10),
                "worked_days_removed_at": t(6),
                "worked_days_removed_by_id": ADM,
                "worked_days_removed_reason": "Salió de la operación",
            },
        ],
        "collaboratorassignment": [
            {
                "id": 5101,
                "collaborator_id": 5001,
                "supervisor_id": SUP,
                "started_at": t(1, 8),
                "ended_at": None,
                "assigned_by_id": ADM,
                "reason": "Alta",
            }
        ],
        "collaboratorstatuschange": [
            {
                "id": 5201,
                "collaborator_id": 5003,
                "previous_status": "ACTIVE",
                "new_status": "INACTIVE",
                "changed_by_id": ADM,
                "reason": "Renuncia",
                "created_at": t(5, 10),
            }
        ],
        "operationalperiod": [
            {
                "id": 7007,
                "year": 2026,
                "month": 10,
                "start_date": date(2026, 9, 23),
                "end_date": date(2026, 10, 22),
            },
            {
                "id": 7008,
                "year": 2026,
                "month": 9,
                "start_date": date(2026, 8, 23),
                "end_date": date(2026, 9, 22),
            },
        ],
        "supervisorperiod": [
            {
                "id": 7101,
                "period_id": 7008,
                "supervisor_id": SUP,
                "status": "CLOSED",
                "opened_at": t(1, 7),
                "closed_at": t(1, 18),
                "closed_by_id": ADM,
                "summary": {"dias": 1},
            }
        ],
        "overtimemonthclose": [
            {
                "id": 7201,
                "supervisor_id": SUP,
                "year": 2026,
                "month": 9,
                "closed_at": t(2, 18),
                "closed_by_id": ADM,
                "summary": {"horas": "0.00"},
            }
        ],
        "overtimerecord": [
            {
                **base_ot,
                "id": 8201,
                "collaborator_id": 5001,
                "period_id": 7007,
                "supervisor_id": SUP,
                "date": date(2026, 10, 3),
                "overtime_hours": Decimal("2.50"),
            },
            # Borrado lógico de la misma fecha que el activo.
            {
                **base_ot,
                "id": 8202,
                "collaborator_id": 5001,
                "period_id": 7007,
                "supervisor_id": SUP,
                "date": date(2026, 10, 3),
                "overtime_hours": Decimal("1.00"),
                "deleted_at": t(3, 20),
                "deleted_by_id": ADM,
            },
            # Dos borrados con la misma clave natural: se insertan uno a uno.
            {
                **base_ot,
                "id": 8203,
                "collaborator_id": 5002,
                "period_id": 7007,
                "supervisor_id": SUP,
                "date": date(2026, 10, 4),
                "overtime_hours": Decimal("0.00"),
                "saturday_hours": Decimal("4.00"),
                "is_saturday": True,
                "deleted_at": t(4, 20),
                "deleted_by_id": ADM,
            },
            {
                **base_ot,
                "id": 8204,
                "collaborator_id": 5002,
                "period_id": 7007,
                "supervisor_id": SUP,
                "date": date(2026, 10, 4),
                "overtime_hours": Decimal("3.00"),
                "deleted_at": t(4, 20),
                "deleted_by_id": ADM,
            },
            {
                **base_ot,
                "id": 8205,
                "collaborator_id": 5002,
                "period_id": 7007,
                "supervisor_id": SUP,
                "date": date(2026, 10, 4),
                "overtime_hours": Decimal("1.25"),
                "saturday_hours": Decimal("4.00"),
                "is_saturday": True,
            },
        ],
        "closedperiodcorrection": [
            {
                "id": 8301,
                "target": "WORKED_DAY",
                "target_id": 8104,
                "period_id": 7008,
                "supervisor_id": SUP,
                "original_values": {"hours": "6.00", "label": f"PÉREZ ÑÚÑEZ JOSÉ ({CEDULA_JOSE})"},
                "new_values": {"hours": "8.00"},
                "reason": "Error de digitación",
                "corrected_by_id": ADM,
                "created_at": t(3, 11),
            },
            {
                "id": 8302,
                "target": "OVERTIME",
                "target_id": 8201,
                "period_id": 7007,
                "supervisor_id": SUP,
                "original_values": {"overtime_hours": "2.00"},
                "new_values": {"overtime_hours": "2.50"},
                "reason": "Ajuste",
                "corrected_by_id": ADM,
                "created_at": t(5, 11),
            },
        ],
        "permissionoverride": [
            {
                "id": 8401,
                "user_id": SUP,
                "codename": "novedades.exportar",
                "effect": "GRANT",
                "reason": "Reportes del mes",
                "created_by_id": ADM,
                "created_at": t(2, 10),
                "revoked_at": None,
                "revoked_by_id": None,
                "revoke_reason": "",
            },
            {
                "id": 8402,
                "user_id": SUP,
                "codename": "novedades.importar",
                "effect": "GRANT",
                "reason": "Carga inicial",
                "created_by_id": ADM,
                "created_at": t(1, 10),
                "revoked_at": t(2, 10),
                "revoked_by_id": ADM,
                "revoke_reason": "Ya cargó",
            },
        ],
        "overtimedepuration": [
            {
                "id": 8501,
                "year": 2026,
                "month": 10,
                "created_at": t(6, 9),
                "created_by_id": ASIS,
                "source_count": 2,
                "source_overtime_hours": Decimal("3.75"),
                "source_saturday_hours": Decimal("4.00"),
                "supervisors_total": 1,
                "supervisors_closed": 0,
            }
        ],
        "depuratedovertime": [
            {
                "id": 8601,
                "depuration_id": 8501,
                "source_record_id": 8201,
                "source_id": 8201,
                "collaborator_id": 5001,
                "supervisor_id": SUP,
                "date": date(2026, 10, 3),
                "cedula": CEDULA_JOSE,
                "full_name": "PÉREZ ÑÚÑEZ JOSÉ",
                "regional": "Sierra",
                "area": "Bodega",
                "cargo": "Operador",
                "supervisor_name": "Sup Uno",
                "orig_overtime_hours": Decimal("2.50"),
                "orig_saturday_hours": Decimal("0.00"),
                "orig_is_saturday": False,
                "orig_is_sunday": False,
                "orig_is_holiday": False,
                "orig_work_done": "Inventario de bodega",
                "orig_observations": "",
                "overtime_hours": Decimal("2.00"),
                "saturday_hours": Decimal("0.00"),
                "is_saturday": False,
                "is_sunday": False,
                "is_holiday": False,
                "work_done": "Inventario de bodega",
                "observations": "Depurado",
                "excluded": False,
                "version": 2,
                "updated_at": t(7, 9),
                "updated_by_id": ASIS,
            }
        ],
        "depurationchange": [
            {
                "id": 8701,
                "depuration_id": 8501,
                "row_id": 8601,
                "field": "overtime_hours",
                "original_value": "2.50",
                "old_value": "2.50",
                "new_value": "2.00",
                "reason": "Exceso",
                "actor_id": ASIS,
                "created_at": t(7, 9),
            }
        ],
        "collaboratornotificationrecipient": [
            {
                "id": 8801,
                "kind": "EXIT",
                "email": "th@laar.com",
                "area": "TALENTO_HUMANO",
                "is_active": True,
                "created_at": t(1, 9),
                "created_by_id": ADM,
                "updated_at": t(1, 9),
                "updated_by_id": ADM,
            },
            {
                "id": 8802,
                "kind": "ENTRY",
                "email": "th@laar.com",
                "area": "TALENTO_HUMANO",
                "is_active": False,
                "created_at": t(1, 9),
                "created_by_id": ADM,
                "updated_at": t(3, 9),
                "updated_by_id": ADM,
            },
        ],
        "collaboratorexitnotification": [
            {
                "id": 8901,
                "status_change_id": 5201,
                "collaborator_id": 5003,
                "supervisor_id": SUP,
                "changed_by_id": ADM,
                "changed_at": t(5, 10),
                "previous_status": "ACTIVE",
                "new_status": "INACTIVE",
                "period_id": 7007,
                "snapshot": {"dias": []},
                "status": "SENT",
                "recipients": [{"email": "th@laar.com", "status": "SENT"}],
                "attempts": 1,
                "last_attempt_at": t(5, 10, 1),
                "last_error": "",
                "sent_at": t(5, 10, 1),
                "created_at": t(5, 10),
            }
        ],
        "collaboratorentrynotification": [
            {
                "id": 8951,
                "collaborator_id": 5001,
                "created_by_id": ADM,
                "created_at": t(1, 8),
                "first_day": date(2026, 10, 1),
                "second_day": None,
                "triggered_at": None,
                "supervisor_id": SUP,
                "period_id": 7007,
                "snapshot": None,
                "status": "WAITING",
                "recipients": [],
                "attempts": 0,
                "last_attempt_at": None,
                "last_error": "",
                "sent_at": None,
            }
        ],
        "novedadevent": [
            _evento(
                9101,
                "collaborator.created",
                "collaborator",
                "5001",
                target_label=f"PÉREZ ÑÚÑEZ JOSÉ ({CEDULA_JOSE})",
            ),
            _evento(
                9102,
                "collaborator.cedula_changed",
                "collaborator",
                "5001",
                field="cedula",
                old_value=CEDULA_ANTERIOR,
                new_value=CEDULA_JOSE,
            ),
            _evento(
                9103,
                "overtime.updated",
                "overtime",
                "8201",
                reason=f"Horas de {CEDULA_JOSE} corregidas; guía 01020304051",
            ),
            _evento(9104, "config.changed", "config", "novedades_overtime_grace_hours"),
            _evento(9105, "permission.override_created", "user", str(SUP)),
            _evento(9106, "correction.worked_day", "worked_day", "8104", period_id=7008),
            _evento(9107, "overtime.bulk_saved", "overtime_batch", "2026-10"),
        ],
        "systemconfighistory": [
            {
                "id": 9201,
                "key": "novedades_overtime_grace_hours",
                "value": "48",
                "valid_from": t(1),
                "valid_until": t(3),
                "updated_by_id": ADM,
                "created_at": t(1),
            },
            {
                "id": 9202,
                "key": "novedades_overtime_grace_hours",
                "value": "72",
                "valid_from": t(3),
                "valid_until": None,
                "updated_by_id": ADM,
                "created_at": t(3),
            },
        ],
        "workedday": [_dia(f) for f in _DIAS],
    }


_DIAS = [
    (8101, 5001, 7007, date(2026, 10, 1), Decimal("8.00")),
    (8102, 5001, 7007, date(2026, 10, 2), None),
    (8103, 5002, 7007, date(2026, 10, 1), Decimal("7.50")),
    (8104, 5001, 7008, date(2026, 9, 22), Decimal("8.00")),
]


def _dia(fila):
    pk, colaborador, periodo, dia, horas = fila
    return {
        "id": pk,
        "collaborator_id": colaborador,
        "period_id": periodo,
        "supervisor_id": SUP,
        "date": dia,
        "hours": horas,
        "version": 1,
        "updated_by_id": SUP,
        "created_at": t(2, 8),
        "updated_at": t(2, 9),
    }


def _evento(pk, action, target_type, target_id, **extra):
    return {
        "id": pk,
        "action": action,
        "actor_id": ADM,
        "actor_role": "ADMINISTRADOR",
        "supervisor_id": SUP,
        "period_id": 7007,
        "target_type": target_type,
        "target_id": target_id,
        "target_label": "",
        "field": "",
        "old_value": "",
        "new_value": "",
        "reason": "",
        "source_file": "",
        "created_at": t(8, 12),
        **extra,
    }


class LectorEnMemoria:
    """Mismos métodos que `LectorNexoSQL`; `totales` se calcula como en SQL."""

    def __init__(self, datos=None, usuarios=None, roles=None):
        self.datos = datos if datos is not None else datos_nexo()
        self._usuarios = usuarios if usuarios is not None else USUARIOS_NEXO
        self._roles = roles if roles is not None else ROLES_NEXO
        self.ajuste_de_totales = None
        self.ajuste_de_conteos = {}

    def filas(self, tabla):
        assert tabla in TABLAS
        return copy.deepcopy(sorted(self.datos.get(tabla, []), key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in self._usuarios if u["id"] in ids]

    def roles_operativos(self):
        return [dict(r) for r in self._roles]

    def conteos(self):
        return {t: len(self.datos.get(t, [])) + self.ajuste_de_conteos.get(t, 0) for t in TABLAS}

    def totales(self):
        periodos = {p["id"]: (p["year"], p["month"]) for p in self.datos["operationalperiod"]}
        dias, extras, depuradas = defaultdict(dict), defaultdict(dict), defaultdict(dict)
        for w in self.datos["workedday"]:
            if w["hours"] is not None:
                c = dias[periodos[w["period_id"]]]
                c["registros"] = c.get("registros", 0) + 1
                c["horas"] = c.get("horas", Decimal(0)) + w["hours"]
        for o in self.datos["overtimerecord"]:
            if o["deleted_at"] is None:
                _sumar(extras[periodos[o["period_id"]]], o)
        meses = {d["id"]: (d["year"], d["month"]) for d in self.datos["overtimedepuration"]}
        for r in self.datos["depuratedovertime"]:
            if not r["excluded"]:
                _sumar(depuradas[meses[r["depuration_id"]]], r)
        totales = {"dias": dict(dias), "extras": dict(extras), "depuradas": dict(depuradas)}
        if self.ajuste_de_totales:
            self.ajuste_de_totales(totales)
        return totales


def _sumar(c, fila):
    c["registros"] = c.get("registros", 0) + 1
    c["horas_extra"] = c.get("horas_extra", Decimal(0)) + fila["overtime_hours"]
    c["horas_sabado"] = c.get("horas_sabado", Decimal(0)) + fila["saturday_hours"]


# ── Escenario de la intranet ─────────────────────────────────────────────────


@pytest.fixture
def intranet(db):
    """Las cuentas de la intranet (correos con otra capitalización que en
    Nexo) y los empleados de la empresa. El supervisor tiene membresía; el
    asistente no."""
    empresa = empresa_actual()
    sup = User.objects.create_user("sup", email="sup.uno@laar.com", password="x-Clave-123")
    adm = User.objects.create_user("adm", email="Admin.Nexo@laar.com", password="x-Clave-123")
    asis = User.objects.create_user("asis", email="asistente@laar.com", password="x-Clave-123")
    MembresiaEmpresa.objects.create(usuario=sup, empresa=empresa, es_predeterminada=True)
    area, _ = Departamento.objects.get_or_create(nombre="Operaciones", codigo="OPS")
    jose = Empleado.objects.create(
        nombres="José", apellidos="Pérez Núñez", codigo_empleado="OPS-0001", departamento=area
    )
    for codigo in ("OPS-0002", "OPS-0003"):
        Empleado.objects.create(
            nombres="Maria", apellidos="Lopez", codigo_empleado=codigo, departamento=area
        )
    return {"empresa": empresa, "sup": sup, "adm": adm, "asis": asis, "jose": jose}


def importar(lector=None, *args):
    from io import StringIO

    salida = StringIO()
    call_command(
        "importar_nexo",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def nada_importado():
    empresa = empresa_actual()
    return all(
        not m.objects.todas().filter(**{m.objects.ruta_de_empresa: empresa}).exists()
        for m in MODELOS.values()
    )


# ── Simulacro y aplicación ───────────────────────────────────────────────────


def test_el_simulacro_no_deja_nada_pero_informa(intranet):
    salida = importar(None, "--asignar-roles")

    assert "Simulacro" in salida
    assert "workedday" in salida and "4 →        4" in salida
    assert nada_importado()
    membresia = MembresiaEmpresa.objects.get(usuario=intranet["sup"], empresa=intranet["empresa"])
    assert not membresia.roles.exists()


def test_aplicar_crea_todo(intranet):
    lector = LectorEnMemoria()
    salida = importar(lector, "--aplicar")

    assert "Importación confirmada" in salida
    empresa = intranet["empresa"]
    for tabla, modelo in MODELOS.items():
        creados = modelo.objects.todas().filter(**{modelo.objects.ruta_de_empresa: empresa})
        assert creados.count() == len(lector.datos[tabla]), tabla
    assert OvertimeRecord.objects.filter(deleted_at__isnull=False).count() == 3
    assert PermissionOverride.objects.filter(revoked_at__isnull=False).count() == 1
    jose = Collaborator.objects.get(cedula=CEDULA_JOSE)
    assert jose.empresa == empresa
    assert (jose.current_supervisor, jose.created_by) == (intranet["sup"], intranet["adm"])
    assert WorkedDay.objects.get(collaborator=jose, date=date(2026, 10, 2)).hours is None
    assert SettingHistory.objects.get(valid_until__isnull=True).value == "72"


def test_un_usuario_necesario_que_falta_aborta_sin_escribir(intranet):
    intranet["adm"].delete()

    with pytest.raises(CommandError) as error:
        importar(None, "--aplicar")

    mensaje = str(error.value)
    assert "admin.nexo@laar.com" in mensaje
    # El usuario de Nexo que no referencia ningún registro no hace falta.
    assert "ajeno@laar.com" not in mensaje
    assert nada_importado()


def test_un_destino_con_datos_aborta(intranet):
    OperationalPeriod.objects.create(
        year=2026, month=11, start_date=date(2026, 10, 23), end_date=date(2026, 11, 22)
    )

    with pytest.raises(CommandError, match="ya tiene datos de Novedades"):
        importar(None, "--aplicar")
    assert not Collaborator.objects.exists()


# ── Enlace con el Empleado ───────────────────────────────────────────────────


def test_enlace_por_nombre_unico_ambiguo_y_sin_coincidencia(intranet):
    salida = importar(None, "--aplicar")

    jose = Collaborator.objects.get(cedula=CEDULA_JOSE)
    assert (jose.empleado, jose.codigo_empleado) == (intranet["jose"], "OPS-0001")
    maria = Collaborator.objects.get(cedula="1712345678")
    assert (maria.empleado, maria.codigo_empleado) == (None, "")
    ana = Collaborator.objects.get(cedula="0923456789")
    assert ana.empleado is None
    assert "2 empleados con ese nombre" in salida
    assert "sin coincidencia de nombre" in salida
    # El informe muestra la cédula enmascarada, nunca completa.
    assert "••••••0405" in salida and CEDULA_JOSE not in salida


def test_normalizar_nombre_ignora_tildes_orden_y_espacios():
    assert normalizar_nombre("  Pérez   Ñúñez José ") == normalizar_nombre("JOSE NUNEZ PEREZ")
    assert normalizar_nombre("Ana-María") == normalizar_nombre("maria ana")
    assert normalizar_nombre("José Pérez") != normalizar_nombre("José Pérez Pérez")


# ── Remapeo, fechas y cédulas ────────────────────────────────────────────────


def test_remapea_los_ids_incluidas_las_referencias_sueltas(intranet):
    importar(None, "--aplicar")

    jose = Collaborator.objects.get(cedula=CEDULA_JOSE)
    septiembre = WorkedDay.objects.get(collaborator=jose, date=date(2026, 9, 22))
    activo = OvertimeRecord.objects.get(collaborator=jose, deleted_at__isnull=True)

    worked = ClosedPeriodCorrection.objects.get(target="WORKED_DAY")
    assert worked.target_id == septiembre.pk
    assert worked.period == OperationalPeriod.objects.get(month=9)
    assert ClosedPeriodCorrection.objects.get(target="OVERTIME").target_id == activo.pk

    fila = DepuratedOvertime.objects.get()
    assert (fila.source_id, fila.source_record_id) == (activo.pk, activo.pk)
    assert fila.changes.get().field == "overtime_hours"

    salida = CollaboratorExitNotification.objects.get()
    assert salida.status_change == CollaboratorStatusChange.objects.get()
    assert salida.collaborator.cedula == "0923456789"

    eventos = {e.action: e for e in NovedadEvent.objects.all()}
    assert eventos["collaborator.created"].target_id == str(jose.pk)
    assert eventos["overtime.updated"].target_id == str(activo.pk)
    assert eventos["correction.worked_day"].target_id == str(septiembre.pk)
    assert eventos["permission.override_created"].target_id == str(intranet["sup"].pk)
    # Claves de texto quedan tal cual.
    assert eventos["config.changed"].target_id == "novedades_overtime_grace_hours"
    assert eventos["overtime.bulk_saved"].target_id == "2026-10"
    # Los borrados con la misma clave natural se crearon todos.
    assert OvertimeRecord.objects.filter(collaborator__cedula="1712345678").count() == 3


def test_conserva_las_fechas_originales(intranet):
    importar(None, "--aplicar")

    jose = Collaborator.objects.get(cedula=CEDULA_JOSE)
    assert (jose.created_at, jose.updated_at) == (t(1, 8), t(2, 9))
    dia = WorkedDay.objects.get(collaborator=jose, date=date(2026, 10, 1))
    assert (dia.created_at, dia.updated_at) == (t(2, 8), t(2, 9))
    assert CollaboratorAssignment.objects.get().started_at == t(1, 8)
    assert CollaboratorStatusChange.objects.get().created_at == t(5, 10)
    assert SupervisorPeriod.objects.get().opened_at == t(1, 7)
    assert DepuratedOvertime.objects.get().updated_at == t(7, 9)
    assert NovedadEvent.objects.filter(created_at=t(8, 12)).count() == 7
    assert ClosedPeriodCorrection.objects.get(target="OVERTIME").created_at == t(5, 11)
    # Y los campos automáticos vuelven a serlo después.
    assert Collaborator._meta.get_field("created_at").auto_now_add
    assert DepuratedOvertime._meta.get_field("updated_at").auto_now


def test_la_cedula_queda_enmascarada_en_el_historial(intranet):
    importar(None, "--aplicar")

    creado = NovedadEvent.objects.get(action="collaborator.created")
    assert creado.target_label == "PÉREZ ÑÚÑEZ JOSÉ (••••••0405)"
    cambio = NovedadEvent.objects.get(action="collaborator.cedula_changed")
    assert (cambio.old_value, cambio.new_value) == ("••••••1111", "••••••0405")
    motivo = NovedadEvent.objects.get(action="overtime.updated").reason
    # La cédula sí; un número que solo la contiene, no.
    assert motivo == "Horas de ••••••0405 corregidas; guía 01020304051"
    correccion = ClosedPeriodCorrection.objects.get(target="WORKED_DAY")
    assert correccion.original_values["label"] == "PÉREZ ÑÚÑEZ JOSÉ (••••••0405)"
    # El dato en sí se conserva completo donde la intranet lo guarda.
    assert Collaborator.objects.filter(cedula=CEDULA_JOSE).exists()
    assert DepuratedOvertime.objects.get().cedula == CEDULA_JOSE


def test_enmascarador_en_json_anidado():
    mascara = Enmascarador(["1712345678"])
    assert mascara.json({"a": ["x 1712345678 y", 3], "b": None}) == {
        "a": ["x ••••••5678 y", 3],
        "b": None,
    }


# ── Verificación ─────────────────────────────────────────────────────────────


def test_si_las_sumas_no_cuadran_se_deshace_todo(intranet):
    lector = LectorEnMemoria()

    def otra_suma(totales):
        totales["extras"][(2026, 10)]["horas_extra"] += Decimal("0.50")

    lector.ajuste_de_totales = otra_suma

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_si_un_conteo_no_cuadra_se_deshace_todo(intranet):
    lector = LectorEnMemoria()
    lector.ajuste_de_conteos = {"workedday": 1}  # Nexo cambió mientras se leía

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_la_verificacion_cuadra_con_los_datos_completos(intranet):
    salida = importar(None, "--aplicar")

    assert "NO CUADRA" not in salida
    assert "Días laborados 10/2026" not in salida  # solo se listan las fallidas
    assert "comprobaciones cuadran" in salida


# ── Roles ────────────────────────────────────────────────────────────────────


def test_roles_en_la_membresia_de_la_empresa(intranet):
    salida = importar(None, "--aplicar", "--asignar-roles")

    membresia = MembresiaEmpresa.objects.get(usuario=intranet["sup"], empresa=intranet["empresa"])
    assert list(membresia.roles.values_list("name", flat=True)) == ["SUPERVISOR_OPERACIONES"]
    # Ni roles globales ni membresías nuevas.
    assert not intranet["sup"].groups.exists()
    assert not MembresiaEmpresa.objects.filter(usuario=intranet["asis"]).exists()
    assert "asistente@laar.com  ASISTENTE_OPERACIONES: sin membresía en la empresa" in salida
    assert "ajeno@laar.com  JEFE_OPERACIONES: sin cuenta en la intranet" in salida
    assert Group.objects.filter(name="SUPERVISOR_OPERACIONES").exists()


def test_sin_asignar_roles_no_se_tocan(intranet):
    importar(None, "--aplicar")

    membresia = MembresiaEmpresa.objects.get(usuario=intranet["sup"], empresa=intranet["empresa"])
    assert not membresia.roles.exists()


# ── Informe CSV ──────────────────────────────────────────────────────────────


def test_el_informe_csv_va_fuera_del_repositorio(intranet, tmp_path):
    dentro = settings.BASE_DIR / "informe_nexo.csv"
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar(None, "--informe", str(dentro))
    assert not dentro.exists()

    ruta = tmp_path / "informe.csv"
    importar(None, "--informe", str(ruta))
    texto = ruta.read_text(encoding="utf-8-sig")
    assert "sin_empleado" in texto and "enlazado_por_nombre" in texto
    assert "••••••0405" in texto and CEDULA_JOSE not in texto


def test_el_informe_csv_lista_los_usuarios_faltantes(intranet, tmp_path):
    intranet["adm"].delete()
    ruta = tmp_path / "informe.csv"

    with pytest.raises(CommandError):
        importar(None, "--informe", str(ruta))
    assert "usuario_faltante,admin.nexo@laar.com" in ruta.read_text(encoding="utf-8-sig")


# ── Conexión de solo lectura ─────────────────────────────────────────────────


def test_sin_configuracion_de_nexo_el_lector_avisa():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoSQL(alias="nexo_que_no_existe")


def test_el_router_no_migra_ni_escribe_en_nexo():
    router = NexoSoloLecturaRouter()
    assert router.allow_migrate("nexo", "novedades") is False
    assert router.allow_migrate("default", "novedades") is None
    assert router.db_for_write(Collaborator) is None
    instancia = Collaborator()
    instancia._state.db = "nexo"
    with pytest.raises(EscrituraEnNexo):
        router.db_for_write(Collaborator, instance=instancia)


def test_la_conexion_de_nexo_solo_acepta_select():
    def ejecutar(sql, params, many, context):
        return "ok"

    assert solo_select(ejecutar, "SELECT [id] FROM [t] WHERE [id] IN (%s)", [1], False, {}) == "ok"
    for sql in (
        "UPDATE [t] SET [a] = 1",
        "DELETE FROM [t]",
        "SELECT 1; DROP TABLE [t]",
        "  insert into t values (1)",
    ):
        assert not es_select(sql)
        with pytest.raises(EscrituraEnNexo):
            solo_select(ejecutar, sql, [], False, {})


def test_convertir_da_tipos_de_python():
    fila = convertir(
        TABLAS["supervisorperiod"],
        {
            "opened_at": datetime(2026, 10, 1, 13, 0),
            "closed_at": None,
            "summary": '{"dias": 1}',
        },
    )
    assert fila["opened_at"] == t(1)
    assert fila["closed_at"] is None
    assert fila["summary"] == {"dias": 1}
    assert convertir(TABLAS["workedday"], {"date": "2026-10-01"})["date"] == date(2026, 10, 1)
