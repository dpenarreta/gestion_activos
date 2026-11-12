"""Cancelar vacaciones (o permisos) ya aprobados (US-012, 12/11/2026).

Lo que se protege:

- El momento de la aprobada respecto a hoy (zona del proyecto): «por
  empezar», «en curso» o «terminada».
- Por empezar: se devuelven todos los días y se borran todas las ausencias;
  `devolver` se ignora. En curso o terminada se elige `restantes` (solo en
  curso), `todos` o `ninguno`; las ausencias de hoy en adelante se borran
  siempre y las pasadas solo con `todos`.
- La persona, con `licencias.cancelar_aprobadas_propias`: por empezar, sí; en
  curso, solo `restantes`; terminada, no. Gestión Humana, con
  `licencias.anular_aprobadas`: todo, en las de otros.
- Comentario obligatorio; 400 en `devolver` con una opción no permitida; 403
  auditado sin permiso; 400 «La solicitud ya está cerrada» al repetir.
- Avisos: jefe inmediato, la persona si canceló otro y, en curso o
  terminada, quienes aprobaron; nunca quien canceló.
- «Mis vacaciones» (propia y de otra persona) y el detalle dicen lo mismo.
- El permiso nuevo: catálogo, `PERMISOS_BASE` y la migración `roles/0050`.

Las fechas son relativas a hoy para que el momento no cambie con el
calendario.
"""

import datetime
import importlib

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.ausencias.models import LeaveRecord
from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.licencias import services
from apps.licencias.models import AccionSolicitud, SolicitudPermiso
from apps.licencias.tests.test_ausencias_generadas import (  # noqa: F401 (fixture)
    FLUJOS,
    SOLICITUDES,
    _aprobar_medico,
    _aprobar_vacaciones,
    _pedida,
    empresa_con_organigrama,
)
from apps.licencias.tests.test_licencias import _persona
from apps.licencias.tests.test_restricciones import _periodo
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import GoceVacaciones
from apps.users.models import User

PROPIAS = "licencias.cancelar_aprobadas_propias"
MIAS = "/api/v1/organizacion/vacaciones/mias/"
DE_TODOS = "/api/v1/organizacion/vacaciones/"
MOTIVO = "Cambió la fecha del matrimonio de mi hermana en Cuenca"
UN_DIA = datetime.timedelta(days=1)


def _iso(dias):
    return (services.hoy() + datetime.timedelta(days=dias)).isoformat()


#: (desde, hasta) relativos a hoy, de 5 días cada uno.
FECHAS = {
    services.POR_EMPEZAR: (10, 14),
    services.EN_CURSO: (-2, 2),
    services.TERMINADA: (-10, -6),
}


def _permiso(codename):
    return Permission.objects.get(content_type__app_label="permissions", codename=codename)


def _cliente(usuario):
    """Un cliente con una instancia nueva del usuario: los permisos se
    memorizan en el objeto, como en cada petición real."""
    cliente = APIClient()
    cliente.force_authenticate(user=User.objects.get(pk=usuario.pk))
    return cliente


@pytest.fixture
def e(empresa_con_organigrama):  # noqa: F811
    """El organigrama de las pruebas de licencias, con «Vacaciones» que
    descuenta de vacaciones (sin regla de fines de semana), dos períodos para
    Ana y el permiso nuevo en el rol de cargo de todos, como `PERMISOS_BASE`."""
    e = empresa_con_organigrama
    Group.objects.get(name="Colaborador").permissions.add(_permiso(PROPIAS))
    _, admin = e["admin"]
    respuesta = admin.patch(
        f"{FLUJOS}{e['vacaciones']}/", {"descuento": "vacaciones"}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    ana, _ = e["ana"]
    hoy = services.hoy()
    _periodo(ana, hoy.replace(year=hoy.year - 3))
    _periodo(ana, hoy.replace(year=hoy.year - 2))
    return e


def _aprobada(e, cuando=None, desde=None, hasta=None):
    ana, _ = e["ana"]
    if cuando is not None:
        desde, hasta = FECHAS[cuando]
    solicitud = _pedida(_cliente(ana), e["vacaciones"], _iso(desde), _iso(hasta))
    _aprobar_vacaciones(e, solicitud["id"])
    assert _goces(solicitud["id"]) == hasta - desde + 1
    return solicitud["id"]


def _goces(solicitud_id):
    return sum(
        GoceVacaciones.objects.todas()
        .filter(descripcion__endswith=f"(solicitud n.º {solicitud_id})")
        .values_list("dias", flat=True)
    )


def _ausencias(solicitud_id):
    return list(
        LeaveRecord.objects.todas()
        .filter(solicitud_id=solicitud_id)
        .order_by("date")
        .values_list("date", flat=True)
    )


def _cancelar(usuario, solicitud_id, comentario=MOTIVO, devolver=None):
    datos = {"comentario": comentario}
    if devolver is not None:
        datos["devolver"] = devolver
    return _cliente(usuario).post(f"{SOLICITUDES}{solicitud_id}/cancelar/", datos, format="json")


def _estado(solicitud_id):
    return SolicitudPermiso.objects.todas().get(pk=solicitud_id).estado


def _avisados(solicitud_id):
    return sorted(
        Notificacion.objects.todas()
        .filter(tipo="licencias.cancelada", enlace__contains=f"solicitud={solicitud_id}")
        .values_list("usuario__username", flat=True)
    )


def _error(respuesta):
    return respuesta.json()["error"]


# --- El momento ------------------------------------------------------------------------


def test_el_momento_se_calcula_con_la_fecha_local():
    hoy = datetime.date(2026, 11, 12)
    solicitud = SolicitudPermiso(desde=hoy, hasta=hoy + 4 * UN_DIA)
    assert services.momento(solicitud, hoy - UN_DIA) == services.POR_EMPEZAR
    assert services.momento(solicitud, hoy) == services.EN_CURSO
    assert services.momento(solicitud, hoy + 4 * UN_DIA) == services.EN_CURSO
    assert services.momento(solicitud, hoy + 5 * UN_DIA) == services.TERMINADA


def test_hoy_es_la_fecha_de_la_zona_del_proyecto(settings):
    from django.utils import timezone

    assert settings.TIME_ZONE == "America/Guayaquil"
    assert services.hoy() == timezone.localdate()


# --- Antes de empezar ----------------------------------------------------------------


def test_la_persona_cancela_antes_de_empezar_y_vuelven_todos_los_dias(e):
    ana, _ = e["ana"]
    sid = _aprobada(e, services.POR_EMPEZAR)
    assert _ausencias(sid)

    # `devolver` se ignora: antes de empezar se devuelve todo.
    respuesta = _cancelar(ana, sid, devolver="ninguno")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["estado"] == "cancelada"
    assert _goces(sid) == 0
    assert _ausencias(sid) == []
    # Su jefa; ni ella misma ni quienes aprobaron (todavía no empezaba).
    assert _avisados(sid) == ["julia"]


def test_gestion_humana_cancela_antes_de_empezar_y_avisa_a_la_persona(e):
    admin, _ = e["admin"]
    sid = _aprobada(e, services.POR_EMPEZAR)
    respuesta = _cancelar(admin, sid)
    assert respuesta.status_code == 200, respuesta.data
    assert _goces(sid) == 0
    assert _ausencias(sid) == []
    assert _avisados(sid) == ["ana", "julia"]


@pytest.mark.parametrize("quien", ["ana", "admin"])
@pytest.mark.parametrize("cuando", [services.POR_EMPEZAR, services.EN_CURSO])
def test_el_comentario_es_obligatorio(e, quien, cuando):
    usuario, _ = e[quien]
    sid = _aprobada(e, cuando)
    respuesta = _cancelar(usuario, sid, comentario="   ", devolver="restantes")
    assert respuesta.status_code == 400
    assert "comentario" in _error(respuesta)["details"]
    assert _estado(sid) == SolicitudPermiso.Estado.APROBADA
    assert _goces(sid) == 5


# --- En curso --------------------------------------------------------------------------


def test_la_persona_en_curso_devuelve_los_dias_que_faltan(e):
    ana, _ = e["ana"]
    sid = _aprobada(e, services.EN_CURSO)
    hoy = services.hoy()
    pasadas = [d for d in _ausencias(sid) if d < hoy]

    respuesta = _cancelar(ana, sid, devolver="restantes")
    assert respuesta.status_code == 200, respuesta.data
    # Vuelven hoy y los dos días siguientes; los dos ya gozados siguen.
    assert _goces(sid) == 2
    [goce] = GoceVacaciones.objects.todas().filter(descripcion__endswith=f"(solicitud n.º {sid})")
    assert (goce.desde, goce.hasta, goce.dias) == (hoy - 2 * UN_DIA, hoy - UN_DIA, 2)
    assert _ausencias(sid) == pasadas
    # La jefa (que además aprobó) y Talento Humano, que aprobó; no Ana.
    assert _avisados(sid) == ["julia", "tatiana"]


@pytest.mark.parametrize("devolver", ["todos", "ninguno", None, ""])
def test_la_persona_en_curso_solo_puede_devolver_los_que_faltan(e, devolver):
    ana, _ = e["ana"]
    sid = _aprobada(e, services.EN_CURSO)
    respuesta = _cancelar(ana, sid, devolver=devolver)
    assert respuesta.status_code == 400
    assert "devolver" in _error(respuesta)["details"]
    assert "Devolver los días que faltan" in str(_error(respuesta)["details"]["devolver"])
    assert _estado(sid) == SolicitudPermiso.Estado.APROBADA
    assert _goces(sid) == 5


def test_una_opcion_que_no_existe_es_400_en_devolver(e):
    admin, _ = e["admin"]
    sid = _aprobada(e, services.EN_CURSO)
    respuesta = _cancelar(admin, sid, devolver="la_mitad")
    assert respuesta.status_code == 400
    assert "devolver" in _error(respuesta)["details"]


@pytest.mark.parametrize(
    ("devolver", "quedan", "pasadas_se_quedan"),
    [("restantes", 2, True), ("todos", 0, False), ("ninguno", 5, True)],
)
def test_gestion_humana_en_curso_elige_entre_las_tres(e, devolver, quedan, pasadas_se_quedan):
    admin, _ = e["admin"]
    sid = _aprobada(e, services.EN_CURSO)
    hoy = services.hoy()
    pasadas = [d for d in _ausencias(sid) if d < hoy]

    respuesta = _cancelar(admin, sid, devolver=devolver)
    assert respuesta.status_code == 200, respuesta.data
    assert _goces(sid) == quedan
    # Las de hoy en adelante se borran siempre; las pasadas, solo con «todos».
    assert _ausencias(sid) == (pasadas if pasadas_se_quedan else [])
    assert _avisados(sid) == ["ana", "julia", "tatiana"]


# --- Terminada -------------------------------------------------------------------------


def test_la_persona_no_cancela_unas_vacaciones_terminadas(e):
    ana, _ = e["ana"]
    sid = _aprobada(e, services.TERMINADA)
    respuesta = _cancelar(ana, sid, devolver="todos")
    assert respuesta.status_code == 403
    assert "Gestión Humana" in _error(respuesta)["message"]
    assert _estado(sid) == SolicitudPermiso.Estado.APROBADA
    assert _goces(sid) == 5
    # Tiene el permiso de las propias: la terminada pedía el de Gestión Humana.
    denegado = AuditLog.objects.get(action="access_denied", actor=ana)
    assert denegado.new_values["required_permission"] == services.PERMISO_ANULAR
    assert str(denegado.target_id) == str(sid)


@pytest.mark.parametrize(("devolver", "quedan"), [("todos", 0), ("ninguno", 5)])
def test_gestion_humana_cancela_unas_terminadas(e, devolver, quedan):
    admin, _ = e["admin"]
    sid = _aprobada(e, services.TERMINADA)
    antes = _ausencias(sid)
    respuesta = _cancelar(admin, sid, devolver=devolver)
    assert respuesta.status_code == 200, respuesta.data
    assert _goces(sid) == quedan
    assert _ausencias(sid) == ([] if devolver == "todos" else antes)
    assert _avisados(sid) == ["ana", "julia", "tatiana"]


def test_terminadas_no_admiten_devolver_los_que_faltan(e):
    admin, _ = e["admin"]
    sid = _aprobada(e, services.TERMINADA)
    respuesta = _cancelar(admin, sid, devolver="restantes")
    assert respuesta.status_code == 400
    assert "devolver" in _error(respuesta)["details"]
    assert _goces(sid) == 5


# --- Sin permiso -----------------------------------------------------------------------


def test_sin_el_permiso_la_persona_no_cancela_ni_antes_de_empezar(e):
    ana, _ = e["ana"]
    sid = _aprobada(e, services.POR_EMPEZAR)
    Group.objects.get(name="Colaborador").permissions.remove(_permiso(PROPIAS))
    detalle = _cliente(ana).get(f"{SOLICITUDES}{sid}/").json()
    assert detalle["puedo"]["cancelar"] is False
    assert detalle["puedo"]["opciones_devolver"] == []

    respuesta = _cancelar(ana, sid)
    assert respuesta.status_code == 403
    assert PROPIAS in _error(respuesta)["message"]
    assert _goces(sid) == 5
    denegados = AuditLog.objects.filter(action="access_denied", actor=ana)
    assert [a.new_values["required_permission"] for a in denegados] == [PROPIAS]


def test_quien_aprobo_sin_anular_aprobadas_no_cancela(e):
    jefa, _ = e["jefa"]
    sid = _aprobada(e, services.EN_CURSO)
    respuesta = _cancelar(jefa, sid, devolver="todos")
    assert respuesta.status_code == 403
    assert _goces(sid) == 5
    [denegado] = AuditLog.objects.filter(action="access_denied", actor=jefa)
    assert denegado.new_values["required_permission"] == "licencias.anular_aprobadas"


def test_gestion_humana_tiene_las_reglas_de_la_persona_en_las_suyas(monkeypatch):
    """Nadie decide sobre sus propios días: en las suyas, Gestión Humana no
    devuelve días gozados (unidad: no hace falta un flujo que ella apruebe)."""
    hoy = services.hoy()
    gestora = User(pk=900001, username="gabriela")
    solicitud = SolicitudPermiso(
        solicitante_id=900001,
        estado=SolicitudPermiso.Estado.APROBADA,
        descuento="vacaciones",
        desde=hoy - 2 * UN_DIA,
        hasta=hoy + 2 * UN_DIA,
    )
    con = {services.PERMISO_ANULAR, PROPIAS}
    monkeypatch.setattr(services, "user_has_permission", lambda _u, codename: codename in con)

    assert services.opciones_de_cancelacion(solicitud, gestora) == (True, ["restantes"])
    solicitud.hasta = hoy - UN_DIA
    assert services.opciones_de_cancelacion(solicitud, gestora) == (False, [])
    # Terminada y de otra persona: «todos» o «ninguno».
    solicitud.solicitante_id = 900002
    assert services.opciones_de_cancelacion(solicitud, gestora) == (True, ["todos", "ninguno"])


# --- Cerrada y doble cancelación -------------------------------------------------------


def test_cancelar_dos_veces_responde_que_ya_esta_cerrada(e):
    admin, _ = e["admin"]
    sid = _aprobada(e, services.EN_CURSO)
    assert _cancelar(admin, sid, devolver="restantes").status_code == 200
    segunda = _cancelar(admin, sid, devolver="todos")
    assert segunda.status_code == 400
    assert _error(segunda)["code"] == "solicitud_cerrada"
    assert _error(segunda)["message"] == "La solicitud ya está cerrada."
    # No se devolvió nada más ni se avisó dos veces.
    assert _goces(sid) == 2
    assert _avisados(sid) == ["ana", "julia", "tatiana"]
    canceladas = AccionSolicitud.objects.todas().filter(
        solicitud_id=sid, accion=AccionSolicitud.Accion.CANCELADA
    )
    assert canceladas.count() == 1


def test_dos_cancelaciones_a_la_vez_no_devuelven_dos_veces(e):
    """La segunda llega con la solicitud leída como aprobada antes de que la
    primera terminara: `_bloquear` relee el estado y la encuentra cerrada."""
    admin, _ = e["admin"]
    ana, _ = e["ana"]
    sid = _aprobada(e, services.EN_CURSO)
    with usando_empresa(empresa_actual()):
        primera = SolicitudPermiso.objects.todas().get(pk=sid)
        segunda = SolicitudPermiso.objects.todas().get(pk=sid)
        services.cancelar(primera, User.objects.get(pk=admin.pk), MOTIVO, devolver="restantes")
        assert segunda.estado == SolicitudPermiso.Estado.APROBADA
        with pytest.raises(services.SolicitudCerrada) as error:
            services.cancelar(segunda, User.objects.get(pk=ana.pk), MOTIVO, devolver="restantes")
    assert "La solicitud ya está cerrada." in str(error.value.detail)
    assert _goces(sid) == 2


# --- Historial y auditoría -------------------------------------------------------------


def test_el_historial_guarda_quien_el_motivo_y_la_opcion(e):
    admin, _ = e["admin"]
    sid = _aprobada(e, services.EN_CURSO)
    respuesta = _cancelar(admin, sid, devolver="restantes")
    [accion] = [a for a in respuesta.json()["acciones"] if a["accion"] == "cancelada"]
    assert accion["comentario"] == MOTIVO
    assert "En curso" in accion["detalle"]
    assert "Devolver los días que faltan" in accion["detalle"]
    assert "3 días de vacaciones devueltos" in accion["detalle"]
    evento = AuditLog.objects.get(action="licencias.solicitud.cancelada", actor=admin)
    assert evento.new_values["devolver"] == "restantes"
    assert evento.new_values["momento"] == "en_curso"
    assert evento.new_values["dias_devueltos"] == 3
    assert evento.previous_values == {"estado": "aprobada"}


# --- Una pendiente, como siempre -------------------------------------------------------


def test_una_pendiente_se_cancela_como_siempre(e):
    ana, _ = e["ana"]
    admin, _ = e["admin"]
    desde, hasta = FECHAS[services.POR_EMPEZAR]
    pendiente = _pedida(_cliente(ana), e["vacaciones"], _iso(desde), _iso(hasta))
    # Gestión Humana no cancela la pendiente de otro; quien la pidió sí, sin comentario.
    assert _cancelar(admin, pendiente["id"], comentario="").status_code == 403
    respuesta = _cancelar(ana, pendiente["id"], comentario="")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["estado"] == "cancelada"


# --- Datos para la pantalla ------------------------------------------------------------


def _tres_aprobadas(e):
    return {cuando: _aprobada(e, cuando) for cuando in FECHAS}


def _por_id(datos):
    return {a["id"]: a for a in datos["aprobadas"]}


def test_mis_vacaciones_trae_las_aprobadas_con_lo_que_puede_la_persona(e):
    ana, _ = e["ana"]
    ids = _tres_aprobadas(e)
    medico = _pedida(_cliente(ana), e["medico"], _iso(20), _iso(20))
    _aprobar_medico(e, medico["id"])

    datos = _cliente(ana).get(MIAS).json()
    aprobadas = _por_id(datos)
    # Solo las de vacaciones: el permiso médico no aparece.
    assert set(aprobadas) == set(ids.values())
    assert [a["id"] for a in datos["aprobadas"]] == [
        ids[services.TERMINADA],
        ids[services.EN_CURSO],
        ids[services.POR_EMPEZAR],
    ]
    por_empezar = aprobadas[ids[services.POR_EMPEZAR]]
    assert por_empezar["momento"] == "por_empezar"
    assert (por_empezar["puede_cancelar"], por_empezar["opciones_devolver"]) == (True, [])
    assert por_empezar["dias"] == 5
    assert por_empezar["desde"] == _iso(10)
    en_curso = aprobadas[ids[services.EN_CURSO]]
    assert en_curso["momento"] == "en_curso"
    assert (en_curso["puede_cancelar"], en_curso["opciones_devolver"]) == (True, ["restantes"])
    assert en_curso["dias_por_opcion"] == {"restantes": 3, "todos": 5, "ninguno": 0}
    terminada = aprobadas[ids[services.TERMINADA]]
    assert terminada["momento"] == "terminada"
    assert (terminada["puede_cancelar"], terminada["opciones_devolver"]) == (False, [])

    # Cancelada, deja de aparecer.
    assert _cancelar(ana, ids[services.POR_EMPEZAR]).status_code == 200
    assert ids[services.POR_EMPEZAR] not in _por_id(_cliente(ana).get(MIAS).json())


def test_gestion_humana_ve_las_de_otra_persona_con_sus_opciones(e):
    ana, _ = e["ana"]
    ids = _tres_aprobadas(e)
    gestora, _ = _persona(
        "gabriela",
        "vacaciones.ver_todas",
        "licencias.ver_todas",
        "licencias.anular_aprobadas",
    )
    aprobadas = _por_id(_cliente(gestora).get(DE_TODOS, {"usuario": ana.id}).json())
    opciones = {
        cuando: (aprobadas[sid]["puede_cancelar"], aprobadas[sid]["opciones_devolver"])
        for cuando, sid in ids.items()
    }
    assert opciones == {
        "por_empezar": (True, []),
        "en_curso": (True, ["restantes", "todos", "ninguno"]),
        "terminada": (True, ["todos", "ninguno"]),
    }

    # Con `anular_aprobadas` pero sin ver las solicitudes, no hay botón: la API
    # respondería 404.
    consulta, _ = _persona("veronica", "vacaciones.ver_todas", "licencias.anular_aprobadas")
    aprobadas = _por_id(_cliente(consulta).get(DE_TODOS, {"usuario": ana.id}).json())
    assert {a["puede_cancelar"] for a in aprobadas.values()} == {False}
    assert {tuple(a["opciones_devolver"]) for a in aprobadas.values()} == {()}

    # Sin `anular_aprobadas`: tampoco.
    lectora, _ = _persona("lorena", "vacaciones.ver_todas", "licencias.ver_todas")
    aprobadas = _por_id(_cliente(lectora).get(DE_TODOS, {"usuario": ana.id}).json())
    assert {a["puede_cancelar"] for a in aprobadas.values()} == {False}


def test_el_detalle_usa_las_mismas_reglas(e):
    ana, _ = e["ana"]
    admin, _ = e["admin"]
    ids = _tres_aprobadas(e)
    esperado = {
        "ana": {
            "por_empezar": (True, []),
            "en_curso": (True, ["restantes"]),
            "terminada": (False, []),
        },
        "admin": {
            "por_empezar": (True, []),
            "en_curso": (True, ["restantes", "todos", "ninguno"]),
            "terminada": (True, ["todos", "ninguno"]),
        },
    }
    for quien, usuario in (("ana", ana), ("admin", admin)):
        for cuando, sid in ids.items():
            detalle = _cliente(usuario).get(f"{SOLICITUDES}{sid}/").json()
            puedo = detalle["puedo"]
            assert detalle["momento"] == cuando
            assert (puedo["cancelar"], puedo["opciones_devolver"]) == esperado[quien][cuando]
            assert puedo["cancelar_pide_comentario"] is esperado[quien][cuando][0]
    en_curso = _cliente(admin).get(f"{SOLICITUDES}{ids['en_curso']}/").json()
    assert en_curso["dias_por_opcion"] == {"restantes": 3, "todos": 5, "ninguno": 0}


def test_una_pendiente_no_tiene_momento_ni_opciones(e):
    ana, _ = e["ana"]
    desde, hasta = FECHAS[services.POR_EMPEZAR]
    pendiente = _pedida(_cliente(ana), e["vacaciones"], _iso(desde), _iso(hasta))
    detalle = _cliente(ana).get(f"{SOLICITUDES}{pendiente['id']}/").json()
    assert detalle["momento"] is None
    assert detalle["dias_por_opcion"] is None
    assert detalle["puedo"]["cancelar"] is True
    assert detalle["puedo"]["cancelar_pide_comentario"] is False
    assert detalle["puedo"]["opciones_devolver"] == []


# --- El permiso nuevo ------------------------------------------------------------------


def test_el_permiso_esta_en_el_catalogo_y_en_permisos_base(db):
    from apps.organizacion.roles_de_cargo import PERMISOS_BASE
    from apps.permissions.catalog import PERMISSION_CATALOG

    assert PROPIAS in PERMISOS_BASE
    assert (
        PERMISSION_CATALOG["licencias"]["permissions"][PROPIAS]
        == "Cancelar sus vacaciones o permisos ya aprobados"
    )
    assert Permission.objects.filter(
        content_type__app_label="permissions", codename=PROPIAS
    ).exists()


def test_la_migracion_0050_da_el_permiso_a_los_roles_de_cargo(db):
    migracion = importlib.import_module(
        "apps.roles.migrations.0050_permiso_cancelar_aprobadas_propias"
    )
    base = _permiso("licencias.solicitar")
    nuevo = _permiso(PROPIAS)

    de_cargo = Group.objects.create(name="Asistente de Compras (prueba)")
    de_cargo.permissions.add(base)
    personalizado = Group.objects.create(name="Auditor externo (prueba)")
    administrador, _ = Group.objects.get_or_create(name="Administrador")
    superusuario, _ = Group.objects.get_or_create(name="Superusuario")
    for rol in (de_cargo, administrador, superusuario):
        rol.permissions.remove(nuevo)

    migracion.conceder(django_apps, None)
    migracion.conceder(django_apps, None)  # idempotente

    for rol in (de_cargo, administrador, superusuario):
        assert rol.permissions.filter(pk=nuevo.pk).count() == 1, rol.name
    assert not personalizado.permissions.filter(pk=nuevo.pk).exists()

    migracion.retirar(django_apps, None)
    assert not Group.objects.filter(permissions=nuevo).exists()
    assert de_cargo.permissions.filter(pk=base.pk).exists()


# --- Bordes (QA-FUNC B5) ---------------------------------------------------------------


def test_hoy_es_el_primer_dia_y_con_restantes_vuelven_todos(e):
    ana, _ = e["ana"]
    sid = _aprobada(e, desde=0, hasta=4)
    detalle = _cliente(ana).get(f"{SOLICITUDES}{sid}/").json()
    assert detalle["momento"] == "en_curso"
    assert detalle["dias_por_opcion"] == {"restantes": 5, "todos": 5, "ninguno": 0}

    respuesta = _cancelar(ana, sid, devolver="restantes")
    assert respuesta.status_code == 200, respuesta.data
    assert _goces(sid) == 0
    assert (
        not GoceVacaciones.objects.todas()
        .filter(descripcion__endswith=f"(solicitud n.º {sid})")
        .exists()
    )
    assert _ausencias(sid) == []
    # Ya empezó: la jefa (que aprobó) y Talento Humano, que aprobó.
    assert _avisados(sid) == ["julia", "tatiana"]


def test_hoy_es_el_ultimo_dia_y_con_restantes_vuelve_uno(e):
    ana, _ = e["ana"]
    sid = _aprobada(e, desde=-4, hasta=0)
    hoy = services.hoy()
    antes = _ausencias(sid)

    respuesta = _cancelar(ana, sid, devolver="restantes")
    assert respuesta.status_code == 200, respuesta.data
    [goce] = GoceVacaciones.objects.todas().filter(descripcion__endswith=f"(solicitud n.º {sid})")
    assert (goce.desde, goce.hasta, goce.dias) == (hoy - 4 * UN_DIA, hoy - UN_DIA, 4)
    # Solo la de hoy (si hoy es laborable); las anteriores se quedan.
    assert _ausencias(sid) == [d for d in antes if d != hoy]
    [accion] = [a for a in respuesta.json()["acciones"] if a["accion"] == "cancelada"]
    assert "1 día de vacaciones devueltos" in accion["detalle"]


def test_un_permiso_sin_descuento_en_curso_lo_cancela_la_persona(e):
    ana, _ = e["ana"]
    with usando_empresa(empresa_actual()):
        goces_antes = list(
            GoceVacaciones.objects.todas()
            .filter(periodo__usuario=ana)
            .values_list("id", "desde", "hasta", "dias")
        )
    medico = _pedida(_cliente(ana), e["medico"], _iso(-1), _iso(1))
    _aprobar_medico(e, medico["id"])
    hoy = services.hoy()
    pasadas = [d for d in _ausencias(medico["id"]) if d < hoy]

    respuesta = _cancelar(ana, medico["id"], devolver="restantes")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["estado"] == "cancelada"
    with usando_empresa(empresa_actual()):
        assert (
            list(
                GoceVacaciones.objects.todas()
                .filter(periodo__usuario=ana)
                .values_list("id", "desde", "hasta", "dias")
            )
            == goces_antes
        )
    assert _ausencias(medico["id"]) == pasadas
    [accion] = [a for a in respuesta.json()["acciones"] if a["accion"] == "cancelada"]
    assert accion["detalle"] == "En curso · Se borraron sus ausencias desde hoy"
    assert "devueltos" not in accion["detalle"]


def test_el_403_de_una_pendiente_ajena_no_nombra_permiso(e):
    ana, _ = e["ana"]
    admin, _ = e["admin"]
    desde, hasta = FECHAS[services.POR_EMPEZAR]
    pendiente = _pedida(_cliente(ana), e["vacaciones"], _iso(desde), _iso(hasta))
    assert _cancelar(admin, pendiente["id"]).status_code == 403
    [denegado] = AuditLog.objects.filter(action="access_denied", actor=admin)
    assert denegado.new_values["required_permission"] is None


def test_la_auditoria_lee_el_estado_con_la_fila_bloqueada(e):
    ana, _ = e["ana"]
    desde, hasta = FECHAS[services.POR_EMPEZAR]
    pendiente = _pedida(_cliente(ana), e["vacaciones"], _iso(desde), _iso(hasta))
    assert _cancelar(ana, pendiente["id"], comentario="").status_code == 200
    evento = AuditLog.objects.get(action="licencias.solicitud.cancelada", actor=ana)
    assert evento.previous_values == {"estado": "pendiente"}
    assert "devolver" not in evento.new_values


# --- «Mis vacaciones»: un año atrás y consultas fijas ------------------------------------


def test_solo_lista_las_que_terminaron_hace_un_ano_o_menos(e):
    ana, _ = e["ana"]
    limite = services.DIAS_DE_APROBADAS_TERMINADAS
    vieja = _aprobada(e, desde=-limite - 1, hasta=-limite - 1)
    justo = _aprobada(e, desde=-limite, hasta=-limite)
    ids = set(_por_id(_cliente(ana).get(MIAS).json()))
    assert justo in ids
    assert vieja not in ids


def _consultas_de_aprobadas(persona, usuario):
    with usando_empresa(empresa_actual()):
        fresco = User.objects.get(pk=usuario.pk)
        with CaptureQueriesContext(connection) as consultas:
            lista = services.aprobadas_para(persona, fresco)
    return len(consultas), lista


def test_las_aprobadas_se_leen_con_consultas_fijas(e):
    """Sin N+1: con 1 y con 5 aprobadas, las mismas consultas (las
    solicitudes, sus goces, en cuáles intervino quien mira y sus permisos)."""
    ana, _ = e["ana"]
    jefa, _ = e["jefa"]  # Aprobó: las ve por haber intervenido, sin `ver_todas`.
    _aprobada(e, desde=-40, hasta=-39)
    con_una, lista = _consultas_de_aprobadas(ana, jefa)
    assert len(lista) == 1
    for i in range(1, 5):
        _aprobada(e, desde=-40 + 6 * i, hasta=-39 + 6 * i)
    con_cinco, lista = _consultas_de_aprobadas(ana, jefa)
    assert len(lista) == 5
    assert {a["dias_por_opcion"]["todos"] for a in lista} == {2}
    assert con_cinco == con_una


# --- Permisos que no descuentan vacaciones (ronda 2, decisión del Tech Lead) -------------


def _medico_aprobado(e, desde, hasta):
    ana, _ = e["ana"]
    medico = _pedida(_cliente(ana), e["medico"], _iso(desde), _iso(hasta))
    _aprobar_medico(e, medico["id"])
    return medico["id"]


def test_gestion_humana_cancela_un_permiso_en_curso_sin_devolver_y_borra_todo(e):
    admin, _ = e["admin"]
    sid = _medico_aprobado(e, -3, 3)
    assert _ausencias(sid)
    respuesta = _cancelar(admin, sid)  # Sin `devolver`.
    assert respuesta.status_code == 200, respuesta.data
    assert _ausencias(sid) == []
    [accion] = [a for a in respuesta.json()["acciones"] if a["accion"] == "cancelada"]
    assert accion["detalle"] == "En curso · Se borraron todas sus ausencias"
    evento = AuditLog.objects.get(action="licencias.solicitud.cancelada", actor=admin)
    assert evento.new_values["devolver"] is None
    # En curso: la jefa, la persona y Talento Humano, que lo aprobó.
    assert _avisados(sid) == ["ana", "julia", "tatiana"]


def test_gestion_humana_ignora_devolver_en_un_permiso_sin_descuento(e):
    admin, _ = e["admin"]
    sid = _medico_aprobado(e, -10, -8)
    respuesta = _cancelar(admin, sid, devolver="ninguno")
    assert respuesta.status_code == 200, respuesta.data
    assert _ausencias(sid) == []


def test_la_persona_cancela_un_permiso_en_curso_y_se_borra_desde_hoy(e):
    ana, _ = e["ana"]
    sid = _medico_aprobado(e, -3, 3)
    hoy = services.hoy()
    pasadas = [d for d in _ausencias(sid) if d < hoy]
    respuesta = _cancelar(ana, sid)  # Sin `devolver`.
    assert respuesta.status_code == 200, respuesta.data
    assert _ausencias(sid) == pasadas


def test_la_persona_cancela_un_permiso_por_empezar_y_se_borra_todo(e):
    ana, _ = e["ana"]
    sid = _medico_aprobado(e, 5, 7)
    respuesta = _cancelar(ana, sid)
    assert respuesta.status_code == 200, respuesta.data
    assert _ausencias(sid) == []


def test_la_persona_no_cancela_un_permiso_terminado(e):
    ana, _ = e["ana"]
    sid = _medico_aprobado(e, -10, -8)
    antes = _ausencias(sid)
    respuesta = _cancelar(ana, sid)
    assert respuesta.status_code == 403
    assert _estado(sid) == SolicitudPermiso.Estado.APROBADA
    assert _ausencias(sid) == antes
    detalle = _cliente(ana).get(f"{SOLICITUDES}{sid}/").json()
    assert (detalle["puedo"]["cancelar"], detalle["puedo"]["opciones_devolver"]) == (False, [])


def test_el_detalle_de_un_permiso_sin_descuento_no_ofrece_dias(e):
    ana, _ = e["ana"]
    admin, _ = e["admin"]
    sid = _medico_aprobado(e, -3, 3)
    for usuario in (ana, admin):
        detalle = _cliente(usuario).get(f"{SOLICITUDES}{sid}/").json()
        assert detalle["momento"] == "en_curso"
        assert detalle["dias_por_opcion"] is None
        assert detalle["puedo"]["cancelar"] is True
        assert detalle["puedo"]["cancelar_pide_comentario"] is True
        assert detalle["puedo"]["opciones_devolver"] == []


def test_una_pendiente_ya_cancelada_responde_solicitud_cerrada(e):
    ana, _ = e["ana"]
    desde, hasta = FECHAS[services.POR_EMPEZAR]
    pendiente = _pedida(_cliente(ana), e["vacaciones"], _iso(desde), _iso(hasta))
    assert _cancelar(ana, pendiente["id"], comentario="").status_code == 200
    otra_vez = _cancelar(ana, pendiente["id"], comentario="")
    assert otra_vez.status_code == 400
    assert _error(otra_vez) == {
        "code": "solicitud_cerrada",
        "message": "La solicitud ya está cerrada.",
        "details": None,
    }
