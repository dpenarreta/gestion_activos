"""«Mis datos»: lo que la Mesa de ayuda carga por defecto de quien pide.

Lo que se protege (20/10/2026): el nombre y el correo salen de la cuenta; el
teléfono y el área, de «Mis datos» o, si no, de la ficha de empleado; la
agencia, de «Mis datos». Guardar no toca la ficha de Talento Humano.
"""

from rest_framework.test import APIClient

from apps.empresas.contexto import usando_empresa
from apps.organizacion.models import Cargo, Departamento, Empleado, Sede
from apps.users.models import User

URL = "/api/v1/organizacion/mis-datos/"


def _persona(empresa, **extra):
    usuario = User.objects.create_user(
        username="rosa", email="rosa@grupolaar.com", password="Sup3r-Secr3t!", **extra
    )
    from apps.empresas.models import MembresiaEmpresa

    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return usuario, cliente


def test_la_ficha_de_empleado_da_los_valores_iniciales(db):
    from apps.empresas.contexto import empresa_actual

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Operaciones", codigo="OPE")
    usuario, cliente = _persona(empresa, first_name="Rosa", last_name="Vera")
    with usando_empresa(empresa):
        Empleado.objects.create(
            nombres="Rosa",
            apellidos="Vera",
            codigo_empleado="E1",
            departamento=area,
            telefono="0991112222",
            usuario=usuario,
        )
    datos = cliente.get(URL).json()
    assert datos["nombre"] == "Rosa Vera"
    assert datos["correo"] == "rosa@grupolaar.com"
    assert datos["telefono"] == "0991112222"
    assert datos["area"]["nombre"] == "Operaciones"
    assert datos["en_nomina"] is True
    assert datos["faltan"] == ["agencia"]  # la ficha de empleado no la guarda


def test_quien_no_esta_en_nomina_completa_sus_datos_y_la_ficha_no_se_toca(db):
    from apps.empresas.contexto import empresa_actual

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
    usuario, cliente = _persona(empresa)
    inicial = cliente.get(URL).json()
    assert set(inicial["faltan"]) == {"nombre", "telefono", "area", "agencia"}
    assert [a["nombre"] for a in inicial["areas"]] == ["Comercial"]

    malo = cliente.put(
        URL,
        {
            "nombres": "Rosa",
            "apellidos": "Vera",
            "telefono": "12",
            "area": area.id,
            "agencia": sede.id,
        },
        format="json",
    )
    assert malo.status_code == 400
    bueno = cliente.put(
        URL,
        {
            "nombres": "Rosa",
            "apellidos": "Vera",
            "telefono": "0991112222",
            "area": area.id,
            "agencia": sede.id,
        },
        format="json",
    )
    assert bueno.status_code == 200, bueno.data
    assert bueno.json()["faltan"] == []
    usuario.refresh_from_db()
    assert usuario.get_full_name() == "Rosa Vera"
    assert not Empleado.objects.todas().filter(usuario=usuario).exists()


def test_sin_sesion_no_hay_mis_datos(db):
    assert APIClient().get(URL).status_code == 401


def test_el_cargo_se_elige_del_catalogo_y_no_es_obligatorio(db):
    """El catálogo de cargos empieza vacío: sin cargo se guarda igual, y cuando
    haya cargos se elige uno de la empresa."""
    from apps.empresas.contexto import empresa_actual

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
    _, cliente = _persona(empresa, first_name="Rosa", last_name="Vera")
    base = {
        "nombres": "Rosa",
        "apellidos": "Vera",
        "telefono": "0991112222",
        "area": area.id,
        "agencia": sede.id,
    }
    datos = cliente.get(URL).json()
    assert datos["cargos"] == [] and datos["cargo"] is None

    respuesta = cliente.put(URL, {**base, "cargo": ""}, format="json")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["faltan"] == []

    with usando_empresa(empresa):
        analista = Cargo.objects.create(nombre="Analista de TI")
    respuesta = cliente.put(URL, {**base, "cargo": analista.id}, format="json")
    assert respuesta.json()["cargo"] == {"id": analista.id, "nombre": "Analista de TI"}
    assert respuesta.json()["cargos"] == [{"id": analista.id, "nombre": "Analista de TI"}]
