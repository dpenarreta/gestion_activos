"""Alta de una cuenta directamente en su cargo del organigrama (09/11/2026).

Queja: «al crear un usuario, en el desplegable de Rol no veo Jefe de Cartera».
Los roles de cargo no se eligen a mano: los recibe quien ocupa el cargo. El
alta ahora crea la cuenta (con su empresa y sin rol, o con uno adicional) y en
seguida la pone en el cargo. Lo que se protege:

- Una membresía sin roles es válida: la cuenta nace sin rol manual y recibe el
  del cargo al asignárselo.
- Si en ese cargo figuraba la misma persona como «ocupante sin cuenta» (cargada
  al levantar el área desde una imagen), ese registro se borra: no quedan dos
  personas en la misma plaza. Solo con el nombre completo igual (sin tildes ni
  mayúsculas) y solo en ese cargo.
"""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.empresas.contexto import empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import Cargo, OcupanteCargo
from apps.permissions.models import ModulePermission
from apps.users.models import User

BASE = "/api/v1/organizacion/"


def _permisos(*codenames):
    return Permission.objects.filter(
        content_type=ContentType.objects.get_for_model(ModulePermission),
        codename__in=codenames,
    )


def _admin():
    usuario = User.objects.create_user(
        username="ines",
        email="ines@grupolaar.com",
        password="Sup3r-Secr3t!",
        first_name="Inés",
    )
    usuario.user_permissions.set(
        _permisos(
            "institucional.ver",
            "institucional.editar",
            "institucional.asignar",
            "usuarios.ver",
            "usuarios.crear",
            "empresas.asignar",
        )
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa_actual())
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.fixture
def cartera(db):
    """Gerencia de Cartera con su Jefe de Cartera (2 plazas) y un Analista."""
    admin = _admin()

    def crear(ruta, **datos):
        respuesta = admin.post(f"{BASE}{ruta}/", datos, format="json")
        assert respuesta.status_code == 201, respuesta.data
        return respuesta.json()

    nivel = crear("niveles", nombre="Gerencia", orden=1)
    unidad = crear("unidades", nombre="Cartera", nivel=nivel["id"])
    jefe = Cargo.objects.get(
        pk=crear("cargos", nombre="Jefe de Cartera", unidad=unidad["id"], plazas=2)["id"]
    )
    analista = Cargo.objects.get(
        pk=crear("cargos", nombre="Analista de Cartera", unidad=unidad["id"])["id"]
    )
    return {"admin": admin, "jefe": jefe, "analista": analista}


def _crear_cuenta(admin, nombres, apellidos, correo):
    """Como el alta de la pantalla: con su empresa y SIN rol manual."""
    respuesta = admin.post(
        "/api/v1/admin/users/",
        {
            "email": correo,
            "password": "Sup3r-Secr3t!",
            "first_name": nombres,
            "last_name": apellidos,
            "empresas": [
                {"empresa_id": empresa_actual().id, "roles": [], "es_predeterminada": True}
            ],
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data
    return User.objects.get(pk=respuesta.json()["id"])


def _asignar(admin, usuario, cargo):
    respuesta = admin.post(
        f"{BASE}asignaciones/",
        {"usuario": usuario.id, "cargo": cargo.id},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data


def test_la_cuenta_nace_sin_rol_y_recibe_el_del_cargo(cartera):
    sara = _crear_cuenta(cartera["admin"], "Sara", "Marroquín", "sara@grupolaar.com")
    membresia = MembresiaEmpresa.objects.get(usuario=sara, empresa=empresa_actual())
    assert list(membresia.roles.all()) == []

    _asignar(cartera["admin"], sara, cartera["jefe"])

    membresia.refresh_from_db()
    assert [rol.id for rol in membresia.roles.all()] == [cartera["jefe"].rol_id]


def test_el_ocupante_sin_cuenta_con_el_mismo_nombre_se_reemplaza(cartera):
    jefe = cartera["jefe"]
    OcupanteCargo.objects.create(cargo=jefe, nombres="Sara Fernanda", apellidos="Marroquín García")
    # Otra persona en el mismo cargo: se queda.
    OcupanteCargo.objects.create(cargo=jefe, nombres="Luis", apellidos="Paredes")

    # Escrita sin tildes, en mayúsculas y con espacios de más: es la misma.
    sara = _crear_cuenta(
        cartera["admin"], "SARA  FERNANDA", "Marroquin Garcia", "sara@grupolaar.com"
    )
    _asignar(cartera["admin"], sara, jefe)

    assert [str(o) for o in OcupanteCargo.objects.filter(cargo=jefe)] == ["Luis Paredes"]
    datos = cartera["admin"].get(f"{BASE}organigrama/").json()
    en_el_cargo = next(c for c in datos["cargos"] if c["id"] == jefe.id)
    assert sorted(o["nombre"] for o in en_el_cargo["ocupantes"]) == [
        "Luis Paredes",
        "SARA  FERNANDA Marroquin Garcia",
    ]
    assert en_el_cargo["vacantes"] == 0


def test_no_se_borra_un_homonimo_de_otro_cargo_ni_un_nombre_solo_parecido(cartera):
    jefe, analista = cartera["jefe"], cartera["analista"]
    # La misma persona escrita en OTRO cargo: no se toca, puede ser otra.
    OcupanteCargo.objects.create(
        cargo=analista, nombres="Sara Fernanda", apellidos="Marroquín García"
    )
    # Parecida pero sin el segundo apellido: no hay forma segura de saberlo.
    OcupanteCargo.objects.create(cargo=jefe, nombres="Sara Fernanda", apellidos="Marroquín")

    sara = _crear_cuenta(
        cartera["admin"], "Sara Fernanda", "Marroquín García", "sara@grupolaar.com"
    )
    _asignar(cartera["admin"], sara, jefe)

    assert OcupanteCargo.objects.filter(cargo=analista).count() == 1
    assert [str(o) for o in OcupanteCargo.objects.filter(cargo=jefe)] == ["Sara Fernanda Marroquín"]


def test_el_ocupante_borrado_queda_en_la_bitacora_del_organigrama(cartera):
    """Se puede revertir: el respaldo de la versión aún lo tiene."""
    from apps.organizacion.models import VersionOrganigrama

    jefe = cartera["jefe"]
    OcupanteCargo.objects.create(cargo=jefe, nombres="Sara", apellidos="Marroquín")

    sara = _crear_cuenta(cartera["admin"], "Sara", "Marroquín", "sara@grupolaar.com")
    _asignar(cartera["admin"], sara, jefe)

    assert not OcupanteCargo.objects.filter(cargo=jefe).exists()
    version = VersionOrganigrama.objects.order_by("-id").first()
    assert {"cargo": jefe.id, "nombres": "Sara", "apellidos": "Marroquín", "correo": ""} in (
        version.respaldo["ocupantes"]
    )
