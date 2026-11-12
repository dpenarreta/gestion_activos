"""El correo de cada nivel (US-013, CA-1 y CA-3).

- Sale con la plantilla del nivel y sus variables (`{{nombre}}` o `{nombre}`),
  escapadas: ni la descripción ni el texto de quien configura meten HTML.
- Copia al jefe inmediato si el nivel lo pide.
- Un servidor de correo caído no impide emitir; queda «No se pudo enviar».
- El asunto y el cuerpo enviados quedan en el llamado.
"""

from django.core import mail

from apps.llamados import services
from apps.llamados.models import LlamadoAtencion
from apps.llamados.tests.conftest import (
    VARIABLES,
    VISTA_PREVIA,
    cliente,
    emitir,
    releer,
    usuario,
)

MALICIOSO = 'Dijo <script>alert("x")</script> & se fue'


def _emitir_escrito(e, **extra):
    _, escrito, _ = e["niveles"]
    respuesta = emitir(e, nivel=escrito.pk, justificacion_cambio="Reincidencia conocida.", **extra)
    assert respuesta.status_code == 201, respuesta.content
    return releer(e, respuesta.json()["id"])


def test_el_correo_sale_con_las_variables_y_queda_en_el_llamado(e):
    datos = _emitir_escrito(e, descripcion=MALICIOSO)
    assert len(mail.outbox) == 1
    mensaje = mail.outbox[0]
    assert mensaje.to == ["ana@grupolaar.com"]
    assert mensaje.cc == []
    assert mensaje.subject == "Llamado de atención: Atrasos reiterados"
    html = mensaje.alternatives[0][0]
    # Las variables, escapadas en el HTML; el texto plano las lleva tal cual.
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "Ana María Peñafiel" in html
    assert MALICIOSO in mensaje.body
    assert "Carolina" in mensaje.body  # {emitido_por}

    correo = datos["correo"]
    assert correo["enviado"] is True and correo["fecha"]
    assert correo["asunto"] == mensaje.subject
    assert correo["cuerpo"] == mensaje.body
    assert correo["para"] == "ana@grupolaar.com"
    llamado = LlamadoAtencion.objects.get(pk=datos["id"])
    assert llamado.correo_estado == "enviado" and llamado.notificado_en is not None


def test_el_texto_de_la_plantilla_tampoco_lleva_html():
    correo = services.renderizar(
        "Aviso {{causa}}\r\nsegunda línea",
        "<b>Hola</b> {nombre}\n\nPárrafo dos {{monto}} {desconocida}",
        {"causa": "Atrasos", "nombre": "<i>Ana</i>", "monto": "25,00"},
    )
    assert correo["asunto"] == "Aviso Atrasos segunda línea"
    assert "<b>" not in correo["html"] and "&lt;b&gt;Hola&lt;/b&gt;" in correo["html"]
    assert "&lt;i&gt;Ana&lt;/i&gt;" in correo["html"]
    assert correo["html"].count("<p ") == 2
    # Una llave simple que no es variable queda como texto.
    assert "{desconocida}" in correo["texto"]
    assert correo["texto"].startswith("<b>Hola</b> <i>Ana</i>")


def test_copia_al_jefe_inmediato_si_el_nivel_lo_pide(e):
    _, escrito, _ = e["niveles"]
    escrito.copia_jefe = True
    escrito.save()
    datos = _emitir_escrito(e)
    mensaje = mail.outbox[0]
    assert mensaje.to == ["ana@grupolaar.com"]
    assert mensaje.cc == ["julia@grupolaar.com"]
    assert datos["correo"]["copia"] == "julia@grupolaar.com"
    assert "copia al jefe" in datos["historial"][-1]["detalle"]


def test_sin_correo_registrado_queda_constancia(e):
    ana = usuario(e, "ana")
    ana.email = ""
    ana.save(update_fields=["email"])
    datos = _emitir_escrito(e)
    assert mail.outbox == []
    assert datos["estado"] == "emitido"
    assert datos["correo"]["estado"] == "sin_direccion" and datos["correo"]["enviado"] is False


def test_un_servidor_caido_no_impide_emitir(e, monkeypatch, caplog):
    def falla(self, fail_silently=False):
        raise ConnectionRefusedError("smtp caído para ana@grupolaar.com")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", falla)
    datos = _emitir_escrito(e)
    assert datos["estado"] == "emitido"
    assert datos["correo"]["estado"] == "fallido"
    # El registro no lleva la dirección de la persona.
    assert "ana@grupolaar.com" not in caplog.text


def test_la_sancion_lleva_el_monto(e):
    _, _, sancion = e["niveles"]
    emitir(e, nivel=sancion.pk, justificacion_cambio="Falta grave.", monto="1250,5")
    assert "USD 1.250,50" in mail.outbox[0].body


def test_variables_y_vista_previa(e):
    variables = cliente(e, "carolina").get(VARIABLES).json()
    claves = {v["clave"] for v in variables}
    assert {
        "nombre",
        "apellidos",
        "causa",
        "nivel",
        "fecha_hecho",
        "descripcion",
        "monto",
        "empresa",
        "emitido_por",
    } <= claves
    assert next(v for v in variables if v["clave"] == "nombre")["marcador"] == "{{nombre}}"
    assert cliente(e, "julia").get(VARIABLES).status_code == 403

    previa = cliente(e, "carolina").post(
        VISTA_PREVIA,
        {"asunto": "Aviso: {causa}", "cuerpo": "Hola {{nombre}} {{inventada}}"},
        format="json",
    )
    assert previa.status_code == 200
    datos = previa.json()
    assert datos["asunto"].startswith("Aviso: Incumplimiento")
    assert "María José" in datos["texto"]
    assert datos["desconocidas"] == ["inventada"]
    assert cliente(e, "victor").post(VISTA_PREVIA, {}, format="json").status_code == 403
