"""`manage.py importar_nexo_gh`: Proyectos, Ausencias y KPI desde Nexo.

Sin base de Nexo: el comando recibe un lector en memoria (`LectorEnMemoria`)
con los mismos métodos que `LectorNexoGHSQL`, que además filtra los permisos
médicos vencidos como lo hace la consulta real. Los ids de Nexo son altos a
propósito, para que un id copiado sin remapear se note. Los archivos van a una
carpeta temporal (`MEDIA_ROOT`, fixture de `conftest.py`).
"""

import base64
import copy
import hashlib
import io
import json
import zipfile
from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal
from io import StringIO
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command

from apps.analytics.configuracion import (
    get_effective_role_compatibility,
    get_effective_role_target,
)
from apps.analytics.models import AnalyticsAuditLog, KpiStartDate
from apps.ausencias.models import LeaveRecord, SpecialStatus
from apps.empresas.contexto import empresa_actual
from apps.novedades.models import SettingHistory
from apps.projects.models import (
    Project,
    ProjectActivity,
    ProjectComment,
    ProjectDocument,
    ProjectHistory,
    ProjectParticipant,
    ProjectPhase,
    RecoveryItem,
)
from apps.projects.nexo.importador import MODELOS, renombrar_clave, tamano_de_base64
from apps.projects.nexo.lector import (
    TABLAS,
    ErrorDeNexo,
    LectorNexoGHSQL,
    convertir,
    es_clave_de_gh,
)
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import PDF_BYTES, PNG_BYTES


def t(mes, dia, hora=13, minuto=0, anio=2026):
    return datetime(anio, mes, dia, hora, minuto, tzinfo=UTC)


def b64(contenido: bytes) -> str:
    return base64.b64encode(contenido).decode()


def _docx() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as contenedor:
        contenedor.writestr("[Content_Types].xml", "<Types/>")
        contenedor.writestr("word/document.xml", "<w:document>Política de bienestar</w:document>")
    return buffer.getvalue()


DOCX_BYTES = _docx()
EML_BYTES = "From: jefa@laar.com\r\nSubject: Aprobación\r\n\r\nDe acuerdo.".encode()

#: Corte de retención fijo (el comando real lo calcula con la fecha de hoy).
CORTE = date(2021, 11, 5)

# Usuarios de Nexo: 9011 administrador, 9020 jefa, 9021 analista; 9099 solo
# aparece en el JSON del historial (opcional); 9030 tiene fecha de inicio del
# KPI pero no cuenta en la intranet.
ADM, JEFA, ANA, AJENO, EX = 9011, 9020, 9021, 9099, 9030
USUARIOS_NEXO = [
    {"id": ADM, "username": "admin", "email": "Admin.Nexo@LAAR.com"},
    {"id": JEFA, "username": "jefa", "email": "jefa.nacional@laar.com"},
    {"id": ANA, "username": "ana", "email": "ana.nunez@laar.com"},
    {"id": AJENO, "username": "ajeno", "email": "ajeno@laar.com"},
    {"id": EX, "username": "exgh", "email": "ex.colaboradora@laar.com"},
]

NOMBRE_LARGO = "Plan de bienestar y clima laboral — Peñaherrera " + "ñ" * 200


def _actividad(pk, proyecto, **extra):
    return {
        "id": pk,
        "created_at": t(9, 15, 14),
        "updated_at": t(9, 15, 14),
        "project_id": proyecto,
        "phase_id": None,
        "author_id": ANA,
        "description": "Reunión con el área de Operaciones",
        "comments": None,
        "start_time": "08:00",
        "end_time": "09:30",
        "duration": 90,
        "is_retroactive": False,
        "activity_date": None,
        **extra,
    }


def _documento(pk, nombre, **extra):
    return {
        "id": pk,
        "created_at": t(9, 20, 10),
        "updated_at": t(9, 20, 10),
        "project_id": 1001,
        "activity_id": None,
        "category": "OTRO",
        "file_name": nombre,
        "mime_type": "",
        "version": 1,
        "previous_version_id": None,
        "uploaded_by_id": ANA,
        **extra,
    }


def _ausencia(pk, usuario, tipo, dia, **extra):
    return {
        "id": pk,
        "created_at": t(dia.month, 1, 9, anio=dia.year),
        "updated_at": t(dia.month, 1, 9, anio=dia.year),
        "user_id": usuario,
        "type": tipo,
        "date": dia,
        "is_full_day": True,
        "duration_minutes": None,
        "observation": None,
        "created_by_id": ADM,
        **extra,
    }


def _ajuste(pk, clave, valor, desde, hasta=None):
    return {
        "id": pk,
        "key": clave,
        "value": valor,
        "valid_from": desde,
        "valid_until": hasta,
        "updated_by_id": ADM,
        "created_at": desde,
    }


def datos_nexo() -> dict[str, list[dict]]:
    return {
        "project": [
            {
                "id": 1001,
                "created_at": t(9, 1, 8),
                "updated_at": t(9, 2, 9),
                "name": NOMBRE_LARGO[:255],
                "description": "Diagnóstico y acciones — Año 2026",
                "status": "EN_EJECUCION",
                "priority": "ALTA",
                "area": "Gestión Humana",
                "tags": ["bienestar", "año 2026"],
                "observations": "",
                "start_date": t(9, 1, 5),
                "target_date": t(12, 15, 5),
                "target_time_hours": 40.0,
                "real_hours": 2.5,
                "completed_at": None,
                "responsible_id": ANA,
                "created_by_id": JEFA,
                "deleted_at": None,
            },
            {
                "id": 1002,
                "created_at": t(9, 3, 8),
                "updated_at": t(10, 5, 9),
                "name": "Encuesta de clima Ñandú",
                "description": "",
                "status": "PLANIFICACION",
                "priority": "MEDIA",
                "area": "",
                "tags": [],
                "observations": "Suspendida por presupuesto",
                "start_date": t(9, 3, 5),
                "target_date": t(11, 30, 5),
                "target_time_hours": 12.25,
                "real_hours": 0.75,
                "completed_at": None,
                "responsible_id": JEFA,
                "created_by_id": ADM,
                "deleted_at": t(10, 5, 9),
            },
        ],
        "projectphase": [
            {
                "id": 2001,
                "created_at": t(9, 1, 9),
                "updated_at": t(9, 2, 9),
                "project_id": 1001,
                "name": "Diagnóstico",
                "status": "EN_PROGRESO",
                "responsible_id": ANA,
                "start_date": t(9, 1, 5),
                "target_date": t(9, 30, 5),
                "progress": 50,
                "notes": "",
                "target_time_hours": 10.0,
                "order": 1,
            },
            {
                "id": 2002,
                "created_at": t(9, 1, 10),
                "updated_at": t(9, 1, 10),
                "project_id": 1001,
                "name": "Ejecución",
                "status": "PENDIENTE",
                "responsible_id": None,
                "start_date": None,
                "target_date": None,
                "progress": 0,
                "notes": "Pendiente de aprobación",
                "target_time_hours": None,
                "order": 2,
            },
        ],
        "projectparticipant": [
            {
                "id": 2101,
                "created_at": t(9, 1, 9),
                "updated_at": t(9, 1, 9),
                "project_id": 1001,
                "user_id": ANA,
                "added_by_id": JEFA,
                "added_at": t(9, 1, 9),
            }
        ],
        "projectactivity": [
            _actividad(2201, 1001, phase_id=2001, comments="Se acordó el cronograma"),
            # Retroactivo: cuenta en el mes de su fecha de actividad (UTC).
            _actividad(
                2202,
                1001,
                created_at=t(10, 1, 9),
                updated_at=t(10, 1, 9),
                is_retroactive=True,
                activity_date=t(9, 30, 23, 30),
                duration=60,
            ),
            _actividad(
                2203,
                1002,
                author_id=JEFA,
                created_at=t(10, 2, 10),
                updated_at=t(10, 2, 10),
                duration=45,
            ),
        ],
        "projectcomment": [
            {
                "id": 2301,
                "created_at": t(9, 10),
                "updated_at": t(9, 11),
                "project_id": 1001,
                "author_id": JEFA,
                "text": "¿Ya están las firmas de Peñaherrera?",
            }
        ],
        "projectdocument": [
            _documento(2401, "Acta de reunión.pdf", category="ACTA", activity_id=2201),
            _documento(2402, "foto del evento.png", category="IMAGEN", mime_type="image/png"),
            _documento(
                2403,
                "Acta de reunión.pdf",
                category="ACTA",
                version=2,
                previous_version_id=2401,
                created_at=t(9, 25, 10),
                updated_at=t(9, 25, 10),
            ),
            _documento(2404, "Aprobación.eml", category="CORREO", mime_type="message/rfc822"),
            # Sin extensión: se toma la de su tipo, y se valida la firma igual.
            _documento(
                2405,
                "Política de bienestar",
                category="WORD",
                mime_type=(
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                ),
            ),
        ],
        "projecthistory": [
            {
                "id": 2501,
                "project_id": 1001,
                "actor_id": JEFA,
                "event": "CREADO",
                "description": "Jefa creó el proyecto",
                "previous_value": None,
                "new_value": {"name": "Plan", "status": "PENDIENTE", "responsible_id": ANA},
                "created_at": t(9, 1, 8),
            },
            {
                "id": 2502,
                "project_id": 1001,
                "actor_id": JEFA,
                "event": "FASE_ELIMINADA",
                "description": "Jefa eliminó la fase «Fase vieja»",
                "previous_value": {"phase_id": 9999, "name": "Fase vieja"},
                "new_value": None,
                "created_at": t(9, 2, 8),
            },
            {
                "id": 2503,
                "project_id": 1001,
                "actor_id": ANA,
                "event": "DOCUMENTO_AGREGADO",
                "description": "Ana subió el documento",
                "previous_value": None,
                "new_value": {
                    "document_id": 2401,
                    "file_name": "Acta de reunión.pdf",
                    "version": 1,
                },
                "created_at": t(9, 20, 10),
            },
            {
                "id": 2504,
                "project_id": 1001,
                "actor_id": ANA,
                "event": "DOCUMENTO_AGREGADO",
                "description": "Ana subió la foto",
                "previous_value": None,
                "new_value": {
                    "document_id": 2402,
                    "file_name": "foto del evento.png",
                    "version": 1,
                },
                "created_at": t(9, 20, 11),
            },
            {
                "id": 2505,
                "project_id": 1001,
                "actor_id": JEFA,
                "event": "PARTICIPANTE_ELIMINADO",
                "description": "Jefa quitó a un participante",
                "previous_value": {"user_id": AJENO},
                "new_value": None,
                "created_at": t(9, 5, 8),
            },
            {
                "id": 2506,
                "project_id": 1002,
                "actor_id": ADM,
                "event": "ELIMINADO",
                "description": "Admin movió el proyecto a la papelera",
                "previous_value": None,
                "new_value": None,
                "created_at": t(10, 5, 9),
            },
        ],
        "recoveryitem": [
            {
                "id": 2601,
                "entity_type": "PROJECT",
                "entity_id": "1002",
                "entity_label": "Encuesta de clima Ñandú",
                "module_label": "Proyectos",
                "status": "ACTIVE",
                "deleted_by_id": ADM,
                "deleted_at": t(10, 5, 9),
                "retention_hours": 48,
                "expires_at": t(10, 7, 9),
                "restored_by_id": None,
                "restored_at": None,
                "purged_by_id": None,
                "purged_at": None,
                "purge_origin": None,
                "created_at": t(10, 5, 9),
            },
            {
                "id": 2602,
                "entity_type": "PROJECT",
                "entity_id": "8888",
                "entity_label": "Proyecto purgado",
                "module_label": "Proyectos",
                "status": "PURGED",
                "deleted_by_id": JEFA,
                "deleted_at": t(8, 1, 9),
                "retention_hours": 48,
                "expires_at": t(8, 3, 9),
                "restored_by_id": None,
                "restored_at": None,
                "purged_by_id": None,
                "purged_at": t(8, 3, 10),
                "purge_origin": "AUTOMATIC",
                "created_at": t(8, 1, 9),
            },
        ],
        "leaverecord": [
            _ausencia(2701, ANA, "VACACIONES", date(2026, 9, 10)),
            _ausencia(
                2702,
                ANA,
                "PERSONAL",
                date(2026, 9, 11),
                is_full_day=False,
                duration_minutes=120,
                observation="Trámite en el registro civil",
            ),
            _ausencia(
                2703, JEFA, "MEDICO", date(2025, 3, 3), observation="Reposo por gripe — 2 días"
            ),
            # Médico de hace más de 5 años: no se lee ni se importa.
            _ausencia(2704, JEFA, "MEDICO", date(2020, 1, 15), observation="Cirugía"),
            _ausencia(2705, JEFA, "MEDICO", date(2021, 6, 30)),
            # Personal antiguo: la retención es solo para lo médico.
            _ausencia(
                2706, ANA, "PERSONAL", date(2020, 2, 3), is_full_day=False, duration_minutes=30
            ),
        ],
        "specialstatus": [
            {
                "id": 2801,
                "created_at": t(6, 1, 9),
                "updated_at": t(6, 1, 9),
                "user_id": ANA,
                "type": "LACTANCIA",
                "start_date": date(2026, 6, 1),
                "end_date": None,
                "is_active": True,
                "daily_hours": 6.0,
                "limit_low": 4.5,
                "limit_base": 6.0,
                "limit_high": 6.5,
                "limit_overload": 7.0,
                "created_by_id": ADM,
            }
        ],
        "analyticsauditlog": [
            {
                "id": 2901,
                "user_id": ANA,
                "kind": "performance_score",
                "period": "2026-09",
                "inputs": {"completed_pct": 80.0, "weighted_overdue": 1},
                "result": {"score": 78.5, "formula_versions": {"performance_score": "4.0"}},
                "engine_version": "1.5.0",
                "created_at": t(9, 30, 20),
            },
            {
                "id": 2902,
                "user_id": JEFA,
                "kind": "smart_benchmark",
                "period": "2026-10",
                "inputs": {"role": "ADMINISTRADOR", "peer_count": 3},
                "result": {"mode": "rol", "values": {"performance": 81}},
                "engine_version": "1.5.0",
                "created_at": t(10, 15, 20),
            },
        ],
        "kpistartdate": [
            {
                "id": ANA,
                "username": "ana",
                "email": "ana.nunez@laar.com",
                "kpi_start_date": t(9, 15, 0),
            },
            {
                "id": EX,
                "username": "exgh",
                "email": "ex.colaboradora@laar.com",
                "kpi_start_date": t(3, 1, 0),
            },
        ],
        "systemconfighistory": [
            _ajuste(3001, "workload_limit_low", "5.5", t(8, 1), t(9, 1)),
            _ajuste(3002, "workload_limit_low", "6", t(9, 1)),
            _ajuste(
                3003,
                "analytics_role_target_administrador",
                '{"performance": 80, "riesgo_max": 30, "cumplimiento": 90}',
                t(8, 15),
            ),
            _ajuste(
                3004,
                "analytics_role_compatibility_jefe_nacional",
                '["ADMINISTRADOR", "COORDINADOR_NACIONAL"]',
                t(8, 15),
            ),
            # Sin espacios cabe en 255 caracteres; con los de Nexo, no.
            _ajuste(
                3005,
                "analytics_curve_carga",
                json.dumps([{"x": x, "y": min(100, x)} for x in range(0, 130, 10)], indent=1),
                t(8, 20),
            ),
            _ajuste(3006, "recovery_center_retention_hours", "72", t(8, 1)),
            _ajuste(3007, "prediction_window_weeks", "4", t(8, 1)),
            _ajuste(3008, "capacity_workday_end_hour_local", "18", t(8, 1)),
        ],
    }


def contenidos_nexo() -> dict[int, str]:
    return {
        2401: b64(PDF_BYTES),
        2402: b64(PNG_BYTES),
        # Con prefijo de URL de datos, como lo guardaba el navegador.
        2403: "data:application/pdf;base64," + b64(PDF_BYTES + b"% v2\n"),
        2404: b64(EML_BYTES),
        2405: b64(DOCX_BYTES),
    }


class LectorEnMemoria:
    """Mismos métodos que `LectorNexoGHSQL`; `totales` como en SQL. Con
    `filtrar_medicos=False` se porta como un lector que no filtrara."""

    def __init__(self, datos=None, usuarios=None, contenidos=None, filtrar_medicos=True):
        self.datos = datos if datos is not None else datos_nexo()
        self._usuarios = usuarios if usuarios is not None else USUARIOS_NEXO
        self.contenidos = contenidos if contenidos is not None else contenidos_nexo()
        self.corte_medico = CORTE
        self.filtrar_medicos = filtrar_medicos
        self.ajuste_de_totales = None
        self.ajuste_de_conteos = {}
        self.caracteres_de_mas = {}

    def _vencido(self, fila):
        return fila["type"] == "MEDICO" and fila["date"] < self.corte_medico

    def _filas(self, tabla):
        filas = self.datos.get(tabla, [])
        if tabla == "leaverecord" and self.filtrar_medicos:
            filas = [f for f in filas if not self._vencido(f)]
        return filas

    def filas(self, tabla):
        assert tabla in TABLAS
        return copy.deepcopy(sorted(self._filas(tabla), key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in self._usuarios if u["id"] in ids]

    def conteos(self):
        return {t: len(self._filas(t)) + self.ajuste_de_conteos.get(t, 0) for t in TABLAS}

    def documento(self, id_nexo):
        if id_nexo not in self.contenidos:
            return None
        texto = self.contenidos[id_nexo]
        return {
            "file_data": texto,
            "caracteres": len(texto or "") + self.caracteres_de_mas.get(id_nexo, 0),
        }

    def totales(self):
        proyectos = {"registros": 0, "horas_objetivo": Decimal(0), "horas_reales": Decimal(0)}
        for p in self.datos["project"]:
            proyectos["registros"] += 1
            proyectos["horas_objetivo"] += Decimal(str(p["target_time_hours"]))
            proyectos["horas_reales"] += Decimal(str(p["real_hours"]))
        actividades = defaultdict(lambda: {"registros": 0, "minutos": 0})
        for a in self.datos["projectactivity"]:
            momento = a["activity_date"] or a["created_at"]
            c = actividades[(momento.year, momento.month)]
            c["registros"] += 1
            c["minutos"] += a["duration"]
        ausencias = defaultdict(lambda: {"registros": 0, "minutos": 0, "dias_completos": 0})
        vencidos = [f for f in self.datos["leaverecord"] if self._vencido(f)]
        for f in self.datos["leaverecord"]:
            if self._vencido(f):
                continue
            c = ausencias[(f["date"].year, f["date"].month)]
            c["registros"] += 1
            c["minutos"] += f["duration_minutes"] or 0
            c["dias_completos"] += 1 if f["is_full_day"] else 0
        totales = {
            "proyectos": proyectos,
            "actividades": dict(actividades),
            "ausencias": dict(ausencias),
            "medicos_vencidos": {
                "registros": len(vencidos),
                "desde": min((f["date"] for f in vencidos), default=None),
                "hasta": max((f["date"] for f in vencidos), default=None),
            },
            "documentos": {
                "registros": len(self.datos["projectdocument"]),
                "caracteres": sum(len(c or "") for c in self.contenidos.values()),
            },
        }
        if self.ajuste_de_totales:
            self.ajuste_de_totales(totales)
        return totales


# ── Escenario de la intranet ─────────────────────────────────────────────────


@pytest.fixture
def intranet(db):
    """Las cuentas, con correos en otra capitalización que en Nexo."""
    empresa = empresa_actual()
    adm = User.objects.create_user("adm", email="admin.nexo@laar.com", password="x-Clave-123")
    jefa = User.objects.create_user("jefa", email="Jefa.Nacional@laar.com", password="x-Clave-123")
    ana = User.objects.create_user("ana", email="ana.nunez@laar.com", password="x-Clave-123")
    return {"empresa": empresa, "adm": adm, "jefa": jefa, "ana": ana}


def importar(lector=None, *args):
    salida = StringIO()
    call_command(
        "importar_nexo_gh",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def _de_la_empresa(modelo):
    return modelo.objects.todas().filter(**{modelo.objects.ruta_de_empresa: empresa_actual()})


def archivos_guardados() -> list[Path]:
    carpeta = Path(settings.MEDIA_ROOT) / "proyectos_gh"
    return [p for p in carpeta.rglob("*") if p.is_file()] if carpeta.exists() else []


def nada_importado(auditoria_previa=0):
    for tabla, modelo in MODELOS.items():
        qs = _de_la_empresa(modelo)
        if tabla == "leaverecord":
            qs = qs.filter(solicitud__isnull=True)
        if tabla == "systemconfighistory":
            qs = qs.filter(key__startswith="analytics_") | qs.filter(
                key__startswith="workload_limit_"
            )
        if tabla == "analyticsauditlog":
            if qs.count() != auditoria_previa:
                return False
        elif qs.exists():
            return False
    return not archivos_guardados()


# ── Simulacro y aplicación ───────────────────────────────────────────────────


def test_el_simulacro_no_deja_nada_ni_archivos_pero_informa(intranet):
    salida = importar()

    assert "Simulacro" in salida
    assert "projectactivity" in salida and "3 →        3" in salida
    assert "comprobaciones cuadran" in salida and "NO CUADRA" not in salida
    assert nada_importado()


def test_aplicar_crea_todo(intranet):
    lector = LectorEnMemoria()
    salida = importar(lector, "--aplicar")

    assert "Importación confirmada" in salida
    for tabla in (
        "project",
        "projectphase",
        "projectparticipant",
        "projectactivity",
        "projectcomment",
        "projecthistory",
        "recoveryitem",
        "specialstatus",
        "analyticsauditlog",
    ):
        assert _de_la_empresa(MODELOS[tabla]).count() == len(lector.datos[tabla]), tabla
    assert ProjectDocument.objects.count() == 3  # 5 en Nexo, 2 rechazados
    assert LeaveRecord.objects.count() == 4  # 6 en Nexo, 2 médicos vencidos
    assert KpiStartDate.objects.count() == 1
    assert SettingHistory.objects.count() == 8
    proyecto = Project.objects.get(pk=ProjectPhase.objects.first().project_id)
    assert (proyecto.responsible, proyecto.created_by) == (intranet["ana"], intranet["jefa"])
    assert proyecto.empresa == intranet["empresa"]
    assert proyecto.name == NOMBRE_LARGO[:255]
    assert proyecto.tags == ["bienestar", "año 2026"]
    assert len(archivos_guardados()) == 3


def test_un_usuario_necesario_que_falta_aborta_sin_escribir(intranet):
    intranet["ana"].delete()

    with pytest.raises(CommandError) as error:
        importar(None, "--aplicar")

    mensaje = str(error.value)
    assert "ana.nunez@laar.com" in mensaje
    # Los opcionales (JSON del historial, fecha de inicio del KPI) no abortan.
    assert "ajeno@laar.com" not in mensaje
    assert "ex.colaboradora@laar.com" not in mensaje
    assert nada_importado()
    assert not User.objects.filter(email__iexact="ana.nunez@laar.com").exists()


def test_un_destino_con_proyectos_aborta(intranet):
    Project.objects.create(
        name="Proyecto de la intranet",
        priority="ALTA",
        start_date=t(11, 1),
        target_date=t(11, 2),
        target_time_hours=1,
        responsible=intranet["ana"],
        created_by=intranet["jefa"],
    )

    with pytest.raises(CommandError, match="ya tiene datos de Proyectos, Ausencias o KPI"):
        importar(None, "--aplicar")
    assert Project.objects.count() == 1
    assert not archivos_guardados()


def test_un_ajuste_del_kpi_ya_guardado_aborta(intranet):
    SettingHistory.objects.create(
        key="workload_limit_high",
        value="7",
        valid_from=t(11, 1),
        updated_by=intranet["adm"],
    )

    with pytest.raises(CommandError) as error:
        importar(None, "--aplicar")
    assert "workload_limit_high" in str(error.value)
    assert not Project.objects.exists()


def test_la_auditoria_del_kpi_y_los_ajustes_de_tareas_no_cuentan_como_datos(intranet):
    """El motor escribe su auditoría solo con abrir el KPI; las horas son de
    Tareas, ya importado."""
    AnalyticsAuditLog.objects.create(
        user=intranet["ana"], kind="health_score", period="2026-11", engine_version="1.5.0"
    )
    SettingHistory.objects.create(
        key="HORAS_EFECTIVAS_DIA", value="7", valid_from=t(10, 1), updated_by=intranet["adm"]
    )

    assert "Importación confirmada" in importar(None, "--aplicar")
    assert AnalyticsAuditLog.objects.count() == 3
    assert SettingHistory.objects.get(key="HORAS_EFECTIVAS_DIA").value == "7"


def test_un_estado_especial_ya_registrado_aborta(intranet):
    SpecialStatus.objects.create(
        user=intranet["ana"],
        type="MATERNIDAD",
        start_date=date(2026, 10, 1),
        created_by=intranet["adm"],
    )

    with pytest.raises(CommandError, match="SpecialStatus"):
        importar(None, "--aplicar")


# ── Documentos ───────────────────────────────────────────────────────────────


def test_el_documento_base64_valido_queda_como_archivo(intranet):
    importar(None, "--aplicar")

    actas = ProjectDocument.objects.filter(file_name="Acta de reunión.pdf").order_by("version")
    v1, v2 = actas
    assert v1.file.open("rb").read() == PDF_BYTES
    assert (v1.file_size, v1.mime_type, v1.category) == (len(PDF_BYTES), "application/pdf", "ACTA")
    assert v1.file.name.startswith(f"proyectos_gh/{v1.project_id}/")
    assert v1.activity == ProjectActivity.objects.get(phase__name="Diagnóstico")
    assert v1.uploaded_by == intranet["ana"]
    # La URL de datos se decodifica sin el prefijo; la versión apunta al id nuevo.
    assert v2.file.open("rb").read() == PDF_BYTES + b"% v2\n"
    assert (v2.version, v2.previous_version_id) == (2, v1.pk)
    # Sin extensión: toma la de su tipo, y la firma (OOXML) se valida igual.
    politica = ProjectDocument.objects.get(category="WORD")
    assert politica.file_name == "Política de bienestar.docx"
    assert politica.file.open("rb").read() == DOCX_BYTES
    assert (v1.created_at, v2.created_at) == (t(9, 20, 10), t(9, 25, 10))
    # No añade un DOCUMENTO_AGREGADO propio: solo los dos que vienen de Nexo.
    assert ProjectHistory.objects.filter(event="DOCUMENTO_AGREGADO").count() == 2


def test_los_tipos_rechazados_se_listan_y_no_se_importan(intranet, tmp_path):
    ruta = tmp_path / "informe.csv"
    salida = importar(None, "--aplicar", "--informe", str(ruta))

    assert "Documentos NO importados (para que decida Talento Humano): 2" in salida
    assert "«foto del evento.png» del proyecto «Plan de bienestar" in salida
    assert "«Aprobación.eml»" in salida
    assert "No se admiten archivos «.png»" in salida
    assert not ProjectDocument.objects.filter(file_name__endswith=".png").exists()
    assert not ProjectDocument.objects.filter(file_name__endswith=".eml").exists()
    texto = ruta.read_text(encoding="utf-8-sig")
    assert "documento_rechazado,2402,foto del evento.png" in texto
    assert f"sha256={hashlib.sha256(PNG_BYTES).hexdigest()}" in texto
    assert f"bytes={len(EML_BYTES)}" in texto
    assert "subido_por=ana.nunez@laar.com" in texto
    # Ni copia aparte: solo los 3 aceptados en el almacenamiento.
    assert len(archivos_guardados()) == 3
    # El historial que lo nombra queda con la referencia de Nexo.
    foto = ProjectHistory.objects.get(description="Ana subió la foto")
    assert foto.new_value["document_id"] == "nexo:2402"


def test_si_el_base64_no_coincide_con_lo_que_cuenta_nexo_se_deshace_todo(intranet):
    lector = LectorEnMemoria()
    lector.caracteres_de_mas = {2401: 4}  # el driver habría truncado el texto

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_un_base64_invalido_se_lista_como_rechazado(intranet):
    lector = LectorEnMemoria()
    lector.contenidos[2401] = "esto no es base64 ***"
    lector.contenidos[2403] = b64(PDF_BYTES)  # su versión anterior ya no llega

    salida = importar(lector, "--aplicar")
    assert "no es base64 válido" in salida
    assert "su versión anterior (#2401) no se importó" in salida
    assert ProjectDocument.objects.get(file_name="Acta de reunión.pdf").previous_version_id is None


def test_tamano_de_base64():
    for contenido in (b"", b"a", b"ab", b"abc", PDF_BYTES, DOCX_BYTES):
        assert tamano_de_base64(b64(contenido)) == len(contenido)
    assert tamano_de_base64("data:application/pdf;base64," + b64(b"abcd")) == 4


# ── Ausencias ────────────────────────────────────────────────────────────────


def test_los_medicos_de_mas_de_cinco_anios_no_se_importan(intranet, tmp_path):
    ruta = tmp_path / "informe.csv"
    salida = importar(None, "--aplicar", "--informe", str(ruta))

    assert (
        "Permisos médicos anteriores al 2021-11-05 (retención de 5 años), no importados: 2 "
        "(del 2020-01-15 al 2021-06-30)"
    ) in salida
    assert not LeaveRecord.objects.filter(type="MEDICO", date__lt=CORTE).exists()
    assert LeaveRecord.objects.filter(type="MEDICO").count() == 1
    # Lo antiguo que no es médico sí pasa.
    assert LeaveRecord.objects.filter(date=date(2020, 2, 3)).exists()
    texto = ruta.read_text(encoding="utf-8-sig")
    assert "medicos_vencidos,2021-11-05,2,2020-01-15,2021-06-30" in texto
    # El informe no lleva observaciones (datos de salud).
    assert "Cirugía" not in texto and "Reposo" not in texto and "Cirugía" not in salida


def test_si_el_lector_entregara_un_medico_vencido_tampoco_se_importa(intranet):
    lector = LectorEnMemoria(filtrar_medicos=False)

    def como_sql(totales):
        # Nexo cuenta sin los vencidos; este lector los entrega igual.
        totales["medicos_vencidos"] = {"registros": 0, "desde": None, "hasta": None}

    lector.ajuste_de_totales = como_sql
    salida = importar(lector, "--aplicar")

    assert "el lector entregó 2 permisos médicos anteriores al corte" in salida
    assert not LeaveRecord.objects.filter(type="MEDICO", date__lt=CORTE).exists()


def test_las_ausencias_quedan_como_registros_manuales(intranet):
    importar(None, "--aplicar")

    vacaciones = LeaveRecord.objects.get(type="VACACIONES")
    assert (vacaciones.solicitud_id, vacaciones.descuento) == (None, None)
    assert vacaciones.user == intranet["ana"] and vacaciones.created_by == intranet["adm"]
    parcial = LeaveRecord.objects.get(date=date(2026, 9, 11))
    assert (parcial.is_full_day, parcial.duration_minutes) == (False, 120)
    assert parcial.observation == "Trámite en el registro civil"
    assert parcial.created_at == t(9, 1, 9)
    estado = SpecialStatus.objects.get()
    assert (estado.user, estado.type, estado.limit_low, estado.end_date) == (
        intranet["ana"],
        "LACTANCIA",
        4.5,
        None,
    )


# ── Remapeo y fechas ─────────────────────────────────────────────────────────


def test_remapea_los_ids_incluidas_las_referencias_sueltas(intranet):
    salida = importar(None, "--aplicar")

    plan = Project.objects.get(name=NOMBRE_LARGO[:255])
    encuesta = Project.objects.get(name="Encuesta de clima Ñandú")
    diagnostico = ProjectPhase.objects.get(name="Diagnóstico")
    assert diagnostico.project == plan and diagnostico.responsible == intranet["ana"]
    assert ProjectParticipant.objects.get().project == plan
    assert ProjectComment.objects.get().project == plan
    assert set(plan.activities.values_list("duration", flat=True)) == {90, 60}
    assert encuesta.activities.get().author == intranet["jefa"]
    assert ProjectActivity.objects.get(duration=90).phase == diagnostico

    creado = ProjectHistory.objects.get(event="CREADO")
    assert creado.new_value["responsible_id"] == intranet["ana"].pk
    acta = ProjectDocument.objects.get(version=1, file_name="Acta de reunión.pdf")
    assert (
        ProjectHistory.objects.get(description="Ana subió el documento").new_value["document_id"]
        == acta.pk
    )
    borrada = ProjectHistory.objects.get(event="FASE_ELIMINADA")
    assert borrada.previous_value == {"phase_id": "nexo:9999", "name": "Fase vieja"}
    quitado = ProjectHistory.objects.get(event="PARTICIPANTE_ELIMINADO")
    assert quitado.previous_value == {"user_id": "nexo:9099"}
    assert ProjectHistory.objects.get(event="ELIMINADO").project == encuesta

    activo = RecoveryItem.objects.get(status="ACTIVE")
    assert activo.entity_id == str(encuesta.pk)
    assert activo.deleted_by == intranet["adm"]
    assert RecoveryItem.objects.get(status="PURGED").entity_id == "nexo:8888"
    assert "ya vencieron su plazo" in salida


def test_conserva_las_fechas_originales(intranet):
    importar(None, "--aplicar")

    plan = Project.objects.get(name=NOMBRE_LARGO[:255])
    assert (plan.created_at, plan.updated_at, plan.start_date) == (
        t(9, 1, 8),
        t(9, 2, 9),
        t(9, 1, 5),
    )
    encuesta = Project.objects.get(name="Encuesta de clima Ñandú")
    assert encuesta.deleted_at == t(10, 5, 9)
    assert ProjectParticipant.objects.get().added_at == t(9, 1, 9)
    retro = ProjectActivity.objects.get(is_retroactive=True)
    assert (retro.created_at, retro.activity_date) == (t(10, 1, 9), t(9, 30, 23, 30))
    assert ProjectComment.objects.get().updated_at == t(9, 11)
    assert ProjectHistory.objects.get(event="CREADO").created_at == t(9, 1, 8)
    papelera = RecoveryItem.objects.get(status="ACTIVE")
    assert (papelera.deleted_at, papelera.expires_at, papelera.created_at) == (
        t(10, 5, 9),
        t(10, 7, 9),
        t(10, 5, 9),
    )
    log = AnalyticsAuditLog.objects.get(kind="performance_score")
    assert (log.created_at, log.updated_at) == (t(9, 30, 20), t(9, 30, 20))
    # Y los campos automáticos vuelven a serlo después.
    assert Project._meta.get_field("created_at").auto_now_add
    assert ProjectHistory._meta.get_field("created_at").auto_now_add
    assert ProjectParticipant._meta.get_field("added_at").auto_now_add


# ── KPI ──────────────────────────────────────────────────────────────────────


def test_kpi_start_date_por_persona(intranet, tmp_path):
    ruta = tmp_path / "informe.csv"
    salida = importar(None, "--aplicar", "--informe", str(ruta))

    inicio = KpiStartDate.objects.get()
    assert (inicio.user, inicio.kpi_start_date, inicio.empresa) == (
        intranet["ana"],
        t(9, 15, 0),
        intranet["empresa"],
    )
    assert inicio.updated_by is None
    assert "Fecha de inicio del KPI omitida (sin cuenta): 1" in salida
    assert "kpi_omitido,ex.colaboradora@laar.com" in ruta.read_text(encoding="utf-8-sig")


def test_la_auditoria_del_kpi_renombra_el_rol(intranet):
    salida = importar(None, "--aplicar")

    benchmark = AnalyticsAuditLog.objects.get(kind="smart_benchmark")
    assert benchmark.inputs == {"role": ADMIN_GH, "peer_count": 3}
    assert benchmark.user == intranet["jefa"]
    score = AnalyticsAuditLog.objects.get(kind="performance_score")
    assert score.result["score"] == 78.5 and score.period == "2026-09"
    # 1 en la auditoría, 1 clave por rol y 1 en la lista de compatibles.
    assert "ADMINISTRADOR → «Administrador de Gestión Humana»: 3 valores" in salida


def test_una_auditoria_con_datos_de_salud_hace_fallar_la_verificacion(intranet):
    lector = LectorEnMemoria()
    lector.datos["analyticsauditlog"][0]["inputs"]["ausencias"] = [{"tipo": "MEDICO"}]

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


# ── Ajustes ──────────────────────────────────────────────────────────────────


def test_los_ajustes_pasan_con_su_vigencia(intranet):
    importar(None, "--aplicar")

    anterior, vigente = SettingHistory.objects.filter(key="workload_limit_low").order_by(
        "valid_from"
    )
    assert (anterior.value, anterior.valid_from, anterior.valid_until) == ("5.5", t(8, 1), t(9, 1))
    assert (vigente.value, vigente.valid_until, vigente.updated_by) == (
        "6",
        None,
        intranet["adm"],
    )
    assert SettingHistory.objects.get(key="recovery_center_retention_hours").value == "72"
    assert SettingHistory.objects.get(key="capacity_workday_end_hour_local").value == "18"

    # Objetivo del ADMINISTRADOR → del Administrador de Gestión Humana.
    assert not SettingHistory.objects.filter(key="analytics_role_target_administrador").exists()
    assert get_effective_role_target(ADMIN_GH, t(10, 1)) == {
        "performance": 80,
        "riesgo_max": 30,
        "cumplimiento": 90,
    }
    assert get_effective_role_compatibility("JEFE_NACIONAL", t(10, 1)) == [
        ADMIN_GH,
        "COORDINADOR_NACIONAL",
    ]
    # La curva se guarda compacta (cabe en 255) y dice lo mismo.
    curva = SettingHistory.objects.get(key="analytics_curve_carga")
    assert len(curva.value) <= 255
    assert json.loads(curva.value) == [{"x": x, "y": min(100, x)} for x in range(0, 130, 10)]


def test_renombrar_clave_y_seleccion_de_claves():
    assert renombrar_clave("analytics_role_target_administrador") == (
        "analytics_role_target_" + ADMIN_GH.lower()
    )
    assert renombrar_clave("analytics_role_compatibility_administrador") == (
        "analytics_role_compatibility_" + ADMIN_GH.lower()
    )
    assert renombrar_clave("analytics_role_target_jefe_nacional") == (
        "analytics_role_target_jefe_nacional"
    )
    assert es_clave_de_gh("analytics_risk_weight_sobrecarga")
    assert es_clave_de_gh("workload_limit_overload")
    assert es_clave_de_gh("prediction_window_weeks")
    assert not es_clave_de_gh("analytics_engine_version_seen")
    assert not es_clave_de_gh("HORAS_EFECTIVAS_DIA")


def test_un_ajuste_demasiado_largo_hace_fallar_la_verificacion(intranet):
    lector = LectorEnMemoria()
    lector.datos["systemconfighistory"].append(
        _ajuste(
            3009,
            "analytics_curve_vencidas",
            json.dumps([{"x": i, "y": 1} for i in range(40)]),
            t(8, 1),
        )
    )

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


# ── Verificación ─────────────────────────────────────────────────────────────


def test_si_los_minutos_de_ausencias_de_un_mes_no_cuadran_se_deshace_todo(intranet):
    lector = LectorEnMemoria()

    def otro_mes(totales):
        totales["ausencias"][(2026, 9)]["minutos"] += 15

    lector.ajuste_de_totales = otro_mes
    salida = StringIO()
    with pytest.raises(CommandError, match="NO cuadra"):
        call_command(
            "importar_nexo_gh",
            "--empresa",
            str(empresa_actual().pk),
            "--aplicar",
            lector=lector,
            stdout=salida,
        )
    assert "NO CUADRA — Ausencias 09/2026: minutos: Nexo 135 / intranet 120" in salida.getvalue()
    assert nada_importado()


def test_si_las_horas_de_proyectos_no_cuadran_se_deshace_todo(intranet):
    lector = LectorEnMemoria()

    def otra_suma(totales):
        totales["actividades"][(2026, 9)]["minutos"] += 1

    lector.ajuste_de_totales = otra_suma

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_si_las_horas_de_los_proyectos_no_cuadran_se_deshace_todo(intranet):
    lector = LectorEnMemoria()

    def otra_suma(totales):
        totales["proyectos"]["horas_reales"] += Decimal("0.25")

    lector.ajuste_de_totales = otra_suma

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_si_un_conteo_no_cuadra_se_deshace_todo(intranet):
    lector = LectorEnMemoria()
    lector.ajuste_de_conteos = {"leaverecord": 1}  # Nexo cambió mientras se leía

    with pytest.raises(CommandError, match="NO cuadra"):
        importar(lector, "--aplicar")
    assert nada_importado()


def test_el_retroactivo_cuenta_en_el_mes_de_su_actividad(intranet):
    """El lector lo pone en septiembre; si la intranet lo contara por su
    `created_at` (octubre) la verificación no cuadraría."""
    assert "Importación confirmada" in importar(None, "--aplicar")


# ── Informe CSV y lector real ────────────────────────────────────────────────


def test_el_informe_csv_va_fuera_del_repositorio(intranet, tmp_path):
    dentro = settings.BASE_DIR / "informe_gh.csv"
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar(None, "--informe", str(dentro))
    assert not dentro.exists()

    ruta = tmp_path / "informe.csv"
    importar(None, "--informe", str(ruta))
    texto = ruta.read_text(encoding="utf-8-sig")
    assert "tabla,projectdocument,5,3" in texto
    assert "verificacion" in texto


def test_el_informe_csv_lista_los_usuarios_faltantes(intranet, tmp_path):
    intranet["adm"].delete()
    ruta = tmp_path / "informe.csv"

    with pytest.raises(CommandError):
        importar(None, "--informe", str(ruta))
    assert "usuario_faltante,admin.nexo@laar.com" in ruta.read_text(encoding="utf-8-sig")


def test_sin_configuracion_de_nexo_el_lector_avisa():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoGHSQL(alias="nexo_que_no_existe", corte_medico=CORTE)


def test_el_lector_filtra_lo_medico_vencido_en_la_consulta():
    ausencias = TABLAS["leaverecord"]
    assert ausencias.filtro.count("%s") == len(ausencias.parametros)
    # Sin corte, la definición deja fuera todo lo médico.
    assert ausencias.parametros == ("MEDICO", date.max)
    ajustes = TABLAS["systemconfighistory"]
    assert ajustes.filtro.count("%s") == len(ajustes.parametros)
    assert "analytics_engine_version_seen" in ajustes.parametros
    # El listado de documentos no trae el base64.
    assert "file_data" not in TABLAS["projectdocument"].columnas
    assert TABLAS["recoveryitem"].parametros == ("PROJECT",)


def test_convertir_da_tipos_de_python():
    fila = convertir(
        TABLAS["leaverecord"],
        {"date": "2026-09-10", "created_at": datetime(2026, 9, 1, 9), "updated_at": None},
    )
    assert fila["date"] == date(2026, 9, 10)
    assert fila["created_at"] == t(9, 1, 9)
    historial = convertir(
        TABLAS["projecthistory"], {"new_value": '{"document_id": 5}', "previous_value": None}
    )
    assert historial["new_value"] == {"document_id": 5}
