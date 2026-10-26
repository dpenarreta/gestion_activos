"""Roles del sistema según los cargos del organigrama (21/10/2026).

Lo que se protege: cada cargo es un rol («Jefe TI», «Analista Programador»),
que nace con los permisos de todo empleado y se crea, renombra y borra con el
cargo; quienes ocupan el mismo cargo comparten el rol; un cargo que se llama
igual en otra unidad, o en la misma bajo otro jefe, tiene su propio rol; quien
ocupa un cargo recibe su rol, y si cambia de cargo cambia de rol solo; los
roles personalizados se conservan; en Roles, el de cargo se edita en permisos
pero no se renombra ni se borra a mano.
"""

from django.contrib.auth.models import Group

from apps.empresas.contexto import empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import Cargo
from apps.organizacion.roles_de_cargo import PERMISOS_BASE
from apps.organizacion.tests.test_organigrama import BASE, _cuenta

ROLES = "/api/v1/admin/roles/"


def _roles_de(usuario):
    membresia = MembresiaEmpresa.objects.get(usuario=usuario, empresa=empresa_actual())
    return set(membresia.roles.values_list("name", flat=True))


def _crear(admin, ruta, **datos):
    respuesta = admin.post(f"{BASE}{ruta}/", datos, format="json")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.json()


def _armar(admin):
    gerencia = _crear(admin, "niveles", nombre="Gerencia", orden=1)
    area = _crear(admin, "niveles", nombre="Área", orden=2)
    gg = _crear(admin, "unidades", nombre="Gerencia General", nivel=gerencia["id"])
    ti = _crear(admin, "unidades", nombre="TI", nivel=area["id"], padre=gg["id"])
    gerente = _crear(admin, "cargos", nombre="Gerente", unidad=gg["id"])
    analista = _crear(
        admin, "cargos", nombre="Analista", unidad=ti["id"], jefe=gerente["id"], plazas=3
    )
    return {"area": area, "gg": gg, "ti": ti, "gerente": gerente, "analista": analista}


def _rol(cargo_id):
    return Cargo.objects.get(pk=cargo_id).rol


def test_cada_cargo_es_un_rol_con_los_permisos_de_todo_empleado(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    rol = _rol(e["analista"]["id"])
    assert rol.name == "Analista"
    assert set(rol.permissions.values_list("codename", flat=True)) == set(PERMISOS_BASE)
    # Los niveles ya no crean roles.
    assert not Group.objects.filter(name__contains="Gerencia General ·").exists()

    admin.patch(
        f"{BASE}cargos/{e['analista']['id']}/", {"nombre": "Analista Programador"}, format="json"
    )
    assert _rol(e["analista"]["id"]).name == "Analista Programador"

    sobrante = _crear(admin, "cargos", nombre="Practicante", unidad=e["ti"]["id"])
    rol_id = _rol(sobrante["id"]).id
    assert admin.delete(f"{BASE}cargos/{sobrante['id']}/").status_code == 204
    assert not Group.objects.filter(pk=rol_id).exists()


def test_los_homonimos_se_distinguen_por_unidad_y_por_jefe(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    # Otro «Analista» en otra unidad: los dos se distinguen por la unidad.
    comercial = _crear(
        admin, "unidades", nombre="Comercial", nivel=e["area"]["id"], padre=e["gg"]["id"]
    )
    otro = _crear(admin, "cargos", nombre="Analista", unidad=comercial["id"])
    assert _rol(otro["id"]).name == "Analista · Comercial"
    assert _rol(e["analista"]["id"]).name == "Analista · TI"
    # Y uno más en TI bajo otro jefe: los de TI se distinguen por su jefe.
    coordinador = _crear(admin, "cargos", nombre="Coordinador TI", unidad=e["ti"]["id"])
    tercero = _crear(
        admin, "cargos", nombre="Analista", unidad=e["ti"]["id"], jefe=coordinador["id"]
    )
    assert _rol(tercero["id"]).name == "Analista · TI · Coordinador TI"
    assert _rol(e["analista"]["id"]).name == "Analista · TI · Gerente"
    assert _rol(otro["id"]).name == "Analista · Comercial"
    # Si la unidad se renombra, sus roles se renombran con ella.
    admin.patch(f"{BASE}unidades/{comercial['id']}/", {"nombre": "Ventas"}, format="json")
    assert _rol(otro["id"]).name == "Analista · Ventas"


def test_quienes_ocupan_el_cargo_comparten_su_rol_y_lo_cambian_solos(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    rosa, _ = _cuenta("rosa")
    beto, _ = _cuenta("beto")
    personalizado = Group.objects.create(name="Brigada de emergencia")
    MembresiaEmpresa.objects.get(usuario=rosa, empresa=empresa_actual()).roles.add(personalizado)

    asignar = f"{BASE}asignaciones/"
    for persona in (rosa, beto):
        admin.post(asignar, {"usuario": persona.id, "cargo": e["analista"]["id"]}, format="json")
    assert _roles_de(rosa) == {"Analista", "Brigada de emergencia"}
    assert _roles_de(beto) == {"Analista"}

    # Cambia de cargo: cambia de rol; el personalizado se queda.
    admin.post(asignar, {"usuario": rosa.id, "cargo": e["gerente"]["id"]}, format="json")
    assert _roles_de(rosa) == {"Gerente", "Brigada de emergencia"}

    # Sin cargo, sin rol de cargo.
    admin.post(asignar, {"usuario": rosa.id, "cargo": None}, format="json")
    assert _roles_de(rosa) == {"Brigada de emergencia"}

    # También al elegirlo en «Mi perfil».
    from apps.empresas.contexto import usando_empresa
    from apps.organizacion import contacto

    with usando_empresa(empresa_actual()):
        contacto.guardar(
            rosa,
            nombres="Rosa",
            apellidos="Vera",
            telefono="0991112222",
            departamento=None,
            sede=None,
            cargo=Cargo.objects.get(pk=e["analista"]["id"]),
            acepta_telefono=True,
        )
    assert "Analista" in _roles_de(rosa)


def test_en_roles_se_editan_sus_permisos_pero_no_se_renombra_ni_se_borra(db):
    _, admin = _cuenta(
        "ines", "ver", "editar", "asignar", "roles.ver", "roles.editar", "vacaciones.ver_todas"
    )
    e = _armar(admin)
    rol = _rol(e["gerente"]["id"])
    datos = next(r for r in admin.get(ROLES).json() if r["id"] == rol.id)
    assert datos["cargo"]["nombre"] == "Gerente"
    assert datos["cargo"]["unidad"] == "Gerencia General"

    permisos = admin.patch(
        f"{ROLES}{rol.id}/", {"permission_codenames": ["vacaciones.ver_todas"]}, format="json"
    )
    assert permisos.status_code == 200, permisos.data
    assert admin.patch(f"{ROLES}{rol.id}/", {"name": "Otro"}, format="json").status_code == 400
    assert admin.delete(f"{ROLES}{rol.id}/").status_code == 400
    assert Group.objects.filter(pk=rol.id).exists()


def test_un_rol_de_cargo_no_se_asigna_como_global(db):
    """Valdría en todas las empresas: el de cargo va por empresa y lo pone el
    cargo."""
    from apps.users.services import UserAdminService

    admin_usuario, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    rol = _rol(e["gerente"]["id"])
    rosa, _ = _cuenta("rosa")
    UserAdminService.assign_roles(actor=admin_usuario, user=rosa, role_ids=[rol.id])
    assert not rosa.groups.filter(pk=rol.id).exists()
