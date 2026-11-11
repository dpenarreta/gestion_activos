"""Los textos de tratamiento de datos personales son parametrizables (26/10/2026).

Desde US-004 (11/11/2026) se editan en Protección de datos
(`/api/v1/privacidad/textos/`, `privacidad.textos`) y sus aceptaciones van al
registro común (`AceptacionTexto`). Lo que se protege:

- Configuración → Textos legales ya no edita (CA-7): la lectura sigue igual,
  guardar responde 410 con el lugar donde se edita ahora.
- La persona acepta el texto vigente: se guarda la fecha y hora, la IP, el
  navegador, el texto exacto y su versión, en el registro común y en las
  columnas de «Mi perfil» que leen otros módulos.
- Si el texto cambia, lo vuelve a aceptar la próxima vez que guarde su teléfono
  y queda una constancia nueva; hasta entonces no figura como aceptado.
- Borrar el teléfono retira la autorización sin borrar la constancia; volver a
  escribirlo pide aceptarla otra vez.
"""

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion.models import Cargo, DatosDeContacto, Departamento, Sede
from apps.organizacion.tests.test_carga_personas import _cuenta
from apps.privacidad.models import AceptacionTexto

TEXTOS = "/api/v1/organizacion/textos-legales/"
TELEFONO = f"{TEXTOS}autorizacion_telefono/"
MIS_DATOS = "/api/v1/organizacion/mis-datos/"
EDITAR = "/api/v1/privacidad/textos/autorizacion_telefono/"
NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36"
NUEVO = "Autorizo a la empresa a guardar mi teléfono para que me contacten (versión revisada)."


def _del_telefono(usuario):
    return AceptacionTexto.objects.filter(
        usuario=usuario, texto_proteccion__clave="autorizacion_telefono"
    ).order_by("aceptado_en", "id")


def test_configuracion_ya_no_edita_y_lee_del_catalogo(db):
    _, sin_permiso = _cuenta("pedro")
    assert sin_permiso.get(TEXTOS).status_code == 403

    _, legal = _cuenta("legal", "configuracion.textos_legales")
    inicial = legal.get(TELEFONO).json()
    assert "personal o empresarial" in inicial["texto"]
    assert inicial["solo_lectura"] is True
    assert inicial["se_edita_en"] == "/admin/privacidad/textos"
    assert [t["clave"] for t in legal.get(TEXTOS).json()] == ["autorizacion_telefono"]

    retirada = legal.put(TELEFONO, {"texto": NUEVO}, format="json")
    assert retirada.status_code == 410
    assert retirada.json()["error"]["code"] == "edicion_trasladada"
    assert legal.get(TELEFONO).json()["texto"] == inicial["texto"]
    assert legal.put(f"{TEXTOS}no_existe/", {"texto": NUEVO}, format="json").status_code == 404

    # Lo editado en Protección de datos es lo que lee la pantalla vieja.
    _, editora = _cuenta("editora", "privacidad.textos")
    assert editora.put(EDITAR, {"texto": NUEVO}, format="json").status_code == 200
    leido = legal.get(TELEFONO).json()
    assert leido["texto"] == NUEVO and leido["version"] == inicial["version"] + 1


def _perfil():
    with usando_empresa(empresa_actual()):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        cargo = Cargo.objects.create(nombre="Asesor comercial")
    return {
        "nombres": "Rosa",
        "apellidos": "Vera Núñez",
        "telefono": "0991112222",
        "tiene_telefono_corporativo": False,
        "area": area.id,
        "agencia": sede.id,
        "cargo": cargo.id,
    }


def test_si_el_texto_cambia_se_vuelve_a_aceptar_con_constancia_nueva(db):
    base = _perfil()
    usuario, rosa = _cuenta("rosa")
    rosa.put(
        MIS_DATOS,
        {**base, "acepta_telefono": True},
        format="json",
        REMOTE_ADDR="10.0.5.21",
        HTTP_USER_AGENT=NAVEGADOR,
    )
    with usando_empresa(empresa_actual()):
        primera = DatosDeContacto.objects.get(usuario=usuario)
        version_inicial = primera.telefono_aceptado_version
        constancias = list(_del_telefono(usuario))
    assert primera.telefono_aceptado_ip == "10.0.5.21"
    assert len(constancias) == 1
    assert constancias[0].ip == "10.0.5.21" and constancias[0].navegador == NAVEGADOR
    assert constancias[0].version == version_inicial
    assert constancias[0].texto_aceptado == primera.telefono_aceptado_texto

    _, editora = _cuenta("editora", "privacidad.textos")
    editora.put(EDITAR, {"texto": NUEVO}, format="json")

    # Ahora figura sin aceptar: la versión vigente es otra.
    autorizacion = rosa.get(MIS_DATOS).json()["telefono_autorizacion"]
    assert autorizacion["texto"] == NUEVO and autorizacion["version"] == version_inicial + 1
    assert autorizacion["aceptado"] is False
    assert autorizacion["version_aceptada"] == version_inicial

    # Sin volver a aceptar no se guarda; al aceptar queda la constancia nueva.
    assert rosa.put(MIS_DATOS, base, format="json").status_code == 400
    rosa.put(MIS_DATOS, {**base, "acepta_telefono": True}, format="json", REMOTE_ADDR="10.0.9.9")
    with usando_empresa(empresa_actual()):
        segunda = DatosDeContacto.objects.get(usuario=usuario)
        constancias = list(_del_telefono(usuario))
    assert segunda.telefono_aceptado_version == version_inicial + 1
    assert segunda.telefono_aceptado_texto == NUEVO
    assert segunda.telefono_aceptado_ip == "10.0.9.9"
    assert segunda.telefono_aceptado_en > primera.telefono_aceptado_en
    assert [c.version for c in constancias] == [version_inicial, version_inicial + 1]
    assert constancias[1].texto_aceptado == NUEVO and constancias[1].ip == "10.0.9.9"
    assert rosa.get(MIS_DATOS).json()["telefono_autorizacion"]["aceptado"] is True


def test_borrar_el_telefono_retira_la_autorizacion(db):
    base = _perfil()
    usuario, rosa = _cuenta("rosa")
    rosa.put(MIS_DATOS, {**base, "acepta_telefono": True}, format="json")
    rosa.put(MIS_DATOS, {**base, "telefono": ""}, format="json")
    with usando_empresa(empresa_actual()):
        (primera,) = _del_telefono(usuario)
    assert primera.retirada_en is not None and primera.retirada_por_id == usuario.pk
    assert rosa.get(MIS_DATOS).json()["telefono_autorizacion"]["aceptado"] is False

    # Volver a escribirlo pide aceptar otra vez y deja otra fila.
    assert rosa.put(MIS_DATOS, base, format="json").status_code == 400
    rosa.put(MIS_DATOS, {**base, "acepta_telefono": True}, format="json")
    with usando_empresa(empresa_actual()):
        filas = list(_del_telefono(usuario))
    assert len(filas) == 2 and filas[1].retirada_en is None


def test_si_la_autorizacion_cambio_mientras_la_leia_no_se_guarda(db):
    """QA-TECH (11/11/2026): con `version_telefono` (la que se mostró), si el
    texto cambió entretanto, 400 en `acepta_telefono`."""
    base = _perfil()
    usuario, rosa = _cuenta("rosa")
    leida = rosa.get(MIS_DATOS).json()["telefono_autorizacion"]["version"]
    _, editora = _cuenta("editora", "privacidad.textos")
    editora.put(EDITAR, {"texto": NUEVO}, format="json")
    vieja = rosa.put(
        MIS_DATOS, {**base, "acepta_telefono": True, "version_telefono": leida}, format="json"
    )
    assert vieja.status_code == 400
    assert "acepta_telefono" in vieja.json()["error"]["details"]
    with usando_empresa(empresa_actual()):
        assert not DatosDeContacto.objects.filter(usuario=usuario, telefono="0991112222").exists()
        assert not _del_telefono(usuario).exists()
    nueva = rosa.put(
        MIS_DATOS, {**base, "acepta_telefono": True, "version_telefono": leida + 1}, format="json"
    )
    assert nueva.status_code == 200
