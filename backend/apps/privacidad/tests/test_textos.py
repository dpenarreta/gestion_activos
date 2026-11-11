"""Textos de protección de datos y sus aceptaciones (US-004): el catálogo
(CA-1), la edición con versión, historial y auditoría (CA-2), la regla de
cada texto tras un cambio (CA-3), el registro común (CA-4), el listado, el
detalle y el Excel de aceptaciones (CA-5), los textos fijos que ahora sirve
el servidor (CA-8) y los permisos (CA-9)."""

from io import BytesIO

import pytest
from django.utils import timezone
from openpyxl import load_workbook

from apps.core.models import AuditLog
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.privacidad import catalogo_textos as cat
from apps.privacidad import textos
from apps.privacidad.models import AceptacionTexto, TextoProteccion, VersionTextoProteccion
from apps.privacidad.services import PrivacidadError

from .conftest import BASE, client_for, make_user

pytestmark = pytest.mark.django_db

TEXTOS = f"{BASE}/textos/"
ACEPTACIONES = f"{BASE}/aceptaciones/"
TELEFONO = cat.AUTORIZACION_TELEFONO
NUEVO_TELEFONO = (
    "Autorizo a la empresa a guardar mi teléfono personal y a que mis compañeros me "
    "llamen por él. Puedo retirarlo cuando quiera (versión revisada por Begoña Núñez)."
)


@pytest.fixture
def editora():
    """Solo edita textos (`privacidad.textos`), sin ver las solicitudes."""
    return make_user("editora", perms=["privacidad.textos"], first_name="Eugenia")


def _guardar(usuario, clave, **cuerpo):
    return client_for(usuario).put(f"{TEXTOS}{clave}/", cuerpo, format="json")


def _textos_planos(datos):
    return [t for m in datos["modulos"] for s in m["secciones"] for t in s["textos"]]


# ── CA-1 · El catálogo ────────────────────────────────────────────────────────


def test_el_catalogo_trae_todos_los_textos_agrupados_por_modulo_y_seccion(lectora):
    respuesta = client_for(lectora).get(TEXTOS)
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["puede_editar"] is False
    assert [m["modulo"] for m in datos["modulos"]] == [
        cat.GENERAL,
        cat.MI_PERFIL,
        cat.ROL_DE_PAGOS,
        cat.CODIGOS_DE_CONDUCTA,
        cat.NOVA,
    ]
    planos = _textos_planos(datos)
    assert [t["clave"] for t in planos] == list(cat.CLAVES)
    assert len(planos) == 17
    mi_perfil = datos["modulos"][1]["secciones"]
    assert [s["seccion"] for s in mi_perfil] == [
        "Teléfono personal",
        "Cumpleaños",
        "Aniversario",
        "Mis derechos",
    ]
    telefono = next(t for t in planos if t["clave"] == TELEFONO)
    for campo in (
        "nombre",
        "requiere_aceptacion",
        "version",
        "texto",
        "editado_en",
        "editado_por",
        "version_exigida",
        "existe",
    ):
        assert campo in telefono
    assert telefono["requiere_aceptacion"] is True and telefono["existe"] is True


def test_los_textos_fijos_nacen_con_el_texto_de_hoy(lectora):
    planos = {t["clave"]: t for t in _textos_planos(client_for(lectora).get(TEXTOS).json())}
    assert planos[cat.CUMPLEANOS_PUBLICO]["texto"] == cat.CUMPLEANOS
    assert planos[cat.NOVA_PANEL_DESEMPENO_CLAVE]["texto"] == cat.NOVA_PANEL_DESEMPENO
    assert planos[cat.DERECHOS_EXPLICACION_CLAVE]["variables"] == ["plazo"]
    assert "{plazo}" in planos[cat.DERECHOS_EXPLICACION_CLAVE]["texto"]
    assert planos[cat.ACUERDO_CONFIDENCIALIDAD]["lleva_titulo"] is True


def test_una_empresa_nueva_siembra_los_textos_salvo_el_aviso(lectora):
    otra = Empresa.objects.create(codigo="NUEVA", nombre="Empresa Nueva Ñandú")
    MembresiaEmpresa.objects.create(usuario=lectora, empresa=otra)
    with usando_empresa(otra):
        planos = {t["clave"]: t for t in _textos_planos({"modulos": textos.catalogo()})}
        assert TextoProteccion.objects.count() == 16
        assert planos[cat.AVISO_PRIVACIDAD]["existe"] is False
        assert planos[cat.AVISO_PRIVACIDAD]["version"] is None
        assert "Empresa Nueva Ñandú" in planos[cat.AVISO_PRIVACIDAD]["texto"]
        # Cada texto sembrado deja su primera versión.
        assert VersionTextoProteccion.objects.filter(version=1).count() == 16
        # Sin aviso no se exige nada.
        assert textos.acepto_vigente(lectora, cat.AVISO_PRIVACIDAD) is True


# ── CA-8 · El texto vigente para quien lo lee ─────────────────────────────────


def test_el_vigente_lo_lee_cualquiera_con_las_variables_reemplazadas(begona, settings):
    settings.PRIVACIDAD_PLAZO_DIAS = 15
    cliente = client_for(begona)
    respuesta = cliente.get(f"{TEXTOS}{cat.DERECHOS_EXPLICACION_CLAVE}/vigente/")
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert set(datos) == {"clave", "version", "texto", "titulo"}
    assert "en un plazo de 15 días" in datos["texto"] and "{plazo}" not in datos["texto"]
    nova = cliente.get(f"{TEXTOS}{cat.NOVA_AVISO_IA}/vigente/").json()
    assert nova["texto"] == cat.NOVA_LINEA
    assert cliente.get(f"{TEXTOS}no_existe/vigente/").status_code == 404


def test_el_vigente_pide_sesion():
    from rest_framework.test import APIClient

    respuesta = APIClient().get(f"{TEXTOS}{TELEFONO}/vigente/")
    assert respuesta.status_code == 401


def test_el_aviso_de_una_empresa_sin_aviso_no_existe(begona):
    otra = Empresa.objects.create(codigo="SINAVISO", nombre="Sin aviso")
    MembresiaEmpresa.objects.create(usuario=begona, empresa=otra)
    with usando_empresa(otra):
        assert textos.vigente(cat.AVISO_PRIVACIDAD) is None


# ── CA-2 · Editar ─────────────────────────────────────────────────────────────


def test_editar_sube_la_version_deja_historial_y_auditoria(editora, begona):
    anterior = textos.obtener(TELEFONO)
    respuesta = _guardar(editora, TELEFONO, texto=NUEVO_TELEFONO, motivo="Revisión legal")
    assert respuesta.status_code == 200, respuesta.json()
    datos = respuesta.json()
    assert datos["version"] == anterior.version + 1
    assert datos["version_exigida"] == datos["version"]
    assert datos["texto"] == NUEVO_TELEFONO
    assert datos["editado_por"]["nombre"] == "Eugenia"
    # El usuario ve el texto nuevo desde ya.
    vigente = client_for(begona).get(f"{TEXTOS}{TELEFONO}/vigente/").json()
    assert vigente == {
        "clave": TELEFONO,
        "version": datos["version"],
        "texto": NUEVO_TELEFONO,
        "titulo": "",
    }
    version = VersionTextoProteccion.objects.get(
        texto_proteccion=anterior, version=datos["version"]
    )
    assert version.motivo == "Revisión legal" and version.editado_por == editora
    evento = AuditLog.objects.get(action="privacidad.texto.editado")
    assert evento.previous_values["texto"] == anterior.texto
    assert evento.new_values["texto"] == NUEVO_TELEFONO
    assert evento.new_values["version"] == datos["version"]


def test_guardar_el_mismo_texto_no_sube_la_version(editora):
    actual = textos.obtener(TELEFONO)
    respuesta = _guardar(editora, TELEFONO, texto=f"  {actual.texto}  ")
    assert respuesta.status_code == 200
    assert respuesta.json()["version"] == actual.version
    assert not AuditLog.objects.filter(action="privacidad.texto.editado").exists()


@pytest.mark.parametrize(
    "texto",
    ["Muy corto.", "x" * 19, "ñ" * 6001],
)
def test_el_largo_del_texto_se_valida_junto_al_campo(editora, texto):
    respuesta = _guardar(editora, TELEFONO, texto=texto)
    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "validation_error"
    assert "texto" in error["details"]


def test_los_limites_del_largo_se_aceptan(editora):
    assert _guardar(editora, TELEFONO, texto="á" * 20).status_code == 200
    assert _guardar(editora, TELEFONO, texto="é" * 6000).status_code == 200


def test_no_se_puede_quitar_una_variable(editora):
    respuesta = _guardar(
        editora, cat.DERECHOS_EXPLICACION_CLAVE, texto="Puede pedir sus datos cuando quiera."
    )
    assert respuesta.status_code == 400
    assert "{plazo}" in respuesta.json()["error"]["details"]["texto"][0]


def test_el_titulo_solo_lo_lleva_el_acuerdo(editora):
    sin_titulo = _guardar(editora, TELEFONO, texto=NUEVO_TELEFONO, titulo="Título")
    assert sin_titulo.status_code == 400
    assert "titulo" in sin_titulo.json()["error"]["details"]
    acuerdo = _guardar(
        editora,
        cat.ACUERDO_CONFIDENCIALIDAD,
        texto="Me comprometo a no compartir los documentos internos de la compañía.",
        titulo="Acuerdo de reserva",
    )
    assert acuerdo.status_code == 200
    assert acuerdo.json()["titulo"] == "Acuerdo de reserva"
    vacio = _guardar(editora, cat.ACUERDO_CONFIDENCIALIDAD, texto="x" * 30, titulo="")
    assert vacio.status_code == 400


def test_cambiar_solo_el_titulo_tambien_sube_la_version(editora):
    actual = textos.obtener(cat.ACUERDO_CONFIDENCIALIDAD)
    respuesta = _guardar(
        editora, cat.ACUERDO_CONFIDENCIALIDAD, texto=actual.texto, titulo="Otro título"
    )
    assert respuesta.json()["version"] == actual.version + 1


def test_una_clave_que_no_existe_responde_404(editora):
    assert _guardar(editora, "no_existe", texto=NUEVO_TELEFONO).status_code == 404


def test_las_versiones_de_un_texto(editora, lectora):
    _guardar(editora, TELEFONO, texto=NUEVO_TELEFONO, motivo="Primera revisión")
    versiones = client_for(lectora).get(f"{TEXTOS}{TELEFONO}/versiones/").json()
    assert [v["version"] for v in versiones] == sorted(
        (v["version"] for v in versiones), reverse=True
    )
    assert versiones[0]["vigente"] is True and versiones[0]["motivo"] == "Primera revisión"
    assert versiones[0]["texto"] == NUEVO_TELEFONO
    assert all(v["vigente"] is False for v in versiones[1:])


# ── CA-3 · Qué se exige tras un cambio ────────────────────────────────────────


def test_el_aviso_solo_se_pide_de_nuevo_si_se_marca(editora, begona):
    aviso = textos.obtener(cat.AVISO_PRIVACIDAD)
    textos.aceptar(begona, cat.AVISO_PRIVACIDAD)
    corregido = _guardar(editora, cat.AVISO_PRIVACIDAD, texto=aviso.texto + " Corregido.").json()
    assert corregido["version"] == aviso.version + 1
    assert corregido["version_exigida"] == aviso.version_exigida
    assert textos.acepto_vigente(begona, cat.AVISO_PRIVACIDAD) is True

    pedido = _guardar(
        editora, cat.AVISO_PRIVACIDAD, texto=aviso.texto + " Corregido.", pedir_de_nuevo=True
    ).json()
    # Sin cambiar el texto se abre siempre una versión nueva con el mismo
    # texto, que pasa a ser la exigida (QA-FUNC O-5).
    assert pedido["version"] == corregido["version"] + 1
    assert pedido["version_exigida"] == pedido["version"]
    assert textos.acepto_vigente(begona, cat.AVISO_PRIVACIDAD) is False
    assert AuditLog.objects.filter(action="privacidad.texto.aceptacion_pedida").exists()

    # Pedirlo otra vez con todo al día abre una versión nueva con el mismo texto.
    textos.aceptar(begona, cat.AVISO_PRIVACIDAD)
    otra_vez = _guardar(
        editora, cat.AVISO_PRIVACIDAD, texto=aviso.texto + " Corregido.", pedir_de_nuevo=True
    ).json()
    assert otra_vez["version"] == pedido["version"] + 1
    assert otra_vez["version_exigida"] == otra_vez["version"]
    assert textos.acepto_vigente(begona, cat.AVISO_PRIVACIDAD) is False


def test_en_los_demas_textos_cambiar_exige_aceptar_de_nuevo(editora, begona):
    textos.aceptar(begona, TELEFONO)
    assert textos.acepto_vigente(begona, TELEFONO) is True
    # `pedir_de_nuevo` no cuenta fuera del aviso: igual se exige.
    _guardar(editora, TELEFONO, texto=NUEVO_TELEFONO, pedir_de_nuevo=False)
    assert textos.acepto_vigente(begona, TELEFONO) is False


def test_nueva_version_del_acuerdo_por_los_documentos(begona):
    textos.aceptar(begona, cat.ACUERDO_CONFIDENCIALIDAD)
    antes = textos.obtener(cat.ACUERDO_CONFIDENCIALIDAD)
    textos.nueva_version(cat.ACUERDO_CONFIDENCIALIDAD, motivo="Cambiaron los documentos.")
    despues = textos.obtener(cat.ACUERDO_CONFIDENCIALIDAD)
    assert despues.version == antes.version + 1 and despues.texto == antes.texto
    assert textos.acepto_vigente(begona, cat.ACUERDO_CONFIDENCIALIDAD) is False
    assert VersionTextoProteccion.objects.filter(
        texto_proteccion=despues, version=despues.version, motivo="Cambiaron los documentos."
    ).exists()


# ── CA-4 · El registro común ──────────────────────────────────────────────────


def test_aceptar_guarda_texto_ip_navegador_y_es_idempotente(begona):
    aceptacion, creada = textos.aceptar(
        begona, TELEFONO, ip="10.0.5.21", navegador="Mozilla/5.0 (Windows NT 10.0) Firefox/140"
    )
    assert creada is True
    vigente = textos.obtener(TELEFONO)
    assert aceptacion.version == vigente.version
    assert aceptacion.texto_aceptado == vigente.texto
    assert aceptacion.ip == "10.0.5.21" and "Firefox" in aceptacion.navegador
    assert aceptacion.origen == "INTRANET"
    otra, creada = textos.aceptar(begona, TELEFONO, ip="10.0.9.9")
    assert creada is False and otra.pk == aceptacion.pk


def test_con_referencia_cada_una_es_una_fila(begona):
    clave = cat.ROL_PAGOS_TERMINOS_CLAVE
    primera, _ = textos.aceptar(begona, clave, referencia="nomina.ConsultaRolPagos:1")
    segunda, creada = textos.aceptar(begona, clave, referencia="nomina.ConsultaRolPagos:2")
    assert creada and primera.pk != segunda.pk
    repetida, creada = textos.aceptar(begona, clave, referencia="nomina.ConsultaRolPagos:2")
    assert not creada and repetida.pk == segunda.pk


def test_aceptar_una_version_vieja_responde_409(begona, editora):
    vieja = textos.obtener(TELEFONO).version
    _guardar(editora, TELEFONO, texto=NUEVO_TELEFONO)
    with pytest.raises(PrivacidadError) as error:
        textos.aceptar(begona, TELEFONO, version=vieja)
    assert error.value.code == "texto_cambiado" and error.value.status == 409


def test_retirar_marca_sin_borrar_y_volver_crea_otra_fila(begona):
    primera, _ = textos.aceptar(begona, cat.CUMPLEANOS_PUBLICO)
    assert textos.retirar(begona, cat.CUMPLEANOS_PUBLICO) == 1
    primera.refresh_from_db()
    assert primera.retirada_en is not None and primera.retirada_por == begona
    assert textos.acepto_vigente(begona, cat.CUMPLEANOS_PUBLICO) is False
    segunda, creada = textos.aceptar(begona, cat.CUMPLEANOS_PUBLICO)
    assert creada and segunda.pk != primera.pk
    assert AceptacionTexto.objects.filter(usuario=begona).count() == 2


def test_una_aceptacion_de_version_desconocida_no_vale(begona):
    texto = textos.obtener(cat.ROL_PAGOS_CORREO_CLAVE)
    AceptacionTexto.objects.create(
        texto_proteccion=texto,
        usuario=begona,
        version=None,
        aceptado_en=timezone.now(),
        origen="MIGRADA",
    )
    assert textos.acepto_vigente(begona, cat.ROL_PAGOS_CORREO_CLAVE) is False


# ── CA-5 · Ver las aceptaciones ───────────────────────────────────────────────


@pytest.fixture
def registro(begona, nunez):
    textos.aceptar(begona, TELEFONO, ip="10.0.5.21", navegador="Firefox")
    textos.aceptar(nunez, TELEFONO, ip="10.0.5.22")
    textos.aceptar(begona, cat.CUMPLEANOS_PUBLICO, ip="10.0.5.21")
    textos.retirar(begona, cat.CUMPLEANOS_PUBLICO)
    textos.aceptar(nunez, cat.ROL_PAGOS_TERMINOS_CLAVE, referencia="nomina.ConsultaRolPagos:9")


def test_el_listado_de_aceptaciones_y_sus_filtros(lectora, registro):
    cliente = client_for(lectora)
    todas = cliente.get(ACEPTACIONES).json()
    assert todas["count"] >= 4
    fila = next(f for f in todas["results"] if f["persona"]["usuario"] == "bpenaherrera")
    for campo in (
        "persona",
        "clave",
        "modulo",
        "seccion",
        "version",
        "aceptado_en",
        "ip",
        "origen",
        "retirada_en",
        "migrada",
        "estado",
    ):
        assert campo in fila
    assert "texto" not in fila

    por_clave = cliente.get(ACEPTACIONES, {"clave": TELEFONO}).json()["results"]
    assert {f["persona"]["usuario"] for f in por_clave} >= {"bpenaherrera", "anunez"}
    assert all(f["clave"] == TELEFONO for f in por_clave)

    por_modulo = cliente.get(ACEPTACIONES, {"modulo": cat.ROL_DE_PAGOS}).json()["results"]
    assert {f["clave"] for f in por_modulo} == {cat.ROL_PAGOS_TERMINOS_CLAVE}

    por_seccion = cliente.get(ACEPTACIONES, {"seccion": "Cumpleaños"}).json()["results"]
    assert {f["clave"] for f in por_seccion} == {cat.CUMPLEANOS_PUBLICO}

    # Búsqueda por persona sin tildes.
    por_persona = cliente.get(ACEPTACIONES, {"persona": "nunez"}).json()["results"]
    assert {f["persona"]["usuario"] for f in por_persona} == {"anunez"}

    retiradas = cliente.get(ACEPTACIONES, {"estado": "retirada"}).json()["results"]
    assert [f["clave"] for f in retiradas] == [cat.CUMPLEANOS_PUBLICO]
    assert retiradas[0]["estado"] == "retirada" and retiradas[0]["vigente"] is False
    vigentes = cliente.get(ACEPTACIONES, {"estado": "vigente"}).json()["results"]
    assert all(f["vigente"] for f in vigentes)


def test_filtros_invalidos(lectora):
    cliente = client_for(lectora)
    for filtros in ({"clave": "no_existe"}, {"modulo": "Inventado"}, {"estado": "todas"}):
        respuesta = cliente.get(ACEPTACIONES, filtros)
        assert respuesta.status_code == 400
        assert set(respuesta.json()["error"]["details"]) == set(filtros)


def test_el_detalle_trae_el_texto_exacto(lectora, begona, registro):
    aceptacion = AceptacionTexto.objects.filter(
        usuario=begona, texto_proteccion__clave=TELEFONO
    ).get()
    datos = client_for(lectora).get(f"{ACEPTACIONES}{aceptacion.pk}/").json()
    assert datos["texto"] == aceptacion.texto_aceptado
    assert datos["ip"] == "10.0.5.21" and datos["navegador"] == "Firefox"
    assert datos["texto_de_la_version"] is None


def test_el_detalle_de_una_migrada_trae_el_texto_de_su_version(lectora, begona):
    texto = textos.obtener(cat.CUMPLEANOS_PUBLICO)
    migrada = AceptacionTexto.objects.create(
        texto_proteccion=texto,
        usuario=begona,
        version=1,
        aceptado_en=timezone.now(),
        origen="MIGRADA",
    )
    datos = client_for(lectora).get(f"{ACEPTACIONES}{migrada.pk}/").json()
    assert datos["migrada"] is True and datos["texto"] == "" and datos["ip"] is None
    assert datos["texto_de_la_version"]["texto"] == cat.CUMPLEANOS


def test_una_aceptacion_de_otra_empresa_no_existe(lectora, begona):
    otra = Empresa.objects.create(codigo="AJENA", nombre="Ajena")
    with usando_empresa(otra):
        ajena, _ = textos.aceptar(begona, TELEFONO)
    assert client_for(lectora).get(f"{ACEPTACIONES}{ajena.pk}/").status_code == 404
    ids = [f["id"] for f in client_for(lectora).get(ACEPTACIONES).json()["results"]]
    assert ajena.pk not in ids


def test_el_excel_de_aceptaciones_con_los_filtros(lectora, registro, begona):
    # Un navegador que empieza por «=» no se abre como fórmula.
    textos.aceptar(begona, cat.ANIVERSARIO_PUBLICO, navegador="=HYPERLINK(1)")
    respuesta = client_for(lectora).get(f"{ACEPTACIONES}excel/", {"persona": "Begoña"})
    assert respuesta.status_code == 200
    assert respuesta["Content-Type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "aceptaciones-proteccion-datos.xlsx" in respuesta["Content-Disposition"]
    hoja = load_workbook(BytesIO(respuesta.content)).active
    filas = list(hoja.iter_rows(values_only=True))
    assert filas[0][:4] == ("Módulo", "Sección", "Texto", "Persona")
    personas = {f[4] for f in filas[1:]}
    assert personas == {"bpenaherrera"}
    assert len(filas) - 1 == AceptacionTexto.objects.filter(usuario=begona).count()
    assert any(f[8] == "'=HYPERLINK(1)" for f in filas[1:])
    assert AuditLog.objects.filter(action="privacidad.aceptaciones.exportadas").exists()


def test_el_listado_no_hace_una_consulta_por_fila(lectora, registro, django_assert_max_num_queries):
    cliente = client_for(lectora)
    cliente.get(ACEPTACIONES)  # calienta la sesión y los permisos
    with django_assert_max_num_queries(15):
        cliente.get(ACEPTACIONES)


# ── CA-9 · Permisos ───────────────────────────────────────────────────────────


def test_sin_permiso_403_en_todo_lo_de_administrar(begona, nunez):
    cliente = client_for(begona)
    aceptacion, _ = textos.aceptar(nunez, TELEFONO)
    assert cliente.get(TEXTOS).status_code == 403
    assert cliente.get(f"{TEXTOS}{TELEFONO}/versiones/").status_code == 403
    assert _guardar(begona, TELEFONO, texto=NUEVO_TELEFONO).status_code == 403
    assert cliente.get(ACEPTACIONES).status_code == 403
    assert cliente.get(f"{ACEPTACIONES}{aceptacion.pk}/").status_code == 403
    assert cliente.get(f"{ACEPTACIONES}excel/").status_code == 403


def test_ver_no_deja_editar(lectora):
    assert _guardar(lectora, TELEFONO, texto=NUEVO_TELEFONO).status_code == 403


def test_quien_edita_ve_el_catalogo_pero_no_las_aceptaciones(editora):
    cliente = client_for(editora)
    respuesta = cliente.get(TEXTOS)
    assert respuesta.status_code == 200 and respuesta.json()["puede_editar"] is True
    assert cliente.get(f"{TEXTOS}{TELEFONO}/versiones/").status_code == 200
    assert cliente.get(ACEPTACIONES).status_code == 403
    assert cliente.get(f"{ACEPTACIONES}excel/").status_code == 403


def test_gestion_humana_edita_por_su_rol(admin_gh):
    """`roles/0045` da `privacidad.textos` a quien tenía `privacidad.atender`."""
    assert _guardar(admin_gh, TELEFONO, texto=NUEVO_TELEFONO).status_code == 200


# ── Ronda 1 de QA (11/11/2026) ────────────────────────────────────────────────


def test_el_excel_tiene_tope_y_pide_filtrar(lectora, registro, monkeypatch):
    monkeypatch.setattr(textos, "TOPE_EXCEL", 2)
    respuesta = client_for(lectora).get(f"{ACEPTACIONES}excel/")
    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "demasiadas_filas" and "Filtre" in error["message"]
    assert error["details"] == {"tope": 2}
    assert not AuditLog.objects.filter(action="privacidad.aceptaciones.exportadas").exists()
    # Con un filtro que deja menos filas, sale.
    filtrado = client_for(lectora).get(f"{ACEPTACIONES}excel/", {"clave": TELEFONO})
    assert filtrado.status_code == 200


def test_el_excel_lee_por_lotes_y_conserva_el_orden(lectora, registro, monkeypatch):
    monkeypatch.setattr(textos, "LOTE_EXCEL", 1)
    respuesta = client_for(lectora).get(f"{ACEPTACIONES}excel/")
    filas = list(load_workbook(BytesIO(respuesta.content)).active.iter_rows(values_only=True))
    esperadas = list(
        textos.aceptaciones().values_list("usuario__username", "texto_proteccion__nombre")
    )
    assert [(f[4], f[2]) for f in filas[1:]] == esperadas


def test_un_error_de_privacidad_fuera_de_privacidad_sale_con_el_contrato():
    from apps.core.exceptions import api_exception_handler

    respuesta = api_exception_handler(
        PrivacidadError("No hay un texto que aceptar.", code="sin_texto", status=409), {}
    )
    assert respuesta.status_code == 409
    assert respuesta.data == {
        "error": {"code": "sin_texto", "message": "No hay un texto que aceptar.", "details": None}
    }


def test_sin_empresa_el_texto_no_rompe_y_no_se_puede_aceptar(begona):
    """QA-FUNC O-1: sin empresa no hay fila; la pantalla recibe el texto
    inicial sin versión, y aceptar se rechaza."""
    from apps.empresas.contexto import SIN_EMPRESA

    with usando_empresa(SIN_EMPRESA):
        datos = textos.vigente_o_inicial(cat.ACUERDO_CONFIDENCIALIDAD)
        assert datos["version"] is None and datos["titulo"] == cat.ACUERDO_TITULO
        assert datos["texto"] == cat.ACUERDO_TEXTO
        with pytest.raises(PrivacidadError):
            textos.aceptar(begona, cat.ACUERDO_CONFIDENCIALIDAD)


def test_crear_el_primer_aviso_a_la_vez_responde_409(editora, monkeypatch):
    """Si otra persona creó el aviso entre la lectura y el alta, la restricción
    única salta dentro de su savepoint y se responde 409."""
    original = textos.obtener

    def sin_aviso(clave, empresa=None, **opciones):
        if clave == cat.AVISO_PRIVACIDAD and opciones.get("bloquear"):
            return None
        return original(clave, empresa, **opciones)

    monkeypatch.setattr(textos, "obtener", sin_aviso)
    respuesta = _guardar(
        editora, cat.AVISO_PRIVACIDAD, texto="Aviso nuevo de la empresa, completo."
    )
    assert respuesta.status_code == 409
    assert respuesta.json()["error"]["code"] == "conflicto"


def test_la_auditoria_se_guarda_con_el_cambio(editora, monkeypatch):
    """Si la auditoría falla, el cambio no queda: van en la misma transacción."""
    from apps.privacidad import textos as modulo

    def falla(*args, **kwargs):
        raise RuntimeError("auditoría caída")

    antes = textos.obtener(TELEFONO).version
    monkeypatch.setattr(modulo, "_audit", falla)
    with pytest.raises(RuntimeError):
        textos.guardar(TELEFONO, texto=NUEVO_TELEFONO, actor=editora)
    assert textos.obtener(TELEFONO).version == antes


def test_la_autorizacion_memoriza_el_texto_en_la_peticion(begona, nunez):
    """La Mesa de ayuda arma la autorización de cada solicitante: el texto se
    lee una sola vez por petición."""
    from django.db import connection
    from django.test import RequestFactory
    from django.test.utils import CaptureQueriesContext

    from apps.empresas.contexto import _peticion

    peticion = RequestFactory().get("/")
    testigo = _peticion.set(peticion)
    try:
        textos.autorizacion(begona, TELEFONO)
        with CaptureQueriesContext(connection) as consultas:
            textos.autorizacion(nunez, TELEFONO)
        assert len(consultas) == 1  # solo sus aceptaciones
    finally:
        _peticion.reset(testigo)


def test_los_tres_filtros_de_estado_coinciden_con_el_estado_de_cada_fila(
    lectora, admin_gh, begona, nunez
):
    """vigente / retirada (por su titular) / restablecida (por la
    administración, sin retirar), igual que el `estado` de cada fila."""
    textos.aceptar(begona, TELEFONO)
    textos.aceptar(begona, cat.CUMPLEANOS_PUBLICO)
    textos.retirar(begona, cat.CUMPLEANOS_PUBLICO)
    textos.aceptar(nunez, cat.AVISO_PRIVACIDAD)
    textos.restablecer(cat.AVISO_PRIVACIDAD, actor=admin_gh, usuario=nunez)
    cliente = client_for(lectora)

    def de(estado):
        filas = cliente.get(ACEPTACIONES, {"estado": estado, "page_size": 100}).json()["results"]
        assert {f["estado"] for f in filas} <= {estado}
        return {(f["persona"]["usuario"], f["clave"]) for f in filas}

    assert ("bpenaherrera", TELEFONO) in de("vigente")
    assert de("retirada") == {("bpenaherrera", cat.CUMPLEANOS_PUBLICO)}
    assert de("restablecida") == {("anunez", cat.AVISO_PRIVACIDAD)}
    excel = cliente.get(f"{ACEPTACIONES}excel/", {"estado": "restablecida"})
    filas = list(load_workbook(BytesIO(excel.content)).active.iter_rows(values_only=True))
    assert [(f[4], f[10]) for f in filas[1:]] == [("anunez", "Restablecida")]
