"""Regresiones de rendimiento: el número de consultas, fijado como contrato.

Estas pruebas no miden tiempo —eso depende de la máquina y haría fallar la
suite en un portátil cargado— sino **cuántas consultas** hace cada operación.
Es lo que delata el defecto real: recorrer el parque con una consulta por
activo cuesta lo mismo en cualquier hardware, y con 10.000 equipos el panel
tardaba 55 segundos por esa causa (ver `docs/rendimiento.md`).

Se fijan aquí porque el defecto que corrigieron era invisible con pocos datos:
con veinte activos, mil consultas tardan lo mismo que dos.
"""

import datetime

import pytest
from django.test import override_settings

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.alertas.models import ConfiguracionAlertas
from apps.alertas.reglas import construir_alertas
from apps.organizacion.models import Departamento
from apps.politicas.models import PoliticaObsolescencia
from apps.politicas.services import (
    candidatos_a_renovacion,
    evaluar_lote,
    resolver_politicas_de,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_perf", email="admin_perf@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def parque(admin):
    """Varios activos de varios tipos, con y sin política."""
    departamento = Departamento.objects.create(nombre="Tecnología", codigo="TI")
    tipos = [
        TipoDispositivo.objects.create(nombre=f"Tipo {letra}", codigo=letra)
        for letra in ("AAA", "BBB", "CCC")
    ]
    # Solo el primero tiene política propia; el resto cae en la global, y el
    # tercero no tiene ninguna. Las tres ramas se recorren en la misma pasada.
    PoliticaObsolescencia.objects.create(
        tipo_dispositivo=tipos[0], nombre="Propia", vida_util_meses=12
    )
    PoliticaObsolescencia.objects.create(nombre="General", vida_util_meses=24)

    for indice in range(15):
        ActivoService.crear_activo(
            actor=admin,
            tipo=tipos[indice % 3],
            nombre=f"Equipo {indice}",
            marca="Dell",
            modelo="Latitude",
            numero_serie=f"SN-PERF-{indice}",
            departamento=departamento,
            fecha_adquisicion=datetime.date(2019, 1, 15),
        )
    return Activo.objects.all()


def test_evaluar_en_lote_no_consulta_una_politica_por_activo(parque, django_assert_max_num_queries):
    """El defecto original: `evaluar_activo` recibía `None` como política y lo
    interpretaba como «no me la pasaron», así que la volvía a buscar por cada
    activo. Con 10.000 equipos eran 10.000 consultas."""
    activos = list(Activo.objects.select_related("tipo"))

    # Como mucho: dos por las políticas y una por la ventana móvil cuando
    # alguna la usa. Lo que importa es que el número no crezca con la cantidad
    # de activos, que era el defecto.
    with django_assert_max_num_queries(3):
        evaluar_lote(activos)


def test_las_politicas_se_resuelven_para_todos_los_tipos_en_dos_consultas(
    parque, django_assert_num_queries
):
    tipos = list(TipoDispositivo.objects.values_list("id", flat=True))

    with django_assert_num_queries(2):
        resolver_politicas_de(tipos)


def test_el_prefiltro_deja_pasar_a_todos_los_que_califican(parque):
    """El prefiltro es más ancho que el criterio final a propósito: puede
    dejar pasar de más, nunca de menos. Si alguna vez dejara fuera a un
    equipo que sí requiere renovación, el panel diría que el parque está
    mejor de lo que está."""
    todos = list(Activo.objects.select_related("tipo"))
    veredictos = {activo.id for activo, r in evaluar_lote(todos) if r.requiere_renovacion}

    candidatos, _ = candidatos_a_renovacion(Activo.objects.select_related("tipo"))
    ids_candidatos = {activo.id for activo in candidatos}

    assert veredictos, "el parque de prueba debe tener algún activo a renovar"
    assert veredictos <= ids_candidatos


def test_el_centro_de_alertas_no_escala_con_el_numero_de_activos(
    parque, django_assert_max_num_queries
):
    configuracion = ConfiguracionAlertas.cargar()

    # Siete reglas, cada una con su consulta, más las del motor de políticas.
    with django_assert_max_num_queries(25):
        construir_alertas(configuracion)


@override_settings(CACHE_AGREGADOS_SEGUNDOS=60)
def test_el_resumen_de_alertas_se_cachea(admin, parque):
    """Recorrer el parque cuesta CPU y son cifras que no cambian de un segundo
    a otro; con cinco usuarios simultáneos ese trabajo se acumulaba."""
    from django.core.cache import cache
    from rest_framework.test import APIClient

    cache.clear()
    cliente = APIClient()
    cliente.force_authenticate(user=admin)

    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    with CaptureQueriesContext(connection) as primera:
        assert cliente.get("/api/v1/alertas/").status_code == 200

    with CaptureQueriesContext(connection) as segunda:
        assert cliente.get("/api/v1/alertas/").status_code == 200

    # La segunda no vuelve a recorrer el parque: solo las consultas de sesión
    # y permisos, muchas menos que las de las siete reglas.
    assert len(segunda) < len(primera)
    assert len(segunda) <= 5


@override_settings(CACHE_AGREGADOS_SEGUNDOS=60)
def test_cambiar_la_configuracion_invalida_la_cache(admin, parque):
    """Si alguien apaga una alerta y sigue apareciendo, el sistema parece roto."""
    from django.core.cache import cache
    from rest_framework.test import APIClient

    cache.clear()
    cliente = APIClient()
    cliente.force_authenticate(user=admin)

    antes = cliente.get("/api/v1/alertas/").data
    tipos_antes = {alerta["tipo"] for alerta in antes["alertas"]}
    assert "sin_asignar" in tipos_antes

    cliente.patch("/api/v1/alertas/configuracion/", {"avisar_sin_asignar": False}, format="json")

    despues = cliente.get("/api/v1/alertas/").data
    assert "sin_asignar" not in {alerta["tipo"] for alerta in despues["alertas"]}
