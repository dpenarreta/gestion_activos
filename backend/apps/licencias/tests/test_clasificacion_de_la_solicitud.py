"""La solicitud guarda su clasificación (auditoría UX/UI, 05/11/2026).

- `unidad`, `descuento` y `tipo_ausencia` se copian del tipo al pedirla:
  reclasificar el tipo no reinterpreta las solicitudes ya hechas (ni sus
  ausencias ni lo que se devuelve al cancelar).
- El detalle de una aprobada dice lo que de verdad se descontó
  (`dias_a_devolver`, `ausencias_a_borrar`).
- «Vacaciones» como tipo de ausencia solo con descuento de vacaciones.
- `/licencias/tipos/` dice si el tipo es médico (`es_medico`).
- Un tipo por horas no cuenta «días seguidos»: habla de su día.
"""

import datetime
import importlib
import json

import pytest
from django.apps import apps as django_apps

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.licencias.models import FlujoPermiso, SolicitudPermiso
from apps.licencias.tests.test_ausencias_generadas import (  # noqa: F401 (fixture)
    FLUJOS,
    SOLICITUDES,
    _aprobar_medico,
    _aprobar_vacaciones,
    _ausencias,
    _clasificar,
    _feriado,
    _pedida,
    e,
    empresa_con_organigrama,
)
from apps.licencias.tests.test_restricciones import _con_reglas, _periodo
from apps.organizacion.models import GoceVacaciones

D = datetime.date


def _clasificacion(datos) -> tuple:
    return (datos["unidad"], datos["descuento"], datos["tipo_ausencia"])


def test_cambiar_el_tipo_no_cambia_las_solicitudes_existentes(e):  # noqa: F811
    _, ana = e["ana"]
    _, admin = e["admin"]
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-06")
    assert _clasificacion(solicitud) == ("dias", "ninguno", "PERSONAL")
    # Talento Humano reclasifica el tipo mientras la solicitud está en curso.
    _clasificar(e, "medico", unidad="horas", descuento="sueldo", tipo_ausencia="MEDICO")

    detalle = admin.get(f"{SOLICITUDES}{solicitud['id']}/").json()
    assert _clasificacion(detalle) == ("dias", "ninguno", "PERSONAL")
    assert detalle["hora_desde"] is None and detalle["minutos"] is None
    _aprobar_medico(e, solicitud["id"])
    ausencias = _ausencias(solicitud["id"])
    assert [a.date.day for a in ausencias] == [5, 6]
    assert {(a.type, a.descuento, a.is_full_day) for a in ausencias} == {
        ("PERSONAL", "ninguno", True)
    }


def test_reclasificar_unas_vacaciones_aprobadas_no_cambia_lo_que_se_devuelve(e):  # noqa: F811
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, admin = e["admin"]
    periodo = _periodo(usuario, D(2025, 6, 1))
    solicitud = _pedida(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    _aprobar_vacaciones(e, solicitud["id"])
    # El tipo deja de descontar vacaciones después de aprobada.
    _clasificar(e, "vacaciones", descuento="ninguno")

    detalle = admin.get(f"{SOLICITUDES}{solicitud['id']}/").json()
    assert detalle["descuento"] == "vacaciones"
    assert detalle["dias_a_devolver"] == 5
    assert detalle["ausencias_a_borrar"] == 5
    cancelada = admin.post(
        f"{SOLICITUDES}{solicitud['id']}/cancelar/",
        {"comentario": "Cambio de fechas", "devolver": "todos"},
    )
    assert cancelada.status_code == 200, cancelada.data
    with usando_empresa(empresa_actual()):
        assert not periodo.goces.exists()


def test_dias_a_devolver_solo_cuando_se_descontaron_vacaciones(e):  # noqa: F811
    _con_reglas(e)
    usuario, ana = e["ana"]
    _, admin = e["admin"]
    _periodo(usuario, D(2025, 6, 1))

    vacaciones = _pedida(ana, e["vacaciones"], "2026-11-02", "2026-11-06")
    pendiente = admin.get(f"{SOLICITUDES}{vacaciones['id']}/").json()
    assert (pendiente["dias_a_devolver"], pendiente["ausencias_a_borrar"]) == (0, 0)
    _aprobar_vacaciones(e, vacaciones["id"])
    aprobada = admin.get(f"{SOLICITUDES}{vacaciones['id']}/").json()
    assert aprobada["dias_a_devolver"] == 5
    assert aprobada["solicitante"]["nombre"] == "Ana"

    medico = _pedida(ana, e["medico"], "2026-11-10", "2026-11-11")
    _aprobar_medico(e, medico["id"])
    # El tipo pasa a descontar vacaciones después: esta solicitud no descontó.
    _clasificar(e, "medico", descuento="vacaciones")
    detalle = admin.get(f"{SOLICITUDES}{medico['id']}/").json()
    assert (detalle["dias_a_devolver"], detalle["ausencias_a_borrar"]) == (0, 2)
    respuesta = admin.post(
        f"{SOLICITUDES}{medico['id']}/cancelar/", {"comentario": "Volvió", "devolver": "todos"}
    )
    assert respuesta.status_code == 200, respuesta.data
    with usando_empresa(empresa_actual()):
        # Las vacaciones aprobadas siguen descontadas.
        goces = GoceVacaciones.objects.filter(periodo__usuario=usuario)
        assert sum(g.dias for g in goces) == 5


@pytest.mark.parametrize("descuento", ["ninguno", "sueldo"])
def test_vacaciones_como_ausencia_exige_descuento_de_vacaciones(e, descuento):  # noqa: F811
    _, admin = e["admin"]
    url = f"{FLUJOS}{e['medico']}/"
    respuesta = admin.patch(
        url, {"descuento": descuento, "tipo_ausencia": "VACACIONES"}, format="json"
    )
    assert respuesta.status_code == 400
    assert "tipo_ausencia" in respuesta.json()["error"]["details"]
    assert FlujoPermiso.objects.get(pk=e["medico"]).tipo_ausencia == "PERSONAL"
    # Tampoco solo con el tipo, sobre uno sin descuento de vacaciones.
    assert admin.patch(url, {"tipo_ausencia": "VACACIONES"}, format="json").status_code == 400


def test_los_tipos_para_solicitar_dicen_si_son_medicos(e):  # noqa: F811
    _, ana = e["ana"]
    _clasificar(e, "medico", tipo_ausencia="MEDICO")
    tipos = {t["id"]: t for t in ana.get("/api/v1/licencias/tipos/").json()}
    assert tipos[e["medico"]]["es_medico"] is True
    assert tipos[e["medico"]]["tipo_ausencia"] == "MEDICO"
    assert tipos[e["vacaciones"]]["es_medico"] is False


def test_la_migracion_rellena_la_clasificacion_de_las_solicitudes(e):  # noqa: F811
    migracion = importlib.import_module(
        "apps.licencias.migrations.0005_clasificacion_en_la_solicitud"
    )
    usuario, _ = e["ana"]
    _clasificar(e, "medico", unidad="horas", descuento="sueldo", tipo_ausencia="MEDICO")
    with usando_empresa(empresa_actual()):
        incoherente = FlujoPermiso.objects.create(nombre="Licencia especial")
        solicitud = SolicitudPermiso.objects.create(
            flujo_id=e["medico"], solicitante=usuario, desde=D(2026, 11, 5), hasta=D(2026, 11, 5)
        )
        otra = SolicitudPermiso.objects.create(
            flujo=incoherente, solicitante=usuario, desde=D(2026, 12, 1), hasta=D(2026, 12, 1)
        )
    # Como estaban antes de la migración: con los valores por defecto, y un
    # tipo «Vacaciones» sin descuento de vacaciones.
    SolicitudPermiso.objects.todas().update(
        unidad="dias", descuento="ninguno", tipo_ausencia="VACACIONES"
    )
    FlujoPermiso.objects.todas().filter(pk=incoherente.pk).update(tipo_ausencia="VACACIONES")

    migracion.corregir_vacaciones_sin_descuento(django_apps, None)
    migracion.rellenar_solicitudes(django_apps, None)

    for objeto in (solicitud, otra, incoherente):
        objeto.refresh_from_db()
    assert (solicitud.unidad, solicitud.descuento, solicitud.tipo_ausencia) == (
        "horas",
        "sueldo",
        "MEDICO",
    )
    assert incoherente.tipo_ausencia == "PERSONAL"
    assert (otra.unidad, otra.descuento, otra.tipo_ausencia) == ("dias", "ninguno", "PERSONAL")


# --- Restricciones de un tipo por horas ------------------------------------------------


def _reglas(cliente, flujo, desde, hasta):
    respuesta = cliente.get(
        f"/api/v1/licencias/tipos/{flujo}/evaluar/", {"desde": desde, "hasta": hasta}
    )
    assert respuesta.status_code == 200, respuesta.data
    datos = respuesta.json()
    return {r["clave"]: r for r in datos["reglas"]}, datos["bloquea"]


def test_un_tipo_por_horas_no_cuenta_dias_seguidos(e):  # noqa: F811
    _, ana = e["ana"]
    _clasificar(e, "medico", unidad="horas", dias_minimos=1, dias_maximos=3)
    reglas, bloquea = _reglas(ana, e["medico"], "2026-11-05", "2026-11-05")
    assert "minimo" not in reglas and "maximo" not in reglas
    assert reglas["dia"]["estado"] == "ok"
    assert reglas["dia"]["texto"] == "Permiso por horas del jueves 05/11/2026."
    assert bloquea is False

    varios, bloquea = _reglas(ana, e["medico"], "2026-11-05", "2026-11-06")
    assert varios["un_dia"]["estado"] == "falla"
    assert "minimo" not in varios and "maximo" not in varios
    assert bloquea is True


def test_un_permiso_por_horas_en_dia_no_laborable_habla_de_ese_dia(e):  # noqa: F811
    _, ana = e["ana"]
    _clasificar(e, "medico", unidad="horas")
    sabado, _ = _reglas(ana, e["medico"], "2026-11-07", "2026-11-07")
    assert sabado["dia"]["estado"] == "aviso"
    assert sabado["dia"]["texto"] == "El sábado 07/11/2026 no es laborable (es fin de semana)."
    _feriado(D(2026, 11, 3), "Independencia de Cuenca")
    feriado, bloquea = _reglas(ana, e["medico"], "2026-11-03", "2026-11-03")
    assert feriado["dia"]["texto"] == "El martes 03/11/2026 no es laborable (es feriado)."
    assert "seguid" not in json.dumps(feriado, ensure_ascii=False)
    assert bloquea is False


def test_los_dias_seguidos_se_escriben_en_singular_cuando_es_uno(e):  # noqa: F811
    _, ana = e["ana"]
    _clasificar(e, "medico", dias_minimos=1, dias_maximos=1)
    reglas, _ = _reglas(ana, e["medico"], "2026-11-05", "2026-11-05")
    assert reglas["minimo"]["texto"] == "Mínimo 1 día seguido por solicitud."
    assert reglas["maximo"]["texto"] == "Máximo 1 día seguido por solicitud."
