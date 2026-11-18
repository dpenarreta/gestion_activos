"""Un cargo y su rol son lo mismo (18/11/2026, decisión del usuario).

Los roles creados en el organigrama (los de cada cargo) y los de
Configuración → Roles se asignan desde los dos lados:

- En la ficha del usuario, elegir el rol de un cargo ubica a la persona en
  ese cargo (cuenta en las plazas); quitárselo la saca. Dos cargos en la
  misma empresa no se permiten.
- En «Asignación de cargos», además del cargo, se dan y quitan los roles de
  Configuración, sin repartir permisos que uno no tiene.
"""

import pytest
from django.contrib.auth.models import Group, Permission

from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.empresas.servicios import asignar_empresas
from apps.organizacion.models import DatosDeContacto
from apps.organizacion.tests.test_organigrama import BASE, _cuenta
from apps.organizacion.tests.test_roles_de_cargo import _armar, _rol, _roles_de

ROLES = f"{BASE}asignaciones/roles/"


def _cargo_de(usuario):
    with usando_empresa(empresa_actual()):
        perfil = DatosDeContacto.objects.filter(usuario=usuario).first()
        return perfil.cargo_id if perfil else None


def _guardar_roles(actor, usuario, roles):
    return asignar_empresas(
        actor=actor,
        usuario=usuario,
        asignaciones=[
            {"empresa_id": empresa_actual().id, "roles": roles, "es_predeterminada": True}
        ],
    )


def test_elegir_el_rol_de_un_cargo_en_la_ficha_ubica_a_la_persona_en_el_cargo(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    admin_usuario = None  # el sistema: aquí no se prueba el alcance
    e = _armar(admin)
    rosa, _ = _cuenta("rosa")
    brigada = Group.objects.create(name="Brigada de emergencia")
    analista = _rol(e["analista"]["id"])

    _guardar_roles(admin_usuario, rosa, [brigada.id, analista.id])
    assert _cargo_de(rosa) == e["analista"]["id"]
    assert _roles_de(rosa) == {"Analista", "Brigada de emergencia"}
    assert AuditLog.objects.filter(action="institucional.cargo.asignado", target_id=str(rosa.pk))

    # Cambiar al rol de otro cargo la cambia de cargo.
    _guardar_roles(admin_usuario, rosa, [brigada.id, _rol(e["gerente"]["id"]).id])
    assert _cargo_de(rosa) == e["gerente"]["id"]
    assert _roles_de(rosa) == {"Gerente", "Brigada de emergencia"}

    # Quitarle el rol del cargo la saca del cargo; el otro rol se queda.
    _guardar_roles(admin_usuario, rosa, [brigada.id])
    assert _cargo_de(rosa) is None
    assert _roles_de(rosa) == {"Brigada de emergencia"}


def test_dos_roles_de_cargo_en_la_misma_empresa_no_se_permiten(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    admin_usuario = None
    e = _armar(admin)
    rosa, _ = _cuenta("rosa")
    with pytest.raises(ValueError, match="un\\s+solo cargo"):
        _guardar_roles(
            admin_usuario, rosa, [_rol(e["analista"]["id"]).id, _rol(e["gerente"]["id"]).id]
        )
    assert _cargo_de(rosa) is None


def test_guardar_sin_cambiar_el_rol_del_cargo_no_mueve_a_nadie(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    admin_usuario = None
    e = _armar(admin)
    rosa, _ = _cuenta("rosa")
    admin.post(
        f"{BASE}asignaciones/", {"usuario": rosa.id, "cargo": e["analista"]["id"]}, format="json"
    )
    analista = _rol(e["analista"]["id"])
    brigada = Group.objects.create(name="Brigada de emergencia")
    _guardar_roles(admin_usuario, rosa, [analista.id, brigada.id])
    assert _cargo_de(rosa) == e["analista"]["id"]
    assert not AuditLog.objects.filter(
        action="institucional.cargo.asignado", new_values__desde="roles del usuario"
    ).exists()


def test_en_asignacion_de_cargos_se_dan_y_quitan_los_roles_de_configuracion(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    _armar(admin)
    rosa, _ = _cuenta("rosa")
    brigada = Group.objects.create(name="Brigada de emergencia")

    catalogo = admin.get(ROLES).json()
    assert {"id": brigada.id, "nombre": "Brigada de emergencia"} in catalogo
    # Los de cargo no se ofrecen aquí: se dan con el cargo.
    assert all(r["nombre"] not in ("Gerente", "Analista") for r in catalogo)

    dado = admin.post(
        ROLES, {"usuario": rosa.id, "rol": brigada.id, "accion": "dar"}, format="json"
    )
    assert dado.status_code == 200, dado.data
    assert dado.json()["roles"] == [{"id": brigada.id, "nombre": "Brigada de emergencia"}]
    fila = next(p for p in admin.get(f"{BASE}asignaciones/?q=rosa").json() if p["id"] == rosa.id)
    assert fila["roles"] == [{"id": brigada.id, "nombre": "Brigada de emergencia"}]

    quitado = admin.post(
        ROLES, {"usuario": rosa.id, "rol": brigada.id, "accion": "quitar"}, format="json"
    )
    assert quitado.status_code == 200
    assert not MembresiaEmpresa.objects.get(usuario=rosa, empresa=empresa_actual()).roles.exists()
    assert AuditLog.objects.filter(action="institucional.rol.dado").exists()
    assert AuditLog.objects.filter(action="institucional.rol.quitado").exists()


def test_no_se_da_un_rol_con_permisos_que_uno_no_tiene(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    rosa, _ = _cuenta("rosa")
    poderoso = Group.objects.create(name="Administrador de usuarios")
    poderoso.permissions.add(
        Permission.objects.get(content_type__app_label="permissions", codename="usuarios.editar")
    )
    respuesta = admin.post(
        ROLES, {"usuario": rosa.id, "rol": poderoso.id, "accion": "dar"}, format="json"
    )
    assert respuesta.status_code == 403
    assert not MembresiaEmpresa.objects.get(usuario=rosa, empresa=empresa_actual()).roles.exists()


def test_en_la_ficha_no_se_da_el_rol_de_un_cargo_con_permisos_que_uno_no_tiene(db):
    """Ahora que el rol de un cargo se elige en la ficha, cuenta para el
    alcance como cualquier otro: nadie reparte lo que no tiene."""
    ines, admin = _cuenta("ines", "ver", "editar", "asignar")
    e = _armar(admin)
    rosa, _ = _cuenta("rosa")
    with pytest.raises(PermissionError):
        _guardar_roles(ines, rosa, [_rol(e["analista"]["id"]).id])
    assert _cargo_de(rosa) is None
