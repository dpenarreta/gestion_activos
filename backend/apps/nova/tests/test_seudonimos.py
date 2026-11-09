import pytest

from apps.nova.seudonimos import (
    TEXTO_OMITIDO,
    EnvioBloqueado,
    Seudonimizador,
    contiene_salud,
    ocultar_contacto,
)


def test_seudonimo_estable_dentro_de_la_llamada():
    s = Seudonimizador()
    a = s.persona("Ana Núñez", clave=1)
    b = s.persona("Bruno Peñaherrera", clave=2)
    assert (a, b) == ("Persona A", "Persona B")
    assert s.persona("Ana Núñez", clave=1) == "Persona A"
    assert s.personas == {"Persona A": "Ana Núñez", "Persona B": "Bruno Peñaherrera"}


def test_mas_de_26_personas():
    s = Seudonimizador()
    alias = [s.persona(f"Nombre{i}", clave=i) for i in range(28)]
    assert alias[25] == "Persona Z" and alias[26] == "Persona AA"


def test_reemplaza_nombres_en_texto_libre_sin_tildes_ni_mayusculas():
    s = Seudonimizador()
    s.persona("Ana Núñez", "anunez", clave=1)
    texto = s.texto("Revisar con ana NUNEZ la conciliación; luego Núñez firma (usuario anunez).")
    assert "Ana" not in texto and "Núñez" not in texto.replace("Persona A", "")
    assert "nunez" not in texto.lower().replace("persona a", "")
    assert texto.count("Persona A") >= 3


def test_parte_compartida_se_oculta_sin_seudonimo():
    s = Seudonimizador()
    s.persona("Ana Núñez", clave=1)
    s.persona("Ana Vera", clave=2)
    assert s.texto("Habló Ana") == "Habló [persona]"
    assert s.texto("Ana Vera llamó") == "Persona B llamó"


def test_oculta_correo_cedula_y_telefono():
    texto = ocultar_contacto(
        "Escribir a persona@example.com, cédula 1712345678, RUC 1712345678001, "
        "celular 099 123 4567 o +593 2 234 5678."
    )
    assert "@" not in texto
    assert "1712345678" not in texto
    assert "099" not in texto and "234 5678" not in texto
    # Las cifras de los indicadores no se tocan.
    assert ocultar_contacto("Cumplimiento 85% en 2026-11, 12.5 h de 40 h") == (
        "Cumplimiento 85% en 2026-11, 12.5 h de 40 h"
    )


@pytest.mark.parametrize(
    "texto",
    [
        "Licencia de maternidad vigente",
        "Período de lactancia",
        "Permiso médico por cita",
        "Reposo por enfermedad",
        "Control prenatal",
        "Tema de salud",
    ],
)
def test_textos_de_salud_no_se_envian(texto):
    assert contiene_salud(texto)
    assert Seudonimizador().texto(texto) == TEXTO_OMITIDO


def test_saludable_no_es_dato_de_salud():
    assert not contiene_salud("indicadores dentro de rangos saludables")


def test_sanear_quita_claves_de_salud_y_conserva_cifras():
    s = Seudonimizador()
    s.persona("Ana Núñez", clave=1)
    datos = s.sanear(
        {
            "persona": "Ana Núñez",
            "cumplimiento": 80,
            "special_status_type": "MATERNIDAD",
            "medico_leave_minutes": 120,
            "titulos": ["Informe de Ana", "Cita médica"],
        }
    )
    assert datos == {
        "persona": "Persona A",
        "cumplimiento": 80,
        "titulos": ["Informe de Persona A", TEXTO_OMITIDO],
    }


def test_verificar_bloquea_lo_que_se_colo():
    s = Seudonimizador()
    s.persona("Ana Núñez", clave=1)
    s.verificar('{"persona": "Persona A", "cumplimiento": 80}')
    for malo in ('{"n": "Ana"}', "correo a@b.com", "maternidad", "cédula 1712345678"):
        with pytest.raises(EnvioBloqueado):
            s.verificar(malo)


def test_reponer_en_estructuras():
    s = Seudonimizador()
    s.persona("Ana Núñez", clave=1)
    s.persona("Bruno Peña", clave=2)
    assert s.reponer({"t": ["Persona A supera a persona B", 3]}) == {
        "t": ["Ana Núñez supera a Bruno Peña", 3]
    }


def test_permitir_salud_solo_relaja_la_salud():
    s = Seudonimizador()
    s.persona("Ana Núñez", "anunez")
    texto = "Ana Núñez (anunez@example.com) pregunta por la licencia por maternidad"
    assert s.texto(texto) == TEXTO_OMITIDO
    limpio = s.texto(texto, permitir_salud=True)
    assert limpio == "Persona A ([correo]) pregunta por la licencia por maternidad"
    s.verificar(limpio, permitir_salud=True)
    with pytest.raises(EnvioBloqueado):
        s.verificar(limpio)
    with pytest.raises(EnvioBloqueado) as error:
        s.verificar("Ana y la maternidad, 0912345678", permitir_salud=True)
    assert {"nombre de persona", "identificación"} <= set(error.value.motivos)
    assert "dato de salud" not in error.value.motivos
    # Las claves de salud se quitan igual.
    assert s.sanear({"maternidad": "x", "pregunta": "lactancia"}, permitir_salud=True) == {
        "pregunta": "lactancia"
    }
