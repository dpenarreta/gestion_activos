"""Configurar desde la ficha del usuario quién aprueba por esa persona
mientras está ausente (US-018, 13/11/2026).

- `GET /api/v1/admin/users/<id>/reemplazo/` con `usuarios.ver`; `PUT` con
  `usuarios.reemplazo`.
- Es la misma configuración de «Mi estado»: la persona la ve y la cambia.
- Avisa a la persona en la campana, queda en la auditoría y, si hoy está
  ausente, lo pendiente pasa enseguida al nuevo reemplazo.
"""

import pytest
from django.utils import timezone

from apps.ausencias.models import LeaveRecord
from apps.core.models import AuditLog
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.licencias.models import SolicitudPermiso
from apps.licencias.tests.test_licencias import (  # noqa: F401 (fixture)
    _pedir,
    _persona,
    empresa_con_organigrama,
)
from apps.notificaciones.models import Notificacion
from apps.users.models import User

MI_REEMPLAZO = "/api/v1/organizacion/mi-reemplazo/"


def url(usuario):
    return f"/api/v1/admin/users/{usuario.pk}/reemplazo/"


@pytest.fixture
def e(empresa_con_organigrama):  # noqa: F811 (el fixture importado)
    """Gerardo (Gerente General) > Julia (Jefa de Cobranzas) > Ana (Analista);
    Tatiana (Talento Humano) e Inés (administra los flujos)."""
    return empresa_con_organigrama


@pytest.fixture
def ti():
    return _persona("teresa", "usuarios.ver", "usuarios.reemplazo", con_rol=False)


@pytest.fixture
def solo_ve():
    return _persona("victor", "usuarios.ver", con_rol=False)


def test_ve_lo_configurado_y_si_hoy_esta_ausente(e, solo_ve):
    julia = e["jefa"][0]
    _, cliente = solo_ve
    datos = cliente.get(url(julia)).json()
    assert datos == {
        "modo": "jefe",
        "persona": None,
        "jefe": {"id": e["gerente"][0].pk, "nombre": "Gerardo"},
        "ausencia": None,
    }
    LeaveRecord.objects.create(
        user=julia,
        type=LeaveRecord.Type.MEDICO,
        date=timezone.localdate(),
        is_full_day=True,
        created_by=julia,
    )
    ausencia = cliente.get(url(julia)).json()["ausencia"]
    # Un permiso médico se muestra como «fuera de la oficina», nunca el tipo.
    assert ausencia["clave"] == "fuera_oficina"
    assert "médico" not in str(ausencia).lower()


def test_sin_el_permiso_solo_lo_ve(e, solo_ve):
    julia, tatiana = e["jefa"][0], e["th"][0]
    _, cliente = solo_ve
    respuesta = cliente.patch(
        url(julia), {"modo": "persona", "persona_id": tatiana.pk}, format="json"
    )
    assert respuesta.status_code == 403
    assert cliente.get(url(julia)).json()["modo"] == "jefe"


def test_lo_guarda_como_si_lo_eligiera_ella_avisa_y_audita(
    e, ti, django_capture_on_commit_callbacks
):
    julia, tatiana = e["jefa"][0], e["th"][0]
    teresa, cliente = ti
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = cliente.patch(
            url(julia), {"modo": "persona", "persona_id": tatiana.pk}, format="json"
        )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["persona"] == {"id": tatiana.pk, "nombre": "Tatiana"}
    # Es la misma configuración que ve ella en «Mi estado».
    assert e["jefa"][1].get(MI_REEMPLAZO).json()["persona"]["id"] == tatiana.pk

    aviso = Notificacion.objects.todas().get(
        usuario=julia, tipo="organizacion.reemplazo_configurado"
    )
    assert "Tatiana" in aviso.resumen and "Teresa" in aviso.resumen

    evento = AuditLog.objects.get(action="usuarios.reemplazo.configurado")
    assert evento.previous_values == {"modo": "jefe", "persona": None}
    assert evento.new_values == {"modo": "persona", "persona": tatiana.pk}
    assert evento.actor_id == teresa.pk

    # Vuelve al jefe inmediato.
    de_vuelta = cliente.patch(url(julia), {"modo": "jefe"}, format="json")
    assert de_vuelta.json()["modo"] == "jefe" and de_vuelta.json()["persona"] is None


def test_validaciones(e, ti):
    julia = e["jefa"][0]
    _, cliente = ti
    sin_persona = cliente.patch(url(julia), {"modo": "persona"}, format="json")
    assert sin_persona.status_code == 400
    assert "persona_id" in str(sin_persona.json())
    ella_misma = cliente.patch(
        url(julia), {"modo": "persona", "persona_id": julia.pk}, format="json"
    )
    assert ella_misma.status_code == 400
    assert "sí misma" in str(ella_misma.json())
    otra_empresa = Empresa.objects.create(nombre="Otra", codigo="OT")
    ajena = User.objects.create_user(username="ajena", email="ajena@x.com", password="x")
    MembresiaEmpresa.objects.create(usuario=ajena, empresa=otra_empresa)
    de_otra = cliente.patch(url(julia), {"modo": "persona", "persona_id": ajena.pk}, format="json")
    assert de_otra.status_code in (400, 404)


def test_un_superusuario_solo_lo_configura_otro_superusuario(e, ti):
    julia = e["jefa"][0]
    julia.is_superuser = True
    julia.save()
    _, cliente = ti
    respuesta = cliente.patch(url(julia), {"modo": "jefe"}, format="json")
    assert respuesta.status_code in (403, 404)


def test_si_esta_ausente_lo_pendiente_pasa_enseguida(e, ti, django_capture_on_commit_callbacks):
    julia, tatiana = e["jefa"][0], e["th"][0]
    ana_cliente = e["ana"][1]
    from apps.licencias.models import FlujoPermiso

    flujo = FlujoPermiso.objects.get(nombre="Vacaciones")
    solicitud = _pedir(ana_cliente, flujo.pk)
    assert [p["id"] for p in solicitud["pendiente_de"]] == [julia.pk]
    LeaveRecord.objects.create(
        user=julia,
        type=LeaveRecord.Type.VACACIONES,
        date=timezone.localdate(),
        is_full_day=True,
        created_by=julia,
    )
    _, cliente = ti
    respuesta = cliente.patch(
        url(julia), {"modo": "persona", "persona_id": tatiana.pk}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    pendiente = SolicitudPermiso.objects.get(pk=solicitud["id"])
    assert list(pendiente.pendiente_de.values_list("pk", flat=True)) == [tatiana.pk]
    assert pendiente.acciones.filter(comentario="Escalada a Tatiana por ausencia de Julia").exists()
