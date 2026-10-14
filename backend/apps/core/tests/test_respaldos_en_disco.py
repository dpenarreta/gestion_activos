"""Los respaldos en disco: verlos y borrarlos desde la pantalla.

Cobertura de tests/qa/features/respaldos.feature (AC-BAK-022 a AC-BAK-024).

Un respaldo son varios archivos con la misma marca —manifiesto, adjuntos y el
`.bak` de la base—, y se borran juntos. El más reciente no se borra nunca: es
el que garantiza que hoy hay de dónde volver.
"""

import json

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.core.models import AuditLog, PoliticaDeRespaldo
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

RUTA = "/api/v1/configuracion/respaldos/archivos/"
MARCAS = ("20261012-0305", "20261013-0305", "20261014-1525")


@pytest.fixture
def carpetas(tmp_path, settings):
    """Tres respaldos completos: manifiesto y adjuntos en el destino, `.bak` en
    la carpeta montada de SQL Server."""
    destino = tmp_path / "respaldos"
    sql = tmp_path / "sql"
    destino.mkdir()
    sql.mkdir()
    for marca in MARCAS:
        (destino / f"manifiesto-{marca}.json").write_text(
            json.dumps({"contenido": {"activos": 21}}), encoding="utf-8"
        )
        (destino / f"adjuntos-{marca}.tar.gz").write_bytes(b"x" * 10)
        (sql / f"gestion_activos-{marca}.bak").write_bytes(b"b" * 100)
    settings.RESPALDOS_SQL_LOCAL = str(sql)
    PoliticaDeRespaldo.objects.create(destino=str(destino))
    return destino, sql


def _cliente(*codenames):
    usuario = User.objects.create_user(
        username=f"u{len(codenames)}", email=f"u{len(codenames)}@example.com", password="x"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=codenames,
        )
    )
    api = APIClient()
    api.force_authenticate(user=usuario)
    return api


@pytest.fixture
def cliente():
    return _cliente("configuracion.ver", "configuracion.respaldos")


def test_lista_los_respaldos_del_mas_reciente_al_mas_antiguo(cliente, carpetas):
    datos = cliente.get(RUTA).data

    marcas = [r["marca"] for r in datos["respaldos"]]
    assert marcas == sorted(MARCAS, reverse=True)
    primero = datos["respaldos"][0]
    assert primero["es_el_mas_reciente"] is True
    assert primero["tiene_base"] and primero["tiene_adjuntos"]
    assert primero["bytes"] == 110 + len(json.dumps({"contenido": {"activos": 21}}))
    assert primero["contenido"] == {"activos": 21}
    assert not any(r["es_el_mas_reciente"] for r in datos["respaldos"][1:])
    assert datos["borra_la_base"] is True


def test_un_bak_sin_manifiesto_tambien_se_lista(cliente, carpetas):
    """Los `.bak` de antes de que hubiera retención se acumularon sin su
    manifiesto: tienen que poder verse para poder borrarse."""
    _, sql = carpetas
    (sql / "gestion_activos-20260917-1602.bak").write_bytes(b"b")

    marcas = [r["marca"] for r in cliente.get(RUTA).data["respaldos"]]

    assert "20260917-1602" in marcas


def test_borrar_quita_todos_sus_archivos_y_queda_auditado(cliente, carpetas):
    destino, sql = carpetas

    respuesta = cliente.delete(f"{RUTA}20261012-0305/")

    assert respuesta.status_code == 204
    assert not list(destino.glob("*20261012-0305*"))
    assert not list(sql.glob("*20261012-0305*"))
    # Los demás siguen en su sitio.
    assert len(list(sql.glob("*.bak"))) == 2
    evento = AuditLog.objects.get(action="respaldo.borrado")
    assert evento.previous_values["marca"] == "20261012-0305"
    assert len(evento.previous_values["archivos"]) == 3
    assert evento.previous_values["contenido"] == {"activos": 21}


def test_el_mas_reciente_no_se_borra(cliente, carpetas):
    """Ni desde el botón ni con una petición hecha a mano: es el que garantiza
    que hoy hay de dónde volver."""
    destino, sql = carpetas

    respuesta = cliente.delete(f"{RUTA}20261014-1525/")

    assert respuesta.status_code == 409
    assert "más reciente" in respuesta.data["error"]["message"]
    assert (sql / "gestion_activos-20261014-1525.bak").exists()
    assert (destino / "manifiesto-20261014-1525.json").exists()


@pytest.mark.parametrize("marca", ["*", "..", "2026101", "20261012-0305.bak", "x" * 13])
def test_una_marca_rara_no_borra_nada(cliente, carpetas, marca):
    """La marca va a un `glob`: nada que venga de la petición debe poder
    escribir comodines ni rutas."""
    destino, sql = carpetas

    respuesta = cliente.delete(f"{RUTA}{marca}/")

    assert respuesta.status_code == 404
    assert len(list(sql.glob("*.bak"))) == 3
    assert len(list(destino.iterdir())) == 6


def test_sin_la_carpeta_de_la_base_se_dice(cliente, carpetas, settings):
    """Sin la carpeta montada, borrar deja el `.bak` en el servidor: la
    pantalla tiene que poder avisarlo antes."""
    settings.RESPALDOS_SQL_LOCAL = ""

    datos = cliente.get(RUTA).data

    assert datos["borra_la_base"] is False
    assert not any(r["tiene_base"] for r in datos["respaldos"])


def test_ver_la_configuracion_no_basta_para_borrar(carpetas):
    """Borrar copias decide de cuándo se puede volver: exige el permiso de
    respaldos, no el de mirar la configuración."""
    _, sql = carpetas
    lector = _cliente("configuracion.ver", "configuracion.editar")

    assert lector.get(RUTA).status_code == 200
    assert lector.delete(f"{RUTA}20261012-0305/").status_code == 403
    assert (sql / "gestion_activos-20261012-0305.bak").exists()
