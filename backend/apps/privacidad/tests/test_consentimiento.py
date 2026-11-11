"""Consentimiento del tratamiento de datos: el aviso por empresa con versión, la
aceptación con su constancia, el restablecer individual y masivo, `/auth/me/`
y los permisos (`privacidad.ver` / `privacidad.atender`; editar,
`privacidad.textos`).

Desde US-004 (11/11/2026) el aviso es la clave `aviso_privacidad` del catálogo
de textos y sus aceptaciones están en el registro común (`AceptacionTexto`)."""

import pytest
from django.utils import timezone

from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.privacidad import consentimiento
from apps.privacidad.catalogo_textos import AVISO_PRIVACIDAD
from apps.privacidad.models import (
    AceptacionTexto,
    TextoProteccion,
    VersionTextoProteccion,
)

from .conftest import BASE, client_for

pytestmark = pytest.mark.django_db

ME = "/api/v1/auth/me/"
CONSENTIMIENTO = f"{BASE}/consentimiento/"
AVISO = f"{BASE}/consentimiento/aviso/"
PERSONAS = f"{BASE}/consentimiento/personas/"


TEXTO = "Aviso de prueba: tratamos sus datos."


def _crear_aviso(texto=TEXTO):
    """El aviso de la empresa activa, en la versión 1."""
    aviso = TextoProteccion.objects.create(
        clave=AVISO_PRIVACIDAD,
        modulo="General",
        seccion="Entrada a la intranet",
        nombre="Aviso de tratamiento de datos",
        requiere_aceptacion=True,
        texto=texto,
    )
    VersionTextoProteccion.objects.create(
        texto_proteccion=aviso, version=1, texto=texto, editado_en=timezone.now()
    )
    return aviso


def _borrar_aviso():
    AceptacionTexto.objects.filter(texto_proteccion__clave=AVISO_PRIVACIDAD).delete()
    VersionTextoProteccion.objects.filter(texto_proteccion__clave=AVISO_PRIVACIDAD).delete()
    TextoProteccion.objects.filter(clave=AVISO_PRIVACIDAD).delete()


def _del_aviso():
    return AceptacionTexto.objects.filter(texto_proteccion__clave=AVISO_PRIVACIDAD)


@pytest.fixture
def aviso():
    """El aviso de la empresa de pruebas, en la versión 1 y sin aceptaciones
    (`privacidad/0007` lo siembra si la empresa ya existía al migrar)."""
    _borrar_aviso()
    return _crear_aviso()


@pytest.fixture
def sin_aviso():
    _borrar_aviso()


def aceptar(usuario, version=1):
    return client_for(usuario).post(CONSENTIMIENTO, {"version": version}, format="json")


# ── El texto inicial ──────────────────────────────────────────────────────────


def test_el_texto_inicial_menciona_la_ia_y_los_seudonimos_sin_infraestructura():
    texto = consentimiento.texto_inicial("Empresa Demo")
    # No da por hecho el proveedor: dice que es externo y nombra el previsto.
    assert "proveedor externo de inteligencia artificial" in texto
    assert "Google (Gemini)" in texto
    assert "se le pedirá aceptarlo de nuevo" in texto
    assert "seudónimos" in texto
    assert "nunca su nombre ni sus datos de salud" in texto
    assert "Nexo" not in texto
    assert "http" not in texto and "@" not in texto


def test_el_texto_inicial_nombra_responsable_contacto_y_conservacion():
    texto = consentimiento.texto_inicial("Empresa Demo")
    assert texto.startswith(
        "La empresa Empresa Demo, para la que usted trabaja, es la responsable del tratamiento"
    )
    assert "el contacto es Gestión Humana" in texto
    assert "el tiempo que dure la relación laboral y los plazos que exija la ley" in texto
    assert texto.endswith(
        "desde «Mi perfil» › «Mis derechos», después de entrar, o consultando a Gestión Humana."
    )
    # Sin nombre de empresa, la fórmula genérica.
    assert consentimiento.texto_inicial("").startswith(
        "La empresa para la que usted trabaja es la responsable del tratamiento"
    )
    assert "{responsable}" not in consentimiento.texto_inicial("")


def test_la_migracion_siembra_el_aviso_con_el_mismo_texto():
    from importlib import import_module

    migracion = import_module("apps.privacidad.migrations.0005_aviso_inicial")
    assert migracion.PLANTILLA_INICIAL == consentimiento.PLANTILLA_INICIAL
    for nombre_empresa in ("Empresa Demo", ""):
        assert migracion.texto_inicial(nombre_empresa) == consentimiento.texto_inicial(
            nombre_empresa
        )


# ── La sesión (/auth/me/) ─────────────────────────────────────────────────────


def test_sin_aviso_no_se_exige_nada(begona, sin_aviso):
    datos = client_for(begona).get(ME).json()
    assert datos["consentimiento"] == {"pendiente": False}


def test_me_trae_el_aviso_si_falta_aceptarlo(begona, aviso):
    datos = client_for(begona).get(ME).json()
    assert datos["consentimiento"] == {
        "pendiente": True,
        "version": 1,
        "texto": "Aviso de prueba: tratamos sus datos.",
    }


def test_aceptar_deja_la_constancia_y_quita_la_pantalla(begona, aviso):
    respuesta = aceptar(begona)
    assert respuesta.status_code == 201
    assert respuesta.json()["version"] == "1"
    aceptacion = _del_aviso().get(usuario=begona)
    assert aceptacion.empresa == empresa_actual()
    assert aceptacion.origen == "INTRANET"
    assert aceptacion.texto_aceptado == "Aviso de prueba: tratamos sus datos."
    assert aceptacion.version == 1
    assert aceptacion.ip == "127.0.0.1"
    assert aceptacion.aceptado_en is not None
    assert client_for(begona).get(ME).json()["consentimiento"] == {"pendiente": False}
    evento = AuditLog.objects.get(action="privacidad.consentimiento.aceptado")
    assert evento.module == "privacidad" and evento.actor_id == begona.pk


def test_aceptar_dos_veces_no_duplica(begona, aviso):
    assert aceptar(begona).status_code == 201
    assert aceptar(begona).status_code == 200
    assert _del_aviso().filter(usuario=begona).count() == 1


def test_aceptar_una_version_vieja_responde_409(begona, aviso):
    aviso.version = 2
    aviso.save()
    respuesta = aceptar(begona, version=1)
    assert respuesta.status_code == 409
    assert respuesta.json()["error"]["code"] == "aviso_cambiado"
    assert respuesta.json()["error"]["details"] == {"version": 2}
    assert not _del_aviso().exists()


def test_sin_aviso_aceptar_responde_409(begona, sin_aviso):
    assert aceptar(begona).status_code == 409


def test_el_estado_propio(begona, aviso):
    cliente = client_for(begona)
    assert cliente.get(CONSENTIMIENTO).json()["pendiente"] is True
    aceptar(begona)
    datos = cliente.get(CONSENTIMIENTO).json()
    assert datos["pendiente"] is False and datos["exigido"] is True
    assert datos["ultima_aceptacion"]["version"] == "1"


def test_el_aviso_es_de_cada_empresa(begona, aviso):
    aceptar(begona)
    otra = Empresa.objects.create(codigo="OTRA", nombre="Otra empresa")
    MembresiaEmpresa.objects.create(usuario=begona, empresa=otra)
    with usando_empresa(otra):
        assert consentimiento.para_la_sesion(begona) == {"pendiente": False}
        _crear_aviso("Aviso de la otra empresa, con su propio texto.")
        assert consentimiento.para_la_sesion(begona) == {
            "pendiente": True,
            "version": 1,
            "texto": "Aviso de la otra empresa, con su propio texto.",
        }
    assert consentimiento.para_la_sesion(begona) == {"pendiente": False}


# ── El aviso: editar y pedir aceptación de nuevo ──────────────────────────────


def test_editar_el_texto_no_obliga_a_aceptar_de_nuevo(begona, admin_gh, aviso):
    aceptar(begona)
    respuesta = client_for(admin_gh).put(
        AVISO, {"texto": "Aviso de prueba: tratamos sus datos (corregido)."}, format="json"
    )
    assert respuesta.status_code == 200
    # Desde US-004 la versión del texto sube, pero no la exigida.
    assert respuesta.json()["version"] == 2
    assert respuesta.json()["version_exigida"] == 1
    assert client_for(begona).get(ME).json()["consentimiento"] == {"pendiente": False}
    evento = AuditLog.objects.get(action="privacidad.texto.editado")
    assert evento.previous_values["texto"] == "Aviso de prueba: tratamos sus datos."


def test_pedir_aceptacion_de_nuevo_sube_la_version_y_todos_aceptan(begona, admin_gh, aviso):
    aceptar(begona)
    respuesta = client_for(admin_gh).put(
        AVISO,
        {"texto": "Aviso nuevo, cambia el proveedor.", "pedir_aceptacion_de_nuevo": True},
        format="json",
    )
    assert respuesta.json()["version"] == 2
    assert respuesta.json()["version_exigida"] == 2
    datos = client_for(begona).get(ME).json()["consentimiento"]
    assert datos == {
        "pendiente": True,
        "version": 2,
        "texto": "Aviso nuevo, cambia el proveedor.",
    }
    assert AuditLog.objects.filter(action="privacidad.texto.aceptacion_pedida").exists()
    # La aceptación anterior se conserva.
    aceptar(begona, version=2)
    assert list(
        _del_aviso()
        .filter(usuario=begona)
        .order_by("-aceptado_en", "-id")
        .values_list("version", flat=True)
    ) == [2, 1]


def test_crear_el_aviso_de_una_empresa_sin_aviso(begona, admin_gh, sin_aviso):
    cliente = client_for(admin_gh)
    resumen = cliente.get(AVISO).json()
    assert resumen["existe"] is False
    assert "Google (Gemini)" in resumen["texto_inicial"]
    # La empresa activa, con su nombre, como responsable.
    assert f"La empresa {empresa_actual().nombre}," in resumen["texto_inicial"]
    respuesta = cliente.put(AVISO, {"texto": resumen["texto_inicial"]}, format="json")
    assert respuesta.status_code == 200 and respuesta.json()["version"] == 1
    assert client_for(begona).get(ME).json()["consentimiento"]["pendiente"] is True
    assert AuditLog.objects.filter(action="privacidad.texto.creado").exists()


def test_el_texto_vacio_no_se_guarda(admin_gh, aviso):
    respuesta = client_for(admin_gh).put(AVISO, {"texto": "   "}, format="json")
    assert respuesta.status_code == 400
    assert "texto" in respuesta.json()["error"]["details"]


def test_los_totales_del_aviso(begona, nunez, admin_gh, aviso):
    aceptar(begona)
    totales = client_for(admin_gh).get(AVISO).json()["totales"]
    assert totales["aceptaron"] == 1
    assert totales["pendientes"] == totales["personas"] - 1


# ── Permisos ──────────────────────────────────────────────────────────────────


def test_sin_permiso_no_se_ve_ni_se_edita(begona, nunez, aviso):
    cliente = client_for(begona)
    assert cliente.get(AVISO).status_code == 403
    assert cliente.put(AVISO, {"texto": "x"}, format="json").status_code == 403
    assert cliente.get(PERSONAS).status_code == 403
    assert cliente.post(f"{PERSONAS}{nunez.pk}/restablecer/").status_code == 403
    assert (
        cliente.post(
            f"{BASE}/consentimiento/restablecer-todos/", {"confirmar": True}, format="json"
        ).status_code
        == 403
    )


def test_con_privacidad_ver_se_ve_pero_no_se_cambia(lectora, begona, aviso):
    cliente = client_for(lectora)
    assert cliente.get(AVISO).status_code == 200
    assert cliente.get(PERSONAS).status_code == 200
    assert cliente.get(f"{PERSONAS}{begona.pk}/").status_code == 200
    assert cliente.put(AVISO, {"texto": "x"}, format="json").status_code == 403
    assert cliente.post(f"{PERSONAS}{begona.pk}/restablecer/").status_code == 403


# ── Listado e historial ───────────────────────────────────────────────────────


def test_el_listado_dice_quien_acepto_y_filtra(begona, nunez, admin_gh, aviso):
    aceptar(begona)
    cliente = client_for(admin_gh)
    aceptados = cliente.get(PERSONAS, {"estado": "ACEPTADO"}).json()["results"]
    assert [p["usuario"] for p in aceptados] == ["bpenaherrera"]
    assert aceptados[0]["ultima_aceptacion"]["version"] == "1"
    pendientes = cliente.get(PERSONAS, {"estado": "PENDIENTE"}).json()["results"]
    assert "anunez" in [p["usuario"] for p in pendientes]
    assert "bpenaherrera" not in [p["usuario"] for p in pendientes]
    # Búsqueda sin tildes.
    buscados = cliente.get(PERSONAS, {"q": "nunez"}).json()["results"]
    assert [p["usuario"] for p in buscados] == ["anunez"]


def test_el_listado_no_trae_personas_de_otra_empresa(admin_gh, aviso):
    otra = Empresa.objects.create(codigo="OTRA", nombre="Otra empresa")
    from apps.users.models import User

    ajena = User.objects.create_user(username="ajena", email="ajena@example.com")
    MembresiaEmpresa.objects.filter(usuario=ajena).delete()
    MembresiaEmpresa.objects.create(usuario=ajena, empresa=otra)
    usuarios = [p["usuario"] for p in client_for(admin_gh).get(PERSONAS).json()["results"]]
    assert "ajena" not in usuarios
    assert client_for(admin_gh).get(f"{PERSONAS}{ajena.pk}/").status_code == 404


def test_el_historial_trae_cada_aceptacion_con_su_texto(begona, admin_gh, aviso):
    aceptar(begona)
    datos = client_for(admin_gh).get(f"{PERSONAS}{begona.pk}/").json()
    assert datos["estado"] == "ACEPTADO"
    assert datos["aceptaciones"][0]["texto"] == "Aviso de prueba: tratamos sus datos."
    assert datos["aceptaciones"][0]["ip"] == "127.0.0.1"


# ── Restablecer ───────────────────────────────────────────────────────────────


def test_restablecer_una_persona(begona, nunez, admin_gh, aviso):
    aceptar(begona)
    aceptar(nunez)
    respuesta = client_for(admin_gh).post(f"{PERSONAS}{begona.pk}/restablecer/")
    assert respuesta.status_code == 200
    assert respuesta.json()["restablecidas"] == 1
    assert respuesta.json()["estado"] == "PENDIENTE"
    # Su aceptación queda, marcada; la de la otra persona sigue valiendo.
    aceptacion = _del_aviso().get(usuario=begona)
    assert aceptacion.restablecida_en is not None
    assert aceptacion.restablecida_por == admin_gh
    assert client_for(begona).get(ME).json()["consentimiento"]["pendiente"] is True
    assert client_for(nunez).get(ME).json()["consentimiento"]["pendiente"] is False
    evento = AuditLog.objects.get(action="privacidad.consentimiento.restablecido")
    assert evento.target_id == str(begona.pk)
    # Vuelve a aceptar: dos filas en su historial.
    assert aceptar(begona).status_code == 201
    assert _del_aviso().filter(usuario=begona).count() == 2


def test_restablecer_a_todos_pide_confirmacion(begona, nunez, admin_gh, aviso):
    aceptar(begona)
    aceptar(nunez)
    cliente = client_for(admin_gh)
    ruta = f"{BASE}/consentimiento/restablecer-todos/"
    assert cliente.post(ruta, {"confirmar": False}, format="json").status_code == 400
    assert _del_aviso().filter(restablecida_en__isnull=True).count() == 2
    respuesta = cliente.post(ruta, {"confirmar": True}, format="json")
    assert respuesta.json() == {"restablecidas": 2}
    assert not _del_aviso().filter(restablecida_en__isnull=True).exists()
    assert client_for(begona).get(ME).json()["consentimiento"]["pendiente"] is True
    evento = AuditLog.objects.get(action="privacidad.consentimiento.restablecido_todos")
    assert evento.new_values == {"aceptaciones_restablecidas": 2}


def test_restablecer_a_todos_no_toca_otra_empresa(begona, admin_gh, aviso):
    otra = Empresa.objects.create(codigo="OTRA", nombre="Otra empresa")
    with usando_empresa(otra):
        ajena = AceptacionTexto.objects.create(
            texto_proteccion=_crear_aviso(),
            usuario=begona,
            version=1,
            aceptado_en=timezone.now(),
        )
    client_for(admin_gh).post(
        f"{BASE}/consentimiento/restablecer-todos/", {"confirmar": True}, format="json"
    )
    ajena.refresh_from_db()
    assert ajena.restablecida_en is None


def test_una_aceptacion_de_nexo_no_cuenta_para_el_aviso_vigente(begona, aviso):
    AceptacionTexto.objects.create(
        texto_proteccion=aviso,
        usuario=begona,
        version=None,
        origen=AceptacionTexto.Origen.NEXO,
        aceptado_en=timezone.now(),
        id_nexo=77,
    )
    assert client_for(begona).get(ME).json()["consentimiento"]["pendiente"] is True
    importada = _del_aviso().get(usuario=begona)
    assert consentimiento.de_aceptacion(importada)["version"] == "Nexo"
