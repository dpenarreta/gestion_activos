"""Códigos escaneados con la distribución de teclado equivocada (RF-03).

Caso real, 2026-09-09: se escaneó la etiqueta `GA-LAP-000006` y el sistema
recibió `GA'LAP'000006`. No fallaba el código de barras ni el lector — los dos
funcionaban. Una pistola USB no envía texto: simula pulsaciones de teclas, y
quien las traduce a caracteres es el sistema operativo con su propia
distribución. La tecla que en un teclado US produce `-` está, en el español,
en la posición del `'`.

El sistema lo repara, pero **lo dice**. Arreglarlo en silencio dejaría la
pistola mal configurada y el mismo problema reaparecería en la carga masiva, en
el buscador y en cualquier campo donde se escanee — allí sin nadie que lo
repare.
"""

import datetime

import pytest
from rest_framework.test import APIClient

from apps.activos.barcode import normalizar_escaneo
from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_escaneo", email="admin_escaneo@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def activo(admin):
    return ActivoService.crear_activo(
        actor=admin,
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop Soporte 03",
        marca="Dell",
        modelo="Latitude",
        numero_serie="DEMO-NIV-3",
        departamento=Departamento.objects.create(nombre="Tecnología", codigo="TI"),
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


# --- La reparación ---


@pytest.mark.parametrize(
    "recibido",
    [
        "GA'LAP'000006",  # teclado español sobre pistola en US
        "GA´LAP´000006",  # variante con acento agudo
        "GA)LAP)000006",  # teclado francés AZERTY
        "GAßLAPß000006",  # teclado alemán QWERTZ
    ],
)
def test_repara_el_guion_de_las_distribuciones_mas_comunes(recibido):
    reparado, corregido = normalizar_escaneo(recibido)

    assert corregido
    assert reparado == "GA-LAP-000006"


def test_un_codigo_correcto_no_se_toca():
    assert normalizar_escaneo("GA-LAP-000006") == ("GA-LAP-000006", False)


def test_no_toca_un_numero_de_serie_con_apostrofes():
    """La reparación solo se aplica si el resultado tiene la forma exacta de un
    código del sistema. En un número de serie del fabricante un apóstrofe puede
    ser legítimo, y sustituirlo encontraría el equipo equivocado."""
    assert normalizar_escaneo("SERIE'DEL'FABRICANTE") == ("SERIE'DEL'FABRICANTE", False)


def test_no_inventa_una_correccion_cuando_el_codigo_no_existe():
    """Un texto cualquiera con apóstrofes no se convierte en un código."""
    _, corregido = normalizar_escaneo("cualquier'cosa")

    assert not corregido


# --- El circuito completo, como lo vive el técnico ---


def test_el_escaner_encuentra_el_equipo_pese_a_la_distribucion_equivocada(cliente, activo):
    """El técnico está delante del equipo con la pistola en la mano: que la
    consulta funcione es lo primero."""
    respuesta = cliente.get("/api/v1/activos/por-codigo/GA'LAP'000001/")

    assert respuesta.status_code == 200
    assert respuesta.data["activo"]["codigo_barras"] == activo.codigo_barras


def test_y_avisa_de_que_la_pistola_esta_mal_configurada(cliente, activo):
    """Sin el aviso, el problema seguiría latente en la carga masiva y en el
    buscador, donde no hay quien lo repare."""
    respuesta = cliente.get("/api/v1/activos/por-codigo/GA'LAP'000001/")

    aviso = respuesta.data["advertencia_lector"]
    assert aviso["codigo"] == "distribucion_de_teclado"
    assert aviso["recibido"] == "GA'LAP'000001"
    assert aviso["interpretado"] == "GA-LAP-000001"
    assert "distribución de teclado" in aviso["mensaje"]


def test_un_escaneo_normal_no_lleva_advertencia(cliente, activo):
    respuesta = cliente.get(f"/api/v1/activos/por-codigo/{activo.codigo_barras}/")

    assert respuesta.status_code == 200
    assert "advertencia_lector" not in respuesta.data


def test_si_el_equipo_no_existe_el_error_explica_la_causa_probable(cliente, activo):
    """Un «no encontrado» a secas manda al técnico a revisar la etiqueta, que
    está bien: el problema está en la configuración del lector."""
    respuesta = cliente.get("/api/v1/activos/por-codigo/GA'LAP'999999/")

    assert respuesta.status_code == 404
    assert "distribución de teclado" in respuesta.data["error"]["message"]


# --- La búsqueda del listado, que es donde también se dispara la pistola ---
#
# Segundo aviso del mismo caso, 2026-09-11: la reparación existía pero vivía
# solo en `por-codigo`. En el inventario y en el «Activo intervenido» del
# mantenimiento —que buscan por `q`— la etiqueta no encontraba nada, y la
# pantalla decía «ningún equipo coincide», que manda a revisar la etiqueta.


def test_el_inventario_encuentra_el_equipo_con_el_codigo_mal_leido(cliente, activo):
    respuesta = cliente.get("/api/v1/activos/?q=GA'LAP'000001")

    assert respuesta.status_code == 200
    assert respuesta.data["count"] == 1
    assert respuesta.data["results"][0]["codigo_barras"] == activo.codigo_barras


def test_y_lo_dice_en_vez_de_arreglarlo_en_silencio(cliente, activo):
    """Es el mismo aviso de la lectura por código: si no se dice, la pistola se
    queda mal configurada y el problema reaparece donde nadie lo repara."""
    respuesta = cliente.get("/api/v1/activos/?q=GA'LAP'000001")

    aviso = respuesta.data["advertencia_lector"]
    assert aviso["codigo"] == "distribucion_de_teclado"
    assert aviso["recibido"] == "GA'LAP'000001"
    assert aviso["interpretado"] == "GA-LAP-000001"


def test_una_busqueda_normal_no_lleva_advertencia(cliente, activo):
    respuesta = cliente.get(f"/api/v1/activos/?q={activo.codigo_barras}")

    assert respuesta.data["count"] == 1
    assert "advertencia_lector" not in respuesta.data


def test_el_buscador_del_mantenimiento_tambien_lo_encuentra(cliente, activo):
    """Es el mismo filtro con `operativos=true`: el campo «Activo intervenido»
    del formulario de mantenimiento."""
    respuesta = cliente.get("/api/v1/activos/?q=GA'LAP'000001&operativos=true")

    assert respuesta.data["count"] == 1


def test_no_se_toca_una_serie_que_lleva_apostrofe_de_verdad(cliente, admin, activo):
    """La reparación solo se aplica si el resultado tiene la forma exacta de un
    código emitido por el sistema: sustituir a ciegas encontraría el equipo
    equivocado, que es peor que no encontrar ninguno."""
    otro = ActivoService.crear_activo(
        actor=admin,
        tipo=activo.tipo,
        nombre="Equipo con serie rara",
        marca="HP",
        modelo="ProBook",
        numero_serie="SN'RARA'01",
        departamento=activo.departamento,
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )

    respuesta = cliente.get("/api/v1/activos/?q=SN'RARA'01")

    assert respuesta.data["count"] == 1
    assert respuesta.data["results"][0]["id"] == otro.id
    assert "advertencia_lector" not in respuesta.data


def test_no_avisa_de_una_pistola_que_no_se_uso(cliente, activo):
    """Que un texto se pueda reparar no significa que haga falta repararlo.

    `SN'RARA'01` tiene la forma de un código nuestro una vez sustituidos los
    apóstrofes, pero si nadie escaneó nada, mandar a reconfigurar la pistola es
    ruido — y del que se aprende a ignorar.
    """
    respuesta = cliente.get("/api/v1/activos/?q=CUALQUIERA'COSA'01")

    assert "advertencia_lector" not in respuesta.data
