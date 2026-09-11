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
    ActivoService.asignar_responsables(actor=admin, activo=mio, responsables=[yo])
    ActivoService.asignar_responsables(actor=admin, activo=ajeno, responsables=[otro])

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
    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[yo])

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
    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[yo])
    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[])
    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[yo])

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
    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[yo])
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


# --- Una cuenta que trabaja en dos empresas ---------------------------------


def _otra_empresa():
    from apps.empresas.models import Empresa

    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


def test_la_ficha_en_otra_empresa_se_dice_en_vez_de_devolver_nada(
    admin, crear_activo, departamento
):
    """Cambiar de empresa no borra los equipos de nadie.

    La ficha de empleado pertenece a una empresa y la cuenta puede trabajar en
    varias. Mirando desde la empresa en la que esa persona no tiene ficha, una
    lista vacía se leería como «ya no tienes nada»; lo que pasa es que hay que
    cambiar de empresa, y eso lo resuelve quien mira, sin pedirle nada a un
    administrador.
    """
    from apps.empresas.contexto import usando_empresa

    usuario = _usuario_final()
    seguridad = _otra_empresa()
    with usando_empresa(seguridad):
        area = Departamento.objects.create(nombre="Operaciones", codigo="OPS")
        Empleado.objects.create(
            nombres="Ana", apellidos="Pérez", departamento=area, usuario=usuario
        )

    datos = _cliente(usuario).get(RUTA).data

    assert datos["empleado"] is None
    assert datos["equipos"] == []
    assert "LaarSeguridad" in datos["aviso"]
    # El otro aviso manda a pedir ayuda que aquí no hace falta.
    assert "no está enlazada" not in datos["aviso"]


def test_desde_su_empresa_si_ve_sus_equipos(admin, departamento):
    """El mismo caso mirado desde el lado correcto: la cuenta es la misma y lo
    único que cambia es la empresa en la que se está trabajando.

    La empresa se fija con `usando_empresa` y no con la cabecera porque el
    conftest de estas pruebas ya abre una: fijarla a mano es lo que gana, y así
    tiene que ser —la resolución desde la cabecera se prueba donde se estudia,
    en `apps/empresas`—.
    """
    from apps.empresas.contexto import usando_empresa

    usuario = _usuario_final()
    seguridad = _otra_empresa()
    with usando_empresa(seguridad):
        area = Departamento.objects.create(nombre="Operaciones", codigo="OPS")
        suyo = Empleado.objects.create(
            nombres="Ana", apellidos="Pérez", departamento=area, usuario=usuario
        )
        equipo = ActivoService.crear_activo(
            actor=admin,
            tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
            nombre="Laptop de Seguridad",
            marca="HP",
            modelo="ProBook",
            numero_serie="SN-LS-1",
            departamento=area,
            fecha_adquisicion=datetime.date(2025, 1, 10),
        )
        ActivoService.asignar_responsables(actor=admin, activo=equipo, responsables=[suyo])

        datos = _cliente(usuario).get(RUTA).data

    assert [e["nombre"] for e in datos["equipos"]] == ["Laptop de Seguridad"]
    assert datos["aviso"] is None


# --- Un equipo del que responde más de uno ---------------------------------


def test_un_equipo_compartido_aparece_en_la_lista_de_cada_uno(admin, crear_activo, departamento):
    """Del escáner del andén responde el turno entero: si solo apareciera en la
    pantalla de uno, los demás no sabrían que también responden por él."""
    usuario = _usuario_final()
    yo = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )
    companero = Empleado.objects.create(
        nombres="Luis", apellidos="Torres", departamento=departamento
    )
    equipo = crear_activo(nombre="Escáner del andén", compartido=True)
    ActivoService.asignar_responsables(actor=admin, activo=equipo, responsables=[yo, companero])

    datos = _cliente(usuario).get(RUTA).data

    assert [e["nombre"] for e in datos["equipos"]] == ["Escáner del andén"]


def test_dice_con_quien_mas_se_responde_por_el(admin, crear_activo, departamento):
    """Es lo primero que se pregunta cuando algo falla en un aparato de turno."""
    usuario = _usuario_final()
    yo = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )
    companero = Empleado.objects.create(
        nombres="Luis", apellidos="Torres", departamento=departamento
    )
    equipo = crear_activo(nombre="Escáner del andén", compartido=True)
    ActivoService.asignar_responsables(actor=admin, activo=equipo, responsables=[yo, companero])

    equipo_visto = _cliente(usuario).get(RUTA).data["equipos"][0]

    assert equipo_visto["compartido"] is True
    # Uno mismo no sale en la lista de «con quién más»: ya se sabe que es suyo.
    assert equipo_visto["con_quien_mas"] == ["Luis Torres"]


def test_en_un_equipo_propio_no_hay_nadie_mas(admin, crear_activo, departamento):
    usuario = _usuario_final()
    yo = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", departamento=departamento, usuario=usuario
    )
    equipo = crear_activo(nombre="Mi laptop")
    ActivoService.asignar_responsables(actor=admin, activo=equipo, responsables=[yo])

    equipo_visto = _cliente(usuario).get(RUTA).data["equipos"][0]

    assert equipo_visto["compartido"] is False
    assert equipo_visto["con_quien_mas"] == []
