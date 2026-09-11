"""Varios responsables sobre un mismo equipo (RF-01).

Un escáner de andén o una impresora de mostrador los usa —y responde por
ellos— el turno entero, y **ninguno responde más que otro**: no hay un titular
con acompañantes. Eso obliga a tres cosas que estas pruebas fijan: que la lista
sea la lista, que cada quien firme su propia acta, y que el equipo aparezca
bajo cada uno de ellos allí donde el sistema pregunta «¿qué tiene esta
persona?».

Y una cuarta, que es la que evita el desastre: varios solo caben en un equipo
**marcado como compartido**. Repartir la responsabilidad de una laptop personal
entre tres nombres es exactamente lo que hace que después nadie responda por
ella.
"""

import datetime

import pytest
from rest_framework.test import APIClient

from apps.activos.models import Activo, MovimientoActivo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_resp", email="admin_resp@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def area(db):
    return Departamento.objects.create(nombre="Operaciones", codigo="OPE")


@pytest.fixture
def turno(area):
    """Tres personas del mismo turno, en orden de apellido: Andrade, Mora, Vaca."""
    return [
        Empleado.objects.create(
            nombres=nombres,
            apellidos=apellidos,
            codigo_empleado=codigo,
            departamento=area,
        )
        for nombres, apellidos, codigo in (
            ("Jorge", "Andrade", "OPE-0001"),
            ("Luis", "Mora", "OPE-0002"),
            ("Paola", "Vaca", "OPE-0003"),
        )
    ]


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Escáner", codigo="ESC")


def _crear(admin, tipo, area, *, compartido=False, responsables=(), serie="SN-RESP-1"):
    return ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Escáner de andén",
        marca="Zebra",
        modelo="DS2208",
        numero_serie=serie,
        departamento=area,
        fecha_adquisicion=datetime.date(2025, 1, 10),
        compartido=compartido,
        responsables=list(responsables),
    )


# --- La lista es la lista ---------------------------------------------------


def test_un_equipo_compartido_responde_ante_varias_personas(admin, tipo, area, turno):
    activo = _crear(admin, tipo, area, compartido=True)

    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=turno)

    assert activo.responsables.count() == 3
    assert activo.estado == Activo.Estado.EN_USO


def test_un_equipo_normal_no_reparte_la_responsabilidad(admin, tipo, area, turno):
    """Tres nombres en una laptop personal es lo que hace que después nadie
    responda por ella: la marca de compartido es una decisión, no el efecto
    lateral de sumar gente."""
    from rest_framework import serializers as drf

    activo = _crear(admin, tipo, area)

    with pytest.raises(drf.ValidationError) as error:
        ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=turno[:2])

    assert "compartido" in str(error.value)


def test_ninguno_manda_sobre_otro_y_se_leen_por_apellido(admin, tipo, area, turno):
    """No hay un titular al que mirar primero: el orden es el del apellido, para
    que la misma ficha no se lea distinta en dos pantallazos."""
    activo = _crear(admin, tipo, area, compartido=True)

    ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[turno[2], turno[0], turno[1]]
    )

    assert activo.resumen_de_responsables == "Jorge Andrade, Luis Mora, Paola Vaca"


def test_repetir_a_la_misma_persona_no_la_cuenta_dos_veces(admin, tipo, area, turno):
    activo = _crear(admin, tipo, area, compartido=True)

    ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[turno[0], turno[0]]
    )

    assert activo.responsables.count() == 1


# --- Cada quien firma la suya -----------------------------------------------


def test_cada_responsable_deja_su_propio_movimiento(admin, tipo, area, turno):
    """De cada movimiento sale un acta, y en un equipo compartido no hay un
    titular que pueda firmar por los demás."""
    activo = _crear(admin, tipo, area, compartido=True)

    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=turno)

    entregas = activo.movimientos.filter(tipo=MovimientoActivo.Tipo.ASIGNACION)
    assert entregas.count() == 3
    assert {m.custodio_nuevo_id for m in entregas} == {e.id for e in turno}


def test_el_relevo_de_una_persona_se_cuenta_como_un_solo_hecho(admin, tipo, area, turno):
    """«Pasó de A a B» es como se lee en el historial, y como se leía cuando el
    responsable era uno solo."""
    activo = _crear(admin, tipo, area, responsables=[turno[0]])

    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[turno[1]])

    movimiento = activo.movimientos.order_by("-created_at").first()
    assert movimiento.tipo == MovimientoActivo.Tipo.ASIGNACION
    assert movimiento.custodio_anterior_id == turno[0].id
    assert movimiento.custodio_nuevo_id == turno[1].id


def test_quitar_a_uno_deja_al_resto_respondiendo(admin, tipo, area, turno):
    activo = _crear(admin, tipo, area, compartido=True, responsables=turno)

    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=turno[:2])

    assert activo.responsables.count() == 2
    # Sigue en uso: que se vaya uno del turno no devuelve el equipo a bodega.
    assert activo.estado == Activo.Estado.EN_USO
    devolucion = activo.movimientos.filter(tipo=MovimientoActivo.Tipo.DEVOLUCION).get()
    assert devolucion.custodio_anterior_id == turno[2].id


def test_quitar_al_ultimo_devuelve_el_equipo_a_bodega(admin, tipo, area, turno):
    activo = _crear(admin, tipo, area, compartido=True, responsables=turno[:2])

    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[])

    assert activo.responsables.count() == 0
    assert activo.estado == Activo.Estado.EN_BODEGA


def test_el_alta_con_varios_ya_deja_el_acta_de_cada_uno(admin, tipo, area, turno):
    """Un equipo puede nacer compartido —se compra para el andén, no para
    alguien—, y entonces las actas son tres desde el primer día."""
    activo = _crear(admin, tipo, area, compartido=True, responsables=turno)

    altas = activo.movimientos.filter(tipo=MovimientoActivo.Tipo.ALTA)
    assert altas.count() == 3
    assert {m.custodio_nuevo_id for m in altas} == {e.id for e in turno}


def test_dar_de_baja_el_equipo_lo_quita_de_todos(admin, tipo, area, turno):
    """Mantenerlo a nombre de alguien lo haría aparecer en su lista de
    responsabilidades y en las alertas de custodia."""
    activo = _crear(admin, tipo, area, compartido=True, responsables=turno)

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Sustracción"
    )

    assert activo.responsables.count() == 0


# --- Desde la API -----------------------------------------------------------


def test_la_ficha_dice_quienes_responden(cliente, admin, tipo, area, turno):
    activo = _crear(admin, tipo, area, compartido=True, responsables=turno[:2])

    respuesta = cliente.get(f"/api/v1/activos/{activo.id}/")

    assert respuesta.status_code == 200
    assert respuesta.data["compartido"] is True
    assert respuesta.data["responsables_resumen"] == "Jorge Andrade, Luis Mora"
    assert [r["codigo_empleado"] for r in respuesta.data["responsables"]] == [
        "OPE-0001",
        "OPE-0002",
    ]


def test_buscar_por_el_nombre_de_cualquiera_lo_encuentra_una_sola_vez(
    cliente, admin, tipo, area, turno
):
    """Con varios responsables el equipo casaría una vez por cada uno y saldría
    repetido en el listado, que es un inventario que no cuadra."""
    _crear(admin, tipo, area, compartido=True, responsables=turno)

    respuesta = cliente.get("/api/v1/activos/?q=Mora")

    assert respuesta.status_code == 200
    assert respuesta.data["count"] == 1


def test_el_listado_se_filtra_por_quien_responde(cliente, admin, tipo, area, turno):
    _crear(admin, tipo, area, compartido=True, responsables=turno[:2])
    _crear(admin, tipo, area, responsables=[turno[2]], serie="SN-RESP-2")

    respuesta = cliente.get(f"/api/v1/activos/?responsable={turno[2].id}")

    assert respuesta.data["count"] == 1
    assert respuesta.data["results"][0]["numero_serie"] == "SN-RESP-2"


def test_el_enlace_viejo_por_custodio_sigue_llevando_al_mismo_sitio(
    cliente, admin, tipo, area, turno
):
    """Los enlaces de «equipos a cargo» y de las alertas ya circulan escritos
    así: romperlos dejaría pantallas que llevan a un listado sin filtrar."""
    _crear(admin, tipo, area, responsables=[turno[0]])
    _crear(admin, tipo, area, responsables=[turno[1]], serie="SN-RESP-2")

    respuesta = cliente.get(f"/api/v1/activos/?custodio={turno[0].id}")

    assert respuesta.data["count"] == 1


def test_asignar_desde_la_api_manda_la_lista_completa(cliente, admin, tipo, area, turno):
    activo = _crear(admin, tipo, area, compartido=True, responsables=[turno[0]])

    respuesta = cliente.post(
        f"/api/v1/activos/{activo.id}/asignar/",
        {"responsables": [turno[0].id, turno[1].id], "motivo": "Se suma al turno"},
        format="json",
    )

    assert respuesta.status_code == 200
    assert respuesta.data["responsables_resumen"] == "Jorge Andrade, Luis Mora"


def test_no_se_le_quita_lo_compartido_a_un_equipo_con_varios(cliente, admin, tipo, area, turno):
    """Dejaría una ficha que el propio sistema no admitiría volver a guardar."""
    activo = _crear(admin, tipo, area, compartido=True, responsables=turno)

    respuesta = cliente.patch(f"/api/v1/activos/{activo.id}/", {"compartido": False}, format="json")

    assert respuesta.status_code == 400
    assert "3 personas" in str(respuesta.data["error"]["details"]["compartido"])


def test_se_le_quita_lo_compartido_cuando_ya_queda_uno(cliente, admin, tipo, area, turno):
    activo = _crear(admin, tipo, area, compartido=True, responsables=[turno[0]])

    respuesta = cliente.patch(f"/api/v1/activos/{activo.id}/", {"compartido": False}, format="json")

    assert respuesta.status_code == 200
    activo.refresh_from_db()
    assert activo.compartido is False
