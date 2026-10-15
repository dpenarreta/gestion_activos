"""Matriz de obligaciones, fase 2: obligaciones, períodos, estados y la matriz.

Cobertura de tests/qa/features/matriz-obligaciones.feature (AC-MTZ-011 a
AC-MTZ-024). Sigue las pruebas mínimas de la especificación (§23): las cinco
reglas de estado —incluido «vence hoy» pendiente de validación y el cálculo en
una zona horaria distinta a la del servidor—, el alcance propio, el 404 sin
membresía, el alta con su primer período y el seguimiento.
"""

import datetime
import zoneinfo

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.matriz import estados, fechas
from apps.matriz.models import Area, EntidadControl, Obligacion, Periodo
from apps.users.models import User

pytestmark = pytest.mark.django_db

GYE = zoneinfo.ZoneInfo("America/Guayaquil")


# --- Escenario -----------------------------------------------------------------


def _cuenta(nombre, **extra):
    return User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        first_name=extra.get("nombre", nombre.capitalize()),
    )


def _rol(nombre):
    return Group.objects.get(name=f"Matriz · {nombre}")


def _miembro(usuario, empresa, *roles):
    membresia = MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    membresia.roles.set(roles)
    return membresia


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


@pytest.fixture
def courier():
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad():
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


@pytest.fixture
def gente(courier, seguridad):
    admin = _cuenta("admin")
    ana = _cuenta("ana")
    beto = _cuenta("beto")
    supervisor = _cuenta("sara")
    _miembro(admin, courier, _rol("Administrador"))
    _miembro(ana, courier, _rol("Responsable"))
    _miembro(beto, courier, _rol("Responsable"))
    _miembro(supervisor, courier, _rol("Supervisor/Aprobador"))
    _miembro(_cuenta("otra"), seguridad, _rol("Administrador"))
    return {"admin": admin, "ana": ana, "beto": beto, "sara": supervisor}


def _alta(cliente, **datos):
    base = {
        "nombre": "Declaración de IVA",
        "area": Area.objects.get(codigo="CONT").id,
        "entidad": EntidadControl.objects.get(codigo="SRI").id,
        "tipo": "regulatoria",
        "periodicidad": "mensual",
        "evidencia_esperada": "Formulario 104 y comprobante de pago",
        "fecha_vencimiento": "2026-10-28",
    }
    base.update(datos)
    return cliente.post("/api/v1/matriz/obligaciones/", base, format="json")


class _P:
    """Un período mínimo para el motor de estados, sin base de datos."""

    def __init__(
        self, vence, cerrado=False, cumplido=None, etapa="sin_iniciar", zona="America/Guayaquil"
    ):
        self.vence_en = vence
        self.cerrado = cerrado
        self.cumplido_en = cumplido
        self.validado_en = cumplido
        self.etapa = etapa
        self.empresa = type("E", (), {"zona_horaria": zona})()


def _local(texto, zona=GYE):
    return datetime.datetime.fromisoformat(texto).replace(tzinfo=zona)


# --- Motor de estados (§9) --------------------------------------------------------


def test_cerrado_a_tiempo_es_finalizado():
    p = _P(_local("2026-10-28 17:00"), cerrado=True, cumplido=_local("2026-10-27 10:00"))
    assert estados.estado(p, _local("2026-11-02 09:00"))["label"] == "Finalizado"


def test_cerrado_tarde_conserva_el_atraso():
    p = _P(_local("2026-10-28 17:00"), cerrado=True, cumplido=_local("2026-10-30 09:00"))
    e = estados.estado(p, _local("2026-11-02 09:00"))
    assert e["label"] == "Finalizada fuera de plazo"
    assert e["is_late"] and e["days_overdue"] == 2


def test_abierto_y_vencido_es_incumplido_justo_despues_de_la_hora():
    p = _P(_local("2026-10-28 17:00"))
    assert estados.estado(p, _local("2026-10-28 16:59"))["group"] == "en_progreso"
    e = estados.estado(p, _local("2026-10-28 17:01"))
    assert e["group"] == "incumplido" and e["days_overdue"] == 1


def test_vence_hoy_es_una_marca_y_no_borra_la_etapa():
    """El defecto del prototipo original: «vence hoy» reemplazaba a «pendiente
    de validación» y desaparecía el botón de validar."""
    p = _P(_local("2026-10-28 17:00"), etapa="pendiente_validacion")
    e = estados.estado(p, _local("2026-10-28 08:00"))
    assert e["label"] == "Vence hoy"
    assert e["is_due_today"] and e["stage"] == "pendiente_validacion"


def test_dentro_del_plazo_muestra_la_etapa_y_los_dias():
    p = _P(_local("2026-10-28 17:00"), etapa="en_preparacion")
    e = estados.estado(p, _local("2026-10-25 23:00"))
    assert e["label"] == "En preparación" and e["days_remaining"] == 3


def test_el_dia_se_cuenta_en_la_zona_de_la_empresa_no_en_la_del_servidor():
    """A las 20:00 de Guayaquil ya es el día siguiente en Tokio: para una
    empresa en Tokio, algo que vence mañana a las 17:00 de Tokio vence hoy."""
    tokio = zoneinfo.ZoneInfo("Asia/Tokyo")
    vence = datetime.datetime(2026, 10, 29, 17, 0, tzinfo=tokio)
    ahora = _local("2026-10-28 20:00")  # 29/10 10:00 en Tokio
    assert estados.estado(_P(vence, zona="Asia/Tokyo"), ahora)["label"] == "Vence hoy"
    assert estados.estado(_P(vence), ahora)["label"] != "Vence hoy"


# --- Fechas (§11.3) ----------------------------------------------------------------


def test_etiquetas_por_periodicidad():
    dia = datetime.date(2026, 10, 28)
    assert fechas.etiqueta("mensual", dia) == "Octubre 2026"
    assert fechas.etiqueta("trimestral", dia) == "T4 2026"
    assert fechas.etiqueta("semestral", dia) == "S2 2026"
    assert fechas.etiqueta("anual", dia) == "Período 2026"
    assert fechas.etiqueta("unica", dia) == "Período único"


def test_el_siguiente_vencimiento_respeta_el_fin_de_mes():
    plantilla = Obligacion(periodicidad="mensual", dia_vencimiento=31)
    assert fechas.siguiente_vencimiento(plantilla, datetime.date(2026, 1, 31)) == datetime.date(
        2026, 2, 28
    )
    trimestral = Obligacion(periodicidad="trimestral", dia_vencimiento=31)
    assert fechas.siguiente_vencimiento(trimestral, datetime.date(2026, 1, 31)) == datetime.date(
        2026, 4, 30
    )
    assert (
        fechas.siguiente_vencimiento(Obligacion(periodicidad="unica"), datetime.date.today())
        is None
    )


def test_el_primer_vencimiento_sale_de_la_regla():
    hoy = datetime.date(2026, 10, 20)
    assert fechas.primer_vencimiento(
        Obligacion(periodicidad="mensual", dia_vencimiento=28), hoy
    ) == datetime.date(2026, 10, 28)
    assert fechas.primer_vencimiento(
        Obligacion(periodicidad="mensual", dia_vencimiento=10), hoy
    ) == datetime.date(2026, 11, 10)
    assert fechas.primer_vencimiento(
        Obligacion(periodicidad="anual", dia_vencimiento=31, mes_vencimiento=3), hoy
    ) == datetime.date(2027, 3, 31)
    assert fechas.primer_vencimiento(Obligacion(periodicidad="unica"), hoy) == datetime.date(
        2026, 11, 19
    )


# --- Alta de obligación (§11.1) -------------------------------------------------------


def test_el_alta_crea_la_obligacion_y_su_primer_periodo(courier, gente):
    courier.gerente_general = gente["sara"]
    courier.save()

    respuesta = _alta(_cliente(gente["admin"], courier), responsable=gente["ana"].id)

    assert respuesta.status_code == 201, respuesta.data
    periodo = Periodo.objects.todas().get(pk=respuesta.data["id"])
    assert periodo.codigo == "OBL-0001"
    assert periodo.etiqueta == "Octubre 2026"
    assert periodo.fecha_inicio == datetime.date(2026, 9, 28)
    assert periodo.fecha_preparacion == datetime.date(2026, 10, 23)
    assert periodo.vence_en.astimezone(GYE) == _local("2026-10-28 17:00")
    assert periodo.aprobador == gente["sara"]
    assert respuesta.data["estado"]["group"] in ("en_progreso", "incumplido")
    assert AuditLog.objects.filter(action="obligation.created").exists()
    historial = (
        _cliente(gente["admin"], courier)
        .get(f"/api/v1/matriz/periodos/{periodo.id}/historial/")
        .data
    )
    assert historial[0]["descripcion"] == "Obligación creada"


def test_los_codigos_son_correlativos(courier, gente):
    cliente = _cliente(gente["admin"], courier)
    _alta(cliente, responsable=gente["ana"].id)
    segundo = _alta(cliente, nombre="Aportes al IESS", responsable=gente["ana"].id)

    assert segundo.data["codigo"] == "OBL-0002"


def test_el_nombre_no_se_repite_en_la_empresa_sin_distinguir_mayusculas(courier, gente):
    cliente = _cliente(gente["admin"], courier)
    _alta(cliente, responsable=gente["ana"].id)

    repetida = _alta(cliente, nombre="declaración de iva", responsable=gente["ana"].id)

    assert repetida.status_code == 400
    assert "Ya existe una obligación con ese nombre" in str(repetida.data)


def test_el_responsable_debe_trabajar_en_la_empresa(courier, seguridad, gente):
    ajeno = User.objects.get(username="otra")

    respuesta = _alta(_cliente(gente["admin"], courier), responsable=ajeno.id)

    assert respuesta.status_code == 400
    assert "no trabaja en" in str(respuesta.data)


def test_sin_permiso_de_crear_es_403_y_queda_auditado(courier, gente):
    respuesta = _alta(_cliente(gente["sara"], courier), responsable=gente["ana"].id)

    assert respuesta.status_code == 403
    assert AuditLog.objects.filter(
        action="access_denied", new_values__required_permission="matriz.crear"
    ).exists()


def test_quien_no_ve_toda_la_empresa_crea_solo_en_sus_areas(courier, gente):
    """§8.7: con `crear`, sin `ver_todas` y con áreas en la membresía."""
    membresia = MembresiaEmpresa.objects.get(usuario=gente["ana"], empresa=courier)
    Area.objects.get(codigo="TH").membresias.add(membresia)
    cliente = _cliente(gente["ana"], courier)

    fuera = _alta(cliente, responsable=gente["ana"].id)  # Contabilidad
    dentro = _alta(
        cliente,
        nombre="Décimo tercer sueldo",
        area=Area.objects.get(codigo="TH").id,
        responsable=gente["ana"].id,
    )

    assert fuera.status_code == 400 and "sus áreas" in str(fuera.data)
    assert dentro.status_code == 201, dentro.data


# --- Alcance y 404 (§8) ---------------------------------------------------------------


def test_sin_ver_todas_solo_ve_lo_suyo_y_lo_ajeno_es_404(courier, gente):
    admin = _cliente(gente["admin"], courier)
    de_ana = _alta(admin, responsable=gente["ana"].id).data["id"]
    de_beto = _alta(admin, nombre="Aportes al IESS", responsable=gente["beto"].id).data["id"]
    ana = _cliente(gente["ana"], courier)

    codigos = [p["id"] for p in ana.get("/api/v1/matriz/periodos/").data["results"]]

    assert codigos == [de_ana]
    assert ana.get(f"/api/v1/matriz/periodos/{de_beto}/").status_code == 404
    # El suplente también lo ve como suyo.
    admin.patch(f"/api/v1/matriz/periodos/{de_beto}/", {"suplente": gente["ana"].id}, format="json")
    assert ana.get(f"/api/v1/matriz/periodos/{de_beto}/").status_code == 200


def test_sin_rol_de_la_matriz_en_la_empresa_todo_es_404(courier, seguridad, gente):
    """§8.4: no se confirma que exista nada."""
    periodo = _alta(_cliente(gente["admin"], courier), responsable=gente["ana"].id).data["id"]
    otra = User.objects.get(username="otra")
    sin_rol = _cuenta("sinrol")
    _miembro(sin_rol, courier)

    assert _cliente(otra, courier).get(f"/api/v1/matriz/periodos/{periodo}/").status_code == 404
    assert _cliente(sin_rol, courier).get("/api/v1/matriz/periodos/").status_code == 404
    # Y desde la otra empresa, el período no existe.
    assert _cliente(otra, seguridad).get(f"/api/v1/matriz/periodos/{periodo}/").status_code == 404


def test_el_detalle_ofrece_solo_las_acciones_permitidas(courier, gente):
    admin = _cliente(gente["admin"], courier)
    periodo = _alta(admin, responsable=gente["ana"].id).data["id"]

    assert "edit" in admin.get(f"/api/v1/matriz/periodos/{periodo}/").data["acciones"]
    auditor = _cuenta("audi")
    _miembro(auditor, courier, _rol("Auditor"))
    assert (
        _cliente(auditor, courier).get(f"/api/v1/matriz/periodos/{periodo}/").data["acciones"] == []
    )


# --- Seguimiento (§10) ----------------------------------------------------------------


def test_editar_el_seguimiento_deja_un_evento_por_campo(courier, gente):
    admin = _cliente(gente["admin"], courier)
    periodo = _alta(admin, responsable=gente["ana"].id).data["id"]

    respuesta = admin.patch(
        f"/api/v1/matriz/periodos/{periodo}/",
        {"responsable": gente["beto"].id, "avance": 40, "prioridad": "media"},
        format="json",
    )

    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.data["avance"] == 40
    historial = admin.get(f"/api/v1/matriz/periodos/{periodo}/historial/").data
    descripciones = [e["descripcion"] for e in historial]
    assert "Cambio de responsable" in descripciones
    assert "Cambio de avance" in descripciones
    # La prioridad no cambió: no deja evento.
    assert "Cambio de prioridad" not in descripciones
    cambio = next(e for e in historial if e["descripcion"] == "Cambio de responsable")
    assert (cambio["valor_anterior"], cambio["valor_nuevo"]) == ("Ana", "Beto")


def test_un_periodo_cerrado_no_se_edita(courier, gente):
    admin = _cliente(gente["admin"], courier)
    periodo = _alta(admin, responsable=gente["ana"].id).data["id"]
    Periodo.objects.todas().filter(pk=periodo).update(cerrado=True)

    respuesta = admin.patch(f"/api/v1/matriz/periodos/{periodo}/", {"avance": 10}, format="json")

    assert respuesta.status_code == 400
    assert "cerrado no se puede editar" in str(respuesta.data)


def test_el_responsable_no_se_puede_quitar(courier, gente):
    admin = _cliente(gente["admin"], courier)
    periodo = _alta(admin, responsable=gente["ana"].id).data["id"]

    respuesta = admin.patch(
        f"/api/v1/matriz/periodos/{periodo}/", {"responsable": None}, format="json"
    )

    assert respuesta.status_code == 400


# --- La matriz y el resumen (§14.2) -------------------------------------------------------


def test_la_matriz_ordena_por_urgencia_y_filtra(courier, gente):
    admin = _cliente(gente["admin"], courier)
    futuro = _alta(
        admin, nombre="Futuro", fecha_vencimiento="2099-01-10", responsable=gente["ana"].id
    )
    vencido = _alta(
        admin, nombre="Vencido", fecha_vencimiento="2020-01-10", responsable=gente["ana"].id
    )
    cerrado = _alta(
        admin, nombre="Cerrado", fecha_vencimiento="2020-01-05", responsable=gente["ana"].id
    )
    Periodo.objects.todas().filter(pk=cerrado.data["id"]).update(cerrado=True)

    filas = admin.get("/api/v1/matriz/periodos/").data["results"]
    assert [f["obligacion"]["nombre"] for f in filas] == ["Vencido", "Futuro", "Cerrado"]

    incumplidos = admin.get("/api/v1/matriz/periodos/?status=incumplido").data["results"]
    assert [f["id"] for f in incumplidos] == [vencido.data["id"]]
    buscados = admin.get("/api/v1/matriz/periodos/?q=futu").data["results"]
    assert [f["id"] for f in buscados] == [futuro.data["id"]]
    por_nombre = admin.get("/api/v1/matriz/periodos/?sort=-name").data["results"]
    assert por_nombre[0]["obligacion"]["nombre"] == "Vencido"


def test_el_resumen_cuenta_lo_que_pide_atencion(courier, gente):
    admin = _cliente(gente["admin"], courier)
    _alta(admin, nombre="Vencido", fecha_vencimiento="2020-01-10", responsable=gente["ana"].id)
    _alta(admin, nombre="Futuro", fecha_vencimiento="2099-01-10", responsable=gente["ana"].id)

    datos = admin.get("/api/v1/matriz/resumen/").data

    assert datos["counts"]["overdue"] == 1
    assert datos["counts"]["in_progress"] == 1
    assert datos["counts"]["attention"] == 1
    assert [p["obligacion"]["nombre"] for p in datos["upcoming"]] == ["Vencido", "Futuro"]


def test_los_catalogos_y_las_personas_del_formulario(courier, gente):
    admin = _cliente(gente["admin"], courier)

    catalogos = admin.get("/api/v1/matriz/catalogos/").data
    personas = [p["nombre"] for p in admin.get("/api/v1/matriz/personas/").data]

    assert {"areas", "entidades", "sedes", "tipos", "periodicidades", "prioridades"} <= set(
        catalogos
    )
    assert "Ana" in personas and "Otra" not in personas
