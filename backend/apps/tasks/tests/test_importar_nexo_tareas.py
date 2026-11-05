"""`manage.py importar_nexo_tareas`: migración de Tareas desde Nexo.

Sin base de Nexo: el comando recibe un lector en memoria (`LectorEnMemoria`)
con los mismos métodos que `LectorNexoTareasSQL`. Los ids de Nexo son altos a
propósito, para que un id copiado sin remapear se note.
"""

import copy
import json
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from io import StringIO

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command

from apps.empresas.contexto import empresa_actual
from apps.novedades.models import SettingHistory
from apps.novedades.nexo.comun import normal
from apps.tasks.models import (
    ActivityAuditLog,
    ActivityComment,
    ActivityReason,
    Comment,
    EndDateAuditLog,
    MonthClosure,
    TargetTimeAuditLog,
    Task,
    TaskActivity,
    TaskCommentView,
)
from apps.tasks.nexo.importador import CLAVES_DESTINO, MODELOS, renombrar_rol
from apps.tasks.nexo.lector import TABLAS, ErrorDeNexo, LectorNexoTareasSQL, convertir
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User


def t(mes, dia, hora=13, minuto=0):
    return datetime(2026, mes, dia, hora, minuto, tzinfo=UTC)


# Usuarios de Nexo: 9011 administrador, 9020 jefa, 9021 analista; 9099 solo
# aparece dentro del JSON de correcciones de un cierre (opcional).
ADM, JEFA, ANA, AJENO = 9011, 9020, 9021, 9099
USUARIOS_NEXO = [
    {"id": ADM, "username": "admin", "email": "Admin.Nexo@LAAR.com"},
    {"id": JEFA, "username": "jefa", "email": "jefa.nacional@laar.com"},
    {"id": ANA, "username": "ana", "email": "ana.nunez@laar.com"},
    {"id": AJENO, "username": "ajeno", "email": "ajeno@laar.com"},
]

CLAVE_SEMBRADA = "seguimiento_de_documentacion"

REGLAS = {
    "comment_targets": {"ANALISTA_CC": ["JEFE_NACIONAL"]},
    "first_comment_role": "ADMINISTRADOR",
    "retroactive_notify_roles": ["COORDINADOR_NACIONAL", "ADMINISTRADOR"],
}


def _tarea(pk, **extra):
    return {
        "id": pk,
        "created_at": t(9, 1, 8),
        "updated_at": t(9, 2, 9),
        "title": "Revisión de contratos — Año 2026",
        "description": "Ñandú: verificar firmas",
        "status": "PENDIENTE",
        "priority": "MEDIA",
        "frequency": "MENSUAL",
        "type": "FIJA",
        "start_date": t(9, 1, 5),
        "end_date": t(9, 30, 5),
        "estimated_hours": 4.0,
        "real_hours": 0.0,
        "target_time_validated": None,
        "target_time_validated_at": None,
        "target_time_validated_by_id": None,
        "end_date_approval_status": "PENDIENTE",
        "end_date_approved_at": None,
        "end_date_approved_by_id": None,
        "progress": 0,
        "completed_at": None,
        "color": "",
        "archived_month": None,
        "archived_at": None,
        "successor_created_at": None,
        "corrected": False,
        "assigned_to_id": ANA,
        "created_by_id": JEFA,
        **extra,
    }


def _actividad(pk, tarea, **extra):
    return {
        "id": pk,
        "created_at": t(9, 15, 14),
        "updated_at": t(9, 15, 14),
        "task_id": tarea,
        "author_id": ANA,
        "reason": CLAVE_SEMBRADA,
        "start_time": "08:00",
        "end_time": "09:30",
        "duration": 90,
        "description": "Revisión de expedientes",
        "is_retroactive": False,
        "activity_date": None,
        "admin_comment": None,
        "modified_by_admin": False,
        "modified_at": None,
        **extra,
    }


def datos_nexo() -> dict[str, list[dict]]:
    return {
        "activityreason": [
            {
                "id": 401,
                "created_at": t(8, 1),
                "updated_at": t(8, 1),
                "key": CLAVE_SEMBRADA,
                "label": "Seguimiento de documentación (Nexo)",
                "description": "",
                "is_active": True,
                "is_archived": False,
                "archived_at": None,
                "assigned_roles": ["ADMINISTRADOR", "JEFE_NACIONAL"],
            },
            {
                "id": 402,
                "created_at": t(8, 2),
                "updated_at": t(8, 3),
                "key": "elaboracion_de_vacaciones",
                "label": "Elaboración de vacaciones",
                "description": "Cálculo y trámite",
                "is_active": True,
                "is_archived": False,
                "archived_at": None,
                "assigned_roles": ["ASISTENTE_GH", "ADMINISTRADOR"],
            },
            {
                "id": 403,
                "created_at": t(8, 4),
                "updated_at": t(8, 20),
                "key": "visita_domiciliaria",
                "label": "Visita Domiciliaria",
                "description": "",
                "is_active": False,
                "is_archived": True,
                "archived_at": t(8, 20),
                "assigned_roles": ["TRABAJO_SOCIAL"],
            },
        ],
        "task": [
            _tarea(
                1001,
                title="Nómina de septiembre",
                status="COMPLETADA",
                progress=100,
                estimated_hours=10.5,
                real_hours=8.25,
                end_date_approval_status="APROBADA",
                end_date_approved_at=t(9, 3),
                end_date_approved_by_id=ADM,
                target_time_validated=9.0,
                target_time_validated_at=t(9, 3, 10),
                target_time_validated_by_id=JEFA,
                completed_at=t(9, 29),
                archived_month="2026-09",
                archived_at=t(10, 1, 6),
                successor_created_at=t(10, 1, 6),
            ),
            # Dos tareas con la misma clave natural: se insertan una a una.
            _tarea(1002, estimated_hours=2.5, real_hours=1.0),
            _tarea(1003, estimated_hours=3.0),
            _tarea(
                1004,
                title="Plan de capacitación",
                assigned_to_id=JEFA,
                created_by_id=ADM,
                created_at=t(10, 2, 8),
                updated_at=t(10, 3, 8),
                estimated_hours=1.75,
                real_hours=0.75,
                archived_month="",
            ),
        ],
        "comment": [
            {
                "id": 3001,
                "created_at": t(9, 10),
                "updated_at": t(9, 11),
                "task_id": 1001,
                "author_id": JEFA,
                "text": "¿Ya están las firmas de Peñaherrera?",
            }
        ],
        "taskcommentview": [
            {
                "id": 3101,
                "created_at": t(9, 10, 15),
                "updated_at": t(9, 12, 16, 45),
                "task_id": 1001,
                "user_id": ANA,
            }
        ],
        "taskactivity": [
            _actividad(2001, 1001),
            # Retroactivo: cuenta en el mes de su fecha de actividad (UTC).
            _actividad(
                2002,
                1001,
                created_at=t(10, 1, 9),
                updated_at=t(10, 1, 9),
                is_retroactive=True,
                activity_date=t(9, 30, 23, 30),
                duration=30,
            ),
            # Motivo que ya no está en el catálogo: se conserva, con aviso.
            _actividad(
                2003,
                1004,
                created_at=t(10, 2, 10),
                updated_at=t(10, 2, 10),
                author_id=JEFA,
                reason="motivo_retirado",
                duration=45,
            ),
            _actividad(
                2004,
                1002,
                created_at=t(9, 16, 10),
                updated_at=t(9, 18, 10),
                duration=60,
                admin_comment="Ajustado por el administrador",
                modified_by_admin=True,
                modified_at=t(9, 18, 10),
            ),
        ],
        "activitycomment": [
            {
                "id": 2101,
                "created_at": t(9, 18, 11),
                "updated_at": t(9, 18, 11),
                "activity_id": 2004,
                "author_id": ADM,
                "text": "Se corrige la duración",
            }
        ],
        "activityauditlog": [
            {
                "id": 4001,
                "activity_id": 2004,
                "admin_id": ADM,
                "old_duration": 120,
                "new_duration": 60,
                "comment": "Duración excesiva",
                "modified_at": t(9, 18, 10),
            },
            # La actividad se borró en Nexo: el log sobrevive, con id 0.
            {
                "id": 4002,
                "activity_id": 99999,
                "admin_id": ADM,
                "old_duration": 30,
                "new_duration": 15,
                "comment": "Actividad luego eliminada",
                "modified_at": t(9, 5, 10),
            },
        ],
        "targettimeauditlog": [
            {
                "id": 4101,
                "created_at": t(9, 3, 10),
                "updated_at": t(9, 3, 10),
                "task_id": 1001,
                "user_id": ADM,
                "user_role": "ADMINISTRADOR",
                "previous_value": None,
                "new_value": 9.0,
                "reason": "REVISION_LIDER",
                "reason_detail": None,
                "ip_address": "10.0.2.15",
            }
        ],
        "enddateauditlog": [
            {
                "id": 4201,
                "created_at": t(9, 2, 10),
                "updated_at": t(9, 2, 10),
                "task_id": 88888,
                "user_id": JEFA,
                "user_role": "JEFE_NACIONAL",
                "action": "PROPUESTA",
                "previous_value": t(9, 20),
                "new_value": t(9, 30),
                "observaciones": "Tarea luego eliminada",
                "ip_address": None,
            }
        ],
        "monthclosure": [
            {
                "id": 5001,
                "month": 9,
                "year": 2026,
                "closed_by_id": ADM,
                "closed_at": t(10, 1, 6),
                "cutoff_date": t(9, 30, 23, 59),
                "closure_type": "NORMAL",
                "calendar_days_total": 30,
                "calendar_days_considered": 30,
                "working_days_considered": 21,
                "working_hours_considered": 136.5,
                "total_tasks": 3,
                "completed_tasks": 1,
                "summary": {"total": 3, "completed": 1, "pending": 2},
                "corrections": [
                    {
                        "taskId": 1001,
                        "field": "realHours",
                        "oldValue": 8.0,
                        "newValue": 8.25,
                        "correctedBy": ADM,
                        "correctedAt": "2026-10-01T07:00:00+00:00",
                    },
                    {
                        "taskId": 77777,
                        "field": "status",
                        "oldValue": "PENDIENTE",
                        "newValue": "COMPLETADA",
                        "correctedBy": AJENO,
                        "correctedAt": "2026-10-01T07:05:00+00:00",
                    },
                ],
            }
        ],
        "systemconfighistory": [
            {
                "id": 6001,
                "key": "HORAS_EFECTIVAS_DIA",
                "value": "6.5",
                "valid_from": t(8, 1),
                "valid_until": t(9, 1),
                "updated_by_id": ADM,
                "created_at": t(8, 1),
            },
            {
                "id": 6002,
                "key": "HORAS_EFECTIVAS_DIA",
                "value": "7",
                "valid_from": t(9, 1),
                "valid_until": None,
                "updated_by_id": ADM,
                "created_at": t(9, 1),
            },
            {
                "id": 6003,
                "key": "notification_rules",
                "value": json.dumps(REGLAS),
                "valid_from": t(8, 15),
                "valid_until": None,
                "updated_by_id": ADM,
                "created_at": t(8, 15),
            },
        ],
    }


class LectorEnMemoria:
    """Mismos métodos que `LectorNexoTareasSQL`; `totales` como en SQL."""

    def __init__(self, datos=None, usuarios=None):
        self.datos = datos if datos is not None else datos_nexo()
        self._usuarios = usuarios if usuarios is not None else USUARIOS_NEXO
        self.ajuste_de_totales = None
        self.ajuste_de_conteos = {}

    def filas(self, tabla):
        assert tabla in TABLAS
        return copy.deepcopy(sorted(self.datos.get(tabla, []), key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in self._usuarios if u["id"] in ids]

    def conteos(self):
        return {t: len(self.datos.get(t, [])) + self.ajuste_de_conteos.get(t, 0) for t in TABLAS}

    def totales(self):
        tareas = defaultdict(
            lambda: {"registros": 0, "horas_estimadas": Decimal(0), "horas_reales": Decimal(0)}
        )
        for tarea in self.datos["task"]:
            c = tareas[tarea["archived_month"] or ""]
            c["registros"] += 1
            c["horas_estimadas"] += Decimal(str(tarea["estimated_hours"]))
            c["horas_reales"] += Decimal(str(tarea["real_hours"]))
        actividades = defaultdict(lambda: {"registros": 0, "minutos": 0})
        for a in self.datos["taskactivity"]:
            momento = a["activity_date"] or a["created_at"]
            c = actividades[(momento.year, momento.month)]
            c["registros"] += 1
            c["minutos"] += a["duration"]
        totales = {"tareas": dict(tareas), "actividades": dict(actividades)}
        if self.ajuste_de_totales:
            self.ajuste_de_totales(totales)
        return totales


# ── Escenario de la intranet ─────────────────────────────────────────────────


@pytest.fixture
def intranet(db):
    """Las cuentas (correos con otra capitalización que en Nexo) y un motivo
    ya sembrado en la empresa con la misma clave que uno de Nexo."""
    empresa = empresa_actual()
    adm = User.objects.create_user("adm", email="admin.nexo@laar.com", password="x-Clave-123")
    jefa = User.objects.create_user("jefa", email="Jefa.Nacional@laar.com", password="x-Clave-123")
    ana = User.objects.create_user("ana", email="ana.nunez@laar.com", password="x-Clave-123")
    sembrado = ActivityReason.objects.create(
        empresa=empresa,
        key=CLAVE_SEMBRADA,
        label="Seguimiento de documentación",
        assigned_roles=[ADMIN_GH, "JEFE_NACIONAL", "ASISTENTE_GH"],
    )
    return {"empresa": empresa, "adm": adm, "jefa": jefa, "ana": ana, "sembrado": sembrado}


def importar(lector=None, *args):
    salida = StringIO()
    call_command(
        "importar_nexo_tareas",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def nada_importado():
    empresa = empresa_actual()
    for tabla, modelo in MODELOS.items():
        qs = modelo.objects.todas().filter(**{modelo.objects.ruta_de_empresa: empresa})
        if tabla == "activityreason":
            if list(qs.values_list("key", flat=True)) != [CLAVE_SEMBRADA]:
                return False
        elif tabla == "systemconfighistory":
            if qs.filter(key__in=CLAVES_DESTINO).exists():
                return False
        elif qs.exists():
            return False
    return True


# ── Simulacro y aplicación ───────────────────────────────────────────────────


def test_el_simulacro_no_deja_nada_pero_informa(intranet):
    salida = importar()

    assert "Simulacro" in salida
    assert "taskactivity" in salida and "4 →        4" in salida
    assert "comprobaciones cuadran" in salida and "NO CUADRA" not in salida
    assert nada_importado()


def test_aplicar_crea_todo(intranet):
    lector = LectorEnMemoria()
    salida = importar(lector, "--aplicar")

    assert "Importación confirmada" in salida
    empresa = intranet["empresa"]
    for tabla in ("task", "comment", "taskcommentview", "taskactivity", "activitycomment"):
        modelo = MODELOS[tabla]
        creados = modelo.objects.todas().filter(**{modelo.objects.ruta_de_empresa: empresa})
        assert creados.count() == len(lector.datos[tabla]), tabla
    for modelo in (ActivityAuditLog, TargetTimeAuditLog, EndDateAuditLog, MonthClosure):
        assert set(modelo.objects.values_list("empresa", flat=True)) == {empresa.pk}
    assert ActivityAuditLog.objects.count() == 2
    assert ActivityReason.objects.count() == 3  # 1 sembrado + 2 nuevos
    # Dos registros de horas efectivas y la regla de avisos partida en dos.
    assert SettingHistory.objects.filter(key__in=CLAVES_DESTINO).count() == 4
    tarea = Task.objects.get(title="Nómina de septiembre")
    assert (tarea.assigned_to, tarea.created_by) == (intranet["ana"], intranet["jefa"])
    assert (tarea.end_date_approved_by, tarea.target_time_validated_by) == (
        intranet["adm"],
        intranet["jefa"],
    )
    assert tarea.empresa == empresa
    assert (tarea.estimated_hours, tarea.real_hours, tarea.archived_month) == (
        10.5,
        8.25,
        "2026-09",
    )
    vigente = SettingHistory.objects.get(key="HORAS_EFECTIVAS_DIA", valid_until__isnull=True)
    assert vigente.value == "7"


def test_un_usuario_necesario_que_falta_aborta_sin_escribir(intranet):
    intranet["ana"].delete()

    with pytest.raises(CommandError) as error:
        importar(None, "--aplicar")

    mensaje = str(error.value)
    assert "ana.nunez@laar.com" in mensaje
    # El que solo aparece en el JSON de correcciones no hace falta.
    assert "ajeno@laar.com" not in mensaje
    assert nada_importado()
    # No crea cuentas.
    assert not User.objects.filter(email__iexact="ana.nunez@laar.com").exists()


def test_un_destino_con_tareas_aborta(intranet):
    Task.objects.create(
        title="Tarea de la intranet",
        priority="ALTA",
        frequency="PUNTUAL",
        start_date=t(11, 1),
        end_date=t(11, 2),
        estimated_hours=1,
        assigned_to=intranet["ana"],
        created_by=intranet["jefa"],
    )

    with pytest.raises(CommandError, match="ya tiene datos de Tareas"):
        importar(None, "--aplicar")
    assert Task.objects.count() == 1


def test_un_ajuste_de_tareas_ya_guardado_aborta(intranet):
    SettingHistory.objects.create(
        key="retroactive_window_business_days",
        value="3",
        valid_from=t(11, 1),
        updated_by=intranet["adm"],
    )

    with pytest.raises(CommandError) as error:
        importar(None, "--aplicar")
    assert "retroactive_window_business_days" in str(error.value)
    assert not Task.objects.exists()


def test_los_ajustes_de_novedades_no_cuentan_como_datos(intranet):
    """Novedades ya está importado en producción: sus ajustes comparten tabla."""
    SettingHistory.objects.create(
        key="novedades_overtime_grace_hours",
        value="72",
        valid_from=t(10, 1),
        updated_by=intranet["adm"],
    )

    assert "Importación confirmada" in importar(None, "--aplicar")
    assert SettingHistory.objects.get(key="novedades_overtime_grace_hours").value == "72"


# ── Motivos ya sembrados ─────────────────────────────────────────────────────


def test_los_motivos_sembrados_se_cruzan_por_clave_y_no_se_duplican(intranet):
    salida = importar(None, "--aplicar")

    sembrado = ActivityReason.objects.get(key=CLAVE_SEMBRADA)
    assert sembrado.pk == intranet["sembrado"].pk
    # Se conserva como está en la intranet.
    assert sembrado.label == "Seguimiento de documentación"
    assert sembrado.assigned_roles == [ADMIN_GH, "JEFE_NACIONAL", "ASISTENTE_GH"]
    assert "Motivos que ya existían en la empresa (cruzados por clave): 1" in salida
    assert "difiere de Nexo en: etiqueta, roles" in salida
    # Las actividades siguen apuntando a la clave.
    assert TaskActivity.objects.filter(reason=CLAVE_SEMBRADA).count() == 3
    # Los nuevos conservan sus datos.
    archivado = ActivityReason.objects.get(key="visita_domiciliaria")
    assert (archivado.is_active, archivado.is_archived, archivado.archived_at) == (
        False,
        True,
        t(8, 20),
    )
    assert "«motivo_retirado», que no está en el catálogo" in salida


def test_sin_motivos_sembrados_se_crean_todos(intranet):
    intranet["sembrado"].delete()

    importar(None, "--aplicar")
    assert ActivityReason.objects.count() == 3
    motivo = ActivityReason.objects.get(key=CLAVE_SEMBRADA)
    assert motivo.label == "Seguimiento de documentación (Nexo)"
    assert motivo.assigned_roles == [ADMIN_GH, "JEFE_NACIONAL"]


# ── Remapeo y fechas ─────────────────────────────────────────────────────────


def test_remapea_los_ids_incluidas_las_referencias_sueltas(intranet):
    salida = importar(None, "--aplicar")

    nomina = Task.objects.get(title="Nómina de septiembre")
    gemelas = Task.objects.filter(title="Revisión de contratos — Año 2026").order_by(
        "estimated_hours"
    )
    assert gemelas.count() == 2  # misma clave natural: ambas creadas
    con_ajuste = TaskActivity.objects.get(modified_by_admin=True)
    assert con_ajuste.task == gemelas[0]  # la de 2.5 horas (1002 en Nexo)

    assert Comment.objects.get().task == nomina
    assert TaskCommentView.objects.get().task == nomina
    assert TaskCommentView.objects.get().user == intranet["ana"]
    assert ActivityComment.objects.get().activity == con_ajuste
    assert set(nomina.activities.values_list("duration", flat=True)) == {90, 30}

    logs = {log.comment: log.activity_id for log in ActivityAuditLog.objects.all()}
    assert logs["Duración excesiva"] == con_ajuste.pk
    assert logs["Actividad luego eliminada"] == 0
    assert TargetTimeAuditLog.objects.get().task_id == nomina.pk
    assert EndDateAuditLog.objects.get().task_id == 0
    assert "taskactivity #99999 ya no existe en Nexo; queda con id 0" in salida

    cierre = MonthClosure.objects.get()
    correccion, huerfana = cierre.corrections
    assert (correccion["taskId"], correccion["correctedBy"]) == (nomina.pk, intranet["adm"].pk)
    assert (huerfana["taskId"], huerfana["correctedBy"]) == ("nexo:77777", "nexo:9099")
    assert cierre.closed_by == intranet["adm"]
    assert cierre.summary == {"total": 3, "completed": 1, "pending": 2}


def test_conserva_las_fechas_originales(intranet):
    importar(None, "--aplicar")

    nomina = Task.objects.get(title="Nómina de septiembre")
    assert (nomina.created_at, nomina.updated_at) == (t(9, 1, 8), t(9, 2, 9))
    assert (nomina.completed_at, nomina.archived_at, nomina.successor_created_at) == (
        t(9, 29),
        t(10, 1, 6),
        t(10, 1, 6),
    )
    assert nomina.end_date_approved_at == t(9, 3)
    visto = TaskCommentView.objects.get()
    assert visto.updated_at == t(9, 12, 16, 45)  # hace de «visto en»
    retro = TaskActivity.objects.get(is_retroactive=True)
    assert (retro.created_at, retro.activity_date) == (t(10, 1, 9), t(9, 30, 23, 30))
    assert TaskActivity.objects.get(modified_by_admin=True).updated_at == t(9, 18, 10)
    assert Comment.objects.get().updated_at == t(9, 11)
    log = ActivityAuditLog.objects.get(comment="Duración excesiva")
    assert (log.modified_at, log.created_at) == (t(9, 18, 10), t(9, 18, 10))
    cierre = MonthClosure.objects.get()
    assert (cierre.closed_at, cierre.cutoff_date) == (t(10, 1, 6), t(9, 30, 23, 59))
    fin = EndDateAuditLog.objects.get()
    assert (fin.created_at, fin.previous_value, fin.new_value) == (t(9, 2, 10), t(9, 20), t(9, 30))
    ajuste = SettingHistory.objects.get(key="HORAS_EFECTIVAS_DIA", value="6.5")
    assert (ajuste.valid_from, ajuste.valid_until, ajuste.created_at) == (t(8, 1), t(9, 1), t(8, 1))
    # Y los campos automáticos vuelven a serlo después.
    assert Task._meta.get_field("created_at").auto_now_add
    assert MonthClosure._meta.get_field("closed_at").auto_now_add
    assert TaskCommentView._meta.get_field("updated_at").auto_now


# ── Roles ────────────────────────────────────────────────────────────────────


def test_administrador_pasa_a_administrador_de_gestion_humana(intranet):
    salida = importar(None, "--aplicar")

    vacaciones = ActivityReason.objects.get(key="elaboracion_de_vacaciones")
    assert vacaciones.assigned_roles == ["ASISTENTE_GH", ADMIN_GH]
    assert TargetTimeAuditLog.objects.get().user_role == ADMIN_GH
    assert EndDateAuditLog.objects.get().user_role == "JEFE_NACIONAL"

    primero = SettingHistory.objects.get(key="tasks_first_comment_role")
    retro = SettingHistory.objects.get(key="tasks_retroactive_notify_roles")
    assert primero.value == ADMIN_GH
    assert json.loads(retro.value) == ["COORDINADOR_NACIONAL", ADMIN_GH]
    # Misma vigencia que la regla de Nexo.
    assert (primero.valid_from, retro.valid_from) == (t(8, 15), t(8, 15))
    assert primero.valid_until is None and retro.valid_until is None
    assert "comment_targets" in salida and "organigrama" in salida
    # 2 motivos (el sembrado se cruza, pero sus roles de Nexo también se leen),
    # 1 bitácora y 2 en las reglas.
    assert "ADMINISTRADOR → «Administrador de Gestión Humana»: 5 valores" in salida
    assert "ADMINISTRADOR" not in "".join(
        SettingHistory.objects.filter(key__in=CLAVES_DESTINO).values_list("value", flat=True)
    )


def test_la_intranet_lee_los_ajustes_importados(intranet):
    from apps.tasks.configuracion import (
        get_first_comment_role,
        get_retroactive_notify_roles,
    )

    importar(None, "--aplicar")
    assert get_first_comment_role() == ADMIN_GH
    assert get_retroactive_notify_roles() == ["COORDINADOR_NACIONAL", ADMIN_GH]


def test_reglas_de_aviso_que_no_son_json_dan_los_valores_por_defecto(intranet):
    lector = LectorEnMemoria()
    lector.datos["systemconfighistory"][2]["value"] = "no es json"

    salida = importar(lector, "--aplicar")
    assert SettingHistory.objects.get(key="tasks_first_comment_role").value == ""
    retro = SettingHistory.objects.get(key="tasks_retroactive_notify_roles")
    assert json.loads(retro.value) == ["COORDINADOR_NACIONAL"]
    assert "no es un objeto JSON" in salida


def test_renombrar_rol():
    assert renombrar_rol("ADMINISTRADOR") == ADMIN_GH
    assert renombrar_rol("JEFE_NACIONAL") == "JEFE_NACIONAL"
    assert renombrar_rol("") == ""


# ── Verificación ─────────────────────────────────────────────────────────────


def test_si_las_horas_de_las_tareas_no_cuadran_se_deshace_todo(intranet):
    lector = LectorEnMemoria()

    def otra_suma(totales):
        totales["tareas"]["2026-09"]["horas_reales"] += Decimal("0.25")

    lector.ajuste_de_totales = otra_suma

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_si_las_horas_de_un_mes_no_cuadran_se_deshace_todo(intranet):
    lector = LectorEnMemoria()

    def otro_mes(totales):
        totales["actividades"][(2026, 9)]["minutos"] += 15

    lector.ajuste_de_totales = otro_mes

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_si_un_conteo_no_cuadra_se_deshace_todo(intranet):
    lector = LectorEnMemoria()
    lector.ajuste_de_conteos = {"taskactivity": 1}  # Nexo cambió mientras se leía

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_la_verificacion_detalla_lo_que_no_cuadra(intranet):
    lector = LectorEnMemoria()

    def otro_mes(totales):
        totales["actividades"][(2026, 10)]["minutos"] += 1

    lector.ajuste_de_totales = otro_mes
    salida = StringIO()
    with pytest.raises(CommandError):
        call_command(
            "importar_nexo_tareas",
            "--empresa",
            str(empresa_actual().pk),
            lector=lector,
            stdout=salida,
        )
    texto = salida.getvalue()
    assert "NO CUADRA — Horas registradas 10/2026: minutos: Nexo 46 / intranet 45" in texto


def test_el_retroactivo_cuenta_en_el_mes_de_su_actividad(intranet):
    """El lector en memoria lo pone en septiembre; si la intranet lo contara
    por su `created_at` (octubre) la verificación no cuadraría."""
    salida = importar(None, "--aplicar")
    assert "Importación confirmada" in salida


def test_normal_compara_flotantes_a_dos_cifras():
    assert normal(0.1 + 0.2) == Decimal("0.30")
    assert normal(None) == Decimal("0.00")
    assert normal(3) == Decimal("3")


# ── Informe CSV y lector real ────────────────────────────────────────────────


def test_el_informe_csv_va_fuera_del_repositorio(intranet, tmp_path):
    dentro = settings.BASE_DIR / "informe_tareas.csv"
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar(None, "--informe", str(dentro))
    assert not dentro.exists()

    ruta = tmp_path / "informe.csv"
    importar(None, "--informe", str(ruta))
    texto = ruta.read_text(encoding="utf-8-sig")
    assert f"motivo_cruzado,{CLAVE_SEMBRADA}" in texto
    assert "rol_renombrado,activityreason,2" in texto
    assert "verificacion" in texto


def test_el_informe_csv_lista_los_usuarios_faltantes(intranet, tmp_path):
    intranet["adm"].delete()
    ruta = tmp_path / "informe.csv"

    with pytest.raises(CommandError):
        importar(None, "--informe", str(ruta))
    assert "usuario_faltante,admin.nexo@laar.com" in ruta.read_text(encoding="utf-8-sig")


def test_sin_configuracion_de_nexo_el_lector_avisa():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoTareasSQL(alias="nexo_que_no_existe")


def test_convertir_da_tipos_de_python():
    fila = convertir(
        TABLAS["monthclosure"],
        {
            "closed_at": datetime(2026, 10, 1, 6, 0),
            "cutoff_date": "2026-09-30T23:59:00",
            "summary": '{"total": 3}',
            "corrections": None,
        },
    )
    assert fila["closed_at"] == t(10, 1, 6)
    assert fila["cutoff_date"] == t(9, 30, 23, 59)
    assert fila["summary"] == {"total": 3}
    assert fila["corrections"] is None
    razon = convertir(TABLAS["activityreason"], {"assigned_roles": '["ADMINISTRADOR"]'})
    assert razon["assigned_roles"] == ["ADMINISTRADOR"]


def test_el_lector_solo_pide_las_claves_de_tareas():
    ajustes = TABLAS["systemconfighistory"]
    assert ajustes.filtro.count("%s") == len(ajustes.parametros)
    assert set(ajustes.parametros) == {
        "HORAS_EFECTIVAS_DIA",
        "HORAS_ESPERADAS_MES",
        "retroactive_window_business_days",
        "notification_rules",
    }
