"""Bitácora y respaldo del organigrama (26/10/2026).

Cada cambio a la estructura pide el motivo y deja una versión con quién,
cuándo, desde qué IP, por qué y qué cambió, más el respaldo de cómo estaba
todo antes. Con él se revierte (y revertir es otro cambio, con su motivo).
Solo se guardan las 2 últimas versiones.
"""

from urllib.parse import quote

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion.models import Cargo, DatosDeContacto, VersionOrganigrama
from apps.organizacion.tests.test_carga_personas import _cuenta, _estructura

BASE = "/api/v1/organizacion/"
VERSIONES = f"{BASE}organigrama/versiones/"


def _con_motivo(cliente, motivo):
    cliente.credentials(HTTP_X_MOTIVO_CAMBIO=quote(motivo))
    return cliente


def _versiones():
    with usando_empresa(empresa_actual()):
        return list(VersionOrganigrama.objects.order_by("created_at", "id"))


def test_sin_motivo_no_se_cambia_nada(db):
    cargos = _estructura()
    _, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    cliente.credentials(HTTP_X_MOTIVO_CAMBIO="")
    respuesta = cliente.patch(
        f"{BASE}cargos/{cargos['analista'].id}/", {"nombre": "Analista"}, format="json"
    )
    assert respuesta.status_code == 400 and "motivo" in str(respuesta.data)
    with usando_empresa(empresa_actual()):
        assert Cargo.objects.get(pk=cargos["analista"].id).nombre == "Analista comercial"
    assert _versiones() == []


def test_cada_cambio_deja_quien_cuando_ip_motivo_y_que_cambio(db):
    cargos = _estructura()
    ana, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    _con_motivo(cliente, "Reestructuración de Comercial aprobada por gerencia")
    respuesta = cliente.post(
        f"{BASE}cargos/",
        {"nombre": "Asistente comercial", "unidad": cargos["gerente"].unidad_id},
        format="json",
        REMOTE_ADDR="10.0.2.80",
    )
    assert respuesta.status_code == 201, respuesta.data
    (version,) = _versiones()
    assert version.usuario == ana and version.ip == "10.0.2.80"
    assert version.motivo == "Reestructuración de Comercial aprobada por gerencia"
    assert version.cambios == ["Nuevo cargo «Asistente comercial»."]
    # El respaldo es de antes: ahí no estaba el cargo nuevo.
    assert "Asistente comercial" not in [c["nombre"] for c in version.respaldo["cargos"]]

    filas = cliente.get(VERSIONES).json()
    assert filas[0]["usuario"] == "Ana Prueba" and filas[0]["ip"] == "10.0.2.80"
    assert filas[0]["fecha"] and filas[0]["hora"]


def test_solo_quedan_las_dos_ultimas(db):
    cargos = _estructura()
    _, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    url = f"{BASE}cargos/{cargos['analista'].id}/"
    for i, nombre in enumerate(["Analista A", "Analista B", "Analista C"]):
        _con_motivo(cliente, f"Cambio número {i + 1}")
        assert cliente.patch(url, {"nombre": nombre}, format="json").status_code == 200
    motivos = [v.motivo for v in _versiones()]
    assert motivos == ["Cambio número 2", "Cambio número 3"]


def test_revertir_deja_todo_como_estaba_y_es_otro_cambio(db):
    cargos = _estructura()
    pedro, _ = _cuenta("pedro")
    _, cliente = _cuenta(
        "ana", "institucional.ver", "institucional.editar", "institucional.asignar"
    )
    _con_motivo(cliente, "Nuevo nombre del cargo")
    cliente.patch(f"{BASE}cargos/{cargos['analista'].id}/", {"nombre": "Ejecutivo"}, format="json")
    _con_motivo(cliente, "Ingresó Pedro al área")
    cliente.post(
        f"{BASE}asignaciones/",
        {"usuario": pedro.id, "cargo": cargos["analista"].id},
        format="json",
    )
    primera, segunda = _versiones()
    assert segunda.cambios == ["Pedro Prueba: cargo — → Ejecutivo."]

    # La vista previa dice qué va a pasar.
    previa = cliente.get(f"{VERSIONES}{primera.id}/revertir/").json()["cambios"]
    assert any("Ejecutivo → Analista comercial" in c for c in previa)
    assert any("Pedro Prueba" in c for c in previa)

    cliente.credentials(HTTP_X_MOTIVO_CAMBIO="")
    sin_motivo = cliente.post(f"{VERSIONES}{primera.id}/revertir/", format="json")
    assert sin_motivo.status_code == 400
    _con_motivo(cliente, "Se aplicó por error")
    respuesta = cliente.post(f"{VERSIONES}{primera.id}/revertir/", format="json")
    assert respuesta.status_code == 200, respuesta.data
    with usando_empresa(empresa_actual()):
        assert Cargo.objects.get(pk=cargos["analista"].id).nombre == "Analista comercial"
        assert not DatosDeContacto.objects.filter(usuario=pedro, cargo__isnull=False).exists()
    # Revertir también queda en la bitácora (y la más antigua se borró).
    ultima = _versiones()[-1]
    assert ultima.revierte == primera.id and ultima.motivo == "Se aplicó por error"
    assert len(_versiones()) == 2


def test_revertir_un_borrado_vuelve_a_crear_el_cargo_con_su_rol(db):
    cargos = _estructura()
    _, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    _con_motivo(cliente, "El cargo ya no existe")
    assert cliente.delete(f"{BASE}cargos/{cargos['analista'].id}/").status_code == 204
    (version,) = _versiones()
    assert version.cambios == ["Se borró el cargo «Analista comercial»."]

    _con_motivo(cliente, "Sí se necesita el cargo")
    assert cliente.post(f"{VERSIONES}{version.id}/revertir/", format="json").status_code == 200
    with usando_empresa(empresa_actual()):
        nuevo = Cargo.objects.get(nombre="Analista comercial")
        assert nuevo.unidad_id == cargos["analista"].unidad_id
        assert nuevo.jefe_id == cargos["gerente"].id and nuevo.plazas == 2
        assert nuevo.rol_id is not None


def test_ver_la_bitacora_y_revertir_piden_permiso(db):
    _estructura()
    _, nadie = _cuenta("nadie")
    _, asigna = _cuenta("lucia", "institucional.asignar")
    assert nadie.get(VERSIONES).status_code == 403
    assert asigna.get(VERSIONES).status_code == 200
    _, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    _con_motivo(cliente, "Para probar permisos")
    cliente.post(f"{BASE}niveles/", {"nombre": "Coordinación", "orden": 3}, format="json")
    (version,) = _versiones()
    assert asigna.post(f"{VERSIONES}{version.id}/revertir/", format="json").status_code == 403
