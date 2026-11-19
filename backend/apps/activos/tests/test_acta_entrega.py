"""Acta de recepción de equipo AEE-LC-01 en Word y PDF (16/11/2026).

Lo que fija: que el acta junte lo entregado a una persona el mismo día, que
guarde la prueba de funcionalidad que marca el técnico, que no deje mezclar
personas ni repetir un equipo en dos actas, que el Word y el PDF salgan con
los datos de la entrega, y que todo pida `activos.acta_entrega`.
"""

import datetime
from io import BytesIO

import pytest
from django.contrib.auth.models import Permission
from rest_framework.test import APIClient

from apps.activos.models import ActaEntrega, MovimientoActivo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User

URL = "/api/v1/activos/actas-entrega/"


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="tecnico_acta",
        email="tecnico_acta@example.com",
        password="Sup3r-Secr3t!",
        first_name="David",
        last_name="Vargas",
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def area(db):
    return Departamento.objects.create(nombre="Marketing", codigo="MKT")


@pytest.fixture
def personas(area):
    return [
        Empleado.objects.create(
            nombres=nombres, apellidos=apellidos, codigo_empleado=codigo, departamento=area
        )
        for nombres, apellidos, codigo in (
            ("Paul", "Ortega", "MKT-0001"),
            ("Ana", "Ríos", "MKT-0002"),
        )
    ]


@pytest.fixture
def tipos(db):
    return {
        "mouse": TipoDispositivo.objects.create(nombre="Mouse", codigo="MOU"),
        "laptop": TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
    }


def _entregar(admin, tipo, area, persona, serie, marca="Genius", modelo="DX-110"):
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre=f"{tipo.nombre} {serie}",
        marca=marca,
        modelo=modelo,
        numero_serie=serie,
        departamento=area,
        fecha_adquisicion=datetime.date(2026, 1, 10),
    )
    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[persona])
    return MovimientoActivo.objects.filter(
        activo=activo, tipo=MovimientoActivo.Tipo.ASIGNACION
    ).latest("id")


def test_preparar_trae_lo_entregado_a_la_persona_ese_dia(cliente, admin, area, personas, tipos):
    paul, ana = personas
    mouse = _entregar(admin, tipos["mouse"], area, paul, "36D98679707610")
    laptop = _entregar(admin, tipos["laptop"], area, paul, "LAP-1", "Dell", "Latitude")
    _entregar(admin, tipos["mouse"], area, ana, "OTRO-1")

    respuesta = cliente.get(f"{URL}preparar/", {"movimiento": mouse.id})

    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["custodio"]["nombre"] == "Paul Ortega"
    assert [c["id"] for c in datos["candidatos"]] == [mouse.id, laptop.id]
    assert datos["acta"] is None
    assert len(datos["pruebas"]) == 9


def test_crea_el_acta_con_las_pruebas_y_genera_word_y_pdf(cliente, admin, area, personas, tipos):
    paul = personas[0]
    mouse = _entregar(admin, tipos["mouse"], area, paul, "36D98679707610")
    laptop = _entregar(admin, tipos["laptop"], area, paul, "LAP-1", "Dell", "Latitude")

    respuesta = cliente.post(
        URL,
        {
            "movimientos": [mouse.id, laptop.id],
            "pruebas": {"on_off": "ok", "mouse": "ok", "impresora": "na", "pantalla": "falla"},
            "nuevo_de_paquete": False,
            "observaciones": "SE ENTREGA CARGADOR",
        },
        format="json",
    )

    assert respuesta.status_code == 201, respuesta.content
    acta = ActaEntrega.objects.get(pk=respuesta.json()["id"])
    # «No aplica» no se guarda: queda sin marcar en el papel.
    assert acta.pruebas == {"on_off": "ok", "mouse": "ok", "pantalla": "falla"}
    assert acta.custodio == paul
    assert acta.tecnico == admin
    assert set(acta.movimientos.values_list("id", flat=True)) == {mouse.id, laptop.id}

    word = cliente.get(f"{URL}{acta.id}/documento/", {"formato": "docx"})
    assert word.status_code == 200
    assert word["Content-Type"].startswith("application/vnd.openxmlformats")
    from docx import Document

    texto = "\n".join(
        celda.text
        for tabla in Document(BytesIO(word.content)).tables
        for fila in tabla.rows
        for celda in fila.cells
    )
    for esperado in (
        "AEE-LC-01",
        "Paul Ortega",
        "David Vargas",
        "36D98679707610",
        "Genius",
        "DX-110",
        "SE ENTREGA CARGADOR",
        "☒ Ok",
        "☒ No",
        "☒ Asignado",
    ):
        assert esperado in texto, esperado

    pdf = cliente.get(f"{URL}{acta.id}/documento/", {"formato": "pdf"})
    assert pdf.status_code == 200
    assert pdf["Content-Type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")


def test_no_mezcla_personas_ni_repite_un_equipo(cliente, admin, area, personas, tipos):
    paul, ana = personas
    de_paul = _entregar(admin, tipos["mouse"], area, paul, "S-1")
    de_ana = _entregar(admin, tipos["mouse"], area, ana, "S-2")

    mezcla = cliente.post(URL, {"movimientos": [de_paul.id, de_ana.id]}, format="json")
    assert mezcla.status_code == 400
    assert "una sola persona" in str(mezcla.json())

    assert cliente.post(URL, {"movimientos": [de_paul.id]}, format="json").status_code == 201
    repetida = cliente.post(URL, {"movimientos": [de_paul.id]}, format="json")
    assert repetida.status_code == 400
    assert "ya está en el acta" in str(repetida.json())


def test_corregir_el_acta_cambia_pruebas_y_observaciones(cliente, admin, area, personas, tipos):
    mouse = _entregar(admin, tipos["mouse"], area, personas[0], "S-1")
    acta_id = cliente.post(URL, {"movimientos": [mouse.id]}, format="json").json()["id"]

    respuesta = cliente.patch(
        f"{URL}{acta_id}/",
        {"pruebas": {"mouse": "falla"}, "observaciones": "Cable dañado"},
        format="json",
    )

    assert respuesta.status_code == 200, respuesta.content
    acta = ActaEntrega.objects.get(pk=acta_id)
    assert acta.pruebas == {"mouse": "falla"}
    assert acta.observaciones == "Cable dañado"
    assert acta.movimientos.count() == 1


def test_rechaza_pruebas_desconocidas(cliente, admin, area, personas, tipos):
    mouse = _entregar(admin, tipos["mouse"], area, personas[0], "S-1")
    respuesta = cliente.post(
        URL, {"movimientos": [mouse.id], "pruebas": {"bateria": "ok"}}, format="json"
    )
    assert respuesta.status_code == 400


def test_pide_el_permiso_del_acta(admin, area, personas, tipos):
    mouse = _entregar(admin, tipos["mouse"], area, personas[0], "S-1")
    usuario = User.objects.create_user(
        username="sin_acta", email="sin_acta@example.com", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    assert cliente.get(f"{URL}preparar/", {"movimiento": mouse.id}).status_code == 403

    usuario.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="permissions", codename="activos.acta_entrega"
        )
    )
    usuario = User.objects.get(pk=usuario.pk)  # sin la caché de permisos
    cliente.force_authenticate(user=usuario)
    assert cliente.get(f"{URL}preparar/", {"movimiento": mouse.id}).status_code == 200


def test_cualquier_equipo_del_acta_trae_el_acta_original(cliente, admin, area, personas, tipos):
    """19/11/2026: consultar cualquiera de los equipos entregados trae el acta
    completa, con todos los equipos de esa entrega."""
    paul, ana = personas
    entregas = [
        _entregar(admin, tipos["mouse"], area, paul, "S-1"),
        _entregar(admin, tipos["laptop"], area, paul, "LAP-1", "Dell", "Latitude"),
        _entregar(admin, tipos["mouse"], area, paul, "S-2"),
        _entregar(admin, tipos["mouse"], area, paul, "S-3"),
    ]
    otro = _entregar(admin, tipos["mouse"], area, ana, "S-9")
    acta_id = cliente.post(URL, {"movimientos": [m.id for m in entregas]}, format="json").json()[
        "id"
    ]
    cliente.post(URL, {"movimientos": [otro.id]}, format="json")

    for movimiento in entregas:
        respuesta = cliente.get(URL, {"activo": movimiento.activo_id})
        assert respuesta.status_code == 200, respuesta.content
        actas = respuesta.json()
        assert [a["id"] for a in actas] == [acta_id]
        # En el orden de la entrega, como en el acta impresa.
        assert [m["activo"]["numero_serie"] for m in actas[0]["movimientos"]] == [
            "S-1",
            "LAP-1",
            "S-2",
            "S-3",
        ]
        assert sorted(m["activo"]["numero_serie"] for m in actas[0]["movimientos"]) == [
            "LAP-1",
            "S-1",
            "S-2",
            "S-3",
        ]

    sin_acta = _entregar(admin, tipos["mouse"], area, ana, "S-10")
    assert cliente.get(URL, {"activo": sin_acta.activo_id}).json() == []
    assert cliente.get(URL).status_code == 400
    assert cliente.get(URL, {"activo": "x"}).status_code == 400
    assert cliente.get(URL, {"activo": 999999}).status_code == 404


def _en_bodega(admin, tipo, area, serie, marca="Logitech", modelo="K120"):
    return ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre=f"{tipo.nombre} {serie}",
        marca=marca,
        modelo=modelo,
        numero_serie=serie,
        departamento=area,
        fecha_adquisicion=datetime.date(2026, 1, 10),
    )


def test_asignar_a_una_persona_dice_desde_que_movimiento_se_abre_el_acta(
    cliente, admin, area, personas, tipos
):
    """19/11/2026: la asignación es el desencadenante del acta."""
    activo = _en_bodega(admin, tipos["laptop"], area, "LAP-9")
    respuesta = cliente.post(
        f"/api/v1/activos/{activo.id}/asignar/",
        {"responsables": [personas[0].id]},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.content
    movimiento = MovimientoActivo.objects.filter(activo=activo).latest("id")
    assert movimiento.tipo == MovimientoActivo.Tipo.ASIGNACION
    assert respuesta.json()["acta_entrega_movimiento"] == movimiento.id

    devolucion = cliente.post(
        f"/api/v1/activos/{activo.id}/asignar/", {"responsables": []}, format="json"
    )
    assert devolucion.json()["acta_entrega_movimiento"] is None


def test_con_el_acta_abierta_se_agregan_equipos_por_codigo(cliente, admin, area, personas, tipos):
    paul, ana = personas
    base = _entregar(admin, tipos["laptop"], area, paul, "LAP-1", "Dell", "Latitude")
    teclado = _en_bodega(admin, tipos["mouse"], area, "TEC-77")
    url = f"{URL}agregar-equipo/"

    # Por el código de la etiqueta (lo que trae el QR), sin distinguir mayúsculas.
    respuesta = cliente.post(
        url, {"movimiento": base.id, "codigo": teclado.codigo_barras.lower()}, format="json"
    )
    assert respuesta.status_code == 201, respuesta.content
    nuevo = respuesta.json()["movimiento"]
    assert nuevo["activo"]["numero_serie"] == "TEC-77"
    teclado.refresh_from_db()
    assert list(teclado.responsables.all()) == [paul]
    assert teclado.departamento_id == base.departamento_nuevo_id

    # Ya aparece entre lo entregado ese día para el acta.
    preparado = cliente.get(f"{URL}preparar/", {"movimiento": base.id}).json()
    assert nuevo["id"] in [c["id"] for c in preparado["candidatos"]]

    # Escanearlo otra vez no duplica nada.
    otra_vez = cliente.post(url, {"movimiento": base.id, "codigo": "TEC-77"}, format="json")
    assert otra_vez.status_code == 200
    assert otra_vez.json()["ya_estaba"] is True
    assert otra_vez.json()["movimiento"]["id"] == nuevo["id"]

    # Un equipo de otra persona no se le quita escaneando.
    de_ana = _entregar(admin, tipos["mouse"], area, ana, "ANA-1")
    ajeno = cliente.post(url, {"movimiento": base.id, "codigo": "ANA-1"}, format="json")
    assert ajeno.status_code == 400
    assert "Ana Ríos" in str(ajeno.json())
    assert list(de_ana.activo.responsables.all()) == [ana]

    inexistente = cliente.post(url, {"movimiento": base.id, "codigo": "NO-EXISTE"}, format="json")
    assert inexistente.status_code == 404


def test_agregar_equipos_pide_poder_asignar(admin, area, personas, tipos):
    base = _entregar(admin, tipos["laptop"], area, personas[0], "LAP-1")
    _en_bodega(admin, tipos["mouse"], area, "TEC-1")
    usuario = User.objects.create_user(
        username="solo_acta", email="solo_acta@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="permissions", codename="activos.acta_entrega"
        )
    )
    cliente = APIClient()
    cliente.force_authenticate(user=User.objects.get(pk=usuario.pk))
    respuesta = cliente.post(
        f"{URL}agregar-equipo/", {"movimiento": base.id, "codigo": "TEC-1"}, format="json"
    )
    assert respuesta.status_code == 403


def test_el_acta_lleva_items_sin_codigo_que_no_estan_en_el_inventario(
    cliente, admin, area, personas, tipos
):
    """19/11/2026: lo de rotación simple, sin código ni QR, se escribe y
    consta en el acta; no se asigna nada en el inventario."""
    laptop = _entregar(admin, tipos["laptop"], area, personas[0], "LAP-1", "Dell", "Latitude")
    respuesta = cliente.post(
        URL,
        {
            "movimientos": [laptop.id],
            "items_sin_codigo": [
                {"equipo": "  Cable HDMI ", "cantidad": 2},
                {"equipo": "Diadema de repuesto", "marca": "Genius"},
            ],
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.content
    acta = ActaEntrega.objects.get(pk=respuesta.json()["id"])
    assert acta.items_sin_codigo == [
        {"equipo": "Cable HDMI", "cantidad": 2, "marca": "", "modelo": "", "serial": ""},
        {
            "equipo": "Diadema de repuesto",
            "cantidad": 1,
            "marca": "Genius",
            "modelo": "",
            "serial": "",
        },
    ]
    assert respuesta.json()["items_sin_codigo"] == acta.items_sin_codigo

    from docx import Document

    word = cliente.get(f"{URL}{acta.id}/documento/", {"formato": "docx"})
    texto = "\n".join(
        celda.text
        for tabla in Document(BytesIO(word.content)).tables
        for fila in tabla.rows
        for celda in fila.cells
    )
    for esperado in ("Latitude", "Cable HDMI (2)", "Diadema de repuesto", "Sin código"):
        assert esperado in texto, esperado
    assert cliente.get(f"{URL}{acta.id}/documento/", {"formato": "pdf"}).status_code == 200

    # Se corrigen después, y un ítem sin descripción no se acepta.
    corregida = cliente.patch(
        f"{URL}{acta.id}/", {"items_sin_codigo": [{"equipo": "Mouse pad"}]}, format="json"
    )
    assert corregida.status_code == 200, corregida.content
    acta.refresh_from_db()
    assert [i["equipo"] for i in acta.items_sin_codigo] == ["Mouse pad"]
    vacio = cliente.patch(
        f"{URL}{acta.id}/", {"items_sin_codigo": [{"equipo": "   "}]}, format="json"
    )
    assert vacio.status_code == 400
