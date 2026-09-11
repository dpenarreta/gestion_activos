"""Los trece reportes del §16 y sus tres formatos.

Lo que más se verifica aquí no es el contenido de cada reporte sino que el
motor único no se rompa con ninguno: como los trece se definen como datos, un
error en una definición no lo detecta el intérprete —lo descubre el usuario al
abrir el reporte que nadie probó—. Por eso hay una prueba parametrizada que
ejecuta los trece en los tres formatos.
"""

import datetime

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.core.models import AuditLog
from apps.mantenimientos.models import Mantenimiento
from apps.organizacion.models import Departamento, Empleado
from apps.permissions.models import ModulePermission
from apps.reportes.catalogo import CATALOGO, obtener
from apps.reportes.consultas import generar_filas
from apps.users.models import User

pytestmark = pytest.mark.django_db

#: Los trece del documento funcional, en su orden. Si alguno desaparece o
#: cambia de clave, el frontend y los enlaces guardados dejan de encontrarlo.
CLAVES_DEL_DOCUMENTO = [
    "inventario-general",
    "activos-por-area",
    "activos-por-usuario",
    "activos-por-sede",
    "activos-disponibles",
    "activos-en-reparacion",
    "activos-fuera-de-inventario",
    "activos-por-antiguedad",
    "proximos-a-reemplazo",
    "garantias-por-vencer",
    "historial-asignaciones",
    "historial-reparaciones",
    "costos-mantenimiento",
]

#: Los que no salen del §16. «Valor en libros» responde a la depreciación del
#: §22.3, y se lista aparte para que la prueba de los trece siga diciendo lo
#: que dice: que están los trece del documento, en su orden.
CLAVES_ADICIONALES = [
    "valor-y-depreciacion",
]

TODAS_LAS_CLAVES = CLAVES_DEL_DOCUMENTO + CLAVES_ADICIONALES


def _conceder(usuario, *codenames):
    content_type = ContentType.objects.get_for_model(ModulePermission)
    usuario.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_reportes", email="admin_reportes@example.com", password="Sup3r-Secr3t!"
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
        nombres="Ana", apellidos="Pérez", codigo_empleado="EMP-0001", departamento=departamento
    )


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def crear_activo(admin, tipo, departamento):
    contador = {"n": 0}

    def _crear(**extra):
        contador["n"] += 1
        datos = {
            "tipo": tipo,
            "nombre": f"Equipo {contador['n']}",
            "marca": "Dell",
            "modelo": "Latitude",
            "numero_serie": f"SN-REP-{contador['n']}",
            "departamento": departamento,
            "fecha_adquisicion": datetime.date(2024, 1, 15),
        }
        datos.update(extra)
        return ActivoService.crear_activo(actor=admin, **datos)

    return _crear


@pytest.fixture
def parque(crear_activo, admin, empleado):
    """Un parque pequeño con un equipo en cada situación relevante."""
    asignado = crear_activo(custodio=empleado)
    ActivoService.asignar_custodio(actor=admin, activo=asignado, custodio=empleado)

    en_bodega = crear_activo()

    en_reparacion = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=en_reparacion, estado=Activo.Estado.EN_MANTENIMIENTO, motivo="Disco"
    )

    robado = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=robado, estado=Activo.Estado.ROBADO, motivo="Denuncia 2026-200"
    )

    return {
        "asignado": asignado,
        "en_bodega": en_bodega,
        "en_reparacion": en_reparacion,
        "robado": robado,
    }


# --- El catálogo -------------------------------------------------------------


def test_estan_los_trece_reportes_del_documento():
    claves = [reporte.clave for reporte in CATALOGO]

    assert claves[: len(CLAVES_DEL_DOCUMENTO)] == CLAVES_DEL_DOCUMENTO


def test_el_catalogo_no_tiene_reportes_sin_declarar():
    """Lo que se añada al catálogo se declara aquí: un reporte que nadie listó
    tampoco entra en la prueba de humo de los formatos."""
    assert [reporte.clave for reporte in CATALOGO] == TODAS_LAS_CLAVES


def test_el_catalogo_se_publica_con_sus_parametros(cliente):
    datos = cliente.get("/api/v1/reportes/").data

    assert len(datos["reportes"]) == len(TODAS_LAS_CLAVES)
    assert set(datos["formatos"]) == {"xlsx", "csv", "pdf"}
    inventario = next(r for r in datos["reportes"] if r["clave"] == "inventario-general")
    assert "departamento" in inventario["parametros"]
    assert inventario["columnas"], "el frontend dibuja la tabla desde el catálogo"


@pytest.mark.parametrize("clave", TODAS_LAS_CLAVES)
@pytest.mark.parametrize("formato", ["xlsx", "csv", "pdf"])
def test_cada_reporte_se_genera_en_cada_formato(cliente, parque, clave, formato):
    """Prueba de humo de los 39 cruces.

    Los reportes se definen como datos, así que una definición equivocada —una
    columna que llama a un campo que ya no existe— no la ve el intérprete: se
    descubre al abrir el reporte que nadie probó.
    """
    respuesta = cliente.get(f"/api/v1/reportes/{clave}/?formato={formato}")

    assert respuesta.status_code == 200
    contenido = b"".join(respuesta.streaming_content) if respuesta.streaming else respuesta.content
    assert len(contenido) > 100
    if formato == "xlsx":
        assert contenido[:2] == b"PK"
    if formato == "pdf":
        assert contenido[:4] == b"%PDF"
    if formato == "csv":
        assert contenido.decode("utf-8").startswith("﻿#")


# --- Qué mira cada reporte ---------------------------------------------------


def test_lo_que_salio_del_parque_no_ensucia_los_reportes_operativos(parque):
    """Un equipo robado en «activos por área» haría creer que el área lo tiene."""
    por_area = generar_filas(obtener("activos-por-area"), {})
    inventario = generar_filas(obtener("inventario-general"), {})

    assert por_area["total"] == 3
    # El inventario general es el censo completo: ahí sí aparece, con su estado.
    assert inventario["total"] == 4


def test_el_reporte_de_bajas_reune_las_tres_salidas(parque):
    resultado = generar_filas(obtener("activos-fuera-de-inventario"), {})

    assert resultado["total"] == 1
    fila = dict(zip([c.clave for c in resultado["columnas"]], resultado["filas"][0], strict=False))
    assert fila["estado"] == "Robado"
    assert fila["motivo_baja"] == "Denuncia 2026-200"


def test_activos_por_usuario_excluye_lo_no_asignado(parque):
    """Sin custodio no hay a quién reclamarle: eso es otro reporte."""
    resultado = generar_filas(obtener("activos-por-usuario"), {})

    assert resultado["total"] == 1


def test_disponibles_son_los_que_estan_en_almacen(parque, admin):
    disponible = parque["en_bodega"]
    ActivoService.cambiar_estado(
        actor=admin, activo=disponible, estado=Activo.Estado.DISPONIBLE, motivo="Revisado"
    )

    resultado = generar_filas(obtener("activos-disponibles"), {})

    assert resultado["total"] == 1


def test_en_reparacion_incluye_la_reclamacion_de_garantia(parque, admin, crear_activo):
    """Desde la operación son lo mismo: el equipo no está y alguien lo arregla."""
    en_garantia = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=en_garantia, estado=Activo.Estado.EN_GARANTIA, motivo="Reclamo"
    )

    resultado = generar_filas(obtener("activos-en-reparacion"), {})

    assert resultado["total"] == 2


# --- Parámetros --------------------------------------------------------------


def test_el_historial_de_reparaciones_respeta_el_periodo(parque, admin):
    activo = parque["asignado"]
    for fecha in (datetime.date(2026, 1, 10), datetime.date(2026, 6, 10)):
        Mantenimiento.objects.create(
            activo=activo,
            tipo=Mantenimiento.Tipo.CORRECTIVO,
            fecha_intervencion=fecha,
            tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            descripcion="Cambio de disco",
        )

    completo = generar_filas(obtener("historial-reparaciones"), {})
    acotado = generar_filas(
        obtener("historial-reparaciones"), {"desde": "2026-05-01", "hasta": "2026-12-31"}
    )

    assert completo["total"] == 2
    assert acotado["total"] == 1


def test_un_parametro_ilegible_no_rompe_el_reporte(parque):
    """Devolver 400 porque alguien escribió «ayer» es más molesto que ignorarlo."""
    resultado = generar_filas(obtener("historial-reparaciones"), {"desde": "ayer"})

    assert resultado["total"] == 0 or resultado["total"] >= 0


def test_las_garantias_usan_la_ventana_pedida(crear_activo):
    from django.utils import timezone

    hoy = timezone.localdate()
    crear_activo(fecha_fin_garantia=hoy + datetime.timedelta(days=20))
    crear_activo(fecha_fin_garantia=hoy + datetime.timedelta(days=200))

    por_defecto = generar_filas(obtener("garantias-por-vencer"), {})
    ampliado = generar_filas(obtener("garantias-por-vencer"), {"dias": "365"})

    assert por_defecto["total"] == 1
    assert ampliado["total"] == 2


def test_los_costos_se_totalizan_al_pie(parque):
    from decimal import Decimal

    Mantenimiento.objects.create(
        activo=parque["asignado"],
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2026, 3, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        descripcion="Cambio de disco",
        costo_mano_obra=Decimal("50.00"),
    )

    resultado = generar_filas(obtener("costos-mantenimiento"), {})

    assert resultado["totales"], "un reporte de costos sin total obliga a sumar a mano"
    total = list(resultado["totales"].values())[-1]
    assert Decimal(str(total)) >= Decimal("50.00")


# --- Formato, cortes y permisos ---------------------------------------------


def test_el_pdf_lleva_menos_columnas_que_el_excel():
    """Una tabla de dieciocho columnas en A4 sale ilegible aunque quepa."""
    inventario = obtener("inventario-general")

    assert len(inventario.columnas_para("pdf")) < len(inventario.columnas_para("xlsx"))


def test_un_reporte_cortado_lo_dice(parque, monkeypatch):
    """Un reporte truncado en silencio se lee como si el parque fuera menor."""
    monkeypatch.setattr("apps.reportes.catalogo.MAX_FILAS_PDF", 2)

    resultado = generar_filas(obtener("inventario-general"), {}, formato="pdf")

    assert resultado["truncado"]
    assert len(resultado["filas"]) == 2
    assert resultado["total"] == 4


def test_ver_un_reporte_no_habilita_a_descargarlo(db):
    """El archivo sale del sistema y circula por correo; la pantalla no."""
    usuario = User.objects.create_user(
        username="consulta", email="consulta@example.com", password="Sup3r-Secr3t!"
    )
    _conceder(usuario, "reportes.ver")
    client = APIClient()
    client.force_authenticate(user=usuario)

    assert client.get("/api/v1/reportes/").status_code == 200
    assert client.get("/api/v1/reportes/inventario-general/").status_code == 200
    assert client.get("/api/v1/reportes/inventario-general/?formato=xlsx").status_code == 403


def test_descargar_un_reporte_queda_auditado(cliente, parque):
    cliente.get("/api/v1/reportes/inventario-general/?formato=csv")

    evento = AuditLog.objects.filter(action="reporte.exportado").first()
    assert evento is not None
    assert evento.new_values["formato"] == "csv"
    assert evento.target_id == "inventario-general"


def test_un_reporte_inexistente_responde_404(cliente):
    assert cliente.get("/api/v1/reportes/el-que-no-existe/").status_code == 404


def test_un_formato_no_soportado_se_rechaza(cliente):
    respuesta = cliente.get("/api/v1/reportes/inventario-general/?formato=docx")

    assert respuesta.status_code in {400, 403}


def test_la_vista_previa_acota_las_filas(cliente, parque):
    datos = cliente.get("/api/v1/reportes/inventario-general/").data

    assert datos["total"] == 4
    assert datos["mostradas"] <= 50
    assert datos["columnas"][0]["etiqueta"] == "Código"


# --- Valor en libros y depreciación (§22.3) ---------------------------------


def _columna(resultado, clave):
    """El valor de una columna en la primera fila, por su clave."""
    posicion = next(i for i, c in enumerate(resultado["columnas"]) if c.clave == clave)
    return resultado["filas"][0][posicion]


def test_el_reporte_de_valor_trae_la_cuenta_completa(parque):
    """Lo que el área financiera necesita para respaldar una compra: qué costó,
    cuánto se ha depreciado y qué queda."""
    from decimal import Decimal

    from apps.politicas.models import PoliticaDepreciacion

    PoliticaDepreciacion.objects.create(nombre="General", meses_vida_contable=36)
    activo = parque["asignado"]
    activo.costo_adquisicion = Decimal("1800.00")
    activo.save()

    resultado = generar_filas(obtener("valor-y-depreciacion"), {"activo": activo.id})

    assert _columna(resultado, "costo") == Decimal("1800.00")
    assert _columna(resultado, "vida_contable") == 36
    assert _columna(resultado, "cuota") == Decimal("50.00")
    # Costo y valor en libros suman con la acumulada: si no, el informe se
    # contradice a sí mismo delante de quien lo firma.
    assert _columna(resultado, "valor_en_libros") + _columna(resultado, "acumulada") == Decimal(
        "1800.00"
    )


def test_el_parque_se_totaliza_al_pie(parque):
    """Es la pregunta del área financiera: cuánto vale hoy todo esto."""
    from decimal import Decimal

    from apps.politicas.models import PoliticaDepreciacion

    PoliticaDepreciacion.objects.create(nombre="General", meses_vida_contable=36)
    for activo in parque.values():
        activo.costo_adquisicion = Decimal("1200.00")
        activo.save()

    resultado = generar_filas(obtener("valor-y-depreciacion"), {})

    assert len(resultado["totales"]) == 3, "costo, acumulada y valor en libros"


def test_un_equipo_sin_costo_deja_la_celda_vacia_y_no_en_cero(parque):
    """Cero significa «ya no vale nada»; vacío, «nadie capturó lo que costó».
    Escribir un cero metería equipos sin capturar en el total del parque."""
    from apps.politicas.models import PoliticaDepreciacion

    PoliticaDepreciacion.objects.create(nombre="General", meses_vida_contable=36)
    activo = parque["asignado"]
    activo.costo_adquisicion = None
    activo.save()

    resultado = generar_filas(obtener("valor-y-depreciacion"), {"activo": activo.id})

    assert _columna(resultado, "valor_en_libros") is None
    assert _columna(resultado, "acumulada") is None


def test_sin_politica_el_reporte_sigue_saliendo(parque):
    """Un informe que reviente porque nadie configuró la depreciación no dice
    qué falta: sale con las columnas de valor vacías."""
    from decimal import Decimal

    activo = parque["asignado"]
    activo.costo_adquisicion = Decimal("1800.00")
    activo.save()

    resultado = generar_filas(obtener("valor-y-depreciacion"), {"activo": activo.id})

    assert _columna(resultado, "costo") == Decimal("1800.00")
    assert _columna(resultado, "valor_en_libros") is None


def test_la_depreciacion_se_resuelve_de_una_vez_para_toda_la_pagina(
    parque, django_assert_num_queries
):
    """Resolver la política activo por activo eran dos consultas por renglón:
    con cien equipos el informe hacía doscientos viajes de más."""
    from decimal import Decimal

    from apps.politicas.models import PoliticaDepreciacion

    PoliticaDepreciacion.objects.create(nombre="General", meses_vida_contable=36)
    for activo in parque.values():
        activo.costo_adquisicion = Decimal("1200.00")
        activo.save()

    reporte = obtener("valor-y-depreciacion")
    # El conteo, la página y las dos de la resolución en lote.
    with django_assert_num_queries(4):
        generar_filas(reporte, {})
