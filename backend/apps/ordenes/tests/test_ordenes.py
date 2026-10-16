"""Mantenimiento de sedes: órdenes de trabajo.

Lo que se protege: que cada perfil vea solo su recorte (el técnico lo suyo,
quien responde por la sede su sede, quien pide lo que pidió), que cada paso lo
dé quien corresponde, que el teléfono salga enmascarado a quien no lo necesita
y que los números del panel cuadren con el listado.
"""

import datetime
from decimal import Decimal

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.ordenes.models import OrdenTrabajo
from apps.organizacion.models import Proveedor, Sede
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ordenes/"


def _cuenta(nombre, *permisos):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=[f"ordenes.{p}" for p in permisos],
        )
    )
    MembresiaEmpresa.objects.get_or_create(
        usuario=usuario, empresa=Empresa.objects.get(codigo="EMP")
    )
    return usuario


def _campos_con_error(respuesta):
    return set(respuesta.data["error"]["details"])


def _cliente(usuario):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.fixture
def escenario(db):
    """Pide `db` a propósito: es lo que activa la empresa de pruebas del
    `conftest` raíz, y sin ella las sedes nacerían sin empresa."""
    quito = Sede.objects.create(
        nombre="Quito · Matriz", ciudad="Quito", region="sierra", provincia="Pichincha"
    )
    manta = Sede.objects.create(
        nombre="Manta · Bodega", ciudad="Manta", region="costa", provincia="Manabí"
    )
    coordinador = _cuenta(
        "marco", "ver", "ver_todas", "crear", "gestionar", "ver_contacto", "reportes"
    )
    tecnico = _cuenta("jorge", "ver", "ejecutar")
    responsable = _cuenta("paola", "ver", "crear", "aceptar")
    solicitante = _cuenta("esteban", "ver", "crear")
    quito.responsables.add(responsable)
    return {
        "quito": quito,
        "manta": manta,
        "coordinador": coordinador,
        "tecnico": tecnico,
        "responsable": responsable,
        "solicitante": solicitante,
    }


def _crear(cliente, sede, **extra):
    datos = {
        "sede": sede.id,
        "categoria": "electrico",
        "prioridad": "alta",
        "titulo": "Sin luz en el área de cajas",
        "telefono_contacto": "099 418 2273",
        **extra,
    }
    respuesta = cliente.post(BASE, datos, format="json")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.data


def test_la_orden_nace_numerada_por_anio_y_solicitada(escenario):
    cliente = _cliente(escenario["solicitante"])
    primera = _crear(cliente, escenario["quito"])
    segunda = _crear(cliente, escenario["manta"])
    anio = timezone.localdate().year
    assert primera["numero"] == f"OT-{anio}-000001"
    assert segunda["numero"] == f"OT-{anio}-000002"
    assert primera["estado"] == "solicitada"
    assert primera["movimientos"][0]["descripcion"].startswith("Solicitó la orden")


def test_cada_perfil_ve_su_recorte(escenario):
    e = escenario
    de_quito = _crear(_cliente(e["solicitante"]), e["quito"])
    de_manta = _crear(_cliente(e["coordinador"]), e["manta"])
    _cliente(e["coordinador"]).post(
        f"{BASE}{de_manta['id']}/asignar/", {"tecnico": e["tecnico"].id}, format="json"
    )

    def numeros(usuario):
        return {o["numero"] for o in _cliente(usuario).get(BASE).data["results"]}

    assert numeros(e["coordinador"]) == {de_quito["numero"], de_manta["numero"]}
    assert numeros(e["solicitante"]) == {de_quito["numero"]}
    assert numeros(e["responsable"]) == {de_quito["numero"]}  # su sede
    assert numeros(e["tecnico"]) == {de_manta["numero"]}  # lo asignado
    # Lo ajeno da 404, no 403: quien no participa no tiene por qué saber que existe.
    assert _cliente(e["tecnico"]).get(f"{BASE}{de_quito['id']}/").status_code == 404


def test_el_telefono_sale_enmascarado_sin_ver_contacto(escenario):
    e = escenario
    orden = _crear(_cliente(e["solicitante"]), e["quito"])
    assert _cliente(e["responsable"]).get(f"{BASE}{orden['id']}/").data["contacto"] == "•••••••273"
    assert (
        _cliente(e["coordinador"]).get(f"{BASE}{orden['id']}/").data["contacto"] == "099 418 2273"
    )


def test_flujo_completo_con_quien_corresponde_en_cada_paso(escenario):
    e = escenario
    orden = _crear(_cliente(e["solicitante"]), e["quito"])
    url = f"{BASE}{orden['id']}/"
    tecnico, responsable, coordinador = (
        _cliente(e["tecnico"]),
        _cliente(e["responsable"]),
        _cliente(e["coordinador"]),
    )

    # Asignar es de quien coordina.
    assert (
        tecnico.post(f"{url}asignar/", {"tecnico": e["tecnico"].id}, format="json").status_code
        == 404
    )
    proveedor = Proveedor.objects.create(nombre="Climas del Sur")
    r = coordinador.post(
        f"{url}asignar/",
        {"tecnico": e["tecnico"].id, "proveedor": proveedor.id, "fecha_programada": "2026-12-01"},
        format="json",
    )
    assert r.status_code == 200, r.data
    assert r.data["estado"] == "programada"
    assert r.data["responsable"] == "Jorge (Climas del Sur)"

    # El técnico ve qué puede hacer y lo hace.
    detalle = tecnico.get(url).data
    assert detalle["permisos"]["acciones"] == ["en_ejecucion"]
    assert (
        tecnico.post(f"{url}cambiar-estado/", {"estado": "en_ejecucion"}, format="json").status_code
        == 200
    )

    # Pausar exige motivo.
    r = tecnico.post(f"{url}cambiar-estado/", {"estado": "pausada"}, format="json")
    assert r.status_code == 400 and "nota" in _campos_con_error(r)

    # Materiales y horas: total con IVA.
    tecnico.post(
        f"{url}materiales/",
        {"descripcion": "Breaker 20 A", "cantidad": "2", "costo_unitario": "15.50"},
        format="json",
    )
    r = tecnico.post(
        f"{url}mano-de-obra/",
        {"descripcion": "Revisión del tablero", "horas": "2.5", "costo_hora": "20"},
        format="json",
    )
    assert r.status_code == 201
    assert r.data["costos"]["subtotal"] == "81.00"
    assert r.data["costos"]["iva"] == "12.15"
    assert r.data["costos"]["total"] == "93.15"

    assert (
        tecnico.post(
            f"{url}cambiar-estado/", {"estado": "pendiente_aprobacion"}, format="json"
        ).status_code
        == 200
    )

    # Cerrar no es del técnico: es de quien responde por la sede.
    assert (
        tecnico.post(f"{url}cambiar-estado/", {"estado": "cerrada"}, format="json").status_code
        == 403
    )
    # Devolver exige motivo.
    assert (
        responsable.post(
            f"{url}cambiar-estado/", {"estado": "en_ejecucion"}, format="json"
        ).status_code
        == 400
    )
    r = responsable.post(
        f"{url}cambiar-estado/",
        {"estado": "cerrada", "con_observaciones": True, "nota": "Quedó una mancha en el techo."},
        format="json",
    )
    assert r.status_code == 200, r.data
    assert r.data["estado"] == "cerrada"
    assert r.data["con_observaciones"] is True
    assert r.data["cumplimiento"] == "cerrada"
    assert r.data["movimientos"][-1]["descripcion"].startswith("Aceptó con observaciones")

    # Cerrada, ya no se mueve ni cambia de costo.
    assert (
        coordinador.post(
            f"{url}cambiar-estado/", {"estado": "en_ejecucion"}, format="json"
        ).status_code
        == 400
    )
    assert (
        tecnico.post(
            f"{url}materiales/",
            {"descripcion": "x", "cantidad": "1", "costo_unitario": "1"},
            format="json",
        ).status_code
        == 400
    )
    # Y todo quedó en la bitácora del sistema.
    acciones = set(AuditLog.objects.filter(module="ordenes").values_list("action", flat=True))
    assert {"orden.created", "orden.asignada", "orden.estado_changed", "orden.material"} <= acciones


def test_responsable_de_otra_sede_no_acepta(escenario):
    e = escenario
    orden = _crear(_cliente(e["coordinador"]), e["manta"])
    with usando_empresa(Empresa.objects.get(codigo="EMP")):
        OrdenTrabajo.objects.filter(pk=orden["id"]).update(estado="pendiente_aprobacion")
    # Paola responde por Quito, no por Manta: ni la ve.
    r = _cliente(e["responsable"]).post(
        f"{BASE}{orden['id']}/cambiar-estado/", {"estado": "cerrada"}, format="json"
    )
    assert r.status_code == 404


def test_quien_pide_corrige_solo_mientras_nadie_la_tomo(escenario):
    e = escenario
    orden = _crear(_cliente(e["solicitante"]), e["quito"])
    url = f"{BASE}{orden['id']}/"
    assert (
        _cliente(e["solicitante"])
        .patch(url, {"titulo": "Sin luz en cajas y bodega"}, format="json")
        .status_code
        == 200
    )
    _cliente(e["coordinador"]).post(f"{url}asignar/", {"tecnico": e["tecnico"].id}, format="json")
    assert (
        _cliente(e["solicitante"]).patch(url, {"titulo": "Otra cosa"}, format="json").status_code
        == 403
    )


def test_solo_se_asigna_a_quien_puede_ejecutar(escenario):
    e = escenario
    orden = _crear(_cliente(e["solicitante"]), e["quito"])
    r = _cliente(e["coordinador"]).post(
        f"{BASE}{orden['id']}/asignar/", {"tecnico": e["solicitante"].id}, format="json"
    )
    assert r.status_code == 400 and "tecnico" in _campos_con_error(r)
    catalogos = _cliente(e["coordinador"]).get(f"{BASE}catalogos/").data
    assert [t["nombre"] for t in catalogos["tecnicos"]] == ["Jorge"]


def test_el_panel_cuenta_lo_mismo_que_el_listado(escenario):
    e = escenario
    cliente = _cliente(e["coordinador"])
    vencida = _crear(cliente, e["quito"], prioridad="media")
    cliente.post(
        f"{BASE}{vencida['id']}/asignar/",
        {
            "tecnico": e["tecnico"].id,
            "fecha_programada": (timezone.localdate() - datetime.timedelta(days=3)).isoformat(),
        },
        format="json",
    )
    _crear(cliente, e["manta"], prioridad="critica")
    _crear(cliente, e["manta"], prioridad="baja")

    datos = cliente.get(f"{BASE}resumen/").data
    assert datos["kpis"]["registradas"] == 3
    assert datos["kpis"]["abiertas"] == 3
    assert datos["kpis"]["vencidas"] == 1
    assert datos["kpis"]["prioridad_alta"] == 1
    # Requieren atención: la crítica y la vencida, no la baja al día.
    assert {o["prioridad"] for o in datos["atencion"]} == {"critica", "media"}
    assert datos["alcance"] == "Todas las sedes de la empresa."

    # El técnico solo cuenta lo suyo.
    assert _cliente(e["tecnico"]).get(f"{BASE}resumen/").data["kpis"]["registradas"] == 1


def test_reportes_filtran_y_exportan_auditando(escenario):
    e = escenario
    cliente = _cliente(e["coordinador"])
    _crear(cliente, e["quito"])
    _crear(cliente, e["manta"], categoria="climatizacion")

    datos = cliente.get(f"{BASE}reportes/", {"region": "costa"}).data
    assert datos["kpis"]["registradas"] == 1
    por_region = next(g for g in datos["graficos"] if g["clave"] == "region")
    assert {f["etiqueta"]: f["valor"] for f in por_region["filas"]}["Costa"] == 1

    r = cliente.get(f"{BASE}exportar/", {"formato": "xlsx"})
    assert r.status_code == 200
    assert r["Content-Disposition"].endswith('.xlsx"')
    assert AuditLog.objects.filter(module="ordenes", action="reporte.exportado").exists()
    assert cliente.get(f"{BASE}exportar/", {"formato": "pdf"}).status_code == 200

    # Sin el permiso de reportes, nada.
    assert _cliente(e["tecnico"]).get(f"{BASE}reportes/").status_code == 403


def test_una_orden_no_se_borra(escenario):
    orden = _crear(_cliente(escenario["coordinador"]), escenario["quito"])
    assert _cliente(escenario["coordinador"]).delete(f"{BASE}{orden['id']}/").status_code == 405


def test_el_costo_incluye_el_iva_configurado(escenario, settings):
    settings.ORDENES_IVA_PORCENTAJE = 12
    e = escenario
    orden = _crear(_cliente(e["coordinador"]), e["quito"])
    cliente = _cliente(e["coordinador"])
    r = cliente.post(
        f"{BASE}{orden['id']}/materiales/",
        {"descripcion": "Cable", "cantidad": "1", "costo_unitario": "100"},
        format="json",
    )
    assert Decimal(r.data["costos"]["total"]) == Decimal("112.00")
