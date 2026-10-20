"""Roles del sistema según los niveles del organigrama.

Lo que se protege (20/10/2026): cada nivel tiene su rol («Empresa · Nivel»),
que nace sin permisos y se crea, renombra y borra con el nivel; quien ocupa
un cargo recibe el rol del nivel de su unidad, y si cambia de cargo cambia de
rol solo; los roles personalizados se conservan; en Roles, el de nivel se
edita en permisos pero no se renombra ni se borra a mano.
"""

from django.contrib.auth.models import Group

from apps.empresas.contexto import empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import NivelJerarquico
from apps.organizacion.tests.test_organigrama import BASE, _cuenta

ROLES = "/api/v1/admin/roles/"


def _roles_de(usuario):
    membresia = MembresiaEmpresa.objects.get(usuario=usuario, empresa=empresa_actual())
    return set(membresia.roles.values_list("name", flat=True))


def _armar(admin):
    def crear(ruta, **datos):
        respuesta = admin.post(f"{BASE}{ruta}/", datos, format="json")
        assert respuesta.status_code == 201, respuesta.data
        return respuesta.json()

    gerencia = crear("niveles", nombre="Gerencia", orden=1)
    area = crear("niveles", nombre="Área", orden=2)
    gg = crear("unidades", nombre="Gerencia General", nivel=gerencia["id"])
    ti = crear("unidades", nombre="TI", nivel=area["id"], padre=gg["id"])
    gerente = crear("cargos", nombre="Gerente", unidad=gg["id"])
    analista = crear("cargos", nombre="Analista", unidad=ti["id"], jefe=gerente["id"])
    return {"gerencia": gerencia, "area": area, "ti": ti, "gerente": gerente, "analista": analista}


def test_cada_nivel_tiene_su_rol_sin_permisos(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    empresa = empresa_actual().nombre
    nivel = NivelJerarquico.objects.get(pk=e["gerencia"]["id"])
    assert nivel.rol.name == f"{empresa} · Gerencia"
    assert nivel.rol.permissions.count() == 0

    admin.patch(f"{BASE}niveles/{nivel.pk}/", {"nombre": "Gerencias"}, format="json")
    nivel.refresh_from_db()
    assert nivel.rol.name == f"{empresa} · Gerencias"

    sobrante = admin.post(f"{BASE}niveles/", {"nombre": "Sección", "orden": 9}, format="json")
    rol_id = NivelJerarquico.objects.get(pk=sobrante.json()["id"]).rol_id
    assert admin.delete(f"{BASE}niveles/{sobrante.json()['id']}/").status_code == 204
    assert not Group.objects.filter(pk=rol_id).exists()


def test_el_cargo_da_el_rol_de_su_nivel_y_lo_cambia_solo(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    rosa, _ = _cuenta("rosa")
    empresa = empresa_actual().nombre
    personalizado = Group.objects.create(name="Brigada de emergencia")
    MembresiaEmpresa.objects.get(usuario=rosa, empresa=empresa_actual()).roles.add(personalizado)

    asignar = f"{BASE}asignaciones/"
    admin.post(asignar, {"usuario": rosa.id, "cargo": e["analista"]["id"]}, format="json")
    assert _roles_de(rosa) == {f"{empresa} · Área", "Brigada de emergencia"}

    # Cambia de cargo: cambia de rol; el personalizado se queda.
    admin.post(asignar, {"usuario": rosa.id, "cargo": e["gerente"]["id"]}, format="json")
    assert _roles_de(rosa) == {f"{empresa} · Gerencia", "Brigada de emergencia"}

    # Sin cargo, sin rol de nivel.
    admin.post(asignar, {"usuario": rosa.id, "cargo": None}, format="json")
    assert _roles_de(rosa) == {"Brigada de emergencia"}

    # También al elegirlo en «Mi perfil».
    from apps.empresas.contexto import usando_empresa
    from apps.organizacion import contacto
    from apps.organizacion.models import Cargo

    with usando_empresa(empresa_actual()):
        contacto.guardar(
            rosa,
            nombres="Rosa",
            apellidos="Vera",
            telefono="0991112222",
            departamento=None,
            sede=None,
            cargo=Cargo.objects.get(pk=e["analista"]["id"]),
        )
    assert f"{empresa} · Área" in _roles_de(rosa)


def test_si_la_unidad_cambia_de_nivel_cambia_el_rol(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    rosa, _ = _cuenta("rosa")
    empresa = empresa_actual().nombre
    admin.post(
        f"{BASE}asignaciones/", {"usuario": rosa.id, "cargo": e["analista"]["id"]}, format="json"
    )
    nuevo = admin.post(f"{BASE}niveles/", {"nombre": "Sección", "orden": 3}, format="json").json()
    admin.patch(f"{BASE}unidades/{e['ti']['id']}/", {"nivel": nuevo["id"]}, format="json")
    assert _roles_de(rosa) == {f"{empresa} · Sección"}


def test_en_roles_se_editan_sus_permisos_pero_no_se_renombra_ni_se_borra(db):
    _, admin = _cuenta(
        "ines", "ver", "editar", "asignar", "roles.ver", "roles.editar", "vacaciones.ver_todas"
    )
    e = _armar(admin)
    rol = NivelJerarquico.objects.get(pk=e["gerencia"]["id"]).rol
    datos = next(r for r in admin.get(ROLES).json() if r["id"] == rol.id)
    assert datos["nivel"]["nombre"] == "Gerencia"

    permisos = admin.patch(
        f"{ROLES}{rol.id}/", {"permission_codenames": ["vacaciones.ver_todas"]}, format="json"
    )
    assert permisos.status_code == 200, permisos.data
    assert admin.patch(f"{ROLES}{rol.id}/", {"name": "Otro"}, format="json").status_code == 400
    assert admin.delete(f"{ROLES}{rol.id}/").status_code == 400
    assert Group.objects.filter(pk=rol.id).exists()


def test_un_rol_de_nivel_no_se_asigna_como_global(db):
    """Valdría en todas las empresas: el de nivel va por empresa y lo pone el
    cargo."""
    from apps.users.services import UserAdminService

    admin_usuario, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    rol = NivelJerarquico.objects.get(pk=e["gerencia"]["id"]).rol
    rosa, _ = _cuenta("rosa")
    UserAdminService.assign_roles(actor=admin_usuario, user=rosa, role_ids=[rol.id])
    assert not rosa.groups.filter(pk=rol.id).exists()
