"""La criticidad de los tickets (21/10/2026).

Cada respuesta vale su peso (categoría 1..N, caso 1..M, impacto y urgencia
1..3); la suma ordena la cola y nunca se muestra: se ve solo el nivel, de Muy
baja a Crítica. Ver `apps/soporte/criticidad.py`.
"""

from unittest import mock

from apps.empresas.contexto import usando_empresa
from apps.soporte import services
from apps.soporte.models import CasoAyuda, Categoria
from apps.soporte.tests.test_soporte import (
    SOLICITAR,
    TICKETS,
    _equipo,
    _formulario,
    _quien_pide,
    _ticket,
    _usuario,
)

CATEGORIAS = "/api/v1/soporte/config/categorias/"
CASOS = "/api/v1/soporte/config/casos/"


def _configura(mesa):
    return _equipo(_usuario("marco", "configurar", empresa=mesa["empresa"]))


def _pedir(mesa, **extra):
    with mock.patch.object(services, "repartir", return_value=0):
        respuesta = _quien_pide(mesa).post(SOLICITAR, _formulario(mesa, **extra), format="json")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.data


def _accesos(mesa):
    with usando_empresa(mesa["empresa"]):
        return Categoria.objects.get(nombre="Accesos")


def test_la_suma_de_los_pesos_ordena_la_cola_y_solo_se_ve_el_nivel(mesa):
    config = _configura(mesa)
    # De menos a más crítica: Accesos vale 1, Hardware 2.
    respuesta = config.post(
        f"{CATEGORIAS}ponderar/",
        {"ids": [_accesos(mesa).id, mesa["hardware"].id]},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    assert {c["nombre"]: c["peso"] for c in respuesta.json()} == {"Accesos": 1, "Hardware": 2}

    leve = _pedir(mesa, caso=mesa["clave"].id, impacto="bajo", urgencia="baja")
    grave = _pedir(mesa, impacto="alto", urgencia="alta")  # Hardware · No enciende

    # Más área (una sola: 1) y nivel de quien pide (sin cargo: 1):
    # 1 + 1 + 1 + 1 + 1 + 1 = 6, el mínimo; 2 + 1 + 3 + 3 + 1 + 1 = 11, el máximo.
    assert (_ticket(leve["id"], mesa).puntaje, _ticket(grave["id"], mesa).puntaje) == (6, 11)
    cola = _equipo(mesa["supervisor"]).get(TICKETS, {"ambito": "cola"}).json()["results"]
    assert [t["id"] for t in cola] == [grave["id"], leve["id"]]  # el más crítico primero
    assert [t["criticidad_display"] for t in cola] == ["Crítica", "Muy baja"]
    assert all("puntaje" not in t for t in cola)  # el número no sale de la base


def test_reordenar_los_pesos_reordena_los_tickets_abiertos(mesa):
    config = _configura(mesa)
    ticket = _pedir(mesa, impacto="bajo", urgencia="baja")  # Hardware
    config.post(
        f"{CATEGORIAS}ponderar/", {"ids": [_accesos(mesa).id, mesa["hardware"].id]}, format="json"
    )
    assert _ticket(ticket["id"], mesa).puntaje == 2 + 1 + 1 + 1 + 2
    config.post(
        f"{CATEGORIAS}ponderar/", {"ids": [mesa["hardware"].id, _accesos(mesa).id]}, format="json"
    )
    assert _ticket(ticket["id"], mesa).puntaje == 1 + 1 + 1 + 1 + 2


def test_ponderar_exige_todos_los_elementos_una_vez(mesa):
    config = _configura(mesa)
    hardware = mesa["hardware"].id
    assert (
        config.post(f"{CATEGORIAS}ponderar/", {"ids": [hardware]}, format="json").status_code == 400
    )
    assert (
        config.post(
            f"{CATEGORIAS}ponderar/", {"ids": [hardware, hardware]}, format="json"
        ).status_code
        == 400
    )


def test_lo_nuevo_entra_con_peso_1_y_los_demas_suben(mesa):
    config = _configura(mesa)
    config.post(
        f"{CATEGORIAS}ponderar/", {"ids": [_accesos(mesa).id, mesa["hardware"].id]}, format="json"
    )
    config.post(CATEGORIAS, {"nombre": "Impresoras", "activa": True}, format="json")
    with usando_empresa(mesa["empresa"]):
        pesos = dict(Categoria.objects.values_list("nombre", "peso"))
    assert pesos == {"Impresoras": 1, "Accesos": 2, "Hardware": 3}

    config.post(
        f"{CASOS}ponderar/",
        {"categoria": mesa["hardware"].id, "ids": [mesa["no_enciende"].id]},
        format="json",
    )
    config.post(CASOS, {"categoria": mesa["hardware"].id, "nombre": "Pantalla rota"}, format="json")
    with usando_empresa(mesa["empresa"]):
        casos = dict(
            CasoAyuda.objects.filter(categoria=mesa["hardware"]).values_list("nombre", "peso")
        )
    assert casos == {"Pantalla rota": 1, "No enciende": 2}


def test_los_casos_se_ponderan_dentro_de_su_categoria(mesa):
    config = _configura(mesa)
    with usando_empresa(mesa["empresa"]):
        otro = CasoAyuda.objects.create(categoria=mesa["hardware"], nombre="Sin red")
    respuesta = config.post(
        f"{CASOS}ponderar/",
        {"categoria": mesa["hardware"].id, "ids": [mesa["no_enciende"].id, otro.id]},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    assert [(c["nombre"], c["peso"]) for c in respuesta.json()] == [
        ("No enciende", 1),
        ("Sin red", 2),
    ]


def test_quien_pide_ve_la_criticidad_pero_no_el_puntaje(mesa):
    creado = _pedir(mesa, impacto="alto", urgencia="alta")
    for url in ("/api/v1/soporte/mis-tickets/", f"/api/v1/soporte/mis-tickets/{creado['id']}/"):
        texto = str(_quien_pide(mesa).get(url).json())
        assert "criticidad_display" in texto and "puntaje" not in texto, url


CRITICIDAD = "/api/v1/soporte/config/criticidad/"


def test_cada_area_pesa_distinto_y_se_reordena(mesa):
    """Operaciones antes que Talento Humano, por ejemplo: lo decide quien
    configura la mesa."""
    from apps.organizacion.models import Departamento

    config = _configura(mesa)
    assert [a["nombre"] for a in config.get(CRITICIDAD).json()["areas"]] == ["Cobranzas"]
    with usando_empresa(mesa["empresa"]):
        operaciones = Departamento.objects.create(nombre="Operaciones", codigo="OPE")
    datos = config.get(CRITICIDAD).json()
    # Las nuevas entran con peso 1 y las demás suben.
    assert {a["nombre"]: a["peso"] for a in datos["areas"]} == {"Operaciones": 1, "Cobranzas": 2}

    ticket = _pedir(mesa)  # su área es Cobranzas (de «Mis datos»)
    antes = _ticket(ticket["id"], mesa).puntaje
    respuesta = config.post(CRITICIDAD, {"ids": [mesa["area"].id, operaciones.id]}, format="json")
    assert respuesta.status_code == 200, respuesta.data
    assert {a["nombre"]: a["peso"] for a in respuesta.json()["areas"]} == {
        "Cobranzas": 1,
        "Operaciones": 2,
    }
    assert _ticket(ticket["id"], mesa).puntaje == antes - 1  # Cobranzas bajó de 2 a 1
    assert config.post(CRITICIDAD, {"ids": [operaciones.id]}, format="json").status_code == 400


def test_el_nivel_jerarquico_de_quien_pide_suma_y_el_de_arriba_pesa_mas(mesa):
    from apps.organizacion.models import (
        Cargo,
        DatosDeContacto,
        NivelJerarquico,
        UnidadOrganizacional,
    )
    from apps.soporte.tests.test_soporte import _carla

    carla = _carla(mesa)
    with usando_empresa(mesa["empresa"]):
        gerencia = NivelJerarquico.objects.create(nombre="Gerencia", orden=0)
        NivelJerarquico.objects.create(nombre="Área", orden=1)
        NivelJerarquico.objects.create(nombre="Operativo", orden=2)
        unidad = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=gerencia)
        cargo = Cargo.objects.create(nombre="Gerente General", unidad=unidad)
        DatosDeContacto.objects.filter(usuario=carla).update(cargo=cargo)

    niveles = {n["nombre"]: n["peso"] for n in _configura(mesa).get(CRITICIDAD).json()["niveles"]}
    assert niveles == {"Gerencia": 3, "Área": 2, "Operativo": 1}

    del_gerente = _ticket(_pedir(mesa)["id"], mesa)
    assert del_gerente.nivel_solicitante == gerencia
    with usando_empresa(mesa["empresa"]):
        DatosDeContacto.objects.filter(usuario=carla).update(cargo=None)
    sin_cargo = _ticket(_pedir(mesa)["id"], mesa)
    assert del_gerente.puntaje - sin_cargo.puntaje == 3 - 1
