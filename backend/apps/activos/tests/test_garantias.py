"""Situación de garantía de los activos (§4.1 del documento funcional).

La garantía se guarda como una sola fecha de fin y el estado se deriva de
ella. La alternativa —almacenar el estado— obligaría a un proceso diario que
lo recalculara, y bastaría con que ese proceso fallara un día para que el
sistema dijera «en garantía» sobre un equipo ya descubierto.
"""

import datetime
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.activos.models import DIAS_AVISO_GARANTIA, Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_gar", email="admin_gar@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def crear_activo(db, admin):
    departamento = Departamento.objects.create(nombre="Tecnología", codigo="TI")
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    contador = {"n": 0}

    def crear(fecha_fin_garantia=None, **extra):
        contador["n"] += 1
        activo = ActivoService.crear_activo(
            actor=admin,
            tipo=tipo,
            nombre=f"Equipo {contador['n']}",
            marca="Dell",
            modelo="Latitude",
            numero_serie=f"SN-GAR-{contador['n']}",
            departamento=departamento,
            fecha_adquisicion=datetime.date(2024, 1, 10),
            **extra,
        )
        if fecha_fin_garantia is not None:
            activo.fecha_fin_garantia = fecha_fin_garantia
            activo.save(update_fields=["fecha_fin_garantia"])
        return activo

    return crear


# --- Estado derivado de la fecha -------------------------------------------


def test_sin_fecha_registrada_el_estado_no_es_vencida(crear_activo):
    """Un inventario a medio capturar no es un parque sin cobertura: se
    distinguen para no disparar alarmas sobre equipos que quizá sí la tienen."""
    activo = crear_activo(fecha_fin_garantia=None)

    assert activo.estado_garantia == Activo.Garantia.SIN_REGISTRAR
    assert activo.dias_para_fin_de_garantia is None


def test_una_fecha_pasada_deja_la_garantia_vencida(crear_activo):
    activo = crear_activo(timezone.localdate() - timedelta(days=1))

    assert activo.estado_garantia == Activo.Garantia.VENCIDA
    assert activo.dias_para_fin_de_garantia == -1


def test_una_fecha_lejana_deja_la_garantia_vigente(crear_activo):
    activo = crear_activo(timezone.localdate() + timedelta(days=DIAS_AVISO_GARANTIA + 1))

    assert activo.estado_garantia == Activo.Garantia.VIGENTE


def test_dentro_de_la_ventana_de_aviso_la_garantia_esta_por_vencer(crear_activo):
    activo = crear_activo(timezone.localdate() + timedelta(days=DIAS_AVISO_GARANTIA - 1))

    assert activo.estado_garantia == Activo.Garantia.POR_VENCER


@pytest.mark.parametrize(
    ("dias", "esperado"),
    [
        (0, Activo.Garantia.POR_VENCER),
        (DIAS_AVISO_GARANTIA, Activo.Garantia.POR_VENCER),
        (DIAS_AVISO_GARANTIA + 1, Activo.Garantia.VIGENTE),
    ],
)
def test_los_bordes_de_la_ventana_de_aviso(crear_activo, dias, esperado):
    """El día del vencimiento todavía hay cobertura, y el último día de la
    ventana de aviso sigue avisando: los bordes son justo donde un error de
    un día haría que el aviso llegara tarde."""
    activo = crear_activo(timezone.localdate() + timedelta(days=dias))

    assert activo.estado_garantia == esperado


# --- Filtro del listado ----------------------------------------------------


@pytest.fixture
def parque(crear_activo):
    hoy = timezone.localdate()
    return {
        "vencida": crear_activo(hoy - timedelta(days=5)),
        "por_vencer": crear_activo(hoy + timedelta(days=10)),
        "vigente": crear_activo(hoy + timedelta(days=400)),
        "sin_registrar": crear_activo(None),
    }


@pytest.mark.parametrize("situacion", ["vencida", "por_vencer", "vigente", "sin_registrar"])
def test_el_listado_filtra_por_situacion_de_garantia(cliente, parque, situacion):
    respuesta = cliente.get("/api/v1/activos/", {"garantia": situacion})

    codigos = [fila["codigo_barras"] for fila in respuesta.json()["results"]]
    assert codigos == [parque[situacion].codigo_barras]


def test_un_valor_de_garantia_desconocido_no_filtra_nada(cliente, parque):
    """Se ignora en vez de devolver una lista vacía: un parámetro mal escrito
    en un enlace no debe hacer creer que el inventario está vacío."""
    respuesta = cliente.get("/api/v1/activos/", {"garantia": "cualquier-cosa"})

    assert respuesta.json()["count"] == len(parque)


def test_el_filtro_se_resuelve_en_la_base_de_datos(parque):
    """El documento funcional dimensiona entre 5.000 y 10.000 activos: filtrar
    evaluando la propiedad del modelo en Python traería el inventario completo
    a memoria en cada consulta del listado."""
    from apps.activos.views import ActivoViewSet

    queryset = ActivoViewSet._filtrar_por_garantia(Activo.objects.all(), "vencida")

    assert "fecha_fin_garantia" in str(queryset.query)
    assert list(queryset) == [parque["vencida"]]


# --- La ficha lo expone ----------------------------------------------------


def test_la_ficha_expone_el_estado_y_los_dias_restantes(cliente, crear_activo):
    activo = crear_activo(timezone.localdate() + timedelta(days=10))

    ficha = cliente.get(f"/api/v1/activos/{activo.id}/").json()

    assert ficha["estado_garantia"] == "por_vencer"
    assert ficha["estado_garantia_display"] == "Garantía por vencer"
    assert ficha["dias_para_fin_de_garantia"] == 10


def test_el_proveedor_y_la_garantia_se_guardan_desde_la_api(cliente, crear_activo):
    from apps.organizacion.models import Proveedor

    proveedor = Proveedor.objects.create(nombre="Tecnomega")
    activo = crear_activo(None)

    respuesta = cliente.patch(
        f"/api/v1/activos/{activo.id}/",
        {"proveedor": proveedor.id, "fecha_fin_garantia": "2027-05-30"},
        format="json",
    )

    assert respuesta.status_code == 200
    assert respuesta.data["proveedor_nombre"] == "Tecnomega"
    activo.refresh_from_db()
    assert activo.proveedor_id == proveedor.id
    assert activo.fecha_fin_garantia == datetime.date(2027, 5, 30)


def test_no_se_le_compra_a_un_proveedor_dado_de_baja(cliente, crear_activo):
    """Uno dado de baja ya no vende ni atiende un reclamo: registrarle una
    compra nueva no significa nada."""
    from apps.organizacion.models import Proveedor

    proveedor = Proveedor.objects.create(nombre="Cerrado S.A.", activo=False)
    activo = crear_activo(None)

    respuesta = cliente.patch(
        f"/api/v1/activos/{activo.id}/", {"proveedor": proveedor.id}, format="json"
    )

    assert respuesta.status_code == 400
    assert "proveedor" in respuesta.data["error"]["details"]
