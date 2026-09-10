"""Cómo se compone el nombre de usuario.

Cobertura de tests/qa/features/users.feature (AC-USR-010 a AC-USR-013).
"""

import pytest

from apps.users.models import User
from apps.users.nomenclatura import base_de_username, generar_username


@pytest.mark.parametrize(
    ("nombres", "apellidos", "esperado"),
    [
        ("Diego", "Peñarreta", "dpenarreta"),
        ("Ana", "Muñoz", "amunoz"),
        ("José", "Hernández", "jhernandez"),
        ("Íngrid", "Ávila", "iavila"),
        # Los dos apellidos, pegados: cortar por el primero convertiría en la
        # misma cuenta a dos hermanos que trabajen aquí.
        ("Diego", "Peñarreta Vaca", "dpenarretavaca"),
        # Del nombre solo la inicial, aunque sean dos.
        ("Juan Carlos", "Pérez", "jperez"),
        # Ni espacios, ni guiones, ni puntos: es lo que se teclea al entrar.
        ("Ana-María", "De la Torre", "adelatorre"),
        ("  ana  ", " ROJAS ", "arojas"),
    ],
)
def test_la_base_sale_del_nombre_sin_tildes_ni_enies(nombres, apellidos, esperado):
    assert base_de_username(nombres, apellidos) == esperado


def test_un_nombre_sin_letras_utilizables_no_deja_la_cuenta_sin_nombre():
    assert base_de_username("", "") == "usuario"
    assert base_de_username("---", "***") == "usuario"


@pytest.mark.django_db
def test_el_segundo_con_el_mismo_nombre_lleva_numero():
    """Dos «Pérez» con la misma inicial dan la misma base."""
    User.objects.create_user(username="dperez", email="uno@example.com", password="Sup3r-Secr3t!")

    assert generar_username("Diego", "Perez") == "dperez2"

    User.objects.create_user(username="dperez2", email="dos@example.com", password="Sup3r-Secr3t!")
    assert generar_username("Daniela", "Pérez") == "dperez3"


@pytest.mark.django_db
def test_el_desempate_no_se_confunde_con_un_apellido_mas_largo():
    """`dperezmoreno` empieza por `dperez` pero no es el mismo nombre."""
    User.objects.create_user(
        username="dperezmoreno", email="uno@example.com", password="Sup3r-Secr3t!"
    )

    assert generar_username("Diego", "Pérez") == "dperez"


@pytest.mark.django_db
def test_no_distingue_mayusculas_al_desempatar():
    """Entrar es indistinto a mayúsculas: `DPerez` y `dperez` son la misma cuenta."""
    User.objects.create_user(username="DPerez", email="uno@example.com", password="Sup3r-Secr3t!")

    assert generar_username("Diego", "Pérez") == "dperez2"
