"""Los siete tiempos del §10, reconstruidos desde el historial.

Lo que se fija aquí es el **significado** de cada número, no su fórmula. Un
«tiempo con el usuario actual» que cuenta desde la primera vez que lo tuvo, o
un «tiempo sin uso» que sigue corriendo después de dar el equipo de baja, son
cifras que se ven razonables en pantalla y responden a otra pregunta: nadie
nota el error hasta que alguien decide algo con ellas.
"""

import datetime

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.activos.models import Activo, MovimientoActivo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.activos.tiempos import calcular
from apps.mantenimientos.models import Mantenimiento
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User

pytestmark = pytest.mark.django_db

HOY = timezone.localdate()


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_tiempos", email="admin_tiempos@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


@pytest.fixture
def empleados(departamento):
    return [
        Empleado.objects.create(
            nombres=f"Nombre{indice}",
            apellidos=f"Apellido{indice}",
            codigo_empleado=f"EMP-T{indice}",
            departamento=departamento,
        )
        for indice in range(2)
    ]


@pytest.fixture
def activo(admin, departamento):
    return ActivoService.crear_activo(
        actor=admin,
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop de prueba",
        marca="Dell",
        modelo="Latitude",
        numero_serie="SN-TIEMPOS-1",
        departamento=departamento,
        fecha_adquisicion=HOY - datetime.timedelta(days=400),
        fecha_ingreso=HOY - datetime.timedelta(days=365),
    )


def _antedatar(movimiento, dias: int):
    """Retrasa un movimiento: `created_at` es `auto_now_add` y no admite
    asignación directa."""
    momento = timezone.now() - datetime.timedelta(days=dias)
    MovimientoActivo.objects.filter(pk=movimiento.pk).update(created_at=momento)
    movimiento.refresh_from_db()
    return movimiento


def test_los_dos_tiempos_de_la_ficha_se_cuentan_por_separado(activo):
    """Un equipo comprado en diciembre que entró en marzo no estuvo en la
    empresa esos tres meses."""
    tiempos = calcular(activo)

    assert tiempos["desde_compra_dias"] == 400
    assert tiempos["desde_ingreso_dias"] == 365


def test_sin_fecha_de_ingreso_el_calculo_se_mide_desde_la_compra(admin, departamento):
    """Declararlo importa: dos «tiempos activos reales» medidos desde bases
    distintas no son comparables entre equipos."""
    sin_ingreso = ActivoService.crear_activo(
        actor=admin,
        tipo=TipoDispositivo.objects.create(nombre="Monitor", codigo="MON"),
        nombre="Monitor",
        marca="HP",
        modelo="E24",
        numero_serie="SN-TIEMPOS-2",
        departamento=departamento,
        fecha_adquisicion=HOY - datetime.timedelta(days=100),
    )

    tiempos = calcular(sin_ingreso)

    assert tiempos["desde_ingreso_dias"] is None
    assert tiempos["medido_desde"] == "compra"


def test_cuenta_desde_la_primera_asignacion(admin, activo, empleados):
    movimiento = ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[empleados[0]]
    ).movimientos.first()
    _antedatar(movimiento, 200)

    tiempos = calcular(activo)

    assert tiempos["desde_primera_asignacion_dias"] == 200


def test_el_tiempo_con_el_custodio_actual_no_incluye_los_periodos_ajenos(admin, activo, empleados):
    """Un equipo devuelto y reentregado a la misma persona no debe sumar el
    tiempo en que no lo tuvo: quien mira la ficha para saber desde cuándo lo
    custodia leería una fecha en la que estaba en otra mesa."""
    primera = ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[empleados[0]]
    )
    _antedatar(primera.movimientos.first(), 300)

    devolucion = ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[])
    _antedatar(devolucion.movimientos.first(), 200)

    reentrega = ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[empleados[0]]
    )
    _antedatar(reentrega.movimientos.first(), 50)

    activo.refresh_from_db()
    tiempos = calcular(activo)

    # Desde la reentrega, no desde la primera vez.
    assert tiempos["con_custodio_actual_dias"] == 50
    assert tiempos["desde_primera_asignacion_dias"] == 300


def test_sin_custodio_no_hay_tiempo_con_el_custodio_actual(activo):
    assert calcular(activo)["con_custodio_actual_dias"] is None


def test_la_reparacion_cerrada_y_la_que_sigue_abierta_se_informan_aparte(activo):
    """Sumarlas escondería que el equipo todavía está fuera de operación, que
    es justo lo que hay que ver."""
    Mantenimiento.objects.create(
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=HOY - datetime.timedelta(days=100),
        fecha_salida=HOY - datetime.timedelta(days=90),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        descripcion="Cambio de disco",
    )
    Mantenimiento.objects.create(
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=HOY - datetime.timedelta(days=5),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        descripcion="No enciende",
    )

    tiempos = calcular(activo)

    assert tiempos["en_reparacion_dias"] == 10
    assert tiempos["en_reparacion_ahora_dias"] == 5


def test_el_tiempo_sin_uso_suma_lo_que_estuvo_guardado(admin, activo, empleados):
    """El equipo nace en bodega; al entregarlo, ese tramo se cierra."""
    entrega = ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[empleados[0]]
    )
    _antedatar(activo.movimientos.filter(tipo=MovimientoActivo.Tipo.ALTA).first(), 300)
    _antedatar(entrega.movimientos.first(), 100)

    tiempos = calcular(activo)

    # Doscientos días en bodega entre el alta y la entrega.
    assert tiempos["sin_uso_dias"] == 200


def test_un_equipo_que_salio_del_inventario_deja_de_acumular_tiempo(admin, activo):
    """Un equipo robado hace seis meses no lleva seis meses «sin uso»: no
    está. Seguir sumándole tiempo lo haría aparecer como el más ocioso del
    parque."""
    baja = ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Denuncia 2026-300"
    )
    _antedatar(activo.movimientos.filter(tipo=MovimientoActivo.Tipo.ALTA).first(), 300)
    _antedatar(baja.movimientos.first(), 180)

    tiempos = calcular(activo)

    # 120 días en bodega antes del robo; los 180 posteriores no cuentan.
    assert tiempos["sin_uso_dias"] == 120


def test_el_tiempo_activo_real_descuenta_lo_guardado_y_lo_reparado(admin, activo, empleados):
    entrega = ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[empleados[0]]
    )
    _antedatar(activo.movimientos.filter(tipo=MovimientoActivo.Tipo.ALTA).first(), 365)
    _antedatar(entrega.movimientos.first(), 265)
    Mantenimiento.objects.create(
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=HOY - datetime.timedelta(days=60),
        fecha_salida=HOY - datetime.timedelta(days=45),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        descripcion="Reparación",
    )

    tiempos = calcular(activo)

    # 365 en la empresa - 100 en bodega - 15 en el taller.
    assert tiempos["activo_real_dias"] == 250
    assert tiempos["medido_desde"] == "ingreso"


def test_el_tiempo_activo_real_nunca_es_negativo(admin, activo):
    """Con fechas mal capturadas los descuentos pueden pasarse; un número
    negativo en la ficha solo confunde."""
    Mantenimiento.objects.create(
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=HOY - datetime.timedelta(days=5000),
        fecha_salida=HOY,
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        descripcion="Reparación larguísima",
    )

    assert calcular(activo)["activo_real_dias"] == 0


def test_la_ficha_publica_los_siete_tiempos(admin, activo):
    cliente = APIClient()
    cliente.force_authenticate(user=admin)

    datos = cliente.get(f"/api/v1/activos/{activo.id}/").data

    assert set(datos["tiempos"]) == {
        "desde_compra_dias",
        "desde_ingreso_dias",
        "desde_primera_asignacion_dias",
        "con_custodio_actual_dias",
        "en_reparacion_dias",
        "en_reparacion_ahora_dias",
        "sin_uso_dias",
        "activo_real_dias",
        "medido_desde",
    }


def test_calcular_los_tiempos_no_multiplica_las_consultas(
    admin, activo, django_assert_max_num_queries
):
    """La ficha precarga historial y bitácora: sin eso, cada tiempo se llevaría
    su propia consulta."""
    cliente = APIClient()
    cliente.force_authenticate(user=admin)

    # Sesión, permisos, activo, historial, bitácora y la evaluación de
    # renovación. Lo que no puede haber es una consulta por cada tiempo.
    with django_assert_max_num_queries(15):
        cliente.get(f"/api/v1/activos/{activo.id}/")
