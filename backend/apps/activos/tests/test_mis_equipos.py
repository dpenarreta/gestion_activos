"""Pantalla «mis equipos»: el rol «Usuario final» del §13.

El documento le concede una sola cosa —«opcionalmente consulta equipos
asignados a sí mismo»— y toda la dificultad está en el «a sí mismo»: la cuenta
con la que se entra al sistema y la ficha de empleado que custodia equipos son
dos cosas distintas, porque la mayoría de quienes reciben un equipo nunca
inician sesión.
"""

import datetime

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.permissions.models import ModulePermission
from apps.users.models import User

RUTA = "/api/v1/activos/mis-equipos/"


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_mis", email="admin_mis@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Contabilidad", codigo="CTB")


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


def _usuario_final(sufijo=""):
    """Cuenta con el único permiso del rol: ver lo propio, no el inventario."""
    usuario = User.objects.create_user(
        username=f"final{sufijo}",
        email=f"final{sufijo}@example.com",
        password="Sup3r-Secr3t!",
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    grupo = Group.objects.create(name=f"Usuario final {sufijo or 'base'}")
    grupo.permissions.set(
        Permission.objects.filter(content_type=content_type, codename="activos.ver_asignados")
    )
    usuario.groups.add(grupo)
    return usuario


def _cliente(usuario):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.fixture
def crear_activo(admin, tipo, departamento):
    contador = {"n": 0}

    def _crear(**extra):
        contador["n"] += 1
        return ActivoService.crear_activo(
            actor=admin,
            tipo=tipo,
            nombre=extra.pop("nombre", f"Laptop {contador['n']}"),
            marca="Dell",
            modelo="Latitude",
            numero_serie=f"SN-MIS-{contador['n']}",
            departamento=departamento,
            fecha_adquisicion=datetime.date(2025, 1, 10),
            **extra,
        )

    return _crear


# --- Quién soy -------------------------------------------------------------


def test_devuelve_solo_los_equipos_de_quien_pregunta(admin, crear_activo, departamento):
    """Es la razón de que el permiso sea distinto de `activos.ver`."""
    usuario = _usuario_final()
    yo = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )
    otro = Empleado.objects.create(nombres="Luis", apellidos="Torres", departamento=departamento)

    mio = crear_activo(nombre="Mi laptop")
    ajeno = crear_activo(nombre="Laptop de Luis")
    crear_activo(nombre="Laptop en bodega")
    ActivoService.asignar_custodio(actor=admin, activo=mio, custodio=yo)
    ActivoService.asignar_custodio(actor=admin, activo=ajeno, custodio=otro)

    datos = _cliente(usuario).get(RUTA).data

    assert [e["nombre"] for e in datos["equipos"]] == ["Mi laptop"]
    assert datos["empleado"]["nombre"] == "Ana Pérez"


def test_una_cuenta_sin_ficha_de_empleado_lo_dice(db):
    """«No tienes equipos» y «tu cuenta no está enlazada» se arreglan de formas
    muy distintas, y la segunda necesita a un administrador."""
    datos = _cliente(_usuario_final()).get(RUTA).data

    assert datos["empleado"] is None
    assert datos["equipos"] == []
    assert "no está enlazada" in datos["aviso"]


def test_sin_equipos_no_hay_aviso(db, departamento):
    """Quien no tiene nada a su cargo ve una lista vacía, no una advertencia."""
    usuario = _usuario_final()
    Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )

    datos = _cliente(usuario).get(RUTA).data

    assert datos["equipos"] == []
    assert datos["aviso"] is None


# --- Qué se ve y qué no ----------------------------------------------------


def test_no_expone_costos_ni_proveedor_ni_el_veredicto_de_renovacion(
    admin, crear_activo, departamento
):
    """Son datos del inventario, no del equipo que uno usa. El veredicto además
    es una decisión de planificación que no se comunica por una pantalla."""
    usuario = _usuario_final()
    yo = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )
    activo = crear_activo(costo_adquisicion=1500)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=yo)

    equipo = _cliente(usuario).get(RUTA).data["equipos"][0]

    for prohibido in (
        "costo_adquisicion",
        "proveedor",
        "requiere_renovacion",
        "nivel_renovacion",
        "custodio",
        "total_mantenimientos",
    ):
        assert prohibido not in equipo


def test_dice_desde_cuando_lo_tengo_yo(admin, crear_activo, departamento):
    """Un equipo que fue, volvió y se entregó otra vez tiene varias entregas: la
    que responde «desde cuándo lo tengo» es la última a esta persona."""
    usuario = _usuario_final()
    yo = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )
    activo = crear_activo()
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=yo)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=None)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=yo)

    equipo = _cliente(usuario).get(RUTA).data["equipos"][0]
    ultima = activo.movimientos.filter(custodio_nuevo=yo).order_by("-created_at").first()

    assert equipo["desde"] is not None
    assert equipo["desde"][:19] == ultima.created_at.isoformat()[:19]


def test_un_equipo_dado_de_baja_deja_de_aparecer(admin, crear_activo, departamento):
    """Sigue en el historial, pero ya no lo tiene nadie: mostrarlo haría creer
    que hay que devolverlo."""
    usuario = _usuario_final()
    yo = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )
    activo = crear_activo()
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=yo)
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.DADO_DE_BAJA, motivo="Fin de vida"
    )

    assert _cliente(usuario).get(RUTA).data["equipos"] == []


# --- El permiso ------------------------------------------------------------


def test_el_usuario_final_no_puede_ver_el_inventario(db):
    """Es la frontera del rol: su permiso no le abre el parque."""
    cliente = _cliente(_usuario_final())

    assert cliente.get("/api/v1/activos/").status_code == 403


def test_sin_el_permiso_no_se_ve_ni_lo_propio(db):
    usuario = User.objects.create_user(
        username="pelado", email="pelado@example.com", password="Sup3r-Secr3t!"
    )

    assert _cliente(usuario).get(RUTA).status_code == 403
