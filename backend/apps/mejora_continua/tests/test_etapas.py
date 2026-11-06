"""La máquina de etapas, los avisos y la insignia «innovador» (portadas de
`apps/ideas/tests/test_ideas_services.py` de Nexo, con las diferencias de la
intranet anotadas)."""

import pytest

from apps.mejora_continua import services
from apps.mejora_continua.models import IdeaStatusHistory, ImprovementIdea
from apps.mejora_continua.services import MejoraContinuaError
from apps.notificaciones.models import Notificacion

from .conftest import idea_de

pytestmark = pytest.mark.django_db

S = ImprovementIdea.Status


# ── Reglas puras ──────────────────────────────────────────────────────────────


def test_avanza_de_a_un_paso_y_no_pasa_de_implementada():
    assert services.etapa_siguiente(S.PROPUESTA) == S.EN_REVISION
    assert services.etapa_siguiente(S.EN_PRUEBAS) == S.IMPLEMENTADA
    assert services.etapa_siguiente(S.IMPLEMENTADA) is None
    assert services.etapa_siguiente(S.RECHAZADA) is None


def test_retrocede_de_a_un_paso_pero_implementada_es_final():
    assert services.etapa_anterior(S.EN_REVISION) == S.PROPUESTA
    assert services.etapa_anterior(S.PROPUESTA) is None
    assert services.etapa_anterior(S.RECHAZADA) is None
    # En Nexo la API dejaba retroceder una implementada (la pantalla no); aquí no.
    assert services.etapa_anterior(S.IMPLEMENTADA) is None


def test_se_rechaza_desde_todo_menos_implementada_y_rechazada():
    for etapa in (S.PROPUESTA, S.EN_REVISION, S.APROBADA, S.EN_DESARROLLO, S.EN_PRUEBAS):
        assert services.se_puede_rechazar(etapa)
    assert not services.se_puede_rechazar(S.IMPLEMENTADA)
    assert not services.se_puede_rechazar(S.RECHAZADA)


def test_acciones_posibles_por_etapa():
    assert services.acciones_posibles(S.PROPUESTA) == ["ADVANCE", "REJECT"]
    assert services.acciones_posibles(S.APROBADA) == ["ADVANCE", "RETREAT", "REJECT"]
    assert services.acciones_posibles(S.IMPLEMENTADA) == []
    assert services.acciones_posibles(S.RECHAZADA) == ["REOPEN"]


# ── Cambio de etapa ─────────────────────────────────────────────────────────────


def test_avanzar_deja_historial_y_cambia_la_etapa(ana, jefa):
    idea = idea_de(ana)
    services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="ADVANCE", comment="Revisemos")
    idea.refresh_from_db()
    assert idea.status == S.EN_REVISION
    entrada = IdeaStatusHistory.objects.get(idea=idea)
    assert (entrada.from_status, entrada.to_status) == (S.PROPUESTA, S.EN_REVISION)
    assert entrada.changed_by == jefa and entrada.comment == "Revisemos"


def test_avanzar_desde_implementada_falla(ana, jefa):
    idea = idea_de(ana, status=S.IMPLEMENTADA)
    with pytest.raises(MejoraContinuaError) as error:
        services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="ADVANCE")
    assert error.value.code == "invalid_transition"
    assert not IdeaStatusHistory.objects.exists()


def test_rechazar_exige_motivo(ana, jefa):
    idea = idea_de(ana)
    with pytest.raises(MejoraContinuaError) as error:
        services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="REJECT", comment=None)
    assert error.value.details == {"comment": ["El motivo del rechazo es obligatorio."]}


def test_reabrir_solo_una_rechazada_y_vuelve_a_revision(ana, jefa):
    idea = idea_de(ana, status=S.APROBADA)
    with pytest.raises(MejoraContinuaError, match="Solo se puede reabrir"):
        services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="REOPEN")
    idea.status = S.RECHAZADA
    idea.save()
    services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="REOPEN")
    idea.refresh_from_db()
    assert idea.status == S.EN_REVISION


def test_etapa_esperada_distinta_responde_conflicto(ana, jefa):
    """Un doble clic en «Avanzar»: el segundo llega con la etapa ya vieja."""
    idea = idea_de(ana)
    services.cambiar_etapa(
        actor=jefa, idea_id=idea.pk, action="ADVANCE", expected_status="PROPUESTA"
    )
    with pytest.raises(MejoraContinuaError) as error:
        services.cambiar_etapa(
            actor=jefa, idea_id=idea.pk, action="ADVANCE", expected_status="PROPUESTA"
        )
    assert error.value.status == 409
    idea.refresh_from_db()
    assert idea.status == S.EN_REVISION


def test_sin_gestionar_no_mueve_ideas(ana, nino):
    idea = idea_de(ana)
    with pytest.raises(MejoraContinuaError) as error:
        services.cambiar_etapa(actor=nino, idea_id=idea.pk, action="ADVANCE")
    assert error.value.status == 403


def test_el_adjunto_se_conserva_al_salir_de_propuesta(ana, jefa):
    """En Nexo se borraba (era base64 en la base); aquí es un archivo y se
    conserva."""
    from django.core.files.base import ContentFile

    idea = idea_de(ana, attachment_name="propuesta.pdf", attachment_mime="application/pdf")
    idea.attachment.save("propuesta.pdf", ContentFile(b"%PDF-1.4\n"), save=True)
    services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="ADVANCE")
    idea.refresh_from_db()
    assert idea.attachment and idea.attachment_name == "propuesta.pdf"


# ── Avisos ────────────────────────────────────────────────────────────────────


def _aviso(usuario):
    return Notificacion.objects.filter(usuario=usuario).order_by("-id").first()


def test_avisa_al_autor_cuando_otra_persona_mueve_su_idea(
    ana, jefa, django_capture_on_commit_callbacks
):
    idea = idea_de(ana)
    with django_capture_on_commit_callbacks(execute=True):
        services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="ADVANCE")
    aviso = _aviso(ana)
    assert aviso.tipo == "mejora_continua.estado"
    assert aviso.resumen == f"Su idea «{idea.title}» pasó a En revisión"
    assert aviso.enlace == f"/admin/gestion-humana/mejora-continua/{idea.pk}"


def test_no_se_avisa_a_si_mismo(admin_gh, django_capture_on_commit_callbacks):
    idea = idea_de(admin_gh)
    with django_capture_on_commit_callbacks(execute=True):
        services.cambiar_etapa(actor=admin_gh, idea_id=idea.pk, action="ADVANCE")
    assert not Notificacion.objects.filter(usuario=admin_gh).exists()


def test_el_rechazo_lleva_el_motivo_y_la_implementada_felicita(
    ana, jefa, django_capture_on_commit_callbacks
):
    rechazada = idea_de(ana, title="Buzón físico")
    implementada = idea_de(ana, title="Pausas activas", status=S.EN_PRUEBAS)
    with django_capture_on_commit_callbacks(execute=True):
        services.cambiar_etapa(
            actor=jefa, idea_id=rechazada.pk, action="REJECT", comment="Ya existe uno digital"
        )
        services.cambiar_etapa(actor=jefa, idea_id=implementada.pk, action="ADVANCE")
    resumenes = set(Notificacion.objects.filter(usuario=ana).values_list("resumen", flat=True))
    assert resumenes == {
        "Su idea «Buzón físico» fue rechazada: Ya existe uno digital",
        "¡Felicidades! Su idea «Pausas activas» fue implementada",
    }


def test_una_idea_nueva_avisa_a_quienes_revisan(
    ana, jefa, admin_gh, nino, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        idea = services.crear_idea(
            actor=ana, title="Mentoría entre pares", description="Cada trimestre", impact="MEDIO"
        )
    for revisor in (jefa, admin_gh):
        aviso = _aviso(revisor)
        assert aviso.tipo == "mejora_continua.nueva_idea"
        assert aviso.resumen == "Ana propuso una nueva idea: «Mentoría entre pares»"
        assert aviso.enlace.endswith(f"/mejora-continua/{idea.pk}")
    # Ni quien no revisa ni quien la propuso.
    assert not Notificacion.objects.filter(usuario__in=[nino, ana]).exists()


# ── Insignia «innovador» ────────────────────────────────────────────────────────


def test_la_insignia_se_gana_al_implementar_una_idea(ana, nino, jefa):
    idea = idea_de(ana, status=S.EN_PRUEBAS)
    idea_de(nino, status=S.EN_PRUEBAS)
    assert services.innovadores([ana.pk, nino.pk]) == set()
    services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="ADVANCE")
    assert services.innovadores([ana.pk, nino.pk]) == {ana.pk}
    assert services.es_innovador(ana) and not services.es_innovador(nino)


def test_la_insignia_tambien_sale_de_una_importada_ya_implementada(ana):
    """Las ideas que llegan de Nexo implementadas, sin su historial."""
    idea_de(ana, status=S.IMPLEMENTADA)
    assert services.es_innovador(ana)


def test_la_insignia_no_se_pierde_si_la_idea_se_mueve_despues(ana, jefa):
    """Como en Nexo, nunca se quita: queda en el historial aunque la idea
    implementada se rechace o reabra más tarde (p. ej. una importada)."""
    idea = idea_de(ana, status=S.EN_PRUEBAS)
    services.cambiar_etapa(actor=jefa, idea_id=idea.pk, action="ADVANCE")
    ImprovementIdea.objects.filter(pk=idea.pk).update(status=S.EN_PRUEBAS)
    assert services.es_innovador(ana)


# ── Avance y votos ────────────────────────────────────────────────────────────


def test_avance_solo_de_quien_gestiona_y_se_audita(ana, jefa):
    from apps.core.models import AuditLog

    idea = idea_de(ana, status=S.EN_DESARROLLO)
    with pytest.raises(MejoraContinuaError):
        services.actualizar_avance(actor=ana, idea_id=idea.pk, progress=50)
    services.actualizar_avance(actor=jefa, idea_id=idea.pk, progress=60)
    idea.refresh_from_db()
    assert idea.progress == 60
    evento = AuditLog.objects.get(action="mejora_continua.avance_actualizado")
    assert evento.previous_values == {"progress": 0} and evento.new_values == {"progress": 60}


def test_votar_alterna_y_las_formas_idempotentes_no_deshacen(ana, nino):
    idea = idea_de(ana)
    assert services.votar(actor=nino, idea=idea) == (1, True)
    assert services.votar(actor=nino, idea=idea) == (0, False)
    assert services.votar(actor=nino, idea=idea, querer=True) == (1, True)
    assert services.votar(actor=nino, idea=idea, querer=True) == (1, True)
    assert services.votar(actor=nino, idea=idea, querer=False) == (0, False)
    assert services.votar(actor=nino, idea=idea, querer=False) == (0, False)
