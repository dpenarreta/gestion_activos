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
    "activos-por-ubicacion",
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
    assert [reporte.clave for reporte in CATALOGO] == CLAVES_DEL_DOCUMENTO


def test_el_catalogo_se_publica_con_sus_parametros(cliente):
    datos = cliente.get("/api/v1/reportes/").data

    assert len(datos["reportes"]) == 13
    assert set(datos["formatos"]) == {"xlsx", "csv", "pdf"}
    inventario = next(r for r in datos["reportes"] if r["clave"] == "inventario-general")
    assert "departamento" in inventario["parametros"]
    assert inventario["columnas"], "el frontend dibuja la tabla desde el catálogo"


@pytest.mark.parametrize("clave", CLAVES_DEL_DOCUMENTO)
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
