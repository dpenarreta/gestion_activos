"""Las características que describe cada tipo de equipo.

Cobertura de tests/qa/features/ficha-completa-activo.feature (AC-CAR-001 a
AC-CAR-012).

Las especificaciones eran pares clave/valor libres. La libertad tenía un precio:
«RAM», «Ram» y «Memoria RAM» convivían en equipos del mismo modelo, y nadie
recordaba qué había que llenar para una cámara. Ahora cada tipo declara lo suyo
y el formulario ofrece eso y no otra cosa.
"""

import datetime

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.models_caracteristicas import CaracteristicaTipo
from apps.organizacion.models import Departamento
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

RUTA = "/api/v1/activos/caracteristicas/"
ACTIVOS = "/api/v1/activos/"


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_carac", email="admin_carac@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    api = APIClient()
    api.force_authenticate(user=admin)
    return api


@pytest.fixture
def laptop(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def camara(db):
    return TipoDispositivo.objects.create(nombre="Cámara", codigo="CAM")


@pytest.fixture
def area(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


def _alta(tipo, area, especificaciones, **extra):
    datos = {
        "tipo": tipo.id,
        "nombre": "Equipo de prueba",
        "marca": "Dell",
        "modelo": "Latitude",
        "numero_serie": extra.pop("numero_serie", "SN-CARAC-1"),
        "departamento": area.id,
        "fecha_adquisicion": "2025-01-10",
        "especificaciones": especificaciones,
    }
    datos.update(extra)
    return datos


# --- Declarar las características -------------------------------------------


def test_cada_tipo_declara_las_suyas(cliente, laptop, camara):
    """Es el punto de la funcionalidad: una laptop y una cámara no se describen igual."""
    cliente.post(
        RUTA, {"tipo": laptop.id, "nombre": "RAM", "dato": "entero", "unidad": "GB"}, format="json"
    )
    cliente.post(RUTA, {"tipo": camara.id, "nombre": "Resolución", "dato": "texto"}, format="json")

    de_la_laptop = cliente.get(RUTA, {"tipo": laptop.id}).data
    de_la_camara = cliente.get(RUTA, {"tipo": camara.id}).data

    assert [c["nombre"] for c in de_la_laptop["results"]] == ["RAM"]
    assert [c["nombre"] for c in de_la_camara["results"]] == ["Resolución"]


def test_no_se_repite_una_caracteristica_dentro_del_mismo_tipo(cliente, laptop):
    """Dos con el mismo nombre guardarían su valor en el mismo sitio."""
    cliente.post(RUTA, {"tipo": laptop.id, "nombre": "RAM"}, format="json")

    respuesta = cliente.post(RUTA, {"tipo": laptop.id, "nombre": "ram"}, format="json")

    assert respuesta.status_code == 400
    assert "RAM" in str(respuesta.data)
    assert CaracteristicaTipo.objects.filter(tipo=laptop).count() == 1


def test_el_mismo_nombre_si_vale_en_dos_tipos(cliente, laptop, camara):
    cliente.post(RUTA, {"tipo": laptop.id, "nombre": "Marca del sensor"}, format="json")

    respuesta = cliente.post(RUTA, {"tipo": camara.id, "nombre": "Marca del sensor"}, format="json")

    assert respuesta.status_code == 201


def test_una_lista_de_opciones_necesita_opciones(cliente, laptop):
    respuesta = cliente.post(
        RUTA, {"tipo": laptop.id, "nombre": "Sistema", "dato": "lista"}, format="json"
    )

    assert respuesta.status_code == 400
    assert "opción" in str(respuesta.data).lower()


def test_las_opciones_se_limpian_al_guardarlas(cliente, laptop):
    """Se escriben una por línea: sin limpiar, «Windows 11 » sería otra opción."""
    respuesta = cliente.post(
        RUTA,
        {
            "tipo": laptop.id,
            "nombre": "Sistema",
            "dato": "lista",
            "opciones": ["Windows 11", " Windows 11 ", "Ubuntu 22.04", ""],
        },
        format="json",
    )

    assert respuesta.data["opciones"] == ["Windows 11", "Ubuntu 22.04"]


def test_renombrarla_arrastra_lo_ya_guardado(cliente, laptop, area):
    """Corregir una errata no puede hacer perder el inventario de esa característica."""
    caracteristica = CaracteristicaTipo.objects.create(tipo=laptop, nombre="Ram")
    activo = Activo.objects.create(
        tipo=laptop,
        nombre="Laptop 1",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-REN-1",
        codigo_barras="GA-LAP-REN1",
        departamento=area,
        fecha_adquisicion=datetime.date(2025, 1, 10),
        especificaciones={"Ram": "16"},
    )

    cliente.patch(f"{RUTA}{caracteristica.id}/", {"nombre": "RAM"}, format="json")

    activo.refresh_from_db()
    assert activo.especificaciones == {"RAM": "16"}


# --- El alta del equipo se valida contra ellas -------------------------------


def test_un_tipo_sin_caracteristicas_admite_pares_libres(cliente, laptop, area):
    """La mitad del inventario se cargó cuando esto no existía."""
    respuesta = cliente.post(
        ACTIVOS, _alta(laptop, area, {"Lo que sea": "un valor"}), format="json"
    )

    assert respuesta.status_code == 201
    assert respuesta.data["especificaciones"] == {"Lo que sea": "un valor"}


def test_lo_que_el_tipo_no_describe_se_rechaza(cliente, laptop, area):
    """Es lo que impide que vuelvan «RAM», «Ram» y «Memoria RAM»."""
    CaracteristicaTipo.objects.create(tipo=laptop, nombre="RAM", dato="entero")

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {"Memoria RAM": "16"}), format="json")

    assert respuesta.status_code == 400
    assert "no describe" in str(respuesta.data)
    assert not Activo.objects.filter(numero_serie="SN-CARAC-1").exists()


def test_la_caracteristica_obligatoria_se_exige(cliente, laptop, area):
    CaracteristicaTipo.objects.create(tipo=laptop, nombre="Procesador", obligatoria=True)

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {}), format="json")

    assert respuesta.status_code == 400
    assert "obligatoria" in str(respuesta.data)


def test_el_valor_se_normaliza_al_tipo_declarado(cliente, laptop, area):
    """Un «16» de texto y un 16 numérico no se comparan entre sí."""
    CaracteristicaTipo.objects.create(tipo=laptop, nombre="RAM", dato="entero", unidad="GB")

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {"RAM": "16"}), format="json")

    assert respuesta.status_code == 201
    assert respuesta.data["especificaciones"] == {"RAM": 16}


def test_un_valor_que_no_corresponde_lo_dice_con_su_nombre(cliente, laptop, area):
    CaracteristicaTipo.objects.create(tipo=laptop, nombre="RAM", dato="entero", unidad="GB")

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {"RAM": "16 GB"}), format="json")

    assert respuesta.status_code == 400
    assert "RAM" in str(respuesta.data)
    assert "GB" in str(respuesta.data)


def test_una_lista_solo_admite_sus_opciones(cliente, laptop, area):
    CaracteristicaTipo.objects.create(
        tipo=laptop, nombre="Sistema", dato="lista", opciones=["Windows 11", "Ubuntu 22.04"]
    )

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {"Sistema": "Windows 7"}), format="json")

    assert respuesta.status_code == 400
    assert "Windows 11" in str(respuesta.data)


def test_un_valor_invalido_en_una_obligatoria_dice_qué_tiene_de_malo(cliente, laptop, area):
    """El mensaje específico no puede taparse con «es obligatoria».

    Quien escribió «Windows 7» necesita saber cuáles se admiten; decirle que el
    campo es obligatorio lo deja mirando un campo que sí llenó.
    """
    CaracteristicaTipo.objects.create(
        tipo=laptop,
        nombre="Sistema",
        dato="lista",
        opciones=["Windows 11", "Ubuntu 22.04"],
        obligatoria=True,
    )

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {"Sistema": "Windows 7"}), format="json")

    assert respuesta.status_code == 400
    detalle = str(respuesta.data)
    assert "Windows 11" in detalle
    assert "obligatoria" not in detalle


def test_el_si_o_no_acepta_como_lo_escribe_la_gente(cliente, laptop, area):
    CaracteristicaTipo.objects.create(tipo=laptop, nombre="Táctil", dato="booleano")

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {"Táctil": "Sí"}), format="json")

    assert respuesta.status_code == 201
    assert respuesta.data["especificaciones"] == {"Táctil": True}


def test_una_caracteristica_desactivada_deja_de_pedirse(cliente, laptop, area):
    CaracteristicaTipo.objects.create(
        tipo=laptop, nombre="Lector de DVD", dato="booleano", obligatoria=True, activa=False
    )

    respuesta = cliente.post(ACTIVOS, _alta(laptop, area, {}), format="json")

    assert respuesta.status_code == 201


def test_el_equipo_antiguo_conserva_lo_que_ya_tenia(cliente, laptop, area):
    """Describir un tipo por primera vez no puede dejar sus fichas sin guardar.

    Castigaría precisamente a quien cargó el inventario antes de que esto
    existiera.
    """
    activo = Activo.objects.create(
        tipo=laptop,
        nombre="Laptop vieja",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-VIEJA",
        codigo_barras="GA-LAP-VIEJA",
        departamento=area,
        fecha_adquisicion=datetime.date(2022, 1, 10),
        especificaciones={"Memoria": "8 GB", "Disco": "500 GB"},
    )
    CaracteristicaTipo.objects.create(tipo=laptop, nombre="RAM", dato="entero")

    respuesta = cliente.patch(
        f"{ACTIVOS}{activo.id}/",
        {"especificaciones": {"Memoria": "8 GB", "Disco": "500 GB", "RAM": 8}},
        format="json",
    )

    assert respuesta.status_code == 200
    assert respuesta.data["especificaciones"]["Memoria"] == "8 GB"
    assert respuesta.data["especificaciones"]["RAM"] == 8


# --- Permisos y aislamiento --------------------------------------------------


def test_describir_un_tipo_exige_editar_activos(laptop):
    usuario = User.objects.create_user(
        username="consulta", email="consulta@example.com", password="Sup3r-Secr3t!"
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.set(
        Permission.objects.filter(content_type=content_type, codename="activos.ver")
    )
    api = APIClient()
    api.force_authenticate(user=usuario)

    respuesta = api.post(RUTA, {"tipo": laptop.id, "nombre": "RAM"}, format="json")

    assert respuesta.status_code == 403


def test_las_caracteristicas_no_cruzan_empresas(cliente, laptop):
    """Cuelgan del tipo, y el tipo es de una empresa."""
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa

    CaracteristicaTipo.objects.create(tipo=laptop, nombre="RAM")
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")

    with usando_empresa(otra):
        assert not CaracteristicaTipo.objects.filter(tipo=laptop).exists()
    assert CaracteristicaTipo.objects.todas().filter(tipo=laptop).exists()
