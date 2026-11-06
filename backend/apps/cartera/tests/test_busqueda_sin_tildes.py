"""El filtro por cliente de Cartera no distingue tildes ni mayúsculas, como el
buscador de deudores (que ya comparaba sin acentos en memoria). Ver
`apps.core.busqueda`."""

import pytest

from apps.cartera.models import RegistroCartera
from apps.cartera.services.filters import aplicar_filtros_queryset
from apps.core.busqueda import COLACION_SIN_TILDES


@pytest.mark.django_db
def test_el_cliente_se_busca_por_palabras_con_la_colacion_sin_tildes():
    consulta = aplicar_filtros_queryset(RegistroCartera.objects.all(), {"cliente": "pena ÑANDÚ"})
    sql = str(consulta.query)
    # Dos palabras, cada una en el nombre o en el RUC: cuatro comparaciones.
    assert sql.count(f"COLLATE {COLACION_SIN_TILDES}") == 4
    # Y la consulta es válida para el motor.
    assert consulta.count() == 0


@pytest.mark.django_db
def test_sin_cliente_no_se_filtra():
    consulta = aplicar_filtros_queryset(RegistroCartera.objects.all(), {})
    assert "COLLATE" not in str(consulta.query)
