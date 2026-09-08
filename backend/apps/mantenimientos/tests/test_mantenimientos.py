"""Bitácora de mantenimientos y contador de intervenciones (RF-04, RF-05)."""

import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.mantenimientos.models import CatalogoComponente, Mantenimiento
from apps.mantenimientos.services import MantenimientoService, resumen_costos
from apps.organizacion.models import Departamento
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_mant", email="admin_mant@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


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
        numero_serie="SN-MANT-1",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2023, 1, 10),
    )


@pytest.fixture
def disco_critico(db):
    return CatalogoComponente.objects.create(nombre="Disco duro SSD", codigo="SSD", es_critico=True)


@pytest.fixture
def teclado_no_critico(db):
    return CatalogoComponente.objects.create(nombre="Teclado", codigo="TEC", es_critico=False)


def _datos_mantenimiento(**overrides):
    base = {
        "tipo": Mantenimiento.Tipo.CORRECTIVO,
        "fecha_intervencion": datetime.date(2024, 6, 1),
        "tipo_responsable": Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        "responsable": "Luis Torres",
        "descripcion": "Reemplazo de disco",
        "diagnostico": "Sectores defectuosos",
    }
    base.update(overrides)
    return base


# --- RF-04: bitácora -------------------------------------------------------


def test_registrar_un_mantenimiento_guarda_su_desglose_de_componentes(admin, activo, disco_critico):
    mantenimiento = MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=[
            {"componente": disco_critico, "cantidad": 1, "costo_unitario": Decimal("85.50")}
        ],
        **_datos_mantenimiento(costo_mano_obra=Decimal("20.00")),
    )

    linea = mantenimiento.componentes.get()
    assert linea.componente == disco_critico
    assert linea.costo_total == Decimal("85.50")
    assert mantenimiento.costo_total == Decimal("105.50")
    assert mantenimiento.registrado_por == admin


def test_no_se_registran_mantenimientos_sobre_un_activo_dado_de_baja(cliente, admin, activo):
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.DADO_DE_BAJA, motivo="Obsoleto"
    )

    respuesta = cliente.post(
        "/api/v1/mantenimientos/",
        {"activo": activo.id, **_datos_mantenimiento(fecha_intervencion="2024-06-01")},
        format="json",
    )

    assert respuesta.status_code == 400
    assert "dado de baja" in str(respuesta.json()).lower()


def test_la_fecha_de_intervencion_no_puede_ser_futura(cliente, activo):
    from django.utils import timezone

    manana = timezone.localdate() + datetime.timedelta(days=1)

    respuesta = cliente.post(
        "/api/v1/mantenimientos/",
        {"activo": activo.id, **_datos_mantenimiento(fecha_intervencion=str(manana))},
        format="json",
    )

    assert respuesta.status_code == 400
    assert "futura" in str(respuesta.json()).lower()


def test_la_intervencion_no_puede_ser_anterior_a_la_compra_del_activo(cliente, activo):
    """Un mantenimiento previo a la adquisición indica un error de captura que
    distorsionaría el historial y los contadores."""
    respuesta = cliente.post(
        "/api/v1/mantenimientos/",
        {"activo": activo.id, **_datos_mantenimiento(fecha_intervencion="2020-01-01")},
        format="json",
    )

    assert respuesta.status_code == 400
    assert "anterior a la fecha de adquisición" in str(respuesta.json())


# --- RF-05: contador de intervenciones ------------------------------------


def test_el_contador_de_mantenimientos_se_incrementa_solo(admin, activo, disco_critico):
    assert activo.total_mantenimientos == 0

    for numero in range(3):
        MantenimientoService.registrar(
            actor=admin,
            activo=activo,
            **_datos_mantenimiento(descripcion=f"Intervención {numero}"),
        )

    activo.refresh_from_db()
    assert activo.total_mantenimientos == 3


def test_el_contador_de_piezas_criticas_solo_cuenta_las_marcadas_como_criticas(
    admin, activo, disco_critico, teclado_no_critico
):
    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=[
            {"componente": disco_critico, "cantidad": 2},
            {"componente": teclado_no_critico, "cantidad": 5},
        ],
        **_datos_mantenimiento(),
    )

    activo.refresh_from_db()
    assert activo.total_mantenimientos == 1
    # Cuenta cantidades de piezas críticas (2), no líneas ni piezas comunes.
    assert activo.total_componentes_criticos == 2


def test_eliminar_un_mantenimiento_devuelve_el_contador_a_su_valor_real(
    admin, activo, disco_critico
):
    """El contador se recalcula desde la bitácora, no se incrementa a ciegas:
    por eso una corrección lo deja consistente."""
    primero = MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=[{"componente": disco_critico, "cantidad": 1}],
        **_datos_mantenimiento(),
    )
    MantenimientoService.registrar(actor=admin, activo=activo, **_datos_mantenimiento())
    activo.refresh_from_db()
    assert activo.total_mantenimientos == 2

    MantenimientoService.eliminar(actor=admin, mantenimiento=primero)

    activo.refresh_from_db()
    assert activo.total_mantenimientos == 1
    assert activo.total_componentes_criticos == 0


def test_cambiar_la_criticidad_del_catalogo_no_reescribe_el_historial(
    admin, activo, teclado_no_critico
):
    """Si mañana un teclado pasa a considerarse crítico, las intervenciones ya
    registradas conservan la regla vigente cuando ocurrieron."""
    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=[{"componente": teclado_no_critico, "cantidad": 1}],
        **_datos_mantenimiento(),
    )
    activo.refresh_from_db()
    assert activo.total_componentes_criticos == 0

    teclado_no_critico.es_critico = True
    teclado_no_critico.save()

    from apps.mantenimientos.services import recalcular_indicadores

    recalcular_indicadores(activo)
    activo.refresh_from_db()
    assert activo.total_componentes_criticos == 0


# --- Costos (contexto de RF-04) -------------------------------------------


def test_el_resumen_de_costos_suma_mano_de_obra_y_repuestos(admin, activo, disco_critico):
    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=[
            {"componente": disco_critico, "cantidad": 2, "costo_unitario": Decimal("50.00")}
        ],
        **_datos_mantenimiento(costo_mano_obra=Decimal("30.00")),
    )
    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        **_datos_mantenimiento(
            tipo=Mantenimiento.Tipo.PREVENTIVO, costo_mano_obra=Decimal("15.00")
        ),
    )

    costos = resumen_costos(activo)

    assert costos["costo_mano_obra"] == Decimal("45.00")
    assert costos["costo_repuestos"] == Decimal("100.00")
    assert costos["costo_total"] == Decimal("145.00")
    assert costos["mantenimientos_por_tipo"] == {"correctivo": 1, "preventivo": 1}


# --- Auditoría -------------------------------------------------------------


def test_registrar_una_intervencion_queda_auditado(admin, activo, disco_critico):
    from apps.core.models import AuditLog

    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=[{"componente": disco_critico, "cantidad": 1}],
        **_datos_mantenimiento(),
    )

    evento = AuditLog.objects.filter(action="mantenimiento.created").get()
    assert evento.actor == admin
    assert evento.module == "mantenimientos"
    assert evento.new_values["codigo_barras"] == activo.codigo_barras
    assert evento.new_values["total_mantenimientos"] == 1
