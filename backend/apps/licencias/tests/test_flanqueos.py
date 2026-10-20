"""Solicitud de permisos: los intentos de saltarse el flujo (20/10/2026).

Cada prueba intenta un flanqueo concreto por la API (no por la pantalla, que
se puede saltar) y comprueba que el servidor lo impide. El detalle de cada
regla está en docs/solicitud-de-permisos.md.
"""

import datetime

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.licencias.models import FlujoPermiso, SolicitudPermiso
from apps.licencias.tests.test_licencias import (  # noqa: F401 (fixture)
    FLUJOS,
    SOLICITUDES,
    _persona,
    empresa_con_organigrama,
)
from apps.licencias.tests.test_restricciones import _con_reglas, _evaluar, _periodo
from apps.organizacion.models import GoceVacaciones

D = datetime.date


def _post(cliente, flujo, desde, hasta, **extra):
    return cliente.post(
        SOLICITUDES,
        {"flujo": flujo, "desde": desde, "hasta": hasta, **extra},
        format="multipart",
    )


def _aprobar(cliente, solicitud_id):
    return cliente.post(f"{SOLICITUDES}{solicitud_id}/aprobar/")


# --- Fechas -------------------------------------------------------------------------------


def test_no_se_piden_fechas_que_se_cruzan_con_otra_solicitud(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _periodo(usuario, D(2024, 6, 1))
    primera = _post(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    assert primera.status_code == 201, primera.data

    # Ni el mismo tipo ni otro: un permiso médico en medio de sus vacaciones.
    for flujo, desde, hasta in (
        (e["vacaciones"], "2026-11-05", "2026-11-11"),
        (e["medico"], "2026-11-04", "2026-11-04"),
    ):
        cruce = _post(ana, flujo, desde, hasta)
        assert cruce.status_code == 400
        assert "se cruzan con otra solicitud" in str(cruce.data)

    # Cancelada la primera, las fechas quedan libres.
    ana.post(f"{SOLICITUDES}{primera.json()['id']}/cancelar/")
    assert _post(ana, e["medico"], "2026-11-04", "2026-11-04").status_code == 201


def test_no_se_piden_dias_que_ya_constan_como_gozados(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _periodo(usuario, D(2024, 6, 1), goces=[(D(2026, 11, 2), D(2026, 11, 6))])
    respuesta = _post(ana, e["vacaciones"], "2026-11-06", "2026-11-12")
    assert respuesta.status_code == 400
    assert "ya constan como vacaciones gozadas" in str(respuesta.data)


def test_sin_periodos_de_vacaciones_no_hay_dias_que_pedir(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    _, ana = e["ana"]
    respuesta = _post(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    assert respuesta.status_code == 400
    assert "Tiene 0 días pendientes" in str(respuesta.data)


def test_los_fines_de_semana_por_defecto_no_caen_sobre_otra_solicitud(
    empresa_con_organigrama,
):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    viejo = _periodo(
        usuario,
        D(2024, 6, 1),
        goces=[(D(2026, 1, 5), D(2026, 1, 9)), (D(2026, 2, 2), D(2026, 2, 6))],
    )
    _periodo(usuario, D(2025, 6, 1))
    # Un permiso médico el sábado 07/11: ese día no se marca.
    assert _post(ana, e["medico"], "2026-11-07", "2026-11-07").status_code == 201
    reglas = {
        r["clave"]: r for r in _evaluar(ana, e["vacaciones"], "2026-11-02", "2026-11-06")["reglas"]
    }
    detalle = reglas[f"fines-{viejo.pk}"]["detalle"]
    assert "07/11/2026" not in detalle
    assert "domingo 08/11/2026, sábado 14/11/2026, domingo 15/11/2026, sábado 21/11/2026" in (
        detalle
    )


# --- Al aprobar ---------------------------------------------------------------------------


def test_al_aprobar_se_vuelve_a_comprobar_que_los_dias_alcanzan(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, jefa = e["jefa"]
    _, th = e["th"]
    periodo = _periodo(usuario, D(2024, 6, 1))
    solicitud = _post(ana, e["vacaciones"], "2026-11-02", "2026-11-06").json()
    assert _aprobar(jefa, solicitud["id"]).status_code == 200

    # Entretanto, Talento Humano carga 10 días gozados: ya no alcanzan.
    with usando_empresa(empresa_actual()):
        GoceVacaciones.objects.create(
            periodo=periodo, desde=D(2026, 3, 2), hasta=D(2026, 3, 11), dias=10
        )
    respuesta = _aprobar(th, solicitud["id"])
    assert respuesta.status_code == 400
    assert "ya no le alcanzan" in str(respuesta.data)
    # No quedó a medias: sigue pendiente de Talento Humano y sin días registrados.
    detalle = th.get(f"{SOLICITUDES}{solicitud['id']}/").json()
    assert detalle["estado"] == "pendiente"
    assert [p["nombre"] for p in detalle["pendiente_de"]] == ["Tatiana"]
    with usando_empresa(empresa_actual()):
        assert periodo.goces.count() == 1


def test_al_aprobar_no_se_registran_dias_que_ya_se_gozaron(empresa_con_organigrama):
    e = empresa_con_organigrama
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, jefa = e["jefa"]
    _, th = e["th"]
    periodo = _periodo(usuario, D(2024, 6, 1))
    solicitud = _post(ana, e["vacaciones"], "2026-11-02", "2026-11-06").json()
    _aprobar(jefa, solicitud["id"])
    with usando_empresa(empresa_actual()):
        GoceVacaciones.objects.create(
            periodo=periodo, desde=D(2026, 11, 3), hasta=D(2026, 11, 3), dias=1
        )
    respuesta = _aprobar(th, solicitud["id"])
    assert respuesta.status_code == 400
    assert "ya constan como vacaciones gozadas" in str(respuesta.data)


def test_nadie_aprueba_dos_pasos_de_la_misma_solicitud(empresa_con_organigrama):
    e = empresa_con_organigrama
    jefa_usuario, jefa = e["jefa"]
    _, admin = e["admin"]
    _, ana = e["ana"]
    # El segundo paso lo aprobaría la misma jefa que aprueba el primero.
    flujo = admin.get(f"{FLUJOS}{e['vacaciones']}/").json()
    flujo["pasos"][1]["aprobadores"] = [{"tipo": "persona", "usuario": jefa_usuario.id}]
    assert admin.put(f"{FLUJOS}{e['vacaciones']}/", flujo, format="json").status_code == 200

    solicitud = _post(ana, e["vacaciones"], "2026-11-02", "2026-11-06").json()
    paso2 = _aprobar(jefa, solicitud["id"]).json()
    assert paso2["paso_actual"] == "Talento Humano"
    # Ella queda fuera; pasa a quien administra los flujos.
    assert [p["nombre"] for p in paso2["pendiente_de"]] == ["Ines"]
    assert _aprobar(jefa, solicitud["id"]).status_code == 403


def test_no_se_aprueba_dos_veces_ni_lo_ya_cerrado(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, th = e["th"]
    solicitud = _post(ana, e["medico"], "2026-11-02", "2026-11-02").json()
    assert _aprobar(th, solicitud["id"]).json()["estado"] == "aprobada"
    assert _aprobar(th, solicitud["id"]).status_code == 400
    rechazo = th.post(f"{SOLICITUDES}{solicitud['id']}/rechazar/", {"comentario": "No"})
    assert rechazo.status_code == 400
    # Tampoco se cancela lo aprobado (sus días ya se registraron).
    assert ana.post(f"{SOLICITUDES}{solicitud['id']}/cancelar/").status_code == 400


# --- Escalar -------------------------------------------------------------------------------


def test_no_se_escala_a_uno_mismo_para_saltarse_a_los_aprobadores(empresa_con_organigrama):
    e = empresa_con_organigrama
    admin_usuario, admin = e["admin"]
    jefa_usuario, jefa = e["jefa"]
    _, ana = e["ana"]
    solicitud = _post(ana, e["medico"], "2026-11-02", "2026-11-02").json()
    url = f"{SOLICITUDES}{solicitud['id']}/escalar/"
    # Quien ve todas no se la asigna para aprobarla.
    a_si_mismo = admin.post(
        url, {"destino": {"tipo": "persona", "usuario": admin_usuario.id}}, format="json"
    )
    assert a_si_mismo.status_code == 400
    # Ni quien la tiene pendiente.
    assert (
        jefa.post(
            url, {"destino": {"tipo": "persona", "usuario": jefa_usuario.id}}, format="json"
        ).status_code
        == 400
    )
    # Ni se escala a quien la pidió.
    ana_usuario = e["ana"][0]
    assert (
        jefa.post(
            url, {"destino": {"tipo": "persona", "usuario": ana_usuario.id}}, format="json"
        ).status_code
        == 400
    )
    # Quien no la tiene pendiente ni ve todas, no escala.
    _, gerente = e["gerente"]
    assert gerente.post(
        url, {"destino": {"tipo": "persona", "usuario": jefa_usuario.id}}, format="json"
    ).status_code in (403, 404)


# --- Lo que no se puede tocar ---------------------------------------------------------------


def test_una_solicitud_no_se_edita_ni_se_borra(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, admin = e["admin"]
    solicitud = _post(ana, e["medico"], "2026-11-02", "2026-11-02").json()
    url = f"{SOLICITUDES}{solicitud['id']}/"
    for cliente in (ana, admin):
        assert cliente.patch(url, {"hasta": "2026-11-20"}, format="json").status_code == 405
        assert cliente.put(url, {"hasta": "2026-11-20"}, format="json").status_code == 405
        assert cliente.delete(url).status_code == 405
    # Ni se fija de quién queda pendiente al crearla.
    gerente_usuario = e["gerente"][0]
    otra = _post(
        ana, e["medico"], "2026-11-09", "2026-11-09", pendiente_de=gerente_usuario.id
    ).json()
    assert "Gerardo" not in {p["nombre"] for p in otra["pendiente_de"]}


def test_un_tipo_inactivo_no_se_solicita_ni_se_evalua(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, admin = e["admin"]
    _, ana = e["ana"]
    admin.patch(f"{FLUJOS}{e['medico']}/", {"activo": False}, format="json")
    assert _post(ana, e["medico"], "2026-11-02", "2026-11-02").status_code == 400
    evaluar = ana.get(
        f"/api/v1/licencias/tipos/{e['medico']}/evaluar/",
        {"desde": "2026-11-02", "hasta": "2026-11-02"},
    )
    assert evaluar.status_code == 404


def test_solo_ven_una_solicitud_quienes_tienen_que_ver_con_ella(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, gerente = e["gerente"]
    _, extrano = _persona("pablo")
    solicitud = _post(ana, e["medico"], "2026-11-02", "2026-11-02").json()
    for cliente in (gerente, extrano):
        assert cliente.get(f"{SOLICITUDES}{solicitud['id']}/").status_code == 404
        assert cliente.get(f"{SOLICITUDES}{solicitud['id']}/adjunto/").status_code == 404


def test_las_restricciones_solo_las_configura_quien_administra(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, jefa = e["jefa"]
    for cliente in (ana, jefa):
        assert (
            cliente.patch(
                f"{FLUJOS}{e['vacaciones']}/", {"dias_minimos": 0}, format="json"
            ).status_code
            == 403
        )
    with usando_empresa(empresa_actual()):
        assert FlujoPermiso.objects.get(pk=e["vacaciones"]).dias_minimos == 0
        assert not SolicitudPermiso.objects.exists()


# --- Quién puede solicitar ------------------------------------------------------------------


def test_sin_rol_asignado_no_se_solicita_ningun_tipo(empresa_con_organigrama):
    e = empresa_con_organigrama
    usuario, sin_rol = _persona("rocio", con_rol=False)
    _periodo(usuario, D(2024, 6, 1))
    assert sin_rol.get(f"{SOLICITUDES}resumen/").json()["puede_solicitar"] is False
    for flujo in (e["vacaciones"], e["medico"]):
        evaluacion = _evaluar(sin_rol, flujo, "2026-11-02", "2026-11-06")
        assert evaluacion["bloquea"] is True
        assert evaluacion["reglas"][0]["texto"] == (
            "Necesita un rol asignado para solicitar permisos."
        )
        respuesta = _post(sin_rol, flujo, "2026-11-02", "2026-11-06")
        assert respuesta.status_code == 400
        assert "Necesita un rol asignado" in str(respuesta.data)

    # Con un rol global también puede; y el superusuario, sin rol.
    from django.contrib.auth.models import Group

    usuario.groups.add(Group.objects.get_or_create(name="Colaborador")[0])
    assert _post(sin_rol, e["medico"], "2026-11-02", "2026-11-02").status_code == 201
    raiz, cliente_raiz = _persona("root", con_rol=False)
    raiz.is_superuser = True
    raiz.save()
    assert cliente_raiz.get(f"{SOLICITUDES}resumen/").json()["puede_solicitar"] is True
