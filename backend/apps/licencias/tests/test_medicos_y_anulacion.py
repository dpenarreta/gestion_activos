"""Decisiones del usuario del 05/11/2026 sobre la Solicitud de permisos.

1. **Anular una aprobada** pide `licencias.anular_aprobadas`, ya no
   `licencias.ver_todas`. `permissions/0049` se lo da a quien tenía
   `ver_todas` y al Superusuario, para que nadie pierda la facultad de golpe.
2. **Permisos médicos**: un tipo con `tipo_ausencia = MEDICO` pide siempre el
   motivo y el documento obligatorio (400 por campo si se intenta otra cosa;
   `licencias/0006` corrige los existentes). La solicitud médica sin motivo o
   sin documento se rechaza, y los dos se conservan con la solicitud.
"""

import importlib

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission
from rest_framework.test import APIClient

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.licencias.models import FlujoPermiso, SolicitudPermiso
from apps.licencias.tests.test_ausencias_generadas import (  # noqa: F401 (fixture)
    FLUJOS,
    MOTIVO,
    SOLICITUDES,
    _aprobar_medico,
    _ausencias,
    _certificado,
    _clasificar,
    _pedida,
    e,
    empresa_con_organigrama,
)
from apps.licencias.tests.test_licencias import _persona
from apps.permissions.catalog import all_codenames, as_django_permission_tuples
from apps.users.models import User

PERMISO = "licencias.anular_aprobadas"


def _aprobada(e):  # noqa: F811
    _, ana = e["ana"]
    solicitud = _pedida(ana, e["medico"], "2026-11-05", "2026-11-05")
    _aprobar_medico(e, solicitud["id"])
    assert len(_ausencias(solicitud["id"])) == 1
    return solicitud["id"]


# --- 1. `licencias.anular_aprobadas` ---------------------------------------------------


def test_el_permiso_esta_en_el_catalogo_con_su_descripcion(db):
    assert PERMISO in all_codenames()
    descripcion = dict(as_django_permission_tuples())[PERMISO]
    assert "aprobadas" in descripcion
    assert "ausencias" in descripcion and "vacaciones" in descripcion
    assert Permission.objects.filter(
        content_type__app_label="permissions", codename=PERMISO
    ).exists()


def test_con_el_permiso_cancela_una_aprobada_aunque_no_vea_todas(e):  # noqa: F811
    """Tatiana la aprobó (la ve por eso) y no tiene `ver_todas`: con
    `anular_aprobadas` la anula."""
    solicitud_id = _aprobada(e)
    tatiana, _ = e["th"]
    tatiana.user_permissions.add(
        Permission.objects.get(content_type__app_label="permissions", codename=PERMISO)
    )
    cliente = APIClient()
    cliente.force_authenticate(user=User.objects.get(pk=tatiana.pk))
    detalle = cliente.get(f"{SOLICITUDES}{solicitud_id}/").json()
    assert detalle["puedo"]["cancelar"] is True
    respuesta = cliente.post(
        f"{SOLICITUDES}{solicitud_id}/cancelar/", {"comentario": "Se reincorporó antes"}
    )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["estado"] == "cancelada"
    assert _ausencias(solicitud_id) == []


def test_el_permiso_solo_no_revela_solicitudes_que_no_ve(e):  # noqa: F811
    """Anular no amplía lo que se ve (el motivo médico es dato de salud):
    sin `ver_todas` ni haber intervenido, la solicitud no existe para él."""
    solicitud_id = _aprobada(e)
    _, gestora = _persona("gabriela", PERMISO)
    assert gestora.get(f"{SOLICITUDES}{solicitud_id}/").status_code == 404
    respuesta = gestora.post(
        f"{SOLICITUDES}{solicitud_id}/cancelar/", {"comentario": "Se reincorporó antes"}
    )
    assert respuesta.status_code == 404
    assert len(_ausencias(solicitud_id)) == 1


def test_solo_con_ver_todas_ya_no_cancela_una_aprobada(e):  # noqa: F811
    solicitud_id = _aprobada(e)
    _, consulta = _persona("veronica", "licencias.ver_todas")
    detalle = consulta.get(f"{SOLICITUDES}{solicitud_id}/").json()
    assert detalle["puedo"]["cancelar"] is False
    respuesta = consulta.post(
        f"{SOLICITUDES}{solicitud_id}/cancelar/", {"comentario": "Prueba de anulación"}
    )
    assert respuesta.status_code == 403
    assert len(_ausencias(solicitud_id)) == 1
    assert (
        SolicitudPermiso.objects.todas().get(pk=solicitud_id).estado
        == SolicitudPermiso.Estado.APROBADA
    )


def test_la_migracion_da_el_permiso_a_quien_veia_todas_y_al_superusuario(db):
    migracion = importlib.import_module(
        "apps.permissions.migrations.0049_anular_aprobadas_para_quien_ya_anulaba"
    )
    tipo = {"content_type__app_label": "permissions"}
    ver_todas = Permission.objects.get(codename="licencias.ver_todas", **tipo)
    anular = Permission.objects.get(codename=PERMISO, **tipo)
    gestion_humana = Group.objects.create(name="Coordinación de Gestión Humana (prueba)")
    gestion_humana.permissions.add(ver_todas)
    otro = Group.objects.create(name="Analista de Cobranzas (prueba)")
    superusuario, _ = Group.objects.get_or_create(name="Superusuario")
    superusuario.permissions.remove(anular)
    cuenta, _ = _persona("ximena", "licencias.ver_todas", con_rol=False)

    migracion.conceder(django_apps, None)

    assert gestion_humana.permissions.filter(pk=anular.pk).exists()
    assert superusuario.permissions.filter(pk=anular.pk).exists()
    assert cuenta.user_permissions.filter(pk=anular.pk).exists()
    assert not otro.permissions.filter(pk=anular.pk).exists()


# --- 2. Permisos médicos: motivo y documento obligatorios ------------------------------


def test_un_tipo_medico_sin_documento_obligatorio_no_se_guarda(e):  # noqa: F811
    _, admin = e["admin"]
    url = f"{FLUJOS}{e['medico']}/"
    # El tipo del fixture tiene el documento «opcional».
    respuesta = admin.patch(url, {"tipo_ausencia": "MEDICO"}, format="json")
    assert respuesta.status_code == 400
    detalles = respuesta.json()["error"]["details"]
    assert "adjunto" in detalles and "pide_motivo" not in detalles
    assert FlujoPermiso.objects.todas().get(pk=e["medico"]).tipo_ausencia == "PERSONAL"


def test_un_tipo_medico_sin_motivo_no_se_guarda(e):  # noqa: F811
    _, admin = e["admin"]
    url = f"{FLUJOS}{e['medico']}/"
    respuesta = admin.patch(
        url,
        {"tipo_ausencia": "MEDICO", "adjunto": "obligatorio", "pide_motivo": False},
        format="json",
    )
    assert respuesta.status_code == 400
    assert set(respuesta.json()["error"]["details"]) == {"pide_motivo"}


def test_uno_ya_medico_no_puede_dejar_de_pedir_motivo_ni_documento(e):  # noqa: F811
    _, admin = e["admin"]
    url = f"{FLUJOS}{e['medico']}/"
    _clasificar(e, "medico", tipo_ausencia="MEDICO")
    for campos, campo in (
        ({"pide_motivo": False}, "pide_motivo"),
        ({"adjunto": "opcional"}, "adjunto"),
        ({"adjunto": "no"}, "adjunto"),
    ):
        respuesta = admin.patch(url, campos, format="json")
        assert respuesta.status_code == 400, campos
        assert campo in respuesta.json()["error"]["details"]
    flujo = FlujoPermiso.objects.todas().get(pk=e["medico"])
    assert (flujo.pide_motivo, flujo.adjunto) == (True, "obligatorio")
    # Deja de ser médico: entonces sí puede cambiarlos.
    assert (
        admin.patch(
            url, {"tipo_ausencia": "PERSONAL", "adjunto": "opcional"}, format="json"
        ).status_code
        == 200
    )


def test_un_tipo_medico_nuevo_con_motivo_y_documento_se_crea(e):  # noqa: F811
    _, admin = e["admin"]
    th, _ = e["th"]
    respuesta = admin.post(
        FLUJOS,
        {
            "nombre": "Cita médica del IESS",
            "adjunto": "obligatorio",
            "pide_motivo": True,
            "tipo_ausencia": "MEDICO",
            "pasos": [
                {"nombre": "Talento Humano", "aprobadores": [{"tipo": "persona", "usuario": th.id}]}
            ],
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data
    assert respuesta.json()["tipo_ausencia"] == "MEDICO"


def test_la_migracion_corrige_los_tipos_medicos_existentes(db):
    migracion = importlib.import_module(
        "apps.licencias.migrations.0006_medicos_con_motivo_y_documento"
    )
    with usando_empresa(empresa_actual()):
        medico = FlujoPermiso.objects.create(nombre="Permiso médico (ñandú)")
        calamidad = FlujoPermiso.objects.create(nombre="Calamidad doméstica")
    # Como estaban antes: médico sin motivo ni documento (el `update` salta
    # el `save()`, que ya los corrige).
    FlujoPermiso.objects.todas().filter(pk=medico.pk).update(
        tipo_ausencia="MEDICO", pide_motivo=False, adjunto="opcional"
    )
    FlujoPermiso.objects.todas().filter(pk=calamidad.pk).update(pide_motivo=False, adjunto="no")

    migracion.corregir_medicos(django_apps, None)

    medico.refresh_from_db()
    calamidad.refresh_from_db()
    assert (medico.pide_motivo, medico.adjunto) == (True, "obligatorio")
    assert (calamidad.pide_motivo, calamidad.adjunto) == (False, "no")


def test_guardar_un_tipo_medico_desde_el_codigo_tambien_los_exige(db):
    with usando_empresa(empresa_actual()):
        flujo = FlujoPermiso.objects.create(
            nombre="Reposo médico", tipo_ausencia="MEDICO", pide_motivo=False, adjunto="no"
        )
    assert (flujo.pide_motivo, flujo.adjunto) == (True, "obligatorio")


def test_la_solicitud_medica_sin_documento_o_sin_motivo_se_rechaza(e):  # noqa: F811
    _, ana = e["ana"]
    _clasificar(e, "medico", tipo_ausencia="MEDICO")
    base = {"flujo": e["medico"], "desde": "2026-11-05", "hasta": "2026-11-05"}

    sin_documento = ana.post(SOLICITUDES, {**base, "motivo": MOTIVO}, format="multipart")
    assert sin_documento.status_code == 400
    assert "adjunto" in sin_documento.json()["error"]["details"]

    sin_motivo = ana.post(
        SOLICITUDES, {**base, "motivo": "   ", "adjunto": _certificado()}, format="multipart"
    )
    assert sin_motivo.status_code == 400
    assert "motivo" in sin_motivo.json()["error"]["details"]
    assert not SolicitudPermiso.objects.todas().exists()


def test_la_solicitud_medica_conserva_su_motivo_y_su_documento(e):  # noqa: F811
    _, ana = e["ana"]
    _clasificar(e, "medico", tipo_ausencia="MEDICO")
    solicitud_id = _aprobada(e)
    solicitud = SolicitudPermiso.objects.todas().get(pk=solicitud_id)
    assert solicitud.motivo == MOTIVO
    assert solicitud.adjunto and solicitud.adjunto_nombre == "certificado.pdf"


@pytest.mark.parametrize("tipo", ["PERSONAL"])
def test_un_tipo_no_medico_sigue_pudiendo_no_pedir_documento(e, tipo):  # noqa: F811
    _, admin = e["admin"]
    respuesta = admin.patch(
        f"{FLUJOS}{e['medico']}/",
        {"tipo_ausencia": tipo, "adjunto": "no", "pide_motivo": False},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
