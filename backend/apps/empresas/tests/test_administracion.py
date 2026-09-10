"""Quién crea empresas y quién reparte el acceso a ellas.

Cobertura de tests/qa/features/multiempresa.feature (AC-EMP-006 a AC-EMP-014).

El aislamiento en sí está en `test_aislamiento.py`; aquí se prueba la puerta:
que administrar empresas y asignar usuarios estén gobernados por el catálogo de
permisos y no por ser administrador de usuarios, que son cosas distintas.
"""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.permissions.catalog import all_codenames
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _cuenta(nombre, *permisos):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.set(
        Permission.objects.filter(content_type=content_type, codename__in=permisos)
    )
    return usuario


def _cliente(usuario):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.fixture
def courier():
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad():
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


# --- El catálogo de permisos ------------------------------------------------


def test_los_permisos_de_empresas_estan_en_el_catalogo():
    assert {"empresas.ver", "empresas.editar", "empresas.asignar"} <= all_codenames()


# --- Ver y crear empresas ---------------------------------------------------


def test_sin_permiso_no_se_listan_las_empresas(courier):
    respuesta = _cliente(_cuenta("mirona")).get("/api/v1/empresas/")

    assert respuesta.status_code == 403


def test_con_empresas_ver_se_listan_todas(courier, seguridad):
    """Todas, no solo aquellas en las que trabaja: sin esto no se crea la segunda."""
    respuesta = _cliente(_cuenta("lectora", "empresas.ver")).get("/api/v1/empresas/")

    assert respuesta.status_code == 200
    nombres = [fila["nombre"] for fila in respuesta.data["results"]]
    assert {"LaarCourier", "LaarSeguridad"} <= set(nombres)


def test_ver_no_alcanza_para_crear(courier):
    respuesta = _cliente(_cuenta("lectora", "empresas.ver")).post(
        "/api/v1/empresas/", {"nombre": "LaarSeguridad", "codigo": "ls"}, format="json"
    )

    assert respuesta.status_code == 403
    assert not Empresa.objects.filter(nombre="LaarSeguridad").exists()


def test_se_crea_la_empresa_y_queda_auditada():
    usuario = _cuenta("editora", "empresas.ver", "empresas.editar")

    respuesta = _cliente(usuario).post(
        "/api/v1/empresas/",
        {"nombre": "LaarSeguridad", "codigo": "ls", "identificacion": "1790012345001"},
        format="json",
    )

    assert respuesta.status_code == 201
    # El código se normaliza: «ls» y «LS» son la misma empresa escrita de dos
    # maneras, y con las dos guardadas el selector mostraría dos entradas.
    assert Empresa.objects.get(nombre="LaarSeguridad").codigo == "LS"
    assert AuditLog.objects.filter(action="empresa.created", actor=usuario).exists()


def test_la_empresa_no_se_puede_eliminar(courier):
    usuario = _cuenta("editora", "empresas.ver", "empresas.editar")

    respuesta = _cliente(usuario).delete(f"/api/v1/empresas/{courier.id}/")

    assert respuesta.status_code == 405
    assert Empresa.objects.filter(pk=courier.pk).exists()


def test_desactivar_la_saca_del_selector_sin_borrar_nada(courier, seguridad):
    usuario = _cuenta("editora", "empresas.ver", "empresas.editar")
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=courier, es_predeterminada=True)
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=seguridad)

    _cliente(usuario).patch(f"/api/v1/empresas/{seguridad.id}/", {"activa": False}, format="json")
    respuesta = _cliente(usuario).get("/api/v1/empresas/mias/")

    assert [fila["nombre"] for fila in respuesta.data["empresas"]] == ["LaarCourier"]
    assert Empresa.objects.filter(pk=seguridad.pk).exists()


# --- Repartir el acceso -----------------------------------------------------


def test_administrar_usuarios_no_alcanza_para_asignar_empresas(courier, seguridad):
    """El permiso de usuarios edita perfiles; el de empresas reparte acceso."""
    jefa = _cuenta("jefa", "usuarios.ver", "usuarios.editar", "usuarios.crear")
    otra = _cuenta("otra")

    respuesta = _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/empresas/",
        {"empresa_ids": [courier.id, seguridad.id]},
        format="json",
    )

    assert respuesta.status_code == 403
    assert not MembresiaEmpresa.objects.filter(usuario=otra).exists()


def test_se_asignan_las_dos_empresas_y_queda_auditado(courier, seguridad):
    jefa = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    otra = _cuenta("otra")

    respuesta = _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/empresas/",
        {"empresa_ids": [courier.id, seguridad.id], "empresa_predeterminada": seguridad.id},
        format="json",
    )

    assert respuesta.status_code == 200
    assert [fila["nombre"] for fila in respuesta.data["empresas"]] == [
        "LaarCourier",
        "LaarSeguridad",
    ]
    predeterminada = MembresiaEmpresa.objects.get(usuario=otra, es_predeterminada=True)
    assert predeterminada.empresa == seguridad
    assert AuditLog.objects.filter(action="user.empresas_assigned", actor=jefa).exists()


def test_la_asignacion_reemplaza_la_lista_entera(courier, seguridad):
    """Quien revisa accesos piensa en «esta persona ve estas», no en sumar."""
    jefa = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    otra = _cuenta("otra")
    MembresiaEmpresa.objects.create(usuario=otra, empresa=seguridad, es_predeterminada=True)

    _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/empresas/",
        {"empresa_ids": [courier.id]},
        format="json",
    )

    assert list(
        MembresiaEmpresa.objects.filter(usuario=otra).values_list("empresa__nombre", flat=True)
    ) == ["LaarCourier"]


def test_sin_predeterminada_se_toma_la_primera_por_nombre(courier, seguridad):
    jefa = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    otra = _cuenta("otra")

    _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/empresas/",
        {"empresa_ids": [seguridad.id, courier.id]},
        format="json",
    )

    assert MembresiaEmpresa.objects.get(usuario=otra, es_predeterminada=True).empresa == courier


def test_la_predeterminada_tiene_que_estar_entre_las_asignadas(courier, seguridad):
    jefa = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    otra = _cuenta("otra")

    respuesta = _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/empresas/",
        {"empresa_ids": [courier.id], "empresa_predeterminada": seguridad.id},
        format="json",
    )

    assert respuesta.status_code == 400
    assert not MembresiaEmpresa.objects.filter(usuario=otra).exists()


def test_una_empresa_inexistente_no_asigna_nada(courier):
    jefa = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    otra = _cuenta("otra")

    respuesta = _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/empresas/",
        {"empresa_ids": [courier.id, 9999]},
        format="json",
    )

    assert respuesta.status_code == 400
    assert not MembresiaEmpresa.objects.filter(usuario=otra).exists()


def test_nadie_puede_dejarse_a_si_mismo_sin_empresas(courier, seguridad):
    """Quien se queda sin membresías deja de ver todo y no puede devolvérselo."""
    jefa = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    MembresiaEmpresa.objects.create(usuario=jefa, empresa=courier, es_predeterminada=True)

    respuesta = _cliente(jefa).post(
        f"/api/v1/admin/users/{jefa.id}/empresas/", {"empresa_ids": []}, format="json"
    )

    assert respuesta.status_code == 400
    assert MembresiaEmpresa.objects.filter(usuario=jefa).exists()


def test_a_otro_si_se_le_pueden_quitar_todas(courier, seguridad):
    jefa = _cuenta("jefa", "usuarios.ver", "empresas.ver", "empresas.asignar")
    otra = _cuenta("otra")
    MembresiaEmpresa.objects.create(usuario=otra, empresa=courier, es_predeterminada=True)

    respuesta = _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/empresas/", {"empresa_ids": []}, format="json"
    )

    assert respuesta.status_code == 200
    assert not MembresiaEmpresa.objects.filter(usuario=otra).exists()
    # Y deja de ver empresas: con dos creadas ya no hay excepción de una sola.
    assert _cliente(otra).get("/api/v1/empresas/mias/").data["empresas"] == []


# --- El selector no es un permiso -------------------------------------------


def test_el_selector_no_exige_permisos_del_catalogo(courier, seguridad):
    """Saber en qué empresa se está no es administrar empresas."""
    otra = _cuenta("otra")
    MembresiaEmpresa.objects.create(usuario=otra, empresa=seguridad, es_predeterminada=True)

    respuesta = _cliente(otra).get("/api/v1/empresas/mias/")

    assert respuesta.status_code == 200
    assert [fila["nombre"] for fila in respuesta.data["empresas"]] == ["LaarSeguridad"]
    assert respuesta.data["activa"]["nombre"] == "LaarSeguridad"


def test_el_listado_de_usuarios_muestra_en_que_empresas_trabaja_cada_uno(courier, seguridad):
    jefa = _cuenta("jefa", "usuarios.ver")
    otra = _cuenta("otra")
    MembresiaEmpresa.objects.create(usuario=otra, empresa=courier, es_predeterminada=True)

    respuesta = _cliente(jefa).get("/api/v1/admin/users/")

    fila = next(u for u in respuesta.data["results"] if u["username"] == "otra")
    assert [empresa["nombre"] for empresa in fila["empresas"]] == ["LaarCourier"]
    assert fila["empresas"][0]["es_predeterminada"] is True
