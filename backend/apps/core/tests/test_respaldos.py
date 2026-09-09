"""Copias de seguridad y su verificación (§21, «Disponibilidad»).

Lo que se prueba aquí es lo que rodea al `BACKUP DATABASE`, no la orden en sí:
esa la ejecuta SQL Server y probarla exigiría escribir un archivo de gigabytes
en cada corrida de la suite. Lo que sí se prueba —y es donde estuvo el fallo
real— es que **un respaldo que no se escribe no se informe como correcto**.

El defecto original: la ruta iba como parámetro (`TO DISK = %s`). SQL Server no
admite parámetros ahí, así que la sentencia no escribía nada *y no lanzaba
ningún error*: el comando decía «respaldo completado» y el archivo no existía.
Un respaldo así solo se descubre roto el día que hace falta.
"""

import json
from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.core.management.commands.respaldar import (
    _validar_ruta,
    comparar_con_la_base,
    fecha_del_ultimo_respaldo,
    leer_manifiesto,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def media(tmp_path):
    """Un directorio de adjuntos con contenido, como el real."""
    carpeta = tmp_path / "media" / "adjuntos"
    carpeta.mkdir(parents=True)
    (carpeta / "factura.pdf").write_bytes(b"%PDF-1.4 factura")
    (carpeta / "acta.pdf").write_bytes(b"%PDF-1.4 acta")
    return tmp_path / "media"


# --- La ruta, que va literal en la sentencia ---


def test_rechaza_rutas_con_caracteres_peligrosos():
    """La ruta va embebida en SQL porque `TO DISK` no admite parámetros: una
    comilla la convertiría en otra cosa."""
    for ruta in ("/backup/x';DROP DATABASE y--.bak", "/backup/a;b.bak", "/backup/a\nb.bak"):
        with pytest.raises(CommandError):
            _validar_ruta(ruta)


def test_acepta_una_ruta_normal():
    _validar_ruta("/var/opt/mssql/backup/gestion_activos-20260909-1200.bak")


# --- Que no se informe un respaldo que no existe ---


def test_un_respaldo_que_no_se_puede_verificar_falla(media):
    """Era el defecto real: la orden no escribía nada y el comando informaba
    de éxito. Ahora la verificación es parte del respaldo, no un extra."""
    with override_settings(MEDIA_ROOT=str(media)):
        with patch(
            "apps.core.management.commands.respaldar.Command._verificar",
            side_effect=CommandError("no se pudo verificar"),
        ):
            with pytest.raises(CommandError):
                call_command("respaldar", destino=str(media.parent / "respaldos"), verbosity=0)


# --- Adjuntos y manifiesto ---


def test_respalda_los_adjuntos_ademas_de_la_base(media, tmp_path):
    """Las facturas y actas firmadas viven en el sistema de archivos y no se
    regeneran: un respaldo que solo lleve la base deja el inventario intacto y
    todos sus papeles perdidos."""
    destino = tmp_path / "respaldos"

    with override_settings(MEDIA_ROOT=str(media)):
        call_command("respaldar", "--solo-adjuntos", destino=str(destino), verbosity=0)

    paquetes = list(destino.glob("adjuntos-*.tar.gz"))
    assert len(paquetes) == 1
    assert paquetes[0].stat().st_size > 0


def test_el_manifiesto_registra_lo_que_habia_dentro(media, tmp_path):
    """Restaurar sin comparar contra algo es confiar en que el archivo estaba
    completo. El manifiesto es ese algo."""
    destino = tmp_path / "respaldos"

    with override_settings(MEDIA_ROOT=str(media)):
        call_command("respaldar", "--solo-adjuntos", destino=str(destino), verbosity=0)

    manifiesto = leer_manifiesto(next(destino.glob("manifiesto-*.json")))
    assert set(manifiesto["contenido"]) == {
        "activos",
        "movimientos",
        "mantenimientos",
        "adjuntos",
        "empleados",
        "usuarios",
    }
    assert manifiesto["adjuntos"]["archivos"] == 2


def test_la_comparacion_detecta_una_restauracion_incompleta():
    """Un respaldo truncado se restaura sin ruido: el hueco se descubre meses
    después, cuando alguien busca un acta que no está."""
    diferencias = comparar_con_la_base({"contenido": {"activos": 999, "usuarios": 0}})

    entidades = {entidad for entidad, _, _ in diferencias}
    assert "activos" in entidades


def test_la_comparacion_calla_cuando_todo_coincide(media, tmp_path):
    destino = tmp_path / "respaldos"
    with override_settings(MEDIA_ROOT=str(media)):
        call_command("respaldar", "--solo-adjuntos", destino=str(destino), verbosity=0)

    manifiesto = leer_manifiesto(next(destino.glob("manifiesto-*.json")))

    assert comparar_con_la_base(manifiesto) == []


# --- Lo que ve la revisión de despliegue ---


def test_sin_respaldos_no_hay_fecha(tmp_path):
    assert fecha_del_ultimo_respaldo(str(tmp_path / "no-existe")) is None


def test_lee_la_fecha_del_ultimo_respaldo(tmp_path):
    carpeta = tmp_path / "respaldos"
    carpeta.mkdir()
    (carpeta / "manifiesto-20260101-1000.json").write_text(
        json.dumps({"generado": "2026-01-01T10:00:00"}), encoding="utf-8"
    )
    (carpeta / "manifiesto-20260909-1200.json").write_text(
        json.dumps({"generado": "2026-09-09T12:00:00"}), encoding="utf-8"
    )

    ultimo = fecha_del_ultimo_respaldo(str(carpeta))

    assert ultimo is not None
    assert ultimo.strftime("%Y-%m-%d") == "2026-09-09"


def test_un_manifiesto_ilegible_no_rompe_la_revision(tmp_path):
    """La revisión de despliegue no puede caerse por un archivo corrupto: su
    trabajo es informar, incluso de que algo está mal."""
    carpeta = tmp_path / "respaldos"
    carpeta.mkdir()
    (carpeta / "manifiesto-roto.json").write_text("{esto no es json", encoding="utf-8")
    (carpeta / "manifiesto-20260909-1200.json").write_text("tampoco", encoding="utf-8")

    assert fecha_del_ultimo_respaldo(str(carpeta)) is None


def test_la_revision_de_despliegue_avisa_si_no_hay_respaldos(capsys, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    with override_settings(DEBUG=False):
        call_command("verificar_despliegue")

    assert "No consta ningun respaldo" in capsys.readouterr().out


def test_la_revision_no_avisa_con_un_respaldo_reciente(capsys, tmp_path, monkeypatch):
    from django.utils import timezone

    monkeypatch.chdir(tmp_path)
    carpeta = tmp_path / "respaldos"
    carpeta.mkdir()
    (carpeta / "manifiesto-hoy.json").write_text(
        json.dumps({"generado": timezone.localtime().isoformat(timespec="seconds")}),
        encoding="utf-8",
    )

    with override_settings(DEBUG=False):
        call_command("verificar_despliegue")

    salida = capsys.readouterr().out
    assert "No consta ningun respaldo" not in salida
    assert "Respaldo del" in salida


# --- Textos con la codificación rota ---


@pytest.mark.parametrize(
    ("roto", "esperado"),
    [
        ("ReinstalaciÃ³n del sistema", "Reinstalación del sistema"),
        ("Formateo y restauraciÃ³n", "Formateo y restauración"),
        ("MÃ¡quina de la gerencia", "Máquina de la gerencia"),
    ],
)
def test_repara_el_texto_mal_codificado(roto, esperado):
    """«Ã³» son los dos bytes de «ó» en UTF-8 leídos como Latin-1: volver a
    codificar y decodificar devuelve el original."""
    from apps.core.management.commands.reparar_codificacion import reparar

    assert reparar(roto) == esperado


@pytest.mark.parametrize(
    "correcto",
    ["Reinstalación del sistema", "Cambio de disco", "", "Máquina — con raya"],
)
def test_no_toca_el_texto_que_ya_esta_bien(correcto):
    """Solo se repara lo que lleva la marca del problema: aplicar la conversión
    a un texto sano lo rompería."""
    from apps.core.management.commands.reparar_codificacion import reparar

    assert reparar(correcto) is None


def test_la_reparacion_no_se_ejecuta_sin_pedirlo(capsys):
    """Reescribir campos de la base no es algo que deba pasar por ejecutar un
    comando de diagnóstico."""
    call_command("reparar_codificacion")

    salida = capsys.readouterr().out
    assert "Simulacion" in salida or "No hay textos" in salida
