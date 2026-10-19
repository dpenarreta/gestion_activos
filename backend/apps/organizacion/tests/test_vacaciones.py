"""Mis vacaciones.

Lo que se protege (19/10/2026): cada persona ve sus días por período (los
que le corresponden, los gozados y los pendientes) sin permiso; ver los de
otra persona pide `vacaciones.ver_todas`; lo gozado no deja pendientes
negativos.
"""

import datetime

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion.models import GoceVacaciones, PeriodoVacaciones
from apps.organizacion.tests.test_organigrama import _cuenta

MIAS = "/api/v1/organizacion/vacaciones/mias/"
TODAS = "/api/v1/organizacion/vacaciones/"


def _periodo(usuario, anio, dias, *goces):
    with usando_empresa(empresa_actual()):
        periodo = PeriodoVacaciones.objects.create(
            usuario=usuario,
            desde=datetime.date(anio, 3, 1),
            hasta=datetime.date(anio + 1, 2, 28),
            dias_correspondientes=dias,
        )
        for dias_gozados in goces:
            GoceVacaciones.objects.create(
                periodo=periodo,
                desde=datetime.date(anio + 1, 7, 1),
                hasta=datetime.date(anio + 1, 7, dias_gozados),
                dias=dias_gozados,
            )
    return periodo


def test_cada_quien_ve_sus_dias_por_periodo(db):
    rosa, cliente = _cuenta("rosa")
    _periodo(rosa, 2023, 15, 15)  # gozado completo
    _periodo(rosa, 2024, 15, 5, 3)  # gozó 8, le quedan 7
    _periodo(rosa, 2025, 16)  # nada gozado

    datos = cliente.get(MIAS).json()
    resumen = [(p["nombre"], p["gozados"], p["pendientes"]) for p in datos["periodos"]]
    assert resumen == [
        ("2023 – 2024", 15, 0),
        ("2024 – 2025", 8, 7),
        ("2025 – 2026", 0, 16),
    ]
    assert (datos["correspondientes"], datos["gozados"], datos["pendientes"]) == (46, 23, 23)
    assert datos["periodos_con_pendientes"] == 2
    assert len(datos["periodos"][1]["goces"]) == 2


def test_lo_gozado_de_mas_no_deja_pendientes_negativos(db):
    rosa, cliente = _cuenta("rosa")
    _periodo(rosa, 2024, 15, 10, 8)
    assert cliente.get(MIAS).json()["periodos"][0]["pendientes"] == 0


def test_las_de_otros_piden_permiso(db):
    rosa, _ = _cuenta("rosa")
    _periodo(rosa, 2024, 15, 5)
    _, otro = _cuenta("ema")
    _, th = _cuenta("tania", "vacaciones.ver_todas")

    assert otro.get(TODAS).status_code == 403
    assert otro.get(TODAS, {"usuario": rosa.id}).status_code == 403
    lista = {p["nombre"]: p["pendientes"] for p in th.get(TODAS).json()}
    assert lista["Rosa"] == 10
    detalle = th.get(TODAS, {"usuario": rosa.id}).json()
    assert detalle["persona"]["nombre"] == "Rosa"
    assert detalle["pendientes"] == 10
