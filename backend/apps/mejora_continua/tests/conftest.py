"""Fixtures de Mejora continua.

Como en las pruebas de Informes (`apps/informes/tests/conftest.py`):

- Cada prueba corre dentro de una empresa (fixture global de `backend/conftest.py`).
- Cada cuenta que se crea nace con membresía en esa empresa (sin roles): los
  roles de Gestión Humana se asignan como roles globales (`user.groups`).
- La jerarquía es el organigrama: `organigrama(jefe, *subordinados)`.
- Los adjuntos van a una carpeta temporal (`MEDIA_ROOT`).

Los datos son de un equipo de prueba con nombres realistas (tildes, eñes), sin
datos reales.
"""

import io
import zipfile

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.models.signals import post_save
from rest_framework.test import APIClient

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.mejora_continua.models import ImprovementIdea
from apps.organizacion.models import Cargo, DatosDeContacto
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

BASE = "/api/v1/mejora-continua"

#: Un PDF mínimo: lo que importa es la firma (`%PDF-`), que se valida.
PDF_BYTES = b"%PDF-1.4\n% propuesta de mejora\n%%EOF\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def docx_bytes() -> bytes:
    """Un .docx mínimo con lo que se comprueba por dentro."""
    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w") as contenedor:
        contenedor.writestr("[Content_Types].xml", "<Types/>")
        contenedor.writestr("word/document.xml", "<w:document/>")
    return memoria.getvalue()


def _unir_a_la_empresa(sender, instance, created, **kwargs):
    empresa = empresa_actual()
    if not created or empresa is None or empresa is SIN_EMPRESA:
        return
    MembresiaEmpresa.objects.get_or_create(
        usuario=instance, empresa=empresa, defaults={"es_predeterminada": True}
    )


@pytest.fixture(autouse=True)
def _cuentas_de_la_empresa(db):
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="mejora_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="mejora_tests_unir")


@pytest.fixture(autouse=True)
def _adjuntos_en_temporal(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


def make_user(username: str, role: str | None = None, *, first_name: str = "", **extra) -> User:
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        first_name=first_name,
        **extra,
    )
    if role:
        user.groups.set([Group.objects.get(name=role)])
    return user


def client_for(user: User) -> APIClient:
    """Cliente con la cuenta recién leída (los permisos se memorizan)."""
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=user.pk))
    return client


def poner_en_cargo(user: User, cargo: Cargo | None) -> None:
    DatosDeContacto.objects.update_or_create(
        usuario=user, empresa=empresa_actual(), defaults={"cargo": cargo}
    )


def organigrama(jefe: User, *subordinados: User) -> Cargo:
    """`jefe` en un cargo y cada subordinado en uno que le reporta."""
    perfil = DatosDeContacto.objects.filter(usuario=jefe, cargo__isnull=False).first()
    cargo_jefe = perfil.cargo if perfil else Cargo.objects.create(nombre=f"Jefatura {jefe.pk}")
    poner_en_cargo(jefe, cargo_jefe)
    for persona in subordinados:
        poner_en_cargo(persona, Cargo.objects.create(nombre=f"Cargo {persona.pk}", jefe=cargo_jefe))
    return cargo_jefe


def idea_de(autor: User, **extra) -> ImprovementIdea:
    datos = {
        "title": "Turnos rotativos en la bodega de Guayaquil",
        "description": "Reducir horas extras con dos turnos y pausas activas — Peñaherrera.",
        "impact": ImprovementIdea.Impact.ALTO,
        "author": autor,
        **extra,
    }
    return ImprovementIdea.objects.create(**datos)


def subir(nombre: str, contenido: bytes, tipo: str = "application/octet-stream"):
    return SimpleUploadedFile(nombre, contenido, content_type=tipo)


@pytest.fixture
def jefa():
    return make_user("jnacional", "JEFE_NACIONAL", first_name="Jimena")


@pytest.fixture
def coordinador():
    return make_user("czonal", "COORDINADOR_ZS", first_name="Óscar")


@pytest.fixture
def ana():
    return make_user("anunez", "ANALISTA_CC", first_name="Ana")


@pytest.fixture
def nino():
    return make_user("nnoboa", "ASISTENTE_GH", first_name="Niño")


@pytest.fixture
def externa():
    """Del departamento, pero fuera del equipo del coordinador."""
    return make_user("eespana", "ANALISTA_SELECCION", first_name="Eugenia")


@pytest.fixture
def admin_gh():
    return make_user("admingh", ADMIN_GH, first_name="Adela")


@pytest.fixture
def ajena():
    """Cuenta de la empresa sin ningún rol de Gestión Humana."""
    return make_user("contabilidad", first_name="Begoña")


@pytest.fixture
def equipo(coordinador, ana, nino):
    """El coordinador con Ana y Niño a su cargo."""
    organigrama(coordinador, ana, nino)
    return [ana, nino]
