"""Escenarios de mayor riesgo del dominio de activos, conectados a pytest-bdd.

Siguiendo `docs/qa-strategy.md`, no se conecta cada escenario Gherkin: se
conecta al menos uno representativo por `.feature` y se priorizan los
criterios donde un error saldría caro. Aquí eso significa la unicidad del
código de barras (RF-02), el contador que alimenta las decisiones de compra
(RF-05) y los tres criterios del motor de renovación (RF-07). El resto queda
cubierto por las pruebas de `backend/apps/*/tests/` y marcado como tal en la
matriz de trazabilidad.
"""

import datetime

import pytest
from pytest_bdd import given, parsers, scenario, then, when
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.mantenimientos.models import CatalogoComponente, Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento, Empleado
from apps.politicas.models import PoliticaObsolescencia
from apps.politicas.services import evaluar_activo
from apps.users.models import User

FEATURES = "../features"


@pytest.fixture
def contexto():
    return {}


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="qa_activos", email="qa_activos@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def _crear_activo(admin, contexto, serie="SN-QA-1", fecha=datetime.date(2024, 1, 10), tipo=None):
    # `setdefault` no sirve aquí: evalúa su segundo argumento aunque la clave
    # ya exista, y crearía un catálogo duplicado en cada llamada.
    if "departamento" not in contexto:
        contexto["departamento"] = Departamento.objects.create(nombre="Sistemas", codigo="SIS")
    if "tipo" not in contexto:
        contexto["tipo"] = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    departamento = contexto["departamento"]
    tipo = tipo or contexto["tipo"]
    return ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre=f"Equipo {serie}",
        marca="Lenovo",
        modelo="ThinkPad",
        numero_serie=serie,
        departamento=departamento,
        fecha_adquisicion=fecha,
    )


def _registrar_mantenimiento(admin, activo, componentes=None, indice=1):
    return MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=componentes,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2024, 6, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion=f"Intervención {indice}",
    )


# =========================================================================
# RF-02: el código de barras identifica de forma inequívoca
# =========================================================================


@scenario(f"{FEATURES}/inventario-activos.feature", "El alta genera un código de barras único automáticamente")
def test_codigo_de_barras_unico():
    pass


@given("que existen un departamento, un empleado y un tipo de dispositivo registrados")
def catalogos_listos(db, contexto):
    contexto["departamento"] = Departamento.objects.create(nombre="Sistemas", codigo="SIS")
    contexto["tipo"] = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    contexto["empleado"] = Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez",
        codigo_empleado="EMP-0001",
        departamento=contexto["departamento"],
    )


@when("se registra un activo nuevo")
def registrar_activo_nuevo(admin, contexto):
    contexto["activo"] = _crear_activo(admin, contexto)


@then("el sistema le asigna un código de barras sin intervención del usuario")
def tiene_codigo_generado(contexto):
    assert contexto["activo"].codigo_barras


@then("el código sigue el formato de prefijo, tipo y secuencia")
def formato_del_codigo(contexto):
    from apps.activos.barcode import es_codigo_valido

    assert es_codigo_valido(contexto["activo"].codigo_barras)
    assert contexto["activo"].codigo_barras == "GA-LAP-000001"


@then("ningún otro activo puede tener ese mismo código")
def codigo_es_unico(contexto):
    from django.db import IntegrityError, transaction

    duplicado = Activo(
        codigo_barras=contexto["activo"].codigo_barras,
        tipo=contexto["tipo"],
        nombre="Copia",
        marca="X",
        modelo="Y",
        numero_serie="SN-DUPLICADO",
        departamento=contexto["departamento"],
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        duplicado.save()


# =========================================================================
# RF-05: el contador acumulado de intervenciones
# =========================================================================


@scenario(f"{FEATURES}/mantenimientos.feature", "El contador de intervenciones se incrementa automáticamente")
def test_contador_de_intervenciones():
    pass


@given("que existe un activo registrado en el inventario")
def activo_registrado(admin, contexto):
    contexto["activo"] = _crear_activo(admin, contexto, serie="SN-QA-MNT")


@when("se registran tres mantenimientos sobre el activo")
def registrar_tres_mantenimientos(admin, contexto):
    for indice in range(3):
        _registrar_mantenimiento(admin, contexto["activo"], indice=indice)
    contexto["activo"].refresh_from_db()


@then("el contador acumulado del activo indica tres intervenciones")
def contador_en_tres(contexto):
    assert contexto["activo"].total_mantenimientos == 3


@then("no hace falta contar manualmente los registros del historial")
def contador_coincide_con_bitacora(contexto):
    assert contexto["activo"].total_mantenimientos == contexto["activo"].mantenimientos.count()


# =========================================================================
# RF-07: los tres criterios del motor de renovación
# =========================================================================


@scenario(f"{FEATURES}/politicas-renovacion.feature", "Los tres criterios se informan por separado")
def test_motor_informa_cada_criterio():
    pass


@given("una política que fija los tres umbrales")
def politica_estricta(db, contexto):
    contexto["tipo"] = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    contexto["politica"] = PoliticaObsolescencia.objects.create(
        nombre="Estricta",
        tipo_dispositivo=contexto["tipo"],
        max_mantenimientos=1,
        max_componentes_criticos=0,
        vida_util_meses=12,
    )


@when("un activo los excede todos")
def activo_excede_todo(admin, contexto):
    activo = _crear_activo(
        admin,
        contexto,
        serie="SN-QA-POL",
        fecha=datetime.date(2018, 1, 1),
        tipo=contexto["tipo"],
    )
    fuente = CatalogoComponente.objects.create(
        nombre="Fuente de poder", codigo="PSU", es_critico=True
    )
    for indice in range(2):
        _registrar_mantenimiento(
            admin, activo, componentes=[{"componente": fuente}], indice=indice
        )
    activo.refresh_from_db()
    contexto["activo"] = activo
    contexto["resultado"] = evaluar_activo(activo)


@then("la alerta enumera un motivo por cada criterio superado")
def enumera_los_tres_motivos(contexto):
    resultado = contexto["resultado"]
    assert resultado.requiere_renovacion is True
    criterios = {motivo["criterio"] for motivo in resultado.motivos}
    assert criterios == {"mantenimientos", "componentes_criticos", "longevidad"}
    # Cada motivo trae el dato cuantitativo que respalda la decisión de compra.
    for motivo in resultado.motivos:
        assert motivo["valor_actual"] > motivo["umbral"] or motivo["criterio"] == "longevidad"
        assert motivo["detalle"]


# =========================================================================
# RF-03: consulta por escáner
# =========================================================================


@scenario(f"{FEATURES}/escaner-activos.feature", "El escáner también resuelve por número de serie")
def test_escaner_por_numero_de_serie():
    pass


@given("que existe un activo registrado")
def activo_para_escanear(admin, contexto):
    contexto["activo"] = _crear_activo(admin, contexto, serie="SN-FABRICANTE-77")


@when("se consulta usando el número de serie del fabricante en vez del código propio")
def consultar_por_serie(cliente, contexto):
    contexto["respuesta"] = cliente.get(
        f"/api/v1/activos/por-codigo/{contexto['activo'].numero_serie}/"
    )


@then("se obtiene el mismo activo")
def resuelve_el_mismo_activo(contexto):
    assert contexto["respuesta"].status_code == 200
    assert contexto["respuesta"].json()["activo"]["id"] == contexto["activo"].id


# =========================================================================
# RF-08: la etiqueta térmica
# =========================================================================


@scenario(f"{FEATURES}/etiquetas-termicas.feature", "La etiqueta contiene código de barras, nombre del activo y área")
def test_contenido_de_la_etiqueta():
    pass


@given("que existe un activo con código de barras asignado")
def activo_con_codigo(admin, contexto):
    contexto["activo"] = _crear_activo(admin, contexto, serie="SN-QA-ETI")


@when("se genera el trabajo de impresión térmica del activo")
def generar_etiqueta(cliente, contexto):
    contexto["respuesta"] = cliente.get(
        f"/api/v1/activos/{contexto['activo'].id}/etiqueta/?formato=zpl"
    )


@then("el contenido incluye el código de barras en simbología Code 128")
def etiqueta_con_code128(contexto):
    contenido = contexto["respuesta"].json()["contenido"]
    assert contexto["activo"].codigo_barras in contenido
    assert "^BCN" in contenido  # comando de Code 128 en ZPL


@then("incluye el nombre del activo y el nombre de su área")
def etiqueta_con_nombre_y_area(contexto):
    contenido = contexto["respuesta"].json()["contenido"]
    assert contexto["activo"].nombre in contenido
    assert contexto["activo"].departamento.nombre in contenido


# =========================================================================
# Steps compartidos con parámetros
# =========================================================================


@then(parsers.parse("la solicitud es rechazada"))
def solicitud_rechazada(contexto):
    assert contexto["respuesta"].status_code == 400


# =========================================================================
# RF-08: la etiqueta en PDF
# =========================================================================


@scenario(f"{FEATURES}/etiquetas-termicas.feature", "La etiqueta se descarga en PDF")
def test_descarga_en_pdf():
    pass


@when("se descarga la etiqueta del activo")
def descargar_etiqueta(cliente, contexto):
    contexto["respuesta"] = cliente.get(
        f"/api/v1/activos/{contexto['activo'].id}/etiqueta/?descargar=true"
    )


@then("se obtiene un documento PDF")
def es_un_pdf(contexto):
    respuesta = contexto["respuesta"]
    assert respuesta["Content-Type"] == "application/pdf"
    assert respuesta.content.startswith(b"%PDF-")


@then("el archivo se nombra con el código de barras del activo")
def nombre_del_archivo(contexto):
    disposicion = contexto["respuesta"]["Content-Disposition"]
    assert disposicion.startswith("attachment")
    assert f"etiqueta-{contexto['activo'].codigo_barras}.pdf" in disposicion
