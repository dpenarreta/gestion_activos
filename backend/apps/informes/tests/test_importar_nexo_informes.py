"""`manage.py importar_nexo_informes`: los informes ejecutivos de Nexo, como datos
congelados.

Sin base de Nexo: el comando recibe un lector en memoria con los mismos
métodos que `LectorNexoInformesSQL`. Los ids de Nexo son altos a propósito,
para que un id copiado sin traducir se note. Los correos son ficticios.
"""

import copy
from datetime import UTC, datetime
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.empresas.contexto import empresa_actual
from apps.informes.models import (
    ExecutiveReportAuditLog,
    ExecutiveReportIntegrityIncident,
    ExecutiveReportSnapshot,
)
from apps.informes.nexo.lector import TABLAS, LectorNexoInformesSQL, convertir
from apps.novedades.nexo.comun import ErrorDeNexo
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import client_for, make_user

pytestmark = pytest.mark.django_db

JEFA, ANA, NINO, PRUEBAS, SIN_CUENTA = 9020, 9021, 9022, 9050, 9099
USUARIOS_NEXO = [
    {"id": JEFA, "username": "jefa", "email": "Jefa.Nacional@Example.com"},
    {"id": ANA, "username": "ana", "email": "ana.nunez@example.com"},
    {"id": NINO, "username": "nino", "email": "nino.noboa@example.com"},
    {"id": PRUEBAS, "username": "pruebas", "email": "pruebas@example.com"},
    {"id": SIN_CUENTA, "username": "exgh", "email": "ex.colaboradora@example.com"},
]


def t(mes, dia, hora=15):
    return datetime(2026, mes, dia, hora, tzinfo=UTC)


def _documento(report_id, ids):
    return {
        "meta": {"reportId": report_id, "collaboratorIds": [str(i) for i in ids]},
        "teamSummary": {"avgCumplimiento": 81, "totalTasks": 12, "totalConsultas": 4},
        "members": [{"id": i, "name": f"Persona {i}", "score": 70} for i in ids],
        "nota": "Año de la Peñaherrera — ñandú",
    }


def _snapshot(pk, report_id, *, por=JEFA, ids=(ANA, NINO), **extra):
    fila = {
        "id": pk,
        "report_id": report_id,
        "type": "MENSUAL",
        "scope": "JEFE",
        "origin": "GENERATED",
        "integrity_flag": "FULL",
        "legacy_monthly_report_id": None,
        "migrated_at": None,
        "generated_by_id": por,
        "generated_at": t(9, 30),
        "period_label": "septiembre de 2026",
        "period_start": t(9, 1, 0),
        "period_end": t(9, 30, 23),
        "fecha_corte": t(9, 30, 23),
        "period_status": "CERRADO",
        "filters": {"periodo": {"tipoReporte": "MENSUAL", "month": 9, "year": 2026}},
        "collaborator_ids": [str(i) for i in ids],
        "collaborator_count": len(ids),
        "analytics_engine_version": "1.5.0",
        "formula_set_version": "4.4",
        "reporting_engine_version": "2.0",
        "nexo_version": "3.2.0",
        "data": _documento(report_id, ids),
        "nova": {"executiveSummary": {"situacionGeneral": "Texto de NOVA."}},
        "nova_degraded": False,
        "data_quality": {"pct": 92, "issues": []},
        "generation_ms": 4210,
        "created_at": t(9, 30, 16),
    }
    fila.update(extra)
    return fila


def _evento(pk, report_id, accion, usuario, **extra):
    return {
        "id": pk,
        "report_id": report_id,
        "action": accion,
        "user_id": usuario,
        "step": None,
        "message": None,
        "period": None,
        "fecha_corte": None,
        "filters_applied": None,
        "collaborator_count": None,
        "generation_ms": None,
        "analytics_engine_version": None,
        "formula_set_version": None,
        "nexo_version": None,
        "created_at": t(9, 30, 17),
        **extra,
    }


def datos_nexo() -> dict[str, list[dict]]:
    return {
        "snapshot": [
            _snapshot(8001, "NXR-20260930-100000-AAAA"),
            # Uno con un id antiguo de Postgres (no numérico) y otro sin cuenta.
            _snapshot(
                8002,
                "NXR-20260930-110000-BBBB",
                ids=(ANA, "ckx9legacy", SIN_CUENTA),
                origin="LEGACY_MIGRATION",
                integrity_flag="PARTIAL",
                data={"teamSummary": {"avgCumplimiento": 50}},  # sin `meta`
            ),
            _snapshot(8003, "NXR-20260930-120000-CCCC", por=PRUEBAS, ids=(PRUEBAS,)),
        ],
        "auditlog": [
            _evento(
                8101,
                "NXR-20260930-100000-AAAA",
                "generated",
                JEFA,
                period="septiembre de 2026",
                filters_applied={"periodo": {"tipoReporte": "MENSUAL"}},
                generation_ms=4210,
            ),
            _evento(8102, "NXR-20260930-100000-AAAA", "viewed", ANA),
            _evento(8103, "NXR-20260930-120000-CCCC", "generated", PRUEBAS),
            _evento(8104, "NXR-20260901-090000-ZZZZ", "generation_failed", JEFA, message="Error"),
        ],
        "incident": [
            {
                "id": 8201,
                "report_id": "NXR-20260930-100000-AAAA",
                "field_path": f"members[{ANA}].completedPct",
                "expected_value": 81.0,
                "actual_value": 79.0,
                "source": "kpis_team",
                "user_id": ANA,
                "detected_at": t(9, 30, 16),
            },
            {
                "id": 8202,
                "report_id": "NXR-20260930-100000-AAAA",
                "field_path": f"members[{SIN_CUENTA}].cargaPct",
                "expected_value": 90.0,
                "actual_value": 99.0,
                "source": "kpis_team",
                "user_id": SIN_CUENTA,
                "detected_at": t(9, 30, 16),
            },
        ],
    }


class LectorEnMemoria:
    def __init__(self, datos=None, usuarios=None):
        self.datos = datos if datos is not None else datos_nexo()
        self._usuarios = usuarios if usuarios is not None else USUARIOS_NEXO

    def filas(self, tabla):
        return copy.deepcopy(sorted(self.datos[tabla], key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in self._usuarios if u["id"] in ids]

    def conteos(self):
        return {tabla: len(filas) for tabla, filas in self.datos.items()}


@pytest.fixture
def cuentas():
    """Las cuentas de la intranet (mismo correo que en Nexo, con otra
    capitalización a propósito). La de pruebas existe; la ex colaboradora no."""
    return {
        JEFA: User.objects.create_user(username="jnacional", email="jefa.nacional@example.com"),
        ANA: User.objects.create_user(username="anunez", email="ana.nunez@example.com"),
        NINO: User.objects.create_user(username="nnoboa", email="nino.noboa@example.com"),
        PRUEBAS: User.objects.create_user(username="pruebas", email="pruebas@example.com"),
    }


def importar(*args, lector=None):
    salida = StringIO()
    call_command(
        "importar_nexo_informes",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def test_simulacro_no_deja_nada(cuentas):
    salida = importar()
    assert "SIMULACRO" in salida and "todo cuadra" in salida
    assert not ExecutiveReportSnapshot.objects.exists()
    assert not ExecutiveReportAuditLog.objects.exists()


def test_aplicar_copia_congelado_y_traduce_colaboradores(cuentas):
    salida = importar("--aplicar")
    assert "Importación confirmada." in salida

    snap = ExecutiveReportSnapshot.objects.get(report_id="NXR-20260930-100000-AAAA")
    assert snap.empresa == empresa_actual()
    assert snap.generated_by == cuentas[JEFA]
    assert snap.collaborator_ids == [cuentas[ANA].pk, cuentas[NINO].pk]
    # El documento, tal cual (con los ids de Nexo adentro).
    assert snap.data == _documento("NXR-20260930-100000-AAAA", (ANA, NINO))
    assert snap.nova == {"executiveSummary": {"situacionGeneral": "Texto de NOVA."}}
    assert snap.generated_at == t(9, 30) and snap.created_at == t(9, 30, 16)
    assert snap.generation_ms == 4210 and snap.nexo_version == "3.2.0"

    legado = ExecutiveReportSnapshot.objects.get(report_id="NXR-20260930-110000-BBBB")
    assert legado.collaborator_ids == [cuentas[ANA].pk, "nexo:ckx9legacy", f"nexo:{SIN_CUENTA}"]
    assert legado.collaborator_count == 3
    assert "colaboradores sin cuenta" in salida

    assert ExecutiveReportAuditLog.objects.count() == 4
    fallido = ExecutiveReportAuditLog.objects.get(action="generation_failed")
    assert fallido.user == cuentas[JEFA] and fallido.created_at == t(9, 30, 17)
    incidentes = {i.field_path: i.user_id for i in ExecutiveReportIntegrityIncident.objects.all()}
    assert incidentes == {
        f"members[{ANA}].completedPct": cuentas[ANA].pk,
        f"members[{SIN_CUENTA}].cargaPct": None,
    }


def test_un_importado_se_lee_por_la_api_con_su_meta_reparada(cuentas):
    importar("--aplicar")
    admin = make_user("admingh", ADMIN_GH)
    informe = client_for(admin).get("/api/v1/informes/executive/NXR-20260930-110000-BBBB/").json()
    assert informe["origin"] == "LEGACY_MIGRATION"
    assert informe["data"]["meta"]["rosterKind"] == "CONSOLIDADO"
    assert informe["pages"][0]["reportId"] == "NXR-20260930-110000-BBBB"
    # Quien no ve a todas sus personas no lo abre: tiene colaboradores sin cuenta.
    jefa = make_user("otrajefa", "JEFE_NACIONAL")
    respuesta = client_for(jefa).get("/api/v1/informes/executive/NXR-20260930-110000-BBBB/")
    assert respuesta.status_code == 404


def test_aborta_si_falta_quien_genero_un_informe(cuentas):
    cuentas[PRUEBAS].delete()
    with pytest.raises(CommandError, match="Faltan 1 usuarios") as error:
        importar("--aplicar")
    assert "pruebas@example.com" in str(error.value)
    assert not ExecutiveReportSnapshot.objects.exists()


def test_no_importa_dos_veces(cuentas):
    importar("--aplicar")
    with pytest.raises(CommandError, match="ya se importaron"):
        importar("--aplicar")
    assert ExecutiveReportSnapshot.objects.count() == 3


def test_convive_con_informes_ya_emitidos_en_la_intranet(cuentas):
    ExecutiveReportSnapshot.objects.create(
        report_id="NXR-20261020-100000-DDDD",
        type="MENSUAL",
        scope="JEFE",
        generated_by=cuentas[JEFA],
        generated_at=t(10, 20),
        period_label="octubre de 2026",
        period_start=t(10, 1, 0),
        period_end=t(10, 31, 23),
        fecha_corte=t(10, 20),
        period_status="EN_CURSO",
        filters={},
        analytics_engine_version="1.5.0",
        formula_set_version="4.4",
        reporting_engine_version="2.0",
        nexo_version="0.1.0",
        data={},
        data_quality={},
        generation_ms=1,
    )
    importar("--aplicar")
    assert ExecutiveReportSnapshot.objects.count() == 4


def test_excluir_usuario_quita_sus_informes_y_su_bitacora(cuentas):
    salida = importar("--aplicar", "--excluir-usuario", "Pruebas@Example.com")
    assert "excluidas por usuario — snapshot: 1" in salida
    assert not ExecutiveReportSnapshot.objects.filter(report_id="NXR-20260930-120000-CCCC").exists()
    assert not ExecutiveReportAuditLog.objects.filter(report_id="NXR-20260930-120000-CCCC").exists()
    assert ExecutiveReportSnapshot.objects.count() == 2


def test_excluir_a_quien_sale_en_un_informe_ajeno_aborta(cuentas):
    with pytest.raises(CommandError, match="informes de otras personas"):
        importar("--aplicar", "--excluir-usuario", "ana.nunez@example.com")
    assert not ExecutiveReportSnapshot.objects.exists()


def test_verificacion_detecta_un_documento_alterado(cuentas, monkeypatch):
    from apps.informes.nexo import importador

    original = importador.ImportadorNexoInformes._crear

    def alterar(self):
        self.datos["snapshot"][0]["data"] = {"alterado": True}
        original(self)
        self.datos["snapshot"][0]["data"] = _documento("NXR-20260930-100000-AAAA", (ANA, NINO))

    monkeypatch.setattr(importador.ImportadorNexoInformes, "_crear", alterar)
    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar")
    assert not ExecutiveReportSnapshot.objects.exists()


def test_sin_base_de_nexo_configurada():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoInformesSQL(alias="nexo_que_no_existe")


def test_el_informe_csv_no_puede_quedar_en_el_repositorio(cuentas, settings):
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar("--informe", str(settings.BASE_DIR / "informe.csv"))


def test_conversion_de_filas_del_driver():
    fila = convertir(
        TABLAS["snapshot"],
        {
            "generated_at": "2026-09-30 15:00:00",
            "data": '{"meta": {"reportId": "NXR-1"}}',
            "collaborator_ids": '["9021"]',
            "migrated_at": None,
        },
    )
    assert fila["generated_at"] == t(9, 30)
    assert fila["data"] == {"meta": {"reportId": "NXR-1"}}
    assert fila["collaborator_ids"] == ["9021"]
