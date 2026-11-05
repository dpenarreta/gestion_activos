"""Lo propio de la intranet en Proyectos (lo que no existía en Nexo):

- Multiempresa: los proyectos, sus documentos y su papelera de una empresa no
  se ven ni se tocan desde otra; `X-Empresa` decide en cuál se trabaja.
- Visibilidad por el organigrama (no por el nivel del rol).
- Solo el equipo de Gestión Humana entra (`proyectos_gh.acceder`); el
  Administrador de TI no.
- Avisos en la campana (`proyectos.*`) y auditoría común (`proyectos_gh`).

Aquí la empresa la decide cada petición: se anula el fixture global que fija
una de antemano (como en `apps/tasks/tests/test_intranet.py`).
"""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.modulos import modulo_de_ruta
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import Cargo, DatosDeContacto
from apps.projects.models import Project, ProjectDocument
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import PDF_B64

BASE = "/api/v1/projects"


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global: aquí la empresa la decide `X-Empresa`."""
    yield


@pytest.fixture
def courier(db):
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad(db):
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


def _cuenta(nombre, roles_por_empresa: dict, *, globales=()):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.title(),
    )
    for indice, (empresa, roles) in enumerate(roles_por_empresa.items()):
        membresia = MembresiaEmpresa.objects.create(
            usuario=usuario, empresa=empresa, es_predeterminada=indice == 0
        )
        membresia.roles.set([Group.objects.get(name=rol) for rol in roles])
    if globales:
        usuario.groups.set([Group.objects.get(name=rol) for rol in globales])
    return usuario


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=User.objects.get(pk=usuario.pk))
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.pk))
    return cliente


def _proyecto(empresa, responsable, creador, **extra):
    campos = {
        "name": "Clima laboral 2026",
        "priority": "MEDIA",
        "start_date": datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        "target_date": datetime(2026, 9, 1, tzinfo=dt_timezone.utc),
        "target_time_hours": 10,
        "responsible": responsable,
        "created_by": creador,
        **extra,
    }
    with usando_empresa(empresa):
        return Project.objects.create(**campos)


def _jefe_de(empresa, jefe, subordinado):
    with usando_empresa(empresa):
        arriba = Cargo.objects.create(nombre=f"Jefatura {jefe.username}")
        DatosDeContacto.objects.create(usuario=jefe, cargo=arriba)
        DatosDeContacto.objects.create(
            usuario=subordinado, cargo=Cargo.objects.create(nombre="Analista", jefe=arriba)
        )


# --- Acceso al módulo ------------------------------------------------------------


def test_las_rutas_son_del_modulo_gestion_humana():
    assert modulo_de_ruta(f"{BASE}/") == "gestion_humana"
    assert modulo_de_ruta(f"{BASE}/1/documents/") == "gestion_humana"


def test_sin_sesion_no_hay_modulo(courier):
    assert APIClient().get(f"{BASE}/").status_code == 401


def test_quien_no_es_de_gestion_humana_no_entra(courier):
    ti = _cuenta("ti", {courier: []})
    respuesta = _cliente(ti, courier).get(f"{BASE}/")
    assert respuesta.status_code == 403
    assert respuesta.data["error"]["code"] == "permission_denied"


def test_el_administrador_de_ti_no_entra(courier):
    """Decisión del usuario (05/11/2026): el rol «Administrador» no tiene
    Proyectos de Gestión Humana."""
    ti = _cuenta("admin_ti", {courier: ["Administrador"]})
    assert _cliente(ti, courier).get(f"{BASE}/").status_code == 403


@pytest.mark.parametrize(
    "rol",
    [
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
        ADMIN_GH,
    ],
)
def test_cada_rol_de_gestion_humana_entra(courier, rol):
    persona = _cuenta("persona", {courier: [rol]})
    assert _cliente(persona, courier).get(f"{BASE}/").status_code == 200


def test_el_rol_de_otra_empresa_no_cuenta(courier, seguridad):
    persona = _cuenta("persona", {courier: ["ANALISTA_CC"], seguridad: []})
    assert _cliente(persona, seguridad).get(f"{BASE}/").status_code == 403


def test_me_resume_lo_que_puede_hacer(courier):
    jefe = _cuenta("jefe", {courier: ["JEFE_NACIONAL"]})
    datos = _cliente(jefe, courier).get(f"{BASE}/me/").data
    assert datos["can_create"] is True
    assert datos["can_supervise"] is True
    assert datos["is_admin"] is False


# --- Aislamiento por empresa ---------------------------------------------------------


def test_el_proyecto_de_otra_empresa_no_existe(courier, seguridad):
    admin = _cuenta("admin", {courier: [ADMIN_GH], seguridad: [ADMIN_GH]})
    ajeno = _proyecto(seguridad, admin, admin)

    cliente = _cliente(admin, courier)
    assert cliente.get(f"{BASE}/").data == []
    assert cliente.get(f"{BASE}/{ajeno.pk}/").status_code == 404
    assert cliente.patch(f"{BASE}/{ajeno.pk}/", {"name": "x"}, format="json").status_code == 404
    assert cliente.get(f"{BASE}/{ajeno.pk}/documents/").status_code == 404
    assert cliente.post(f"{BASE}/{ajeno.pk}/restore/").status_code == 404

    assert [p["id"] for p in _cliente(admin, seguridad).get(f"{BASE}/").data] == [ajeno.pk]


def test_el_admin_de_gh_de_otra_empresa_no_toca_la_papelera(courier, seguridad):
    """El Administrador de Gestión Humana envía a la papelera, restaura y
    elimina cualquier proyecto (05/11/2026), pero solo de su empresa: el de
    otra no existe para él (404)."""
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"]})
    admin_ls = _cuenta("admin_ls", {seguridad: [ADMIN_GH]})
    proyecto = _proyecto(courier, analista, analista)
    otro = _cliente(admin_ls, seguridad)
    assert otro.delete(f"{BASE}/{proyecto.id}/").status_code == 404
    assert _cliente(analista, courier).delete(f"{BASE}/{proyecto.id}/").status_code == 200
    assert otro.post(f"{BASE}/{proyecto.id}/restore/").status_code == 404
    assert otro.delete(f"{BASE}/{proyecto.id}/permanent/").status_code == 404
    assert otro.get(f"{BASE}/trash/").json() == []
    with usando_empresa(courier):
        assert Project.objects.filter(pk=proyecto.id, deleted_at__isnull=False).exists()


def test_no_se_elige_responsable_de_otra_empresa(courier, seguridad):
    creador = _cuenta("creador", {courier: ["ANALISTA_CC"]})
    ajeno = _cuenta("ajeno", {seguridad: ["ANALISTA_CC"]})
    respuesta = _cliente(creador, courier).post(
        f"{BASE}/",
        {
            "name": "Proyecto",
            "priority": "ALTA",
            "responsible": ajeno.pk,
            "start_date": "2026-08-01T00:00:00Z",
            "target_date": "2026-09-01T00:00:00Z",
            "target_time_hours": 5,
        },
        format="json",
    )
    assert respuesta.status_code == 400
    assert "responsible" in respuesta.data["error"]["details"]


def test_no_se_agrega_participante_sin_acceso_al_modulo(courier):
    creador = _cuenta("creador", {courier: ["ANALISTA_CC"]})
    ti = _cuenta("ti", {courier: []})
    proyecto = _proyecto(courier, creador, creador)
    respuesta = _cliente(creador, courier).post(
        f"{BASE}/{proyecto.pk}/participants/", {"user": ti.pk}, format="json"
    )
    assert respuesta.status_code == 400


def test_miembros_elegibles_son_de_la_empresa_y_con_acceso(courier, seguridad):
    creador = _cuenta("creador", {courier: ["ANALISTA_CC"]})
    _cuenta("colega", {courier: ["ASISTENTE_GH"]})
    _cuenta("ti", {courier: []})
    _cuenta("ajeno", {seguridad: ["ASISTENTE_GH"]})
    nombres = {p["username"] for p in _cliente(creador, courier).get(f"{BASE}/members/").data}
    assert nombres == {"creador", "colega"}


def test_el_documento_de_otra_empresa_no_se_abre(courier, seguridad, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    admin = _cuenta("admin", {courier: [ADMIN_GH], seguridad: [ADMIN_GH]})
    proyecto = _proyecto(seguridad, admin, admin)
    subida = _cliente(admin, seguridad).post(
        f"{BASE}/{proyecto.pk}/documents/",
        {"file_name": "acta.pdf", "file_data": PDF_B64},
        format="json",
    )
    assert subida.status_code == 201
    documento = subida.data["id"]
    with usando_empresa(seguridad):
        assert ProjectDocument.objects.filter(pk=documento).exists()

    cliente = _cliente(admin, courier)
    assert cliente.get(f"{BASE}/{proyecto.pk}/documents/{documento}/file/").status_code == 404


# --- Visibilidad por el organigrama --------------------------------------------------


def test_el_jefe_ve_los_proyectos_de_su_equipo_sin_participar(courier):
    jefe = _cuenta("jefe", {courier: ["COORDINADOR_ZS"]})
    analista = _cuenta("analista", {courier: ["ASISTENTE_GH"]})
    otro = _cuenta("otro", {courier: ["ASISTENTE_GH"]})
    del_equipo = _proyecto(courier, analista, analista, name="Del equipo")
    _proyecto(courier, otro, otro, name="De otro")

    assert _cliente(jefe, courier).get(f"{BASE}/").data == []

    _jefe_de(courier, jefe, analista)
    cliente = _cliente(jefe, courier)
    assert [p["id"] for p in cliente.get(f"{BASE}/").data] == [del_equipo.pk]
    detalle = cliente.get(f"{BASE}/{del_equipo.pk}/")
    assert detalle.status_code == 200
    assert detalle.data["can_manage"] is False
    # Ver no es participar ni gestionar: 403, no 404.
    comentario = cliente.post(f"{BASE}/{del_equipo.pk}/comments/", {"text": "Hola"}, format="json")
    assert comentario.status_code == 403
    edicion = cliente.patch(f"{BASE}/{del_equipo.pk}/", {"name": "x"}, format="json")
    assert edicion.status_code == 403


def test_quien_supervisa_gestiona_los_de_su_equipo(courier):
    jefe = _cuenta("jefe", {courier: ["JEFE_NACIONAL"]})
    analista = _cuenta("analista", {courier: ["ASISTENTE_GH"]})
    proyecto = _proyecto(courier, analista, analista)
    _jefe_de(courier, jefe, analista)

    respuesta = _cliente(jefe, courier).patch(
        f"{BASE}/{proyecto.pk}/", {"status": "EN_EJECUCION"}, format="json"
    )
    assert respuesta.status_code == 200
    # Pero no lo envía a la papelera: eso es solo de su creador.
    assert _cliente(jefe, courier).delete(f"{BASE}/{proyecto.pk}/").status_code == 403


def test_el_organigrama_de_otra_empresa_no_cuenta(courier, seguridad):
    jefe = _cuenta("jefe", {courier: ["COORDINADOR_ZS"], seguridad: ["COORDINADOR_ZS"]})
    analista = _cuenta("analista", {courier: ["ASISTENTE_GH"], seguridad: ["ASISTENTE_GH"]})
    _jefe_de(seguridad, jefe, analista)
    proyecto = _proyecto(courier, analista, analista)
    assert _cliente(jefe, courier).get(f"{BASE}/{proyecto.pk}/").status_code == 404


# --- Avisos y auditoría ---------------------------------------------------------------


def test_avisos_al_responsable_y_a_los_participantes(courier):
    creador = _cuenta("creador", {courier: ["ANALISTA_CC"]})
    responsable = _cuenta("responsable", {courier: ["ASISTENTE_GH"]})
    participante = _cuenta("participante", {courier: ["ASISTENTE_GH"]})
    respuesta = _cliente(creador, courier).post(
        f"{BASE}/",
        {
            "name": "Plan de bienestar",
            "priority": "ALTA",
            "responsible": responsable.pk,
            "participant_ids": [participante.pk],
            "start_date": "2026-08-01T00:00:00Z",
            "target_date": "2026-09-01T00:00:00Z",
            "target_time_hours": 5,
        },
        format="json",
    )
    assert respuesta.status_code == 201
    pk = respuesta.data["id"]

    aviso = Notificacion.objects.get(usuario=responsable, tipo="proyectos.responsable")
    assert aviso.enlace.endswith(f"/admin/gestion-humana/proyectos/{pk}")
    assert aviso.empresa_id == courier.pk
    assert "Plan de bienestar" in aviso.resumen
    assert Notificacion.objects.filter(usuario=participante, tipo="proyectos.participante").exists()
    assert not Notificacion.objects.filter(usuario=creador).exists()

    _cliente(participante, courier).post(
        f"{BASE}/{pk}/comments/", {"text": "Texto privado del comentario"}, format="json"
    )
    comentario = Notificacion.objects.get(usuario=responsable, tipo="proyectos.comentario")
    assert "Texto privado" not in comentario.resumen
    assert Notificacion.objects.filter(usuario=creador, tipo="proyectos.comentario").exists()
    assert not Notificacion.objects.filter(
        usuario=participante, tipo="proyectos.comentario"
    ).exists()

    _cliente(creador, courier).patch(f"{BASE}/{pk}/", {"status": "EN_EJECUCION"}, format="json")
    estado = Notificacion.objects.get(usuario=participante, tipo="proyectos.estado")
    assert "En ejecución" in estado.resumen


def test_auditoria_del_modulo(courier):
    creador = _cuenta("creador", {courier: ["ANALISTA_CC"]})
    proyecto = _proyecto(courier, creador, creador)
    _cliente(creador, courier).patch(f"{BASE}/{proyecto.pk}/", {"name": "Nuevo"}, format="json")
    evento = AuditLog.objects.get(action="proyectos_gh.actualizado")
    assert evento.module == "proyectos_gh"
    assert evento.empresa_id == courier.pk
    assert evento.previous_values == {"name": "Clima laboral 2026"}
    assert evento.new_values == {"name": "Nuevo"}
