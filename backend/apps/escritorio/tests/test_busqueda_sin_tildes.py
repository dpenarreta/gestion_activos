"""El buscador del Escritorio no distingue tildes ni mayúsculas, y cada
palabra va en cualquier orden (ver `apps.core.busqueda`)."""

from .conftest import BASE, client_for, nota_de, recordatorio_de


def test_notas_respuestas_y_recordatorios_sin_tildes(ana, nino):
    nota = nota_de(ana, nino, message="Cronograma de vacaciones de Óscar")
    nota.replies.create(author=nino, message="¿Incluye a Peñaherrera?")
    nota_de(nino, ana, message="Otra cosa")
    recordatorio_de(ana, title="Revisar la caída del sistema")
    cliente = client_for(ana)

    def buscar(**params):
        respuesta = cliente.get(f"{BASE}/search/", params)
        assert respuesta.status_code == 200
        return respuesta.json()

    datos = buscar(q="oscar CRONOGRAMA")
    assert [n["id"] for n in datos["notes"]] == [nota.pk]
    # Por el texto de una respuesta, sin la eñe.
    assert [n["id"] for n in buscar(q="penaherrera")["notes"]] == [nota.pk]
    assert [r["title"] for r in buscar(q="caida")["reminders"]] == ["Revisar la caída del sistema"]
    # Por la persona: «nino» encuentra a «Niño».
    assert [n["id"] for n in buscar(recipient="nino")["notes"]] == [nota.pk]
    assert buscar(q="oscar otra") == {"notes": [], "reminders": []}
