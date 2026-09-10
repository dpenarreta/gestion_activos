"""Que un rol valga donde se le dio y no en la empresa de al lado.

Cobertura de tests/qa/features/multiempresa.feature (AC-EMP-018 a AC-EMP-023).

Es la contrapartida del aislamiento: separar los datos no sirve de nada si
quien administra el inventario de una empresa arrastra ese poder a la otra solo
por tener acceso a ambas.
"""

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _rol(nombre, *permisos):
    grupo = Group.objects.create(name=nombre)
    content_type = ContentType.objects.get_for_model(ModulePermission)
    grupo.permissions.set(
        Permission.objects.filter(content_type=content_type, codename__in=permisos)
    )
    return grupo


def _cuenta(nombre, *permisos):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.set(
        Permission.objects.filter(content_type=content_type, codename__in=permisos)
    )
    return usuario


def _cliente(usuario, empresa=None):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    if empresa is not None:
        cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


@pytest.fixture
def courier():
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad():
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


@pytest.fixture
def jefa(courier):
    """Quien administra pertenece a la empresa que administra.

    No es un detalle del montaje: una cuenta sin ninguna empresa no ve nada —ni
    siquiera a los usuarios— desde que existe la segunda, y administrar accesos
    desde fuera de toda empresa sería exactamente lo que la separación impide.
    """
    usuario = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=courier, es_predeterminada=True)
    return usuario


def _asignar(jefa, usuario, entradas):
    return _cliente(jefa).post(
        f"/api/v1/admin/users/{usuario.id}/empresas/",
        {"empresas": entradas},
        format="json",
    )


# --- Lo que un rol alcanza --------------------------------------------------


def test_un_rol_vale_solo_en_la_empresa_donde_se_dio(courier, seguridad, jefa):
    """El caso que justifica todo: acceso a las dos, poder en una."""
    soporte = _rol("Soporte TI", "activos.ver")
    ana = _cuenta("ana")

    _asignar(
        jefa,
        ana,
        [
            {"empresa_id": courier.id, "roles": [soporte.id], "es_predeterminada": True},
            {"empresa_id": seguridad.id, "roles": []},
        ],
    )

    assert _cliente(ana, courier).get("/api/v1/activos/").status_code == 200
    # Ve la empresa —está asignada— pero no su inventario: ahí no es soporte.
    assert _cliente(ana, seguridad).get("/api/v1/activos/").status_code == 403


def test_cada_empresa_puede_tener_su_propio_rol(courier, seguridad, jefa):
    administra = _rol("Administra activos", "activos.ver", "activos.crear")
    consulta = _rol("Solo consulta", "activos.ver")
    ana = _cuenta("ana")

    _asignar(
        jefa,
        ana,
        [
            {"empresa_id": courier.id, "roles": [administra.id], "es_predeterminada": True},
            {"empresa_id": seguridad.id, "roles": [consulta.id]},
        ],
    )

    # Contra la API real: en LaarCourier el alta llega a validarse (400 por
    # cuerpo vacío, no 403), en LaarSeguridad ni siquiera se le permite.
    assert _cliente(ana, courier).post("/api/v1/activos/", {}, format="json").status_code == 400
    assert _cliente(ana, seguridad).post("/api/v1/activos/", {}, format="json").status_code == 403
    # Consultar sí puede en las dos: ambos roles incluyen `activos.ver`.
    assert _cliente(ana, seguridad).get("/api/v1/activos/").status_code == 200


def test_los_roles_globales_valen_en_todas_las_empresas(courier, seguridad, jefa):
    """El administrador del grupo tiene que poder entrar a cualquiera."""
    global_ = _rol("Auditor del grupo", "activos.ver")
    ana = _cuenta("ana")
    ana.groups.add(global_)

    _asignar(
        jefa,
        ana,
        [
            {"empresa_id": courier.id, "es_predeterminada": True},
            {"empresa_id": seguridad.id},
        ],
    )

    assert _cliente(ana, courier).get("/api/v1/activos/").status_code == 200
    assert _cliente(ana, seguridad).get("/api/v1/activos/").status_code == 200


def test_quitar_la_empresa_se_lleva_sus_roles(courier, seguridad, jefa):
    soporte = _rol("Soporte TI", "activos.ver")
    ana = _cuenta("ana")
    _asignar(
        jefa,
        ana,
        [
            {"empresa_id": courier.id, "roles": [soporte.id], "es_predeterminada": True},
            {"empresa_id": seguridad.id, "roles": [soporte.id]},
        ],
    )

    _asignar(jefa, ana, [{"empresa_id": courier.id, "roles": [soporte.id]}])

    assert not MembresiaEmpresa.objects.filter(usuario=ana, empresa=seguridad).exists()
    assert _cliente(ana, seguridad).get("/api/v1/activos/").status_code in {403, 404}


# --- La asignación ----------------------------------------------------------


def test_la_asignacion_devuelve_los_roles_de_cada_empresa(courier, seguridad, jefa):
    soporte = _rol("Soporte TI", "activos.ver")
    ana = _cuenta("ana")

    respuesta = _asignar(
        jefa,
        ana,
        [
            {"empresa_id": courier.id, "roles": [soporte.id], "es_predeterminada": True},
            {"empresa_id": seguridad.id, "roles": []},
        ],
    )

    assert respuesta.status_code == 200
    por_nombre = {fila["nombre"]: fila for fila in respuesta.data["empresas"]}
    assert [rol["name"] for rol in por_nombre["LaarCourier"]["roles"]] == ["Soporte TI"]
    assert por_nombre["LaarSeguridad"]["roles"] == []


def test_un_rol_inexistente_no_asigna_nada(courier, jefa):
    ana = _cuenta("ana")

    respuesta = _asignar(jefa, ana, [{"empresa_id": courier.id, "roles": [9999]}])

    assert respuesta.status_code == 400
    assert not MembresiaEmpresa.objects.filter(usuario=ana).exists()


def test_la_auditoria_registra_el_rol_y_la_empresa(courier, seguridad, jefa):
    """Dentro de un año hay que poder leer qué se le quitó y dónde."""
    soporte = _rol("Soporte TI", "activos.ver")
    ana = _cuenta("ana")
    _asignar(
        jefa,
        ana,
        [{"empresa_id": courier.id, "roles": [soporte.id], "es_predeterminada": True}],
    )

    _asignar(jefa, ana, [{"empresa_id": courier.id, "roles": []}])

    evento = AuditLog.objects.filter(action="user.empresas_assigned").order_by("-id").first()
    assert evento.previous_values["empresas"][0]["roles"] == ["Soporte TI"]
    assert evento.previous_values["empresas"][0]["nombre"] == "LaarCourier"
    assert evento.new_values["empresas"][0]["roles"] == []


# --- El alta deja la cuenta usable ------------------------------------------


def _crear(jefa, nombre, cuerpo):
    """El alta no recibe el nombre de usuario: sale del nombre de la persona."""
    return _cliente(jefa).post(
        "/api/v1/admin/users/",
        {
            "email": f"{nombre}@example.com",
            "password": "Sup3r-Secr3t!",
            "first_name": "Nueva",
            "last_name": nombre.capitalize(),
            **cuerpo,
        },
        format="json",
    )


def test_el_alta_deja_al_usuario_dentro_de_su_empresa_con_su_rol(courier, seguridad):
    """Una cuenta sin empresa ni rol no puede hacer nada: se crea usable."""
    jefa = _cuenta("jefa", "usuarios.ver", "usuarios.crear", "empresas.ver", "empresas.asignar")
    soporte = _rol("Soporte TI", "activos.ver")

    respuesta = _crear(
        jefa,
        "nueva",
        {
            "empresas": [
                {"empresa_id": courier.id, "roles": [soporte.id], "es_predeterminada": True}
            ]
        },
    )

    assert respuesta.status_code == 201
    creada = User.objects.get(username="nnueva")
    assert [fila["nombre"] for fila in respuesta.data["empresas"]] == ["LaarCourier"]
    assert _cliente(creada, courier).get("/api/v1/activos/").status_code == 200
    # Y solo ahí: no se le dio la otra empresa.
    assert _cliente(creada, seguridad).get("/api/v1/activos/").status_code in {403, 404}


def test_crear_usuarios_no_alcanza_para_darles_empresa(courier):
    """Dar de alta a alguien y decidir qué información ve son dos poderes."""
    jefa = _cuenta("jefa", "usuarios.ver", "usuarios.crear")

    respuesta = _crear(jefa, "nueva", {"empresas": [{"empresa_id": courier.id}]})

    assert respuesta.status_code == 403
    assert not User.objects.filter(email="nueva@example.com").exists()


def test_el_alta_sin_empresa_sigue_funcionando(courier):
    """Por API se puede crear la cuenta y repartir el acceso después."""
    jefa = _cuenta("jefa", "usuarios.ver", "usuarios.crear")

    respuesta = _crear(jefa, "nueva", {})

    assert respuesta.status_code == 201
    assert respuesta.data["empresas"] == []


def test_un_rol_inexistente_en_el_alta_no_crea_la_cuenta(courier):
    jefa = _cuenta("jefa", "usuarios.ver", "usuarios.crear", "empresas.ver", "empresas.asignar")

    respuesta = _crear(jefa, "nueva", {"empresas": [{"empresa_id": courier.id, "roles": [9999]}]})

    assert respuesta.status_code == 400
