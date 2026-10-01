"""La etiqueta se emite en Code 128 o en QR, a elección de quien imprime.

El QR estaba descartado desde el 2026-09-09 con un motivo que **sigue siendo
cierto**: una pistola láser de un solo haz no puede leer un símbolo
bidimensional. Se reabre como opción, no como cambio de camino, y por eso el
valor por defecto sigue siendo el lineal: quien elige QR tiene que tener
lectores de imagen o usar la cámara del teléfono.
"""

import datetime

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.etiquetas import CODE128, QR, construir_tspl, construir_zpl
from apps.activos.etiquetas_pdf import construir_pdf
from apps.activos.models import Activo, TipoDispositivo
from apps.core.models import AuditLog
from apps.empresas.models import Empresa
from apps.organizacion.models import Departamento
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


class _ActivoDePrueba:
    """Lo mínimo que la etiqueta necesita, sin tocar la base."""

    codigo_barras = "GA-LAP-000007"
    nombre = "Laptop Jefatura TI"
    departamento_id = 1

    class departamento:
        nombre = "Tecnología"


# --- Lo que se manda a la impresora ------------------------------------------


def test_zpl_emite_un_qr_cuando_se_pide():
    trabajo = construir_zpl(
        codigo_barras="GA-LAP-000007",
        nombre_activo="Laptop",
        area="TI",
        simbologia=QR,
    )

    assert "^BQN,2,6" in trabajo
    assert "^FDQA,GA-LAP-000007" in trabajo
    assert "^BCN" not in trabajo  # y no las barras


def test_zpl_sigue_emitiendo_code128_por_defecto():
    """Sin pedir nada se imprime lineal: es lo que leen las pistolas que hay."""
    trabajo = construir_zpl(codigo_barras="GA-LAP-000007", nombre_activo="Laptop", area="TI")

    assert "^BCN,50,Y,N,N" in trabajo
    assert "^BQN" not in trabajo


def test_tspl_emite_un_qr_cuando_se_pide():
    trabajo = construir_tspl(
        codigo_barras="GA-LAP-000007",
        nombre_activo="Laptop",
        area="TI",
        simbologia=QR,
    )

    assert 'QRCODE 16,66,M,6,A,0,"GA-LAP-000007"' in trabajo
    assert "BARCODE" not in trabajo


def test_tspl_sigue_emitiendo_code128_por_defecto():
    trabajo = construir_tspl(codigo_barras="GA-LAP-000007", nombre_activo="Laptop", area="TI")

    assert 'BARCODE 16,66,"128"' in trabajo
    assert "QRCODE" not in trabajo


# --- El PDF -------------------------------------------------------------------


@pytest.mark.parametrize("simbologia", [CODE128, QR])
def test_el_pdf_sale_en_las_dos_simbologias(simbologia):
    documento = construir_pdf([_ActivoDePrueba()], simbologia=simbologia)

    assert documento[:4] == b"%PDF"
    assert len(documento) > 500


def test_el_qr_y_la_barra_no_producen_el_mismo_documento():
    """Comprobación de que el parámetro llega de verdad al dibujo: si se
    ignorara, los dos PDF serían idénticos byte a byte."""
    con_barra = construir_pdf([_ActivoDePrueba()], simbologia=CODE128)
    con_qr = construir_pdf([_ActivoDePrueba()], simbologia=QR)

    assert con_barra != con_qr


def test_el_codigo_legible_sigue_debajo_en_ambas():
    """Si el símbolo se raya o el lector falla, el código se teclea. Eso no
    cambia por elegir QR."""
    for simbologia in (CODE128, QR):
        documento = construir_pdf([_ActivoDePrueba()], simbologia=simbologia)
        assert b"GA-LAP-000007" in documento


# --- Desde la API -------------------------------------------------------------


@pytest.fixture
def cliente(db):
    usuario = User.objects.create_user(
        username="etiquetador", email="etiquetador@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=["activos.ver", "activos.imprimir_etiqueta"],
        )
    )
    api = APIClient()
    api.force_authenticate(user=usuario)
    return api


@pytest.fixture
def activo(db):
    """Un equipo propio: la base de pruebas arranca vacía."""
    empresa = Empresa.objects.first() or Empresa.objects.create(nombre="Laar", codigo="LAAR")
    tipo = TipoDispositivo.objects.create(empresa=empresa, nombre="Laptop de prueba", codigo="LPQ")
    departamento = Departamento.objects.filter(empresa=empresa).first() or (
        Departamento.objects.create(empresa=empresa, nombre="TI")
    )
    return Activo.objects.create(
        empresa=empresa,
        nombre="Laptop Jefatura TI",
        tipo=tipo,
        departamento=departamento,
        codigo_barras="GA-LPQ-000007",
        fecha_adquisicion=datetime.date(2026, 1, 15),
    )


def test_la_api_acepta_la_simbologia(cliente, activo):
    respuesta = cliente.get(
        f"/api/v1/activos/{activo.id}/etiqueta/", {"formato": "zpl", "simbologia": "qr"}
    )

    assert respuesta.status_code == 200
    assert "^BQN" in respuesta.data["contenido"]


def test_una_simbologia_inventada_se_rechaza_con_las_opciones(cliente, activo):
    """Decir cuáles hay evita el ensayo y error: son dos y no son evidentes."""
    respuesta = cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/", {"simbologia": "datamatrix"})

    assert respuesta.status_code == 400
    assert respuesta.data["error"]["code"] == "simbologia_invalida"
    assert "code128" in respuesta.data["error"]["message"]
    assert "qr" in respuesta.data["error"]["message"]


def test_queda_auditado_con_que_simbologia_se_imprimio(cliente, activo):
    """Si una tanda no se deja leer, lo primero que hay que poder reconstruir
    es con cuál se imprimió."""
    cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/", {"formato": "zpl", "simbologia": "qr"})

    evento = AuditLog.objects.filter(action="activo.etiqueta_generada").latest("created_at")
    assert evento.new_values["simbologia"] == "qr"


def test_el_lote_tambien_se_imprime_en_qr(cliente, activo):
    respuesta = cliente.post(
        "/api/v1/activos/etiquetas/?formato=zpl&simbologia=qr",
        {"ids": [activo.id]},
        format="json",
    )

    assert respuesta.status_code == 200
    assert "^BQN" in respuesta.data["contenido"]
