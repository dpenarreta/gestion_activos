"""Las restricciones de cada tipo de permiso (20/10/2026).

Lo que se protege, con la regla de vacaciones del pedido:

- Mínimo 5 días seguidos por solicitud: se informa y no deja enviar menos.
- Se descuenta de las vacaciones pendientes, del período más antiguo al más
  nuevo, y al aprobarse queda como gozado.
- De cada período anual (15 días) salen al menos 2 sábados y 2 domingos: un
  período no se completa solo con días de semana. Cuando sus días pendientes
  son justo los fines de semana que le faltan, se marcan por defecto los
  sábados y domingos libres siguientes y se avisa a la persona.
"""

import datetime

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.licencias.tests.test_licencias import (  # noqa: F401 (fixture)
    FLUJOS,
    SOLICITUDES,
    empresa_con_organigrama,
)
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import GoceVacaciones, PeriodoVacaciones

D = datetime.date


def _evaluar(cliente, flujo, desde, hasta):
    respuesta = cliente.get(
        f"/api/v1/licencias/tipos/{flujo}/evaluar/", {"desde": desde, "hasta": hasta}
    )
    assert respuesta.status_code == 200, respuesta.data
    return respuesta.json()


def _por_clave(resultado):
    return {r["clave"].split("-")[0]: r for r in resultado["reglas"]}


def _con_reglas(e):
    _, admin = e["admin"]
    respuesta = admin.patch(
        f"{FLUJOS}{e['vacaciones']}/",
        {
            "dias_minimos": 5,
            "descuenta_vacaciones": True,
            "sabados_por_periodo": 2,
            "domingos_por_periodo": 2,
            "restricciones": "Pídalas con 15 días de anticipación.",
        },
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data


def _periodo(usuario, desde, goces=()):
    with usando_empresa(empresa_actual()):
        periodo = PeriodoVacaciones.objects.create(
            usuario=usuario,
            desde=desde,
            hasta=desde.replace(year=desde.year + 1) - datetime.timedelta(days=1),
        )
        for inicio, fin in goces:
            GoceVacaciones.objects.create(
                periodo=periodo, desde=inicio, hasta=fin, dias=(fin - inicio).days + 1
            )
    return periodo


def test_el_minimo_de_dias_se_informa_y_no_deja_enviar_menos(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _periodo(usuario, D(2024, 6, 1))

    corto = _por_clave(_evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-04"))
    assert corto["minimo"]["estado"] == "falla"
    assert corto["minimo"]["texto"] == "Mínimo 5 días seguidos por solicitud."
    assert corto["nota"]["texto"] == "Pídalas con 15 días de anticipación."
    respuesta = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-04"},
        format="multipart",
    )
    assert respuesta.status_code == 400
    assert "Mínimo 5 días" in str(respuesta.data)

    bien = _evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    assert bien["bloquea"] is False
    reglas = _por_clave(bien)
    assert reglas["minimo"]["estado"] == "ok"
    assert "5 del período 2024 – 2025" in reglas["saldo"]["detalle"]
    # Cinco días de semana: faltan los fines de semana, pero aún hay margen.
    assert reglas["fines"]["estado"] == "aviso"
    assert "0 de 2 sábados y 0 de 2 domingos" in reglas["fines"]["detalle"]


def test_un_periodo_no_se_completa_sin_fines_de_semana(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, jefa = e["jefa"]
    _, th = e["th"]
    # 2024–2025: ya gozó 10 días de semana; le quedan 5, y 4 deben ser fin de semana.
    viejo = _periodo(
        usuario,
        D(2024, 6, 1),
        goces=[(D(2026, 1, 5), D(2026, 1, 9)), (D(2026, 2, 2), D(2026, 2, 6))],
    )
    nuevo = _periodo(usuario, D(2025, 6, 1))

    resultado = _evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    assert resultado["bloquea"] is False
    reglas = {r["clave"]: r for r in resultado["reglas"]}
    assert "1 del período 2024 – 2025; 4 del período 2025 – 2026" in reglas["saldo"]["detalle"]
    marcado = reglas[f"fines-{viejo.pk}"]
    assert marcado["estado"] == "aviso"
    assert (
        "sábado 07/11/2026, domingo 08/11/2026, sábado 14/11/2026, domingo 15/11/2026"
        in marcado["detalle"]
    )

    # Aprobada: los días quedan gozados y los fines de semana, marcados.
    solicitud = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-06"},
        format="multipart",
    ).json()
    jefa.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/")
    assert th.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").json()["estado"] == "aprobada"
    with usando_empresa(empresa_actual()):
        del_viejo = sorted(
            (g.desde, g.dias, g.descripcion.startswith("Marcado por defecto"))
            for g in viejo.goces.filter(desde__gte=D(2026, 11, 1))
        )
        del_nuevo = [(g.desde, g.hasta, g.dias) for g in nuevo.goces.all()]
    assert del_viejo == [
        (D(2026, 11, 2), 1, False),
        (D(2026, 11, 7), 1, True),
        (D(2026, 11, 8), 1, True),
        (D(2026, 11, 14), 1, True),
        (D(2026, 11, 15), 1, True),
    ]
    assert del_nuevo == [(D(2026, 11, 3), D(2026, 11, 6), 4)]
    assert (
        Notificacion.objects.todas()
        .filter(usuario=usuario, tipo="licencias.fines_de_semana")
        .exists()
    )


def test_no_se_piden_mas_dias_de_los_que_alcanzan(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _periodo(usuario, D(2024, 6, 1), goces=[(D(2026, 1, 5), D(2026, 1, 9))])

    # Le quedan 10, pero 4 son para fines de semana: 7 días de semana no caben.
    resultado = _evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-10")
    saldo = _por_clave(resultado)["saldo"]
    assert resultado["bloquea"] is True
    assert saldo["estado"] == "falla"
    assert "le alcanzan" in saldo["detalle"]

    # Una solicitud pendiente reserva sus días: la siguiente ya no los cuenta.
    pendiente = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-06"},
        format="multipart",
    )
    assert pendiente.status_code == 201, pendiente.data
    otra = _por_clave(_evaluar(ana, e["vacaciones"], "2026-12-07", "2026-12-11"))
    assert otra["saldo"]["estado"] == "falla"


def test_un_tipo_sin_restricciones_no_las_muestra(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    resultado = _evaluar(ana, e["medico"], "2026-11-02", "2026-11-02")
    assert resultado == {"reglas": [], "bloquea": False}


def test_un_tipo_sin_motivo_no_lo_guarda(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, admin = e["admin"]
    _, ana = e["ana"]
    admin.patch(f"{FLUJOS}{e['vacaciones']}/", {"pide_motivo": False}, format="json")
    tipos = {t["nombre"]: t for t in ana.get("/api/v1/licencias/tipos/").json()}
    assert tipos["Vacaciones"]["pide_motivo"] is False
    assert tipos["Permiso médico"]["pide_motivo"] is True
    solicitud = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-06", "motivo": "x"},
        format="multipart",
    ).json()
    assert solicitud["motivo"] == ""
