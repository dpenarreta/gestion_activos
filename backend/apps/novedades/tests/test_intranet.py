"""Lo propio de la intranet: lo que no existía en Nexo y se agregó al portar.

- Multiempresa: lo de una empresa no se ve desde otra, la cédula es única por
  empresa y la cabecera `X-Empresa` decide en cuál se trabaja.
- Roles operativos globales (`user.groups`) o de la membresía en la empresa
  activa: el de otra empresa no cuenta.
- Unión con la ficha del `Empleado` por `codigo_empleado`, solo en la misma
  empresa.
- Cédula protegida (LOPDP): enmascarada para quien no gestiona colaboradores,
  y nunca en avisos ni correos.
- Avisos en la campana de la empresa y correos a los destinatarios de la
  empresa del colaborador, también desde el reintento programado.
- Ajustes (plazos) y feriados por empresa.

Aquí la empresa la decide cada petición (su `X-Empresa`), así que se anula el
fixture global que fija una de antemano, como en `apps/empresas`.
"""

import io

import openpyxl
import pytest
from django.contrib.auth.models import Group
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.notificaciones.models import Notificacion
from apps.novedades import access as perms
from apps.novedades.calendario import is_holiday
from apps.novedades.models import (
    Collaborator,
    CollaboratorExitNotification,
    CollaboratorNotificationRecipient,
)
from apps.novedades.periods import PeriodKey
from apps.novedades.services import WorkedDayService
from apps.organizacion.models import Departamento, Empleado, EventoCalendario
from apps.permissions.catalog import PERMISSION_CATALOG
from apps.users.models import User

from .conftest import TODAY, _role, access

BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)


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
    """Cuenta con sus roles en cada empresa (membresía) y, si se piden, roles
    globales."""
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="clave-de-prueba-123",
        first_name=nombre.title(),
    )
    for indice, (empresa, roles) in enumerate(roles_por_empresa.items()):
        membresia = MembresiaEmpresa.objects.create(
            usuario=usuario, empresa=empresa, es_predeterminada=indice == 0
        )
        membresia.roles.set([_role(rol) for rol in roles])
    if globales:
        usuario.groups.set([_role(rol) for rol in globales])
    return usuario


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=User.objects.get(pk=usuario.pk))
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.pk))
    return cliente


def _alta(cliente, cedula="0102030405", nombre="Ana Pérez", **extra):
    datos = {"cedula": cedula, "full_name": nombre, "cargo": "Operador", **extra}
    return cliente.post(f"{BASE}/collaborators/", datos, format="json")


# ── Roles operativos: globales o por membresía ──────────────────────────────


def test_rol_de_la_membresia_solo_vale_en_su_empresa(courier, seguridad):
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE], seguridad: []})

    en_courier = _cliente(sup, courier).get(f"{BASE}/me/")
    assert en_courier.status_code == 200
    assert en_courier.json()["role"] == perms.SUPERVISOR_ROLE
    # En la otra empresa no tiene rol: no entra al módulo.
    assert _cliente(sup, seguridad).get(f"{BASE}/me/").status_code == 403


def test_rol_global_vale_en_todas_sus_empresas(courier, seguridad):
    sup = _cuenta("sup", {courier: [], seguridad: []}, globales=[perms.SUPERVISOR_ROLE])
    for empresa in (courier, seguridad):
        respuesta = _cliente(sup, empresa).get(f"{BASE}/me/")
        assert respuesta.status_code == 200
        assert respuesta.json()["role"] == perms.SUPERVISOR_ROLE


def test_sin_sesion_no_hay_modulo(courier):
    assert APIClient().get(f"{BASE}/me/").status_code == 401


def test_pedir_una_empresa_ajena_no_muestra_nada(courier, seguridad):
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    # Pide LaarSeguridad sin pertenecer: no ve el módulo (ni el de su empresa).
    assert _cliente(sup, seguridad).get(f"{BASE}/me/").status_code == 403


# ── Aislamiento ───────────────────────────────────────────────────────────────


def test_la_misma_cedula_puede_estar_en_dos_empresas_y_cada_una_ve_la_suya(courier, seguridad):
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE], seguridad: [perms.SUPERVISOR_ROLE]})
    assert _alta(_cliente(sup, courier)).status_code == 201
    assert _alta(_cliente(sup, seguridad), nombre="Ana Pérez Ríos").status_code == 201
    # En la misma empresa sí es duplicado.
    repetida = _alta(_cliente(sup, courier))
    assert repetida.status_code == 409 and repetida.json()["error"]["code"] == "duplicate"

    lista = _cliente(sup, courier).get(f"{BASE}/collaborators/").json()
    assert [c["full_name"] for c in lista] == ["Ana Pérez"]
    assert Collaborator.objects.todas().filter(cedula="0102030405").count() == 2


def test_el_supervisor_de_otra_empresa_no_es_supervisor_aqui(courier, seguridad):
    admin = _cuenta("admin", {courier: ["ADMINISTRADOR"]})
    propio = _cuenta("sup_lc", {courier: [perms.SUPERVISOR_ROLE]})
    ajeno = _cuenta("sup_ls", {seguridad: [perms.SUPERVISOR_ROLE]})
    cliente = _cliente(admin, courier)

    assert [s["id"] for s in cliente.get(f"{BASE}/supervisors/").json()] == [propio.pk]
    respuesta = _alta(cliente, supervisor_id=ajeno.pk)
    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "not_found"


def test_un_colaborador_de_otra_empresa_responde_404(courier, seguridad):
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE], seguridad: [perms.SUPERVISOR_ROLE]})
    ana = _alta(_cliente(sup, courier)).json()
    otro = _cliente(sup, seguridad)
    assert otro.get(f"{BASE}/collaborators/{ana['id']}/").status_code == 404
    cambio = otro.post(
        f"{BASE}/collaborators/{ana['id']}/status/",
        {"status": "INACTIVE", "reason": "Renuncia"},
        format="json",
    )
    assert cambio.status_code == 404
    assert Collaborator.objects.todas().get(pk=ana["id"]).status == "ACTIVE"


# ── Unión con el Empleado ─────────────────────────────────────────────────────


def _empleado(empresa, codigo, nombres="Ana"):
    with usando_empresa(empresa):
        area, _ = Departamento.objects.get_or_create(nombre="Operaciones", codigo="OPS")
        return Empleado.objects.create(
            nombres=nombres, apellidos="Pérez", codigo_empleado=codigo, departamento=area
        )


def test_el_codigo_de_empleado_enlaza_la_ficha_de_la_misma_empresa(courier, seguridad):
    propio = _empleado(courier, "OPS-0101")
    _empleado(seguridad, "OPS-0202")
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    cliente = _cliente(sup, courier)

    ana = _alta(cliente, codigo_empleado=" OPS-0101 ").json()
    assert (ana["codigo_empleado"], ana["empleado_id"]) == ("OPS-0101", propio.pk)
    # Un código que solo existe en otra empresa no enlaza nada.
    beto = _alta(cliente, cedula="0102030406", nombre="Beto", codigo_empleado="OPS-0202").json()
    assert (beto["codigo_empleado"], beto["empleado_id"]) == ("OPS-0202", None)
    # Corregir el código vuelve a buscar la ficha.
    corregido = cliente.patch(
        f"{BASE}/collaborators/{beto['id']}/", {"codigo_empleado": "OPS-0101"}, format="json"
    ).json()
    assert corregido["empleado_id"] == propio.pk


def test_la_importacion_enlaza_por_codigo_de_empleado(courier):
    propio = _empleado(courier, "OPS-0101")
    admin = _cuenta("admin", {courier: ["ADMINISTRADOR"]})
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    libro = openpyxl.Workbook()
    libro.active.append(["CEDULA", "NOMBRES COMPLETOS", "CARGO", "CODIGO EMPLEADO"])
    libro.active.append(["0102030405", "Ana Pérez", "Operador", "OPS-0101"])
    libro.active.append(["0102030406", "Beto Ríos", "Operador", ""])
    archivo = io.BytesIO()
    libro.save(archivo)

    cliente = _cliente(admin, courier)
    vista = cliente.post(
        f"{BASE}/imports/preview/",
        {
            "kind": "COLLABORATORS",
            "supervisor_id": sup.pk,
            "file": SimpleUploadedFile("base.xlsx", archivo.getvalue()),
        },
        format="multipart",
    )
    assert vista.status_code == 201, vista.json()
    confirmada = cliente.post(
        f"{BASE}/imports/{vista.json()['id']}/confirm/", {"strategy": "skip"}, format="json"
    )
    assert confirmada.status_code == 200
    with usando_empresa(courier):
        ana = Collaborator.objects.get(cedula="0102030405")
        beto = Collaborator.objects.get(cedula="0102030406")
    assert (ana.codigo_empleado, ana.empleado_id) == ("OPS-0101", propio.pk)
    assert (beto.codigo_empleado, beto.empleado_id) == ("", None)


# ── Cédula protegida (LOPDP) ──────────────────────────────────────────────────


def test_la_cedula_completa_solo_en_el_detalle_y_para_quien_gestiona(courier):
    """Decisión del 2026-11-04: en listados, grillas y matrices la cédula va
    siempre enmascarada, también para quien gestiona colaboradores; completa
    solo en el detalle de un colaborador (y en el Excel), para quien puede."""
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    asistente = _cuenta("asis", {courier: [perms.ASSISTANT_ROLE]})
    jefe = _cuenta("jefe", {courier: [perms.JEFE_ROLE]})
    _alta(_cliente(sup, courier))

    for quien in (sup, asistente, jefe):
        fila = _cliente(quien, courier).get(f"{BASE}/collaborators/").json()[0]
        assert fila["cedula"] == "••••••0405"
    # La búsqueda por cédula sigue funcionando en el servidor.
    encontrados = _cliente(sup, courier).get(f"{BASE}/collaborators/?q=0102030405").json()
    assert [c["full_name"] for c in encontrados] == ["Ana Pérez"]
    pk = encontrados[0]["id"]
    assert _cliente(sup, courier).get(f"{BASE}/collaborators/{pk}/").json()["cedula"] == (
        "0102030405"
    )
    detalle = _cliente(asistente, courier).get(f"{BASE}/collaborators/{pk}/").json()
    assert detalle["cedula"] == "••••••0405"
    with usando_empresa(courier):
        assert WorkedDayService.matrix(access(sup), OCT, sup)["rows"][0]["cedula"] == "••••••0405"
        completa = WorkedDayService.matrix(access(sup), OCT, sup, full_cedula=True)
        enmascarada = WorkedDayService.matrix(access(asistente), OCT, sup, full_cedula=True)
    assert completa["rows"][0]["cedula"] == "0102030405"
    assert enmascarada["rows"][0]["cedula"] == "••••••0405"
    assert str(Collaborator.objects.todas().get()) == "Ana Pérez"  # nunca en el __str__


# ── Avisos y correos por empresa ──────────────────────────────────────────────


def test_el_aviso_va_a_la_campana_del_administrador_de_la_empresa(courier, seguridad):
    admin_lc = _cuenta("admin_lc", {courier: ["ADMINISTRADOR"]})
    admin_ls = _cuenta("admin_ls", {seguridad: ["ADMINISTRADOR"]})
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    _alta(_cliente(sup, courier))

    aviso = Notificacion.objects.todas().get(usuario=admin_lc)
    assert aviso.empresa == courier
    assert aviso.tipo == "novedades.new_collaborator"
    assert aviso.enlace == "/admin/gestion-humana/novedades"
    assert "Ana Pérez" in aviso.resumen and "0405" not in aviso.resumen
    assert not Notificacion.objects.todas().filter(usuario__in=[admin_ls, sup]).exists()


def test_el_correo_de_salida_solo_va_a_la_lista_de_su_empresa(courier, seguridad):
    admin_lc = _cuenta("admin_lc", {courier: ["ADMINISTRADOR"]})
    admin_ls = _cuenta("admin_ls", {seguridad: ["ADMINISTRADOR"]})
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    for admin, empresa, correo in (
        (admin_lc, courier, "talento-lc@example.com"),
        (admin_ls, seguridad, "talento-ls@example.com"),
        # La misma dirección puede estar en las listas de las dos empresas.
        (admin_ls, seguridad, "comun@example.com"),
        (admin_lc, courier, "comun@example.com"),
    ):
        alta = _cliente(admin, empresa).post(
            f"{BASE}/collaborator-notifications/recipients/",
            {"kind": "EXIT", "email": correo},
            format="json",
        )
        assert alta.status_code == 201, alta.json()

    cliente = _cliente(sup, courier)
    ana = _alta(cliente).json()
    respuesta = cliente.post(
        f"{BASE}/collaborators/{ana['id']}/status/",
        {"status": "INACTIVE", "reason": "Renuncia"},
        format="json",
    )
    assert respuesta.status_code == 200
    assert sorted(m.to[0] for m in mail.outbox) == [
        "comun@example.com",
        "talento-lc@example.com",
    ]
    assert all("0102030405" not in m.alternatives[0][0] for m in mail.outbox)
    assert all("LaarCourier" in m.alternatives[0][0] for m in mail.outbox)


def test_el_reintento_programado_respeta_la_empresa_del_evento(courier, seguridad, settings):
    admin_ls = _cuenta("admin_ls", {seguridad: ["ADMINISTRADOR"]})
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    _cliente(admin_ls, seguridad).post(
        f"{BASE}/collaborator-notifications/recipients/",
        {"kind": "EXIT", "email": "talento-ls@example.com"},
        format="json",
    )
    cliente = _cliente(sup, courier)
    ana = _alta(cliente).json()
    cliente.post(
        f"{BASE}/collaborators/{ana['id']}/status/",
        {"status": "INACTIVE", "reason": "Renuncia"},
        format="json",
    )
    # Courier no tiene lista: el correo queda fallido y no sale a la de otra empresa.
    evento = CollaboratorExitNotification.objects.todas().get()
    assert evento.status == "FAILED" and mail.outbox == []

    # El comando corre sin petición ni empresa activa: tampoco la cruza.
    call_command("novedades_retry_notifications", stdout=io.StringIO())
    evento.refresh_from_db()
    assert evento.status == "FAILED" and mail.outbox == []


# ── Ajustes y feriados por empresa ────────────────────────────────────────────


def test_los_plazos_se_configuran_por_empresa(courier, seguridad):
    admin_lc = _cuenta("admin_lc", {courier: ["ADMINISTRADOR"]})
    admin_ls = _cuenta("admin_ls", {seguridad: ["ADMINISTRADOR"]})
    cambio = _cliente(admin_lc, courier).patch(
        f"{BASE}/deadlines/settings/", {"worked_days": 72}, format="json"
    )
    assert cambio.status_code == 200

    def horas(admin, empresa):
        items = _cliente(admin, empresa).get(f"{BASE}/deadlines/settings/").json()["items"]
        return {i["kind"]: i["hours"] for i in items}

    assert horas(admin_lc, courier)["worked_days"] == 72
    assert horas(admin_ls, seguridad)["worked_days"] == 48


def test_un_feriado_de_otra_empresa_no_cuenta(courier, seguridad):
    with usando_empresa(seguridad):
        EventoCalendario.objects.create(
            titulo="Fiesta local", tipo=EventoCalendario.Tipo.FERIADO, fecha=TODAY
        )
        assert is_holiday(TODAY)
    with usando_empresa(courier):
        assert not is_holiday(TODAY)


def test_el_supervisor_no_configura_los_plazos(courier):
    sup = _cuenta("sup", {courier: [perms.SUPERVISOR_ROLE]})
    respuesta = _cliente(sup, courier).patch(
        f"{BASE}/deadlines/settings/", {"worked_days": 72}, format="json"
    )
    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"


# ── Catálogo y roles sembrados ────────────────────────────────────────────────


def test_el_catalogo_agrupa_novedades_en_gestion_humana(db):
    bloque = PERMISSION_CATALOG["novedades"]
    assert bloque["grupo"]["id"] == "gestion_humana"
    assert set(bloque["permissions"]) == set(perms.ALL_CODENAMES) | {
        "novedades.ingresos_ver",
        "novedades.salidas_ver",
    }


def test_la_migracion_siembra_los_roles_operativos(db):
    def de(rol):
        # «Crear tickets» lo reciben todos los roles (roles/0040, 09/11/2026):
        # no es de Novedades.
        return set(Group.objects.get(name=rol).permissions.values_list("codename", flat=True)) - {
            "soporte.crear"
        }

    assert de(perms.SUPERVISOR_ROLE) == {
        perms.ACCEDER,
        perms.COLABORADORES,
        perms.REGISTRAR,
        perms.HISTORIAL,
        perms.CERRAR,
    }
    assert de(perms.ASSISTANT_ROLE) == {
        perms.ACCEDER,
        perms.CONSOLIDADO,
        perms.HISTORIAL,
        perms.EXPORTAR,
        perms.REGISTRAR,
    }
    assert de(perms.JEFE_ROLE) == {perms.ACCEDER, perms.CONSOLIDADO, perms.DEPURAR}


def test_el_administrador_de_gestion_humana_solo_administra_el_modulo(courier):
    """Administra todo el módulo (también Ingresos y salidas) sin ser
    administrador del sistema: ningún permiso de otro módulo (04/11/2026)."""
    rol = Group.objects.get(name="Administrador de Gestión Humana")
    codenames = set(rol.permissions.values_list("codename", flat=True))
    # Desde la fase 2a (tasks/0002) administra también Tareas y Equipo, y desde
    # la 2b (projects/0002, ausencias/0002) Proyectos y Ausencias, desde la 2c
    # (informes/0002) los Informes ejecutivos, desde mejora_continua/0002 la
    # Mejora continua y desde reuniones/0002 y escritorio/0002 las Reuniones y
    # el Escritorio: todo Gestión Humana y nada de otro módulo. La única
    # excepción, desde privacidad/0002 (09/11/2026, decisión del usuario):
    # atiende las solicitudes de derechos sobre datos personales de toda la
    # intranet, porque Gestión Humana responde por los datos de las personas.
    assert codenames == (
        set(PERMISSION_CATALOG["novedades"]["permissions"])
        | set(PERMISSION_CATALOG["tareas"]["permissions"])
        | set(PERMISSION_CATALOG["equipo"]["permissions"])
        | set(PERMISSION_CATALOG["proyectos_gh"]["permissions"])
        | set(PERMISSION_CATALOG["ausencias"]["permissions"])
        | set(PERMISSION_CATALOG["kpi"]["permissions"])
        | set(PERMISSION_CATALOG["inteligencia_preventiva"]["permissions"])
        | set(PERMISSION_CATALOG["informes_gh"]["permissions"])
        | set(PERMISSION_CATALOG["mejora_continua"]["permissions"])
        | set(PERMISSION_CATALOG["reuniones"]["permissions"])
        | set(PERMISSION_CATALOG["escritorio"]["permissions"])
        | set(PERMISSION_CATALOG["privacidad"]["permissions"])
        # Como todo rol desde roles/0040: crear tickets a su nombre.
        | {"soporte.crear"}
    )

    admin_gh = _cuenta("admin_gh", {courier: ["Administrador de Gestión Humana"]})
    cliente = _cliente(admin_gh, courier)
    yo = cliente.get(f"{BASE}/me/").json()
    assert yo["national_write"] is True
    assert yo["role"] is None
    assert cliente.get(f"{BASE}/permissions/config/").status_code == 200
    assert cliente.get(f"{BASE}/movements/access/").status_code == 200
    # Fuera del módulo, nada: ni usuarios ni la configuración del sistema.
    assert cliente.get("/api/v1/admin/users/").status_code == 403


def test_destinatarios_unicos_dentro_de_la_empresa(courier):
    admin = _cuenta("admin", {courier: ["ADMINISTRADOR"]})
    cliente = _cliente(admin, courier)
    datos = {"kind": "ENTRY", "email": " Talento@Example.com "}
    assert (
        cliente.post(
            f"{BASE}/collaborator-notifications/recipients/", datos, format="json"
        ).status_code
        == 201
    )
    repetido = cliente.post(f"{BASE}/collaborator-notifications/recipients/", datos, format="json")
    assert repetido.status_code == 409 and repetido.json()["error"]["code"] == "duplicate"
    assert CollaboratorNotificationRecipient.objects.todas().get().email == "talento@example.com"


def test_los_roles_de_gestion_humana_solo_conceden_tareas_y_equipo(db):
    """Vienen de Nexo para que cada persona quede con su rol. En Novedades no
    conceden nada; desde la fase 2a (tasks/0002) dan lo suyo en Tareas y
    Equipo, desde la 2b en Proyectos y Ausencias, desde la 2c en Informes
    ejecutivos (Jefe y Coordinador Nacional) y luego en Mejora continua,
    Reuniones y Escritorio; nada de otro módulo."""
    for nombre in ("JEFE_NACIONAL", "ANALISTA_CC", "TRABAJO_SOCIAL", "ASISTENTE_NOMINA"):
        codenames = set(
            Group.objects.get(name=nombre).permissions.values_list("codename", flat=True)
        )
        assert "tareas.acceder" in codenames
        assert all(
            c.startswith(
                (
                    "tareas.",
                    "equipo.",
                    # Como todo rol desde roles/0040: crear tickets a su nombre.
                    "soporte.crear",
                    "proyectos_gh.",
                    "ausencias.",
                    "kpi.",
                    "inteligencia_preventiva.",
                    "informes_gh.",
                    "mejora_continua.",
                    "reuniones.",
                    "escritorio.",
                )
            )
            for c in codenames
        ), codenames
