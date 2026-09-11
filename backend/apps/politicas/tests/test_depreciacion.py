"""Qué vale hoy un equipo (§22.3).

Depreciación de gestión, no contabilidad: responde «cuánto vale el parque» y
«cuánto se pierde si este equipo se da de baja hoy», que es lo que respalda una
solicitud de compra. Lo que se declara ante el SRI lo lleva el ERP.

Lo que estas pruebas fijan no es la aritmética —dividir un costo entre meses no
se rompe solo— sino los bordes que sí: que un equipo viejo no valga menos que
su residual, que la vida contable no se confunda con la de renovación, y que
«no vale nada» y «nadie capturó lo que costó» no se digan igual.
"""

import datetime
from decimal import Decimal

import pytest

from apps.activos.models import TipoDispositivo
from apps.politicas import depreciacion as dep
from apps.politicas.models import PoliticaDepreciacion

ENERO = datetime.date(2024, 1, 15)


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def politica(db):
    """Tres años, sin valor residual: lo habitual en equipo de cómputo."""
    return PoliticaDepreciacion.objects.create(nombre="General", meses_vida_contable=36)


# --- La cuenta -------------------------------------------------------------


def test_reparte_el_costo_en_partes_iguales(politica):
    resultado = dep.calcular(Decimal("1800.00"), ENERO, politica, datetime.date(2024, 7, 15))

    assert resultado.cuota_mensual == Decimal("50.00")
    assert resultado.meses_transcurridos == 6
    assert resultado.acumulada == Decimal("300.00")
    assert resultado.valor_en_libros == Decimal("1500.00")


def test_cuenta_meses_de_calendario_y_no_de_treinta_dias(politica):
    """Un equipo que entró el 15 de enero cumple un mes el 15 de febrero, tenga
    febrero 28 o 29 días."""
    assert dep.calcular(1800, ENERO, politica, datetime.date(2024, 2, 14)).meses_transcurridos == 0
    assert dep.calcular(1800, ENERO, politica, datetime.date(2024, 2, 15)).meses_transcurridos == 1


def test_al_terminar_la_vida_contable_el_valor_en_libros_es_cero(politica):
    resultado = dep.calcular(1800, ENERO, politica, datetime.date(2027, 1, 15))

    assert resultado.valor_en_libros == Decimal("0.00")
    assert resultado.porcentaje_depreciado == Decimal("100.00")
    assert resultado.totalmente_depreciado


def test_un_equipo_pasado_de_vida_no_vale_negativo(politica):
    """Es el borde que un `costo - cuota * meses` sin tope se salta: a los ocho
    años el equipo debería «valer» menos de cero."""
    resultado = dep.calcular(1800, ENERO, politica, datetime.date(2032, 1, 15))

    assert resultado.valor_en_libros == Decimal("0.00")
    assert resultado.acumulada == Decimal("1800.00")


def test_el_valor_residual_es_el_piso(politica):
    """Un equipo que conserva el 10 % nunca baja de ahí, ni a los diez años."""
    politica.porcentaje_residual = Decimal("10.00")
    politica.save()

    resultado = dep.calcular(1000, ENERO, politica, datetime.date(2034, 1, 15))

    assert resultado.valor_en_libros == Decimal("100.00")
    assert resultado.acumulada == Decimal("900.00")


def test_recien_comprado_todavia_no_perdio_nada(politica):
    resultado = dep.calcular(1800, ENERO, politica, ENERO)

    assert resultado.acumulada == Decimal("0.00")
    assert resultado.valor_en_libros == Decimal("1800.00")
    assert not resultado.totalmente_depreciado


def test_dice_cuando_termina_de_depreciarse(politica):
    resultado = dep.calcular(1800, ENERO, politica, datetime.date(2024, 7, 15))

    assert resultado.fin == datetime.date(2027, 1, 15)


def test_el_fin_recorta_el_dia_que_no_existe(politica):
    """Un equipo que entró el 31 de enero con 13 meses de vida termina el 28 de
    febrero, no el 3 de marzo."""
    politica.meses_vida_contable = 13
    politica.save()

    resultado = dep.calcular(1300, datetime.date(2024, 1, 31), politica)

    assert resultado.fin == datetime.date(2025, 2, 28)


# --- Cuando no hay nada que decir ------------------------------------------


def test_sin_costo_no_se_inventa_un_valor(politica):
    assert dep.calcular(None, ENERO, politica) is None
    assert dep.calcular(0, ENERO, politica) is None


def test_sin_politica_no_se_deprecia(db):
    assert dep.calcular(1800, ENERO, None) is None


def test_los_tres_silencios_se_explican_distinto(tipo, politica):
    """«No vale nada», «nadie capturó lo que costó» y «no es nuestro» se
    arreglan de formas distintas —el segundo lo corrige quien tenga la
    factura, y el tercero no se arregla porque no es un fallo—."""

    class ActivoFalso:
        costo_adquisicion = None
        es_de_la_empresa = True

    assert dep.motivo_sin_depreciacion(ActivoFalso(), politica) == dep.SIN_COSTO
    ActivoFalso.costo_adquisicion = Decimal("1800")
    assert dep.motivo_sin_depreciacion(ActivoFalso(), None) == dep.SIN_POLITICA
    assert dep.motivo_sin_depreciacion(ActivoFalso(), politica) is None
    ActivoFalso.es_de_la_empresa = False
    assert dep.motivo_sin_depreciacion(ActivoFalso(), politica) == dep.EN_CONCESION


def test_un_equipo_en_concesion_no_deprecia_contra_nuestro_patrimonio(politica):
    """Lo compró el partner: contarlo abultaría el valor del parque con algo
    que es de otro. Su mantenimiento sí es gasto propio y sigue contándose."""

    class ActivoFalso:
        costo_adquisicion = Decimal("1800")
        fecha_ingreso = ENERO
        fecha_adquisicion = ENERO
        es_de_la_empresa = False

    assert dep.calcular_de(ActivoFalso(), politica) is None
    # Y el mismo equipo, si la empresa termina comprándolo, sí deprecia.
    ActivoFalso.es_de_la_empresa = True
    assert dep.calcular_de(ActivoFalso(), politica) is not None


# --- Qué política se aplica ------------------------------------------------


def test_la_del_tipo_gana_sobre_la_global(tipo, politica):
    propia = PoliticaDepreciacion.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo, meses_vida_contable=48
    )

    assert dep.resolver_politica(tipo) == propia


def test_un_tipo_sin_politica_propia_usa_la_global(tipo, politica):
    assert dep.resolver_politica(tipo) == politica


def test_una_politica_desactivada_no_cae_de_vuelta_a_la_global(tipo, politica):
    """Desactivarla significa «este tipo no se deprecia aquí», que es distinto
    de «este tipo usa el criterio común»: para eso se la elimina."""
    PoliticaDepreciacion.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo, meses_vida_contable=48, activa=False
    )

    assert dep.resolver_politica(tipo) is None


def test_resolver_en_lote_da_lo_mismo_que_una_por_una(tipo, politica):
    """El reporte resuelve todas de golpe; si las dos rutas no coincidieran, la
    ficha y el informe dirían cosas distintas del mismo equipo."""
    otro = TipoDispositivo.objects.create(nombre="Impresora", codigo="IMP")
    PoliticaDepreciacion.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo, meses_vida_contable=48
    )

    en_lote = dep.resolver_politicas_de([tipo.id, otro.id])

    assert en_lote[tipo.id] == dep.resolver_politica(tipo)
    assert en_lote[otro.id] == dep.resolver_politica(otro)


# --- La distinción que sostiene el módulo ----------------------------------


def test_la_vida_contable_no_es_la_vida_util_de_renovacion(tipo, politica):
    """Son dos números distintos a propósito: se deprecia en tres años y se
    reemplaza a los cuatro o cinco. Un equipo totalmente depreciado que sigue
    funcionando es lo normal, no una alerta."""
    from apps.politicas.models import PoliticaObsolescencia

    PoliticaObsolescencia.objects.create(
        nombre="Renovación", vida_util_meses=48, vida_util_critica_meses=60
    )

    a_los_tres_anios = dep.calcular(1800, ENERO, politica, datetime.date(2027, 1, 15))

    assert a_los_tres_anios.totalmente_depreciado
    # Y sin embargo todavía no toca reemplazarlo: 36 meses no llegan a 48.
    assert a_los_tres_anios.meses_transcurridos < 48


# --- La API de la política -------------------------------------------------

RUTA = "/api/v1/politicas/depreciacion/"


@pytest.fixture
def admin(db):
    from apps.users.models import User

    return User.objects.create_superuser(
        username="admin_dep", email="admin_dep@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def test_se_administra_desde_la_aplicacion(cliente, tipo):
    respuesta = cliente.post(
        RUTA,
        {"nombre": "Laptops", "tipo_dispositivo": tipo.id, "meses_vida_contable": 48},
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.data["es_global"] is False
    assert respuesta.data["tipo_dispositivo_nombre"] == "Laptop"


def test_la_ruta_no_se_confunde_con_una_politica_de_renovacion(cliente, politica):
    """`/politicas/depreciacion/` y `/politicas/{id}/` cuelgan del mismo prefijo:
    registrada al revés, «depreciacion» se leería como el id de una política de
    obsolescencia y devolvería un 404."""
    assert cliente.get(RUTA).status_code == 200


def test_una_vida_de_cero_meses_se_rechaza(cliente):
    """La cuota mensual sería una división por cero. Para dejar de depreciar un
    tipo está `activa`, que es una decisión distinta y reversible."""
    respuesta = cliente.post(RUTA, {"nombre": "Rota", "meses_vida_contable": 0}, format="json")

    assert respuesta.status_code == 400
    assert "desactive la política" in str(respuesta.data)


def test_un_residual_del_cien_por_ciento_se_rechaza(cliente):
    """Un equipo que conserva todo su valor no se deprecia: sería una política
    que existe y no hace nada."""
    respuesta = cliente.post(
        RUTA,
        {"nombre": "Eterna", "meses_vida_contable": 36, "porcentaje_residual": "100.00"},
        format="json",
    )

    assert respuesta.status_code == 400


def test_solo_puede_haber_una_politica_global(cliente, politica):
    respuesta = cliente.post(
        RUTA, {"nombre": "Otra global", "meses_vida_contable": 24}, format="json"
    )

    assert respuesta.status_code == 400


def test_cambiarla_se_ve_en_la_siguiente_consulta(cliente, politica):
    """No hay reevaluación en lote como en obsolescencia: la depreciación se
    calcula al leer, así que no queda ninguna columna con el valor viejo."""
    cliente.patch(f"{RUTA}{politica.id}/", {"meses_vida_contable": 24}, format="json")

    resultado = dep.calcular(2400, ENERO, dep.resolver_politica(None), datetime.date(2025, 1, 15))

    assert resultado.meses_vida_contable == 24
    assert resultado.valor_en_libros == Decimal("1200.00")


def test_el_cambio_queda_en_auditoria(cliente, politica):
    """Una política de depreciación mueve el valor declarado del parque: quién
    la cambió y a qué es justo lo que se pregunta después."""
    from apps.core.models import AuditLog

    cliente.patch(f"{RUTA}{politica.id}/", {"meses_vida_contable": 24}, format="json")

    evento = AuditLog.objects.filter(action="politica_depreciacion.updated").first()
    assert evento is not None
    assert evento.new_values["meses_vida_contable"] == 24
