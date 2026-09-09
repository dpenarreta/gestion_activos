"""Minimización y protección de los datos personales de los empleados.

Estas pruebas fijan decisiones que son fáciles de deshacer sin querer: alguien
podría volver a añadir la cédula al modelo, o exponerla en la plantilla, o
quitar un fragmento de la lista de enmascarado, y sin una prueba que lo
señale el sistema volvería a acumular datos personales innecesarios.
"""

from io import BytesIO

import pytest
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.core.models import AuditLog
from apps.core.sensitive_data import mask_sensitive_fields
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_datos", email="admin_datos@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


# --- Minimización ----------------------------------------------------------


def test_el_empleado_no_tiene_campo_de_cedula(db):
    """El sistema solo necesita un identificador único para saber quién
    custodia qué; la cédula no aporta a esa finalidad."""
    campos = {campo.name for campo in Empleado._meta.get_fields()}

    assert "documento_identidad" not in campos
    assert "codigo_empleado" in campos


def test_la_api_no_expone_ningun_documento_de_identidad(cliente, departamento):
    Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", codigo_empleado="EMP-0001", departamento=departamento
    )

    cuerpo = str(cliente.get("/api/v1/organizacion/empleados/").json())

    assert "documento" not in cuerpo.lower()
    assert "cedula" not in cuerpo.lower()


def test_el_codigo_se_genera_solo_si_no_se_indica(cliente, departamento):
    """Evita que alguien use la cédula como código «porque hay que poner algo»."""
    respuesta = cliente.post(
        "/api/v1/organizacion/empleados/",
        {"nombres": "Ana", "apellidos": "Pérez", "departamento": departamento.id},
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["codigo_empleado"] == f"{departamento.codigo}-0001"


def test_el_codigo_lleva_delante_el_area_de_la_persona(db, departamento):
    """Antes era un correlativo global —«EMP-0007»— que no decía nada de la
    persona: para saber de qué área era había que abrir su ficha. El código
    aparece en actas de entrega y en la plantilla de carga, donde ubicar de un
    vistazo a quien responde por un equipo es justamente lo que se necesita."""
    primero = Empleado.objects.create(nombres="Ana", apellidos="Pérez", departamento=departamento)
    segundo = Empleado.objects.create(nombres="Luis", apellidos="Torres", departamento=departamento)

    assert primero.codigo_empleado == f"{departamento.codigo}-0001"
    assert segundo.codigo_empleado == f"{departamento.codigo}-0002"


def test_cada_area_numera_por_su_cuenta(db, departamento):
    """El número dice cuántas personas lleva registradas esa área, no cuántas
    lleva la empresa: dos áreas creciendo a la vez no se pisan el correlativo."""
    otra = Departamento.objects.create(nombre="Contabilidad", codigo="CONT")

    Empleado.objects.create(nombres="Ana", apellidos="Pérez", departamento=departamento)
    de_otra_area = Empleado.objects.create(nombres="Rosa", apellidos="Díaz", departamento=otra)

    assert de_otra_area.codigo_empleado == "CONT-0001"


def test_el_correlativo_no_se_rompe_al_pasar_de_nueve(db, departamento):
    """Tomar el máximo por orden alfabético devolvería el número equivocado:
    «TI-0010» ordena antes que «TI-0009»."""
    for numero in range(1, 11):
        Empleado.objects.create(
            nombres=f"Persona {numero}", apellidos="Prueba", departamento=departamento
        )

    ultimo = Empleado.objects.create(nombres="Once", apellidos="Prueba", departamento=departamento)

    assert ultimo.codigo_empleado == f"{departamento.codigo}-0011"


# --- Auditoría -------------------------------------------------------------


def test_la_auditoria_enmascara_correo_y_telefono(cliente, departamento):
    """La bitácora es append-only: lo que entra ahí no se puede borrar después,
    así que un correo grabado quedaría fuera del alcance de una supresión."""
    cliente.post(
        "/api/v1/organizacion/empleados/",
        {
            "nombres": "Ana",
            "apellidos": "Pérez",
            "correo": "ana.perez@empresa.com",
            "telefono": "0991234567",
            "departamento": departamento.id,
        },
        format="json",
    )

    evento = AuditLog.objects.filter(action="empleado.created").get()
    assert evento.new_values["correo"] == "***"
    assert evento.new_values["telefono"] == "***"
    # Lo que la auditoría sí debe conservar: qué se creó y quién lo hizo.
    assert evento.new_values["nombres"] == "Ana"
    assert evento.actor is not None


def test_el_enmascarado_cubre_las_variantes_del_nombre_del_campo():
    datos = {
        "documento_identidad": "1712345678",
        "cedula": "1712345678",
        "correo_electronico": "a@b.com",
        "email": "a@b.com",
        "telefono_celular": "0991234567",
        "nombres": "Ana",
    }

    enmascarado = mask_sensitive_fields(datos)

    assert enmascarado["documento_identidad"] == "***"
    assert enmascarado["cedula"] == "***"
    assert enmascarado["correo_electronico"] == "***"
    assert enmascarado["email"] == "***"
    assert enmascarado["telefono_celular"] == "***"
    assert enmascarado["nombres"] == "Ana"


def test_el_comando_de_purga_enmascara_lo_ya_escrito(db, departamento):
    """El enmascarado se aplica al escribir; los eventos anteriores a que un
    campo entrara en la lista conservan el valor en claro."""
    from django.core.management import call_command

    evento = AuditLog.objects.create(
        action="empleado.created",
        target_type="empleado",
        target_id="1",
        module="organizacion",
        new_values={"nombres": "Ana", "correo": "ana@empresa.com"},
    )
    # Se escribe saltando el enmascarado, como haría un evento antiguo.
    AuditLog.objects.filter(id=evento.id).update(
        new_values={"nombres": "Ana", "correo": "ana@empresa.com"}
    )

    call_command("purgar_datos_personales_auditoria", "--aplicar")

    evento.refresh_from_db()
    assert evento.new_values["correo"] == "***"
    assert evento.new_values["nombres"] == "Ana"


# --- Archivos que salen del sistema ---------------------------------------


def test_la_plantilla_de_carga_no_lleva_datos_de_contacto(cliente, departamento):
    """El .xlsx se descarga y circula por correo o USB: debe llevar lo mínimo
    para identificar al custodio, no la ficha del empleado."""
    TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez",
        codigo_empleado="EMP-0001",
        correo="ana.perez@empresa.com",
        telefono="0991234567",
        departamento=departamento,
    )

    contenido = cliente.get("/api/v1/activos/plantilla-importacion/").content
    hoja = load_workbook(BytesIO(contenido))["Empleados"]
    filas = [list(fila) for fila in hoja.iter_rows(values_only=True)]
    texto = str(filas)

    assert filas[0] == ["Código", "Nombre", "Departamento"]
    assert "EMP-0001" in texto
    assert "ana.perez@empresa.com" not in texto
    assert "0991234567" not in texto
