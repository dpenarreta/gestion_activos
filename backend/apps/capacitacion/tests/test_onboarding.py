"""Onboarding y capacitación (20/10/2026).

Lo que se protege:

- El plan de cada persona: lo de la empresa, lo de su área y lo de su cargo
  (no lo de otras áreas o cargos).
- Quien entra a la empresa recibe su onboarding con fecha límite.
- Evaluarse pide haber abierto el material; se califica sobre 100 con la nota
  mínima; los intentos se acaban (Talento Humano los devuelve); las correctas
  no se revelan; se informa qué reforzar.
- Al aprobar todo, el onboarding queda completo.
- Gestionar materiales y ver resultados piden sus permisos; nadie se evalúa
  de un material que no es de su plan.
"""

import datetime

from django.utils import timezone

from apps.capacitacion.models import Onboarding
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion import organigrama
from apps.organizacion.models import Cargo, NivelJerarquico, UnidadOrganizacional
from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/capacitacion/"


def _estructura():
    with usando_empresa(empresa_actual()):
        nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
        ti = UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=nivel)
        ventas = UnidadOrganizacional.objects.create(nombre="Ventas", nivel=nivel)
        analista = Cargo.objects.create(nombre="Analista Programador", unidad=ti)
        asistente = Cargo.objects.create(nombre="Asistente de Sistemas", unidad=ti)
        vendedor = Cargo.objects.create(nombre="Vendedor", unidad=ventas)
    return {
        "ti": ti,
        "ventas": ventas,
        "analista": analista,
        "asistente": asistente,
        "vendedor": vendedor,
    }


PREGUNTAS = [
    {
        "texto": "¿Qué hacer ante un correo sospechoso?",
        "opciones": [
            {"texto": "Abrir el adjunto", "correcta": False},
            {"texto": "Reportarlo a TI", "correcta": True},
        ],
    },
    {
        "texto": "¿Cada cuánto cambiar la contraseña?",
        "opciones": [
            {"texto": "Nunca", "correcta": False},
            {"texto": "Cuando lo pida el sistema", "correcta": True},
        ],
    },
]


def _material(gestor, **datos):
    respuesta = gestor.post(
        f"{BASE}materiales/",
        {"contenido": "Lea esto con atención.", "nota_minima": 100, **datos},
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data
    material = respuesta.json()
    assert (
        gestor.put(
            f"{BASE}materiales/{material['id']}/preguntas/", {"preguntas": PREGUNTAS}, format="json"
        ).status_code
        == 200
    )
    return material


def _plan(e):
    _, gestor = _cuenta("ti", "capacitacion.gestionar", "capacitacion.resultados")
    general = _material(gestor, titulo="Seguridad de la información", alcance="empresa")
    area = _material(gestor, titulo="Cómo trabaja TI", alcance="unidad", unidad=e["ti"].id)
    cargo = _material(
        gestor, titulo="Estándares de código", alcance="cargo", cargo=e["analista"].id
    )
    _material(gestor, titulo="Ventas consultivas", alcance="unidad", unidad=e["ventas"].id)
    _material(gestor, titulo="Soporte en sitio", alcance="cargo", cargo=e["asistente"].id)
    return gestor, general, area, cargo


def _correctas(cliente, material_id):
    evaluacion = cliente.get(f"{BASE}mi-onboarding/{material_id}/evaluacion/").json()
    # No viene cuál es la correcta.
    assert "correcta" not in str(evaluacion)
    elegir = {"Reportarlo a TI", "Cuando lo pida el sistema"}
    return {
        str(p["id"]): next(o["id"] for o in p["opciones"] if o["texto"] in elegir)
        for p in evaluacion["preguntas"]
    }


def test_el_plan_es_empresa_area_y_cargo_y_se_asigna_al_entrar(db):
    e = _estructura()
    _, general, area, cargo = _plan(e)
    usuario, pedro = _cuenta("pedro")
    with usando_empresa(empresa_actual()):
        organigrama.asignar(usuario, e["analista"])
        onboarding = Onboarding.objects.get(usuario=usuario)
    assert onboarding.fecha_limite == timezone.localdate() + datetime.timedelta(days=15)

    progreso = pedro.get(f"{BASE}mi-onboarding/").json()
    assert progreso["asignado"] is True and progreso["total"] == 3
    assert [m["titulo"] for m in progreso["materiales"]] == [
        "Seguridad de la información",
        "Cómo trabaja TI",
        "Estándares de código",
    ]
    # Lo de otra área o cargo no es de su plan.
    ajeno = pedro.get(f"{BASE}mi-onboarding/{area['id'] + 2}/evaluacion/")
    assert ajeno.status_code == 404


def test_evaluarse_intentos_y_completar_el_onboarding(db):
    e = _estructura()
    gestor, general, area, cargo = _plan(e)
    usuario, pedro = _cuenta("pedro")
    with usando_empresa(empresa_actual()):
        organigrama.asignar(usuario, e["analista"])

    # Sin abrir el material no hay evaluación.
    assert pedro.get(f"{BASE}mi-onboarding/{general['id']}/evaluacion/").status_code == 400
    pedro.post(f"{BASE}mi-onboarding/{general['id']}/visto/")
    correctas = _correctas(pedro, general["id"])

    # Un intento con una mal: 50, no aprueba (nota mínima 100) y dice qué reforzar.
    una_mal = dict(correctas)
    primera = next(iter(una_mal))
    una_mal[primera] = una_mal[primera] - 1
    resultado = pedro.post(
        f"{BASE}mi-onboarding/{general['id']}/responder/", {"respuestas": una_mal}, format="json"
    ).json()
    assert resultado["puntaje"] == 50 and resultado["aprobado"] is False
    assert resultado["intentos_restantes"] == 2
    assert len(resultado["a_reforzar"]) == 1

    # Se acaban los intentos; Talento Humano los devuelve.
    for _ in range(2):
        pedro.post(
            f"{BASE}mi-onboarding/{general['id']}/responder/", {"respuestas": {}}, format="json"
        )
    agotado = pedro.get(f"{BASE}mi-onboarding/{general['id']}/evaluacion/")
    assert agotado.status_code == 400
    assert "intentos" in str(agotado.data)
    gestor.post(
        f"{BASE}devolver-intentos/",
        {"usuario": usuario.id, "material": general["id"]},
        format="json",
    )

    for material in (general, area, cargo):
        pedro.post(f"{BASE}mi-onboarding/{material['id']}/visto/")
        respuesta = pedro.post(
            f"{BASE}mi-onboarding/{material['id']}/responder/",
            {"respuestas": _correctas(pedro, material["id"])},
            format="json",
        ).json()
        assert respuesta["puntaje"] == 100 and respuesta["aprobado"] is True

    progreso = pedro.get(f"{BASE}mi-onboarding/").json()
    assert progreso["aprobados"] == 3 and progreso["completado_en"]
    # Lo aprobado no se vuelve a rendir.
    assert pedro.get(f"{BASE}mi-onboarding/{general['id']}/evaluacion/").status_code == 400

    resultados = gestor.get(f"{BASE}resultados/").json()
    fila = next(p for p in resultados["personas"] if p["usuario"]["id"] == usuario.id)
    assert fila["aprobados"] == 3 and fila["promedio"] == 100
    estadistica = next(m for m in resultados["materiales"] if m["id"] == general["id"])
    assert estadistica["mas_falladas"][0]["veces"] >= 1


def test_permisos_y_validaciones(db):
    _estructura()
    _, rosa = _cuenta("rosa")
    assert rosa.post(f"{BASE}materiales/", {"titulo": "x"}, format="json").status_code == 403
    assert rosa.get(f"{BASE}resultados/").status_code == 403
    _, gestor = _cuenta("ti", "capacitacion.gestionar")
    sin_area = gestor.post(
        f"{BASE}materiales/",
        {"titulo": "x", "alcance": "unidad", "contenido": "y"},
        format="json",
    )
    assert sin_area.status_code == 400
    vacio = gestor.post(f"{BASE}materiales/", {"titulo": "x", "alcance": "empresa"}, format="json")
    assert vacio.status_code == 400
    material = _material(gestor, titulo="General", alcance="empresa")
    sin_correcta = gestor.put(
        f"{BASE}materiales/{material['id']}/preguntas/",
        {"preguntas": [{"texto": "¿?", "opciones": [{"texto": "a"}, {"texto": "b"}]}]},
        format="json",
    )
    assert sin_correcta.status_code == 400


def test_talento_humano_asigna_a_cuentas_existentes(db):
    usuario, _ = _cuenta("pedro")
    with usando_empresa(empresa_actual()):
        Onboarding.objects.filter(usuario=usuario).delete()
    _, th = _cuenta("tatiana", "capacitacion.resultados")
    respuesta = th.post(f"{BASE}asignar/", {"usuarios": [usuario.id], "dias": 30}, format="json")
    assert respuesta.json() == {"asignados": 1}
    with usando_empresa(empresa_actual()):
        onboarding = Onboarding.objects.get(usuario=usuario)
    assert onboarding.fecha_limite == timezone.localdate() + datetime.timedelta(days=30)


def test_un_material_combina_texto_archivo_y_video(db, settings, tmp_path):
    from django.core.files.uploadedfile import SimpleUploadedFile

    settings.MEDIA_ROOT = tmp_path  # los archivos de prueba no van a la carpeta real

    _, gestor = _cuenta("ti", "capacitacion.gestionar")
    usuario, rosa = _cuenta("rosa")
    pptx = SimpleUploadedFile("induccion.pptx", b"PK\x03\x04" + b"0" * 64)
    creado = gestor.post(
        f"{BASE}materiales/",
        {
            "titulo": "Inducción",
            "alcance": "empresa",
            "contenido": "Lea primero esto.",
            "url": "https://www.youtube.com/watch?v=abc",
            "archivo": pptx,
        },
        format="multipart",
    )
    assert creado.status_code == 201, creado.data
    material = creado.json()
    assert material["formatos"] == ["Texto", "Presentación", "Video"]
    assert material["archivo_es_pdf"] is False

    # Un PowerPoint renombrado a .pptx que no lo es, no.
    falso = gestor.patch(
        f"{BASE}materiales/{material['id']}/",
        {"archivo": SimpleUploadedFile("x.pptx", b"no soy un pptx")},
        format="multipart",
    )
    assert falso.status_code == 400

    # La persona lo descarga (la presentación va como adjunto).
    archivo = rosa.get(f"{BASE}mi-onboarding/{material['id']}/archivo/")
    assert archivo.status_code == 200
    assert "attachment" in archivo["Content-Disposition"]
    # (Queda abierto a propósito: quitarlo mientras se descarga no debe fallar.)

    # Quitar el archivo deja el texto y el video.
    respuesta = gestor.patch(
        f"{BASE}materiales/{material['id']}/", {"quitar_archivo": True}, format="multipart"
    )
    assert respuesta.status_code == 200, respuesta.data
    sin_archivo = respuesta.json()
    assert sin_archivo["formatos"] == ["Texto", "Video"]
