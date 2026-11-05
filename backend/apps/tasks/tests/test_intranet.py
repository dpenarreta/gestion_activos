"""Lo propio de la intranet: lo que no existía en Nexo y se agregó al portar.

- Multiempresa: las tareas, los motivos, los cierres y los avisos de una
  empresa no se ven desde otra, y la cabecera `X-Empresa` decide en cuál se
  trabaja.
- Roles de Gestión Humana globales o de la membresía en la empresa activa: el
  de otra empresa no cuenta.
- Solo el equipo de Gestión Humana entra al módulo (`tareas.acceder`).
- Los endpoints nuevos: `me/`, `assignable-users/` y `settings/`.

Aquí la empresa la decide cada petición, así que se anula el fixture global
que fija una de antemano (como en `apps/novedades/tests/test_intranet.py`).
"""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.modulos import modulo_de_ruta
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import Cargo, DatosDeContacto
from apps.tasks.models import ActivityReason, MonthClosure, Task
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

BASE = "/api/v1/tasks"


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


def _tarea(empresa, asignada, creada, **extra):
    campos = {
        "title": "Tarea",
        "priority": "MEDIA",
        "frequency": "PUNTUAL",
        "start_date": datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        "end_date": datetime(2026, 8, 10, tzinfo=dt_timezone.utc),
        "estimated_hours": 2,
        "assigned_to": asignada,
        "created_by": creada,
        **extra,
    }
    with usando_empresa(empresa):
        return Task.objects.create(**campos)


def _jefe_de(empresa, jefe, subordinado):
    with usando_empresa(empresa):
        arriba = Cargo.objects.create(nombre=f"Jefatura {jefe.username}")
        DatosDeContacto.objects.create(usuario=jefe, cargo=arriba)
        DatosDeContacto.objects.create(
            usuario=subordinado, cargo=Cargo.objects.create(nombre="Analista", jefe=arriba)
        )


# --- Acceso al módulo -------------------------------------------------------


def test_sin_sesion_no_hay_modulo(courier):
    assert APIClient().get(f"{BASE}/").status_code == 401


def test_quien_no_es_de_gestion_humana_no_entra(courier):
    """Solo para el equipo de Gestión Humana: otra cuenta de la empresa (TI,
    por ejemplo) recibe 403."""
    ti = _cuenta("ti", {courier: []})
    assert _cliente(ti, courier).get(f"{BASE}/").status_code == 403
    assert _cliente(ti, courier).get(f"{BASE}/me/").status_code == 403


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
    persona = _cuenta("gh", {courier: [rol]})
    respuesta = _cliente(persona, courier).get(f"{BASE}/me/")
    assert respuesta.status_code == 200
    assert respuesta.json()["role"] == rol


def test_rol_de_la_membresia_solo_vale_en_su_empresa(courier, seguridad):
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"], seguridad: []})
    assert _cliente(analista, courier).get(f"{BASE}/").status_code == 200
    assert _cliente(analista, seguridad).get(f"{BASE}/").status_code == 403


def test_rol_global_vale_en_todas_sus_empresas(courier, seguridad):
    analista = _cuenta("analista", {courier: [], seguridad: []}, globales=["ANALISTA_CC"])
    for empresa in (courier, seguridad):
        assert _cliente(analista, empresa).get(f"{BASE}/").status_code == 200


def test_el_permiso_de_equipo_es_por_empresa(courier, seguridad):
    coord = _cuenta("coord", {courier: ["COORDINADOR_NACIONAL"], seguridad: ["ASISTENTE_GH"]})
    assert _cliente(coord, courier).get(f"{BASE}/team/").status_code == 200
    assert _cliente(coord, seguridad).get(f"{BASE}/team/").status_code == 403


def test_la_ruta_es_del_modulo_gestion_humana():
    """Apagar Gestión Humana en una empresa apaga también Tareas y Equipo."""
    assert modulo_de_ruta(f"{BASE}/") == "gestion_humana"
    assert modulo_de_ruta(f"{BASE}/team/") == "gestion_humana"


# --- Aislamiento de los datos -------------------------------------------------


def test_las_tareas_de_una_empresa_no_se_ven_desde_otra(courier, seguridad):
    persona = _cuenta("ana", {courier: ["ANALISTA_CC"], seguridad: ["ANALISTA_CC"]})
    de_courier = _tarea(courier, persona, persona, title="De Courier")
    _tarea(seguridad, persona, persona, title="De Seguridad")

    en_seguridad = _cliente(persona, seguridad)
    assert [t["title"] for t in en_seguridad.get(f"{BASE}/").json()] == ["De Seguridad"]
    # La de la otra empresa, aunque sea suya, no existe aquí.
    assert en_seguridad.get(f"{BASE}/{de_courier.pk}/").status_code == 404
    assert (
        en_seguridad.patch(f"{BASE}/{de_courier.pk}/", {"title": "x"}, format="json").status_code
        == 404
    )


def test_quien_administra_una_empresa_no_ve_las_tareas_de_otra(courier, seguridad):
    admin = _cuenta("admin", {courier: [ADMIN_GH], seguridad: ["ASISTENTE_GH"]})
    ajena = _cuenta("ajena", {seguridad: ["ASISTENTE_GH"]})
    tarea = _tarea(seguridad, ajena, ajena)

    assert _cliente(admin, courier).get(f"{BASE}/{tarea.pk}/").status_code == 404
    # Y en la empresa donde no administra, tampoco la ve.
    assert _cliente(admin, seguridad).get(f"{BASE}/{tarea.pk}/").status_code == 404


def test_el_organigrama_de_una_empresa_no_da_visibilidad_en_otra(courier, seguridad):
    jefa = _cuenta("jefa", {courier: ["COORDINADOR_NACIONAL"], seguridad: ["COORDINADOR_NACIONAL"]})
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"], seguridad: ["ANALISTA_CC"]})
    _jefe_de(courier, jefa, analista)
    en_courier = _tarea(courier, analista, analista)
    en_seguridad = _tarea(seguridad, analista, analista)

    assert _cliente(jefa, courier).get(f"{BASE}/{en_courier.pk}/").status_code == 200
    assert _cliente(jefa, seguridad).get(f"{BASE}/{en_seguridad.pk}/").status_code == 404
    equipo_seguridad = _cliente(jefa, seguridad).get(f"{BASE}/team/").json()
    assert equipo_seguridad == []


def test_no_se_asigna_a_alguien_de_otra_empresa(courier, seguridad):
    admin = _cuenta("admin", {courier: [ADMIN_GH]})
    ajena = _cuenta("ajena", {seguridad: ["ASISTENTE_GH"]})

    respuesta = _cliente(admin, courier).post(
        f"{BASE}/",
        {
            "title": "Informe",
            "priority": "ALTA",
            "frequency": "PUNTUAL",
            "start_date": "2026-08-01T00:00:00Z",
            "end_date": "2026-08-02T00:00:00Z",
            "estimated_hours": 1,
            "assigned_to": ajena.pk,
        },
        format="json",
    )

    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "assignee_out_of_scope"


def test_quien_administra_asigna_a_cualquiera_de_su_empresa(courier):
    admin = _cuenta("admin", {courier: [ADMIN_GH]})
    asistente = _cuenta("asistente", {courier: ["ASISTENTE_GH"]})
    sin_acceso = _cuenta("ti", {courier: []})
    datos = {
        "title": "Informe",
        "priority": "ALTA",
        "frequency": "PUNTUAL",
        "start_date": "2026-08-01T00:00:00Z",
        "end_date": "2026-08-02T00:00:00Z",
        "estimated_hours": 1,
    }
    cliente = _cliente(admin, courier)

    assert (
        cliente.post(f"{BASE}/", {**datos, "assigned_to": asistente.pk}, format="json").status_code
        == 201
    )
    # A quien no tiene acceso a Tareas no: no podría abrir la tarea.
    assert (
        cliente.post(f"{BASE}/", {**datos, "assigned_to": sin_acceso.pk}, format="json").status_code
        == 400
    )


def test_motivos_y_cierres_son_por_empresa(courier, seguridad):
    """La misma clave de motivo y el mismo mes cerrado pueden existir en las
    dos empresas (restricciones únicas con la empresa)."""
    jefe = _cuenta("jefe", {courier: ["JEFE_NACIONAL"], seguridad: ["JEFE_NACIONAL"]})
    for empresa in (courier, seguridad):
        with usando_empresa(empresa):
            ActivityReason.objects.create(
                key="REUNION", label="Reunión", assigned_roles=["JEFE_NACIONAL"]
            )
        respuesta = _cliente(jefe, empresa).post(
            f"{BASE}/close-month/", {"year": 2026, "month": 1}, format="json"
        )
        assert respuesta.status_code == 200

    assert MonthClosure.objects.todas().filter(year=2026, month=1).count() == 2
    motivos = _cliente(jefe, courier).get(f"{BASE}/activity-reasons/").json()
    assert len(motivos) == 1


def test_el_cierre_de_una_empresa_no_archiva_las_tareas_de_otra(courier, seguridad):
    jefe = _cuenta("jefe", {courier: ["JEFE_NACIONAL"], seguridad: ["JEFE_NACIONAL"]})
    enero = datetime(2026, 1, 15, tzinfo=dt_timezone.utc)
    de_seguridad = _tarea(seguridad, jefe, jefe, start_date=enero, end_date=enero)

    _cliente(jefe, courier).post(f"{BASE}/close-month/", {"year": 2026, "month": 1}, format="json")

    de_seguridad.refresh_from_db()
    assert de_seguridad.archived_month is None


def test_el_aviso_queda_en_la_empresa_de_la_tarea(courier, seguridad):
    jefa = _cuenta("jefa", {courier: ["COORDINADOR_NACIONAL"]})
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"]})
    _jefe_de(courier, jefa, analista)
    tarea = _tarea(courier, analista, analista)

    _cliente(analista, courier).post(
        f"{BASE}/{tarea.pk}/comments/", {"text": "Hola"}, format="json"
    )

    aviso = Notificacion.objects.todas().get(usuario=jefa)
    assert aviso.empresa_id == courier.pk
    assert aviso.enlace == f"/admin/gestion-humana/tareas/{tarea.pk}"
    assert aviso.modulo == "tareas"


# --- Endpoints nuevos ----------------------------------------------------------


def test_me_dice_permisos_rol_y_equipo(courier):
    jefa = _cuenta("jefa", {courier: ["COORDINADOR_NACIONAL"]})
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"]})
    _jefe_de(courier, jefa, analista)

    datos = _cliente(jefa, courier).get(f"{BASE}/me/").json()

    assert datos["role"] == "COORDINADOR_NACIONAL"
    assert set(datos["permissions"]) == {
        "tareas.acceder",
        "tareas.validar",
        "tareas.cerrar_mes",
        "equipo.ver",
    }
    assert datos["has_cargo"] is True
    assert datos["team_size"] == 1
    assert datos["is_admin"] is False


def test_con_varios_roles_manda_el_de_mayor_nivel(courier):
    persona = _cuenta("varios", {courier: ["ASISTENTE_GH", "COORDINADOR_ZS"]})
    datos = _cliente(persona, courier).get(f"{BASE}/me/").json()
    assert datos["role"] == "COORDINADOR_ZS"
    assert datos["roles"] == ["COORDINADOR_ZS", "ASISTENTE_GH"]


def test_a_quien_puede_asignar(courier):
    jefa = _cuenta("jefa", {courier: ["COORDINADOR_NACIONAL"]})
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"]})
    _cuenta("otra", {courier: ["ASISTENTE_GH"]})
    _jefe_de(courier, jefa, analista)

    ids = [p["id"] for p in _cliente(jefa, courier).get(f"{BASE}/assignable-users/").json()]
    assert sorted(ids) == sorted([jefa.pk, analista.pk])

    sola = _cliente(analista, courier).get(f"{BASE}/assignable-users/").json()
    assert [p["id"] for p in sola] == [analista.pk]


def test_ajustes_los_lee_el_modulo_y_los_cambia_quien_administra(courier):
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"]})
    admin = _cuenta("admin", {courier: [ADMIN_GH]})

    leidos = _cliente(analista, courier).get(f"{BASE}/settings/").json()
    assert leidos["retroactive_window_business_days"] == 2
    # Vacía: el aviso retroactivo va al jefe inmediato (por defecto).
    assert leidos["retroactive_notify_users"] == []

    negado = _cliente(analista, courier).patch(
        f"{BASE}/settings/", {"retroactive_window_business_days": 5}, format="json"
    )
    assert negado.status_code == 403

    cambio = _cliente(admin, courier).patch(
        f"{BASE}/settings/",
        {"retroactive_window_business_days": 5, "retroactive_notify_users": [analista.pk]},
        format="json",
    )
    assert cambio.status_code == 200
    assert cambio.json()["retroactive_window_business_days"] == 5
    assert cambio.json()["retroactive_notify_users"] == [analista.pk]

    # Solo personas activas de esta empresa.
    ajena = _cuenta("ajena", {})
    rechazo = _cliente(admin, courier).patch(
        f"{BASE}/settings/", {"retroactive_notify_users": [ajena.pk]}, format="json"
    )
    assert rechazo.status_code == 400

    invalido = _cliente(admin, courier).patch(
        f"{BASE}/settings/", {"retroactive_window_business_days": 0}, format="json"
    )
    assert invalido.status_code == 400
    assert invalido.json()["error"]["details"]["retroactive_window_business_days"]


def test_los_ajustes_son_por_empresa(courier, seguridad):
    admin = _cuenta("admin", {courier: [ADMIN_GH], seguridad: [ADMIN_GH]})
    _cliente(admin, courier).patch(f"{BASE}/settings/", {"horas_esperadas_mes": 160}, format="json")

    assert _cliente(admin, courier).get(f"{BASE}/settings/").json()["horas_esperadas_mes"] == 160
    assert _cliente(admin, seguridad).get(f"{BASE}/settings/").json()["horas_esperadas_mes"] == 140


def test_un_error_de_validacion_explica_el_motivo(courier):
    analista = _cuenta("analista", {courier: ["ANALISTA_CC"]})
    respuesta = _cliente(analista, courier).post(f"{BASE}/", {"title": ""}, format="json")

    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["message"] != "Error en la solicitud."
    assert "title" in error["details"]


def test_el_administrador_de_ti_no_tiene_tareas_pero_el_superusuario_si(db):
    """Decisión del 05/11/2026: el rol «Administrador» del sistema no ve las
    Tareas de Gestión Humana; el «Superusuario» sí."""
    from django.contrib.auth.models import Group

    def de(rol):
        return set(Group.objects.get(name=rol).permissions.values_list("codename", flat=True))

    del_modulo = {c for c in de("Administrador") if c.startswith(("tareas.", "equipo."))}
    assert del_modulo == set()
    assert "tareas.administrar" in de("Superusuario")
    assert "tareas.administrar" in de("Administrador de Gestión Humana")
