"""La API de Mejora continua (`/api/v1/mejora-continua/`): tablero, detalle,
propuesta con adjunto, cambio de etapa, avance, votos, historial y el adjunto
dentro del sistema. Portadas de `apps/ideas/tests/test_ideas_views.py` de Nexo,
con la visibilidad del organigrama y el contrato de error de la intranet."""

import pytest
from rest_framework.test import APIClient

from apps.mejora_continua.models import IdeaStatusHistory, IdeaVote, ImprovementIdea

from .conftest import (
    BASE,
    PDF_BYTES,
    PNG_BYTES,
    client_for,
    docx_bytes,
    idea_de,
    subir,
)

pytestmark = pytest.mark.django_db

S = ImprovementIdea.Status


def _ids(respuesta) -> list[int]:
    return [i["id"] for i in respuesta.json()]


# ── Acceso ────────────────────────────────────────────────────────────────────


def test_sin_sesion_401():
    assert APIClient().get(f"{BASE}/ideas/").status_code == 401


def test_sin_permiso_del_modulo_403(ajena):
    respuesta = client_for(ajena).get(f"{BASE}/ideas/")
    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"


def test_me_resume_lo_que_puede_hacer(ana, jefa, admin_gh):
    yo = client_for(ana).get(f"{BASE}/me/").json()
    assert yo["permissions"] == ["mejora_continua.acceder"]
    assert yo["can_propose"] and yo["can_vote"]
    assert not yo["can_manage"] and not yo["sees_all"] and not yo["innovador"]
    assert ".pdf" in yo["attachment"]["extensions"]
    assert yo["attachment"]["max_bytes"] == 8 * 1024 * 1024

    jefatura = client_for(jefa).get(f"{BASE}/me/").json()
    assert jefatura["can_manage"] and jefatura["sees_all"]
    assert client_for(admin_gh).get(f"{BASE}/me/").json()["permissions"] == [
        "mejora_continua.acceder",
        "mejora_continua.ver_todas",
        "mejora_continua.gestionar",
    ]


# ── Tablero y visibilidad ─────────────────────────────────────────────────────


def test_cada_quien_ve_las_suyas_y_las_de_su_equipo(coordinador, ana, nino, externa, equipo):
    de_ana = idea_de(ana, title="De Ana")
    de_nino = idea_de(nino, title="De Niño")
    de_externa = idea_de(externa, title="De Eugenia")
    propia = idea_de(coordinador, title="Del coordinador")

    assert _ids(client_for(coordinador).get(f"{BASE}/ideas/")) == [
        propia.pk,
        de_nino.pk,
        de_ana.pk,
    ]
    # Ana no tiene equipo: solo las suyas.
    assert _ids(client_for(ana).get(f"{BASE}/ideas/")) == [de_ana.pk]
    assert _ids(client_for(externa).get(f"{BASE}/ideas/")) == [de_externa.pk]


def test_jefatura_nacional_y_admin_ven_todas(jefa, admin_gh, ana, externa):
    ideas = {idea_de(ana).pk, idea_de(externa).pk}
    assert set(_ids(client_for(jefa).get(f"{BASE}/ideas/"))) == ideas
    assert set(_ids(client_for(admin_gh).get(f"{BASE}/ideas/"))) == ideas


def test_filtros_mis_ideas_y_etapa(jefa, ana):
    mia = idea_de(jefa, title="Mía")
    implementada = idea_de(ana, status=S.IMPLEMENTADA)
    cliente = client_for(jefa)
    assert _ids(cliente.get(f"{BASE}/ideas/?mine=1")) == [mia.pk]
    assert _ids(cliente.get(f"{BASE}/ideas/?status=IMPLEMENTADA")) == [implementada.pk]
    respuesta = cliente.get(f"{BASE}/ideas/?status=OTRA")
    assert respuesta.status_code == 400 and "status" in respuesta.json()["error"]["details"]


def test_forma_del_tablero(jefa, ana, nino, equipo):
    idea = idea_de(ana, status=S.RECHAZADA)
    IdeaStatusHistory.objects.create(
        idea=idea,
        from_status=S.PROPUESTA,
        to_status=S.RECHAZADA,
        changed_by=jefa,
        comment="Ya existe",
    )
    IdeaVote.objects.create(idea=idea, user=nino)
    IdeaVote.objects.create(idea=idea, user=jefa)
    idea_de(ana, title="Implementada", status=S.IMPLEMENTADA)

    tarjeta = next(i for i in client_for(jefa).get(f"{BASE}/ideas/").json() if i["id"] == idea.pk)
    assert tarjeta["status_label"] == "Rechazada" and tarjeta["impact_label"] == "Alto"
    assert tarjeta["vote_count"] == 2 and tarjeta["voted_by_me"] is True
    assert tarjeta["is_mine"] is False
    assert tarjeta["latest_rejection_comment"] == "Ya existe"
    assert tarjeta["attachment"] is None
    assert tarjeta["author"] == {
        "id": ana.pk,
        "username": "anunez",
        "first_name": "Ana",
        "last_name": "",
        "name": "Ana",
        "full_name": "Ana",
        "role": "ANALISTA_CC",
        "role_label": "Analista Clima y Cultura",
        "innovador": True,
    }
    assert "email" not in tarjeta["author"]


# ── Proponer ────────────────────────────────────────────────────────────────────


def test_proponer_sin_adjunto_en_json(ana):
    respuesta = client_for(ana).post(
        f"{BASE}/ideas/",
        {
            "title": "  Señalética en la bodega  ",
            "description": "Rutas de evacuación",
            "impact": "BAJO",
        },
        format="json",
    )
    assert respuesta.status_code == 201
    datos = respuesta.json()
    assert datos["title"] == "Señalética en la bodega"
    assert datos["status"] == "PROPUESTA" and datos["progress"] == 0
    assert datos["history"] == [] and datos["attachment"] is None
    assert datos["is_mine"] is True and datos["can_manage"] is False
    assert datos["allowed_actions"] == []


def test_proponer_con_adjunto_pdf(ana):
    respuesta = client_for(ana).post(
        f"{BASE}/ideas/",
        {
            "title": "Capacitación en Excel",
            "description": "Nivel intermedio para nómina",
            "impact": "MEDIO",
            "attachment": subir("Propuesta Año 2027.pdf", PDF_BYTES, "text/html"),
        },
        format="multipart",
    )
    assert respuesta.status_code == 201, respuesta.json()
    adjunto = respuesta.json()["attachment"]
    # El tipo sale de la extensión validada, no del navegador.
    assert adjunto["mime"] == "application/pdf" and adjunto["viewer"] == "pdf"
    assert adjunto["name"] == "Propuesta Año 2027.pdf" and adjunto["size"] == len(PDF_BYTES)
    idea = ImprovementIdea.objects.get()
    assert idea.attachment.name.startswith("mejora_continua/")
    assert "Propuesta" not in idea.attachment.name
    assert adjunto["url"] == f"/mejora-continua/ideas/{idea.pk}/attachment/"


def test_proponer_con_un_docx_valido(ana):
    respuesta = client_for(ana).post(
        f"{BASE}/ideas/",
        {
            "title": "Plantilla de actas",
            "description": "Una sola para todas las áreas",
            "impact": "BAJO",
            "attachment": subir("acta.docx", docx_bytes()),
        },
        format="multipart",
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["attachment"]["viewer"] is None


@pytest.mark.parametrize(
    ("nombre", "contenido", "mensaje"),
    [
        ("virus.exe", b"MZ\x90\x00", "No se admiten"),
        ("falso.pdf", b"MZ\x90\x00 no es un pdf", "no corresponde"),
        ("renombrado.docx", b"PK\x03\x04" + b"\x00" * 30, "no corresponde"),
        ("vacio.pdf", b"", "vacío"),
    ],
)
def test_adjuntos_rechazados(ana, nombre, contenido, mensaje):
    respuesta = client_for(ana).post(
        f"{BASE}/ideas/",
        {
            "title": "Con adjunto",
            "description": "x",
            "impact": "ALTO",
            "attachment": subir(nombre, contenido),
        },
        format="multipart",
    )
    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "validation_error" and "attachment" in error["details"]
    assert mensaje in error["message"]
    assert not ImprovementIdea.objects.exists()


def test_adjunto_de_mas_de_8_mb(ana, monkeypatch):
    from apps.mejora_continua import services

    monkeypatch.setattr(services, "TAMANO_MAXIMO_ADJUNTO", 10)
    respuesta = client_for(ana).post(
        f"{BASE}/ideas/",
        {
            "title": "T",
            "description": "D",
            "impact": "ALTO",
            "attachment": subir("a.pdf", PDF_BYTES),
        },
        format="multipart",
    )
    assert respuesta.status_code == 400
    assert "máximo" in respuesta.json()["error"]["message"]


@pytest.mark.parametrize(
    ("cuerpo", "campo"),
    [
        ({"title": "   ", "description": "D", "impact": "ALTO"}, "title"),
        ({"title": "T", "description": "", "impact": "ALTO"}, "description"),
        ({"title": "T", "description": "D", "impact": "ENORME"}, "impact"),
        ({"title": "T" * 256, "description": "D", "impact": "ALTO"}, "title"),
        ({"description": "D", "impact": "ALTO"}, "title"),
    ],
)
def test_proponer_con_datos_invalidos(ana, cuerpo, campo):
    respuesta = client_for(ana).post(f"{BASE}/ideas/", cuerpo, format="json")
    assert respuesta.status_code == 400
    assert campo in respuesta.json()["error"]["details"]


def test_quien_solo_ve_todas_no_propone(ana):
    """Un rol hecho a mano con solo `ver_todas` entra, pero no propone."""
    from django.contrib.auth.models import Group, Permission

    rol = Group.objects.create(name="Solo lectura de ideas")
    rol.permissions.add(Permission.objects.get(codename="mejora_continua.ver_todas"))
    ana.groups.set([rol])
    cliente = client_for(ana)
    assert cliente.get(f"{BASE}/ideas/").status_code == 200
    respuesta = cliente.post(
        f"{BASE}/ideas/", {"title": "T", "description": "D", "impact": "ALTO"}, format="json"
    )
    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"


# ── Detalle ─────────────────────────────────────────────────────────────────────


def test_detalle_con_historial_y_acciones(jefa, ana):
    idea = idea_de(ana)
    client_for(jefa).post(f"{BASE}/ideas/{idea.pk}/status/", {"action": "ADVANCE"}, format="json")
    detalle = client_for(jefa).get(f"{BASE}/ideas/{idea.pk}/").json()
    assert detalle["status"] == "EN_REVISION"
    assert detalle["can_manage"] is True and detalle["can_vote"] is True
    assert detalle["allowed_actions"] == ["ADVANCE", "RETREAT", "REJECT"]
    [paso] = detalle["history"]
    assert paso["from_status"] == "PROPUESTA" and paso["to_status_label"] == "En revisión"
    assert paso["changer"]["id"] == jefa.pk and paso["changer"]["role"] == "JEFE_NACIONAL"

    # El autor ve lo mismo, sin acciones.
    propio = client_for(ana).get(f"{BASE}/ideas/{idea.pk}/").json()
    assert propio["allowed_actions"] == [] and propio["can_manage"] is False


def test_detalle_de_una_idea_que_no_ve_o_no_existe_404(ana, externa):
    ajena = idea_de(externa)
    cliente = client_for(ana)
    for pk in (ajena.pk, 999999):
        respuesta = cliente.get(f"{BASE}/ideas/{pk}/")
        assert respuesta.status_code == 404
        assert respuesta.json()["error"]["code"] == "not_found"


# ── Cambio de etapa ──────────────────────────────────────────────────────────────


def test_mover_de_etapa_exige_gestionar(ana, nino, coordinador, equipo):
    idea = idea_de(nino)
    for cuenta in (ana, coordinador):
        respuesta = client_for(cuenta).post(
            f"{BASE}/ideas/{idea.pk}/status/", {"action": "ADVANCE"}, format="json"
        )
        assert respuesta.status_code == 403
    # Ni siquiera revela si existe.
    respuesta = client_for(ana).post(f"{BASE}/ideas/999999/status/", {"action": "ADVANCE"})
    assert respuesta.status_code == 403


def test_quien_gestiona_mueve_cualquier_idea_de_la_empresa(jefa, externa):
    idea = idea_de(externa)
    respuesta = client_for(jefa).patch(
        f"{BASE}/ideas/{idea.pk}/status/",
        {"action": "ADVANCE", "expected_status": "PROPUESTA", "comment": "  Va  "},
        format="json",
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["status"] == "EN_REVISION"
    assert IdeaStatusHistory.objects.get().comment == "Va"


@pytest.mark.parametrize(
    ("cuerpo", "codigo", "estado"),
    [
        ({"action": "SALTAR"}, "validation_error", 400),
        ({"action": "REJECT", "comment": "   "}, "validation_error", 400),
        ({"action": "RETREAT"}, "invalid_transition", 400),
        ({"action": "REOPEN"}, "invalid_transition", 400),
        ({"action": "ADVANCE", "expected_status": "APROBADA"}, "conflict", 409),
        ({"action": "REJECT", "comment": "x" * 2001}, "validation_error", 400),
    ],
)
def test_cambios_de_etapa_invalidos(jefa, ana, cuerpo, codigo, estado):
    idea = idea_de(ana)
    respuesta = client_for(jefa).post(f"{BASE}/ideas/{idea.pk}/status/", cuerpo, format="json")
    assert respuesta.status_code == estado
    assert respuesta.json()["error"]["code"] == codigo
    idea.refresh_from_db()
    assert idea.status == S.PROPUESTA
    assert not IdeaStatusHistory.objects.exists()


def test_una_implementada_no_se_mueve(jefa, ana):
    idea = idea_de(ana, status=S.IMPLEMENTADA)
    for accion in ("ADVANCE", "RETREAT", "REOPEN"):
        respuesta = client_for(jefa).post(
            f"{BASE}/ideas/{idea.pk}/status/", {"action": accion}, format="json"
        )
        assert respuesta.status_code == 400
    respuesta = client_for(jefa).post(
        f"{BASE}/ideas/{idea.pk}/status/", {"action": "REJECT", "comment": "No"}, format="json"
    )
    assert respuesta.status_code == 400


# ── Avance ─────────────────────────────────────────────────────────────────────


def test_avance(jefa, ana):
    idea = idea_de(ana, status=S.EN_DESARROLLO)
    assert (
        client_for(ana)
        .patch(f"{BASE}/ideas/{idea.pk}/", {"progress": 50}, format="json")
        .status_code
        == 403
    )
    for malo in (-1, 101, "mucho"):
        respuesta = client_for(jefa).patch(
            f"{BASE}/ideas/{idea.pk}/", {"progress": malo}, format="json"
        )
        assert respuesta.status_code == 400
        assert "progress" in respuesta.json()["error"]["details"]
    respuesta = client_for(jefa).patch(f"{BASE}/ideas/{idea.pk}/", {"progress": 75}, format="json")
    assert respuesta.status_code == 200 and respuesta.json()["progress"] == 75


# ── Votos ─────────────────────────────────────────────────────────────────────


def test_votos(coordinador, ana, nino, equipo):
    idea = idea_de(ana)
    cliente = client_for(coordinador)
    assert cliente.post(f"{BASE}/ideas/{idea.pk}/vote/").json() == {
        "vote_count": 1,
        "voted_by_me": True,
    }
    assert cliente.put(f"{BASE}/ideas/{idea.pk}/vote/").json()["vote_count"] == 1
    assert client_for(ana).put(f"{BASE}/ideas/{idea.pk}/vote/").json()["vote_count"] == 2
    assert cliente.delete(f"{BASE}/ideas/{idea.pk}/vote/").json() == {
        "vote_count": 1,
        "voted_by_me": False,
    }
    assert cliente.delete(f"{BASE}/ideas/{idea.pk}/vote/").json()["vote_count"] == 1


def test_no_se_vota_lo_que_no_se_ve(nino, externa):
    idea = idea_de(externa)
    assert client_for(nino).post(f"{BASE}/ideas/{idea.pk}/vote/").status_code == 404
    assert not IdeaVote.objects.exists()


# ── Historial ──────────────────────────────────────────────────────────────────


def test_historial_en_orden(jefa, ana):
    idea = idea_de(ana)
    cliente = client_for(jefa)
    cliente.post(f"{BASE}/ideas/{idea.pk}/status/", {"action": "ADVANCE"}, format="json")
    cliente.post(
        f"{BASE}/ideas/{idea.pk}/status/", {"action": "REJECT", "comment": "Sin presupuesto"}
    )
    cliente.post(f"{BASE}/ideas/{idea.pk}/status/", {"action": "REOPEN"}, format="json")
    pasos = client_for(ana).get(f"{BASE}/ideas/{idea.pk}/history/").json()
    assert [(p["from_status"], p["to_status"]) for p in pasos] == [
        ("PROPUESTA", "EN_REVISION"),
        ("EN_REVISION", "RECHAZADA"),
        ("RECHAZADA", "EN_REVISION"),
    ]
    assert pasos[1]["comment"] == "Sin presupuesto"


def test_historial_de_una_que_no_ve_404(ana, externa):
    assert client_for(ana).get(f"{BASE}/ideas/{idea_de(externa).pk}/history/").status_code == 404


# ── El adjunto dentro del sistema ───────────────────────────────────────────────────


def _con_adjunto(autor, nombre, contenido):
    respuesta = client_for(autor).post(
        f"{BASE}/ideas/",
        {
            "title": "Con adjunto",
            "description": "D",
            "impact": "ALTO",
            "attachment": subir(nombre, contenido),
        },
        format="multipart",
    )
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def test_el_pdf_y_la_imagen_se_ven_en_linea(ana):
    for nombre, contenido, tipo in (
        ("propuesta.pdf", PDF_BYTES, "application/pdf"),
        ("plano.png", PNG_BYTES, "image/png"),
    ):
        pk = _con_adjunto(ana, nombre, contenido)
        respuesta = client_for(ana).get(f"{BASE}/ideas/{pk}/attachment/")
        assert respuesta.status_code == 200
        assert respuesta["Content-Type"] == tipo
        assert respuesta["Content-Disposition"].startswith("inline;")
        assert respuesta["X-Content-Type-Options"] == "nosniff"
        assert b"".join(respuesta.streaming_content) == contenido
        descarga = client_for(ana).get(f"{BASE}/ideas/{pk}/attachment/?download=1")
        assert descarga["Content-Disposition"].startswith("attachment;")


def test_word_se_descarga(ana):
    pk = _con_adjunto(ana, "acta.docx", docx_bytes())
    respuesta = client_for(ana).get(f"{BASE}/ideas/{pk}/attachment/")
    assert respuesta["Content-Disposition"].startswith("attachment;")


def test_el_adjunto_tiene_la_visibilidad_de_la_idea(ana, externa):
    pk = _con_adjunto(externa, "propuesta.pdf", PDF_BYTES)
    assert client_for(ana).get(f"{BASE}/ideas/{pk}/attachment/").status_code == 404


def test_idea_sin_adjunto_404(ana):
    idea = idea_de(ana)
    respuesta = client_for(ana).get(f"{BASE}/ideas/{idea.pk}/attachment/")
    assert respuesta.status_code == 404
