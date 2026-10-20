"""Sugerencias y errores (20/10/2026).

Lo que se protege: cualquiera reporta, pero los reportes son reservados: solo
los ve quien tiene `sugerencias.gestionar` (ni quien los envió); un error pide
su impacto; la captura se valida (imagen real, hasta 5 MB); quien gestiona ve
todo, conversa internamente y cambia el estado (al cerrar, con explicación);
a quien reportó solo se le avisa el nuevo estado; no se editan ni se borran.
"""

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.notificaciones.models import Notificacion
from apps.organizacion.tests.test_carga_personas import _cuenta

URL = "/api/v1/sugerencias/reportes/"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def _reportar(cliente, **extra):
    datos = {
        "tipo": "error",
        "titulo": "No carga el organigrama",
        "descripcion": "Al abrir el organigrama se queda cargando.",
        "modulo": "institucional",
        "impacto": "alto",
        **extra,
    }
    respuesta = cliente.post(URL, datos, format="multipart")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.json()


def _avisados(usuario):
    return list(
        Notificacion.objects.todas()
        .filter(usuario=usuario, tipo="sugerencias.reporte")
        .values_list("titulo", flat=True)
    )


def test_cualquiera_reporta_pero_solo_quien_gestiona_ve_los_reportes(db):
    ti, gestor = _cuenta("ti", "sugerencias.gestionar")
    _, rosa = _cuenta("rosa")
    respuesta = rosa.post(
        URL,
        {
            "tipo": "error",
            "titulo": "No carga el organigrama",
            "descripcion": "Al abrir el organigrama se queda cargando.",
            "modulo": "institucional",
            "impacto": "alto",
            "captura": SimpleUploadedFile("pantalla.png", PNG),
        },
        format="multipart",
    )
    assert respuesta.status_code == 201, respuesta.data
    # Solo la constancia del envío: nada del reporte.
    assert set(respuesta.json()) == {"id", "titulo", "tipo"}
    reporte_id = respuesta.json()["id"]
    assert _avisados(ti) == ["Nuevo error reportado"]

    # Ni quien lo envió lo ve, ni lo comenta.
    assert rosa.get(URL).status_code == 403
    assert rosa.get(URL, {"vista": "todos"}).status_code == 403
    assert rosa.get(f"{URL}{reporte_id}/").status_code == 404
    assert rosa.get(f"{URL}{reporte_id}/captura/").status_code == 404
    assert (
        rosa.post(f"{URL}{reporte_id}/comentar/", {"texto": "¿y?"}, format="json").status_code
        == 404
    )

    assert [r["id"] for r in gestor.get(URL, {"vista": "todos"}).json()] == [reporte_id]
    assert gestor.get(URL).json() == []  # «Mis reportes» del gestor: los que él envió
    assert gestor.get(f"{URL}{reporte_id}/captura/").status_code == 200
    assert gestor.get(f"{URL}resumen/").json() == {"nuevos": 1}
    assert rosa.get(f"{URL}resumen/").json() == {"nuevos": 0}
    # No se editan ni se borran.
    assert gestor.patch(f"{URL}{reporte_id}/", {"titulo": "x"}).status_code == 405
    assert gestor.delete(f"{URL}{reporte_id}/").status_code == 405


def test_lo_que_se_valida_al_reportar(db):
    _, rosa = _cuenta("rosa")
    sin_impacto = rosa.post(
        URL,
        {"tipo": "error", "titulo": "x", "descripcion": "Algo no funciona bien", "modulo": "chat"},
        format="multipart",
    )
    assert sin_impacto.status_code == 400
    corta = rosa.post(
        URL,
        {"tipo": "sugerencia", "titulo": "x", "descripcion": "corta", "modulo": "chat"},
        format="multipart",
    )
    assert corta.status_code == 400
    falsa = rosa.post(
        URL,
        {
            "tipo": "sugerencia",
            "titulo": "Más colores",
            "descripcion": "Me gustaría un tema más claro.",
            "modulo": "general",
            "captura": SimpleUploadedFile("foto.png", b"no soy una imagen"),
        },
        format="multipart",
    )
    assert falsa.status_code == 400
    # Una sugerencia no lleva impacto aunque se mande.
    sugerencia = _reportar(rosa, tipo="sugerencia", impacto="alto")
    from apps.sugerencias.models import Reporte

    assert Reporte.objects.todas().get(pk=sugerencia["id"]).impacto == ""


def test_quien_gestiona_conversa_y_cambia_el_estado(db):
    _, gestor = _cuenta("ti", "sugerencias.gestionar")
    _, otro_gestor = _cuenta("ema", "sugerencias.gestionar")
    rosa_usuario, rosa = _cuenta("rosa")
    reporte_id = rosa.post(
        URL,
        {
            "tipo": "error",
            "titulo": "No carga el organigrama",
            "descripcion": "Al abrir el organigrama se queda cargando.",
            "modulo": "institucional",
            "impacto": "alto",
        },
        format="multipart",
    ).json()["id"]
    url = f"{URL}{reporte_id}/"

    # Quien reportó no cambia el estado.
    assert rosa.post(f"{url}estado/", {"estado": "resuelto"}, format="json").status_code == 404

    gestor.post(f"{url}comentar/", {"texto": "Lo reviso con desarrollo."}, format="json")
    otro_gestor.post(f"{url}comentar/", {"texto": "Pasa en Chrome."}, format="json")
    # La conversación es interna: a quien reportó no se le avisa.
    assert _avisados(rosa_usuario) == []

    en_revision = gestor.post(f"{url}estado/", {"estado": "en_revision"}, format="json").json()
    assert en_revision["estado"] == "en_revision"
    assert gestor.post(f"{url}estado/", {"estado": "resuelto"}, format="json").status_code == 400
    resuelto = gestor.post(
        f"{url}estado/",
        {"estado": "resuelto", "texto": "Corregido en la versión de hoy."},
        format="json",
    ).json()
    assert resuelto["estado"] == "resuelto" and resuelto["cerrado_en"]
    assert [(c["texto"], c["estado_nuevo"]) for c in resuelto["comentarios"]] == [
        ("Lo reviso con desarrollo.", ""),
        ("Pasa en Chrome.", ""),
        ("", "en_revision"),
        ("Corregido en la versión de hoy.", "resuelto"),
    ]
    # A quien reportó solo le llega el nuevo estado.
    assert sorted(_avisados(rosa_usuario)) == [
        f"Su reporte #{reporte_id} pasó a «En revisión»",
        f"Su reporte #{reporte_id} pasó a «Resuelto»",
    ]
