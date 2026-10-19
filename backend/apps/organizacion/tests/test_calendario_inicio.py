"""El calendario de Inicio.

Lo que se protege (19/10/2026): todos ven las fechas del mes que miran (los
cumpleaños y demás fechas anuales, en cada año); agregar, editar y borrar
pide `calendario.gestionar`; un evento no termina antes de empezar.
"""

from apps.organizacion.tests.test_organigrama import _cuenta

EVENTOS = "/api/v1/organizacion/eventos/"
CALENDARIO = "/api/v1/organizacion/calendario/"


def _agregar(cliente, **datos):
    return cliente.post(EVENTOS, {"tipo": "evento", **datos}, format="json")


def test_todos_ven_el_mes_con_los_cumpleanos_de_cada_anio(db):
    _, th = _cuenta("tania", "calendario.gestionar")
    assert (
        _agregar(
            th, titulo="Cumpleaños de Rosa", tipo="cumpleanos", fecha="2020-10-25", cada_anio=True
        ).status_code
        == 201
    )
    _agregar(th, titulo="Feria", fecha="2026-10-30", fecha_fin="2026-11-02")
    _agregar(th, titulo="Otro mes", fecha="2026-12-10")

    _, empleado = _cuenta("ema")
    octubre = empleado.get(CALENDARIO, {"desde": "2026-10-01", "hasta": "2026-10-31"}).json()
    assert [(e["titulo"], e["fecha"]) for e in octubre] == [
        ("Cumpleaños de Rosa", "2026-10-25"),
        ("Feria", "2026-10-30"),
    ]
    # El evento de varios días también aparece en el mes donde termina.
    noviembre = empleado.get(CALENDARIO, {"desde": "2026-11-01", "hasta": "2026-11-30"}).json()
    assert [e["titulo"] for e in noviembre] == ["Feria"]
    assert noviembre[0]["fecha_fin"] == "2026-11-02"


def test_el_29_de_febrero_cae_el_28_en_un_anio_no_bisiesto(db):
    _, th = _cuenta("tania", "calendario.gestionar")
    _agregar(th, titulo="Cumple bisiesto", tipo="cumpleanos", fecha="2024-02-29", cada_anio=True)
    febrero = th.get(CALENDARIO, {"desde": "2026-02-01", "hasta": "2026-02-28"}).json()
    assert febrero[0]["fecha"] == "2026-02-28"


def test_sin_permiso_no_se_gestiona_y_las_fechas_se_validan(db):
    _, th = _cuenta("tania", "calendario.gestionar")
    _, empleado = _cuenta("ema")
    assert _agregar(empleado, titulo="X", fecha="2026-10-20").status_code == 403
    al_reves = _agregar(th, titulo="X", fecha="2026-10-20", fecha_fin="2026-10-19")
    assert al_reves.status_code == 400
    evento = _agregar(th, titulo="Charla", fecha="2026-10-20").json()
    assert empleado.delete(f"{EVENTOS}{evento['id']}/").status_code == 403
    assert th.delete(f"{EVENTOS}{evento['id']}/").status_code == 204


def test_el_rango_se_valida(db):
    _, empleado = _cuenta("ema")
    assert empleado.get(CALENDARIO, {"desde": "x", "hasta": "y"}).status_code == 400
    assert (
        empleado.get(CALENDARIO, {"desde": "2026-01-01", "hasta": "2028-01-01"}).status_code == 400
    )
