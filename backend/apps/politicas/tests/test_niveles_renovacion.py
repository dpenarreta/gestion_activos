"""Dos niveles de sugerencia y ventana móvil de reparaciones (§11).

El documento pide escalonar el aviso —«Evaluar reemplazo» a los 48 meses,
«Reemplazo recomendado» a los 60— y contar las reparaciones dentro de una
ventana de 12 meses, no sobre todo el historial: un contador que solo sube
deja marcado para siempre un equipo que falló mucho hace años y hoy funciona
sin problemas.
"""

import datetime

import pytest
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.mantenimientos.models import Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento
from apps.politicas.models import NivelRenovacion, PoliticaObsolescencia, mas_severo
from apps.politicas.services import (
    contar_mantenimientos_en_ventana,
    evaluar_activo,
    evaluar_lote,
    restar_meses,
)
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_niv", email="admin_niv@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def tipo_laptop(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def crear_activo(admin, db, tipo_laptop):
    departamento = Departamento.objects.create(nombre="Sistemas", codigo="SIS")
    contador = {"n": 0}

    def _crear(meses_de_antiguedad=0, tipo=None):
        contador["n"] += 1
        return ActivoService.crear_activo(
            actor=admin,
            tipo=tipo or tipo_laptop,
            nombre=f"Equipo {contador['n']}",
            marca="Lenovo",
            modelo="ThinkPad",
            numero_serie=f"SN-NIV-{contador['n']}",
            departamento=departamento,
            fecha_adquisicion=restar_meses(hoy(), meses_de_antiguedad),
        )

    return _crear


def hoy():
    from django.utils import timezone

    return timezone.localdate()


def _reparar(admin, activo, fecha):
    return MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=fecha,
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion="Intervención",
    )


# --- Escalonamiento por longevidad -----------------------------------------


@pytest.fixture
def politica_del_documento(tipo_laptop):
    """Los umbrales tal como los enuncia el §11."""
    return PoliticaObsolescencia.objects.create(
        nombre="Laptops corporativas",
        tipo_dispositivo=tipo_laptop,
        vida_util_meses=48,
        vida_util_critica_meses=60,
        max_mantenimientos=3,
        ventana_mantenimientos_meses=12,
    )


@pytest.mark.parametrize(
    ("antiguedad", "nivel"),
    [
        (47, NivelRenovacion.NINGUNO),
        (48, NivelRenovacion.EVALUAR),
        (59, NivelRenovacion.EVALUAR),
        (60, NivelRenovacion.RECOMENDADO),
        (72, NivelRenovacion.RECOMENDADO),
    ],
)
def test_la_longevidad_escala_de_evaluar_a_recomendado(
    crear_activo, politica_del_documento, antiguedad, nivel
):
    activo = crear_activo(meses_de_antiguedad=antiguedad)

    assert evaluar_activo(activo).nivel == nivel


def test_la_longevidad_no_duplica_el_motivo_al_cruzar_los_dos_umbrales(
    crear_activo, politica_del_documento
):
    """Un equipo de 72 meses supera 48 y 60; decirlo dos veces en la ficha
    sería repetir el mismo hecho con distinta severidad."""
    activo = crear_activo(meses_de_antiguedad=72)

    motivos = evaluar_activo(activo).motivos
    longevidad = [motivo for motivo in motivos if motivo["criterio"] == "longevidad"]
    assert len(longevidad) == 1
    assert longevidad[0]["umbral"] == 60


def test_sin_segundo_umbral_la_politica_se_comporta_como_antes(crear_activo, tipo_laptop):
    """Las políticas creadas antes de que existieran los niveles siguen
    dando un solo aviso, en lugar de quedarse mudas o escalar solas."""
    PoliticaObsolescencia.objects.create(
        nombre="Solo un nivel", tipo_dispositivo=tipo_laptop, vida_util_meses=48
    )
    activo = crear_activo(meses_de_antiguedad=90)

    resultado = evaluar_activo(activo)

    assert resultado.nivel == NivelRenovacion.EVALUAR
    assert resultado.requiere_renovacion is True


def test_el_nivel_reportado_es_el_mas_severo_de_los_criterios(
    admin, crear_activo, politica_del_documento
):
    activo = crear_activo(meses_de_antiguedad=61)
    for numero in range(4):
        _reparar(admin, activo, hoy() - datetime.timedelta(days=numero * 10))
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    criterios = {motivo["criterio"]: motivo["nivel"] for motivo in resultado.motivos}
    assert criterios == {
        "mantenimientos": NivelRenovacion.EVALUAR,
        "longevidad": NivelRenovacion.RECOMENDADO,
    }
    assert resultado.nivel == NivelRenovacion.RECOMENDADO


def test_mas_severo_ordena_por_gravedad_y_no_por_orden_de_llegada():
    assert mas_severo(NivelRenovacion.EVALUAR, NivelRenovacion.RECOMENDADO) == "recomendado"
    assert mas_severo(NivelRenovacion.RECOMENDADO, NivelRenovacion.EVALUAR) == "recomendado"
    assert mas_severo() == NivelRenovacion.NINGUNO


# --- Ventana móvil de reparaciones -----------------------------------------


def test_las_reparaciones_viejas_salen_de_la_ventana(admin, crear_activo, politica_del_documento):
    """Cuatro intervenciones, pero solo dos dentro de los últimos 12 meses:
    el equipo no debe seguir marcado por lo que le pasó hace años."""
    activo = crear_activo(meses_de_antiguedad=40)
    for antiguo in (30, 20):
        _reparar(admin, activo, restar_meses(hoy(), antiguo))
    for reciente in (2, 1):
        _reparar(admin, activo, restar_meses(hoy(), reciente))
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    assert activo.total_mantenimientos == 4
    assert resultado.requiere_renovacion is False


def test_cuatro_reparaciones_dentro_de_la_ventana_disparan_el_aviso(
    admin, crear_activo, politica_del_documento
):
    activo = crear_activo(meses_de_antiguedad=40)
    for meses in (9, 6, 3, 1):
        _reparar(admin, activo, restar_meses(hoy(), meses))
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    assert resultado.nivel == NivelRenovacion.EVALUAR
    motivo = next(m for m in resultado.motivos if m["criterio"] == "mantenimientos")
    assert motivo["valor_actual"] == 4
    assert "últimos 12 meses" in motivo["detalle"]


def test_sin_ventana_configurada_se_cuenta_todo_el_historial(admin, crear_activo, tipo_laptop):
    """Es el comportamiento original de RF-06 y se conserva: dejar la ventana
    vacía significa «cuenta todo», no «cuenta los últimos 0 meses»."""
    PoliticaObsolescencia.objects.create(
        nombre="Histórico", tipo_dispositivo=tipo_laptop, max_mantenimientos=3
    )
    activo = crear_activo(meses_de_antiguedad=60)
    for meses in (40, 30, 20, 10):
        _reparar(admin, activo, restar_meses(hoy(), meses))
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    motivo = next(m for m in resultado.motivos if m["criterio"] == "mantenimientos")
    assert motivo["valor_actual"] == 4
    assert "en total" in motivo["detalle"]


def test_el_borde_de_la_ventana_incluye_el_dia_exacto(admin, crear_activo):
    activo = crear_activo(meses_de_antiguedad=30)
    hace_doce_meses = restar_meses(hoy(), 12)
    _reparar(admin, activo, hace_doce_meses)
    _reparar(admin, activo, hace_doce_meses - datetime.timedelta(days=1))

    conteo = contar_mantenimientos_en_ventana([activo.id], 12)

    assert conteo[activo.id] == 1


def test_restar_meses_usa_aritmetica_de_calendario():
    """No `meses * 30` días: la ventana de 12 meses debe terminar exactamente
    un año antes, y el 31 de mayo tres meses atrás no existe en febrero."""
    assert restar_meses(datetime.date(2026, 9, 8), 12) == datetime.date(2025, 9, 8)
    assert restar_meses(datetime.date(2026, 5, 31), 3) == datetime.date(2026, 2, 28)
    assert restar_meses(datetime.date(2026, 1, 15), 13) == datetime.date(2024, 12, 15)


# --- Evaluación en lote ----------------------------------------------------


def test_el_lote_resuelve_la_ventana_con_una_sola_consulta_agregada(
    admin, crear_activo, politica_del_documento, django_assert_max_num_queries
):
    """El documento dimensiona entre 5.000 y 10.000 activos: una consulta de
    conteo por equipo haría inviable el panel."""
    activos = [crear_activo(meses_de_antiguedad=20) for _ in range(5)]
    for activo in activos:
        _reparar(admin, activo, hoy())

    consulta = Activo.objects.select_related("tipo").order_by("id")
    # 1 política (se cachea por tipo) + 1 conteo agregado de la ventana.
    with django_assert_max_num_queries(3):
        evaluados = evaluar_lote(consulta)

    assert len(evaluados) == 5


def test_cada_tipo_cuenta_su_propia_ventana(admin, crear_activo, tipo_laptop):
    """Dos tipos con ventanas distintas no pueden compartir el conteo: el de
    24 meses debe ver una reparación que el de 6 meses ya dejó fuera."""
    impresora = TipoDispositivo.objects.create(nombre="Impresora", codigo="IMP")
    PoliticaObsolescencia.objects.create(
        nombre="Laptops",
        tipo_dispositivo=tipo_laptop,
        max_mantenimientos=0,
        ventana_mantenimientos_meses=6,
    )
    PoliticaObsolescencia.objects.create(
        nombre="Impresoras",
        tipo_dispositivo=impresora,
        max_mantenimientos=0,
        ventana_mantenimientos_meses=24,
    )
    laptop = crear_activo(meses_de_antiguedad=36)
    impresa = crear_activo(meses_de_antiguedad=36, tipo=impresora)
    hace_un_ano = restar_meses(hoy(), 12)
    _reparar(admin, laptop, hace_un_ano)
    _reparar(admin, impresa, hace_un_ano)

    veredictos = {
        activo.id: resultado
        for activo, resultado in evaluar_lote(Activo.objects.select_related("tipo"))
    }

    assert veredictos[laptop.id].requiere_renovacion is False
    assert veredictos[impresa.id].requiere_renovacion is True


# --- La caché del activo guarda el nivel -----------------------------------


def test_la_caché_del_activo_guarda_el_nivel(admin, crear_activo, politica_del_documento):
    from apps.politicas.services import refrescar_indicadores_renovacion

    activo = crear_activo(meses_de_antiguedad=61)

    refrescar_indicadores_renovacion(activo)

    activo.refresh_from_db()
    assert activo.nivel_renovacion == NivelRenovacion.RECOMENDADO
    assert activo.requiere_renovacion is True


def test_el_listado_filtra_por_nivel(cliente, crear_activo, politica_del_documento):
    from apps.politicas.services import refrescar_indicadores_renovacion

    recomendado = crear_activo(meses_de_antiguedad=70)
    evaluar = crear_activo(meses_de_antiguedad=50)
    sano = crear_activo(meses_de_antiguedad=6)
    for activo in (recomendado, evaluar, sano):
        refrescar_indicadores_renovacion(activo)

    respuesta = cliente.get("/api/v1/activos/", {"nivel_renovacion": "recomendado"})

    codigos = [fila["codigo_barras"] for fila in respuesta.json()["results"]]
    assert codigos == [recomendado.codigo_barras]


# --- API de políticas ------------------------------------------------------


def test_la_api_rechaza_un_segundo_umbral_menor_que_el_primero(cliente, tipo_laptop):
    """Al revés, el nivel «recomendado» absorbería al de «evaluar» y el primer
    aviso no llegaría nunca."""
    respuesta = cliente.post(
        "/api/v1/politicas/",
        {
            "nombre": "Invertida",
            "tipo_dispositivo": tipo_laptop.id,
            "vida_util_meses": 60,
            "vida_util_critica_meses": 48,
        },
        format="json",
    )

    assert respuesta.status_code == 400
    assert "vida_util_critica_meses" in respuesta.json()["error"]["details"]


def test_la_ventana_sin_maximo_de_intervenciones_se_rechaza(cliente, tipo_laptop):
    respuesta = cliente.post(
        "/api/v1/politicas/",
        {
            "nombre": "Ventana suelta",
            "tipo_dispositivo": tipo_laptop.id,
            "vida_util_meses": 48,
            "ventana_mantenimientos_meses": 12,
        },
        format="json",
    )

    assert respuesta.status_code == 400
    assert "ventana_mantenimientos_meses" in respuesta.json()["error"]["details"]


def test_las_sugerencias_se_agrupan_por_nivel(cliente, crear_activo, politica_del_documento):
    crear_activo(meses_de_antiguedad=70)
    crear_activo(meses_de_antiguedad=50)
    crear_activo(meses_de_antiguedad=6)

    datos = cliente.get("/api/v1/politicas/sugerencias/").json()

    assert datos["total"] == 2
    assert datos["por_nivel"] == {"recomendado": 1, "evaluar": 1}
    # Lo recomendado primero: es lo que hay que presupuestar.
    assert datos["resultados"][0]["nivel_renovacion"] == "recomendado"


def test_las_sugerencias_se_pueden_filtrar_por_nivel(cliente, crear_activo, politica_del_documento):
    crear_activo(meses_de_antiguedad=70)
    crear_activo(meses_de_antiguedad=50)

    datos = cliente.get("/api/v1/politicas/sugerencias/", {"nivel": "evaluar"}).json()

    assert datos["total"] == 1
    assert datos["resultados"][0]["nivel_renovacion"] == "evaluar"


def test_el_panel_desglosa_los_dos_niveles(cliente, crear_activo, politica_del_documento):
    crear_activo(meses_de_antiguedad=70)
    crear_activo(meses_de_antiguedad=50)
    crear_activo(meses_de_antiguedad=6)

    activos = cliente.get("/api/v1/activos/dashboard/").json()["activos"]

    assert activos["requieren_renovacion"] == 2
    assert activos["reemplazo_recomendado"] == 1
    assert activos["evaluar_reemplazo"] == 1
