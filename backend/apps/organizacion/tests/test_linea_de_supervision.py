"""«Mi perfil» → la línea de supervisión según el organigrama (20/10/2026).

Lo que se protege: se ven los jefes dentro del área y el jefe directo aunque
esté en otra (no más arriba), quienes comparten el cargo y los cargos que le
reportan directamente (no los de más abajo), con quien los ocupa, con cuenta o
sin ella, y sus vacantes.
"""

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion import organigrama
from apps.organizacion.models import Cargo, NivelJerarquico, OcupanteCargo, UnidadOrganizacional
from apps.organizacion.tests.test_carga_personas import _cuenta

URL = "/api/v1/organizacion/mis-datos/"


def test_jefes_del_area_companeros_y_supervisados_directos(db):
    with usando_empresa(empresa_actual()):
        nivel = NivelJerarquico.objects.create(nombre="Gerencia", orden=1)
        general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel)
        ti = UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=nivel)
        presidente = Cargo.objects.create(nombre="Presidente", unidad=general)
        gg = Cargo.objects.create(nombre="Gerente General", unidad=general, jefe=presidente)
        jefe_itd = Cargo.objects.create(nombre="Jefe ITD", unidad=ti, jefe=gg)
        jefe_ti = Cargo.objects.create(nombre="Jefe TI", unidad=ti, jefe=jefe_itd)
        coord = Cargo.objects.create(nombre="Coordinador TI", unidad=ti, jefe=jefe_ti, plazas=2)
        asistente = Cargo.objects.create(nombre="Asistente", unidad=ti, jefe=coord, plazas=3)
        OcupanteCargo.objects.create(cargo=jefe_itd, nombres="Daniel", apellidos="P")
        OcupanteCargo.objects.create(cargo=coord, nombres="Ivan", apellidos="Campos")
        OcupanteCargo.objects.create(cargo=asistente, nombres="Kevin", apellidos="N")
    usuario, cliente = _cuenta("juan")
    with usando_empresa(empresa_actual()):
        organigrama.asignar(usuario, jefe_ti)
    linea = cliente.get(URL).json()["supervision"]
    # Dentro del área hasta el gerente del área, y su jefe directo (GG); no el Presidente.
    assert [(j["nombre"], [p["nombre"] for p in j["personas"]]) for j in linea["jefes"]] == [
        ("Gerente General", []),
        ("Jefe ITD", ["Daniel P"]),
    ]
    # Solo los directos: el coordinador, no los asistentes.
    assert linea["supervisa"] == [
        {
            "id": coord.id,
            "nombre": "Coordinador TI",
            "unidad": "Tecnología",
            "personas": [
                {
                    "id": linea["supervisa"][0]["personas"][0]["id"],
                    "nombre": "Ivan Campos",
                    "sin_cuenta": True,
                }
            ],
            "vacantes": 1,
        }
    ]
    assert linea["companeros"] == []

    # Quien no tiene cargo no tiene línea de supervisión.
    _, otro = _cuenta("rosa")
    assert otro.get(URL).json()["supervision"] is None
