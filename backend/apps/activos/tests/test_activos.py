"""Inventario de activos: alta, código de barras, escáner y etiquetas
(RF-01, RF-02, RF-03, RF-08)."""

import datetime

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.activos.barcode import es_codigo_valido, generar_codigo_barras
from apps.activos.models import Activo, MovimientoActivo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_activos", email="admin_activos@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


@pytest.fixture
def empleado(departamento):
    return Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez",
        documento_identidad="0102030405",
        departamento=departamento,
    )


@pytest.fixture
def tipo_laptop(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def datos_activo(tipo_laptop, departamento):
    return {
        "tipo": tipo_laptop,
        "nombre": "Laptop Contabilidad 01",
        "marca": "Dell",
        "modelo": "Latitude 5440",
        "numero_serie": "SN-0001",
        "departamento": departamento,
        "fecha_adquisicion": datetime.date(2024, 1, 15),
    }


# --- RF-02: código de barras ---------------------------------------------


def test_el_alta_genera_un_codigo_de_barras_con_el_prefijo_del_tipo(admin, datos_activo):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    assert activo.codigo_barras == "GA-LAP-000001"
    assert es_codigo_valido(activo.codigo_barras)


def test_los_codigos_son_correlativos_por_tipo_de_dispositivo(admin, datos_activo, departamento):
    impresora = TipoDispositivo.objects.create(nombre="Impresora", codigo="IMP")

    primera_laptop = ActivoService.crear_activo(actor=admin, **datos_activo)
    segunda_laptop = ActivoService.crear_activo(
        actor=admin, **{**datos_activo, "numero_serie": "SN-0002"}
    )
    primera_impresora = ActivoService.crear_activo(
        actor=admin, **{**datos_activo, "tipo": impresora, "numero_serie": "SN-0003"}
    )

    assert primera_laptop.codigo_barras == "GA-LAP-000001"
    assert segunda_laptop.codigo_barras == "GA-LAP-000002"
    # La numeración de cada tipo es independiente: la primera impresora no
    # hereda el correlativo de las laptops.
    assert primera_impresora.codigo_barras == "GA-IMP-000001"


def test_el_codigo_de_barras_es_unico_en_la_base_de_datos(admin, datos_activo):
    """La unicidad la garantiza la base, no el generador: es lo que permite
    que el alta reintente ante una carrera en vez de serializar las altas."""
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)
    duplicado = Activo(
        codigo_barras=activo.codigo_barras,
        **{**datos_activo, "numero_serie": "SN-9999"},
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        duplicado.save()


def test_generar_codigo_rellena_la_secuencia_con_ceros():
    assert generar_codigo_barras("srv", secuencia=7) == "GA-SRV-000007"


def test_un_texto_arbitrario_no_es_un_codigo_valido():
    assert not es_codigo_valido("SN-DELL-XYZ-2024")
    assert es_codigo_valido("ga-lap-000042")


# --- RF-01: expediente y custodia ----------------------------------------


def test_el_alta_deja_un_movimiento_de_tipo_alta(admin, datos_activo):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    movimiento = activo.movimientos.get()
    assert movimiento.tipo == MovimientoActivo.Tipo.ALTA
    assert movimiento.registrado_por == admin


def test_asignar_custodio_registra_el_movimiento_y_pone_el_activo_en_uso(
    admin, datos_activo, empleado
):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    ActivoService.asignar_custodio(
        actor=admin, activo=activo, custodio=empleado, motivo="Entrega inicial"
    )

    activo.refresh_from_db()
    assert activo.custodio == empleado
    assert activo.estado == Activo.Estado.EN_USO
    movimiento = activo.movimientos.first()
    assert movimiento.tipo == MovimientoActivo.Tipo.ASIGNACION
    assert movimiento.custodio_nuevo == empleado
    assert movimiento.motivo == "Entrega inicial"


def test_devolver_a_bodega_conserva_al_custodio_anterior_en_el_historial(
    admin, datos_activo, empleado
):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)

    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=None, motivo="Renuncia")

    activo.refresh_from_db()
    assert activo.custodio is None
    assert activo.estado == Activo.Estado.EN_BODEGA
    devolucion = activo.movimientos.first()
    assert devolucion.tipo == MovimientoActivo.Tipo.DEVOLUCION
    # El rastro de quién lo tenía sobrevive a la devolución: es lo que permite
    # deslindar responsabilidades sobre el equipo.
    assert devolucion.custodio_anterior == empleado


def test_dar_de_baja_exige_motivo_y_registra_la_fecha(cliente, admin, datos_activo):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    sin_motivo = cliente.post(
        f"/api/v1/activos/{activo.id}/cambiar-estado/",
        {"estado": "dado_de_baja"},
        format="json",
    )
    assert sin_motivo.status_code == 400

    con_motivo = cliente.post(
        f"/api/v1/activos/{activo.id}/cambiar-estado/",
        {"estado": "dado_de_baja", "motivo": "Pantalla irreparable"},
        format="json",
    )
    assert con_motivo.status_code == 200

    activo.refresh_from_db()
    assert activo.estado == Activo.Estado.DADO_DE_BAJA
    assert activo.fecha_baja is not None
    assert activo.motivo_baja == "Pantalla irreparable"


def test_el_inventario_no_permite_eliminar_activos(cliente, admin, datos_activo):
    """Un activo se da de baja, nunca se borra: su expediente es el respaldo
    de a quién se le entregó y cuánto costó sostenerlo."""
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    respuesta = cliente.delete(f"/api/v1/activos/{activo.id}/")

    assert respuesta.status_code == 405
    assert Activo.objects.filter(id=activo.id).exists()


def test_editar_la_ficha_no_puede_cambiar_el_custodio(cliente, admin, datos_activo, empleado):
    """Cambiar de responsable por PATCH saltaría el registro del movimiento."""
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    respuesta = cliente.patch(
        f"/api/v1/activos/{activo.id}/",
        {"nombre": "Laptop renombrada", "custodio": empleado.id},
        format="json",
    )

    assert respuesta.status_code == 200
    activo.refresh_from_db()
    assert activo.nombre == "Laptop renombrada"
    assert activo.custodio is None


# --- RF-03: búsqueda por escáner -----------------------------------------


def test_buscar_por_codigo_escaneado_devuelve_ficha_historial_y_costos(
    cliente, admin, datos_activo, empleado
):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)

    respuesta = cliente.get(f"/api/v1/activos/por-codigo/{activo.codigo_barras}/")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["activo"]["codigo_barras"] == activo.codigo_barras
    assert cuerpo["activo"]["custodio_nombre"] == "Ana Pérez"
    assert len(cuerpo["movimientos"]) == 2
    assert cuerpo["mantenimientos"] == []
    assert "costos" in cuerpo


def test_el_escaner_tambien_resuelve_por_numero_de_serie(cliente, admin, datos_activo):
    """La pistola entrega texto plano y el técnico no siempre sabe si está
    leyendo nuestra etiqueta o la del fabricante."""
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    respuesta = cliente.get(f"/api/v1/activos/por-codigo/{activo.numero_serie}/")

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"]["id"] == activo.id


def test_un_codigo_inexistente_devuelve_404_con_mensaje_util(cliente):
    respuesta = cliente.get("/api/v1/activos/por-codigo/GA-LAP-999999/")

    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "activo_no_encontrado"


# --- RF-08: etiquetas ------------------------------------------------------


def test_la_etiqueta_zpl_contiene_el_codigo_el_nombre_y_el_area(cliente, admin, datos_activo):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    respuesta = cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/?formato=zpl")

    assert respuesta.status_code == 200
    contenido = respuesta.json()["contenido"]
    assert contenido.startswith("^XA")
    assert contenido.endswith("^XZ")
    assert activo.codigo_barras in contenido
    assert "Laptop Contabilidad 01" in contenido
    assert "Tecnología" in contenido
    assert "^BCN" in contenido  # Code 128


def test_la_etiqueta_tspl_usa_los_comandos_de_ese_lenguaje(cliente, admin, datos_activo):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    respuesta = cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/?formato=tspl")

    contenido = respuesta.json()["contenido"]
    assert "SIZE 50.0 mm, 25.0 mm" in contenido
    assert "BARCODE" in contenido and '"128"' in contenido
    assert contenido.rstrip().endswith("PRINT 1,1")


def test_un_formato_de_impresion_no_soportado_es_rechazado(cliente, admin, datos_activo):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    respuesta = cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/?formato=pcl")

    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "formato_invalido"


def test_los_caracteres_de_control_del_lenguaje_no_se_inyectan_en_la_etiqueta(
    cliente, admin, datos_activo
):
    """Un nombre con '^' no debe poder introducir un comando ZPL propio."""
    activo = ActivoService.crear_activo(
        actor=admin, **{**datos_activo, "nombre": "Laptop ^XZ^FO0,0^FDhackeada"}
    )

    contenido = cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/").json()["contenido"]

    # Solo los delimitadores legítimos de una etiqueta, no los inyectados.
    assert contenido.count("^XA") == 1
    assert contenido.count("^XZ") == 1


def test_la_impresion_por_lotes_concatena_las_etiquetas_en_un_solo_trabajo(
    cliente, admin, datos_activo
):
    primero = ActivoService.crear_activo(actor=admin, **datos_activo)
    segundo = ActivoService.crear_activo(actor=admin, **{**datos_activo, "numero_serie": "SN-0002"})

    respuesta = cliente.post(
        "/api/v1/activos/etiquetas/", {"ids": [primero.id, segundo.id]}, format="json"
    )

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["cantidad"] == 2
    assert cuerpo["contenido"].count("^XA") == 2


def test_descargar_la_etiqueta_la_entrega_como_archivo_adjunto(cliente, admin, datos_activo):
    activo = ActivoService.crear_activo(actor=admin, **datos_activo)

    respuesta = cliente.get(f"/api/v1/activos/{activo.id}/etiqueta/?descargar=true")

    assert respuesta.status_code == 200
    assert "attachment" in respuesta["Content-Disposition"]
    assert activo.codigo_barras in respuesta["Content-Disposition"]


# --- Antigüedad (insumo de RF-07) ----------------------------------------


@pytest.mark.parametrize("meses_atras", [0, 1, 13, 48])
def test_la_antiguedad_cuenta_meses_de_calendario_cumplidos(admin, datos_activo, meses_atras):
    """Se fija el día 1 como fecha de compra: así ningún mes corto (febrero)
    desplaza el conteo, que es justo lo que la aritmética de días/30 hace mal."""
    from django.utils import timezone

    hoy = timezone.localdate()
    anio, mes = hoy.year, hoy.month - meses_atras
    while mes <= 0:
        mes += 12
        anio -= 1

    activo = ActivoService.crear_activo(
        actor=admin, **{**datos_activo, "fecha_adquisicion": datetime.date(anio, mes, 1)}
    )

    assert activo.antiguedad_meses == meses_atras


def test_un_activo_adquirido_hoy_tiene_cero_meses_de_antiguedad(admin, datos_activo):
    from django.utils import timezone

    activo = ActivoService.crear_activo(
        actor=admin, **{**datos_activo, "fecha_adquisicion": timezone.localdate()}
    )

    assert activo.antiguedad_meses == 0
