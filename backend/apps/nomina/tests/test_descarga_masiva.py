"""Descarga masiva de roles de pagos por área (22/10/2026).

Lo que se protege:

- Solo con `roles_pago.descarga_masiva` (nómina de Gestión Humana,
  Administrador, Superusuario), y con la contraseña de quien descarga.
- Un ZIP sin clave con un PDF por persona del área (y de las unidades que
  dependen de ella), nombrado con su código y su nombre; nada de otras áreas.
- Quien no tiene código o no tiene rol ese mes queda en «LEEME.txt».
- Queda en la auditoría.
- La regla del permiso distingue el homónimo pedido por su nombre completo.
"""

import io
import zipfile

import pytest
from django.test import override_settings

from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.nomina import fuente
from apps.organizacion import organigrama
from apps.organizacion.models import Cargo, NivelJerarquico, UnidadOrganizacional
from apps.organizacion.permisos_por_cargo import permisos_del_cargo
from apps.organizacion.tests.test_carga_personas import _cuenta

URL = "/api/v1/nomina/rol-pagos/descarga-masiva/"
CLAVE = "Sup3r-Secr3t!"


@pytest.fixture(autouse=True)
def _ejemplo():
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        yield


def _persona(nombre, codigo, cargo):
    usuario, _ = _cuenta(nombre)
    usuario.codigo_empleado = codigo
    usuario.save()
    with usando_empresa(empresa_actual()):
        organigrama.asignar(usuario, cargo)
    return usuario


def _area():
    """Comercial (2 personas) > Ventas (1 persona); Tecnología (1 persona)."""
    with usando_empresa(empresa_actual()):
        area = NivelJerarquico.objects.create(nombre="Área", orden=1)
        sub = NivelJerarquico.objects.create(nombre="Subárea", orden=2)
        comercial = UnidadOrganizacional.objects.create(nombre="Comercial", nivel=area)
        ventas = UnidadOrganizacional.objects.create(nombre="Ventas", nivel=sub, padre=comercial)
        ti = UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=area)
        gerente = Cargo.objects.create(nombre="Gerente Comercial", unidad=comercial)
        analista = Cargo.objects.create(nombre="Analista Comercial", unidad=comercial)
        vendedor = Cargo.objects.create(nombre="Vendedor", unidad=ventas)
        programador = Cargo.objects.create(nombre="Programador", unidad=ti)
    _persona("gina", "101", gerente)
    _persona("ana", "102", analista)
    _persona("victor", "", vendedor)  # sin código
    _persona("tomas", "201", programador)
    return comercial, ti


def _descargar(cliente, unidad, **extra):
    datos = {"unidad": unidad.id, "anio": 2026, "mes": 9, "password": CLAVE, **extra}
    return cliente.post(URL, datos, format="json")


def test_solo_con_el_permiso_y_la_contrasena(db):
    comercial, _ = _area()
    _, sin_permiso = _cuenta("pedro", "roles_pago.historial", "roles_pago.consultar")
    assert sin_permiso.get(URL).status_code == 403
    assert _descargar(sin_permiso, comercial).status_code == 403
    _, nomina = _cuenta("nomina", "roles_pago.descarga_masiva")
    assert _descargar(nomina, comercial, password="otra").status_code == 403
    assert AuditLog.objects.filter(action="roles_pago.descarga_masiva_rechazada").exists()


def test_un_pdf_por_persona_del_area_y_sus_dependientes(db):
    comercial, _ = _area()
    _, nomina = _cuenta("nomina", "roles_pago.descarga_masiva")
    areas = {a["nombre"]: a for a in nomina.get(URL).json()}
    assert areas["Comercial"]["personas"] == 3 and areas["Comercial"]["con_codigo"] == 2
    assert areas["Tecnología"]["personas"] == 1

    respuesta = _descargar(nomina, comercial)
    assert respuesta.status_code == 200
    assert respuesta["Content-Type"] == "application/zip"
    assert "Roles%20de%20pago%20-%20Comercial%20-%20Septiembre%202026.zip" in (
        respuesta["Content-Disposition"]
    )
    archivo = zipfile.ZipFile(io.BytesIO(respuesta.content))
    nombres = sorted(archivo.namelist())
    pdfs = [n for n in nombres if n.endswith(".pdf")]
    assert len(pdfs) == 2
    assert [n.split(" - ")[0] for n in pdfs] == ["101", "102"]  # nada de Tecnología
    assert all(archivo.read(n).startswith(b"%PDF") for n in pdfs)
    assert all(not i.flag_bits & 0x1 for i in archivo.infolist())  # sin clave
    leeme = archivo.read("LEEME.txt").decode("utf-8-sig")
    assert "Victor Prueba: no tiene código de empleado." in leeme
    evento = AuditLog.objects.get(action="roles_pago.descarga_masiva")
    assert evento.new_values["incluidos"] == 2 and evento.new_values["omitidos"] == 1


def test_quien_no_tiene_rol_ese_mes_queda_en_el_leeme(db, monkeypatch):
    comercial, ti = _area()
    original = fuente.obtener

    def obtener(codigo, anio, mes, empresa=""):
        if codigo == "102":
            raise fuente.RolNoDisponible()
        return original(codigo, anio, mes, empresa)

    monkeypatch.setattr(fuente, "obtener", obtener)
    _, nomina = _cuenta("nomina", "roles_pago.descarga_masiva")
    archivo = zipfile.ZipFile(io.BytesIO(_descargar(nomina, comercial).content))
    assert len([n for n in archivo.namelist() if n.endswith(".pdf")]) == 1
    assert "Ana Prueba (102): no tiene rol de pagos en ese mes." in archivo.read(
        "LEEME.txt"
    ).decode("utf-8-sig")
    # Un área sin ningún rol ese mes no descarga un ZIP vacío.
    monkeypatch.setattr(
        fuente, "obtener", lambda *a, **k: (_ for _ in ()).throw(fuente.RolNoDisponible())
    )
    assert _descargar(nomina, ti).status_code == 400


def test_la_regla_es_para_el_asistente_del_coordinador_nacional():
    # Desde el organigrama GGHH 2026 los dos asistentes tienen nombres propios.
    assert "roles_pago.descarga_masiva" in permisos_del_cargo("Asistente de GGHH")
    assert "roles_pago.descarga_masiva" not in permisos_del_cargo(
        "Asistente Gestión Humana Zona Sur"
    )
    # Lo demás de nómina sigue valiendo para los dos.
    assert "roles_pago.historial" in permisos_del_cargo("Asistente Gestión Humana Zona Sur")
    for cargo in ("Coordinador Nacional de GGHH", "Asistente de Nómina"):
        assert "roles_pago.descarga_masiva" in permisos_del_cargo(cargo)
