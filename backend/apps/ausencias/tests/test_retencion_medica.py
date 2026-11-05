"""Retención LOPDP de las ausencias médicas: cinco años (05/11/2026).

`manage.py purgar_ausencias_medicas` borra los `LeaveRecord` MÉDICOS de hace
más de cinco años y deja en la auditoría de cada empresa cuántos y de qué
período, sin datos de salud ni de personas. Corre cada cinco minutos en la
tarea de respaldo: sin nada vencido, una sola consulta."""

import json
from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command

from apps.ausencias.models import LeaveRecord
from apps.ausencias.services import medical_retention_cutoff, purge_expired_medical_leaves
from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import Empresa

from .conftest import make_admin, make_user

pytestmark = pytest.mark.django_db

HOY = date(2026, 11, 5)
CORTE = date(2021, 11, 5)


def _ausencia(user, admin, dia, tipo=LeaveRecord.Type.MEDICO, **extra):
    return LeaveRecord.objects.create(
        user=user,
        created_by=admin,
        type=tipo,
        date=dia,
        is_full_day=True,
        observation="Reposo por cirugía de rodilla",
        **extra,
    )


@pytest.fixture
def personas():
    return make_user("josé_núñez", first_name="José"), make_admin()


def _purga():
    return list(AuditLog.objects.filter(action="ausencias.retencion_purgada"))


def test_el_corte_es_de_cinco_anios_y_respeta_el_29_de_febrero():
    assert medical_retention_cutoff(HOY) == CORTE
    assert medical_retention_cutoff(date(2028, 2, 29)) == date(2023, 2, 28)


def test_borra_solo_lo_medico_de_hace_mas_de_cinco_anios(personas):
    persona, admin = personas
    vieja = _ausencia(persona, admin, date(2021, 11, 4))
    mas_vieja = _ausencia(persona, admin, date(2020, 3, 2))
    en_el_corte = _ausencia(persona, admin, CORTE)
    reciente = _ausencia(persona, admin, date(2026, 1, 5))
    personal_vieja = _ausencia(persona, admin, date(2019, 5, 6), tipo=LeaveRecord.Type.PERSONAL)
    vacaciones_viejas = _ausencia(
        persona, admin, date(2019, 5, 7), tipo=LeaveRecord.Type.VACACIONES
    )

    resumen = purge_expired_medical_leaves(today=HOY)

    quedan = set(LeaveRecord.objects.values_list("id", flat=True))
    assert vieja.id not in quedan and mas_vieja.id not in quedan
    assert {en_el_corte.id, reciente.id, personal_vieja.id, vacaciones_viejas.id} <= quedan
    assert resumen == [
        {
            "empresa_id": empresa_actual().id,
            "registros": 2,
            "desde": "2020-03-02",
            "hasta": "2021-11-04",
        }
    ]


def test_la_constancia_es_agregada_y_sin_datos_de_salud(personas):
    persona, admin = personas
    _ausencia(persona, admin, date(2020, 3, 2))
    _ausencia(persona, admin, date(2021, 1, 4))

    purge_expired_medical_leaves(today=HOY)

    [evento] = _purga()
    assert evento.module == "ausencias"
    assert evento.actor is None
    assert evento.target_id == ""
    assert evento.empresa_id == empresa_actual().id
    assert evento.new_values == {
        "registros": 2,
        "desde": "2020-03-02",
        "hasta": "2021-01-04",
        "corte": "2021-11-05",
        "plazo_anios": 5,
    }
    texto = json.dumps(evento.new_values, ensure_ascii=False).lower()
    for dato in ("medic", "médic", "rodilla", "josé", "user"):
        assert dato not in texto


def test_simular_no_borra_ni_audita(personas):
    persona, admin = personas
    vieja = _ausencia(persona, admin, date(2020, 3, 2))
    salida = StringIO()

    call_command("purgar_ausencias_medicas", "--simular", stdout=salida)

    assert LeaveRecord.objects.filter(pk=vieja.id).exists()
    assert _purga() == []
    assert "Se borrarían: 1" in salida.getvalue()


def test_el_comando_borra_y_lo_dice(personas):
    persona, admin = personas
    _ausencia(persona, admin, date(2020, 3, 2))
    salida = StringIO()

    call_command("purgar_ausencias_medicas", stdout=salida)

    assert not LeaveRecord.objects.exists()
    assert len(_purga()) == 1
    assert "Ausencias médicas vencidas borradas: 1" in salida.getvalue()


def test_sin_nada_vencido_es_una_sola_consulta_y_no_escribe(personas, django_assert_num_queries):
    persona, admin = personas
    _ausencia(persona, admin, date(2026, 1, 5))
    salida = StringIO()

    with django_assert_num_queries(1):
        call_command("purgar_ausencias_medicas", stdout=salida)

    assert salida.getvalue() == ""
    assert LeaveRecord.objects.count() == 1
    assert _purga() == []


def test_cada_empresa_recibe_su_propia_constancia(personas):
    persona, admin = personas
    _ausencia(persona, admin, date(2020, 3, 2))
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    with usando_empresa(otra):
        _ausencia(persona, admin, date(2019, 8, 1))
        _ausencia(persona, admin, date(2019, 8, 2))

    # Como corre la tarea programada: sin empresa activa.
    with usando_empresa(None):
        resumen = purge_expired_medical_leaves(today=HOY)

    assert sorted(f["registros"] for f in resumen) == [1, 2]
    assert not LeaveRecord.objects.todas().exists()
    eventos = AuditLog.objects.filter(action="ausencias.retencion_purgada")
    por_empresa = {e.empresa_id: e.new_values["registros"] for e in eventos}
    assert por_empresa == {empresa_actual().id: 1, otra.id: 2}
