"""El peso que muestran los mensajes de tamaño (US-007, CA-2).

Con `:.1f` un archivo apenas mayor que el máximo salía como «5.0 MB y el
máximo es 5 MB». Ahora el peso se redondea hacia arriba a dos decimales con
coma, y cada validador usa la misma función.
"""

import pytest
from rest_framework import serializers

from apps.adjuntos import validators as adjuntos
from apps.core.archivos import (
    BYTES_POR_MEGA,
    maximo_para_mostrar,
    megas_para_mostrar,
    mensaje_de_tamano,
)
from apps.mejora_continua import services as mejora
from apps.nova import conocimiento
from apps.organizacion import documentos, noticias

CINCO_MB = 5 * BYTES_POR_MEGA


class ArchivoFalso:
    """Lo único que miran los validadores antes de leer: nombre y tamaño. Así
    no hace falta reservar 20 MB en memoria para pasar del máximo."""

    def __init__(self, nombre: str, tamano: int):
        self.name = nombre
        self.size = tamano

    def read(self, *_):  # pragma: no cover - el tamaño se rechaza antes
        raise AssertionError("No debía leer el contenido")

    def seek(self, *_):  # pragma: no cover
        raise AssertionError("No debía leer el contenido")


# ── La función ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("tamano", "esperado"),
    [
        (CINCO_MB, "5,00"),
        (CINCO_MB + 1, "5,01"),
        (5_290_000, "5,05"),
        (5_042_000, "4,81"),
        (0, "0,00"),
        (1, "0,01"),
        (BYTES_POR_MEGA * 20 + 1, "20,01"),
    ],
)
def test_megas_redondea_hacia_arriba_con_coma(tamano, esperado):
    assert megas_para_mostrar(tamano) == esperado


def test_un_byte_de_mas_nunca_parece_igual_al_maximo():
    mostrado = float(megas_para_mostrar(CINCO_MB + 1).replace(",", "."))
    assert mostrado > CINCO_MB / BYTES_POR_MEGA
    assert mostrado > float(maximo_para_mostrar(CINCO_MB))


def test_el_maximo_exacto_se_muestra_entero():
    assert maximo_para_mostrar(CINCO_MB) == "5"
    assert maximo_para_mostrar(BYTES_POR_MEGA) == "1"
    assert maximo_para_mostrar(BYTES_POR_MEGA + BYTES_POR_MEGA // 2) == "1,50"


def test_mensaje_completo():
    assert (
        mensaje_de_tamano("La imagen", 5_290_000, CINCO_MB)
        == "La imagen pesa 5,05 MB y el máximo es 5 MB."
    )


# ── Cada validador ──────────────────────────────────────────────────────────


def _sin_punto_decimal(mensaje: str, maximo: int) -> None:
    megas = maximo // BYTES_POR_MEGA
    assert f"{megas}.0 MB" not in mensaje
    assert f"pesa {megas},01 MB y el máximo es {megas} MB." in mensaje


def test_noticias_del_carrusel():
    with pytest.raises(serializers.ValidationError) as exc:
        noticias.validar_imagen(ArchivoFalso("portada.jpg", noticias.TAMANO_MAXIMO_BYTES + 1))
    mensaje = str(exc.value.detail[0])
    assert mensaje.startswith("La imagen pesa")
    _sin_punto_decimal(mensaje, noticias.TAMANO_MAXIMO_BYTES)


def test_adjuntos():
    with pytest.raises(serializers.ValidationError) as exc:
        adjuntos.validar_archivo(ArchivoFalso("factura.pdf", adjuntos.TAMANO_MAXIMO_BYTES + 1))
    _sin_punto_decimal(str(exc.value.detail[0]), adjuntos.TAMANO_MAXIMO_BYTES)


def test_documentos_institucionales():
    with pytest.raises(serializers.ValidationError) as exc:
        documentos.validar(ArchivoFalso("reglamento.pdf", documentos.TAMANO_MAXIMO_BYTES + 1))
    _sin_punto_decimal(str(exc.value.detail[0]), documentos.TAMANO_MAXIMO_BYTES)


def test_mejora_continua():
    with pytest.raises(mejora.MejoraContinuaError) as exc:
        mejora.validar_adjunto(ArchivoFalso("propuesta.pdf", mejora.TAMANO_MAXIMO_ADJUNTO + 1))
    _sin_punto_decimal(str(exc.value), mejora.TAMANO_MAXIMO_ADJUNTO)


def test_nova_conocimiento(settings):
    settings.NOVA_CONOCIMIENTO_TAMANO_MAXIMO_MB = 5
    with pytest.raises(conocimiento.DocumentoInvalido) as exc:
        conocimiento.validar_archivo(ArchivoFalso("política.pdf", CINCO_MB + 1))
    _sin_punto_decimal(exc.value.mensaje, CINCO_MB)
