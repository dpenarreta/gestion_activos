"""Categorías de activo: la naturaleza de lo que se inventaría.

Un nivel por encima del tipo. El tipo dice qué es —laptop, licencia de
ofimática, escritorio— y la categoría de qué clase de bien se trata, que es
como se hacen las preguntas de arriba: cuánto hay invertido en software, qué
parte del parque es mobiliario.
"""

import datetime

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import Activo, CategoriaActivo, TipoDispositivo
from apps.empresas.models import Empresa
from apps.organizacion.models import Departamento
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

RUTA = "/api/v1/activos/categorias/"


def _con_permisos(username, *codenames):
    usuario = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=codenames,
        )
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.fixture
def empresa():
    return Empresa.objects.first() or Empresa.objects.create(nombre="Laar", codigo="LAAR")


@pytest.fixture
def editor():
    return _con_permisos("editor_categorias", "activos.ver", "activos.editar")


@pytest.fixture
def consulta():
    return _con_permisos("consulta_categorias", "activos.ver")


def test_las_tres_categorias_vienen_sembradas(editor, empresa):
    """Empezar con la lista vacía obligaría a inventárselas antes de dar de
    alta el primer tipo. Son una plantilla: se renombran y se desactivan."""
    respuesta = editor.get(RUTA)

    assert respuesta.status_code == 200
    nombres = {fila["nombre"] for fila in respuesta.data["results"]}
    assert {"Hardware", "Software", "Mobiliario e inmuebles"} <= nombres


def test_lo_que_ya_estaba_quedo_en_hardware(editor):
    """El parque existente es equipamiento informático: dejarlo sin categoría
    obligaría a repasar los tipos uno a uno para poder usar el filtro."""
    sin_categoria = TipoDispositivo.objects.filter(categoria__isnull=True).count()

    assert sin_categoria == 0


def test_se_crea_una_categoria_propia(editor):
    """«Personalizable» es esto: lo que cada empresa inventaría no cabe en una
    lista cerrada."""
    respuesta = editor.post(
        RUTA,
        {"nombre": "Vehículos", "descripcion": "Flota propia", "icono": "truck"},
        format="json",
    )

    assert respuesta.status_code == 201
    assert CategoriaActivo.objects.filter(nombre="Vehículos").exists()


def test_no_se_repite_el_nombre_aunque_cambie_la_caja(editor):
    """La restricción de la base sí distingue mayúsculas, así que «Software» y
    «software» quedarían como dos entradas indistinguibles en el desplegable."""
    respuesta = editor.post(RUTA, {"nombre": "software"}, format="json")

    assert respuesta.status_code == 400
    assert "Software" in str(respuesta.data)


def test_sin_nombre_no_hay_categoria(editor):
    respuesta = editor.post(RUTA, {"nombre": "   "}, format="json")

    assert respuesta.status_code == 400


def test_quien_solo_consulta_no_crea(consulta):
    respuesta = consulta.post(RUTA, {"nombre": "Herramienta"}, format="json")

    assert respuesta.status_code == 403


def test_pero_sí_la_ve(consulta):
    """El desplegable del alta de un tipo lo necesita, y quien registra equipos
    no tiene por qué poder administrar el catálogo."""
    assert consulta.get(RUTA).status_code == 200


def test_no_se_borra_una_categoria(editor):
    """Los tipos la referencian con PROTECT: se desactiva, y entonces deja de
    ofrecerse sin tocar lo que ya la tiene."""
    categoria = CategoriaActivo.objects.get(nombre="Hardware")

    respuesta = editor.delete(f"{RUTA}{categoria.id}/")

    assert respuesta.status_code == 405


def test_desactivarla_la_saca_del_desplegable(editor):
    categoria = CategoriaActivo.objects.get(nombre="Software")

    editor.patch(f"{RUTA}{categoria.id}/", {"activa": False}, format="json")
    activas = editor.get(RUTA, {"activa": "true"}).data["results"]

    assert "Software" not in {fila["nombre"] for fila in activas}
    assert CategoriaActivo.objects.filter(nombre="Software").exists()


def test_dice_cuantos_tipos_cuelgan_de_cada_una(editor):
    """Es lo que permite saber si se puede desactivar sin dejar tipos sin
    clasificar."""
    categoria = CategoriaActivo.objects.filter(nombre="Hardware").first()
    TipoDispositivo.objects.create(
        empresa=categoria.empresa, nombre="Tablet", codigo="TAB", categoria=categoria
    )

    respuesta = editor.get(RUTA)

    por_nombre = {fila["nombre"]: fila for fila in respuesta.data["results"]}
    assert por_nombre["Hardware"]["total_tipos"] >= 1
    assert por_nombre["Mobiliario e inmuebles"]["total_tipos"] == 0


# --- Lo que la categoría permite preguntar ------------------------------------


@pytest.fixture
def parque(empresa):
    software = CategoriaActivo.objects.get(nombre="Software", empresa=empresa)
    tipo_licencia = TipoDispositivo.objects.create(
        empresa=empresa, nombre="Licencia ofimática", codigo="LIC", categoria=software
    )
    departamento = Departamento.objects.filter(empresa=empresa).first() or (
        Departamento.objects.create(empresa=empresa, nombre="TI")
    )
    Activo.objects.create(
        empresa=empresa,
        nombre="Office 365 — Contabilidad",
        tipo=tipo_licencia,
        departamento=departamento,
        codigo_barras="GA-LIC-900001",
        fecha_adquisicion=datetime.date(2026, 1, 15),
    )
    return tipo_licencia


def test_el_inventario_se_filtra_por_categoria(editor, parque):
    """Preguntar «cuánto software hay» sin tener que conocer los tipos que
    cuelgan de esa categoría."""
    software = CategoriaActivo.objects.get(nombre="Software")

    respuesta = editor.get("/api/v1/activos/", {"categoria": software.id})

    assert respuesta.status_code == 200
    nombres = {fila["nombre"] for fila in respuesta.data["results"]}
    assert "Office 365 — Contabilidad" in nombres
    assert all(fila["categoria_nombre"] == "Software" for fila in respuesta.data["results"])


def test_el_listado_dice_la_categoria_de_cada_equipo(editor, parque):
    respuesta = editor.get("/api/v1/activos/")

    por_nombre = {fila["nombre"]: fila for fila in respuesta.data["results"]}
    assert por_nombre["Office 365 — Contabilidad"]["categoria_nombre"] == "Software"


def test_un_tipo_se_mueve_de_categoria(editor, parque):
    """Clasificar mal no es un callejón sin salida: se corrige en la ficha del
    tipo y arrastra a todos sus equipos."""
    hardware = CategoriaActivo.objects.get(nombre="Hardware")

    respuesta = editor.patch(
        f"/api/v1/activos/tipos/{parque.id}/",
        {"categoria": hardware.id},
        format="json",
    )

    assert respuesta.status_code == 200
    assert respuesta.data["categoria_nombre"] == "Hardware"
