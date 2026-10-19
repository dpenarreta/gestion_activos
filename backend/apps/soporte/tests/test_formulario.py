"""El formulario público configurable (menú Mesa de ayuda → Formulario).

Lo que se protege: que cada empresa decida qué pregunta su formulario sin
romper lo que la cola necesita; que los campos propios se validen según su
tipo y solo cuando aplican a la categoría elegida; y que lo respondido quede
en el ticket aunque después se borre el campo.
"""

from unittest import mock

from apps.empresas.contexto import usando_empresa
from apps.soporte import services
from apps.soporte.models import CampoFormulario
from apps.soporte.tests.test_soporte import (
    SEGUIMIENTO,
    SOLICITAR,
    TICKETS,
    _equipo,
    _formulario,
    _quien_pide,
    _ticket,
    _usuario,
)

CAMPOS = "/api/v1/soporte/config/formulario/"


def _coordinador(mesa):
    return _equipo(_usuario("marco", "configurar", "formulario", empresa=mesa["empresa"]))


def _enviar(mesa, **extra):
    with mock.patch.object(services, "repartir", return_value=0):
        return _quien_pide(mesa).post(SOLICITAR, _formulario(mesa, **extra), format="json")


def _campo(cliente, clave):
    return next(c for c in cliente.get(CAMPOS).json() if c["clave"] == clave)


def test_de_entrada_el_formulario_trae_los_campos_de_siempre(mesa):
    datos = _quien_pide(mesa).get(SOLICITAR).json()
    # Los de contacto salen de «Mis datos»: el formulario pregunta el resto.
    personales = {"nombre", "telefono", "correo", "sede", "area"}
    esperados = [clave for clave in CampoFormulario.BASE if clave not in personales]
    assert [c["clave"] for c in datos["campos"]] == esperados
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

    publico = _quien_pide(mesa).get(SOLICITAR).json()["campos"]
    assert publico[-1]["categorias"] == [mesa["hardware"].id]

    # En Hardware es obligatorio y debe ser una de las opciones.
    faltante = _enviar(mesa)
    assert faltante.status_code == 400
    assert "serie_del_equipo" in faltante.json()["error"]["details"]
    assert _enviar(mesa, adicionales={"serie_del_equipo": "OTRA"}).status_code == 400

    creado = _enviar(mesa, adicionales={"serie_del_equipo": "MX20991"})
    assert creado.status_code == 201, creado.data
    token = creado.json()["id"]
    esperado = [{"clave": "serie_del_equipo", "etiqueta": "Serie del equipo", "valor": "MX20991"}]
    assert _ticket(token, mesa).datos_adicionales == esperado
    assert _quien_pide(mesa).get(f"{SEGUIMIENTO}{token}/").json()["datos_adicionales"] == esperado
    ficha = _equipo(mesa["supervisor"]).get(f"{TICKETS}{_ticket(token, mesa).id}/").json()
    assert ficha["datos_adicionales"] == esperado

    # En Accesos no aplica: no se pide.
    assert _enviar(mesa, caso=mesa["clave"].id).status_code == 201

    # Borrar el campo no le quita los datos al ticket.
    assert cliente.delete(f"{CAMPOS}{campo['id']}/").status_code == 204
    assert _ticket(token, mesa).datos_adicionales == esperado


def test_los_datos_de_contacto_salen_de_mis_datos_y_no_se_ocultan(mesa):
    cliente = _coordinador(mesa)
    for clave in ("telefono", "sede", "area"):
        campo = _campo(cliente, clave)
        assert campo["bloqueado"] is True
        respuesta = cliente.patch(f"{CAMPOS}{campo['id']}/", {"activo": False}, format="json")
        assert respuesta.json()["activo"] is True  # no se ocultan
    # Aunque alguien mande otros, valen los de «Mis datos».
    creado = _enviar(mesa, telefono="", sede=None, area=None)
    assert creado.status_code == 201, creado.data
    ticket = _ticket(creado.json()["id"], mesa)
    assert (ticket.sede_id, ticket.area_id, ticket.solicitante_telefono) == (
        mesa["sede"].id,
        mesa["area"].id,
        "099 418 2273",
    )


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
    publico = _quien_pide(mesa).get(SOLICITAR).json()["campos"]
    assert publico[0]["clave"] == "equipos_afectados"

    assert _enviar(mesa, adicionales={"equipos_afectados": "tres"}).status_code == 400
    creado = _enviar(mesa, adicionales={"equipos_afectados": "3,50"})
    assert creado.status_code == 201
    assert _ticket(creado.json()["id"], mesa).datos_adicionales[0]["valor"] == "3.5"
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
    from apps.empresas.models import MembresiaEmpresa
    from apps.soporte.tests.test_soporte import _carla

    pide = _quien_pide(mesa)
    MembresiaEmpresa.objects.create(usuario=_carla(mesa), empresa=otra)
    pide.credentials(HTTP_X_EMPRESA=str(otra.id))
    claves = [c["clave"] for c in pide.get(SOLICITAR).json()["campos"]]
    assert "serie" not in claves


def test_el_formulario_tiene_su_propio_permiso(mesa):
    """Editar el formulario es `soporte.formulario`, no configurar la mesa: quien
    solo configura no lo toca, y quien solo cuida el formulario ve las categorías
    (para decir a cuáles aplica un campo) pero no las cambia."""
    configura = _equipo(_usuario("cata", "configurar", empresa=mesa["empresa"]))
    assert configura.get(CAMPOS).status_code == 403

    formulario = _equipo(_usuario("fede", "formulario", empresa=mesa["empresa"]))
    assert formulario.get(CAMPOS).status_code == 200
    categorias = "/api/v1/soporte/config/categorias/"
    assert formulario.get(categorias).status_code == 200
    assert formulario.post(categorias, {"nombre": "Redes"}, format="json").status_code == 403
