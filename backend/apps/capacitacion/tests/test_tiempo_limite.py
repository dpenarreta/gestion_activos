"""El tiempo límite de las evaluaciones del onboarding (22/10/2026).

Lo que se protege:

- El reloj es del servidor: corre desde que se abre la evaluación y volver a
  abrirla lo retoma (no lo reinicia), con el borrador guardado.
- Si el tiempo se acaba, se califica lo que se alcanzó a guardar, aunque se
  haya cerrado la ventana, y se avisa en la campana.
- Lo que llega pasado el plazo no cuenta: vale el borrador.
- Sin tiempo límite, todo sigue como antes.
"""

import datetime

from django.utils import timezone

from apps.capacitacion.models import EvaluacionEnCurso, Intento
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.notificaciones.models import Notificacion
from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/capacitacion/"

PREGUNTAS = [
    {
        "tipo": "unica",
        "texto": "¿Qué hacer ante un correo sospechoso?",
        "puntos": "5",
        "opciones": [
            {"texto": "Abrirlo", "correcta": False},
            {"texto": "Reportarlo a TI", "correcta": True},
        ],
    },
    {
        "tipo": "completar",
        "texto": "El SRI exige el [[RUC]].",
        "puntos": "5",
    },
]


def _preparar(tiempo_limite=10):
    _, gestor = _cuenta("gestor", "capacitacion.gestionar")
    datos = {"titulo": "Seguridad", "alcance": "empresa", "contenido": "Lea.", "nota_minima": 50}
    if tiempo_limite:
        datos["tiempo_limite"] = tiempo_limite
    material = gestor.post(f"{BASE}materiales/", datos, format="json").json()
    assert material["tiempo_limite"] == tiempo_limite
    gestor.put(
        f"{BASE}materiales/{material['id']}/preguntas/", {"preguntas": PREGUNTAS}, format="json"
    )
    usuario, pedro = _cuenta("pedro")
    pedro.post(f"{BASE}mi-onboarding/{material['id']}/visto/")
    return usuario, pedro, material


def _correcta(datos):
    unica = next(p for p in datos["preguntas"] if p["tipo"] == "unica")
    opcion = next(o["id"] for o in unica["opciones"] if o["texto"] == "Reportarlo a TI")
    return str(unica["id"]), opcion


def _vencer(usuario, segundos=60):
    with usando_empresa(empresa_actual()):
        EvaluacionEnCurso.objects.filter(usuario=usuario).update(
            vence=timezone.now() - datetime.timedelta(seconds=segundos)
        )


def test_el_reloj_corre_en_el_servidor_y_se_retoma_con_el_borrador(db):
    usuario, pedro, material = _preparar(tiempo_limite=10)
    url = f"{BASE}mi-onboarding/{material['id']}/"
    datos = pedro.get(f"{url}evaluacion/").json()
    assert datos["material"]["tiempo_limite"] == 10
    assert 590 <= datos["segundos_restantes"] <= 600
    pregunta, opcion = _correcta(datos)
    guardado = pedro.post(f"{url}borrador/", {"respuestas": {pregunta: opcion}}, format="json")
    assert guardado.json()["cerrada"] is False

    # Volver a abrirla no reinicia el reloj y trae lo respondido.
    with usando_empresa(empresa_actual()):
        EvaluacionEnCurso.objects.filter(usuario=usuario).update(
            vence=timezone.now() + datetime.timedelta(minutes=3)
        )
    otra_vez = pedro.get(f"{url}evaluacion/").json()
    assert otra_vez["segundos_restantes"] <= 180
    assert otra_vez["borrador"] == {pregunta: opcion}
    fila = next(m for m in pedro.get(f"{BASE}mi-onboarding/").json()["materiales"])
    assert fila["tiempo_limite"] == 10 and 0 < fila["segundos_restantes"] <= 180


def test_al_acabarse_el_tiempo_se_califica_lo_guardado_y_se_avisa(db):
    usuario, pedro, material = _preparar(tiempo_limite=5)
    url = f"{BASE}mi-onboarding/{material['id']}/"
    pregunta, opcion = _correcta(pedro.get(f"{url}evaluacion/").json())
    pedro.post(f"{url}borrador/", {"respuestas": {pregunta: opcion}}, format="json")
    _vencer(usuario)

    # Cerró la ventana: al volver a su onboarding ya está calificada.
    fila = pedro.get(f"{BASE}mi-onboarding/").json()["materiales"][0]
    assert fila["mejor_puntaje"] == 50 and fila["aprobado"] is True
    assert fila["segundos_restantes"] is None
    with usando_empresa(empresa_actual()):
        intento = Intento.objects.get(usuario=usuario)
        assert not EvaluacionEnCurso.objects.filter(usuario=usuario).exists()
    assert intento.por_tiempo is True and str(intento.nota) == "5.00"
    aviso = Notificacion.objects.todas().get(usuario=usuario, tipo="capacitacion.tiempo_agotado")
    assert "Seguridad" in aviso.titulo and "5/10 (50 %)" in aviso.resumen


def test_lo_que_llega_pasado_el_plazo_no_cuenta(db):
    usuario, pedro, material = _preparar(tiempo_limite=5)
    url = f"{BASE}mi-onboarding/{material['id']}/"
    datos = pedro.get(f"{url}evaluacion/").json()
    pregunta, opcion = _correcta(datos)
    completar = next(str(p["id"]) for p in datos["preguntas"] if p["tipo"] == "completar")
    pedro.post(f"{url}borrador/", {"respuestas": {pregunta: opcion}}, format="json")
    _vencer(usuario)
    tarde = pedro.post(
        f"{url}responder/",
        {"respuestas": {pregunta: opcion, completar: ["RUC"]}},
        format="json",
    ).json()
    assert tarde["por_tiempo"] is True and tarde["nota"] == "5.00"
    # Un borrador que llega tarde también cierra la evaluación.
    assert pedro.post(f"{url}borrador/", {"respuestas": {}}, format="json").status_code == 400


def test_el_envio_al_llegar_a_cero_cuenta_y_avisa(db):
    usuario, pedro, material = _preparar(tiempo_limite=5)
    url = f"{BASE}mi-onboarding/{material['id']}/"
    datos = pedro.get(f"{url}evaluacion/").json()
    pregunta, opcion = _correcta(datos)
    completar = next(str(p["id"]) for p in datos["preguntas"] if p["tipo"] == "completar")
    _vencer(usuario, segundos=5)  # dentro de la gracia
    resultado = pedro.post(
        f"{url}responder/",
        {"respuestas": {pregunta: opcion, completar: ["ruc"]}, "tiempo_agotado": True},
        format="json",
    ).json()
    assert resultado["nota"] == "10.00" and resultado["por_tiempo"] is True
    assert (
        Notificacion.objects.todas()
        .filter(usuario=usuario, tipo="capacitacion.tiempo_agotado")
        .count()
        == 1
    )


def test_sin_tiempo_limite_no_hay_reloj(db):
    usuario, pedro, material = _preparar(tiempo_limite=None)
    url = f"{BASE}mi-onboarding/{material['id']}/"
    datos = pedro.get(f"{url}evaluacion/").json()
    assert datos["segundos_restantes"] is None
    with usando_empresa(empresa_actual()):
        assert not EvaluacionEnCurso.objects.filter(usuario=usuario).exists()
    pregunta, opcion = _correcta(datos)
    resultado = pedro.post(
        f"{url}responder/", {"respuestas": {pregunta: opcion}}, format="json"
    ).json()
    assert resultado["por_tiempo"] is False and resultado["nota"] == "5.00"
    assert (
        not Notificacion.objects.todas()
        .filter(usuario=usuario, tipo="capacitacion.tiempo_agotado")
        .exists()
    )
