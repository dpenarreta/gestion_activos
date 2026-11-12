"""El nivel propuesto y la reincidencia (US-013, CA-3).

- Sin llamados previos, el primero; luego el siguiente al más alto emitido y
  no anulado; pasado el último, el último.
- Solo cuentan los de la misma persona y la misma causa con la fecha del hecho
  dentro del plazo de reincidencia; los anulados, solicitados y rechazados no.
- Un nivel desactivado se salta. Si Gestión Humana saltó a un nivel, el
  siguiente parte de ese.
"""

from apps.llamados.models import LlamadoAtencion
from apps.llamados.tests.conftest import (
    PROPUESTA,
    accion,
    cliente,
    codigo,
    crear_causa,
    emitir,
    hace,
    usuario,
)


def _propuesto(e, persona="ana", causa=None, **extra):
    respuesta = cliente(e, "carolina").get(
        PROPUESTA,
        {"persona": usuario(e, persona).pk, "causa": (causa or e["causa"]).pk, **extra},
    )
    assert respuesta.status_code == 200, respuesta.content
    return respuesta.json()


def _emitido(e, dias=7, nivel=None, persona="ana", justificacion="Reincidencia grave."):
    extra = {"fecha_hecho": hace(dias), "descripcion": f"Hecho de hace {dias} días."}
    if nivel is not None:
        extra.update(nivel=nivel.pk, justificacion_cambio=justificacion, monto="30,00")
    respuesta = emitir(e, persona=persona, **extra)
    assert respuesta.status_code == 201, respuesta.content
    return respuesta.json()


def test_escala_nivel_por_nivel_y_se_queda_en_el_ultimo(e):
    verbal, escrito, sancion = e["niveles"]
    datos = _propuesto(e)
    assert datos["nivel_propuesto"]["id"] == verbal.pk
    assert datos["nivel_propuesto"]["tipo"] == "verbal"
    assert datos["historial"] == []
    assert datos["es_ultimo_nivel"] is False

    _emitido(e, dias=30)
    datos = _propuesto(e)
    assert datos["nivel_propuesto"]["id"] == escrito.pk
    assert [h["nivel"] for h in datos["historial"]] == ["Primer llamado (verbal)"]
    assert {"id", "fecha_hecho", "nivel", "estado"} <= set(datos["historial"][0])

    _emitido(e, dias=20)
    datos = _propuesto(e)
    assert datos["nivel_propuesto"]["id"] == sancion.pk
    assert datos["monto_sugerido"] == "25.00"
    assert datos["es_ultimo_nivel"] is True

    _emitido(e, dias=10)
    assert _propuesto(e)["nivel_propuesto"]["id"] == sancion.pk


def test_fuera_del_plazo_de_reincidencia_vuelve_al_primero(e):
    verbal, escrito, _ = e["niveles"]
    # Unos 13 meses atrás: fuera de los 12 de la causa.
    viejo = _emitido(e, dias=400)
    datos = _propuesto(e)
    assert datos["nivel_propuesto"]["id"] == verbal.pk
    assert datos["historial"][0]["id"] == viejo["id"]
    assert datos["historial"][0]["cuenta"] is False

    # Unos 11 meses atrás (a otra persona, sin historial): dentro.
    _emitido(e, dias=330, persona="olga")
    assert _propuesto(e, persona="olga")["nivel_propuesto"]["id"] == escrito.pk


def test_el_plazo_es_el_de_la_causa_y_se_cuenta_desde_la_fecha_del_hecho(e):
    e["causa"].meses_reincidencia = 3
    e["causa"].save()
    verbal, escrito, _ = e["niveles"]
    _emitido(e, dias=120)  # unos 4 meses
    assert _propuesto(e)["nivel_propuesto"]["id"] == verbal.pk
    # Un hecho de hace 100 días cuenta a partir de él: el de hace 120 entra.
    assert _propuesto(e, fecha_hecho=hace(100))["nivel_propuesto"]["id"] == escrito.pk


def test_anulados_solicitados_y_otras_causas_o_personas_no_cuentan(e):
    verbal, escrito, _ = e["niveles"]
    otra_causa, _ = crear_causa("Uso indebido del uniforme")
    llamado = _emitido(e, dias=15)
    accion(e, "carolina", llamado["id"], "anular", {"motivo": "Se registró por error."})
    assert _propuesto(e)["nivel_propuesto"]["id"] == verbal.pk

    # Una solicitud de la jefa (pendiente) tampoco cuenta.
    solicitado = emitir(e, quien="julia")
    assert solicitado.status_code == 201
    assert solicitado.json()["estado"] == "solicitado"
    assert _propuesto(e)["nivel_propuesto"]["id"] == verbal.pk

    # Ni lo de otra persona, ni lo de otra causa.
    _emitido(e, persona="olga")
    respuesta = cliente(e, "carolina").post(
        "/api/v1/llamados/llamados/",
        {
            "persona": usuario(e, "ana").pk,
            "causa": otra_causa.pk,
            "fecha_hecho": hace(3),
            "descripcion": "Otra falta.",
        },
        format="json",
    )
    assert respuesta.status_code == 201
    assert _propuesto(e)["nivel_propuesto"]["id"] == verbal.pk
    assert _propuesto(e, persona="olga")["nivel_propuesto"]["id"] == escrito.pk


def test_si_se_salto_un_nivel_el_siguiente_parte_de_ese(e):
    _, escrito, sancion = e["niveles"]
    _emitido(e, dias=10, nivel=sancion)
    assert _propuesto(e)["nivel_propuesto"]["id"] == sancion.pk


def test_un_nivel_desactivado_se_salta(e):
    verbal, escrito, sancion = e["niveles"]
    escrito.activo = False
    escrito.save()
    _emitido(e, dias=10)
    datos = _propuesto(e)
    assert datos["nivel_propuesto"]["id"] == sancion.pk
    assert [n["id"] for n in datos["niveles"]] == [verbal.pk, sancion.pk]


def test_la_propuesta_pide_permiso_y_persona_de_su_alcance(e):
    assert (
        cliente(e, "nadia")
        .get(PROPUESTA, {"persona": usuario(e, "ana").pk, "causa": e["causa"].pk})
        .status_code
        == 403
    )
    # La jefa, solo en su equipo y sin el historial.
    propia = cliente(e, "julia").get(
        PROPUESTA, {"persona": usuario(e, "ana").pk, "causa": e["causa"].pk}
    )
    assert propia.status_code == 200
    assert propia.json()["modo"] == "solicitar"
    assert propia.json()["historial"] == []
    ajena = cliente(e, "julia").get(
        PROPUESTA, {"persona": usuario(e, "olga").pk, "causa": e["causa"].pk}
    )
    assert ajena.status_code == 403
    assert codigo(ajena) == "fuera_de_su_equipo"


def test_al_confirmar_se_recalcula_la_propuesta(e):
    """Entre la solicitud y la confirmación se emitió otro: al confirmar sin
    elegir nivel, queda el que corresponde ahora."""
    _, escrito, _ = e["niveles"]
    solicitado = emitir(e, quien="julia").json()
    assert solicitado["nivel_propuesto"]["nombre"] == "Primer llamado (verbal)"
    _emitido(e, dias=20)
    confirmado = accion(e, "carolina", solicitado["id"], "confirmar")
    assert confirmado.status_code == 200, confirmado.content
    assert confirmado.json()["nivel_aplicado"]["id"] == escrito.pk
    assert LlamadoAtencion.objects.get(pk=solicitado["id"]).nivel_propuesto_id == escrito.pk
