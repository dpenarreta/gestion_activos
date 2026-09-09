"""Catálogos organizacionales y control de acceso del módulo de activos."""

import datetime

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.permissions.models import ModulePermission
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_org", email="admin_org@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Finanzas", codigo="FIN")


def _usuario_con_permisos(codenames, sufijo=""):
    """Usuario no-superusuario con exactamente los permisos indicados."""
    usuario = User.objects.create_user(
        username=f"operador{sufijo}",
        email=f"operador{sufijo}@example.com",
        password="Sup3r-Secr3t!",
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    grupo = Group.objects.create(name=f"Grupo {sufijo or 'base'}")
    grupo.permissions.set(
        Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )
    usuario.groups.add(grupo)
    return usuario


# --- Catálogos -------------------------------------------------------------


def test_crear_un_departamento_normaliza_el_codigo_a_mayusculas(cliente):
    respuesta = cliente.post(
        "/api/v1/organizacion/departamentos/",
        {"nombre": "Recursos Humanos", "codigo": "rrhh"},
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["codigo"] == "RRHH"


def test_el_listado_de_departamentos_informa_cuantos_activos_tiene_cada_uno(
    cliente, admin, departamento
):
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-1",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    respuesta = cliente.get("/api/v1/organizacion/departamentos/")

    fila = next(d for d in respuesta.json()["results"] if d["id"] == departamento.id)
    assert fila["total_activos"] == 1


def test_no_se_puede_desactivar_a_un_empleado_que_aun_custodia_equipos(
    cliente, admin, departamento
):
    """Dejaría activos a nombre de alguien inactivo: exactamente la pérdida de
    trazabilidad de custodia que RF-01 busca eliminar."""
    empleado = Empleado.objects.create(
        nombres="Carla",
        apellidos="Ríos",
        codigo_empleado="EMP-0002",
        departamento=departamento,
    )
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-2",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)

    respuesta = cliente.patch(
        f"/api/v1/organizacion/empleados/{empleado.id}/", {"activo": False}, format="json"
    )

    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "empleado_con_activos"
    empleado.refresh_from_db()
    assert empleado.activo is True


def test_se_puede_desactivar_a_un_empleado_tras_reasignar_sus_equipos(cliente, admin, departamento):
    empleado = Empleado.objects.create(
        nombres="Diego",
        apellidos="Luna",
        codigo_empleado="EMP-0003",
        departamento=departamento,
    )
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-3",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=None)

    respuesta = cliente.patch(
        f"/api/v1/organizacion/empleados/{empleado.id}/", {"activo": False}, format="json"
    )

    assert respuesta.status_code == 200


def test_no_se_puede_asignar_un_activo_a_un_empleado_inactivo(cliente, admin, departamento):
    empleado = Empleado.objects.create(
        nombres="Elena",
        apellidos="Vaca",
        codigo_empleado="EMP-0004",
        departamento=departamento,
        activo=False,
    )
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-4",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    respuesta = cliente.post(
        f"/api/v1/activos/{activo.id}/asignar/", {"custodio": empleado.id}, format="json"
    )

    assert respuesta.status_code == 400


# --- Autorización ----------------------------------------------------------


def test_sin_autenticacion_el_inventario_responde_401(db):
    respuesta = APIClient().get("/api/v1/activos/")

    assert respuesta.status_code == 401


def test_ver_el_inventario_no_alcanza_para_registrar_activos(db, departamento):
    """Alta, edición, asignación y baja son permisos separados."""
    usuario = _usuario_con_permisos(["activos.ver"], "_lectura")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")

    assert client.get("/api/v1/activos/").status_code == 200

    respuesta = client.post(
        "/api/v1/activos/",
        {
            "tipo": tipo.id,
            "nombre": "Equipo",
            "marca": "Dell",
            "modelo": "X",
            "numero_serie": "SN-PERM-1",
            "departamento": departamento.id,
            "fecha_adquisicion": "2024-01-01",
        },
        format="json",
    )
    assert respuesta.status_code == 403


def test_registrar_activos_no_alcanza_para_darlos_de_baja(db, admin, departamento):
    """Dar de baja es la acción con consecuencia contable: va aparte."""
    usuario = _usuario_con_permisos(["activos.ver", "activos.crear"], "_alta")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-PERM-2",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    respuesta = client.post(
        f"/api/v1/activos/{activo.id}/cambiar-estado/",
        {"estado": "dado_de_baja", "motivo": "prueba"},
        format="json",
    )

    assert respuesta.status_code == 403


def test_imprimir_etiquetas_exige_su_propio_permiso(db, admin, departamento):
    usuario = _usuario_con_permisos(["activos.ver"], "_etiquetas")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-PERM-3",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    assert client.get(f"/api/v1/activos/{activo.id}/etiqueta/").status_code == 403


def test_un_acceso_denegado_queda_registrado_en_auditoria(db, departamento):
    from apps.core.models import AuditLog

    usuario = _usuario_con_permisos(["activos.ver"], "_auditado")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")

    client.post(
        "/api/v1/activos/",
        {
            "tipo": tipo.id,
            "nombre": "Equipo",
            "marca": "Dell",
            "modelo": "X",
            "numero_serie": "SN-PERM-4",
            "departamento": departamento.id,
            "fecha_adquisicion": "2024-01-01",
        },
        format="json",
    )

    evento = AuditLog.objects.filter(action="access_denied").latest("created_at")
    assert evento.actor == usuario
    assert evento.new_values["required_permission"] == "activos.crear"
    assert evento.result == AuditLog.Result.FAILURE


# --- Catálogo de sedes ------------------------------------------------------


@pytest.fixture
def sede(db):
    from apps.organizacion.models import Sede

    return Sede.objects.create(nombre="Sede Quito Norte", ciudad="Quito")


def test_la_sede_dice_donde_esta_un_equipo_con_su_ciudad(cliente, sede):
    """La pregunta que se hace de un equipo es «¿dónde está?», y se responde
    con la ciudad, no con el nombre interno de la sede."""
    respuesta = cliente.get(f"/api/v1/organizacion/sedes/{sede.id}/")

    assert respuesta.status_code == 200
    assert respuesta.data["nombre"] == "Sede Quito Norte"
    assert respuesta.data["ciudad"] == "Quito"


def test_no_se_crean_dos_sedes_que_solo_difieren_en_mayusculas(cliente, sede):
    """«SEDE QUITO NORTE» pasaría la restricción única de la base y saldrían
    dos entradas en el desplegable: exactamente lo que el catálogo evita."""
    respuesta = cliente.post(
        "/api/v1/organizacion/sedes/", {"nombre": "sede quito norte"}, format="json"
    )

    assert respuesta.status_code == 400


def test_no_se_cierra_una_sede_que_todavia_tiene_equipos(cliente, sede):
    """Cerrarla los dejaría en un sitio que el formulario ya no ofrece: nadie
    podría moverlos ni corregirlos."""
    from apps.activos.models import Activo, TipoDispositivo
    from apps.organizacion.models import Departamento

    Activo.objects.create(
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-SEDE-1",
        departamento=Departamento.objects.create(nombre="Sistemas", codigo="SIS"),
        sede=sede,
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )

    respuesta = cliente.patch(
        f"/api/v1/organizacion/sedes/{sede.id}/", {"activa": False}, format="json"
    )

    assert respuesta.status_code == 400
    assert respuesta.data["error"]["code"] == "sede_con_activos"


def test_la_sede_no_se_borra_aunque_ya_no_se_use(cliente, sede):
    """Sigue siendo la que aparece en el historial de los equipos que
    estuvieron ahí."""
    respuesta = cliente.delete(f"/api/v1/organizacion/sedes/{sede.id}/")

    assert respuesta.status_code == 405


# --- Duplicados en el catálogo de áreas -------------------------------------


def test_no_se_crean_dos_areas_que_solo_difieren_en_mayusculas(cliente, departamento):
    """La restricción única de la base sí distingue: «Finanzas» y «FINANZAS»
    pasarían las dos y quedarían dos áreas indistinguibles en el desplegable,
    con los activos repartidos entre ambas."""
    respuesta = cliente.post(
        "/api/v1/organizacion/departamentos/",
        {"nombre": "FINANZAS", "codigo": "FIN2"},
        format="json",
    )

    assert respuesta.status_code == 400
    assert "Finanzas" in str(respuesta.data["error"]["details"]["nombre"])


def test_el_codigo_de_area_repetido_dice_quien_lo_usa(cliente, departamento):
    """«Ya existe» no basta: hay que poder ir a corregirlo, y para eso hace
    falta saber cuál es el otro."""
    respuesta = cliente.post(
        "/api/v1/organizacion/departamentos/",
        {"nombre": "Compras", "codigo": "fin"},
        format="json",
    )

    assert respuesta.status_code == 400
    assert "Finanzas" in str(respuesta.data["error"]["details"]["codigo"])


def test_editar_un_area_sin_cambiarle_el_nombre_no_choca_consigo_misma(cliente, departamento):
    respuesta = cliente.patch(
        f"/api/v1/organizacion/departamentos/{departamento.id}/",
        {"nombre": "Finanzas", "descripcion": "Área contable"},
        format="json",
    )

    assert respuesta.status_code == 200


# --- Catálogo de proveedores ------------------------------------------------


@pytest.fixture
def proveedor(db):
    from apps.organizacion.models import Proveedor

    return Proveedor.objects.create(nombre="Tecnomega", identificacion="0991234567001")


def test_el_proveedor_es_un_catalogo_y_no_texto_dentro_del_activo(cliente, proveedor):
    """Como texto libre, «Tecnomega», «TECNOMEGA» y «Tecno Mega» son la misma
    empresa para una persona y tres para una consulta: preguntar cuánto se le
    lleva comprado devuelve un tercio de lo que hay."""
    respuesta = cliente.get(f"/api/v1/organizacion/proveedores/{proveedor.id}/")

    assert respuesta.status_code == 200
    assert respuesta.data["nombre"] == "Tecnomega"
    assert respuesta.data["total_activos"] == 0
    assert respuesta.data["total_repuestos"] == 0


def test_no_se_crean_dos_proveedores_que_solo_difieren_en_mayusculas(cliente, proveedor):
    respuesta = cliente.post(
        "/api/v1/organizacion/proveedores/", {"nombre": "TECNOMEGA"}, format="json"
    )

    assert respuesta.status_code == 400
    assert "Tecnomega" in str(respuesta.data["error"]["details"]["nombre"])


def test_no_se_da_de_baja_a_un_proveedor_con_equipos_en_uso(cliente, proveedor):
    """Es justo a quien hay que llamar cuando el equipo falla: darlo de baja
    dejaría esos activos apuntando a alguien que el formulario ya no ofrece."""
    from apps.activos.models import Activo, TipoDispositivo
    from apps.organizacion.models import Departamento

    Activo.objects.create(
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-PROV-1",
        departamento=Departamento.objects.create(nombre="Sistemas", codigo="SIS"),
        proveedor=proveedor,
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )

    respuesta = cliente.patch(
        f"/api/v1/organizacion/proveedores/{proveedor.id}/", {"activo": False}, format="json"
    )

    assert respuesta.status_code == 400
    assert respuesta.data["error"]["code"] == "proveedor_con_activos"


def test_el_proveedor_no_se_borra_aunque_ya_no_se_le_compre(cliente, proveedor):
    """Sigue siendo quien vendió lo que hay en el inventario."""
    respuesta = cliente.delete(f"/api/v1/organizacion/proveedores/{proveedor.id}/")

    assert respuesta.status_code == 405


def test_la_pieza_de_repuesto_registra_a_quien_se_le_compro(db, proveedor):
    """El proveedor del equipo no tiene por qué ser el del repuesto: sin este
    dato, una pieza que falla a los dos meses deja el costo registrado y
    ninguna forma de saber a quién reclamarle."""
    from apps.mantenimientos.models import CatalogoComponente, ComponenteUtilizado, Mantenimiento
    from apps.activos.models import Activo, TipoDispositivo
    from apps.organizacion.models import Departamento

    activo = Activo.objects.create(
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-REP-1",
        departamento=Departamento.objects.create(nombre="Sistemas", codigo="SIS"),
        fecha_adquisicion=datetime.date(2025, 1, 10),
    )
    mantenimiento = Mantenimiento.objects.create(
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2026, 2, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Luis Torres",
        descripcion="Cambio de disco",
    )
    linea = ComponenteUtilizado.objects.create(
        mantenimiento=mantenimiento,
        componente=CatalogoComponente.objects.create(nombre="Disco SSD", codigo="SSD"),
        proveedor=proveedor,
        cantidad=1,
        costo_unitario=120,
    )

    assert linea.proveedor == proveedor
    assert proveedor.repuestos_vendidos.count() == 1
