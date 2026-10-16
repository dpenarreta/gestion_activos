"""El formulario público configurable (menú Mesa de ayuda → Formulario).

Lo que se protege: que cada empresa decida qué pregunta su formulario sin
romper lo que la cola necesita; que los campos propios se validen según su
tipo y solo cuando aplican a la categoría elegida; y que lo respondido quede
en el ticket aunque después se borre el campo.
"""

from unittest import mock

from rest_framework.test import APIClient

from apps.empresas.contexto import usando_empresa
from apps.soporte import services
from apps.soporte.models import CampoFormulario
from apps.soporte.tests.test_soporte import (
    PUBLICO,
    SEGUIMIENTO,
    TICKETS,
    _equipo,
    _formulario,
    _ticket,
    _usuario,
)

CAMPOS = "/api/v1/soporte/config/formulario/"


def _coordinador(mesa):
    return _equipo(_usuario("marco", "configurar", empresa=mesa["empresa"]))


def _enviar(mesa, **extra):
    with mock.patch.object(services, "repartir", return_value=0):
        return APIClient().post(f"{PUBLICO}LC/", _formulario(mesa, **extra), format="json")


def _campo(cliente, clave):
    return next(c for c in cliente.get(CAMPOS).json() if c["clave"] == clave)


def test_de_entrada_el_formulario_trae_los_campos_de_siempre(mesa):
    datos = APIClient().get(f"{PUBLICO}LC/").json()
    assert [c["clave"] for c in datos["campos"]] == list(CampoFormulario.BASE)
    assert all(c["obligatorio"] and c["base"] for c in datos["campos"])


def test_un_campo_propio_se_pide_solo_en_su_categoria_y_queda_en_el_ticket(mesa):
    cliente = _coordinador(mesa)
    respuesta = cliente.post(
        CAMPOS,
        {
            "etiqueta": "Serie del equipo",
            "tipo": "lista",
            "opciones": ["PF3K9ZL", " PF3K9ZL ", "MX20991", ""],
            "obligatorio": True,
            "categorias": [mesa["hardware"].id],
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data
    campo = respuesta.json()
    assert campo["clave"] == "serie_del_equipo"
    assert campo["opciones"] == ["PF3K9ZL", "MX20991"]  # limpias y sin repetir
    assert campo["categorias"] == [mesa["hardware"].id], campo

    publico = APIClient().get(f"{PUBLICO}LC/").json()["campos"]
    assert publico[-1]["categorias"] == [mesa["hardware"].id]

    # En Hardware es obligatorio y debe ser una de las opciones.
    faltante = _enviar(mesa)
    assert faltante.status_code == 400
    assert "serie_del_equipo" in faltante.json()["error"]["details"]
    assert _enviar(mesa, adicionales={"serie_del_equipo": "OTRA"}).status_code == 400

    creado = _enviar(mesa, adicionales={"serie_del_equipo": "MX20991"})
    assert creado.status_code == 201, creado.data
    token = creado.json()["token"]
    esperado = [{"clave": "serie_del_equipo", "etiqueta": "Serie del equipo", "valor": "MX20991"}]
    assert _ticket(token, mesa).datos_adicionales == esperado
    assert APIClient().get(f"{SEGUIMIENTO}{token}/").json()["datos_adicionales"] == esperado
    ficha = _equipo(mesa["supervisor"]).get(f"{TICKETS}{_ticket(token, mesa).id}/").json()
    assert ficha["datos_adicionales"] == esperado

    # En Accesos no aplica: no se pide.
    assert _enviar(mesa, caso=mesa["clave"].id).status_code == 201

    # Borrar el campo no le quita los datos al ticket.
    assert cliente.delete(f"{CAMPOS}{campo['id']}/").status_code == 204
    assert _ticket(token, mesa).datos_adicionales == esperado


def test_telefono_agencia_y_area_se_pueden_quitar(mesa):
    cliente = _coordinador(mesa)
    for clave in ("telefono", "sede", "area"):
        campo = _campo(cliente, clave)
        respuesta = cliente.patch(f"{CAMPOS}{campo['id']}/", {"activo": False}, format="json")
        assert respuesta.status_code == 200, respuesta.data
    claves = [c["clave"] for c in APIClient().get(f"{PUBLICO}LC/").json()["campos"]]
    assert {"telefono", "sede", "area"}.isdisjoint(claves)

    # Aunque alguien los mande igual, no se guardan.
    creado = _enviar(mesa, telefono="", sede=None, area=mesa["area"].id)
    assert creado.status_code == 201, creado.data
    ticket = _ticket(creado.json()["token"], mesa)
    assert (ticket.sede_id, ticket.area_id, ticket.solicitante_telefono) == (None, None, "")


def test_lo_que_la_cola_necesita_no_se_quita_ni_se_borra(mesa):
    cliente = _coordinador(mesa)
    nombre = _campo(cliente, "nombre")
    respuesta = cliente.patch(
        f"{CAMPOS}{nombre['id']}/",
        {"activo": False, "obligatorio": False, "etiqueta": "Su nombre completo", "tipo": "fecha"},
        format="json",
    )
    assert respuesta.status_code == 200
    cambiado = respuesta.json()
    assert cambiado["etiqueta"] == "Su nombre completo"  # el texto sí
    assert (cambiado["activo"], cambiado["obligatorio"], cambiado["tipo"]) == (True, True, "texto")
    assert cliente.delete(f"{CAMPOS}{nombre['id']}/").status_code == 400


def test_el_orden_y_los_tipos_se_respetan(mesa):
    cliente = _coordinador(mesa)
    equipos = cliente.post(
        CAMPOS, {"etiqueta": "Equipos afectados", "tipo": "numero"}, format="json"
    ).json()
    campos = cliente.get(CAMPOS).json()
    nuevo_orden = [equipos["id"]] + [c["id"] for c in campos if c["id"] != equipos["id"]]
    assert cliente.post(f"{CAMPOS}ordenar/", {"ids": nuevo_orden}, format="json").status_code == 200
    publico = APIClient().get(f"{PUBLICO}LC/").json()["campos"]
    assert publico[0]["clave"] == "equipos_afectados"

    assert _enviar(mesa, adicionales={"equipos_afectados": "tres"}).status_code == 400
    creado = _enviar(mesa, adicionales={"equipos_afectados": "3,50"})
    assert creado.status_code == 201
    assert _ticket(creado.json()["token"], mesa).datos_adicionales[0]["valor"] == "3.5"
    # Una lista sin opciones no se puede guardar.
    sin_opciones = cliente.post(CAMPOS, {"etiqueta": "Marca", "tipo": "lista"}, format="json")
    assert sin_opciones.status_code == 400


def test_solo_quien_configura_cambia_el_formulario(mesa):
    tecnico = _equipo(mesa["jorge"].usuario)
    assert tecnico.get(CAMPOS).status_code == 403
    assert tecnico.post(CAMPOS, {"etiqueta": "X"}, format="json").status_code == 403


def test_cada_empresa_tiene_su_formulario(mesa):
    from apps.empresas.models import Empresa

    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    _coordinador(mesa).post(CAMPOS, {"etiqueta": "Serie"}, format="json")
    with usando_empresa(otra):
        assert not CampoFormulario.objects.filter(base=False).exists()
    claves = [c["clave"] for c in APIClient().get(f"{PUBLICO}LS/").json()["campos"]]
    assert "serie" not in claves
