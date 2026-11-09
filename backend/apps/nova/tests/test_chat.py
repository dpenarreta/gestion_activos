"""El chat de Nova: modos, permisos, historial, privacidad y respuestas sin
IA. Proveedor siempre falso (`proveedor_falso`)."""

import json
from datetime import UTC, datetime

import pytest
from django.contrib.auth.models import Group, Permission

from apps.informes.tests.conftest import client_for, congelar, make_user, organigrama, tarea
from apps.nova import ajustes, chat
from apps.nova.conocimiento import terminos
from apps.nova.models import DocumentoConocimiento, FragmentoConocimiento, UsoNova
from apps.permissions.authorization import user_has_permission
from apps.users.models import User

pytestmark = pytest.mark.django_db

AHORA = datetime(2026, 10, 20, 15, tzinfo=UTC)
URL = "/api/v1/nova/chat/"


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    congelar(monkeypatch, AHORA)


def _pedir(usuario, **cuerpo):
    return client_for(usuario).post(URL, cuerpo, format="json")


def _datos_enviados(proveedor) -> dict:
    """El JSON del último turno (contexto y pregunta) del último pedido."""
    return json.loads(proveedor.pedidos[-1]["messages"][-1]["content"])


def _con_permiso(usuario, *codenames):
    grupo, _ = Group.objects.get_or_create(name=f"prueba-{usuario.pk}")
    grupo.permissions.add(
        *Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
    )
    usuario.groups.add(grupo)


def _documento(titulo: str, *textos: str) -> DocumentoConocimiento:
    documento = DocumentoConocimiento.objects.create(
        titulo=titulo, archivo="nova/conocimiento/x.pdf", nombre_original="x.pdf", tamano_bytes=1
    )
    for orden, texto in enumerate(textos):
        FragmentoConocimiento.objects.create(
            empresa=documento.empresa,
            documento=documento,
            orden=orden,
            pagina=orden + 1,
            texto=texto,
            terminos=" ".join(terminos(texto)),
        )
    return documento


# ── Permisos y validación ───────────────────────────────────────────────────


def _sin_regla(usuario):
    """Desactiva «Responder solo con las fuentes» (comportamiento anterior)."""
    ajustes.cambiar_solo_fuentes(False, usuario)


def _tiene(usuario, codename):
    return user_has_permission(User.objects.get(pk=usuario.pk), codename)


def test_los_roles_de_gestion_humana_reciben_el_chat(ana, nino, jefa, admin_gh):
    """`roles/0042`: el chat a quien tiene Tareas o KPI; el modo Equipo a
    quien ya ve al equipo; gestionar la base, al Administrador de GH."""
    assert _tiene(ana, "nova.chat") and _tiene(ana, "nova.conocimiento_ver")
    # El Asistente no ve al equipo (sin `equipo.ver` ni `kpi.equipo`).
    assert _tiene(nino, "nova.chat") and not _tiene(nino, "nova.chat_equipo")
    assert _tiene(jefa, "nova.chat_equipo") and _tiene(ana, "nova.chat_equipo")
    assert _tiene(admin_gh, "nova.conocimiento_gestionar")
    assert not _tiene(ana, "nova.conocimiento_gestionar")
    ti = Group.objects.filter(name="Administrador").first()
    if ti is not None:
        assert not ti.permissions.filter(codename__startswith="nova.").exists()


def test_sin_permiso_no_entra(proveedor_falso):
    nadie = make_user("sinrol")
    assert _pedir(nadie, modo="general", mensaje="Hola").status_code == 403
    assert proveedor_falso.pedidos == []


@pytest.mark.parametrize(
    ("cuerpo", "campo"),
    [
        ({"modo": "general", "mensaje": "   "}, "mensaje"),
        ({"modo": "otro", "mensaje": "Hola"}, "modo"),
        ({"modo": "general", "mensaje": "x" * 2001}, "mensaje"),
        ({"modo": "general", "mensaje": "Hola", "historial": "no"}, "historial"),
        ({"modo": "general", "mensaje": "Hola", "historial": [{"rol": "sistema"}]}, "historial"),
    ],
)
def test_valida_el_pedido(ana, proveedor_falso, cuerpo, campo):
    respuesta = _pedir(ana, **cuerpo)
    assert respuesta.status_code == 400
    assert campo in respuesta.json()["error"]["details"]
    assert proveedor_falso.pedidos == []


def test_modo_equipo_sin_equipo_ni_permiso_de_verlo(nino, proveedor_falso):
    _con_permiso(nino, "nova.chat_equipo")
    respuesta = _pedir(nino, modo="equipo", mensaje="¿Cómo va mi equipo?")
    assert respuesta.status_code == 403
    assert proveedor_falso.pedidos == []


# ── Modos ───────────────────────────────────────────────────────────────────


def test_modo_general_responde_con_el_historial(ana, proveedor_falso):
    _sin_regla(ana)
    proveedor_falso.respuesta = "Buenos días. ¿En qué le ayudo?"
    historial = [
        {"rol": "modelo", "texto": "Turno huérfano que se descarta."},
        {"rol": "usuario", "texto": "Hola"},
        {"rol": "modelo", "texto": "Hola, ¿en qué le ayudo?"},
    ]
    respuesta = _pedir(ana, modo="general", mensaje="¿Qué puede hacer?", historial=historial)
    assert respuesta.status_code == 200, respuesta.content
    datos = respuesta.json()
    assert datos["con_ia"] and datos["respuesta"] == "Buenos días. ¿En qué le ayudo?"
    mensajes = proveedor_falso.pedidos[0]["messages"]
    assert [m["role"] for m in mensajes] == ["user", "assistant", "user"]
    assert _datos_enviados(proveedor_falso)["pregunta"] == "¿Qué puede hacer?"
    assert "tareas" not in _datos_enviados(proveedor_falso)
    assert UsoNova.objects.filter(usuario=ana, funcion="chat", resultado="con_ia").count() == 1


def test_el_historial_se_recorta(settings):
    settings.NOVA_CHAT_MAX_TURNOS = 4
    settings.NOVA_CHAT_MAX_CARACTERES_HISTORIAL = 25
    turnos = [
        {"rol": "usuario" if i % 2 == 0 else "modelo", "texto": f"t{i}" * 5} for i in range(10)
    ]
    recortado = chat.recortar_historial(turnos)
    assert len(recortado) <= 4
    assert sum(len(t["texto"]) for t in recortado) <= 25
    assert recortado[0]["rol"] == "usuario"


def test_modo_tareas_envia_sus_tareas_sin_nombres(proveedor_falso):
    persona = make_user("mrios", "ANALISTA_CC", first_name="Marisol", last_name="Ríos")
    tarea(
        persona,
        end_date=datetime(2026, 10, 10, 15, tzinfo=UTC),
        title="Revisar contrato de Marisol Ríos (mrios@example.com)",
    )
    tarea(persona, end_date=datetime(2026, 10, 30, 15, tzinfo=UTC), title="Cita médica")
    proveedor_falso.respuesta = "Persona A tiene una tarea vencida."
    respuesta = _pedir(persona, modo="tareas", mensaje="¿Qué priorizo, soy Marisol?")
    assert respuesta.status_code == 200, respuesta.content
    # El seudónimo vuelve con el nombre real.
    assert respuesta.json()["respuesta"] == "Marisol Ríos tiene una tarea vencida."
    enviado = proveedor_falso.enviado()
    for prohibido in ("Marisol", "Ríos", "mrios", "@", "médica"):
        assert prohibido not in enviado, prohibido
    datos = _datos_enviados(proveedor_falso)
    assert datos["tareas"]["resumen"]["vencidas"] == 1
    assert {t["titulo"] for t in datos["tareas"]["detalle"]} == {
        "Revisar contrato de Persona A ([correo])",
        "[texto omitido por privacidad]",
    }


def test_modo_equipo_no_envia_nombres(proveedor_falso):
    jefa = make_user("jfranco", "JEFE_NACIONAL", first_name="Julieta", last_name="Franco")
    ana = make_user("aperez", "ANALISTA_CC", first_name="Ana", last_name="Pérez")
    beto = make_user("bsuarez", "ASISTENTE_GH", first_name="Beto", last_name="Suárez")
    organigrama(jefa, ana, beto)
    tarea(ana, end_date=datetime(2026, 10, 10, 15, tzinfo=UTC), title="Nómina de Beto Suárez")
    tarea(beto, end_date=datetime(2026, 10, 30, 15, tzinfo=UTC), status="COMPLETADA")
    proveedor_falso.respuesta = "Persona B tiene una tarea vencida; Persona C va al día."

    historial = [
        {"rol": "usuario", "texto": "¿Cómo está Ana Pérez?"},
        {"rol": "modelo", "texto": "Ana Pérez tiene una tarea vencida."},
    ]
    respuesta = _pedir(
        jefa, modo="equipo", mensaje="¿Y Beto Suárez? Soy Julieta", historial=historial
    )
    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json()["respuesta"] == (
        "Ana Pérez tiene una tarea vencida; Beto Suárez va al día."
    )
    enviado = proveedor_falso.enviado()
    for prohibido in ("Julieta", "Franco", "jfranco", "Ana", "Pérez", "aperez", "Beto", "Suárez"):
        assert prohibido not in enviado, prohibido
    datos = _datos_enviados(proveedor_falso)
    personas = {p["persona"]: p for p in datos["equipo"]["personas"]}
    assert set(personas) == {"Persona B", "Persona C"}
    assert personas["Persona B"]["vencidas"] == 1
    assert personas["Persona C"]["completadas"] == 1
    assert datos["persona_que_pregunta"] == "Persona A"


def test_modo_equipo_solo_su_equipo_del_organigrama(
    jefa, coordinadora, equipo, externo, proveedor_falso
):
    proveedor_falso.respuesta = "Bien."
    respuesta = _pedir(coordinadora, modo="equipo", mensaje="Resumen del equipo")
    assert respuesta.status_code == 200, respuesta.content
    assert len(_datos_enviados(proveedor_falso)["equipo"]["personas"]) == 2


# ── Base de conocimiento en el chat ─────────────────────────────────────────


def test_suma_los_fragmentos_relevantes_y_devuelve_las_fuentes(ana, proveedor_falso):
    documento = _documento(
        "Reglamento interno",
        "Las vacaciones anuales son de quince días. Escriba a talento@example.com.",
        "El horario de trabajo es de 8:00 a 17:00. El reposo médico se justifica.",
    )
    _documento("Otro", "Normas de uso del parqueadero.")
    proveedor_falso.respuesta = "Son quince días."
    respuesta = _pedir(ana, modo="general", mensaje="¿Cuántos días de vacaciones tengo?")
    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json()["fuentes"] == [
        {"documento_id": documento.pk, "titulo": "Reglamento interno", "pagina": 1, "citada": False}
    ]
    documentos = _datos_enviados(proveedor_falso)["documentos"]
    assert len(documentos) == 1
    assert "quince días" in documentos[0]["texto"]
    assert "@" not in proveedor_falso.enviado()


def test_un_fragmento_con_salud_pierde_solo_esa_oracion():
    assert chat._sin_salud("El horario es de 8 a 17. El reposo médico se justifica.") == (
        "El horario es de 8 a 17. [texto omitido por privacidad]"
    )


# ── Sin IA ──────────────────────────────────────────────────────────────────


PREGUNTA_MATERNIDAD = "¿Cuántos días de licencia por maternidad da la empresa?"


@pytest.mark.parametrize("modo", ["tareas", "equipo"])
def test_con_datos_de_personas_un_mensaje_sobre_salud_no_se_envia(
    modo, coordinadora, equipo, proveedor_falso
):
    respuesta = _pedir(coordinadora, modo=modo, mensaje=PREGUNTA_MATERNIDAD)
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert not datos["con_ia"] and datos["motivo"] == "bloqueado"
    assert datos["causa"] == "salud"
    assert "salud" in datos["mensaje"]
    assert "modo General" in datos["mensaje"]
    assert proveedor_falso.pedidos == []
    assert UsoNova.objects.get(usuario=coordinadora).resultado == "bloqueado"


# ── Salud como tema general (modo General, decisión del 09/11/2026) ─────────


def test_en_modo_general_la_pregunta_sobre_salud_se_envia_con_la_politica_completa(
    ana, proveedor_falso
):
    politica = (
        "La licencia por maternidad es de doce semanas. El permiso médico se justifica con "
        "certificado del IESS. La lactancia da dos horas diarias."
    )
    _documento("Reglamento de licencias", politica)
    proveedor_falso.respuesta = "Son doce semanas (Fuente: Reglamento de licencias, pág. 1)."
    historial = [
        {"rol": "usuario", "texto": "¿Hay permiso por lactancia?"},
        {"rol": "modelo", "texto": "Sí, dos horas diarias."},
    ]
    respuesta = _pedir(ana, modo="general", mensaje=PREGUNTA_MATERNIDAD, historial=historial)
    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json()["con_ia"]
    datos = _datos_enviados(proveedor_falso)
    assert datos["pregunta"] == PREGUNTA_MATERNIDAD
    assert PREGUNTA_MATERNIDAD in proveedor_falso.enviado()
    assert datos["documentos"][0]["texto"] == politica
    assert "[texto omitido por privacidad]" not in proveedor_falso.enviado()
    assert "¿Hay permiso por lactancia?" in proveedor_falso.enviado()
    # Sin contexto de personas.
    assert not {"persona_que_pregunta", "tareas", "equipo"} & set(datos)


def test_en_modo_general_se_siguen_ocultando_contacto_y_nombres(proveedor_falso):
    persona = make_user("mrios", "ANALISTA_CC", first_name="Marisol", last_name="Ríos")
    _sin_regla(persona)
    proveedor_falso.respuesta = "Consulte a Gestión Humana."
    mensaje = (
        "Soy Marisol Ríos (mrios@example.com, cédula 0912345678, tel. 0991234567): "
        "¿cuántos días de licencia por maternidad da la empresa?"
    )
    respuesta = _pedir(persona, modo="general", mensaje=mensaje)
    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json()["con_ia"]
    enviado = proveedor_falso.enviado()
    for prohibido in ("Marisol", "Ríos", "mrios", "@", "0912345678", "0991234567"):
        assert prohibido not in enviado, prohibido
    pregunta = _datos_enviados(proveedor_falso)["pregunta"]
    assert pregunta.startswith("Soy Persona A ([correo], cédula [identificación]")
    assert "licencia por maternidad" in pregunta


def test_en_modo_tareas_la_politica_pierde_las_oraciones_de_salud(ana, proveedor_falso):
    _documento(
        "Reglamento interno",
        "Las vacaciones son de quince días. La licencia por maternidad es de doce semanas.",
    )
    proveedor_falso.respuesta = "Quince días."
    respuesta = _pedir(ana, modo="tareas", mensaje="¿Cuántos días de vacaciones tengo?")
    assert respuesta.status_code == 200, respuesta.content
    texto = _datos_enviados(proveedor_falso)["documentos"][0]["texto"]
    assert texto == "Las vacaciones son de quince días. [texto omitido por privacidad]"
    assert "maternidad" not in proveedor_falso.enviado()


def test_en_modo_tareas_el_historial_con_salud_no_sale(ana, proveedor_falso):
    proveedor_falso.respuesta = "Bien."
    historial = [
        {"rol": "usuario", "texto": PREGUNTA_MATERNIDAD},
        {"rol": "modelo", "texto": "Son doce semanas."},
    ]
    respuesta = _pedir(ana, modo="tareas", mensaje="¿Qué priorizo?", historial=historial)
    assert respuesta.status_code == 200, respuesta.content
    assert "maternidad" not in proveedor_falso.enviado()


def test_sin_clave_responde_claro(ana):
    _sin_regla(ana)
    respuesta = _pedir(ana, modo="general", mensaje="Hola")
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert not datos["con_ia"] and datos["motivo"] == "sin_clave"
    assert datos["causa"] is None
    assert "no está configurada" in datos["mensaje"]


def test_sin_consentimiento_responde_claro(ana, proveedor_falso, monkeypatch):
    _sin_regla(ana)
    monkeypatch.setattr("apps.nova.nucleo.acepto_aviso_vigente", lambda _u: False)
    datos = _pedir(ana, modo="general", mensaje="Hola").json()
    assert datos["motivo"] == "sin_consentimiento"
    assert "aviso de tratamiento de datos" in datos["mensaje"]
    assert proveedor_falso.pedidos == []


def test_limite_diario(ana, proveedor_falso, settings):
    settings.NOVA_LIMITE_DIARIO_POR_USUARIO = 1
    _sin_regla(ana)
    proveedor_falso.respuesta = "Hola."
    assert _pedir(ana, modo="general", mensaje="Hola").json()["con_ia"]
    datos = _pedir(ana, modo="general", mensaje="Otra").json()
    assert datos["motivo"] == "limite" and "límite de 1" in datos["mensaje"]
    assert len(proveedor_falso.pedidos) == 1


def test_fallo_del_proveedor_no_es_500(ana, proveedor_falso):
    _sin_regla(ana)
    import anthropic
    import httpx2

    proveedor_falso.error = anthropic.APIConnectionError(
        request=httpx2.Request("POST", "https://x")
    )
    respuesta = _pedir(ana, modo="general", mensaje="Hola")
    assert respuesta.status_code == 200
    assert respuesta.json()["motivo"] == "fallo"


def test_me_dice_si_tiene_el_modo_equipo(jefa, nino):
    assert client_for(jefa).get("/api/v1/nova/me/").json()["chat_equipo"] is True
    assert client_for(nino).get("/api/v1/nova/me/").json()["chat_equipo"] is False
    # Con el permiso y equipo a cargo en el organigrama, aunque no lo «vea».
    otro = make_user("ocampo", "ASISTENTE_GH", first_name="Otilia")
    _con_permiso(nino, "nova.chat_equipo")
    organigrama(nino, otro)
    assert client_for(nino).get("/api/v1/nova/me/").json()["chat_equipo"] is True
