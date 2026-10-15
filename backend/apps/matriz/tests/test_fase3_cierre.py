"""Matriz de obligaciones, fase 3: evidencias y cierre.

Cobertura de tests/qa/features/matriz-obligaciones.feature (AC-MTZ-026 a
AC-MTZ-036). Sigue las pruebas mínimas de la especificación (§23): cargar →
en preparación; enviar sin evidencia (error); enviar; validar la misma persona
(403); validar otra; devolver; rechazar y eliminar; extensión, tamaño y firma;
versiones y borrado lógico; cambio de fecha con y sin motivo.
"""

import datetime
import zoneinfo

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.matriz.models import Area, Documento, EntidadControl, Periodo
from apps.users.models import User

pytestmark = pytest.mark.django_db

GYE = zoneinfo.ZoneInfo("America/Guayaquil")
PDF = b"%PDF-1.4\n%prueba\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


@pytest.fixture(autouse=True)
def _archivos_aparte(settings, tmp_path):
    """Las evidencias de las pruebas no van a la carpeta de verdad."""
    settings.MEDIA_ROOT = str(tmp_path / "media")


def _cuenta(nombre):
    return User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )


def _miembro(usuario, empresa, rol):
    membresia = MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    membresia.roles.set([Group.objects.get(name=f"Matriz · {rol}")])


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


def _pdf(nombre="declaracion.pdf", contenido=PDF):
    return SimpleUploadedFile(nombre, contenido, content_type="application/pdf")


@pytest.fixture
def courier():
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def escena(courier):
    admin, ana, beto, sara = (_cuenta(n) for n in ("admin", "ana", "beto", "sara"))
    _miembro(admin, courier, "Administrador")
    _miembro(ana, courier, "Responsable")
    _miembro(beto, courier, "Responsable")
    _miembro(sara, courier, "Supervisor/Aprobador")
    alta = _cliente(admin, courier).post(
        "/api/v1/matriz/obligaciones/",
        {
            "nombre": "Declaración de IVA",
            "area": Area.objects.get(codigo="CONT").id,
            "entidad": EntidadControl.objects.get(codigo="SRI").id,
            "periodicidad": "mensual",
            "evidencia_esperada": "Formulario 104 y comprobante de pago",
            "fecha_vencimiento": "2099-10-28",
            "responsable": ana.id,
        },
        format="json",
    )
    assert alta.status_code == 201, alta.data
    return {
        "periodo": alta.data["id"],
        "admin": _cliente(admin, courier),
        "ana": _cliente(ana, courier),
        "beto": _cliente(beto, courier),
        "sara": _cliente(sara, courier),
    }


def _url(escena, accion=""):
    base = f"/api/v1/matriz/periodos/{escena['periodo']}/"
    return f"{base}{accion}/" if accion else base


def _cargar(cliente, escena, archivo=None):
    return cliente.post(_url(escena, "documentos"), {"file": archivo or _pdf()}, format="multipart")


# --- Evidencias (§11.4) ---------------------------------------------------------------


def test_la_primera_evidencia_saca_al_periodo_de_sin_iniciar(escena):
    respuesta = _cargar(escena["ana"], escena)

    assert respuesta.status_code == 201, respuesta.data
    assert respuesta.data["version"] == 1
    periodo = Periodo.objects.todas().get(pk=escena["periodo"])
    assert periodo.etapa == "en_preparacion" and periodo.avance == 25
    documento = Documento.objects.todas().get()
    assert documento.archivo.name.startswith(
        f"evidencias/LC/2099/{periodo.codigo}/v1-{documento.sha256[:12]}"
    )
    historial = escena["ana"].get(_url(escena, "historial")).data
    assert historial[0]["descripcion"] == "Evidencia cargada: declaracion.pdf (v1)"


def test_el_mismo_nombre_es_una_version_nueva(escena):
    _cargar(escena["ana"], escena)

    segunda = _cargar(escena["ana"], escena, _pdf("DECLARACION.pdf"))

    assert segunda.data["version"] == 2


@pytest.mark.parametrize(
    "archivo, mensaje",
    [
        (_pdf("notas.txt"), "Solo se aceptan archivos PDF"),
        (_pdf("falso.pdf", b"MZ esto es un ejecutable"), "no es un PDF válido"),
    ],
)
def test_lo_que_no_es_un_pdf_se_rechaza_en_el_servidor(escena, archivo, mensaje):
    respuesta = _cargar(escena["ana"], escena, archivo)

    assert respuesta.status_code == 400
    assert mensaje in str(respuesta.data)
    assert not Documento.objects.todas().exists()


def test_el_tamano_tiene_tope(escena, settings):
    settings.DOCUMENT_MAX_UPLOAD_MB = 1
    grande = _pdf("grande.pdf", PDF + b"0" * (1024 * 1024))

    respuesta = _cargar(escena["ana"], escena, grande)

    assert respuesta.status_code == 400
    assert "tamaño máximo permitido (1 MB)" in str(respuesta.data)


def test_el_archivo_se_sirve_por_su_endpoint_y_cada_acceso_queda_auditado(escena):
    documento = _cargar(escena["ana"], escena).data["id"]

    respuesta = escena["ana"].get(f"/api/v1/matriz/documentos/{documento}/archivo/?download=1")

    assert respuesta.status_code == 200
    assert b"".join(respuesta.streaming_content).startswith(b"%PDF-")
    assert respuesta["Content-Disposition"].startswith("attachment")
    assert AuditLog.objects.filter(action="document.accessed").count() == 1


def test_el_archivo_de_un_periodo_ajeno_es_404(escena):
    """Beto no es responsable ni suplente, y su rol no tiene `ver_todas`."""
    documento = _cargar(escena["ana"], escena).data["id"]

    assert escena["beto"].get(f"/api/v1/matriz/documentos/{documento}/archivo/").status_code == 404
    assert escena["beto"].post(_url(escena, "documentos"), {"file": _pdf()}).status_code == 404


def test_rechazar_exige_motivo_y_eliminar_es_logico(escena):
    documento = _cargar(escena["ana"], escena).data["id"]
    url = f"/api/v1/matriz/documentos/{documento}/"

    corto = escena["sara"].post(f"{url}rechazar/", {"reason": "no"}, format="json")
    assert corto.status_code == 400
    # Solo se eliminan los rechazados.
    assert escena["ana"].delete(url).status_code == 400

    rechazo = escena["sara"].post(f"{url}rechazar/", {"reason": "Falta la firma del contador."})
    assert rechazo.data["estado"] == "rechazado"
    assert escena["ana"].delete(url).status_code == 204

    eliminado = Documento.objects.todas().get(pk=documento)
    assert eliminado.estado == "eliminado"
    assert eliminado.archivo.storage.exists(eliminado.archivo.name)
    assert escena["ana"].get(_url(escena, "documentos")).data == []


# --- Enviar, validar, devolver (§10) ------------------------------------------------------


def test_sin_evidencia_valida_no_se_envia(escena):
    respuesta = escena["ana"].post(_url(escena, "enviar"))

    assert respuesta.status_code == 400
    assert "Debe cargar la evidencia requerida (Formulario 104" in str(respuesta.data)


def test_una_evidencia_rechazada_no_cuenta(escena):
    documento = _cargar(escena["ana"], escena).data["id"]
    escena["sara"].post(
        f"/api/v1/matriz/documentos/{documento}/rechazar/",
        {"reason": "Ilegible, vuelva a subirla."},
    )

    assert escena["ana"].post(_url(escena, "enviar")).status_code == 400


def test_enviar_y_validar_por_otra_persona_cierra_el_periodo(escena):
    _cargar(escena["ana"], escena)

    enviado = escena["ana"].post(_url(escena, "enviar"))
    assert enviado.status_code == 200, enviado.data
    assert enviado.data["etapa"] == "pendiente_validacion"
    assert "validate" not in enviado.data["acciones"]  # Ana no valida.
    assert {"validate", "return"} <= set(escena["sara"].get(_url(escena)).data["acciones"])
    assert escena["ana"].post(_url(escena, "enviar")).status_code == 400  # ya pendiente

    validado = escena["sara"].post(_url(escena, "validar"))

    assert validado.status_code == 200, validado.data
    assert validado.data["cerrado"] and validado.data["avance"] == 100
    assert validado.data["recordatorios_suspendidos"]
    assert validado.data["estado"]["label"] == "Finalizado"
    assert validado.data["acciones"] == []
    historial = escena["sara"].get(_url(escena, "historial")).data
    assert historial[0]["descripcion"] == "Cierre validado"


def test_quien_envio_o_cargo_no_puede_validar(escena):
    """§8.8, aunque su rol tenga `validar`: el administrador carga y envía."""
    _cargar(escena["admin"], escena)
    escena["admin"].post(_url(escena, "enviar"))

    respuesta = escena["admin"].post(_url(escena, "validar"))

    assert respuesta.status_code == 403
    assert "Separación de funciones" in str(respuesta.data)
    assert not Periodo.objects.todas().get(pk=escena["periodo"]).cerrado


def test_un_cierre_tarde_queda_fuera_de_plazo(escena):
    _cargar(escena["ana"], escena)
    escena["ana"].post(_url(escena, "enviar"))
    Periodo.objects.todas().filter(pk=escena["periodo"]).update(
        vence_en=timezone.now() - datetime.timedelta(days=2)
    )

    validado = escena["sara"].post(_url(escena, "validar")).data

    assert validado["estado"]["label"] == "Finalizada fuera de plazo"
    historial = escena["sara"].get(_url(escena, "historial")).data
    assert historial[0]["descripcion"] == "Cierre validado — Finalizada fuera de plazo"
    assert historial[0]["motivo"] == "Se conserva el atraso para efectos de reportes."


def test_si_la_empresa_cuenta_el_envio_el_cumplimiento_es_esa_fecha(escena, courier):
    courier.base_cumplimiento = "envio"
    courier.save()
    _cargar(escena["ana"], escena)
    escena["ana"].post(_url(escena, "enviar"))

    escena["sara"].post(_url(escena, "validar"))

    periodo = Periodo.objects.todas().get(pk=escena["periodo"])
    assert periodo.enviado_en is not None
    assert periodo.cumplido_en == periodo.enviado_en
    assert periodo.validado_en > periodo.enviado_en


def test_devolver_exige_motivo_y_vuelve_a_preparacion(escena):
    _cargar(escena["ana"], escena)
    escena["ana"].post(_url(escena, "enviar"))

    assert escena["sara"].post(_url(escena, "devolver"), {"reason": "mal"}).status_code == 400
    devuelto = escena["sara"].post(
        _url(escena, "devolver"), {"reason": "El comprobante no corresponde al mes."}
    )

    assert devuelto.status_code == 200
    assert devuelto.data["etapa"] == "en_preparacion" and devuelto.data["avance"] <= 50
    assert "submit" in escena["ana"].get(_url(escena)).data["acciones"]


# --- Cambio de fecha (§10) ---------------------------------------------------------------


def test_cambiar_la_fecha_exige_justificacion_y_queda_en_el_historial(escena):
    url = _url(escena, "vencimiento")

    sin_motivo = escena["sara"].post(url, {"due_date": "2099-11-05", "reason": ""}, format="json")
    antes_del_inicio = escena["sara"].post(
        url, {"due_date": "2099-01-01", "reason": "Prórroga concedida por el SRI."}, format="json"
    )
    cambio = escena["sara"].post(
        url,
        {"due_date": "2099-11-05", "due_time": "12:00", "reason": "Prórroga concedida por el SRI."},
        format="json",
    )

    assert sin_motivo.status_code == 400
    assert antes_del_inicio.status_code == 400
    assert "anterior a la fecha de inicio" in str(antes_del_inicio.data)
    assert cambio.status_code == 200, cambio.data
    periodo = Periodo.objects.todas().get(pk=escena["periodo"])
    assert periodo.vence_en.astimezone(GYE) == datetime.datetime(2099, 11, 5, 12, 0, tzinfo=GYE)
    evento = escena["sara"].get(_url(escena, "historial")).data[0]
    assert evento["descripcion"] == "Cambio de fecha de vencimiento"
    assert (evento["valor_anterior"], evento["valor_nuevo"]) == (
        "28/10/2099 17:00",
        "05/11/2099 12:00",
    )


def test_cambiar_la_fecha_exige_su_permiso(escena):
    """El responsable no la cambia: es del administrador y del supervisor."""
    respuesta = escena["ana"].post(
        _url(escena, "vencimiento"),
        {"due_date": "2099-11-05", "reason": "Necesito más tiempo, por favor."},
        format="json",
    )

    assert respuesta.status_code == 403
    assert "change_due_date" not in escena["ana"].get(_url(escena)).data["acciones"]


def test_un_periodo_cerrado_no_cambia_de_fecha(escena):
    Periodo.objects.todas().filter(pk=escena["periodo"]).update(cerrado=True)

    respuesta = escena["sara"].post(
        _url(escena, "vencimiento"),
        {"due_date": "2099-11-05", "reason": "Prórroga concedida por el SRI."},
        format="json",
    )

    assert respuesta.status_code == 400
    assert "cerrado" in str(respuesta.data)


# --- La vista Documentos (§15.7) ------------------------------------------------------------


def test_documentos_separa_los_expedientes_con_evidencia_de_los_pendientes(escena):
    pendiente = escena["sara"].get("/api/v1/matriz/documentos/").data
    assert [p["id"] for p in pendiente["pending"]] == [escena["periodo"]]

    _cargar(escena["ana"], escena)
    datos = escena["sara"].get("/api/v1/matriz/documentos/").data

    assert [p["id"] for p in datos["with_evidence"]] == [escena["periodo"]]
    assert datos["with_evidence"][0]["documentos_validos"] == 1
    assert datos["pending"] == []
