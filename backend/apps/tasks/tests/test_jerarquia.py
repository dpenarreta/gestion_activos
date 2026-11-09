"""La jerarquía de Tareas y Equipo sale del organigrama (`jerarquia.py`).

Lo que se protege: el equipo directo e indirecto, que sin cargo la persona solo
se vea a sí misma, que un ciclo en el organigrama no cuelgue el recorrido, y
que el cargo o la cuenta de otra empresa no cuente.
"""

import pytest

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.organizacion.models import Cargo, DatosDeContacto
from apps.tasks import jerarquia
from apps.users.models import User

from .conftest import cargo, poner_en_cargo

pytestmark = pytest.mark.django_db


def _persona(nombre: str) -> User:
    return User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def arbol():
    """Gerencia › Jefatura › (Analista, Asistente); Analista › Auxiliar.
    «par» ocupa el mismo cargo que la jefa; «suelta» no tiene cargo."""
    gerencia = cargo("Gerencia de GH")
    jefatura = cargo("Jefatura", jefe=gerencia)
    analista_c = cargo("Analista", jefe=jefatura)
    asistente_c = cargo("Asistente", jefe=jefatura)
    auxiliar_c = cargo("Auxiliar", jefe=analista_c)

    personas = {
        n: _persona(n)
        for n in ("gerente", "jefa", "par", "analista", "asistente", "auxiliar", "suelta")
    }
    poner_en_cargo(personas["gerente"], gerencia)
    poner_en_cargo(personas["jefa"], jefatura)
    poner_en_cargo(personas["par"], jefatura)
    poner_en_cargo(personas["analista"], analista_c)
    poner_en_cargo(personas["asistente"], asistente_c)
    poner_en_cargo(personas["auxiliar"], auxiliar_c)
    return personas


def _nombres(usuarios) -> set[str]:
    return {u.username for u in usuarios}


# --- Equipo -------------------------------------------------------------------


def test_equipo_directo_e_indirecto(arbol):
    assert _nombres(jerarquia.equipo_de(arbol["jefa"])) == {"analista", "asistente", "auxiliar"}
    assert _nombres(jerarquia.equipo_de(arbol["analista"])) == {"auxiliar"}
    assert _nombres(jerarquia.equipo_de(arbol["gerente"])) == {
        "jefa",
        "par",
        "analista",
        "asistente",
        "auxiliar",
    }


def test_quien_ocupa_el_mismo_cargo_no_es_de_su_equipo(arbol):
    assert "par" not in _nombres(jerarquia.equipo_de(arbol["jefa"]))
    assert not jerarquia.puede_ver(arbol["jefa"], arbol["par"])


def test_hacia_arriba_no_hay_equipo(arbol):
    assert jerarquia.equipo_de(arbol["auxiliar"]).count() == 0
    assert not jerarquia.puede_ver(arbol["auxiliar"], arbol["jefa"])


def test_puede_ver_a_si_misma_y_a_su_equipo(arbol):
    assert jerarquia.puede_ver(arbol["jefa"], arbol["jefa"])
    assert jerarquia.puede_ver(arbol["jefa"], arbol["auxiliar"])
    assert not jerarquia.puede_ver(arbol["asistente"], arbol["analista"])


# --- Sin cargo ------------------------------------------------------------------


def test_sin_cargo_solo_se_ve_a_si_misma(arbol):
    suelta = arbol["suelta"]
    assert jerarquia.cargo_de(suelta) is None
    assert jerarquia.equipo_de(suelta).count() == 0
    assert jerarquia.equipo_ids(suelta) == set()
    assert jerarquia.jefes_de(suelta) == []
    assert jerarquia.puede_ver(suelta, suelta)
    assert not jerarquia.puede_ver(suelta, arbol["auxiliar"])


def test_quien_pierde_el_cargo_sale_del_equipo(arbol):
    poner_en_cargo(arbol["auxiliar"], None)
    assert "auxiliar" not in _nombres(jerarquia.equipo_de(arbol["jefa"]))


# --- Jefes ----------------------------------------------------------------------


def test_jefes_del_mas_cercano_al_mas_lejano(arbol):
    assert [u.username for u in jerarquia.jefes_de(arbol["auxiliar"])] == [
        "analista",
        "jefa",
        "par",
        "gerente",
    ]


def test_jefe_inmediato_salta_el_cargo_vacante(arbol):
    vacante = cargo("Coordinación vacante", jefe=Cargo.objects.get(nombre="Jefatura"))
    nueva = _persona("nueva")
    poner_en_cargo(nueva, cargo("Auxiliar 2", jefe=vacante))

    assert _nombres(jerarquia.jefe_inmediato(nueva)) == {"jefa", "par"}


def test_jefe_inmediato_de_quien_esta_arriba_de_todo_es_nadie(arbol):
    assert jerarquia.jefe_inmediato(arbol["gerente"]) == []


# --- Ciclos ---------------------------------------------------------------------


def test_un_ciclo_en_el_organigrama_no_cuelga_el_recorrido(arbol):
    """`organigrama.validar_jefe` impide los ciclos, pero el recorrido no se
    fía: si una carga directa a la base deja uno, termina igual."""
    gerencia = Cargo.objects.get(nombre="Gerencia de GH")
    auxiliar = Cargo.objects.get(nombre="Auxiliar")
    Cargo.objects.filter(pk=gerencia.pk).update(jefe=auxiliar)  # Gerencia reporta al Auxiliar

    equipo = _nombres(jerarquia.equipo_de(arbol["jefa"]))
    assert equipo == {"analista", "asistente", "auxiliar", "gerente"}
    assert "jefa" not in equipo  # nunca se cuenta a sí misma
    jefes = [u.username for u in jerarquia.jefes_de(arbol["jefa"])]
    assert jefes == ["gerente", "auxiliar", "analista"]


def test_un_cargo_que_se_reporta_a_si_mismo(arbol):
    jefatura = Cargo.objects.get(nombre="Jefatura")
    Cargo.objects.filter(pk=jefatura.pk).update(jefe=jefatura)

    assert _nombres(jerarquia.equipo_de(arbol["jefa"])) == {"analista", "asistente", "auxiliar"}
    assert jerarquia.jefes_de(arbol["jefa"]) == []


# --- Otra empresa ------------------------------------------------------------


@pytest.fixture
def otra_empresa():
    return Empresa.objects.create(nombre="Otra empresa", codigo="OTR")


def test_el_cargo_en_otra_empresa_no_cuenta(arbol, otra_empresa):
    """La jefa tiene equipo en la empresa de pruebas; en la otra, sin cargo,
    no ve a nadie aunque las mismas personas estén en ella."""
    for persona in arbol.values():
        MembresiaEmpresa.objects.get_or_create(usuario=persona, empresa=otra_empresa)
    with usando_empresa(otra_empresa):
        assert jerarquia.cargo_de(arbol["jefa"]) is None
        assert jerarquia.equipo_de(arbol["jefa"]).count() == 0
        assert not jerarquia.puede_ver(arbol["jefa"], arbol["auxiliar"])


def test_el_organigrama_de_otra_empresa_no_da_equipo_aqui(arbol, otra_empresa):
    """Alguien que en la otra empresa depende de la jefa no es de su equipo en
    esta."""
    externo = _persona("externo")
    with usando_empresa(otra_empresa):
        MembresiaEmpresa.objects.create(usuario=externo, empresa=otra_empresa)
        MembresiaEmpresa.objects.create(usuario=arbol["jefa"], empresa=otra_empresa)
        jefatura_otra = Cargo.objects.create(nombre="Jefatura")
        DatosDeContacto.objects.create(usuario=arbol["jefa"], cargo=jefatura_otra)
        DatosDeContacto.objects.create(
            usuario=externo, cargo=Cargo.objects.create(nombre="Analista", jefe=jefatura_otra)
        )
        assert _nombres(jerarquia.equipo_de(arbol["jefa"])) == {"externo"}

    assert "externo" not in _nombres(jerarquia.equipo_de(arbol["jefa"]))


def test_quien_ya_no_trabaja_en_la_empresa_no_es_de_su_equipo(arbol):
    """Su perfil (con el cargo) se queda, pero sin membresía no cuenta."""
    MembresiaEmpresa.objects.filter(usuario=arbol["auxiliar"]).delete()
    assert "auxiliar" not in _nombres(jerarquia.equipo_de(arbol["jefa"]))


def test_una_cuenta_desactivada_no_aparece_pero_su_jefe_la_sigue_viendo(arbol):
    auxiliar = arbol["auxiliar"]
    User.objects.filter(pk=auxiliar.pk).update(is_active=False)

    assert "auxiliar" not in _nombres(jerarquia.equipo_de(arbol["jefa"]))
    assert auxiliar.pk in jerarquia.equipo_ids(arbol["jefa"])  # sus tareas siguen visibles


def test_fuera_de_una_peticion_y_sin_empresa_no_hay_organigrama(arbol):
    with usando_empresa(None):
        assert jerarquia.cargo_de(arbol["jefa"]) is None
        assert jerarquia.equipo_ids(arbol["jefa"]) == set()


# --- Reporte secundario (línea punteada, 09/11/2026) ------------------------------


@pytest.fixture
def con_linea_punteada(arbol):
    """Otra rama, la de Finanzas, y la Jefatura reportando también a ella."""
    finanzas = cargo("Jefatura de Finanzas", jefe=Cargo.objects.get(nombre="Gerencia de GH"))
    contador_c = cargo("Contador", jefe=finanzas)
    for nombre, en in (("financiero", finanzas), ("contador", contador_c)):
        arbol[nombre] = _persona(nombre)
        poner_en_cargo(arbol[nombre], en)
    Cargo.objects.get(nombre="Jefatura").jefes_secundarios.add(finanzas)
    return arbol


def test_el_jefe_secundario_ve_a_la_persona_y_a_todo_su_equipo(con_linea_punteada):
    a = con_linea_punteada
    assert _nombres(jerarquia.equipo_de(a["financiero"])) == {
        "contador",
        "jefa",
        "par",
        "analista",
        "asistente",
        "auxiliar",
    }
    assert jerarquia.puede_ver(a["financiero"], a["auxiliar"])
    assert a["jefa"].pk in jerarquia.equipo_ids(a["financiero"])
    # Hacia el otro lado no: la jefa no ve al jefe secundario ni a su equipo.
    assert not jerarquia.puede_ver(a["jefa"], a["contador"])


def test_el_reporte_secundario_no_cambia_jefes_ni_avisos(con_linea_punteada):
    """Aprobaciones y avisos van solo al jefe inmediato (línea directa)."""
    a = con_linea_punteada
    assert _nombres(jerarquia.jefe_inmediato(a["jefa"])) == {"gerente"}
    assert _nombres(jerarquia.jefes_de(a["jefa"])) == {"gerente"}
    assert "financiero" not in _nombres(jerarquia.jefes_de(a["auxiliar"]))


def test_las_aprobaciones_al_jefe_inmediato_no_van_al_jefe_secundario(con_linea_punteada):
    from apps.licencias.services import jefes_de

    assert _nombres(jefes_de(con_linea_punteada["jefa"])) == {"gerente"}


def test_un_circulo_entre_las_dos_lineas_no_cuelga_el_recorrido(con_linea_punteada):
    """`reportes.validar` lo impide; si una carga directa lo deja, termina."""
    finanzas = Cargo.objects.get(nombre="Jefatura de Finanzas")
    Cargo.objects.get(nombre="Auxiliar").reportes_secundarios.add(finanzas)
    equipo = _nombres(jerarquia.equipo_de(con_linea_punteada["financiero"]))
    assert "auxiliar" in equipo and "financiero" not in equipo
