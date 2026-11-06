"""Los invitables de una reunión se buscan sin tildes ni mayúsculas, cada
palabra en cualquier orden (ver `apps.core.busqueda`)."""

from .conftest import BASE, client_for, make_user


def test_invitables_sin_tildes(jefa, ana, nino):
    nunez = make_user("mnunez", "ANALISTA_CC", first_name="María", last_name="Núñez")
    cliente = client_for(jefa)

    def buscar(termino):
        respuesta = cliente.get(f"{BASE}/invitables/", {"q": termino})
        assert respuesta.status_code == 200
        return [p["id"] for p in respuesta.json()]

    assert buscar("nino") == [nino.pk]
    assert buscar("NUNEZ maria") == [nunez.pk]
    assert buscar("maria ana") == []
