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
    # La ficha de empleado no guarda la agencia; el cargo se elige. El
    # teléfono es opcional (26/10/2026) y no está autorizado todavía.
    assert datos["faltan"] == ["agencia", "cargo"]
    assert datos["telefono_autorizacion"]["aceptado"] is False


def test_quien_no_esta_en_nomina_completa_sus_datos_y_la_ficha_no_se_toca(db):
    from apps.empresas.contexto import empresa_actual

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        cargo = Cargo.objects.create(nombre="Asesor comercial")
    usuario, cliente = _persona(empresa)
    inicial = cliente.get(URL).json()
    assert inicial["faltan"] == ["nombres", "apellidos", "area", "agencia", "cargo"]
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
            "acepta_telefono": True,
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
        "acepta_telefono": True,
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
        "acepta_telefono": True,
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


def test_el_telefono_se_guarda_solo_con_autorizacion_y_queda_la_constancia(db):
    """Para guardar el teléfono hay que autorizar que la empresa lo guarde y que
    otras personas lo usen para contactarlo (23/10/2026). Queda cuándo, desde
    qué IP y el texto exacto aceptado; volver a guardar no la reemplaza."""
    from apps.empresas.contexto import empresa_actual
    from apps.organizacion.models import DatosDeContacto

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        cargo = Cargo.objects.create(nombre="Asesor comercial")
    usuario, cliente = _persona(empresa, first_name="Rosa", last_name="Vera")
    datos = cliente.get(URL).json()
    texto = datos["telefono_autorizacion"]["texto"]
    assert "personal o empresarial" in texto and "contactarme" in texto
    base = {
        "nombres": "Rosa",
        "apellidos": "Vera",
        "telefono": "0991112222",
        "area": area.id,
        "agencia": sede.id,
        "cargo": cargo.id,
    }
    sin = cliente.put(URL, base, format="json")
    assert sin.status_code == 400
    assert "autoriza" in str(sin.json()["error"]["details"]["acepta_telefono"])
    with usando_empresa(empresa):
        assert not DatosDeContacto.objects.filter(usuario=usuario, telefono="0991112222").exists()

    con = cliente.put(
        URL, {**base, "acepta_telefono": True}, format="json", REMOTE_ADDR="10.0.5.21"
    )
    assert con.status_code == 200, con.data
    assert con.json()["faltan"] == []
    assert con.json()["telefono_autorizacion"]["aceptado"] is True
    with usando_empresa(empresa):
        propios = DatosDeContacto.objects.get(usuario=usuario)
    assert propios.telefono_aceptado_ip == "10.0.5.21"
    assert propios.telefono_aceptado_texto == texto
    primera = propios.telefono_aceptado_en
    assert primera is not None

    # Volver a guardar conserva la constancia original.
    cliente.put(
        URL,
        {**base, "telefono": "0993334444", "acepta_telefono": True},
        format="json",
        REMOTE_ADDR="10.0.9.9",
    )
    with usando_empresa(empresa):
        propios = DatosDeContacto.objects.get(usuario=usuario)
    assert propios.telefono == "0993334444"
    assert propios.telefono_aceptado_en == primera
    assert propios.telefono_aceptado_ip == "10.0.5.21"


def test_el_telefono_es_opcional_pero_si_se_escribe_pide_autorizacion(db):
    """Sin teléfono se guarda y se puede continuar (26/10/2026); con teléfono,
    solo con la autorización. Dejarlo vacío lo borra."""
    from apps.empresas.contexto import empresa_actual
    from apps.organizacion.models import DatosDeContacto

    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        cargo = Cargo.objects.create(nombre="Asesor comercial")
    usuario, cliente = _persona(empresa, first_name="Rosa", last_name="Vera")
    base = {
        "nombres": "Rosa",
        "apellidos": "Vera",
        "area": area.id,
        "agencia": sede.id,
        "cargo": cargo.id,
    }

    sin_telefono = cliente.put(URL, {**base, "telefono": ""}, format="json")
    assert sin_telefono.status_code == 200, sin_telefono.data
    assert sin_telefono.json()["faltan"] == []
    assert cliente.put(URL, base, format="json").status_code == 200  # ni siquiera el campo

    sin_autorizar = cliente.put(URL, {**base, "telefono": "0991112222"}, format="json")
    assert sin_autorizar.status_code == 400
    assert "acepta_telefono" in sin_autorizar.json()["error"]["details"]

    con = cliente.put(
        URL, {**base, "telefono": "0991112222", "acepta_telefono": True}, format="json"
    )
    assert con.json()["telefono"] == "0991112222"
    borrado = cliente.put(URL, {**base, "telefono": ""}, format="json").json()
    assert borrado["telefono"] == "" and borrado["faltan"] == []
    with usando_empresa(empresa):
        # La constancia de la autorización se conserva aunque se borre el número.
        assert DatosDeContacto.objects.get(usuario=usuario).telefono_aceptado_en is not None
