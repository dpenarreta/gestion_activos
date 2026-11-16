"""Confirmación de lectura (22/10/2026): hasta dónde leyó cada una de las
demás personas y cuándo, para marcar los mensajes propios como leídos."""

from apps.chat.tests.test_chat import URL, _cliente, _persona, empresa  # noqa: F401


def test_el_directo_dice_si_el_otro_leyo_y_cuando(empresa):  # noqa: F811
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana, cliente_beto = _cliente(ana, empresa), _cliente(beto, empresa)
    directa = cliente_ana.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    base = f"{URL}conversaciones/{directa['id']}/"
    mensaje = cliente_ana.post(f"{base}mensajes/", {"texto": "¿Almorzamos?"}).json()

    lecturas = cliente_ana.get(f"{base}lecturas/").json()
    assert lecturas == [{"id": beto.id, "nombre": "Beto", "ultimo_leido": 0, "leido_en": None}]

    cliente_beto.post(f"{base}leer/", {})
    leida = cliente_ana.get(f"{base}lecturas/").json()[0]
    assert leida["ultimo_leido"] >= mensaje["id"] and leida["leido_en"]
    # También viene con los mensajes, para pintarlos de una vez.
    assert cliente_ana.get(f"{base}mensajes/").json()["lecturas"][0]["id"] == beto.id


def test_quien_no_participa_no_ve_las_lecturas(empresa):  # noqa: F811
    ana, beto, caro = (_persona(n, empresa) for n in ("ana", "beto", "caro"))
    directa = (
        _cliente(ana, empresa).post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    )
    respuesta = _cliente(caro, empresa).get(f"{URL}conversaciones/{directa['id']}/lecturas/")
    assert respuesta.status_code in (403, 404)


def test_responder_desde_otro_equipo_deja_todo_leido_y_apaga_la_campana(
    empresa,  # noqa: F811
    django_capture_on_commit_callbacks,
):
    """16/11/2026: responder desde la app móvil dejaba el chat «sin leer» y el
    aviso de la campana encendido en la web."""
    from apps.notificaciones.models import Notificacion

    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana, cliente_beto = _cliente(ana, empresa), _cliente(beto, empresa)
    directa = cliente_ana.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    base = f"{URL}conversaciones/{directa['id']}/"
    with django_capture_on_commit_callbacks(execute=True):
        cliente_ana.post(f"{base}mensajes/", {"texto": "¿Almorzamos?"})
    novedades = cliente_beto.get(f"{URL}novedades/").json()
    assert novedades["no_leidos"] == {str(directa["id"]): 1}
    avisos = Notificacion.objects.todas().filter(usuario=beto, tipo="chat.mensaje")
    assert avisos.filter(leida_en__isnull=True).count() == 1

    # Beto responde sin abrir la conversación (como desde otro equipo).
    cliente_beto.post(f"{base}mensajes/", {"texto": "Sí, a la 1"})
    assert cliente_beto.get(f"{URL}novedades/").json()["no_leidos"] == {}
    assert not avisos.filter(leida_en__isnull=True).exists()
