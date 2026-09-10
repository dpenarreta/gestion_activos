"""Corregir y eliminar una intervención ya registrada.

Cobertura de tests/qa/features/mantenimientos.feature (AC-MNT-020 a AC-MNT-029).

Era el camino sin ninguna prueba, y no es un camino menor: al editar se
**reemplaza el desglose de repuestos** y se **recalculan los contadores del
activo** —el de intervenciones de RF-05 y el de piezas críticas—, que son los
que alimentan la sugerencia de renovación de RF-07. Un error aquí no rompe una
pantalla: corrompe cifras que después nadie contrasta contra nada.
"""

import datetime
from decimal import Decimal

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.core.models import AuditLog
from apps.mantenimientos.models import CatalogoComponente, ComponenteUtilizado, Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

RUTA = "/api/v1/mantenimientos/"


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_edicion", email="admin_edicion@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    api = APIClient()
    api.force_authenticate(user=admin)
    return api


def _cuenta(nombre, *permisos):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.set(
        Permission.objects.filter(content_type=content_type, codename__in=permisos)
    )
    api = APIClient()
    api.force_authenticate(user=usuario)
    return api


@pytest.fixture
def activo(db, admin):
    departamento = Departamento.objects.create(nombre="Operaciones", codigo="OPS")
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    return ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Laptop Soporte 01",
        marca="HP",
        modelo="ProBook 450",
        numero_serie="SN-EDIT-1",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2023, 1, 10),
    )


@pytest.fixture
def disco(db):
    return CatalogoComponente.objects.create(nombre="Disco sólido", codigo="SSD", es_critico=True)


@pytest.fixture
def teclado(db):
    return CatalogoComponente.objects.create(nombre="Teclado", codigo="TEC", es_critico=False)


@pytest.fixture
def bateria(db):
    return CatalogoComponente.objects.create(nombre="Batería", codigo="BAT", es_critico=False)


@pytest.fixture
def intervencion(db, admin, activo, disco):
    """Una intervención cerrada, con una pieza crítica consumida."""
    return MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2024, 6, 1),
        fecha_salida=datetime.date(2024, 6, 4),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Luis Torres",
        causa="No enciende",
        descripcion="Reemplazo de disco",
        componentes=[{"componente": disco, "cantidad": 1, "costo_unitario": Decimal("85.50")}],
    )


# --- Corregir los datos de la intervención ----------------------------------


def test_corregir_un_campo_deja_los_demas_intactos(cliente, intervencion):
    """El formulario real manda el cuerpo entero; una corrección toca un dato."""
    respuesta = cliente.patch(
        f"{RUTA}{intervencion.id}/", {"responsable": "Ana Rojas"}, format="json"
    )

    intervencion.refresh_from_db()
    assert respuesta.status_code == 200
    assert intervencion.responsable == "Ana Rojas"
    assert intervencion.causa == "No enciende"
    assert intervencion.descripcion == "Reemplazo de disco"
    assert intervencion.componentes.count() == 1


def test_la_correccion_queda_auditada_con_el_antes_y_el_despues(cliente, admin, intervencion):
    cliente.patch(f"{RUTA}{intervencion.id}/", {"responsable": "Ana Rojas"}, format="json")

    evento = AuditLog.objects.get(action="mantenimiento.updated", target_id=str(intervencion.id))
    assert evento.previous_values["responsable"] == "Luis Torres"
    assert evento.new_values["responsable"] == "Ana Rojas"
    assert evento.actor_id == admin.id


def test_guardar_sin_cambiar_nada_no_escribe_en_la_bitacora(cliente, intervencion):
    """Abrir y guardar no es una corrección.

    El historial de auditoría se lee para saber qué cambió; una fila por cada
    vez que alguien abrió el formulario lo vuelve ilegible.
    """
    cliente.patch(f"{RUTA}{intervencion.id}/", {"responsable": "Luis Torres"}, format="json")

    assert not AuditLog.objects.filter(
        action="mantenimiento.updated", target_id=str(intervencion.id)
    ).exists()


def test_el_mantenimiento_no_cambia_de_activo(cliente, admin, intervencion, activo):
    """Mover una intervención de equipo falsearía los contadores de los dos."""
    otro = ActivoService.crear_activo(
        actor=admin,
        tipo=activo.tipo,
        nombre="Laptop Soporte 02",
        marca="HP",
        modelo="ProBook 450",
        numero_serie="SN-EDIT-2",
        departamento=activo.departamento,
        fecha_adquisicion=datetime.date(2023, 1, 10),
    )

    cliente.patch(f"{RUTA}{intervencion.id}/", {"activo": otro.id}, format="json")

    intervencion.refresh_from_db()
    assert intervencion.activo_id == activo.id
    otro.refresh_from_db()
    assert otro.total_mantenimientos == 0


# --- Reemplazar el desglose de repuestos ------------------------------------


def test_enviar_componentes_reemplaza_el_desglose_entero(cliente, intervencion, teclado, bateria):
    """No suma líneas: el formulario reenvía siempre la lista completa.

    Si sumara, corregir una cantidad mal escrita duplicaría el repuesto en vez
    de arreglarlo, y el costo de la intervención crecería en cada corrección.
    """
    respuesta = cliente.patch(
        f"{RUTA}{intervencion.id}/",
        {
            "componentes": [
                {"componente": teclado.id, "cantidad": 1, "costo_unitario": "18.00"},
                {"componente": bateria.id, "cantidad": 2, "costo_unitario": "40.00"},
            ]
        },
        format="json",
    )

    assert respuesta.status_code == 200
    consumidos = intervencion.componentes.select_related("componente")
    assert sorted(c.componente.codigo for c in consumidos) == ["BAT", "TEC"]
    assert not ComponenteUtilizado.objects.filter(
        mantenimiento=intervencion, componente__codigo="SSD"
    ).exists()


def test_quitar_la_pieza_critica_baja_el_contador_del_activo(cliente, intervencion, teclado):
    """Es lo que alimenta la sugerencia de renovación (RF-06/RF-07)."""
    activo = intervencion.activo
    activo.refresh_from_db()
    assert activo.total_componentes_criticos == 1

    cliente.patch(
        f"{RUTA}{intervencion.id}/",
        {"componentes": [{"componente": teclado.id, "cantidad": 1}]},
        format="json",
    )

    activo.refresh_from_db()
    assert activo.total_componentes_criticos == 0
    # La intervención sigue contando: se corrigió el repuesto, no el hecho.
    assert activo.total_mantenimientos == 1


def test_anadir_una_pieza_critica_sube_el_contador(cliente, admin, activo, teclado, disco):
    intervencion = MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.PREVENTIVO,
        fecha_intervencion=datetime.date(2024, 7, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Luis Torres",
        descripcion="Limpieza",
        componentes=[{"componente": teclado, "cantidad": 1}],
    )
    activo.refresh_from_db()
    assert activo.total_componentes_criticos == 0

    cliente.patch(
        f"{RUTA}{intervencion.id}/",
        {"componentes": [{"componente": disco.id, "cantidad": 1}]},
        format="json",
    )

    activo.refresh_from_db()
    assert activo.total_componentes_criticos == 1


def test_el_desglose_se_puede_vaciar(cliente, intervencion):
    """Una intervención sin repuestos es legítima: mano de obra sola."""
    respuesta = cliente.patch(f"{RUTA}{intervencion.id}/", {"componentes": []}, format="json")

    assert respuesta.status_code == 200
    assert intervencion.componentes.count() == 0
    intervencion.activo.refresh_from_db()
    assert intervencion.activo.total_componentes_criticos == 0


def test_la_linea_nueva_fotografia_la_criticidad_de_hoy(cliente, intervencion, disco):
    """El snapshot se toma al consumir, y editar es volver a consumir.

    Si el catálogo dejó de considerar crítico un disco, la línea que se escriba
    hoy debe reflejar la regla de hoy — pero las intervenciones que no se tocan
    conservan la suya, que es lo que prueba `test_cambiar_la_criticidad...`.
    """
    disco.es_critico = False
    disco.save(update_fields=["es_critico"])

    cliente.patch(
        f"{RUTA}{intervencion.id}/",
        {"componentes": [{"componente": disco.id, "cantidad": 1}]},
        format="json",
    )

    linea = intervencion.componentes.get()
    assert linea.era_critico is False
    intervencion.activo.refresh_from_db()
    assert intervencion.activo.total_componentes_criticos == 0


def test_el_cambio_de_repuestos_queda_en_la_bitacora(cliente, intervencion, teclado):
    cliente.patch(
        f"{RUTA}{intervencion.id}/",
        {"componentes": [{"componente": teclado.id, "cantidad": 3}]},
        format="json",
    )

    evento = AuditLog.objects.get(action="mantenimiento.updated", target_id=str(intervencion.id))
    assert evento.previous_values["componentes"] == [{"componente": "Disco sólido", "cantidad": 1}]
    assert evento.new_values["componentes"] == [{"componente": "Teclado", "cantidad": 3}]


# --- Cerrar la reparación al editar -----------------------------------------


def test_poner_la_fecha_de_salida_cierra_la_reparacion(cliente, admin, activo):
    """El caso corriente: se registró el ingreso y se cierra al devolver el equipo."""
    abierta = MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2024, 6, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.PROVEEDOR_EXTERNO,
        responsable="Tecnomega",
        descripcion="Cambio de pantalla",
    )
    assert abierta.sigue_fuera_de_operacion

    respuesta = cliente.patch(f"{RUTA}{abierta.id}/", {"fecha_salida": "2024-06-06"}, format="json")

    abierta.refresh_from_db()
    assert respuesta.status_code == 200
    assert not abierta.sigue_fuera_de_operacion
    assert abierta.dias_fuera_de_operacion == 5


# --- Las validaciones siguen valiendo al corregir ---------------------------


def test_la_salida_no_puede_quedar_antes_del_ingreso(cliente, intervencion):
    respuesta = cliente.patch(
        f"{RUTA}{intervencion.id}/", {"fecha_salida": "2024-05-30"}, format="json"
    )

    assert respuesta.status_code == 400
    intervencion.refresh_from_db()
    assert intervencion.fecha_salida == datetime.date(2024, 6, 4)


def test_la_correccion_no_puede_llevar_la_fecha_al_futuro(cliente, intervencion):
    from django.utils import timezone

    manana = timezone.localdate() + datetime.timedelta(days=1)

    respuesta = cliente.patch(
        f"{RUTA}{intervencion.id}/", {"fecha_intervencion": str(manana)}, format="json"
    )

    assert respuesta.status_code == 400


def test_la_correccion_no_puede_dejarla_antes_de_la_compra(cliente, intervencion):
    respuesta = cliente.patch(
        f"{RUTA}{intervencion.id}/", {"fecha_intervencion": "2022-01-01"}, format="json"
    )

    assert respuesta.status_code == 400


def test_un_componente_inexistente_no_borra_el_desglose(cliente, intervencion):
    """La lista se reemplaza entera: un id malo no puede dejarla vacía."""
    respuesta = cliente.patch(
        f"{RUTA}{intervencion.id}/",
        {"componentes": [{"componente": 999999, "cantidad": 1}]},
        format="json",
    )

    assert respuesta.status_code == 400
    assert intervencion.componentes.count() == 1


# --- Quién puede corregir ---------------------------------------------------


def test_registrar_no_alcanza_para_corregir(intervencion):
    """Son permisos distintos: corregir altera el contador de renovación."""
    api = _cuenta("capturista", "mantenimientos.ver", "mantenimientos.registrar")

    respuesta = api.patch(f"{RUTA}{intervencion.id}/", {"responsable": "Otra"}, format="json")

    assert respuesta.status_code == 403
    intervencion.refresh_from_db()
    assert intervencion.responsable == "Luis Torres"


def test_con_el_permiso_de_editar_si_se_corrige(intervencion):
    api = _cuenta("supervisora", "mantenimientos.ver", "mantenimientos.editar")

    respuesta = api.patch(f"{RUTA}{intervencion.id}/", {"responsable": "Otra"}, format="json")

    assert respuesta.status_code == 200


# --- Eliminar ---------------------------------------------------------------


def test_eliminar_exige_el_permiso_de_editar(intervencion):
    api = _cuenta("capturista", "mantenimientos.ver", "mantenimientos.registrar")

    respuesta = api.delete(f"{RUTA}{intervencion.id}/")

    assert respuesta.status_code == 403
    assert Mantenimiento.objects.filter(pk=intervencion.pk).exists()


def test_eliminar_deja_constancia_de_lo_que_habia(cliente, intervencion):
    """El borrado es físico; la bitácora de auditoría es lo que queda."""
    identificador = intervencion.id

    respuesta = cliente.delete(f"{RUTA}{identificador}/")

    assert respuesta.status_code == 204
    assert not Mantenimiento.objects.filter(pk=identificador).exists()
    evento = AuditLog.objects.get(action="mantenimiento.deleted", target_id=str(identificador))
    assert evento.previous_values["responsable"] == "Luis Torres"
    assert evento.previous_values["fecha_intervencion"] == "2024-06-01"


def test_al_eliminar_se_van_tambien_sus_repuestos(cliente, intervencion):
    identificador = intervencion.id

    cliente.delete(f"{RUTA}{identificador}/")

    assert not ComponenteUtilizado.objects.todas().filter(mantenimiento_id=identificador).exists()


# --- Aislamiento por empresa ------------------------------------------------


def test_no_se_corrige_una_intervencion_de_otra_empresa(cliente, intervencion):
    """El hueco clásico: el listado filtra pero el detalle se abre por id."""
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa

    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")

    with usando_empresa(otra):
        respuesta = cliente.patch(
            f"{RUTA}{intervencion.id}/", {"responsable": "Ajena"}, format="json"
        )

    assert respuesta.status_code == 404
    intervencion.refresh_from_db()
    assert intervencion.responsable == "Luis Torres"


def test_los_indicadores_del_activo_quedan_al_dia_en_la_misma_operacion(cliente, intervencion):
    """Nunca se ve una corrección guardada cuyo contador todavía no la refleje."""
    activo_id = intervencion.activo_id

    cliente.delete(f"{RUTA}{intervencion.id}/")

    activo = Activo.objects.todas().get(pk=activo_id)
    assert activo.total_mantenimientos == 0
    assert activo.total_componentes_criticos == 0
