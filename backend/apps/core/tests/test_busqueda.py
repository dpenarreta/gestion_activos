"""Búsqueda de texto sin tildes ni mayúsculas (`apps.core.busqueda`).

Lo que se fija es que el servidor responda igual que el buscador del
frontend (`frontend/src/utils/busqueda.js`): cada palabra en cualquier orden y
sin que cuenten las tildes ni las mayúsculas, con cualquier colación que tenga
la base. Y dos cosas del cómo: que buscar por una relación no agregue uniones
de más (ni filas repetidas) y que lo escrito no se interprete como comodín.
"""

import pytest

from apps.core.busqueda import (
    COLACION_SIN_TILDES,
    MAXIMO_DE_PALABRAS,
    condicion_de_busqueda,
    filtro_de_busqueda,
    palabras_de_busqueda,
)
from apps.organizacion.models import Departamento, Empleado

CAMPOS = ("nombres", "apellidos", "departamento__nombre")


@pytest.fixture
def personas(db):
    talento = Departamento.objects.create(nombre="Talento Humano", codigo="TH")
    logistica = Departamento.objects.create(nombre="Logística", codigo="LOG")
    crear = Empleado.objects.create
    return {
        "ramirez": crear(
            nombres="José", apellidos="Ramírez", codigo_empleado="E-1", departamento=talento
        ),
        "nandu": crear(
            nombres="ÑANDÚ", apellidos="Cevallos", codigo_empleado="E-2", departamento=logistica
        ),
        "pena": crear(
            nombres="María", apellidos="Peña Ortiz", codigo_empleado="E-3", departamento=logistica
        ),
        "comodin": crear(
            nombres="Descuento", apellidos="100% Real", codigo_empleado="E-4", departamento=talento
        ),
    }


def _buscar(termino):
    return set(
        filtro_de_busqueda(Empleado.objects.all(), termino, CAMPOS).values_list(
            "codigo_empleado", flat=True
        )
    )


def test_sin_tilde_encuentra_lo_escrito_con_tilde(personas):
    assert _buscar("ramirez") == {"E-1"}


def test_con_tilde_encuentra_lo_escrito_sin_tilde(personas):
    Empleado.objects.filter(pk=personas["ramirez"].pk).update(apellidos="Ramirez")
    assert _buscar("Ramírez") == {"E-1"}


def test_no_distingue_mayusculas_ni_la_enie(personas):
    assert _buscar("nandu") == {"E-2"}
    assert _buscar("ÑANDÚ") == {"E-2"}
    assert _buscar("ñandu") == {"E-2"}
    # «pena» encuentra «Peña», como el buscador de deudores de cartera.
    assert _buscar("PENA") == {"E-3"}


def test_cada_palabra_en_cualquier_orden_y_en_cualquier_campo(personas):
    assert _buscar("ramirez jose") == {"E-1"}
    assert _buscar("jose ramirez") == {"E-1"}
    # Una palabra en el nombre y otra en el área: también por la relación.
    assert _buscar("logistica maria") == {"E-3"}


def test_todas_las_palabras_tienen_que_estar(personas):
    assert _buscar("jose cevallos") == set()


def test_sin_texto_no_filtra(personas):
    assert _buscar("") == {"E-1", "E-2", "E-3", "E-4"}
    assert _buscar("   ") == {"E-1", "E-2", "E-3", "E-4"}
    assert _buscar(None) == {"E-1", "E-2", "E-3", "E-4"}
    assert condicion_de_busqueda("  ", CAMPOS) is None


def test_lo_escrito_no_funciona_como_comodin(personas):
    # `%` y `_` son comodines de `LIKE`: escritos en el buscador se buscan tal cual.
    assert _buscar("100%") == {"E-4"}
    assert _buscar("%") == {"E-4"}
    assert _buscar("_") == set()


def test_la_consulta_compara_con_la_colacion_sin_tildes(personas):
    sql = str(filtro_de_busqueda(Empleado.objects.all(), "ramirez", CAMPOS).query)
    assert f"COLLATE {COLACION_SIN_TILDES}" in sql


def test_buscar_por_una_relacion_de_varios_valores_usa_una_sola_union(personas):
    """Dos palabras sobre los empleados de un área: una sola unión, no una por
    palabra (con anotaciones serían dos, y las filas se multiplicarían)."""
    consulta = filtro_de_busqueda(
        Departamento.objects.all(), "jose ramirez", ("empleados__nombres", "empleados__apellidos")
    )
    sql = str(consulta.query)
    assert sql.count("JOIN [organizacion_empleado]") == 1
    assert list(consulta.values_list("codigo", flat=True)) == ["TH"]


def test_con_distinct_un_area_con_varios_que_coinciden_sale_una_vez(personas):
    talento = personas["ramirez"].departamento
    Empleado.objects.create(
        nombres="Josefina", apellidos="Ramírez", codigo_empleado="E-5", departamento=talento
    )
    consulta = filtro_de_busqueda(Departamento.objects.all(), "ramirez", ("empleados__apellidos",))
    assert consulta.count() == 2  # una fila por empleado que coincide
    assert list(consulta.distinct().values_list("codigo", flat=True)) == ["TH"]


def test_las_palabras_se_toman_una_vez_y_con_tope():
    assert palabras_de_busqueda("  jose   ramirez jose ") == ["jose", "ramirez"]
    muchas = " ".join(f"p{i}" for i in range(MAXIMO_DE_PALABRAS + 5))
    assert len(palabras_de_busqueda(muchas)) == MAXIMO_DE_PALABRAS


def test_sin_campos_es_un_error_de_programacion():
    with pytest.raises(ValueError):
        condicion_de_busqueda("algo", ())


def test_el_registro_de_auditoria_se_filtra_por_usuario_sin_tildes(db):
    from apps.core.audit_filters import filter_audit_logs
    from apps.core.models import AuditLog
    from apps.users.models import User

    nunez = User.objects.create_user(
        username="mnúñez", email="mnunez@example.com", password="Sup3r-Secr3t!"
    )
    otro = User.objects.create_user(
        username="acevallos", email="acevallos@example.com", password="Sup3r-Secr3t!"
    )
    for actor in (nunez, otro):
        AuditLog.objects.create(actor=actor, action="user.updated", module="usuarios")

    filas = filter_audit_logs(AuditLog.objects.all(), {"actor_username": "MNUNEZ"})
    assert [f.actor_id for f in filas] == [nunez.pk]


def test_el_filtro_de_usuario_de_auditoria_halla_el_autor_de_nexo(db):
    """Los eventos migrados de Nexo de alguien sin cuenta llevan su nombre en
    `actor_en_nexo`: la pantalla lo muestra como autor y el filtro lo halla."""
    from apps.core.audit_filters import filter_audit_logs
    from apps.core.models import AuditLog

    de_nexo = AuditLog.objects.create(
        action="user.updated",
        module="usuarios",
        actor_en_nexo="Íñigo Ramírez",
        id_en_nexo=901,
    )
    AuditLog.objects.create(
        action="user.updated", module="usuarios", actor_en_nexo="Ana Vera", id_en_nexo=902
    )

    filas = filter_audit_logs(AuditLog.objects.all(), {"actor_username": "inigo ramirez"})
    assert [f.pk for f in filas] == [de_nexo.pk]
