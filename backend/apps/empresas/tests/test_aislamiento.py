"""Que una empresa no vea lo de otra.

Es la prueba que justifica el diseño entero. El filtro no se escribe en cada
consulta —hay más de veinte vistas, servicios y reportes, y basta con que una
lo olvide— sino en el gestor por defecto de cada modelo. Estas pruebas
comprueban justamente lo que pasaría si esa red fallara.
"""

import datetime

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.organizacion.models import Departamento, Empleado, Sede
from apps.permissions.catalog import all_codenames
from apps.permissions.models import ModulePermission
from apps.users.models import User


@pytest.fixture
def courier(db):
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad(db):
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


def _cuenta(nombre, *empresas, superusuario=False):
    """Cuenta con todos los permisos del catálogo pero **sin** ser superusuario.

    Los permisos y la empresa son dos cosas distintas y aquí se prueba la
    segunda: quien puede verlo todo en su empresa no debe ver nada de la otra.
    Con un superusuario la prueba no diría nada, porque se salta la membresía.
    """
    if superusuario:
        usuario = User.objects.create_superuser(
            username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
        )
    else:
        usuario = User.objects.create_user(
            username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
        )
        content_type = ContentType.objects.get_for_model(ModulePermission)
        grupo = Group.objects.create(name=f"Todo {nombre}")
        grupo.permissions.set(
            Permission.objects.filter(content_type=content_type, codename__in=all_codenames())
        )
        usuario.groups.add(grupo)

    for indice, empresa in enumerate(empresas):
        MembresiaEmpresa.objects.create(
            usuario=usuario, empresa=empresa, es_predeterminada=indice == 0
        )
    return usuario


def _cliente(usuario, empresa=None):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    if empresa is not None:
        cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


def _sembrar(empresa, sufijo):
    """Un inventario mínimo dentro de una empresa."""
    with usando_empresa(empresa):
        # `get_or_create` porque los catálogos son únicos **dentro** de la
        # empresa: sembrar dos equipos en la misma no puede crear dos «Laptop».
        tipo, _ = TipoDispositivo.objects.get_or_create(nombre="Laptop", codigo="LAP")
        departamento, _ = Departamento.objects.get_or_create(nombre="Tecnología", codigo="TI")
        Sede.objects.get_or_create(nombre=f"Sede {sufijo}", ciudad=sufijo)
        Empleado.objects.get_or_create(nombres="Ana", apellidos=sufijo, departamento=departamento)
        return Activo.objects.create(
            tipo=tipo,
            nombre=f"Laptop de {sufijo}",
            marca="Dell",
            modelo="Latitude",
            numero_serie=f"SN-{sufijo}",
            codigo_barras=f"GA-LAP-{sufijo}",
            departamento=departamento,
            fecha_adquisicion=datetime.date(2025, 1, 10),
        )


# --- El aislamiento ---------------------------------------------------------


def test_el_inventario_solo_trae_lo_de_la_empresa_activa(courier, seguridad):
    _sembrar(courier, "Courier")
    _sembrar(seguridad, "Seguridad")
    usuario = _cuenta("ana", courier, seguridad)

    en_courier = _cliente(usuario, courier).get("/api/v1/activos/").data
    en_seguridad = _cliente(usuario, seguridad).get("/api/v1/activos/").data

    assert [a["nombre"] for a in en_courier["results"]] == ["Laptop de Courier"]
    assert [a["nombre"] for a in en_seguridad["results"]] == ["Laptop de Seguridad"]


def test_los_catalogos_tambien_estan_separados(courier, seguridad):
    _sembrar(courier, "Courier")
    _sembrar(seguridad, "Seguridad")
    usuario = _cuenta("ana", courier, seguridad)
    cliente = _cliente(usuario, courier)

    for ruta in (
        "/api/v1/organizacion/sedes/",
        "/api/v1/organizacion/empleados/",
        "/api/v1/organizacion/departamentos/",
    ):
        datos = cliente.get(ruta).data
        assert datos["count"] == 1, ruta
        assert "Seguridad" not in str(datos["results"]), ruta


def test_la_ficha_de_otra_empresa_no_se_abre_ni_sabiendo_el_id(courier, seguridad):
    """Es el hueco clásico: el listado filtra pero el detalle se abre por id."""
    ajeno = _sembrar(seguridad, "Seguridad")
    usuario = _cuenta("ana", courier, seguridad)

    respuesta = _cliente(usuario, courier).get(f"/api/v1/activos/{ajeno.id}/")

    assert respuesta.status_code == 404


def test_el_panel_y_las_alertas_cuentan_solo_lo_propio(courier, seguridad):
    _sembrar(courier, "Courier")
    _sembrar(seguridad, "Seguridad")
    _sembrar(seguridad, "Seguridad2")
    usuario = _cuenta("ana", courier, seguridad)

    panel = _cliente(usuario, courier).get("/api/v1/activos/dashboard/").data

    # Uno solo, aunque la otra empresa tenga dos: el panel agrega el parque
    # entero, así que es donde una fuga se vería antes.
    assert panel["activos"]["total"] == 1


def test_una_empresa_a_la_que_no_se_pertenece_no_muestra_nada(courier, seguridad):
    """No es un error del usuario sino una pestaña vieja o algo peor, y la
    respuesta correcta es no mostrar nada: devolver la empresa predeterminada
    haría creer que se está viendo lo pedido."""
    _sembrar(courier, "Courier")
    _sembrar(seguridad, "Seguridad")
    solo_courier = _cuenta("beto", courier)

    datos = _cliente(solo_courier, seguridad).get("/api/v1/activos/").data

    assert datos["count"] == 0


# --- Lo que se crea nace en la empresa activa -------------------------------


def test_lo_creado_queda_en_la_empresa_desde_la_que_se_crea(courier, seguridad):
    usuario = _cuenta("ana", courier, seguridad)
    with usando_empresa(seguridad):
        Departamento.objects.create(nombre="Operaciones", codigo="OPS")
        TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")

    respuesta = _cliente(usuario, seguridad).post(
        "/api/v1/organizacion/sedes/", {"nombre": "Sede nueva", "ciudad": "Quito"}, format="json"
    )

    assert respuesta.status_code == 201
    assert Sede.objects.todas().get(nombre="Sede nueva").empresa == seguridad


def test_el_codigo_de_barras_numera_por_empresa(courier, seguridad):
    """Dos empresas del grupo numeran sus equipos por su cuenta: si el
    correlativo fuera global, el primer equipo de la segunda empresa empezaría
    en el número que dejó la primera."""
    _sembrar(courier, "Courier")
    usuario = _cuenta("ana", courier, seguridad)
    with usando_empresa(seguridad):
        tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
        departamento = Departamento.objects.create(nombre="Tecnología", codigo="TI")

    respuesta = _cliente(usuario, seguridad).post(
        "/api/v1/activos/",
        {
            "tipo": tipo.id,
            "nombre": "Primera de Seguridad",
            "marca": "HP",
            "modelo": "ProBook",
            "numero_serie": "SN-LS-1",
            "departamento": departamento.id,
            "fecha_adquisicion": "2025-06-01",
        },
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.data["codigo_barras"].endswith("000001")


def test_el_mismo_codigo_de_area_puede_existir_en_dos_empresas(courier, seguridad):
    """Antes el código era único en toda la base: la segunda empresa no habría
    podido tener su propio «TI»."""
    with usando_empresa(courier):
        Departamento.objects.create(nombre="Tecnología", codigo="TI")
    with usando_empresa(seguridad):
        Departamento.objects.create(nombre="Tecnología", codigo="TI")

    assert Departamento.objects.todas().filter(codigo="TI").count() == 2


# --- El selector ------------------------------------------------------------


def test_el_selector_lista_solo_las_empresas_de_la_cuenta(courier, seguridad):
    usuario = _cuenta("beto", courier)

    datos = _cliente(usuario).get("/api/v1/empresas/mias/").data

    assert [e["nombre"] for e in datos["empresas"]] == ["LaarCourier"]
    assert datos["activa"]["nombre"] == "LaarCourier"


def test_sin_cabecera_se_abre_la_predeterminada(courier, seguridad):
    usuario = _cuenta("ana", seguridad, courier)

    datos = _cliente(usuario).get("/api/v1/empresas/mias/").data

    assert datos["activa"]["nombre"] == "LaarSeguridad"


def test_el_superusuario_ve_todas_sin_membresia(courier, seguridad):
    """Es la cuenta de emergencia: no tiene sentido que necesite una membresía
    para entrar a arreglar algo."""
    root = _cuenta("root", superusuario=True)

    datos = _cliente(root).get("/api/v1/empresas/mias/").data

    # Se comprueba que estén las dos, no que sean las únicas: la migración
    # inicial dejó la empresa de los datos que ya había.
    assert {"LaarCourier", "LaarSeguridad"} <= {e["nombre"] for e in datos["empresas"]}


def test_una_cuenta_sin_empresa_no_ve_nada(db, courier, seguridad):
    """Fallo cerrado: con dos empresas en el sistema, una cuenta sin membresía
    no ve el inventario de ninguna.

    Hacen falta las dos: con una sola, la cuenta sin membresía trabaja en ella
    —no hay de quién aislarse—, y es en cuanto aparece la segunda cuando no
    saber a cuál pertenece deja de ser inocuo."""
    _sembrar(courier, "Courier")
    huerfano = _cuenta("sin_empresa")

    datos = _cliente(huerfano).get("/api/v1/activos/").data

    assert datos["count"] == 0


# --- Fuera de una petición --------------------------------------------------


def test_los_comandos_trabajan_sobre_el_sistema_entero(courier, seguridad):
    """Un respaldo o un recálculo de indicadores no pertenecen a una empresa:
    fuera de una petición no hay empresa activa y no se filtra."""
    _sembrar(courier, "Courier")
    _sembrar(seguridad, "Seguridad")

    assert Activo.objects.count() == 2


def test_asignar_dentro_de_una_empresa_no_alcanza_al_personal_de_otra(courier, seguridad):
    """El desplegable de custodios sale del mismo gestor acotado, así que ni
    siquiera se ofrece a alguien de la otra empresa."""
    activo = _sembrar(courier, "Courier")
    _sembrar(seguridad, "Seguridad")
    usuario = _cuenta("ana", courier, seguridad)

    with usando_empresa(seguridad):
        ajeno = Empleado.objects.get(apellidos="Seguridad")

    respuesta = _cliente(usuario, courier).post(
        f"/api/v1/activos/{activo.id}/asignar/", {"responsables": [ajeno.id]}, format="json"
    )

    assert respuesta.status_code == 400


def test_el_servicio_de_alta_hereda_la_empresa(courier):
    """`ActivoService.crear_activo` no recibe la empresa: la toma del contexto,
    igual que cualquier otra alta."""
    usuario = _cuenta("ana", courier)
    with usando_empresa(courier):
        tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
        departamento = Departamento.objects.create(nombre="Tecnología", codigo="TI")
        activo = ActivoService.crear_activo(
            actor=usuario,
            tipo=tipo,
            nombre="Laptop",
            marca="Dell",
            modelo="Latitude",
            numero_serie="SN-SERV-1",
            departamento=departamento,
            fecha_adquisicion=datetime.date(2025, 1, 10),
        )

    assert activo.empresa == courier


# --- Lo que cuelga de un activo --------------------------------------------


def _reparar(empresa, activo, responsable):
    """Una intervención sobre un activo, dentro de su empresa."""
    from apps.mantenimientos.models import Mantenimiento

    with usando_empresa(empresa):
        return Mantenimiento.objects.create(
            activo=activo,
            tipo=Mantenimiento.Tipo.CORRECTIVO,
            fecha_intervencion=datetime.date(2026, 1, 15),
            tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            responsable=responsable,
            descripcion=f"Cambio de disco en {responsable}",
        )


def test_la_bitacora_de_mantenimientos_no_cruza_empresas(courier, seguridad):
    """El mantenimiento no lleva empresa encima: la hereda del activo reparado.

    Sin filtrar por esa ruta, `Mantenimiento.objects.all()` devolvería los de
    todas, y la bitácora de una empresa se leería desde la otra.
    """
    _reparar(courier, _sembrar(courier, "Courier"), "Técnico Courier")
    _reparar(seguridad, _sembrar(seguridad, "Seguridad"), "Técnico Seguridad")
    usuario = _cuenta("ana", courier, seguridad)

    en_courier = _cliente(usuario, courier).get("/api/v1/mantenimientos/").data

    assert [m["responsable"] for m in en_courier["results"]] == ["Técnico Courier"]


def test_el_historial_de_movimientos_no_cruza_empresas(courier, seguridad):
    from apps.activos.models import MovimientoActivo

    ajeno = _sembrar(seguridad, "Seguridad")
    with usando_empresa(seguridad):
        MovimientoActivo.objects.create(
            activo=ajeno, tipo=MovimientoActivo.Tipo.ALTA, motivo="Alta en Seguridad"
        )

    with usando_empresa(courier):
        # El movimiento hereda la empresa del activo movido: desde LaarCourier
        # no existe, y hay que pedir `todas()` para verlo.
        assert not MovimientoActivo.objects.filter(activo=ajeno).exists()
        assert MovimientoActivo.objects.todas().filter(activo=ajeno).exists()


# --- El resumen por correo ---------------------------------------------------


def test_el_centro_de_alertas_responde_en_las_dos_empresas(courier, seguridad):
    """H-02: la configuración era una fila única y la segunda empresa caía.

    El 500 no era un fallo de datos sino de diseño: `pk=1` pertenecía a la
    primera empresa y desde la segunda no existía, así que el sistema intentaba
    crearla otra vez.
    """
    usuario = _cuenta("ana", courier, seguridad)

    for empresa in (courier, seguridad):
        respuesta = _cliente(usuario, empresa).get("/api/v1/alertas/")
        assert respuesta.status_code == 200, empresa


def test_el_resumen_diario_sale_una_vez_por_empresa(courier, seguridad):
    """Y con los equipos de cada una, no con los de las dos juntas."""
    from apps.alertas.services import ejecutar_envio_en_todas_las_empresas

    _sembrar(courier, "Courier")
    _sembrar(seguridad, "Seguridad")

    envios = ejecutar_envio_en_todas_las_empresas(forzar=True)

    por_empresa = [envio.empresa_id for envio in envios]
    # Uno para cada una, y ninguna repetida: antes salía un único correo con el
    # parque de todas.
    assert por_empresa.count(courier.id) == 1
    assert por_empresa.count(seguridad.id) == 1
    assert len(por_empresa) == len(set(por_empresa))


# --- La auditoría y el listado de usuarios -----------------------------------


def test_la_auditoria_no_muestra_lo_de_la_otra_empresa(courier, seguridad):
    """H-04: `auditoria.ver` en una empresa daba el historial del despliegue."""
    from apps.core.audit import record_audit_event

    ajeno = _sembrar(seguridad, "Seguridad")
    propio = _sembrar(courier, "Courier")
    # Por el camino real: la empresa la pone `record_audit_event` desde el
    # contexto, que es lo que hay que comprobar.
    for empresa, activo in ((seguridad, ajeno), (courier, propio)):
        with usando_empresa(empresa):
            record_audit_event(actor=None, action="activo.created", target=activo, module="activos")
    usuario = _cuenta("ana", courier, seguridad)

    datos = _cliente(usuario, courier).get("/api/v1/admin/audit-logs/").data

    identificadores = {fila["target_id"] for fila in datos["results"]}
    assert str(propio.id) in identificadores
    assert str(ajeno.id) not in identificadores


def test_un_evento_huerfano_de_otro_modulo_no_se_cuela(courier, seguridad):
    """El objeto que describía ya no existe, así que no se le puede atribuir dueño."""
    from apps.core.models import AuditLog

    AuditLog.objects.create(
        action="activo.created", module="activos", target_type="activo", target_id="99999"
    )
    usuario = _cuenta("ana", courier)

    datos = _cliente(usuario, courier).get("/api/v1/admin/audit-logs/").data

    assert "99999" not in {fila["target_id"] for fila in datos["results"]}


def test_el_listado_de_usuarios_no_muestra_los_de_la_otra_empresa(courier, seguridad):
    """H-05: se veían las cuentas y correos de todo el grupo."""
    _cuenta("de_seguridad", seguridad)
    usuario = _cuenta("ana", courier)

    datos = _cliente(usuario, courier).get("/api/v1/admin/users/").data

    nombres = {fila["username"] for fila in datos["results"]}
    assert "ana" in nombres
    assert "de_seguridad" not in nombres
