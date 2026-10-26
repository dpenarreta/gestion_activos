"""Solicitud de proyectos (26/10/2026).

Lo que se protege:

- Cada tipo de proyecto tiene su plantilla, su formulario (campos que se
  agregan o quitan, obligatorios u opcionales) y sus pasos (de inicio:
  Aprobación → Autorización → Revisión), con quién decide cada uno.
- Toda persona con sesión descarga la plantilla, la llena y la vuelve a
  cargar con su solicitud; sin ella, o sin un campo obligatorio, no se envía.
- La solicitud llega a quien decide cada paso, que ve lo respondido y la
  plantilla llena; aprobado el último paso, el proyecto se puede iniciar. Un
  rechazo (con motivo) lo termina.
- Nadie fuera del recorrido ve la solicitud ni su archivo.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.licencias.tests.test_licencias import _persona
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import Cargo, NivelJerarquico, UnidadOrganizacional

TIPOS = "/api/v1/proyectos/configuracion/tipos/"
PARA_SOLICITAR = "/api/v1/proyectos/tipos/"
SOLICITUDES = "/api/v1/proyectos/solicitudes/"

#: Un .docx mínimo: basta con la firma de un ZIP.
DOCX = b"PK\x03\x04" + b"\x00" * 60
PDF = b"%PDF-1.4\n" + b"\x00" * 60


def _docx(nombre="plantilla.docx", contenido=DOCX):
    return SimpleUploadedFile(nombre, contenido, content_type="application/octet-stream")


@pytest.fixture
def proyecto(db):
    """Gerente General > Jefe de Cobranzas > Analista; Talento Humano (persona)
    y una administradora de los tipos de proyecto."""
    with usando_empresa(empresa_actual()):
        nivel = NivelJerarquico.objects.create(nombre="Gerencia", orden=1)
        unidad = UnidadOrganizacional.objects.create(nombre="Empresa", nivel=nivel)
        gg = Cargo.objects.create(nombre="Gerente General", unidad=unidad)
        jefe = Cargo.objects.create(nombre="Jefe de Cobranzas", unidad=unidad, jefe=gg)
        analista = Cargo.objects.create(nombre="Analista", unidad=unidad, jefe=jefe, plazas=3)
    e = {
        "gerente": _persona("gerardo", cargo=gg),
        "jefa": _persona("julia", cargo=jefe),
        "ana": _persona("ana", cargo=analista),
        "th": _persona("tatiana"),
        "otro": _persona("oscar"),
        "admin": _persona("ines", "proyectos.configurar", "proyectos.ver_todas"),
    }
    _, admin = e["admin"]
    creado = admin.post(
        TIPOS,
        {
            "nombre": "Proyecto de TI",
            "descripcion": "Para proyectos de tecnología.",
            "campos": [
                {"etiqueta": "Objetivo", "tipo": "parrafo", "obligatorio": True},
                {
                    "etiqueta": "Prioridad",
                    "tipo": "lista",
                    "opciones": ["Alta", "Media", "Baja"],
                    "obligatorio": True,
                },
                {"etiqueta": "Presupuesto", "tipo": "numero", "obligatorio": False},
            ],
            "pasos": [
                {"nombre": "Aprobación", "aprobadores": [{"tipo": "jefe_inmediato"}]},
                {
                    "nombre": "Autorización",
                    "aprobadores": [{"tipo": "cargo", "cargo": gg.id}],
                },
                {
                    "nombre": "Revisión",
                    "aprobadores": [{"tipo": "persona", "usuario": e["th"][0].id}],
                },
            ],
        },
        format="json",
    )
    assert creado.status_code == 201, creado.data
    e["tipo"] = creado.json()
    e["gg"] = gg
    return e


def _activar(admin, tipo):
    subida = admin.post(
        f"{TIPOS}{tipo['id']}/plantilla/", {"plantilla": _docx()}, format="multipart"
    )
    assert subida.status_code == 200, subida.data
    activado = admin.patch(f"{TIPOS}{tipo['id']}/", {"activo": True}, format="json")
    assert activado.status_code == 200, activado.data
    return activado.json()


def _claves(tipo):
    return {c["etiqueta"]: c["clave"] for c in tipo["campos"]}


def _solicitar(cliente, tipo, respuestas=None, archivo=None, titulo="Nuevo CRM"):
    import json

    claves = _claves(tipo)
    if respuestas is None:
        respuestas = {"Objetivo": "Ordenar la cartera", "Prioridad": "Alta"}
    datos = {
        "tipo_proyecto": tipo["id"],
        "titulo": titulo,
        "respuestas": json.dumps({claves[k]: v for k, v in respuestas.items()}),
    }
    if archivo is not False:
        datos["archivo"] = archivo or _docx("plantilla-llena.docx")
    return cliente.post(SOLICITUDES, datos, format="multipart")


# --- Configuración -------------------------------------------------------------------------


def test_sin_plantilla_no_se_activa_y_no_se_ofrece(proyecto):
    _, admin = proyecto["admin"]
    tipo = proyecto["tipo"]
    sin = admin.patch(f"{TIPOS}{tipo['id']}/", {"activo": True}, format="json")
    assert sin.status_code == 400
    assert "Cargue la plantilla" in str(sin.data)
    _, ana = proyecto["ana"]
    assert ana.get(PARA_SOLICITAR).json() == []


def test_la_plantilla_solo_acepta_word_excel_o_pdf(proyecto):
    _, admin = proyecto["admin"]
    tipo = proyecto["tipo"]
    imagen = SimpleUploadedFile("foto.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 40)
    respuesta = admin.post(f"{TIPOS}{tipo['id']}/plantilla/", {"plantilla": imagen})
    assert respuesta.status_code == 400
    falsa = SimpleUploadedFile("plantilla.docx", b"esto no es un docx")
    assert admin.post(f"{TIPOS}{tipo['id']}/plantilla/", {"plantilla": falsa}).status_code == 400


def test_configurar_pide_permiso(proyecto):
    _, ana = proyecto["ana"]
    assert ana.get(TIPOS).status_code == 403
    assert ana.post(TIPOS, {"nombre": "X", "pasos": []}, format="json").status_code == 403


def test_toda_persona_descarga_la_plantilla_de_un_tipo_activo(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _, ana = proyecto["ana"]
    ofrecidos = ana.get(PARA_SOLICITAR).json()
    assert [t["nombre"] for t in ofrecidos] == ["Proyecto de TI"]
    assert [p["nombre"] for p in ofrecidos[0]["pasos"]] == [
        "Aprobación",
        "Autorización",
        "Revisión",
    ]
    descarga = ana.get(f"{PARA_SOLICITAR}{tipo['id']}/plantilla/")
    assert descarga.status_code == 200
    assert b"".join(descarga.streaming_content) == DOCX
    assert "attachment" in descarga["Content-Disposition"]


# --- Solicitar -----------------------------------------------------------------------------


def test_sin_la_plantilla_llena_no_se_envia(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _, ana = proyecto["ana"]
    respuesta = _solicitar(ana, tipo, archivo=False)
    assert respuesta.status_code == 400
    assert "Cargue la plantilla llena" in str(respuesta.data)


def test_los_campos_obligatorios_se_exigen_y_se_validan(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    claves = _claves(tipo)
    _, ana = proyecto["ana"]
    falta = _solicitar(ana, tipo, respuestas={"Prioridad": "Alta"})
    assert falta.status_code == 400
    assert claves["Objetivo"] in falta.json()["error"]["details"]["respuestas"]
    mala = _solicitar(ana, tipo, respuestas={"Objetivo": "x", "Prioridad": "Urgentísima"})
    assert mala.status_code == 400
    assert "Elija una de las opciones" in str(mala.data)
    # El opcional puede faltar.
    assert _solicitar(ana, tipo).status_code == 201


def test_la_solicitud_llega_al_primer_paso_con_lo_cargado(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _, ana = proyecto["ana"]
    respuesta = _solicitar(
        ana,
        tipo,
        respuestas={"Objetivo": "Ordenar la cartera", "Prioridad": "Alta", "Presupuesto": "1500"},
        archivo=SimpleUploadedFile("CRM llena.pdf", PDF),
    )
    assert respuesta.status_code == 201, respuesta.data
    datos = respuesta.json()
    assert datos["numero"].startswith("PRY-")
    assert datos["paso_actual"] == "Aprobación"
    assert [p["nombre"] for p in datos["pendiente_de"]] == ["Julia"]

    jefa_usuario, jefa = proyecto["jefa"]
    assert Notificacion.objects.filter(usuario=jefa_usuario, tipo="proyectos.por_atender").exists()
    por_atender = jefa.get(SOLICITUDES, {"vista": "por_atender"}).json()
    assert [s["titulo"] for s in por_atender] == ["Nuevo CRM"]
    detalle = jefa.get(f"{SOLICITUDES}{datos['id']}/").json()
    assert detalle["respuestas"] == [
        {"etiqueta": "Objetivo", "tipo": "parrafo", "valor": "Ordenar la cartera"},
        {"etiqueta": "Prioridad", "tipo": "lista", "valor": "Alta"},
        {"etiqueta": "Presupuesto", "tipo": "numero", "valor": "1500"},
    ]
    assert detalle["archivo_nombre"] == "CRM llena.pdf"
    assert detalle["puedo"]["resolver"] is True
    archivo = jefa.get(f"{SOLICITUDES}{datos['id']}/archivo/")
    assert archivo.status_code == 200
    assert b"".join(archivo.streaming_content) == PDF


def test_recorre_aprobacion_autorizacion_y_revision(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    ana_usuario, ana = proyecto["ana"]
    sid = _solicitar(ana, tipo).json()["id"]
    url = f"{SOLICITUDES}{sid}/"

    # A quien todavía no le toca, ni siquiera la ve.
    assert proyecto["th"][1].post(f"{url}aprobar/").status_code == 404

    assert proyecto["jefa"][1].post(f"{url}aprobar/").status_code == 200
    en_autorizacion = ana.get(url).json()
    assert en_autorizacion["paso_actual"] == "Autorización"
    assert [p["nombre"] for p in en_autorizacion["pendiente_de"]] == ["Gerardo"]
    assert [p["estado"] for p in en_autorizacion["pasos"]] == ["aprobado", "en_curso", "pendiente"]
    assert Notificacion.objects.filter(usuario=ana_usuario, tipo="proyectos.avanza").exists()

    assert proyecto["gerente"][1].post(f"{url}aprobar/").status_code == 200
    assert ana.get(url).json()["paso_actual"] == "Revisión"

    final = proyecto["th"][1].post(f"{url}aprobar/", {"comentario": "Adelante"}, format="json")
    assert final.status_code == 200
    assert final.json()["estado"] == "aprobada"
    assert final.json()["estado_display"] == "Aprobada: se inicia"
    assert Notificacion.objects.filter(usuario=ana_usuario, tipo="proyectos.aprobada").exists()


def test_rechazar_pide_motivo_y_termina(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    ana_usuario, ana = proyecto["ana"]
    sid = _solicitar(ana, tipo).json()["id"]
    _, jefa = proyecto["jefa"]
    assert jefa.post(f"{SOLICITUDES}{sid}/rechazar/").status_code == 400
    rechazo = jefa.post(
        f"{SOLICITUDES}{sid}/rechazar/", {"comentario": "No hay presupuesto"}, format="json"
    )
    assert rechazo.status_code == 200
    assert rechazo.json()["estado"] == "rechazada"
    assert Notificacion.objects.filter(usuario=ana_usuario, tipo="proyectos.rechazada").exists()


def test_nadie_fuera_del_recorrido_ve_la_solicitud_ni_su_archivo(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _, ana = proyecto["ana"]
    sid = _solicitar(ana, tipo).json()["id"]
    _, otro = proyecto["otro"]
    assert otro.get(f"{SOLICITUDES}{sid}/").status_code == 404
    assert otro.get(f"{SOLICITUDES}{sid}/archivo/").status_code == 404
    assert otro.get(SOLICITUDES, {"vista": "todas"}).status_code == 403
    # Quien ve todas, sí.
    assert admin.get(f"{SOLICITUDES}{sid}/").status_code == 200
    assert [s["id"] for s in admin.get(SOLICITUDES, {"vista": "todas"}).json()] == [sid]


def test_quien_solicita_no_decide_lo_suyo(proyecto):
    """La jefa pide un proyecto: su jefe inmediato es el gerente; y en
    «Autorización» (el cargo del gerente) ya aprobó él: pasa a quien
    administra."""
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _, jefa = proyecto["jefa"]
    datos = _solicitar(jefa, tipo).json()
    assert [p["nombre"] for p in datos["pendiente_de"]] == ["Gerardo"]
    assert jefa.post(f"{SOLICITUDES}{datos['id']}/aprobar/").status_code == 403
    proyecto["gerente"][1].post(f"{SOLICITUDES}{datos['id']}/aprobar/")
    segundo = jefa.get(f"{SOLICITUDES}{datos['id']}/").json()
    assert [p["nombre"] for p in segundo["pendiente_de"]] == ["Ines"]


def test_escalar_y_cancelar(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _, ana = proyecto["ana"]
    sid = _solicitar(ana, tipo).json()["id"]
    _, jefa = proyecto["jefa"]
    th = proyecto["th"][0]
    escalada = jefa.post(
        f"{SOLICITUDES}{sid}/escalar/",
        {"destino": {"tipo": "persona", "usuario": th.id}, "comentario": "Lo ve TH"},
        format="json",
    )
    assert escalada.status_code == 200, escalada.data
    assert [p["nombre"] for p in escalada.json()["pendiente_de"]] == ["Tatiana"]
    assert jefa.post(f"{SOLICITUDES}{sid}/cancelar/").status_code == 403
    cancelada = ana.post(f"{SOLICITUDES}{sid}/cancelar/")
    assert cancelada.json()["estado"] == "cancelada"


# --- Cambiar el tipo con solicitudes -------------------------------------------------------


def test_editar_el_tipo_no_rompe_las_solicitudes_en_curso(proyecto):
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _, ana = proyecto["ana"]
    sid = _solicitar(ana, tipo).json()["id"]

    # Se quita un campo y se agrega otro: la solicitud conserva lo respondido.
    pasos = tipo["pasos"]
    campos = [c for c in tipo["campos"] if c["etiqueta"] != "Objetivo"] + [
        {"etiqueta": "Sponsor", "tipo": "texto", "obligatorio": True}
    ]
    editado = admin.put(
        f"{TIPOS}{tipo['id']}/",
        {**tipo, "campos": campos, "pasos": pasos},
        format="json",
    )
    assert editado.status_code == 200, editado.data
    assert [c["etiqueta"] for c in editado.json()["campos"]] == [
        "Prioridad",
        "Presupuesto",
        "Sponsor",
    ]
    detalle = ana.get(f"{SOLICITUDES}{sid}/").json()
    assert detalle["respuestas"][0]["etiqueta"] == "Objetivo"
    assert detalle["paso_actual"] == "Aprobación"

    # El paso en que va una solicitud no se puede quitar.
    sin_primero = admin.put(
        f"{TIPOS}{tipo['id']}/", {**tipo, "campos": campos, "pasos": pasos[1:]}, format="json"
    )
    assert sin_primero.status_code == 400
    assert "Hay solicitudes en curso" in str(sin_primero.data)

    # Con solicitudes no se borra: se desactiva.
    assert admin.delete(f"{TIPOS}{tipo['id']}/").status_code == 409
