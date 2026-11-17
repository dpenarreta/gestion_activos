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


def test_el_minimo_de_dias_solo_alerta_y_deja_enviar(empresa_con_organigrama):
    """Recomendación y no bloqueo (17/11/2026): la decisión es de Talento
    Humano."""
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _periodo(usuario, D(2024, 6, 1))

    corto = _evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-04")
    reglas = _por_clave(corto)
    assert reglas["minimo"]["estado"] == "aviso"
    assert reglas["minimo"]["texto"] == "Mínimo 5 días seguidos por solicitud."
    assert reglas["nota"]["texto"] == "Pídalas con 15 días de anticipación."
    assert corto["bloquea"] is False
    respuesta = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-04"},
        format="multipart",
    )
    assert respuesta.status_code == 201, respuesta.data

    bien = _por_clave(_evaluar(ana, e["vacaciones"], "2026-11-09", "2026-11-13"))
    assert bien["minimo"]["estado"] == "ok"
    # Cinco días de semana: faltan los fines de semana, pero aún hay margen.
    assert bien["fines"]["estado"] == "info"
    assert "0 de 2 sábados y 0 de 2 domingos" in bien["fines"]["detalle"]


def test_los_fines_de_semana_solo_alertan_y_no_se_marcan_solos(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, jefa = e["jefa"]
    _, th = e["th"]
    # 2024–2025: ya gozó 10 días de semana; le quedan 5 y faltan 4 de fin de semana.
    viejo = _periodo(
        usuario,
        D(2024, 6, 1),
        goces=[(D(2026, 1, 5), D(2026, 1, 9)), (D(2026, 2, 2), D(2026, 2, 6))],
    )
    nuevo = _periodo(usuario, D(2025, 6, 1))

    resultado = _evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    assert resultado["bloquea"] is False
    reglas = {r["clave"]: r for r in resultado["reglas"]}
    # Los días ya no se reservan para los fines de semana: salen del más viejo.
    assert "5 del período 2024 – 2025" in reglas["saldo"]["detalle"]
    alerta = reglas[f"fines-{viejo.pk}"]
    assert alerta["estado"] == "aviso"
    assert "ya no alcanzan para los fines de semana recomendados" in alerta["detalle"]

    solicitud = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-06"},
        format="multipart",
    ).json()
    jefa.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/")
    assert th.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").json()["estado"] == "aprobada"
    with usando_empresa(empresa_actual()):
        del_viejo = [
            (g.desde, g.hasta, g.dias) for g in viejo.goces.filter(desde__gte=D(2026, 11, 1))
        ]
        assert not nuevo.goces.exists()
        assert not viejo.goces.filter(descripcion__startswith="Marcado por defecto").exists()
    assert del_viejo == [(D(2026, 11, 2), D(2026, 11, 6), 5)]
    assert (
        not Notificacion.objects.todas()
        .filter(usuario=usuario, tipo="licencias.fines_de_semana")
        .exists()
    )


def test_pedir_mas_dias_de_los_que_tiene_alerta_y_al_aprobar_queda_adelanto(
    empresa_con_organigrama,
):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, jefa = e["jefa"]
    _, th = e["th"]
    periodo = _periodo(usuario, D(2024, 6, 1), goces=[(D(2026, 1, 5), D(2026, 1, 16))])

    # Le quedan 3 y pide 5: se alerta, pero se puede enviar.
    resultado = _evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    saldo = _por_clave(resultado)["saldo"]
    assert resultado["bloquea"] is False
    assert saldo["estado"] == "aviso"
    assert "Tiene 3 días pendientes y pide 5" in saldo["detalle"]
    assert "2 días quedan como adelanto" in saldo["detalle"]

    solicitud = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-06"},
        format="multipart",
    )
    assert solicitud.status_code == 201, solicitud.data
    jefa.post(f"{SOLICITUDES}{solicitud.json()['id']}/aprobar/")
    assert th.post(f"{SOLICITUDES}{solicitud.json()['id']}/aprobar/").json()["estado"] == "aprobada"
    with usando_empresa(empresa_actual()):
        goces = sorted(
            (g.desde, g.dias, g.descripcion.startswith("Adelanto"))
            for g in periodo.goces.filter(desde__gte=D(2026, 11, 1))
        )
    assert goces == [(D(2026, 11, 2), 3, False), (D(2026, 11, 5), 2, True)]


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


def test_quien_aprueba_ve_lo_que_necesita_para_decidir(empresa_con_organigrama):
    """Auditoría UX/UI de la revisión (29/10/2026): el detalle trae el cargo y
    el área de quien pide, sus restricciones evaluadas sin contar la propia
    solicitud contra sí misma, y los feriados de esas fechas."""
    from apps.organizacion.models import EventoCalendario

    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, jefa = e["jefa"]
    _periodo(usuario, D(2024, 6, 1))
    with usando_empresa(empresa_actual()):
        EventoCalendario.objects.create(titulo="Difuntos", tipo="feriado", fecha=D(2026, 11, 2))
    creada = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-06"},
        format="multipart",
    )
    assert creada.status_code == 201, creada.data

    detalle = jefa.get(f"{SOLICITUDES}{creada.json()['id']}/").json()
    assert detalle["cargo"] == "Analista"
    assert detalle["area"] == "Empresa"
    assert detalle["feriados"] == ["2026-11-02"]
    reglas = _por_clave(detalle["evaluacion"])
    # No se cruza consigo misma y sus días no se descuentan dos veces.
    assert "cruce" not in reglas
    assert reglas["saldo"]["estado"] == "ok"
    assert "Tiene 15 días pendientes" in reglas["saldo"]["detalle"]
    assert detalle["evaluacion"]["bloquea"] is False

    # Cerrada, ya no se evalúa (sus días constan como gozados).
    jefa.post(f"{SOLICITUDES}{creada.json()['id']}/rechazar/", {"comentario": "No"})
    assert jefa.get(f"{SOLICITUDES}{creada.json()['id']}/").json()["evaluacion"] is None


def test_mis_vacaciones_cuenta_lo_reservado_como_al_pedir(empresa_con_organigrama):
    """Auditoría UX/UI de Mis vacaciones (30/10/2026): el saldo cuenta lo que
    está en aprobación (como al pedir), con los fines de semana de la regla y
    las solicitudes en curso."""
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _periodo(usuario, D(2024, 6, 1))
    creada = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-02", "hasta": "2026-11-08"},
        format="multipart",
    )
    assert creada.status_code == 201, creada.data

    datos = ana.get("/api/v1/organizacion/vacaciones/mias/").json()
    periodo = datos["periodos"][0]
    assert periodo["gozados"] == 0
    assert periodo["reservados"] == 7
    assert periodo["disponibles"] == 8
    # Del 2 al 8 de noviembre: un sábado y un domingo.
    assert (periodo["sabados"], periodo["domingos"]) == (1, 1)
    assert datos["regla"] == {"sabados": 2, "domingos": 2}
    assert datos["disponibles"] == 8
    assert [s["id"] for s in datos["en_curso"]] == [creada.json()["id"]]
    # El mismo número que da Solicitud de permisos al pedir otra.
    otra = _por_clave(_evaluar(ana, e["vacaciones"], "2026-12-07", "2026-12-11"))
    assert "Tiene 8 días pendientes" in otra["saldo"]["detalle"]
