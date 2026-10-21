"""Encender y apagar módulos por empresa.

Un módulo apagado no responde a nadie de la empresa, tenga los permisos que
tenga; solo el superusuario y quien tiene `configuracion.modulos` siguen
entrando. El bloqueo corre en la autenticación, así que se prueba con tokens
de verdad y no con `force_authenticate`, que se la salta.
"""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.authentication.services import AuthenticationService
from apps.core.models import AuditLog
from apps.empresas.models import Empresa, EstadoModulo, MembresiaEmpresa
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

URL = "/api/v1/empresas/modulos/"
MESA = "/api/v1/soporte/tickets/"


@pytest.fixture
def courier():
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


def _cliente(nombre, empresa, *permisos, superusuario=False):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
    )
    if superusuario:
        usuario.is_superuser = True
        usuario.save()
    tipo = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.set(
        Permission.objects.filter(content_type=tipo, codename__in=permisos)
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa, es_predeterminada=True)
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier=nombre, password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.credentials(
        HTTP_AUTHORIZATION=f"Bearer {tokens['access']}", HTTP_X_EMPRESA=str(empresa.id)
    )
    return cliente


def _apagado(respuesta) -> bool:
    return respuesta.status_code == 403 and "modulo_apagado" in str(respuesta.json())


def test_sin_filas_todos_los_modulos_estan_encendidos(courier):
    rosa = _cliente("rosa", courier)
    datos = rosa.get(URL).json()
    assert all(m["activo"] for m in datos["modulos"])
    assert {m["id"] for m in datos["modulos"]} >= {"institucional", "soporte", "activos"}
    assert datos["ve_apagados"] is False and datos["puede_gestionar"] is False


def test_apagar_pide_su_permiso(courier):
    rosa = _cliente("rosa", courier, "configuracion.editar")
    respuesta = rosa.put(URL, {"modulo": "soporte", "activo": False}, format="json")
    assert respuesta.status_code == 403
    assert not EstadoModulo.objects.todas().exists()


def test_un_modulo_desconocido_se_rechaza(courier):
    admin = _cliente("admin", courier, "configuracion.modulos")
    assert admin.put(URL, {"modulo": "nada", "activo": False}, format="json").status_code == 400
    assert admin.put(URL, {"modulo": "soporte", "activo": "no"}, format="json").status_code == 400


def test_apagado_nadie_entra_aunque_tenga_permisos_salvo_admin_y_superusuario(courier):
    admin = _cliente("admin", courier, "configuracion.modulos")
    rosa = _cliente("rosa", courier, "soporte.registrar", "soporte.atender")
    raiz = _cliente("raiz", courier, superusuario=True)

    assert rosa.get(MESA).status_code == 200
    datos = admin.put(URL, {"modulo": "soporte", "activo": False}, format="json").json()
    assert {m["id"]: m["activo"] for m in datos["modulos"]}["soporte"] is False
    assert AuditLog.objects.filter(action="empresas.modulo.apagado").exists()

    assert _apagado(rosa.get(MESA))
    # Lo común no se apaga: su perfil y el estado de los módulos siguen.
    assert rosa.get("/api/v1/auth/me/").status_code == 200
    assert rosa.get(URL).status_code == 200
    # Superusuario y administrador siguen entrando.
    assert not _apagado(admin.get(MESA))
    assert raiz.get(MESA).status_code == 200

    admin.put(URL, {"modulo": "soporte", "activo": True}, format="json")
    assert rosa.get(MESA).status_code == 200


def test_apagar_en_una_empresa_no_toca_la_otra(courier):
    seguridad = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    admin = _cliente("admin", courier, "configuracion.modulos")
    admin.put(URL, {"modulo": "soporte", "activo": False}, format="json")
    otra = _cliente("otra", seguridad, "soporte.registrar")
    assert otra.get(MESA).status_code == 200
    assert all(m["activo"] for m in otra.get(URL).json()["modulos"])
