"""Cobertura de tests/qa/features/tiempos-del-activo.feature (AC-TMP-010 a AC-TMP-012)."""

import pytest

from apps.core.duracion import formatear_dias, formatear_meses

#: La misma tabla vive en frontend/tests/formatearDias.test.js: los dos lados
#: tienen que contar igual, o el aviso del correo diría una cosa y la ficha del
#: equipo otra.
CASOS = [
    (0, "0 días"),
    (1, "1 día"),
    (15, "15 días"),
    # El umbral de la regla: hasta 30 se dice en días.
    (30, "30 días"),
    (31, "1 mes y 1 día"),
    (45, "1 mes y 15 días"),
    # Un cero no se dice: «2 meses», no «2 meses y 0 días».
    (60, "2 meses"),
    (89, "2 meses y 29 días"),
    (359, "11 meses y 29 días"),
    # Doce meses son un año: «12 meses» obligaría a hacer la cuenta.
    (360, "1 año"),
    (361, "1 año y 1 día"),
    (395, "1 año, 1 mes y 5 días"),
    (412, "1 año, 1 mes y 22 días"),
    (730, "2 años y 10 días"),
]


@pytest.mark.parametrize(("dias", "esperado"), CASOS)
def test_la_duracion_se_dice_como_la_lee_una_persona(dias, esperado):
    assert formatear_dias(dias) == esperado


def test_sin_dato_no_inventa_un_cero():
    assert formatear_dias(None) == "—"


def test_del_negativo_cuenta_la_magnitud():
    """Una garantía vencida se dice «venció hace 2 meses», no «hace -2 meses»."""
    assert formatear_dias(-45) == "1 mes y 15 días"


MESES = [
    (1, "1 mes"),
    (11, "11 meses"),
    (12, "12 meses"),
    (13, "1 año y 1 mes"),
    (24, "2 años"),
    (70, "5 años y 10 meses"),
]


@pytest.mark.parametrize(("meses", "esperado"), MESES)
def test_la_antiguedad_se_dice_en_anios_pasado_el_ano(meses, esperado):
    assert formatear_meses(meses) == esperado


def test_la_antiguedad_sin_dato_no_inventa_un_cero():
    assert formatear_meses(None) == "—"
