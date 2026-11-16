"""La ficha de empleado de cada persona de nómina (16/11/2026).

En producción no había ninguna: las personas llegaron como cuentas desde
nómina y «Nuevo responsable» al asignar un equipo salía vacío. Decisión del
usuario: toda persona de nómina tiene ficha, aunque su cuenta esté inactiva;
el área sale de Mi perfil o queda «Sin área asignada».
"""

import pytest

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.organizacion.fichas import (
    AREA_PENDIENTE,
    asegurar_ficha,
    sincronizar_fichas,
)
from apps.organizacion.models import DatosDeContacto, Departamento, Empleado
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def empresa():
    return Empresa.objects.order_by("id").first() or Empresa.objects.create(
        nombre="LaarCourier", codigo="LC"
    )


def _de_nomina(username, codigo, nombres="Daniel Patricio", apellidos="Peñarreta Feijoo"):
    """Como las crea la sincronización de nómina: inactiva, sin membresía y
    con el correo reservado."""
    return User.objects.create_user(
        username=username,
        email=f"{username}@sin-correo.invalid",
        password=None,
        first_name=nombres,
        last_name=apellidos,
        codigo_empleado=codigo,
        is_active=False,
    )


def test_una_persona_de_nomina_sin_perfil_queda_sin_area_asignada(empresa):
    usuario = _de_nomina("dpenarreta2", "20104758")

    resumen = sincronizar_fichas()

    ficha = Empleado.objects.todas().get(usuario=usuario)
    assert resumen["creadas"] >= 1
    assert ficha.nombre_completo == "Daniel Patricio Peñarreta Feijoo"
    assert ficha.codigo_empleado == "20104758"
    assert ficha.activo is True
    assert ficha.correo == ""  # el reservado no se copia
    assert ficha.departamento.nombre == AREA_PENDIENTE


def test_al_guardar_mi_perfil_la_ficha_pasa_a_su_area(empresa):
    usuario = _de_nomina("fmarroquin2", "20100001", "Fernanda", "Marroquín")
    sincronizar_fichas()
    with usando_empresa(empresa):
        cartera = Departamento.objects.create(nombre="Cartera", codigo="CART")
        DatosDeContacto.objects.create(usuario=usuario, departamento=cartera)

    ficha = Empleado.objects.todas().get(usuario=usuario)
    assert ficha.departamento == cartera


def test_no_pisa_un_area_real_con_sin_area(empresa):
    usuario = _de_nomina("aperez2", "20100002", "Ana", "Pérez")
    with usando_empresa(empresa):
        ti = Departamento.objects.create(nombre="TI", codigo="TI2")
        Empleado.objects.create(
            nombres="Ana", apellidos="Pérez", codigo_empleado="20100002", departamento=ti
        )

    ficha, _ = asegurar_ficha(usuario)

    assert ficha.usuario == usuario  # se enlaza a la que ya existía por código
    assert ficha.departamento == ti


def test_es_idempotente_y_omite_al_superusuario_sin_codigo(empresa):
    User.objects.create_superuser(
        username="admin_fichas", email="admin_fichas@grupolaar.com", password="Sup3r-Secr3t!"
    )
    usuario = _de_nomina("jvaca2", "20100003", "Jorge", "Vaca")
    sincronizar_fichas()

    segunda = sincronizar_fichas()

    assert segunda["creadas"] == 0
    assert Empleado.objects.todas().filter(usuario=usuario).count() == 1
    assert not Empleado.objects.todas().filter(usuario__username="admin_fichas").exists()


def test_la_cuenta_creada_en_configuracion_nace_con_su_ficha(empresa):
    """Configuración › Usuarios › Nuevo usuario: la ficha se crea en el
    momento, sin esperar a la sincronización de nómina (16/11/2026)."""
    from rest_framework.test import APIClient

    admin = User.objects.create_superuser(
        username="admin_alta", email="admin_alta@grupolaar.com", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.force_authenticate(user=admin)

    respuesta = cliente.post(
        "/api/v1/admin/users/",
        {
            "email": "nueva.persona@grupolaar.com",
            "first_name": "Nueva",
            "last_name": "Persona",
            "password": "Sup3r-Secr3t!2026",
        },
        format="json",
    )

    assert respuesta.status_code == 201, respuesta.content
    ficha = Empleado.objects.todas().get(usuario_id=respuesta.json()["id"])
    assert ficha.nombre_completo == "Nueva Persona"
    assert ficha.correo == "nueva.persona@grupolaar.com"
    assert ficha.departamento.nombre == AREA_PENDIENTE
