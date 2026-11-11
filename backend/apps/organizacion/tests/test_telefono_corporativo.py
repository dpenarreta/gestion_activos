"""«Mi perfil»: el teléfono corporativo, separado del personal (10/11/2026).

Lo que se protege:

- Toda persona responde «¿Tiene teléfono o línea corporativa asignada?»: mientras no
  responda, `faltan` lo incluye y el inicio la bloquea.
- Si responde que sí, el número es obligatorio; si responde que no, se borra.
- El corporativo no es dato personal: no pide la autorización de la LOPDP y se
  muestra a las demás personas de la empresa siempre que lo tenga. El personal
  sigue igual: opcional y solo con autorización, y solo para quien responde
  que no tiene corporativo (uno u otro, 11/11/2026).
- Quien llama a `contacto.guardar` sin la respuesta conserva lo guardado.
"""

import pytest
from rest_framework.test import APIClient

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion import contacto
from apps.organizacion.models import Cargo, DatosDeContacto, Departamento, Sede
from apps.users.models import User

URL = "/api/v1/organizacion/mis-datos/"


@pytest.fixture
def perfil(db):
    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Logística", codigo="LOG")
        sede = Sede.objects.create(nombre="Agencia Cuenca", ciudad="Cuenca")
        cargo = Cargo.objects.create(nombre="Coordinador de bodega")
    usuario = User.objects.create_user(
        username="nunez",
        email="jose.nunez@grupolaar.com",
        password="Sup3r-Secr3t!",
        first_name="José",
        last_name="Núñez",
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    base = {
        "nombres": "José",
        "apellidos": "Núñez",
        "area": area.id,
        "agencia": sede.id,
        "cargo": cargo.id,
    }
    return {"empresa": empresa, "usuario": usuario, "cliente": cliente, "base": base}


def _propios(perfil):
    with usando_empresa(perfil["empresa"]):
        return DatosDeContacto.objects.get(usuario=perfil["usuario"])


def test_falta_mientras_no_responda_y_se_completa_con_si_y_numero_o_con_no(perfil):
    cliente, base = perfil["cliente"], perfil["base"]
    inicial = cliente.get(URL).json()
    assert inicial["tiene_telefono_corporativo"] is None
    assert inicial["telefono_corporativo"] == ""
    assert "telefono_corporativo" in inicial["faltan"]

    # Sin responder no se guarda: la respuesta es obligatoria.
    sin_respuesta = cliente.put(URL, base, format="json")
    assert sin_respuesta.status_code == 400
    assert sin_respuesta.json()["error"]["code"] == "invalid"
    assert "tiene_telefono_corporativo" in sin_respuesta.json()["error"]["details"]

    con_si = cliente.put(
        URL,
        {**base, "tiene_telefono_corporativo": True, "telefono_corporativo": "07 283 9900"},
        format="json",
    ).json()
    assert con_si["faltan"] == []
    assert con_si["tiene_telefono_corporativo"] is True
    assert con_si["telefono_corporativo"] == "07 283 9900"

    con_no = cliente.put(URL, {**base, "tiene_telefono_corporativo": False}, format="json")
    assert con_no.status_code == 200, con_no.data
    assert con_no.json()["faltan"] == []
    assert con_no.json()["tiene_telefono_corporativo"] is False


def test_si_tiene_y_no_escribe_el_numero_no_se_guarda(perfil):
    cliente, base = perfil["cliente"], perfil["base"]
    for vacio in ({}, {"telefono_corporativo": ""}, {"telefono_corporativo": "   "}):
        respuesta = cliente.put(
            URL, {**base, "tiene_telefono_corporativo": True, **vacio}, format="json"
        )
        assert respuesta.status_code == 400
        assert respuesta.json()["error"]["code"] == "invalid"
        detalle = respuesta.json()["error"]["details"]["telefono_corporativo"]
        assert "Escriba su teléfono corporativo." in str(detalle)
    # Ni siquiera el nombre quedó a medias: no hay «Mi perfil» guardado.
    with usando_empresa(perfil["empresa"]):
        assert not DatosDeContacto.objects.filter(usuario=perfil["usuario"]).exists()

    corto = cliente.put(
        URL,
        {**base, "tiene_telefono_corporativo": True, "telefono_corporativo": "12"},
        format="json",
    )
    assert corto.status_code == 400
    assert "telefono_corporativo" in corto.json()["error"]["details"]


def test_responder_que_no_borra_el_numero_corporativo(perfil):
    cliente, base = perfil["cliente"], perfil["base"]
    cliente.put(
        URL,
        {**base, "tiene_telefono_corporativo": True, "telefono_corporativo": "0987654321"},
        format="json",
    )
    assert _propios(perfil).telefono_corporativo == "0987654321"

    # La pantalla puede mandar el número viejo junto con el «no»: se descarta.
    respuesta = cliente.put(
        URL,
        {**base, "tiene_telefono_corporativo": False, "telefono_corporativo": "0987654321"},
        format="json",
    ).json()
    assert respuesta["telefono_corporativo"] == ""
    propios = _propios(perfil)
    assert propios.tiene_telefono_corporativo is False
    assert propios.telefono_corporativo == ""


def test_el_corporativo_no_pide_autorizacion_y_el_personal_si(perfil):
    cliente, base = perfil["cliente"], perfil["base"]
    corporativo = {
        **base,
        "tiene_telefono_corporativo": True,
        "telefono_corporativo": "02 298 7654",
    }
    sin_autorizar = cliente.put(URL, corporativo, format="json")
    assert sin_autorizar.status_code == 200, sin_autorizar.data
    propios = _propios(perfil)
    assert propios.telefono_corporativo == "02 298 7654"
    # No queda constancia de autorización: no se pidió.
    assert propios.telefono_aceptado_en is None

    # Con «no», el personal sigue pidiéndola.
    sin_corporativo = {**base, "tiene_telefono_corporativo": False}
    personal = cliente.put(URL, {**sin_corporativo, "telefono": "0991112222"}, format="json")
    assert personal.status_code == 400
    assert "acepta_telefono" in personal.json()["error"]["details"]
    autorizado = cliente.put(
        URL,
        {**sin_corporativo, "telefono": "0991112222", "acepta_telefono": True},
        format="json",
    ).json()
    assert (autorizado["telefono"], autorizado["telefono_corporativo"]) == (
        "0991112222",
        "",
    )


def test_con_corporativo_no_se_guarda_el_personal(perfil):
    """11/11/2026: uno u otro. Con «sí» solo se pide el corporativo; si llega
    un personal, no se guarda ni pide autorización."""
    cliente, base = perfil["cliente"], perfil["base"]
    respuesta = cliente.put(
        URL,
        {
            **base,
            "tiene_telefono_corporativo": True,
            "telefono_corporativo": "02 298 7654",
            "telefono": "0991112222",
        },
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    propios = _propios(perfil)
    assert (propios.telefono, propios.telefono_corporativo) == ("", "02 298 7654")
    assert propios.telefono_aceptado_en is None


def test_los_demas_ven_el_corporativo_sin_autorizacion(perfil):
    with usando_empresa(perfil["empresa"]):
        DatosDeContacto.objects.create(
            usuario=perfil["usuario"],
            telefono="0991112222",  # personal sin autorizar: no se muestra
            tiene_telefono_corporativo=True,
            telefono_corporativo="02 298 7654",
        )
        compartido = contacto.para_compartir(perfil["usuario"])
    assert compartido["telefono_corporativo"] == "02 298 7654"
    assert compartido["telefono"] == ""

    with usando_empresa(perfil["empresa"]):
        DatosDeContacto.objects.filter(usuario=perfil["usuario"]).update(
            tiene_telefono_corporativo=False, telefono_corporativo=""
        )
        assert contacto.para_compartir(perfil["usuario"])["telefono_corporativo"] == ""


def test_sin_la_respuesta_contacto_guardar_conserva_lo_guardado(perfil):
    """Otros llamadores de `contacto.guardar` no pasan la respuesta: ni se
    borra el número ni se da por respondida."""
    usuario, empresa = perfil["usuario"], perfil["empresa"]
    with usando_empresa(empresa):
        cargo = Cargo.objects.get(nombre="Coordinador de bodega")
        contacto.guardar(
            usuario,
            nombres="José",
            apellidos="Núñez",
            telefono="",
            departamento=None,
            sede=None,
            cargo=cargo,
        )
        assert _propios(perfil).tiene_telefono_corporativo is None
        contacto.guardar(
            usuario,
            nombres="José",
            apellidos="Núñez",
            telefono="",
            departamento=None,
            sede=None,
            cargo=cargo,
            tiene_telefono_corporativo=True,
            telefono_corporativo="02 298 7654",
        )
        contacto.guardar(
            usuario,
            nombres="José",
            apellidos="Núñez",
            telefono="",
            departamento=None,
            sede=None,
            cargo=cargo,
        )
    propios = _propios(perfil)
    assert (propios.tiene_telefono_corporativo, propios.telefono_corporativo) == (
        True,
        "02 298 7654",
    )


def test_las_etiquetas_distinguen_los_dos_telefonos():
    assert contacto.ETIQUETAS["telefono"] == "Teléfono personal"
    assert contacto.ETIQUETAS["telefono_corporativo"] == "¿Tiene teléfono o línea corporativa?"
    assert "telefono_corporativo" in contacto.OBLIGATORIOS
    assert "telefono" not in contacto.OBLIGATORIOS
