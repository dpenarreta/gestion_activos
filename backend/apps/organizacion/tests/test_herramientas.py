"""Mis herramientas (20/10/2026): las licencias que cada persona usa.

Lo que se protege: el catálogo lo cambia solo quien tiene
`herramientas.gestionar` (leerlo, cualquiera con sesión); cada persona declara
las suyas con su cuenta y solo del catálogo activo; quien gestiona ve quién
usa cada una; una herramienta en uso no se borra (se desactiva).
"""

from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/organizacion/"


def _catalogo(ti):
    ids = {}
    for nombre, tipo in (("Claude", "externa"), ("Gmail", "externa"), ("Zimbra", "interna")):
        respuesta = ti.post(f"{BASE}herramientas/", {"nombre": nombre, "tipo": tipo}, format="json")
        assert respuesta.status_code == 201, respuesta.data
        ids[nombre] = respuesta.json()["id"]
    return ids


def test_el_catalogo_lo_cambia_solo_quien_gestiona(db):
    _, ti = _cuenta("ti", "herramientas.gestionar")
    _, rosa = _cuenta("rosa")
    ids = _catalogo(ti)
    assert rosa.post(f"{BASE}herramientas/", {"nombre": "Asana"}, format="json").status_code == 403
    assert rosa.get(f"{BASE}herramientas/").status_code == 200
    repetida = ti.post(f"{BASE}herramientas/", {"nombre": "claude"}, format="json")
    assert repetida.status_code == 400
    assert rosa.get(f"{BASE}herramientas-uso/").status_code == 403
    assert ti.delete(f"{BASE}herramientas/{ids['Gmail']}/").status_code == 204


def test_cada_persona_declara_las_suyas_y_quien_gestiona_ve_quien_usa_cada_una(db):
    _, ti = _cuenta("ti", "herramientas.gestionar")
    ids = _catalogo(ti)
    rosa, cliente = _cuenta("rosa")
    url = f"{BASE}mis-datos/herramientas/"
    inicial = cliente.get(url).json()
    assert inicial["mias"] == []
    assert [h["nombre"] for h in inicial["catalogo"]] == ["Claude", "Gmail", "Zimbra"]

    respuesta = cliente.put(
        url,
        {
            "herramientas": [
                {"herramienta": ids["Claude"], "cuenta": "rosa@grupolaar.com"},
                {"herramienta": ids["Zimbra"], "cuenta": " rvera "},
            ]
        },
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    assert [(h["nombre"], h["tipo"], h["cuenta"]) for h in respuesta.json()["mias"]] == [
        ("Claude", "externa", "rosa@grupolaar.com"),
        ("Zimbra", "interna", "rvera"),
    ]

    uso = {h["nombre"]: h["usuarios"] for h in ti.get(f"{BASE}herramientas-uso/").json()}
    assert [(u["id"], u["cuenta"]) for u in uso["Claude"]] == [(rosa.id, "rosa@grupolaar.com")]
    assert uso["Gmail"] == []

    # En uso no se borra: se desactiva, y ya no se puede elegir.
    assert ti.delete(f"{BASE}herramientas/{ids['Zimbra']}/").status_code == 409
    ti.patch(f"{BASE}herramientas/{ids['Zimbra']}/", {"activa": False}, format="json")
    otra = cliente.put(url, {"herramientas": [{"herramienta": ids["Zimbra"]}]}, format="json")
    assert otra.status_code == 400

    # Quitar todas.
    assert cliente.put(url, {"herramientas": []}, format="json").json()["mias"] == []


def test_lo_que_pide_el_cargo_se_ve_en_mi_perfil(db):
    from apps.empresas.contexto import empresa_actual, usando_empresa
    from apps.organizacion import organigrama
    from apps.organizacion.models import Cargo, NivelJerarquico, UnidadOrganizacional

    _, ti = _cuenta("ti", "herramientas.gestionar", "institucional.perfil_cargo")
    ids = _catalogo(ti)
    with usando_empresa(empresa_actual()):
        nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
        unidad = UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=nivel)
        analista = Cargo.objects.create(nombre="Analista Programador", unidad=unidad)
    url = f"{BASE}cargos/{analista.id}/perfil/"
    _, rosa = _cuenta("rosa")
    assert rosa.put(url, {"herramientas": []}, format="json").status_code == 403
    respuesta = ti.put(url, {"herramientas": [ids["Claude"], ids["Zimbra"]]}, format="json")
    assert respuesta.status_code == 200, respuesta.data

    usuario, cliente = _cuenta("pedro")
    assert cliente.get(f"{BASE}mis-datos/herramientas/").json()["base"] == []
    with usando_empresa(empresa_actual()):
        organigrama.asignar(usuario, analista)
    datos = cliente.get(f"{BASE}mis-datos/herramientas/").json()
    assert datos["cargo"]["nombre"] == "Analista Programador"
    assert [h["nombre"] for h in datos["base"]] == ["Claude", "Zimbra"]


def test_desde_el_catalogo_se_da_y_quita_el_acceso_y_se_ve_en_mis_herramientas(db):
    _, ti = _cuenta("ti", "herramientas.gestionar")
    ids = _catalogo(ti)
    rosa, cliente_rosa = _cuenta("rosa")
    externo, _ = _cuenta("pablo", miembro=False)
    url = f"{BASE}herramientas/{ids['Claude']}/usuarios/"

    assert cliente_rosa.get(url).status_code == 403
    assert cliente_rosa.post(url, {"usuario": rosa.id}, format="json").status_code == 403
    personas = ti.get(f"{BASE}herramientas/personas/", {"q": "ros"}).json()
    assert [p["id"] for p in personas] == [rosa.id]

    dado = ti.post(url, {"usuario": rosa.id, "cuenta": "rosa@grupolaar.com"}, format="json")
    assert dado.status_code == 200, dado.data
    assert [(p["id"], p["cuenta"]) for p in dado.json()] == [(rosa.id, "rosa@grupolaar.com")]
    # Se refleja en sus «Mis herramientas».
    mias = cliente_rosa.get(f"{BASE}mis-datos/herramientas/").json()["mias"]
    assert [(h["nombre"], h["cuenta"]) for h in mias] == [("Claude", "rosa@grupolaar.com")]
    # Quien no es de la empresa, no.
    assert ti.post(url, {"usuario": externo.id}, format="json").status_code == 400

    quitado = ti.delete(f"{url}{rosa.id}/")
    assert quitado.status_code == 200 and quitado.json() == []
    assert cliente_rosa.get(f"{BASE}mis-datos/herramientas/").json()["mias"] == []


# --- El usuario en la herramienta es obligatorio; el detalle, no (26/10/2026) ----------


def test_desde_el_catalogo_sin_usuario_no_se_da_el_acceso(db):
    _, ti = _cuenta("ti", "herramientas.gestionar")
    ids = _catalogo(ti)
    rosa, cliente_rosa = _cuenta("rosa")
    url = f"{BASE}herramientas/{ids['Claude']}/usuarios/"

    for cuenta in ("", "   "):
        sin = ti.post(url, {"usuario": rosa.id, "cuenta": cuenta}, format="json")
        assert sin.status_code == 400
        assert "nombre de usuario" in str(sin.data)
    assert ti.get(url).json() == []

    dado = ti.post(
        url,
        {"usuario": rosa.id, "cuenta": "rvera", "detalle": "Licencia Pro para el área"},
        format="json",
    )
    assert dado.status_code == 200, dado.data
    assert [(p["cuenta"], p["detalle"]) for p in dado.json()] == [
        ("rvera", "Licencia Pro para el área")
    ]
    mias = cliente_rosa.get(f"{BASE}mis-datos/herramientas/").json()["mias"]
    assert [(h["cuenta"], h["detalle"]) for h in mias] == [("rvera", "Licencia Pro para el área")]
    uso = {h["nombre"]: h["usuarios"] for h in ti.get(f"{BASE}herramientas-uso/").json()}
    assert uso["Claude"][0]["detalle"] == "Licencia Pro para el área"


def test_en_mis_herramientas_cada_una_pide_su_usuario(db):
    _, ti = _cuenta("ti", "herramientas.gestionar")
    ids = _catalogo(ti)
    _, cliente = _cuenta("rosa")
    url = f"{BASE}mis-datos/herramientas/"

    sin = cliente.put(
        url,
        {
            "herramientas": [
                {"herramienta": ids["Claude"], "cuenta": "rvera"},
                {"herramienta": ids["Zimbra"], "cuenta": ""},
            ]
        },
        format="json",
    )
    assert sin.status_code == 400
    assert "Escriba su nombre de usuario en: Zimbra." in str(sin.data)
    assert cliente.get(url).json()["mias"] == []

    con = cliente.put(
        url,
        {
            "herramientas": [
                {"herramienta": ids["Claude"], "cuenta": "rvera", "detalle": ""},
                {"herramienta": ids["Zimbra"], "cuenta": "rvera", "detalle": " Correo interno "},
            ]
        },
        format="json",
    )
    assert con.status_code == 200, con.data
    assert [(h["nombre"], h["detalle"]) for h in con.json()["mias"]] == [
        ("Claude", ""),
        ("Zimbra", "Correo interno"),
    ]
