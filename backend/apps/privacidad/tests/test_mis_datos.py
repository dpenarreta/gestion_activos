"""«Mis datos»: la descarga de todo lo personal que la intranet guarda de una
persona, y la de quien atiende una solicitud de ACCESO.

Lo que se comprueba es lo que no debe pasar: que entren datos de otra persona,
secretos (contraseña, tokens, claves), el rol de pagos, el chat o el
Escritorio en la descarga de un tercero, datos de salud que quien descarga no
puede ver, o lo de otra empresa. Y que todo quede en la auditoría y en el
registro de descargas sin copia.
"""

import json
import re
from datetime import timedelta
from io import BytesIO

import pytest
from django.apps import apps as registro_de_apps
from django.utils import timezone
from openpyxl import load_workbook

from apps.ausencias.models import LeaveRecord
from apps.authentication.models import Session
from apps.chat.models import Conversacion, Mensaje, Participante
from apps.core.models import AuditLog
from apps.descargas.models import ArchivoServido
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.escritorio.models import DeskNote
from apps.nomina.models import ConsultaRolPagos
from apps.privacidad import mis_datos
from apps.privacidad.models import SolicitudDerechos
from apps.reuniones.models import Meeting
from apps.sugerencias.models import Reporte
from apps.tasks.models import Task

from .conftest import BASE, client_for, make_user

pytestmark = pytest.mark.django_db

TAREA_PROPIA = "Conciliar planillas de Durán — Begoña"
TAREA_AJENA = "Tarea de Ana Núñez que no es de Begoña"
OBSERVACION_MEDICA = "Reposo por amigdalitis"
JTI = "jti-secreto-de-la-sesion-0001"
CLAVE_REUNION = "clave-sala-9876"
ENLACE_REUNION = "https://reuniones.example.com/sala/abc123"
NOTA_PRIVADA = "Nota privada del escritorio para Ana"
MENSAJE_CHAT = "Mensaje directo del chat, solo de las dos"
OBSERVACION_ROL = "OBSERVACION-ROL-DE-PAGOS-NO-SALE"
FORMULA = '=HYPERLINK("http://malicioso.example.com","Ver")'


def _tarea(persona, titulo, creador):
    ahora = timezone.now()
    return Task.objects.create(
        title=titulo,
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=ahora,
        end_date=ahora + timedelta(days=2),
        estimated_hours=3,
        assigned_to=persona,
        created_by=creador,
    )


@pytest.fixture
def datos(begona, nunez, admin_gh):
    """Un poco de todo para Begoña, y algo de Ana que no debe salir."""
    _tarea(begona, TAREA_PROPIA, admin_gh)
    _tarea(nunez, TAREA_AJENA, admin_gh)
    LeaveRecord.objects.create(
        user=begona,
        type="MEDICO",
        date=timezone.localdate(),
        is_full_day=True,
        observation=OBSERVACION_MEDICA,
        created_by=admin_gh,
    )
    Session.objects.create(
        user=begona, refresh_token_jti=JTI, expires_at=timezone.now() + timedelta(days=1)
    )
    Meeting.objects.create(
        title="Revisión de turnos de bodega",
        host=begona,
        meeting_date=timezone.now(),
        duration=30,
        join_url=ENLACE_REUNION,
        join_password=CLAVE_REUNION,
    )
    DeskNote.objects.create(sender=begona, recipient=nunez, message=NOTA_PRIVADA)
    conversacion = Conversacion.objects.create(tipo="directa", clave=f"d-{begona.pk}-{nunez.pk}")
    Participante.objects.create(conversacion=conversacion, usuario=begona)
    Participante.objects.create(conversacion=conversacion, usuario=nunez)
    Mensaje.objects.create(conversacion=conversacion, autor=begona, texto=MENSAJE_CHAT)
    Mensaje.objects.create(conversacion=conversacion, autor=nunez, texto="Respuesta de Ana")
    ConsultaRolPagos.objects.create(
        usuario=begona,
        codigo_empleado="E-0001",
        anio=2026,
        mes=10,
        version_terminos=1,
        terminos_aceptados="Términos",
        observacion=OBSERVACION_ROL,
    )
    Reporte.objects.create(
        tipo="sugerencia", titulo=FORMULA, descripcion="Probar", modulo="perfil", autor=begona
    )


def _json(respuesta) -> dict:
    assert respuesta.status_code == 200, respuesta.content
    return json.loads(respuesta.content)


def _seccion(contenido, clave):
    for s in contenido["secciones"]:
        if s["clave"] == clave:
            return s["registros"]
    raise AssertionError(f"Sin la sección {clave}")


def test_la_descarga_propia_trae_lo_suyo_y_nada_ajeno_ni_secreto(begona, datos):
    respuesta = client_for(begona).get(f"{BASE}/mis-datos/")
    assert respuesta["Content-Disposition"] == 'attachment; filename="mis-datos-bpenaherrera.json"'
    assert respuesta["Cache-Control"] == "no-store"
    contenido = _json(respuesta)
    texto = respuesta.content.decode("utf-8")

    assert contenido["titular"] == {"usuario": "bpenaherrera", "nombre": "Begoña Peñaherrera"}
    assert contenido["descargado_por"] == "el titular"
    assert contenido["secciones_omitidas"] == []
    assert [s["clave"] for s in contenido["secciones"]] == [s.clave for s in mis_datos.SECCIONES]

    # Lo suyo, con el detalle que ella ya ve en pantalla.
    assert [t["titulo"] for t in _seccion(contenido, "tareas")] == [TAREA_PROPIA]
    ausencia = _seccion(contenido, "ausencias")[0]
    assert ausencia["tipo"] == "MEDICO" and ausencia["observacion"] == OBSERVACION_MEDICA
    assert NOTA_PRIVADA in texto and MENSAJE_CHAT in texto
    assert _seccion(contenido, "cuenta")["correo"] == "bpenaherrera@example.com"

    # Nada de otra persona.
    assert TAREA_AJENA not in texto
    assert "Respuesta de Ana" not in texto
    # Ningún secreto.
    usuario = type(begona).objects.get(pk=begona.pk)
    assert usuario.password[:20] not in texto
    assert JTI not in texto
    assert CLAVE_REUNION not in texto and ENLACE_REUNION not in texto
    # Ni el rol de pagos.
    assert OBSERVACION_ROL not in texto
    assert not any("rol" in s["clave"] and "pago" in s["clave"] for s in contenido["secciones"])
    assert any("Rol de pagos" in x["que"] for x in contenido["no_incluido"])


def test_el_excel_tiene_una_hoja_por_seccion_y_neutraliza_formulas(begona, datos):
    respuesta = client_for(begona).get(f"{BASE}/mis-datos/?formato=xlsx")
    assert respuesta.status_code == 200
    assert respuesta["Content-Type"] == mis_datos.CONTENT_TYPE_XLSX
    libro = load_workbook(BytesIO(respuesta.content))
    assert libro.sheetnames[0] == "Resumen"
    assert len(libro.sheetnames) == 1 + len(mis_datos.SECCIONES)
    assert all(len(nombre) <= 31 for nombre in libro.sheetnames)

    hoja = libro["Sugerencias y errores"]
    valores = [c.value for fila in hoja.iter_rows() for c in fila]
    assert "'" + FORMULA in valores
    assert FORMULA not in valores
    todo = " ".join(
        str(c.value) for h in libro.worksheets for fila in h.iter_rows() for c in fila if c.value
    )
    assert JTI not in todo and OBSERVACION_ROL not in todo and TAREA_AJENA not in todo


def test_formato_invalido(begona):
    respuesta = client_for(begona).get(f"{BASE}/mis-datos/?formato=pdf")
    assert respuesta.status_code == 400
    assert "formato" in respuesta.json()["error"]["details"]


def test_queda_en_la_auditoria_y_en_el_registro_de_descargas_sin_copia(begona, datos):
    from apps.descargas import services as descargas

    respuesta = client_for(begona).get(f"{BASE}/mis-datos/?formato=xlsx")
    evento = AuditLog.objects.get(action="privacidad.datos.descargados")
    assert evento.actor == begona
    assert evento.new_values == {
        "titular": begona.pk,
        "formato": "xlsx",
        "solicitud": "",
        "para_tercero": False,
    }
    servido = ArchivoServido.objects.get(usuario=begona)
    assert servido.referencia["modulo"] == "privacidad"
    assert servido.referencia["sin_copia"]

    # Cuando el navegador avisa que lo guardó, se registra sin guardar copia.
    from django.core.files.uploadedfile import SimpleUploadedFile

    descarga = descargas.registrar(
        begona,
        nombre="mis-datos-bpenaherrera.xlsx",
        archivo=SimpleUploadedFile("mis-datos.xlsx", respuesta.content),
    )
    assert descarga.verificada is True
    assert descarga.copia_id is None and descarga.sin_copia
    assert descarga.modulo == "Protección de datos personales"


# ── Quien atiende un ACCESO ───────────────────────────────────────────────────


def _acceso(titular, **extra):
    return SolicitudDerechos.objects.create(
        titular=titular,
        tipo=extra.pop("tipo", "ACCESO"),
        fecha_limite=timezone.localdate() + timedelta(days=15),
        plazo_dias=15,
        **extra,
    )


def test_quien_atiende_descarga_sin_chat_ni_escritorio_y_con_la_salud_enmascarada(begona, datos):
    atiende = make_user("atiende", perms=["privacidad.atender"], first_name="Íñigo")
    solicitud = _acceso(begona)

    respuesta = client_for(atiende).get(f"{BASE}/solicitudes/{solicitud.pk}/datos/")
    assert respuesta["Content-Disposition"] == (
        f'attachment; filename="mis-datos-bpenaherrera-{solicitud.numero}.json"'
    )
    contenido = _json(respuesta)
    texto = respuesta.content.decode("utf-8")

    assert contenido["descargado_por"] == "Íñigo"
    assert {s["clave"] for s in contenido["secciones_omitidas"]} == {"chat", "escritorio"}
    assert NOTA_PRIVADA not in texto and MENSAJE_CHAT not in texto
    # Sin `ausencias.medicas_ver`, la ausencia va como en pantalla: sin tipo.
    ausencia = _seccion(contenido, "ausencias")[0]
    assert ausencia["tipo"] == "AUSENCIA" and ausencia["observacion"] == "(reservado)"
    assert OBSERVACION_MEDICA not in texto
    assert TAREA_PROPIA in texto and TAREA_AJENA not in texto

    evento = AuditLog.objects.get(action="privacidad.datos.descargados")
    assert evento.actor == atiende
    assert evento.new_values["para_tercero"] is True
    assert evento.new_values["solicitud"] == solicitud.numero


def test_con_permiso_de_salud_ve_el_detalle_que_ya_podia_ver(begona, datos):
    atiende = make_user("atiende", perms=["privacidad.atender", "ausencias.medicas_ver"])
    solicitud = _acceso(begona)
    contenido = _json(client_for(atiende).get(f"{BASE}/solicitudes/{solicitud.pk}/datos/"))
    ausencia = _seccion(contenido, "ausencias")[0]
    assert ausencia["tipo"] == "MEDICO" and ausencia["observacion"] == OBSERVACION_MEDICA
    # El chat y el Escritorio siguen fuera: ningún permiso los abre.
    assert {s["clave"] for s in contenido["secciones_omitidas"]} == {"chat", "escritorio"}


def test_solo_para_responder_un_acceso_abierto(begona, admin_gh):
    cliente = client_for(admin_gh)
    rectificacion = _acceso(begona, tipo="RECTIFICACION", descripcion="Mi apellido")
    respuesta = cliente.get(f"{BASE}/solicitudes/{rectificacion.pk}/datos/")
    assert respuesta.status_code == 409
    assert respuesta.json()["error"]["code"] == "no_es_de_acceso"

    cerrada = _acceso(begona, estado="RESUELTA")
    respuesta = cliente.get(f"{BASE}/solicitudes/{cerrada.pk}/datos/")
    assert respuesta.status_code == 409
    assert respuesta.json()["error"]["code"] == "solicitud_cerrada"
    assert not AuditLog.objects.filter(action="privacidad.datos.descargados").exists()

    abierta = _acceso(begona)
    detalle = cliente.get(f"{BASE}/solicitudes/{abierta.pk}/").json()
    assert detalle["puede_descargar_datos"] is True


# ── Empresas ──────────────────────────────────────────────────────────────────


def test_la_descarga_es_de_la_empresa_en_la_que_se_pide(begona, admin_gh):
    from apps.empresas.contexto import empresa_actual

    principal = empresa_actual().nombre
    _tarea(begona, TAREA_PROPIA, admin_gh)
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    MembresiaEmpresa.objects.create(usuario=begona, empresa=otra)
    with usando_empresa(otra):
        _tarea(begona, "Tarea en la otra empresa del grupo", admin_gh)

    cliente = client_for(begona)
    contenido = _json(cliente.get(f"{BASE}/mis-datos/"))
    assert [t["titulo"] for t in _seccion(contenido, "tareas")] == [TAREA_PROPIA]

    # Las pruebas fijan la empresa como lo haría `X-Empresa` en producción.
    with usando_empresa(otra):
        contenido = _json(cliente.get(f"{BASE}/mis-datos/"))
    assert contenido["empresa"] == "LaarSeguridad"
    assert [t["titulo"] for t in _seccion(contenido, "tareas")] == [
        "Tarea en la otra empresa del grupo"
    ]
    # Las empresas en que trabaja sí van en las dos: son de la cuenta.
    empresas = {f["empresa"] for f in _seccion(contenido, "empresas_y_roles")}
    assert {"LaarSeguridad", principal} <= empresas


def test_la_solicitud_de_otra_empresa_no_existe_para_quien_atiende(begona):
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    atiende = make_user("atiende", perms=["privacidad.atender"])
    MembresiaEmpresa.objects.create(usuario=atiende, empresa=otra)
    MembresiaEmpresa.objects.create(usuario=begona, empresa=otra)
    with usando_empresa(otra):
        ajena = _acceso(begona)
    propia = _acceso(begona)

    cliente = client_for(atiende)
    ids = [s["id"] for s in cliente.get(f"{BASE}/solicitudes/").json()["results"]]
    assert ids == [propia.pk]
    assert cliente.get(f"{BASE}/solicitudes/{ajena.pk}/").status_code == 404
    assert cliente.get(f"{BASE}/solicitudes/{ajena.pk}/datos/").status_code == 404
    respuesta = cliente.post(
        f"{BASE}/solicitudes/{ajena.pk}/estado/",
        {"estado": "RESUELTA", "respuesta": "x"},
        format="json",
    )
    assert respuesta.status_code == 404
    # Y el titular tampoco la ve desde esta empresa.
    assert client_for(begona).get(f"{BASE}/mis-solicitudes/{ajena.pk}/").status_code == 404


# ── Que no se olvide ninguna app ──────────────────────────────────────────────

#: Apps con datos personales cuya sección de «mis datos» está pendiente, cada
#: una con su motivo. Pasa la prueba esté o no ya en `APPS_REVISADAS`: al
#: integrarla allí, se borra de aquí.
#:
#: - `llamados` (US-013, 12/11/2026): los llamados de atención de la persona.
#:   `privacidad/mis_datos.py` está en edición por otra sesión (app móvil) y
#:   la historia deja su sección como pendiente para cuando se integre.
PENDIENTES_DE_REVISAR = {"llamados"}


def test_todas_las_apps_estan_revisadas():
    """Toda app instalada de `backend/apps` está en `APPS_REVISADAS`, con la
    sección que la cubre o el motivo por el que no aporta: una app nueva obliga
    a decidir qué va en «mis datos»."""
    instaladas = {
        c.name.split(".", 1)[1]
        for c in registro_de_apps.get_app_configs()
        if c.name.startswith("apps.")
    }
    assert instaladas - PENDIENTES_DE_REVISAR == set(mis_datos.APPS_REVISADAS) - (
        PENDIENTES_DE_REVISAR
    )
    claves = {s.clave for s in mis_datos.SECCIONES}
    for app, nota in mis_datos.APPS_REVISADAS.items():
        if nota.startswith("Secciones:"):
            # Lo que va entre paréntesis es una aclaración, no una sección.
            nombradas = re.sub(r"\(.*?\)", "", nota.removeprefix("Secciones:")).split(".")[0]
            for clave in (c.strip().split(" ")[0] for c in nombradas.split(",")):
                assert clave in claves, f"{app}: la sección «{clave}» no existe"


def test_la_pantalla_puede_explicar_que_incluye(begona):
    datos = client_for(begona).get(f"{BASE}/mis-datos/secciones/").json()
    assert [s["clave"] for s in datos["secciones"]] == [s.clave for s in mis_datos.SECCIONES]
    privadas = {s["clave"] for s in datos["secciones"] if s["solo_el_titular"]}
    assert privadas == {"chat", "escritorio"}
    assert len(datos["no_incluido"]) == len(mis_datos.EXCLUIDO)


def test_trae_sus_aceptaciones_de_textos_con_ip_y_navegador(begona, nunez):
    """US-004 (11/11/2026): lo que la intranet guarda de cada aceptación suya
    (IP y navegador incluidos) es dato personal y va en su descarga. Los
    términos de cada consulta del rol de pagos no: van con el rol."""
    from apps.privacidad import catalogo_textos as cat
    from apps.privacidad import textos

    textos.aceptar(begona, cat.AUTORIZACION_TELEFONO, ip="10.0.5.21", navegador="Firefox/140")
    textos.aceptar(begona, cat.CUMPLEANOS_PUBLICO, ip="10.0.5.21")
    textos.retirar(begona, cat.CUMPLEANOS_PUBLICO)
    textos.aceptar(begona, cat.ROL_PAGOS_TERMINOS_CLAVE, referencia="nomina.ConsultaRolPagos:1")
    textos.aceptar(nunez, cat.AUTORIZACION_TELEFONO, ip="10.9.9.9")

    contenido = _json(client_for(begona).get(f"{BASE}/mis-datos/"))
    filas = _seccion(contenido, "aceptaciones_de_textos")
    assert [f["texto"] for f in filas] == [
        "Autorización del teléfono personal",
        "Cumpleaños público",
    ]
    telefono, cumple = filas
    assert telefono["desde_ip"] == "10.0.5.21" and telefono["navegador"] == "Firefox/140"
    assert telefono["texto_aceptado"] == textos.obtener(cat.AUTORIZACION_TELEFONO).texto
    assert cumple["retirada_el"] is not None
    assert "10.9.9.9" not in json.dumps(contenido)
