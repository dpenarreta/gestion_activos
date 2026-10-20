"""«Mis datos»: lo que la Mesa de ayuda carga por defecto de quien pide.

Lo que se protege (20/10/2026): el nombre y el correo salen de la cuenta; el
teléfono y el área, de «Mis datos» o, si no, de la ficha de empleado; la
agencia, de «Mis datos». Guardar no toca la ficha de Talento Humano.

Desde el mismo día los siete datos son obligatorios para usar el sistema:
nombres, apellidos, correo institucional, teléfono, área, agencia y cargo.
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
    # La ficha de empleado no guarda la agencia; el cargo se elige.
    assert datos["faltan"] == ["agencia", "cargo"]


def test_quien_no_esta_en_nomina_completa_sus_datos_y_la_ficha_no_se_toca(db):
    from apps.empresas.contexto import empresa_actual

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        cargo = Cargo.objects.create(nombre="Asesor comercial")
    usuario, cliente = _persona(empresa)
    inicial = cliente.get(URL).json()
    assert inicial["faltan"] == ["nombres", "apellidos", "telefono", "area", "agencia", "cargo"]
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
            "cargo": cargo.id,
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


def test_el_cargo_se_elige_del_catalogo_y_es_obligatorio(db):
    """Sin cargo no se guarda: se elige uno del catálogo de la empresa."""
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

    assert "cargo" in datos["faltan"]
    for sin_cargo in ({**base, "cargo": ""}, base):
        assert cliente.put(URL, sin_cargo, format="json").status_code == 400

    with usando_empresa(empresa):
        analista = Cargo.objects.create(nombre="Analista de TI")
    respuesta = cliente.put(URL, {**base, "cargo": analista.id}, format="json")
    assert respuesta.json()["cargo"] == {"id": analista.id, "nombre": "Analista de TI"}
    assert respuesta.json()["cargos"] == [{"id": analista.id, "nombre": "Analista de TI"}]
    assert respuesta.json()["faltan"] == []


def test_el_correo_debe_ser_institucional_y_no_lo_cambia_la_persona(db):
    from apps.empresas.contexto import empresa_actual

    empresa = empresa_actual()
    usuario, cliente = _persona(empresa, first_name="Rosa", last_name="Vera")
    assert cliente.get(URL).json()["correo_institucional"] is True
    usuario.email = "rosa.vera@gmail.com"
    usuario.save()
    datos = cliente.get(URL).json()
    assert datos["correo_institucional"] is False
    assert "correo" in datos["faltan"]
    # Mi perfil no cambia el correo aunque se lo mande.
    cliente.put(URL, {"nombres": "Rosa", "apellidos": "Vera", "correo": "x@grupolaar.com"})
    usuario.refresh_from_db()
    assert usuario.email == "rosa.vera@gmail.com"


def test_nombres_y_apellidos_en_blanco_no_valen(db):
    from apps.empresas.contexto import empresa_actual

    empresa = empresa_actual()
    _, cliente = _persona(empresa, first_name="   ", last_name="Vera")
    assert cliente.get(URL).json()["faltan"][0] == "nombres"
    respuesta = cliente.put(
        URL, {"nombres": "   ", "apellidos": "Vera", "telefono": "0991112222"}, format="json"
    )
    assert respuesta.status_code == 400
    assert "nombres" in respuesta.json()["error"]["details"]


def test_el_cargo_lo_elige_una_sola_vez_y_despues_lo_cambia_ti(db):
    """La persona elige su cargo una vez; después solo TI o la administración
    lo cambian (Asignación de cargos). Guardar el resto con el mismo cargo
    sigue funcionando."""
    from apps.empresas.contexto import empresa_actual
    from apps.organizacion.models import DatosDeContacto

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        analista = Cargo.objects.create(nombre="Analista de TI")
        jefe = Cargo.objects.create(nombre="Jefe de TI")
    usuario, cliente = _persona(empresa, first_name="Rosa", last_name="Vera")
    base = {
        "nombres": "Rosa",
        "apellidos": "Vera",
        "telefono": "0991112222",
        "area": area.id,
        "agencia": sede.id,
    }
    assert cliente.put(URL, {**base, "cargo": analista.id}, format="json").status_code == 200

    otro = cliente.put(URL, {**base, "cargo": jefe.id}, format="json")
    assert otro.status_code == 400
    assert "TI o a la administración" in str(otro.json()["error"]["details"]["cargo"])
    with usando_empresa(empresa):
        assert DatosDeContacto.objects.get(usuario=usuario).cargo == analista

    # Con el mismo cargo puede seguir actualizando lo demás.
    mismo = cliente.put(
        URL, {**base, "telefono": "0993334444", "cargo": analista.id}, format="json"
    )
    assert mismo.status_code == 200, mismo.data
    assert mismo.json()["telefono"] == "0993334444"
