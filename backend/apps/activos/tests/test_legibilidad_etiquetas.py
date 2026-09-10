"""Que la etiqueta impresa se deje leer por una pistola (RF-08, §5).

Estas pruebas no comprueban que el PDF se genere —eso ya está cubierto— sino
la **geometría del símbolo**, que es lo que decide si el lector lo decodifica.
Un Code 128 correcto en pantalla puede ser ilegible impreso por tres motivos, y
los tres son medibles sin tener la pistola delante:

1. Sin zona muda, el lector no encuentra dónde empieza el símbolo.
2. Con barras más finas de dos puntos de impresora, falla sobre plástico curvo.
3. Con un ancho de módulo que no sea múltiplo del punto, la impresora térmica
   redondea cada barra por su cuenta y deforma la proporción entre anchas y
   estrechas, que es justo lo que el lector mide.

Lo que ninguna prueba puede sustituir es escanear una etiqueta impresa de
verdad: la legibilidad final depende también del material, del contraste y de
la calibración de la impresora.
"""

import datetime

import pytest
from rest_framework.test import APIClient

from apps.activos.etiquetas_pdf import (
    PUNTO_203_DPI_MM,
    QUIET_ZONE_MODULOS,
    X_MINIMA_MM,
    construir_pdf,
    medir_simbolo,
)
from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento
from apps.users.models import User

pytestmark = pytest.mark.django_db

#: Códigos con la forma que emite el sistema: GA-<TIPO>-<SECUENCIA>.
CODIGOS_REALES = [
    "GA-LAP-000001",
    "GA-IMP-000123",
    "GA-SRV-999999",
    "GA-NET-000042",
]


@pytest.mark.parametrize("codigo", CODIGOS_REALES)
def test_la_barra_mas_fina_no_baja_del_minimo_legible(codigo):
    """Dos puntos de una impresora de 203 dpi. Por debajo, una pistola de gama
    común empieza a fallar."""
    medida = medir_simbolo(codigo)

    assert medida["ancho_modulo_mm"] >= X_MINIMA_MM
    assert medida["cumple_minimo"]


@pytest.mark.parametrize("codigo", CODIGOS_REALES)
def test_el_ancho_de_modulo_es_multiplo_del_punto_de_impresora(codigo):
    """Si no lo es, la impresora redondea cada barra por separado y la
    proporción entre anchas y estrechas sale distorsionada."""
    medida = medir_simbolo(codigo)

    puntos = medida["ancho_modulo_mm"] / PUNTO_203_DPI_MM
    assert abs(puntos - round(puntos)) < 0.01, f"{puntos} puntos por módulo"


@pytest.mark.parametrize("codigo", CODIGOS_REALES)
def test_el_simbolo_lleva_zona_muda_a_los_lados(codigo):
    """La causa más frecuente de que una etiqueta «no se deje leer»: antes se
    dibujaba pegado al margen del material."""
    medida = medir_simbolo(codigo)

    assert medida["quiet_zone_mm"] >= QUIET_ZONE_MODULOS * X_MINIMA_MM * 0.99


@pytest.mark.parametrize("codigo", CODIGOS_REALES)
def test_el_simbolo_cabe_en_la_etiqueta_de_50_por_25(codigo):
    """El formato de código que emite el sistema tiene que caber, con su zona
    muda, en la etiqueta que se usa. Si un día deja de caber, esta prueba lo
    dice antes que el operario con el lector."""
    medida = medir_simbolo(codigo)

    assert medida["cabe"]


def test_un_codigo_mas_largo_avisa_de_que_no_cabe():
    """Con 50 × 25 mm el límite práctico son trece caracteres. Si el formato
    creciera —otro prefijo, otra secuencia— hay que ampliar la etiqueta, y el
    sistema tiene que poder decirlo en vez de emitir un símbolo ilegible."""
    medida = medir_simbolo("GA-LAPTOP-0000001234")

    assert not medida["cabe"] or not medida["cumple_minimo"]


def test_la_altura_de_las_barras_permite_apuntar_sin_precision():
    """Una barra baja obliga a apuntar con una precisión que nadie tiene con
    el equipo en la mano."""
    assert medir_simbolo("GA-LAP-000001")["alto_barras_mm"] >= 8


def test_el_pdf_se_genera_a_tamano_fisico_real(db):
    """Si la página no midiera lo que mide la etiqueta, imprimir «ajustar a la
    hoja» reescalaría el símbolo y todas las medidas anteriores dejarían de
    valer."""
    import re

    from reportlab.lib.units import mm

    admin = User.objects.create_superuser(
        username="admin_etiq", email="admin_etiq@example.com", password="Sup3r-Secr3t!"
    )
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop de prueba",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-ETIQ-1",
        departamento=Departamento.objects.create(nombre="Tecnología", codigo="TI"),
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )

    contenido = construir_pdf([activo])

    # El MediaBox se lee del PDF crudo para no sumar una dependencia de
    # lectura de PDF solo por esta comprobación.
    caja = re.search(rb"/MediaBox\s*\[([\d.\s-]+)\]", contenido)
    assert caja, "el PDF debe declarar el tamaño de página"
    _, _, ancho, alto = (float(valor) for valor in caja.group(1).split())

    assert round(ancho / mm) == 50
    assert round(alto / mm) == 25


def test_la_medicion_se_puede_consultar_antes_de_imprimir(db):
    """Para comprobarlo antes de un lote de doscientas etiquetas, en vez de
    descubrirlo con el lector en la mano."""
    admin = User.objects.create_superuser(
        username="admin_medicion", email="admin_medicion@example.com", password="Sup3r-Secr3t!"
    )
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=TipoDispositivo.objects.create(nombre="Impresora", codigo="IMP"),
        nombre="Impresora",
        marca="HP",
        modelo="M404",
        numero_serie="SN-ETIQ-2",
        departamento=Departamento.objects.create(nombre="Contabilidad", codigo="CTB"),
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )
    cliente = APIClient()
    cliente.force_authenticate(user=admin)

    datos = cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/medicion/").data

    assert datos["simbologia"] == "Code 128"
    assert datos["cumple_minimo"] is True
    assert datos["cabe"] is True
