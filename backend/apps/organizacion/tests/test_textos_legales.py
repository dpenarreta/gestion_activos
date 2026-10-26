"""Los textos de tratamiento de datos personales son parametrizables (26/10/2026).

Lo que se protege:

- Editarlos pide `configuracion.textos_legales`; cada cambio sube la versión y
  queda en la auditoría con el texto anterior y el nuevo.
- La persona acepta el texto vigente: se guarda la fecha y hora, la IP, el
  texto exacto y su versión.
- Si el texto cambia, lo vuelve a aceptar la próxima vez que guarde su teléfono
  y queda una constancia nueva; hasta entonces no figura como aceptado.
"""

from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion.models import Cargo, DatosDeContacto, Departamento, Sede
from apps.organizacion.tests.test_carga_personas import _cuenta

TEXTOS = "/api/v1/organizacion/textos-legales/"
TELEFONO = f"{TEXTOS}autorizacion_telefono/"
MIS_DATOS = "/api/v1/organizacion/mis-datos/"


def test_editar_los_textos_pide_su_permiso_y_queda_en_la_auditoria(db):
    _, sin_permiso = _cuenta("pedro")
    assert sin_permiso.get(TEXTOS).status_code == 403
    assert sin_permiso.put(TELEFONO, {"texto": "x" * 30}, format="json").status_code == 403

    _, legal = _cuenta("legal", "configuracion.textos_legales")
    inicial = legal.get(TELEFONO).json()
    assert inicial["version"] == 1 and "personal o empresarial" in inicial["texto"]
    assert [t["clave"] for t in legal.get(TEXTOS).json()] == ["autorizacion_telefono"]

    assert legal.put(TELEFONO, {"texto": "corto"}, format="json").status_code == 400
    nuevo = "Autorizo a la empresa a guardar mi teléfono para que me contacten (versión revisada)."
    cambiado = legal.put(TELEFONO, {"texto": nuevo}, format="json").json()
    assert cambiado["texto"] == nuevo and cambiado["version"] == 2
    evento = AuditLog.objects.get(action="configuracion.texto_legal.actualizado")
    assert evento.previous_values["texto"] == inicial["texto"]
    assert evento.new_values == {"texto": nuevo, "version": 2}

    # Guardar el mismo texto no inventa una versión nueva.
    assert legal.put(TELEFONO, {"texto": nuevo}, format="json").json()["version"] == 2


def test_si_el_texto_cambia_se_vuelve_a_aceptar_con_constancia_nueva(db):
    with usando_empresa(empresa_actual()):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        cargo = Cargo.objects.create(nombre="Asesor comercial")
    usuario, rosa = _cuenta("rosa")
    base = {
        "nombres": "Rosa",
        "apellidos": "Vera",
        "telefono": "0991112222",
        "area": area.id,
        "agencia": sede.id,
        "cargo": cargo.id,
    }
    rosa.put(MIS_DATOS, {**base, "acepta_telefono": True}, format="json", REMOTE_ADDR="10.0.5.21")
    with usando_empresa(empresa_actual()):
        primera = DatosDeContacto.objects.get(usuario=usuario)
    assert (primera.telefono_aceptado_version, primera.telefono_aceptado_ip) == (1, "10.0.5.21")

    _, legal = _cuenta("legal", "configuracion.textos_legales")
    nuevo = "Autorizo a la empresa a guardar mi teléfono para que me contacten (versión revisada)."
    legal.put(TELEFONO, {"texto": nuevo}, format="json")

    # Ahora figura sin aceptar: la versión vigente es otra.
    autorizacion = rosa.get(MIS_DATOS).json()["telefono_autorizacion"]
    assert autorizacion["texto"] == nuevo and autorizacion["version"] == 2
    assert autorizacion["aceptado"] is False and autorizacion["version_aceptada"] == 1

    # Sin volver a aceptar no se guarda; al aceptar queda la constancia nueva.
    assert rosa.put(MIS_DATOS, base, format="json").status_code == 400
    rosa.put(MIS_DATOS, {**base, "acepta_telefono": True}, format="json", REMOTE_ADDR="10.0.9.9")
    with usando_empresa(empresa_actual()):
        segunda = DatosDeContacto.objects.get(usuario=usuario)
    assert segunda.telefono_aceptado_version == 2
    assert segunda.telefono_aceptado_texto == nuevo
    assert segunda.telefono_aceptado_ip == "10.0.9.9"
    assert segunda.telefono_aceptado_en > primera.telefono_aceptado_en
    assert rosa.get(MIS_DATOS).json()["telefono_autorizacion"]["aceptado"] is True
