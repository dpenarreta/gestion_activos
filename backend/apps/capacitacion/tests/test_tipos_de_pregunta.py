"""Los tipos de pregunta del onboarding y su calificación (22/10/2026).

Marcar la correcta, opción múltiple, completar espacios y unir. Cada pregunta
vale sus puntos (suman 10); la nota es sobre 10 y aprueba con el porcentaje del
material. Las correctas no se envían a quien rinde.
"""

from apps.capacitacion import evaluacion
from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/capacitacion/"

PREGUNTAS = [
    {
        "tipo": "unica",
        "texto": "¿Qué hacer ante un correo sospechoso?",
        "puntos": "2",
        "opciones": [
            {"texto": "Abrirlo", "correcta": False},
            {"texto": "Reportarlo a TI", "correcta": True},
        ],
    },
    {
        "tipo": "multiple",
        "texto": "¿Cuáles son datos sensibles?",
        "puntos": "3",
        "opciones": [
            {"texto": "Contraseñas", "correcta": True},
            {"texto": "Cédulas", "correcta": True},
            {"texto": "El menú del día", "correcta": False},
        ],
    },
    {
        "tipo": "completar",
        "texto": "El SRI exige el [[RUC]] y la firma [[electrónica|digital]].",
        "puntos": "2.5",
    },
    {
        "tipo": "unir",
        "texto": "Una cada sigla con su entidad",
        "puntos": "2.5",
        "opciones": [
            {"texto": "SRI", "pareja": "Servicio de Rentas Internas"},
            {"texto": "IESS", "pareja": "Seguridad Social"},
        ],
    },
]


def _preparar(nota_minima=70):
    _, gestor = _cuenta("gestor", "capacitacion.gestionar")
    material = gestor.post(
        f"{BASE}materiales/",
        {
            "titulo": "Seguridad",
            "alcance": "empresa",
            "contenido": "Lea.",
            "nota_minima": nota_minima,
        },
        format="json",
    ).json()
    guardado = gestor.put(
        f"{BASE}materiales/{material['id']}/preguntas/", {"preguntas": PREGUNTAS}, format="json"
    )
    assert guardado.status_code == 200, guardado.data
    _, pedro = _cuenta("pedro")
    pedro.post(f"{BASE}mi-onboarding/{material['id']}/visto/")
    return gestor, pedro, material


def test_se_presenta_sin_revelar_las_correctas(db):
    _, pedro, material = _preparar()
    datos = pedro.get(f"{BASE}mi-onboarding/{material['id']}/evaluacion/").json()
    texto = str(datos)
    assert "correcta" not in texto and "pareja" not in texto and "electrónica" not in texto
    completar = next(p for p in datos["preguntas"] if p["tipo"] == "completar")
    assert completar["huecos"] == 2 and None in completar["segmentos"]
    unir = next(p for p in datos["preguntas"] if p["tipo"] == "unir")
    assert sorted(unir["derecha"]) == ["Seguridad Social", "Servicio de Rentas Internas"]


def test_la_nota_suma_los_puntos_de_cada_tipo_sobre_10(db):
    _, pedro, material = _preparar(nota_minima=70)
    datos = pedro.get(f"{BASE}mi-onboarding/{material['id']}/evaluacion/").json()
    por_tipo = {p["tipo"]: p for p in datos["preguntas"]}
    opcion = lambda p, t: next(o["id"] for o in p["opciones"] if o["texto"] == t)  # noqa: E731
    respuestas = {
        str(por_tipo["unica"]["id"]): opcion(por_tipo["unica"], "Reportarlo a TI"),  # 2
        # Una de dos correctas y ninguna errada: la mitad de 3 = 1.5
        str(por_tipo["multiple"]["id"]): [opcion(por_tipo["multiple"], "Contraseñas")],
        # Sin tildes ni mayúsculas, y la alternativa «digital»: 2.5
        str(por_tipo["completar"]["id"]): ["ruc", "DIGITAL"],
        # Una de dos parejas: 1.25
        str(por_tipo["unir"]["id"]): {
            str(por_tipo["unir"]["izquierda"][0]["id"]): "Servicio de Rentas Internas",
            str(por_tipo["unir"]["izquierda"][1]["id"]): "Servicio de Rentas Internas",
        },
    }
    resultado = pedro.post(
        f"{BASE}mi-onboarding/{material['id']}/responder/",
        {"respuestas": respuestas},
        format="json",
    ).json()
    # 2 + 1.5 + 2.5 + 1.25 = 7.25 → 73 % ≥ 70 %: aprueba.
    assert resultado["nota"] == "7.25"
    assert resultado["puntaje"] == 73 and resultado["aprobado"] is True
    assert "Una cada sigla con su entidad" in resultado["a_reforzar"]


def test_los_puntos_deben_sumar_10_y_cada_tipo_se_valida(db):
    _, gestor = _cuenta("gestor", "capacitacion.gestionar")
    material = gestor.post(
        f"{BASE}materiales/",
        {"titulo": "X", "alcance": "empresa", "contenido": "Lea."},
        format="json",
    ).json()
    url = f"{BASE}materiales/{material['id']}/preguntas/"
    no_suma = [{**PREGUNTAS[0], "puntos": "4"}, {**PREGUNTAS[2], "puntos": "4"}]
    assert "deben sumar 10" in str(gestor.put(url, {"preguntas": no_suma}, format="json").json())
    sin_hueco = [{"tipo": "completar", "texto": "Sin espacios", "puntos": "10"}]
    assert gestor.put(url, {"preguntas": sin_hueco}, format="json").status_code == 400
    dos_correctas = [
        {
            **PREGUNTAS[0],
            "puntos": "10",
            "opciones": [{"texto": "a", "correcta": True}, {"texto": "b", "correcta": True}],
        }
    ]
    assert gestor.put(url, {"preguntas": dos_correctas}, format="json").status_code == 400


def test_opcion_multiple_resta_lo_marcado_de_mas():
    class O:
        def __init__(self, i, c):
            self.id, self.correcta = i, c

    class P:
        tipo = "multiple"
        puntos = 3
        id = 1

        class opciones:  # noqa: N801
            @staticmethod
            def all():
                return [O(1, True), O(2, True), O(3, False)]

    assert evaluacion._fraccion(P, [1, 2]) == 1
    assert evaluacion._fraccion(P, [1, 3]) == 0  # una buena y una mala se anulan
    assert evaluacion._fraccion(P, [1, 2, 3]) == evaluacion.Decimal("0.5")
