"""Rol de pagos auditado (26/10/2026).

Talento Humano elige un código y uno o varios meses: un PDF (o un ZIP con un
PDF por mes), sin clave, con el rol arriba y abajo la constancia de todo lo
que pasó: apertura y términos, descargas, envíos al correo, aceptación,
observaciones, correcciones de Talento Humano y su cierre.
"""

import base64
import io
import zipfile
import zlib
from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.nomina import auditado
from apps.nomina.models import ConsultaRolPagos, MensajeObservacion, ObservacionRolPagos
from apps.organizacion.tests.test_carga_personas import _cuenta

URL = "/api/v1/nomina/rol-pagos/auditado/"
CLAVE = "Sup3r-Secr3t!"


def _texto(pdf: bytes) -> str:
    """El texto de un PDF de reportlab (sus contenidos van comprimidos)."""
    partes = []
    for trozo in pdf.split(b"endstream")[:-1]:
        crudo = trozo.rsplit(b"stream", 1)[-1].strip(bytes((13, 10)))
        if crudo.endswith(b"~>"):  # ASCII85, como lo escribe reportlab
            crudo = base64.a85decode(crudo[:-2])
        try:
            partes.append(zlib.decompress(crudo).decode("latin-1"))
        except zlib.error:
            partes.append(crudo.decode("latin-1", "ignore"))
    return "".join(partes)


@pytest.fixture(autouse=True)
def _ejemplo():
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        yield


def _historia(db):
    """Ana abre su rol de septiembre, observa, Talento Humano corrige, ella
    lo vuelve a abrir, lo envía a su correo y lo acepta."""
    ana, _ = _cuenta("ana", "roles_pago.consultar")
    ana.codigo_empleado = "100"
    ana.save()
    th, cliente = _cuenta("th", "roles_pago.historial", "roles_pago.observaciones")
    with usando_empresa(empresa_actual()):
        primera = ConsultaRolPagos.objects.create(
            usuario=ana,
            codigo_empleado="100",
            anio=2026,
            mes=9,
            version_terminos=2,
            terminos_aceptados="…",
            ip="10.0.2.80",
            conformidad="observacion",
            conformidad_en=timezone.now(),
            conformidad_ip="10.0.2.80",
            observacion="Falta el bono de transporte",
        )
        obs = ObservacionRolPagos.objects.create(
            usuario=ana, codigo_empleado="100", anio=2026, mes=9, estado="cerrada"
        )
        MensajeObservacion.objects.create(
            observacion=obs, autor=ana, tipo="observacion", texto="Falta el bono de transporte"
        )
        MensajeObservacion.objects.create(
            observacion=obs, autor=th, tipo="correccion", texto="Se agregó el bono: $40"
        )
        segunda = ConsultaRolPagos.objects.create(
            usuario=ana,
            codigo_empleado="100",
            anio=2026,
            mes=9,
            version_terminos=2,
            terminos_aceptados="…",
            ip="10.0.2.81",
            conformidad="conforme",
            conformidad_en=timezone.now(),
            conformidad_ip="10.0.2.81",
        )
        MensajeObservacion.objects.create(
            observacion=obs, autor=ana, tipo="confirmacion", texto="Estuvo de acuerdo"
        )
    record_audit_event(
        actor=ana,
        action="roles_pago.envio",
        target=ana,
        module="roles_pago",
        new_values={"consulta": segunda.id, "a": "a***@gmail.com"},
    )
    # Cada paso, una hora después del anterior.
    inicio = timezone.now() - timedelta(days=2)
    ConsultaRolPagos.objects.filter(pk=primera.pk).update(
        created_at=inicio, conformidad_en=inicio + timedelta(hours=1)
    )
    mensajes = list(MensajeObservacion.objects.filter(observacion=obs).order_by("id"))
    for horas, m in zip((1, 2, 5), mensajes, strict=True):
        MensajeObservacion.objects.filter(pk=m.pk).update(
            created_at=inicio + timedelta(hours=horas)
        )
    ConsultaRolPagos.objects.filter(pk=segunda.pk).update(
        created_at=inicio + timedelta(hours=3), conformidad_en=inicio + timedelta(hours=5)
    )
    from apps.core.models import AuditLog

    AuditLog.objects.filter(action="roles_pago.envio").update(
        created_at=inicio + timedelta(hours=4)
    )
    th.set_password(CLAVE)
    th.save()
    return ana, th, cliente, primera


def test_la_constancia_trae_cada_paso_en_orden(db):
    ana, _, _, _ = _historia(db)
    eventos = auditado.eventos_del_periodo("100", 2026, 9, ana)
    titulos = [e.titulo for e in eventos]
    assert titulos == [
        "Abrió el rol de pagos y aceptó los términos",
        "Hizo una observación",
        "Talento Humano corrigió el rol (ajuste)",
        "Abrió el rol de pagos y aceptó los términos",
        "Se envió al correo",
        "Aceptó el rol: estuvo de acuerdo",
        "Observación resuelta: confirmó que está de acuerdo",
    ]
    assert eventos[0].ip == "10.0.2.80"
    assert eventos[1].detalle == "Falta el bono de transporte"
    assert eventos[2].detalle == "Se agregó el bono: $40" and eventos[2].quien == "Th Prueba"
    assert eventos[4].detalle == "A a***@gmail.com."
    # Otro mes no se mezcla.
    assert auditado.eventos_del_periodo("100", 2026, 8, ana) == []


def test_un_mes_es_un_pdf_sin_clave_con_el_rol_y_la_constancia(db):
    _, _, cliente, _ = _historia(db)
    respuesta = cliente.post(
        URL,
        {"codigo": "100", "periodos": [{"anio": 2026, "mes": 9}], "password": CLAVE},
        format="json",
    )
    assert respuesta.status_code == 200
    assert respuesta["Content-Type"] == "application/pdf"
    assert "Rol%20auditado%20-%20100%20-%202026-09" in respuesta["Content-Disposition"]
    contenido = respuesta.content
    assert contenido.startswith(b"%PDF") and b"/Encrypt" not in contenido
    texto = _texto(contenido)
    assert "Constancia de auditor" in texto
    assert "rol de pagos - septiembre 2026" in texto.lower()
    assert "Falta el bono de transporte" in texto and "10.0.2.80" in texto
    # Queda en la auditoría y su propia descarga entra en la constancia.
    assert auditado.eventos_del_periodo("100", 2026, 9)[-1].titulo == (
        "Talento Humano descargó el rol auditado"
    )


def test_varios_meses_son_un_zip_con_un_pdf_por_mes(db):
    _, _, cliente, _ = _historia(db)
    respuesta = cliente.post(
        URL,
        {
            "codigo": "100",
            "periodos": [{"anio": 2026, "mes": 9}, {"anio": 2026, "mes": 8}],
            "password": CLAVE,
        },
        format="json",
    )
    assert respuesta.status_code == 200
    assert respuesta["Content-Type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(respuesta.content)) as zip_:
        assert all(not info.flag_bits & 0x1 for info in zip_.infolist())  # sin clave
        nombres = sorted(zip_.namelist())
        assert nombres == [
            "Rol auditado - 100 - 2026-08 Agosto.pdf",
            "Rol auditado - 100 - 2026-09 Septiembre.pdf",
        ]
        assert zip_.read(nombres[0]).startswith(b"%PDF")
    assert respuesta["X-Incluidos"] == "2"


def test_sin_el_permiso_no_se_genera(db):
    _historia(db)
    _, otro = _cuenta("otro")
    datos = {"codigo": "100", "periodos": [{"anio": 2026, "mes": 9}], "password": CLAVE}
    assert otro.post(URL, datos, format="json").status_code == 403
    assert otro.get(URL, {"codigo": "100"}).status_code == 403


def test_contrasena_equivocada_y_meses_invalidos(db):
    _, _, cliente, _ = _historia(db)
    base = {"codigo": "100", "periodos": [{"anio": 2026, "mes": 9}]}
    assert cliente.post(URL, {**base, "password": "mala"}, format="json").status_code == 403
    assert (
        cliente.post(
            URL, {**base, "periodos": [{"anio": 2999, "mes": 1}], "password": CLAVE}, format="json"
        ).status_code
        == 400
    )


def test_la_pantalla_recibe_la_persona_y_los_meses_con_movimientos(db):
    _, _, cliente, _ = _historia(db)
    datos = cliente.get(URL, {"codigo": "100"}).json()
    assert datos["persona"]["nombre"] == "Ana Prueba"
    assert datos["con_movimientos"] == [{"anio": 2026, "mes": 9}]


def test_una_constancia_larga_sigue_en_otra_hoja(db):
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        from apps.nomina import fuente

        rol = fuente.obtener("100", 2026, 9, "Empresa")
    ahora = timezone.now()
    eventos = [
        auditado.Evento(
            ahora + timedelta(minutes=i), f"Evento {i}", "Detalle " * 20, "Ana", "10.0.0.1"
        )
        for i in range(40)
    ]
    constancia = auditado.Constancia(2026, 9, "100", "Ana", eventos, "", rol)
    contenido = auditado.construir(constancia, "Th", "Empresa")
    texto = _texto(contenido)
    assert "Evento 0" in texto and "Evento 39" in texto
    assert contenido.count(b"/Type /Page\n") >= 2 or contenido.count(b"/Type /Page ") >= 2


def test_si_nomina_no_responde_sale_la_constancia(db):
    _, _, cliente, _ = _historia(db)
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=False):
        respuesta = cliente.post(
            URL,
            {"codigo": "100", "periodos": [{"anio": 2026, "mes": 9}], "password": CLAVE},
            format="json",
        )
    assert respuesta.status_code == 200
    texto = _texto(respuesta.content)
    assert "la consulta a n" in texto and "Constancia de auditor" in texto
