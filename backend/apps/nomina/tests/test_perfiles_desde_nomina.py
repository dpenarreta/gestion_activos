"""Perfiles de las personas desde nómina (US-021). Nunca se conecta a la base
externa: `sincronizar(empleados=[...])` recibe la lista ya leída, y `leer`
se prueba con la conexión simulada."""

from unittest import mock

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core import mail
from django.core.mail import EmailMessage, get_connection
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.nomina import empleados as nomina
from apps.nomina.empleados import Empleado
from apps.nomina.models import SincronizacionNomina
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db
URL = "/api/v1/nomina/sincronizacion/"


def _cuenta(nombre, *permisos, **extra):
    correo = extra.pop("email", f"{nombre}@grupolaar.com")
    u = User.objects.create_user(username=nombre, email=correo, password="Sup3r-Secr3t!", **extra)
    ct = ContentType.objects.get_for_model(ModulePermission)
    u.user_permissions.set(Permission.objects.filter(content_type=ct, codename__in=permisos))
    return u


def _cliente(u):
    c = APIClient()
    c.force_authenticate(user=u)
    return c


def emp(codigo="20100001", nombres="Ana Lucía", apellidos="Ñacato Pérez", correo="", cedula=""):
    return Empleado(
        codigo=codigo, nombres=nombres, apellidos=apellidos, correo=correo, cedula=cedula
    )


# --- Leer y separar --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("completo", "esperado"),
    [
        ("PEÑARRETA VACA DANIEL ALEJANDRO", ("Daniel Alejandro", "Peñarreta Vaca")),
        ("DE LA TORRE PEREZ MARIA JOSE", ("Maria Jose", "De la Torre Perez")),
        ("DEL POZO SAN MARTIN ANA", ("Ana", "Del Pozo San Martin")),
        ("LOPEZ JUAN", ("Juan", "Lopez")),
        ("GARCIA", ("Garcia", "")),
        ("", ("", "")),
    ],
)
def test_separa_apellidos_y_nombres(completo, esperado):
    assert nomina.separar_nombre(completo) == esperado


def test_lee_el_procedimiento_con_columnas_sin_importar_mayusculas(settings):
    settings.NOMINA_EMPLEADOS_PROCEDIMIENTO = "dbo.sp_ObtenerEmpleadosActivos"
    cursor = mock.Mock()
    cursor.description = [("CODIGO_EMP",), ("NOMBRE_COMPLETO",), ("email_emp",), ("CEDULA",)]
    cursor.fetchall.return_value = [
        (" 20100001 ", "ÑACATO PEREZ ANA LUCIA", "", "1712345678"),
        ("20100002", "LOPEZ JUAN", "Juan.Lopez@GrupoLaar.com", None),
    ]
    conexion = mock.Mock()
    conexion.cursor.return_value = cursor
    with mock.patch("apps.cartera.services.db_source._conectar", return_value=conexion):
        lista = nomina.leer()
    cursor.execute.assert_called_once_with("EXEC dbo.sp_ObtenerEmpleadosActivos")
    assert lista == [
        Empleado("20100001", "Ana Lucia", "Ñacato Perez", "", "1712345678"),
        Empleado("20100002", "Juan", "Lopez", "juan.lopez@grupolaar.com", ""),
    ]


def test_un_nombre_de_procedimiento_raro_no_se_ejecuta(settings):
    settings.NOMINA_EMPLEADOS_PROCEDIMIENTO = "dbo.sp; DROP TABLE x"
    with pytest.raises(nomina.NominaNoDisponible):
        nomina.leer()


# --- Sincronizar -------------------------------------------------------------------------


def test_crea_cuentas_inactivas_sin_correo_ni_rol():
    corrida = nomina.sincronizar(empleados=[emp(cedula="1712345678")])
    assert (corrida.estado, corrida.creadas, corrida.empleados) == ("ok", 1, 1)
    cuenta = User.objects.get(codigo_empleado="20100001")
    assert (cuenta.first_name, cuenta.last_name, cuenta.cedula) == (
        "Ana Lucía",
        "Ñacato Pérez",
        "1712345678",
    )
    assert cuenta.username == "anacatoperez"
    assert cuenta.email == "anacatoperez@sin-correo.invalid"
    assert cuenta.is_active is False and cuenta.status == User.Status.DISABLED
    assert not cuenta.has_usable_password() and cuenta.must_change_password
    assert not cuenta.groups.exists()
    evento = AuditLog.objects.get(action="usuarios.nomina.creado")
    # La auditoría nunca guarda la cédula completa.
    assert "1712345678" not in str(evento.new_values)


def test_empareja_por_cedula_luego_correo_luego_codigo_y_manda_nomina():
    por_cedula = _cuenta("uno", first_name="X", last_name="Y", cedula="0901")
    por_correo = _cuenta("dos", email="juan@grupolaar.com")
    por_codigo = _cuenta("tres", codigo_empleado="20100003")
    corrida = nomina.sincronizar(
        empleados=[
            emp("20100001", "Ana", "Uno", cedula="0901"),
            emp("20100002", "Juan", "Dos", correo="juan@grupolaar.com"),
            emp("20100003", "Pedro", "Tres"),
        ]
    )
    assert (corrida.creadas, corrida.actualizadas) == (0, 3)
    for cuenta in (por_cedula, por_correo, por_codigo):
        cuenta.refresh_from_db()
    assert (por_cedula.first_name, por_cedula.last_name, por_cedula.codigo_empleado) == (
        "Ana",
        "Uno",
        "20100001",
    )
    assert por_correo.codigo_empleado == "20100002" and por_correo.first_name == "Juan"
    assert por_codigo.first_name == "Pedro" and por_codigo.nomina_sincronizada_en
    evento = AuditLog.objects.get(
        action="usuarios.nomina.actualizado", target_id=str(por_cedula.pk)
    )
    assert evento.previous_values["first_name"] == "X"
    assert evento.new_values["first_name"] == "Ana"


def test_una_segunda_corrida_sin_cambios_no_toca_nada():
    nomina.sincronizar(empleados=[emp()])
    corrida = nomina.sincronizar(empleados=[emp()])
    assert (corrida.creadas, corrida.actualizadas, corrida.sin_cambios) == (0, 0, 1)
    assert User.objects.filter(codigo_empleado="20100001").count() == 1


def test_no_pisa_datos_de_otra_cuenta_y_lo_reporta():
    _cuenta("ocupa", codigo_empleado="20100009")
    ana = _cuenta("ana", email="ana@grupolaar.com")
    corrida = nomina.sincronizar(
        empleados=[emp("20100009", "Ana", "Ruiz", correo="ana@grupolaar.com")]
    )
    ana.refresh_from_db()
    assert ana.codigo_empleado is None
    assert ana.last_name == "Ruiz"
    assert corrida.conflictos == [
        {
            "codigo": "20100009",
            "nombre": "Ruiz Ana",
            "motivo": "El código 20100009 ya lo tiene otra cuenta.",
        }
    ]


def test_las_cuentas_fuera_de_nomina_solo_se_reportan():
    fuera = _cuenta("fuera")
    _cuenta("root", is_superuser=True)
    corrida = nomina.sincronizar(empleados=[emp()])
    fuera.refresh_from_db()
    assert fuera.is_active
    assert [f["usuario"] for f in corrida.fuera_de_nomina] == ["fuera"]


def test_si_nomina_no_responde_no_cambia_nada(settings):
    settings.NOMINA_EMPLEADOS_PROCEDIMIENTO = "dbo.sp_ObtenerEmpleadosActivos"
    with mock.patch("apps.cartera.services.db_source._conectar", side_effect=RuntimeError("caída")):
        corrida = nomina.sincronizar()
    assert corrida.estado == "fallida"
    assert corrida.error == "No se pudo conectar con la base de nómina."
    assert not User.objects.exists()


# --- Correos reservados ------------------------------------------------------------------


def test_el_backend_descarta_los_correos_reservados(settings):
    settings.EMAIL_BACKEND_REAL = "django.core.mail.backends.locmem.EmailBackend"
    conexion = get_connection("apps.core.correo_backend.SinCorreosReservados")
    enviados = conexion.send_messages(
        [
            EmailMessage("a", "b", to=["x@sin-correo.invalid"]),
            EmailMessage("c", "d", to=["ok@grupolaar.com"], bcc=["y@SIN-CORREO.invalid"]),
        ]
    )
    assert enviados == 1
    assert [(m.subject, m.to, m.bcc) for m in mail.outbox] == [("c", ["ok@grupolaar.com"], [])]


# --- API y cédula ------------------------------------------------------------------------


def test_api_pide_el_permiso_y_corre_la_sincronizacion(settings):
    settings.NOMINA_EMPLEADOS_PROCEDIMIENTO = "dbo.sp_ObtenerEmpleadosActivos"
    sin = _cuenta("sin", "usuarios.ver")
    assert _cliente(sin).get(URL).status_code == 403
    ti = _cuenta("ti", "usuarios.ver", "usuarios.sincronizar_nomina")
    with mock.patch.object(nomina, "leer", return_value=[emp()]):
        respuesta = _cliente(ti).post(URL)
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["creadas"] == 1
    estado = _cliente(ti).get(URL).json()
    assert estado["configurada"] is True
    assert estado["ultima"]["actor"] == "ti"
    assert estado["inactivas_desde_nomina"] == 1
    assert AuditLog.objects.filter(action="usuarios.nomina.sincronizada").exists()
    assert SincronizacionNomina.objects.count() == 1


def test_sin_configurar_no_corre(settings):
    settings.NOMINA_EMPLEADOS_PROCEDIMIENTO = ""
    ti = _cuenta("ti", "usuarios.sincronizar_nomina")
    respuesta = _cliente(ti).post(URL)
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "no_configurada"


def test_la_cedula_solo_la_ve_quien_puede_o_la_propia_persona():
    ana = _cuenta("ana", cedula="1712345678")
    solo_ve = _cuenta("ve", "usuarios.ver")
    con_cedula = _cuenta("ce", "usuarios.ver", "usuarios.ver_cedula")
    url = f"/api/v1/admin/users/{ana.pk}/"
    assert _cliente(solo_ve).get(url).json()["cedula"] is None
    assert _cliente(con_cedula).get(url).json()["cedula"] == "1712345678"
    assert _cliente(ana).get("/api/v1/auth/me/").json()["cedula"] == "1712345678"


# --- Correo personal y nombre (16/11/2026) -----------------------------------------------


def test_el_correo_personal_se_descarta_y_no_se_guarda():
    empleado = nomina.a_empleado(
        {"CODIGO_EMP": "20104758", "NOMBRE_COMPLETO": "LOPEZ JUAN", "email_emp": "juan@gmail.com"}
    )
    assert empleado.correo == ""
    corrida = nomina.sincronizar(empleados=[empleado])
    cuenta = User.objects.get(codigo_empleado="20104758")
    assert corrida.creadas == 1
    assert cuenta.email == "jlopez@sin-correo.invalid"


def test_una_cuenta_sin_codigo_se_empareja_por_nombre_y_conserva_su_correo():
    daniel = _cuenta(
        "dpenarreta", first_name="Daniel", last_name="Peñarreta", email="dpenarreta@grupolaar.com"
    )
    corrida = nomina.sincronizar(empleados=[emp("20104758", "Daniel Patricio", "Peñarreta Feijoo")])
    daniel.refresh_from_db()
    assert (corrida.creadas, corrida.actualizadas) == (0, 1)
    assert daniel.codigo_empleado == "20104758"
    assert (daniel.first_name, daniel.last_name) == ("Daniel Patricio", "Peñarreta Feijoo")
    assert daniel.email == "dpenarreta@grupolaar.com"


def test_un_nombre_ambiguo_no_crea_otra_cuenta_y_va_al_reporte():
    _cuenta("jperez", first_name="Juan", last_name="Pérez")
    corrida = nomina.sincronizar(
        empleados=[
            emp("20100001", "Juan Carlos", "Pérez Mora"),
            emp("20100002", "Juan", "Pérez Vera"),
        ]
    )
    assert corrida.creadas == 0
    assert len(corrida.conflictos) == 2
    assert "más de una cuenta" in corrida.conflictos[0]["motivo"]
