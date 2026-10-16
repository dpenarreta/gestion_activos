"""Plantillas de correo editables desde Configuración.

Lo que se protege: que una plantilla personalizada sea la que de verdad sale,
que no pueda leer más datos que sus variables (el contexto es plano y se
escapa), que la vista previa muestre lo mismo que llega y que solo quien
puede editar la configuración la cambie.
"""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core import mail
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.correos import catalogo, motor, servicio
from apps.correos.models import PlantillaCorreo
from apps.permissions.models import ModulePermission
from apps.users.models import User

BASE = "/api/v1/configuracion/correos/plantillas/"


# --- El motor --------------------------------------------------------------------------


def test_las_variables_se_escapan_y_las_desconocidas_quedan_vacias():
    salida = motor.renderizar("Hola {{ nombre }}{{no_existe}}.", {"nombre": "<b>Ana</b>"})
    assert salida == "Hola &lt;b&gt;Ana&lt;/b&gt;."


def test_los_bloques_html_del_sistema_van_sin_escapar():
    salida = motor.renderizar(
        "{{tabla}}", {"tabla": "<table></table>"}, html_crudo=frozenset({"tabla"})
    )
    assert salida == "<table></table>"


def test_secciones_si_hay_valor_y_si_no():
    plantilla = "{{#causa}}Causa: {{causa}}{{/causa}}{{^causa}}Sin causa{{/causa}}"
    assert motor.renderizar(plantilla, {"causa": "No enciende"}) == "Causa: No enciende"
    assert motor.renderizar(plantilla, {"causa": ""}) == "Sin causa"
    # «0» cuenta como vacío: cero alertas es justamente no tener nada que listar.
    assert motor.renderizar("{{#n}}hay{{/n}}{{^n}}nada{{/n}}", {"n": "0"}) == "nada"


def test_secciones_anidadas():
    plantilla = "{{#a}}A{{#b}}B{{/b}}{{/a}}"
    assert motor.renderizar(plantilla, {"a": "1", "b": "1"}) == "AB"
    assert motor.renderizar(plantilla, {"a": "1", "b": ""}) == "A"


def test_el_texto_plano_conserva_los_enlaces():
    texto = motor.a_texto_plano(
        '<p>Hola</p><p><a href="https://x.com/r?token=abc">Restablecer</a></p>'
    )
    assert "Restablecer: https://x.com/r?token=abc" in texto


def test_todas_las_plantillas_por_defecto_se_dibujan_sin_variables_sueltas(db):
    for plantilla in catalogo.PLANTILLAS:
        correo = servicio.renderizar(plantilla.clave, servicio.ejemplo(plantilla.clave))
        assert "{{" not in correo["html"], plantilla.clave
        assert "{{" not in correo["asunto"], plantilla.clave
        assert correo["texto"].strip(), plantilla.clave
        assert (
            servicio.variables_desconocidas(plantilla.clave, plantilla.asunto, plantilla.html) == []
        )


# --- Lo personalizado es lo que sale ---------------------------------------------------


@pytest.mark.django_db
def test_una_plantilla_personalizada_es_la_que_se_envia():
    PlantillaCorreo.objects.create(
        clave="acceso.contrasena_cambiada",
        asunto="Aviso de seguridad para {{nombre}}",
        html="<html><body><h1>Diseño propio</h1><p>{{correo}} · {{modulo}}</p></body></html>",
    )
    usuario = User.objects.create_user(
        username="ana", email="ana@x.com", password="Sup3r-Secr3t!", first_name="Ana"
    )
    from apps.authentication.emails import send_password_changed_notification

    send_password_changed_notification(user=usuario)

    correo = mail.outbox[0]
    assert correo.subject == "Aviso de seguridad para Ana"
    html = correo.alternatives[0][0]
    assert "Diseño propio" in html and "ana@x.com · Acceso al sistema" in html
    assert "Diseño propio" in correo.body


# --- La API ----------------------------------------------------------------------------


def _cuenta(nombre, *permisos):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@x.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission), codename__in=permisos
        )
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.mark.django_db
def test_lista_todos_los_correos_con_su_modulo():
    datos = _cuenta("lectora", "configuracion.ver").get(BASE).json()
    assert len(datos) == len(catalogo.PLANTILLAS)
    resumen = next(d for d in datos if d["clave"] == "matriz.escalamiento")
    assert resumen["modulo"] == "Matriz de obligaciones"
    assert resumen["personalizada"] is False


@pytest.mark.django_db
def test_el_detalle_trae_las_variables_comunes_y_propias():
    datos = _cuenta("lectora", "configuracion.ver").get(f"{BASE}solicitudes.recibida/").json()
    nombres = {v["nombre"]: v for v in datos["variables"]}
    assert {
        "sistema",
        "empresa",
        "asunto",
        "modulo",
        "razon",
        "nombre",
        "correo",
        "que_se_pide",
    } <= set(nombres)
    assert nombres["asunto"]["comun"] is True and nombres["numero"]["comun"] is False
    assert datos["html"] == datos["html_por_defecto"]


@pytest.mark.django_db
def test_solo_quien_edita_la_configuracion_guarda_y_restablece():
    lectora = _cuenta("lectora", "configuracion.ver")
    editora = _cuenta("editora", "configuracion.ver", "configuracion.editar")
    url = f"{BASE}mantenimientos.entrada/"
    borrador = {"asunto": "Taller: {{codigo}}", "html": "<p>{{equipo}}</p>"}

    assert lectora.put(url, borrador, format="json").status_code == 403
    respuesta = editora.put(url, borrador, format="json")
    assert respuesta.status_code == 200
    assert respuesta.json()["personalizada"] is True
    assert AuditLog.objects.filter(
        action="plantilla_correo.guardada", target_id="mantenimientos.entrada"
    ).exists()

    assert editora.delete(url).json()["personalizada"] is False
    assert not PlantillaCorreo.objects.filter(clave="mantenimientos.entrada").exists()


@pytest.mark.django_db
def test_la_vista_previa_usa_el_borrador_y_avisa_de_variables_que_no_existen():
    lectora = _cuenta("lectora", "configuracion.ver")
    respuesta = lectora.post(
        f"{BASE}mantenimientos.salida/vista-previa/",
        {"asunto": "Vuelve {{codigo}}", "html": "<p>{{equipo}} {{inventada}}</p>"},
        format="json",
    )
    datos = respuesta.json()
    assert respuesta.status_code == 200
    assert datos["asunto"] == "Vuelve ACT-000123"
    assert "Laptop Dell Latitude 5440" in datos["html"]
    assert datos["desconocidas"] == ["inventada"]
    # Ver no guarda nada.
    assert not PlantillaCorreo.objects.exists()


@pytest.mark.django_db
def test_la_prueba_llega_solo_a_quien_la_pide():
    editora = _cuenta("editora", "configuracion.ver", "configuracion.editar")
    respuesta = editora.post(f"{BASE}matriz.vencimiento/prueba/")
    assert respuesta.status_code == 200
    assert mail.outbox[0].to == ["editora@x.com"]
    assert mail.outbox[0].subject.startswith("[PRUEBA] Hoy vence")


@pytest.mark.django_db
def test_un_correo_que_no_existe_da_404_y_un_html_gigante_se_rechaza():
    editora = _cuenta("editora", "configuracion.ver", "configuracion.editar")
    assert editora.get(f"{BASE}no.existe/").status_code == 404
    respuesta = editora.put(
        f"{BASE}acceso.contrasena_cambiada/", {"asunto": "x", "html": "a" * 300_001}, format="json"
    )
    assert respuesta.status_code == 400
