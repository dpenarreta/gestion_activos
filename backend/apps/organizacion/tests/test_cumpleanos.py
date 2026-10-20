"""El cumpleaños en el calendario, decidido por cada persona en «Mi perfil».

Lo que se protege (20/10/2026): sin aceptar que sea público no se muestra;
para mostrarlo hay que dar día y mes (el año no se guarda); se ve en el
calendario de todos cada año; se puede retirar cuando se quiera, y retirarlo
borra la fecha.
"""

from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion.models import DatosDeContacto
from apps.organizacion.tests.test_organigrama import BASE, _cuenta

CUMPLE = f"{BASE}mis-datos/cumpleanos/"
CALENDARIO = f"{BASE}calendario/"


def _octubre(cliente):
    return cliente.get(CALENDARIO, {"desde": "2026-10-01", "hasta": "2026-10-31"}).json()


def test_sin_aceptar_no_se_publica_y_la_fecha_se_valida(db):
    _, rosa = _cuenta("rosa")
    sin_aceptar = rosa.put(CUMPLE, {"mostrar": True, "dia": 25, "mes": 10}, format="json")
    assert sin_aceptar.status_code == 400
    sin_fecha = rosa.put(CUMPLE, {"mostrar": True, "acepto": True}, format="json")
    assert sin_fecha.status_code == 400
    imposible = rosa.put(
        CUMPLE, {"mostrar": True, "acepto": True, "dia": 31, "mes": 2}, format="json"
    )
    assert imposible.status_code == 400
    assert rosa.get(f"{BASE}mis-datos/").json()["cumpleanos"]["mostrar"] is False


def test_publicado_se_ve_en_el_calendario_de_todos_y_se_retira(db):
    usuario, rosa = _cuenta("rosa")
    _, otra = _cuenta("ema")
    respuesta = rosa.put(
        CUMPLE, {"mostrar": True, "acepto": True, "dia": 25, "mes": 10}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["aceptado_en"]
    assert AuditLog.objects.filter(action="organizacion.cumpleanos.publicado").exists()

    eventos = [(e["titulo"], e["fecha"], e["tipo"]) for e in _octubre(otra)]
    assert ("Cumpleaños de Rosa", "2026-10-25", "cumpleanos") in eventos
    # Cada año.
    siguiente = otra.get(CALENDARIO, {"desde": "2027-10-01", "hasta": "2027-10-31"}).json()
    assert [e["fecha"] for e in siguiente] == ["2027-10-25"]

    # Lo retira cuando quiere: desaparece y la fecha no queda guardada.
    rosa.put(CUMPLE, {"mostrar": False}, format="json")
    assert _octubre(otra) == []
    with usando_empresa(empresa_actual()):
        perfil = DatosDeContacto.objects.get(usuario=usuario)
    assert (perfil.cumpleanos_dia, perfil.cumpleanos_mes) == (None, None)
    assert perfil.cumpleanos_aceptado_en is None


ANIVERSARIO = f"{BASE}mis-datos/aniversario/"


def test_el_aniversario_se_publica_aceptando_y_dice_los_anios(db):
    usuario, rosa = _cuenta("rosa")
    _, otra = _cuenta("ema")
    # Sin aceptar, sin día y mes, o con un ingreso futuro, no.
    assert (
        rosa.put(ANIVERSARIO, {"mostrar": True, "dia": 3, "mes": 10}, format="json").status_code
        == 400
    )
    assert (
        rosa.put(ANIVERSARIO, {"mostrar": True, "acepto": True}, format="json").status_code == 400
    )
    futuro = rosa.put(
        ANIVERSARIO,
        {"mostrar": True, "acepto": True, "dia": 3, "mes": 10, "anio": 2099},
        format="json",
    )
    assert futuro.status_code == 400

    respuesta = rosa.put(
        ANIVERSARIO,
        {"mostrar": True, "acepto": True, "dia": 15, "mes": 10, "anio": 2019},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    assert rosa.get(f"{BASE}mis-datos/").json()["aniversario"]["anio"] == 2019
    eventos = [e for e in _octubre(otra) if e["tipo"] == "aniversario"]
    assert [(e["titulo"], e["fecha"], e["descripcion"]) for e in eventos] == [
        ("Aniversario de Rosa", "2026-10-15", "7 años en la empresa")
    ]

    # Solo día y mes: se recuerda sin decir los años.
    rosa.put(ANIVERSARIO, {"mostrar": True, "acepto": True, "dia": 15, "mes": 10}, format="json")
    assert [e["descripcion"] for e in _octubre(otra) if e["tipo"] == "aniversario"] == [""]

    # Lo retira: desaparece y la fecha no queda guardada.
    rosa.put(ANIVERSARIO, {"mostrar": False}, format="json")
    assert [e for e in _octubre(otra) if e["tipo"] == "aniversario"] == []
    with usando_empresa(empresa_actual()):
        perfil = DatosDeContacto.objects.get(usuario=usuario)
    assert (perfil.aniversario_dia, perfil.aniversario_mes, perfil.aniversario_anio) == (
        None,
        None,
        None,
    )
