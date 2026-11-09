"""`manage.py importar_nexo_auditoria`: la auditoría general de Nexo
(`core_auditlog`) en la auditoría de la intranet, marcada como «Migrado de Nexo».

Sin base de Nexo: el comando recibe un lector en memoria con los mismos métodos
que `LectorNexoAuditoriaSQL`. Los ids de Nexo son altos a propósito, para que un
id copiado sin traducir se note. Los correos son ficticios.
"""

import copy
import json
from datetime import UTC, datetime
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.core.nexo.importador import ImportadorNexoAuditoria, enmascarar
from apps.core.nexo.lector import LectorNexoAuditoriaSQL
from apps.empresas.contexto import empresa_actual
from apps.novedades.nexo.comun import ErrorDeNexo
from apps.users.models import User

pytestmark = pytest.mark.django_db

ADMIN, ANA, EXTERNA, BORRADO = 9120, 9121, 9122, 9199
USUARIOS_NEXO = [
    {
        "id": ADMIN,
        "username": "admin.nexo",
        "email": "Admin.Nexo@Example.com",
        "first_name": "Adela",
        "last_name": "Peñaherrera",
    },
    {
        "id": ANA,
        "username": "ana",
        "email": "ana.nunez@example.com",
        "first_name": "Ana",
        "last_name": "Núñez",
    },
    # Sin cuenta en la intranet: queda con su nombre.
    {
        "id": EXTERNA,
        "username": "begona",
        "email": "begona.duran@example.com",
        "first_name": "Begoña",
        "last_name": "Durán",
    },
]


def t(mes, dia, hora=15):
    return datetime(2026, mes, dia, hora, tzinfo=UTC)


def _evento(pk, actor, action, module, target_type, target_id, **extra):
    return {
        "id": pk,
        "created_at": t(8, 1 + pk % 20),
        "updated_at": t(8, 1 + pk % 20),
        "actor_id": actor,
        "action": action,
        "module": module,
        "target_type": target_type,
        "target_id": target_id,
        "previous_values": {},
        "new_values": {},
        "result": "success",
        "ip_address": "192.0.2.10",
        "user_agent": "Mozilla/5.0",
        "browser": "Firefox",
        "operating_system": "Windows",
        "device": "Escritorio",
        "location": "",
        "correlation_id": f"corr-{pk}",
        **extra,
    }


def datos_nexo():
    return [
        _evento(
            8001,
            ADMIN,
            "user.updated",
            "usuarios",
            "user",
            str(ANA),
            previous_values={"first_name": "Ana", "email": "ana.vieja@example.com"},
            # Como lo guardaba Nexo: JSON en texto, con la cédula en claro (su
            # lista de enmascarado no la tenía) y una contraseña anidada.
            new_values=json.dumps(
                {
                    "first_name": "Ana María",
                    "cedula": "0912345678",
                    "perfil": {"password": "Sup3r-Secr3t!", "cargo": "Analista"},
                }
            ),
        ),
        _evento(8002, ADMIN, "role.created", "roles", "role", "77"),
        _evento(8003, ANA, "collaborator.created", "novedades", "collaborator", "5150"),
        _evento(8004, ANA, "data_request.created", "solicitudes_lopd", "datarequest", "31"),
        # Sin módulo: se deduce de la ruta o de la vista.
        _evento(
            8005,
            EXTERNA,
            "access_denied",
            "",
            "user",
            str(EXTERNA),
            result="failure",
            new_values={
                "required_permission": "tasks.edit",
                "method": "PATCH",
                "path": "/api/tasks/12/",
            },
        ),
        _evento(
            8006,
            ANA,
            "projectviewset.validation_failed",
            "",
            "projectviewset",
            "4",
            result="failure",
        ),
        _evento(8007, ADMIN, "algo.raro", "", "cosa", "", previous_values="{no es json"),
        # De un usuario que ya no existe en Nexo.
        _evento(8008, BORRADO, "user.consent_accepted", "usuarios", "user", str(BORRADO)),
        # Del sistema (sin autor).
        _evento(8009, None, "period.closed", "novedades", "period", "202608"),
    ]


class LectorEnMemoria:
    def __init__(self, filas=None):
        self.datos = filas if filas is not None else datos_nexo()

    def filas(self, tabla):
        assert tabla == "auditlog"
        return copy.deepcopy(sorted(self.datos, key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in USUARIOS_NEXO if u["id"] in ids]

    def conteos(self):
        return {"auditlog": len(self.datos)}


@pytest.fixture(autouse=True)
def _con_base(db):
    """Pide `db` para que el fixture global corra la prueba dentro de una
    empresa (`backend/conftest.py`)."""


@pytest.fixture
def cuentas():
    return {
        ADMIN: User.objects.create_user(username="adela", email="admin.nexo@example.com"),
        ANA: User.objects.create_user(username="anunez", email="ana.nunez@example.com"),
    }


def importar(*args, lector=None):
    salida = StringIO()
    call_command(
        "importar_nexo_auditoria",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def importados():
    return AuditLog.objects.filter(id_en_nexo__isnull=False)


def test_simulacro_no_deja_nada(cuentas):
    salida = importar()
    assert "SIMULACRO" in salida and "todo cuadra" in salida
    assert "auditlog          9 →        9" in salida
    assert not importados().exists()


def test_aplicar_conserva_fecha_quien_y_marca(cuentas):
    salida = importar("--aplicar")
    assert "Importación confirmada." in salida
    assert importados().count() == 9
    assert all(e.empresa == empresa_actual() for e in importados())

    editado = AuditLog.objects.get(id_en_nexo=8001)
    assert editado.migrado_de_nexo
    assert editado.created_at == t(8, 2) and editado.actor == cuentas[ADMIN]
    assert editado.module == "usuarios" and editado.correlation_id == "corr-8001"
    # El objeto es un usuario con cuenta: pasa al id de la intranet.
    assert editado.target_id == str(cuentas[ANA].pk)
    # Enmascarado como la intranet (correo y cédula), también lo anidado.
    assert editado.previous_values == {"first_name": "Ana", "email": "***"}
    assert editado.new_values == {
        "first_name": "Ana María",
        "cedula": "***",
        "perfil": {"password": "***", "cargo": "Analista"},
    }

    # Lo demás conserva el id de Nexo, con prefijo para no confundirlo.
    assert AuditLog.objects.get(id_en_nexo=8002).target_id == "nexo:77"
    sistema = AuditLog.objects.get(id_en_nexo=8009)
    assert sistema.actor is None and sistema.actor_en_nexo == ""


def test_mapeo_de_modulos(cuentas):
    importar("--aplicar")
    modulos = dict(importados().values_list("id_en_nexo", "module"))
    assert modulos == {
        8001: "usuarios",
        8002: "roles",
        8003: "novedades",
        8004: "privacidad",
        8005: "tareas",
        8006: "proyectos_gh",
        8007: "nexo",
        8008: "usuarios",
        8009: "novedades",
    }


def test_personas_sin_cuenta_quedan_con_su_nombre(cuentas):
    salida = importar("--aplicar")
    externa = AuditLog.objects.get(id_en_nexo=8005)
    assert externa.actor is None and externa.actor_en_nexo == "Begoña Durán"
    assert externa.target_id == f"nexo:{EXTERNA}" and externa.result == "failure"
    borrado = AuditLog.objects.get(id_en_nexo=8008)
    assert borrado.actor_en_nexo == f"Usuario #{BORRADO} de Nexo"
    assert "Personas de Nexo sin cuenta en la intranet: 2" in salida
    # El correo no queda en la auditoría.
    assert not AuditLog.objects.filter(actor_en_nexo__contains="@").exists()


def test_json_ilegible_queda_vacio_con_aviso(cuentas):
    salida = importar("--aplicar")
    assert AuditLog.objects.get(id_en_nexo=8007).previous_values == {}
    assert "1 valores de antes/después no eran JSON legible" in salida


def test_repetir_no_duplica(cuentas):
    importar("--aplicar")
    lector = LectorEnMemoria()
    lector.datos.append(_evento(8010, ANA, "user.updated", "usuarios", "user", str(ANA)))
    salida = importar("--aplicar", lector=lector)
    assert "omitidas — ya importadas antes: 9" in salida
    assert "auditlog         10 →        1" in salida
    assert importados().count() == 10


def test_la_base_impide_el_duplicado(cuentas):
    AuditLog.objects.create(action="x", target_type="t", target_id="1", id_en_nexo=8001)
    with pytest.raises(IntegrityError), transaction.atomic():
        AuditLog.objects.create(action="x", target_type="t", target_id="1", id_en_nexo=8001)
    # Los de la intranet (sin id de Nexo) no chocan entre sí.
    AuditLog.objects.create(action="x", target_type="t", target_id="1")
    AuditLog.objects.create(action="x", target_type="t", target_id="1")


def test_conteo_distinto_no_cuadra_y_no_deja_nada(cuentas):
    class Truncado(LectorEnMemoria):
        def conteos(self):
            return {"auditlog": len(self.datos) + 1}

    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar", lector=Truncado())
    assert not importados().exists()


def test_la_verificacion_detecta_un_evento_alterado(cuentas, monkeypatch):
    original = ImportadorNexoAuditoria._crear

    def alterar(self):
        original(self)
        AuditLog.objects.filter(id_en_nexo=8002).update(action="role.deleted")

    monkeypatch.setattr(ImportadorNexoAuditoria, "_crear", alterar)
    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar")
    assert not importados().exists()


def test_se_ve_en_la_pantalla_de_auditoria_marcado(cuentas):
    importar("--aplicar")
    jefe = User.objects.create_superuser(
        username="auditor", email="auditor@example.com", password="Sup3r-Secr3t!"
    )
    AuditLog.objects.create(
        empresa=empresa_actual(),
        actor=jefe,
        action="activo.creado",
        target_type="activo",
        target_id="1",
        module="activos",
    )
    cliente = APIClient()
    cliente.force_authenticate(user=jefe)
    respuesta = cliente.get("/api/v1/admin/audit-logs/", {"page_size": 50}).json()
    eventos = {e["action"]: e for e in respuesta.get("results", respuesta)}
    assert eventos["activo.creado"]["migrado_de_nexo"] is False
    assert eventos["access_denied"]["migrado_de_nexo"] is True
    assert eventos["access_denied"]["actor_en_nexo"] == "Begoña Durán"
    assert eventos["user.updated"]["actor_username"] == "adela"
    modulos = {
        m["id"]: m["nombre"] for m in cliente.get("/api/v1/admin/audit-logs/modulos/").json()
    }
    assert modulos["nexo"] == "Nexo (histórico)"
    assert modulos["novedades"] == "Gestión Humana · Novedades"


def test_empresa_inexistente():
    with pytest.raises(CommandError, match="No existe la empresa"):
        call_command(
            "importar_nexo_auditoria",
            "--empresa",
            "999999",
            lector=LectorEnMemoria(),
            stdout=StringIO(),
        )


def test_el_informe_csv_no_puede_quedar_en_el_repositorio(cuentas, settings):
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar("--informe", str(settings.BASE_DIR / "informe.csv"))


def test_informe_csv_fuera_del_repositorio(cuentas, tmp_path):
    ruta = tmp_path / "auditoria.csv"
    importar("--informe", str(ruta))
    texto = ruta.read_text(encoding="utf-8-sig")
    assert "usuario_sin_cuenta,begona.duran@example.com" in texto
    assert "modulo,nexo,1,Nexo (histórico)" in texto


def test_sin_base_de_nexo_configurada():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoAuditoriaSQL(alias="nexo_que_no_existe")


def test_enmascarar_en_profundidad():
    assert enmascarar(
        {"token": "abc", "lista": [{"telefono": "0991234567", "nota": "ñandú"}], "n": 3}
    ) == {"token": "***", "lista": [{"telefono": "***", "nota": "ñandú"}], "n": 3}
