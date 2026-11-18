"""Sanción en porcentaje del sueldo o monto fijo, tope y razón del reglamento
(US-033, 18/11/2026).

- Una sanción económica se expresa como monto fijo (USD, como antes) o como
  porcentaje del sueldo: con porcentaje el monto queda «por calcular» (CA-1 a
  CA-3).
- Talento Humano configura un tope en % por empresa (`llamados.configurar`);
  un porcentaje que lo supera se rechaza en el campo del porcentaje (CA-4).
- La razón: un documento institucional activo de la empresa y el artículo; el
  título se conserva aunque el documento cambie (CA-5 y CA-6).
- El nivel sugiere un porcentaje o un monto (CA-7); las variables del correo
  llevan la sanción y la razón (CA-8); lo anterior sigue igual (CA-9).
"""

import importlib

import pytest
from django.apps import apps as django_apps
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.core.models import AuditLog
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.licencias.tests.test_licencias import _persona
from apps.llamados.models import LlamadoAtencion, NivelLlamado
from apps.llamados.tests.conftest import (
    BASE,
    CAUSAS,
    LLAMADOS,
    MIOS,
    PROPUESTA,
    VARIABLES,
    accion,
    cliente,
    codigo,
    detalles,
    emitir,
    hace,
    releer,
    usuario,
)
from apps.organizacion.models import DocumentoInstitucional

CONFIGURACION = f"{BASE}configuracion/"
DOCUMENTOS = f"{BASE}documentos/"
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
JUSTIFICACION = {"justificacion_cambio": "Falta grave: se aplica directamente la sanción."}


@pytest.fixture(autouse=True)
def _medios(tmp_path):
    with override_settings(MEDIA_ROOT=tmp_path):
        yield


def _documento(titulo="Reglamento interno", categoria="disciplinario", activo=True, empresa=None):
    datos = {
        "titulo": titulo,
        "categoria": categoria,
        "archivo": SimpleUploadedFile("reglamento.pdf", PDF, content_type="application/pdf"),
        "nombre_original": "reglamento.pdf",
        "tamano_bytes": len(PDF),
        "content_type": "application/pdf",
        "activo": activo,
    }
    if empresa is not None:
        with usando_empresa(empresa):
            return DocumentoInstitucional.objects.create(**datos)
    return DocumentoInstitucional.objects.create(**datos)


def _sancion(e, **extra):
    """Emite el nivel de sanción económica (con justificación: no es el propuesto)."""
    _, _, sancion = e["niveles"]
    return emitir(e, nivel=sancion.pk, **JUSTIFICACION, **extra)


def _tope(e, valor, quien="carolina"):
    return cliente(e, quien).put(CONFIGURACION, {"tope_porcentaje": valor}, format="json")


# --- CA-1 y CA-2: porcentaje del sueldo ------------------------------------------------------


def test_sancion_en_porcentaje_deja_el_monto_por_calcular(e):
    respuesta = _sancion(e, forma_sancion="porcentaje", porcentaje="12,5")
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["forma_sancion"] == "porcentaje"
    assert datos["forma_sancion_display"] == "Porcentaje del sueldo (%)"
    assert datos["porcentaje"] == "12.50"
    assert datos["monto"] is None
    assert datos["monto_por_calcular"] is True
    assert datos["sancion_texto"] == "12,5 % del sueldo"
    llamado = LlamadoAtencion.objects.get(pk=datos["id"])
    assert llamado.monto is None and str(llamado.porcentaje) == "12.50"


def test_el_porcentaje_va_de_0_a_100_con_dos_decimales(e):
    _, _, sancion = e["niveles"]
    for valor in ("0", "-3", "100,01", "5,555", "abc"):
        respuesta = _sancion(
            e, forma_sancion="porcentaje", porcentaje=valor, descripcion=f"Prueba {valor}"
        )
        assert respuesta.status_code == 400, valor
        assert codigo(respuesta) == "invalid"
        assert "porcentaje" in detalles(respuesta), valor
    cien = _sancion(e, forma_sancion="porcentaje", porcentaje="100", descripcion="Cien.")
    assert cien.status_code == 201, cien.content
    assert cien.json()["sancion_texto"] == "100 % del sueldo"
    # Sin porcentaje ni porcentaje sugerido: se pide.
    sin = _sancion(e, forma_sancion="porcentaje", descripcion="Sin porcentaje.")
    assert sin.status_code == 400 and "porcentaje" in detalles(sin)
    assert sancion.porcentaje_sugerido is None


def test_monto_y_porcentaje_a_la_vez_piden_elegir_la_forma(e):
    ambos = _sancion(e, monto="10", porcentaje="5")
    assert ambos.status_code == 400 and "forma_sancion" in detalles(ambos)
    # Con la forma elegida, el otro valor se ignora.
    elegido = _sancion(e, forma_sancion="porcentaje", monto="10", porcentaje="5")
    assert elegido.status_code == 201, elegido.content
    assert elegido.json()["monto"] is None and elegido.json()["porcentaje"] == "5.00"
    invalida = _sancion(e, forma_sancion="sueldo", descripcion="Forma inválida.")
    assert invalida.status_code == 400 and "forma_sancion" in detalles(invalida)


def test_un_nivel_que_no_es_sancion_no_lleva_forma_ni_porcentaje(e):
    respuesta = emitir(e, forma_sancion="porcentaje", porcentaje="5")
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["forma_sancion"] is None and datos["porcentaje"] is None
    assert datos["sancion_texto"] == "" and datos["monto_por_calcular"] is False


# --- CA-3: monto fijo, como hoy --------------------------------------------------------------


def test_monto_fijo_se_comporta_como_antes(e):
    sugerido = _sancion(e)
    assert sugerido.status_code == 201, sugerido.content
    datos = sugerido.json()
    assert datos["forma_sancion"] == "monto" and datos["monto"] == "25.00"
    assert datos["porcentaje"] is None and datos["monto_por_calcular"] is False
    assert datos["sancion_texto"] == "25,00 USD"
    propio = _sancion(e, forma_sancion="monto", monto="1250,5", descripcion="Otro atraso.")
    assert propio.json()["monto"] == "1250.50"
    assert propio.json()["sancion_texto"] == "1.250,50 USD"
    cero = _sancion(e, forma_sancion="monto", monto="0", descripcion="Tercer atraso.")
    assert cero.status_code == 400 and "monto" in detalles(cero)


# --- CA-4: el tope por empresa ---------------------------------------------------------------


def test_el_tope_rechaza_un_porcentaje_mayor_en_el_campo_del_porcentaje(e):
    assert _tope(e, "10").status_code == 200
    mayor = _sancion(e, forma_sancion="porcentaje", porcentaje="10,01")
    assert mayor.status_code == 400
    assert codigo(mayor) == "invalid"
    mensaje = str(detalles(mayor)["porcentaje"])
    assert "tope" in mensaje and "10 % del sueldo" in mensaje
    igual = _sancion(e, forma_sancion="porcentaje", porcentaje="10", descripcion="En el tope.")
    assert igual.status_code == 201, igual.content
    # El monto fijo no se compara con el tope (no hay sueldo con qué).
    fijo = _sancion(e, forma_sancion="monto", monto="500", descripcion="Monto fijo.")
    assert fijo.status_code == 201, fijo.content
    # Sin tope, vuelve a valer hasta 100.
    assert _tope(e, None).json()["tope_porcentaje"] is None
    alto = _sancion(e, forma_sancion="porcentaje", porcentaje="40", descripcion="Sin tope.")
    assert alto.status_code == 201, alto.content


def test_configurar_el_tope_lo_lee_quien_emite_y_lo_cambia_quien_configura(e):
    leido = cliente(e, "carolina").get(CONFIGURACION)
    assert leido.status_code == 200
    assert leido.json() == {
        "tope_porcentaje": None,
        "actualizado_por": None,
        "actualizado_en": None,
    }
    guardado = _tope(e, "15,5")
    assert guardado.status_code == 200, guardado.content
    datos = guardado.json()
    assert datos["tope_porcentaje"] == "15.50"
    assert datos["actualizado_por"]["nombre"] == "Carolina" and datos["actualizado_en"]
    assert AuditLog.objects.filter(action="llamados.configuracion.editada").exists()

    _, solo_emite = _persona("eduardo", "llamados.emitir")
    assert solo_emite.get(CONFIGURACION).json()["tope_porcentaje"] == "15.50"
    assert solo_emite.put(CONFIGURACION, {"tope_porcentaje": "50"}, format="json").status_code == (
        403
    )
    for quien in ("julia", "victor", "nadia"):
        assert cliente(e, quien).get(CONFIGURACION).status_code == 403, quien
        assert _tope(e, "50", quien=quien).status_code == 403, quien

    for valor in ("0", "100,5", "7,125", "diez"):
        invalido = _tope(e, valor)
        assert invalido.status_code == 400, valor
        assert "tope_porcentaje" in detalles(invalido), valor
    assert cliente(e, "carolina").put(CONFIGURACION, {}, format="json").status_code == 400
    assert _tope(e, "").json()["tope_porcentaje"] is None


def test_el_tope_es_de_cada_empresa(e):
    _tope(e, "10")
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    from apps.llamados import services

    with usando_empresa(otra):
        assert services.tope_porcentaje() is None
    assert str(services.tope_porcentaje()) == "10.00"


def test_el_tope_tambien_vale_al_confirmar(e):
    _tope(e, "8")
    pedido = emitir(e, quien="julia").json()
    _, _, sancion = e["niveles"]
    datos = {"nivel": sancion.pk, **JUSTIFICACION, "forma_sancion": "porcentaje"}
    mayor = accion(e, "carolina", pedido["id"], "confirmar", {**datos, "porcentaje": "9"})
    assert mayor.status_code == 400 and "porcentaje" in detalles(mayor)
    assert LlamadoAtencion.objects.get(pk=pedido["id"]).estado == "solicitado"
    bien = accion(e, "carolina", pedido["id"], "confirmar", {**datos, "porcentaje": "7,5"})
    assert bien.status_code == 200, bien.content
    assert bien.json()["estado"] == "emitido"
    assert bien.json()["sancion_texto"] == "7,5 % del sueldo"


# --- CA-5 y CA-6: la razón del reglamento ----------------------------------------------------


def test_la_razon_se_guarda_con_el_titulo_conservado(e):
    documento = _documento()
    respuesta = emitir(e, documento=documento.pk, articulo="  Art. 45, lit. c  ")
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["articulo"] == "Art. 45, lit. c"
    assert datos["razon"] == "Reglamento interno, Art. 45, lit. c"
    assert datos["documento"] == {
        "id": documento.pk,
        "titulo": "Reglamento interno",
        "categoria": "disciplinario",
        "categoria_display": "Reglamento disciplinario",
        "es_pdf": True,
        "disponible": True,
        "url": f"/organizacion/documentos/{documento.pk}/archivo/",
    }
    # El documento cambia de título: el llamado conserva el de entonces.
    documento.titulo = "Reglamento interno de trabajo 2027"
    documento.save()
    assert releer(e, datos["id"])["documento"]["titulo"] == "Reglamento interno"
    # Se retira: sigue el título, pero ya no se ofrece abrirlo.
    documento.activo = False
    documento.save()
    retirado = releer(e, datos["id"])["documento"]
    assert retirado["titulo"] == "Reglamento interno" and retirado["disponible"] is False
    assert retirado["url"] is None
    # Se borra: queda el título y el artículo.
    documento.delete()
    borrado = releer(e, datos["id"])
    assert borrado["documento"]["id"] is None
    assert borrado["documento"]["titulo"] == "Reglamento interno"
    assert borrado["razon"] == "Reglamento interno, Art. 45, lit. c"


def test_la_razon_y_la_sancion_salen_en_la_lista_y_en_mi_perfil(e):
    documento = _documento("Código de conducta", categoria="conducta")
    creado = _sancion(
        e, forma_sancion="porcentaje", porcentaje="5", documento=documento.pk, articulo="Num. 3.2"
    ).json()
    fila = next(f for f in cliente(e, "carolina").get(LLAMADOS).json() if f["id"] == creado["id"])
    assert fila["sancion_texto"] == "5 % del sueldo"
    assert fila["documento"]["titulo"] == "Código de conducta"
    assert fila["articulo"] == "Num. 3.2"
    mio = next(m for m in cliente(e, "ana").get(MIOS).json() if m["id"] == creado["id"])
    assert mio["sancion_texto"] == "5 % del sueldo" and mio["monto_por_calcular"] is True
    assert mio["razon"] == "Código de conducta, Num. 3.2"


def test_validaciones_de_la_razon(e):
    activo = _documento()
    retirado = _documento("Reglamento anterior", activo=False)
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    ajeno = _documento("Reglamento de otra empresa", empresa=otra)
    casos = [
        ({"documento": retirado.pk, "articulo": "Art. 1"}, "documento"),
        ({"documento": ajeno.pk, "articulo": "Art. 1"}, "documento"),
        ({"documento": 999999, "articulo": "Art. 1"}, "documento"),
        ({"articulo": "Art. 1"}, "documento"),
        ({"documento": activo.pk}, "articulo"),
        ({"documento": activo.pk, "articulo": "   "}, "articulo"),
        ({"documento": activo.pk, "articulo": "Ñ" * 121}, "articulo"),
        ({"documento": "abc", "articulo": "Art. 1"}, "documento"),
    ]
    for i, (extra, campo) in enumerate(casos):
        respuesta = emitir(e, descripcion=f"Caso {i}.", **extra)
        assert respuesta.status_code == 400, (extra, respuesta.content)
        assert campo in detalles(respuesta), extra
    # El documento de otra empresa no se revela: mismo mensaje que uno inexistente.
    a = emitir(e, descripcion="Ajeno.", documento=ajeno.pk, articulo="Art. 1")
    b = emitir(e, descripcion="Inexistente.", documento=999999, articulo="Art. 1")
    assert detalles(a) == detalles(b)
    assert LlamadoAtencion.objects.count() == 0
    # Sin documento ni artículo: sin razón (es opcional).
    sin = emitir(e, descripcion="Sin razón.", documento="", articulo="")
    assert sin.status_code == 201 and sin.json()["documento"] is None
    assert sin.json()["razon"] == ""


def test_la_razon_va_tambien_en_multipart(e):
    documento = _documento()
    _, _, sancion = e["niveles"]
    respuesta = emitir(
        e,
        formato="multipart",
        nivel=sancion.pk,
        forma_sancion="porcentaje",
        porcentaje="2,75",
        monto="",
        documento=documento.pk,
        articulo="Art. 12",
        **JUSTIFICACION,
    )
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["porcentaje"] == "2.75" and datos["documento"]["id"] == documento.pk


def test_documentos_elegibles_para_quien_emite_o_solicita(e):
    _documento("Reglamento interno")
    _documento("Código de conducta", categoria="conducta")
    _documento("Reglamento anterior", activo=False)
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    _documento("Reglamento de otra empresa", empresa=otra)
    lista = cliente(e, "carolina").get(DOCUMENTOS)
    assert lista.status_code == 200
    assert [d["titulo"] for d in lista.json()] == ["Código de conducta", "Reglamento interno"]
    assert set(lista.json()[0]) == {
        "id",
        "titulo",
        "categoria",
        "categoria_display",
        "version",
        "es_pdf",
    }
    assert cliente(e, "julia").get(DOCUMENTOS).status_code == 200
    for quien in ("victor", "nadia"):
        respuesta = cliente(e, quien).get(DOCUMENTOS)
        assert respuesta.status_code == 403 and codigo(respuesta) == "permission_denied"


def test_el_jefe_registra_la_razon_pero_no_la_sancion_y_gh_la_ajusta(e):
    documento = _documento()
    otro = _documento("Código de conducta", categoria="conducta")
    _, _, sancion = e["niveles"]
    pedido = emitir(
        e,
        quien="julia",
        nivel=sancion.pk,
        forma_sancion="porcentaje",
        porcentaje="30",
        documento=documento.pk,
        articulo="Art. 45",
    )
    assert pedido.status_code == 201, pedido.content
    datos = pedido.json()
    assert datos["estado"] == "solicitado"
    assert datos["porcentaje"] is None and datos["monto"] is None
    assert datos["articulo"] == "Art. 45"
    # Confirmar sin tocar la razón la conserva.
    confirmado = accion(
        e,
        "carolina",
        datos["id"],
        "confirmar",
        {"nivel": sancion.pk, **JUSTIFICACION, "forma_sancion": "porcentaje", "porcentaje": "5"},
    )
    assert confirmado.status_code == 200, confirmado.content
    assert confirmado.json()["razon"] == "Reglamento interno, Art. 45"
    assert confirmado.json()["sancion_texto"] == "5 % del sueldo"

    # Otra solicitud: al confirmar se cambia la razón, y en una tercera se quita.
    segundo = emitir(
        e, quien="julia", descripcion="Otro hecho.", documento=documento.pk, articulo="Art. 46"
    ).json()
    cambiado = accion(
        e, "carolina", segundo["id"], "confirmar", {"documento": otro.pk, "articulo": "Num. 2"}
    )
    assert cambiado.status_code == 200, cambiado.content
    assert cambiado.json()["razon"] == "Código de conducta, Num. 2"
    tercero = emitir(
        e, quien="julia", descripcion="Tercer hecho.", documento=documento.pk, articulo="Art. 47"
    ).json()
    quitado = accion(e, "carolina", tercero["id"], "confirmar", {"documento": None, "articulo": ""})
    assert quitado.status_code == 200, quitado.content
    assert quitado.json()["documento"] is None and quitado.json()["articulo"] == ""


def test_al_confirmar_se_conserva_el_documento_del_jefe_aunque_se_haya_retirado(e):
    """QA funcional (US-033, O-1): la web reenvía el documento que ya tenía;
    retirado después, se conserva con su título y no se rechaza. Un documento
    retirado distinto del que tenía sí se rechaza."""
    documento = _documento()
    retirado_aparte = _documento("Norma vieja", activo=False)
    pedido = emitir(e, quien="julia", documento=documento.pk, articulo="Art. 45").json()
    documento.activo = False
    documento.save()
    confirmado = accion(
        e, "carolina", pedido["id"], "confirmar", {"documento": documento.pk, "articulo": "Art. 45"}
    )
    assert confirmado.status_code == 200, confirmado.content
    assert confirmado.json()["razon"] == "Reglamento interno, Art. 45"
    assert confirmado.json()["documento"]["disponible"] is False

    otro = emitir(e, quien="julia", descripcion="Otro.", documento=None, articulo="").json()
    rechazado = accion(
        e,
        "carolina",
        otro["id"],
        "confirmar",
        {"documento": retirado_aparte.pk, "articulo": "Art. 1"},
    )
    assert rechazado.status_code == 400


# --- CA-7: el nivel sugiere un porcentaje o un monto -----------------------------------------


def test_el_nivel_sugiere_un_porcentaje_o_un_monto(e):
    causa = e["causa"]
    verbal, escrito, sancion = e["niveles"]

    def niveles(**cambios):
        return [
            {"id": verbal.pk, "nombre": verbal.nombre, "tipo": "verbal", "envia_correo": False},
            {
                "id": escrito.pk,
                "nombre": escrito.nombre,
                "tipo": "escrito",
                "envia_correo": True,
                "asunto": escrito.asunto,
                "cuerpo": escrito.cuerpo,
                "porcentaje_sugerido": "5",
            },
            {
                "id": sancion.pk,
                "nombre": sancion.nombre,
                "tipo": "sancion_economica",
                "envia_correo": True,
                "asunto": sancion.asunto,
                "cuerpo": sancion.cuerpo,
                **cambios,
            },
        ]

    url = f"{CAUSAS}{causa.pk}/"
    configura = cliente(e, "carolina")
    ambos = configura.patch(
        url, {"niveles": niveles(monto_sugerido="25", porcentaje_sugerido="5")}, format="json"
    )
    assert ambos.status_code == 400
    assert "porcentaje_sugerido" in detalles(ambos)["niveles"]["2"]
    fuera = configura.patch(url, {"niveles": niveles(porcentaje_sugerido="101")}, format="json")
    assert fuera.status_code == 400
    assert "porcentaje_sugerido" in detalles(fuera)["niveles"]["2"]

    # Solo el porcentaje: el monto sugerido que tenía se limpia.
    guardado = configura.patch(url, {"niveles": niveles(porcentaje_sugerido="7,5")}, format="json")
    assert guardado.status_code == 200, guardado.content
    respuesta = guardado.json()["niveles"]
    assert respuesta[1]["porcentaje_sugerido"] is None  # no es sanción
    assert respuesta[2]["porcentaje_sugerido"] == "7.50"
    assert respuesta[2]["monto_sugerido"] is None
    assert respuesta[2]["forma_sugerida"] == "porcentaje"
    assert respuesta[0]["forma_sugerida"] is None
    sancion.refresh_from_db()
    assert sancion.monto_sugerido is None and str(sancion.porcentaje_sugerido) == "7.50"

    # El formulario parte del porcentaje sugerido.
    propuesta = configura.get(
        PROPUESTA, {"persona": usuario(e, "ana").pk, "causa": causa.pk}
    ).json()
    final = next(n for n in propuesta["niveles"] if n["id"] == sancion.pk)
    assert final["porcentaje_sugerido"] == "7.50" and final["forma_sugerida"] == "porcentaje"
    assert propuesta["tope_porcentaje"] is None
    emitido = _sancion(e)
    assert emitido.status_code == 201, emitido.content
    assert emitido.json()["forma_sancion"] == "porcentaje"
    assert emitido.json()["porcentaje"] == "7.50"

    # Con un tope menor, el porcentaje sugerido tampoco se puede guardar.
    _tope(e, "5")
    tope = configura.patch(url, {"niveles": niveles(porcentaje_sugerido="7,5")}, format="json")
    assert tope.status_code == 400
    assert "5 % del sueldo" in str(detalles(tope)["niveles"]["2"]["porcentaje_sugerido"])
    # Volver al monto limpia el porcentaje.
    monto = configura.patch(url, {"niveles": niveles(monto_sugerido="30")}, format="json")
    assert monto.status_code == 200, monto.content
    assert monto.json()["niveles"][2]["porcentaje_sugerido"] is None
    assert monto.json()["niveles"][2]["forma_sugerida"] == "monto"


# --- CA-8: variables del correo --------------------------------------------------------------


def _plantilla(nivel, cuerpo):
    nivel.cuerpo = cuerpo
    nivel.save(update_fields=["cuerpo"])


def test_el_correo_lleva_la_sancion_y_la_razon(e):
    _, _, sancion = e["niveles"]
    _plantilla(sancion, "{{nombre}}: sanción de {{sancion}}. Razón: {{razon}}.")
    documento = _documento()
    _sancion(
        e,
        forma_sancion="porcentaje",
        porcentaje="5",
        documento=documento.pk,
        articulo="Art. 45, lit. c",
    )
    assert "sanción de 5 % del sueldo" in mail.outbox[-1].body
    assert "Razón: Reglamento interno, Art. 45, lit. c." in mail.outbox[-1].body

    _sancion(e, forma_sancion="monto", monto="25", descripcion="Otro hecho.")
    assert "sanción de 25,00 USD" in mail.outbox[-1].body


def test_las_variables_nuevas_y_las_de_siempre(e):
    claves = {v["clave"] for v in cliente(e, "carolina").get(VARIABLES).json()}
    assert {"monto", "porcentaje", "sancion", "documento", "articulo", "razon"} <= claves
    # La plantilla vieja con {monto} sigue funcionando con un monto fijo.
    _sancion(e, monto="1250,5")
    assert "USD 1.250,50" in mail.outbox[-1].body


# --- CA-9: lo anterior sigue igual -----------------------------------------------------------


def test_los_llamados_existentes_quedan_en_monto_fijo_sin_documento(e):
    _, escrito, sancion = e["niveles"]
    comun = dict(
        persona=usuario(e, "ana"),
        causa=e["causa"],
        causa_nombre=e["causa"].nombre,
        fecha_hecho=hace(3),
        descripcion="Registrado antes de US-033.",
        estado="emitido",
    )
    viejo_sancion = LlamadoAtencion.objects.create(
        nivel=sancion,
        nivel_nombre=sancion.nombre,
        nivel_tipo="sancion_economica",
        monto="25.00",
        **comun,
    )
    viejo_escrito = LlamadoAtencion.objects.create(
        nivel=escrito, nivel_nombre=escrito.nombre, nivel_tipo="escrito", **comun
    )
    migracion = importlib.import_module(
        "apps.llamados.migrations.0003_sancion_en_porcentaje_y_razon"
    )
    migracion.sin_forma_fuera_de_las_sanciones(django_apps, None)
    viejo_sancion.refresh_from_db()
    viejo_escrito.refresh_from_db()
    assert viejo_sancion.forma_sancion == "monto" and viejo_sancion.documento_id is None
    assert viejo_sancion.porcentaje is None and viejo_sancion.articulo == ""
    assert viejo_escrito.forma_sancion == ""
    detalle = releer(e, viejo_sancion.pk)
    assert detalle["sancion_texto"] == "25,00 USD" and detalle["documento"] is None
    assert NivelLlamado.objects.filter(porcentaje_sugerido__isnull=False).count() == 0
