"""Solicitud de permisos: flujos configurables de aprobación.

Lo que se protege (19/10/2026), con los dos ejemplos del pedido:

- **Vacaciones**: la persona pide; aprueba su jefe inmediato (organigrama) y
  luego una persona de Talento Humano. Aprobada, se avisa a quien solicitó, a
  quienes aprobaron y a Gerencia General; rechazada, a quien solicitó y a su
  jefe.
- **Permiso médico**: lo aprueba el jefe inmediato **o** Talento Humano
  (cualquiera de los dos); se avisa a quien solicitó.
- Se puede escalar a otra persona o rol; si un paso no encuentra aprobador,
  queda en manos de quien administra los flujos; nadie aprueba lo suyo.
"""

import datetime

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.licencias.models import SolicitudPermiso
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import (
    Cargo,
    DatosDeContacto,
    NivelJerarquico,
    UnidadOrganizacional,
)
from apps.permissions.models import ModulePermission
from apps.users.models import User

FLUJOS = "/api/v1/licencias/flujos/"
SOLICITUDES = "/api/v1/licencias/solicitudes/"


def _persona(nombre, *permisos, cargo=None):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@grupolaar.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission), codename__in=permisos
        )
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa_actual())
    if cargo is not None:
        with usando_empresa(empresa_actual()):
            DatosDeContacto.objects.create(usuario=usuario, cargo=cargo)
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return usuario, cliente


@pytest.fixture
def empresa_con_organigrama(db):
    """Gerente General > Jefe de Cobranzas > Analista; y Talento Humano."""
    with usando_empresa(empresa_actual()):
        nivel = NivelJerarquico.objects.create(nombre="Gerencia", orden=1)
        unidad = UnidadOrganizacional.objects.create(nombre="Empresa", nivel=nivel)
        gg = Cargo.objects.create(nombre="Gerente General", unidad=unidad)
        jefe = Cargo.objects.create(nombre="Jefe de Cobranzas", unidad=unidad, jefe=gg)
        analista = Cargo.objects.create(nombre="Analista", unidad=unidad, jefe=jefe, plazas=3)
    personas = {
        "gerente": _persona("gerardo", cargo=gg),
        "jefa": _persona("julia", cargo=jefe),
        "ana": _persona("ana", cargo=analista),
        "th": _persona("tatiana"),
        "admin": _persona("ines", "licencias.configurar", "licencias.ver_todas"),
    }
    _, admin = personas["admin"]
    th = personas["th"][0]
    vacaciones = admin.post(
        FLUJOS,
        {
            "nombre": "Vacaciones",
            "adjunto": "no",
            "pasos": [
                {"nombre": "Jefatura", "aprobadores": [{"tipo": "jefe_inmediato"}]},
                {
                    "nombre": "Talento Humano",
                    "aprobadores": [{"tipo": "persona", "usuario": th.id}],
                },
            ],
            "avisos_aprobada": [
                {"tipo": "solicitante"},
                {"tipo": "aprobadores"},
                {"tipo": "cargo", "cargo": gg.id},
            ],
            "avisos_rechazada": [{"tipo": "solicitante"}, {"tipo": "jefe_inmediato"}],
        },
        format="json",
    )
    assert vacaciones.status_code == 201, vacaciones.data
    medico = admin.post(
        FLUJOS,
        {
            "nombre": "Permiso médico",
            "adjunto": "opcional",
            "pasos": [
                {
                    "nombre": "Jefatura o Talento Humano",
                    "aprobadores": [
                        {"tipo": "jefe_inmediato"},
                        {"tipo": "persona", "usuario": th.id},
                    ],
                }
            ],
            "avisos_aprobada": [{"tipo": "solicitante"}],
            "avisos_rechazada": [{"tipo": "solicitante"}],
        },
        format="json",
    )
    assert medico.status_code == 201, medico.data
    return {
        **personas,
        "vacaciones": vacaciones.json()["id"],
        "medico": medico.json()["id"],
    }


def _pedir(cliente, flujo, **extra):
    datos = {
        "flujo": flujo,
        "desde": "2026-11-02",
        "hasta": "2026-11-06",
        "motivo": "Viaje",
        **extra,
    }
    respuesta = cliente.post(SOLICITUDES, datos, format="multipart")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.json()


def _avisados(tipo, solicitud_id):
    return set(
        Notificacion.objects.todas()
        .filter(tipo=tipo, enlace__contains=f"solicitud={solicitud_id}")
        .values_list("usuario__username", flat=True)
    )


def test_vacaciones_aprobadas_por_jefa_y_talento_humano(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, jefa = e["jefa"]
    _, th = e["th"]
    solicitud = _pedir(ana, e["vacaciones"])
    assert solicitud["paso_actual"] == "Jefatura"
    assert [p["nombre"] for p in solicitud["pendiente_de"]] == ["Julia"]
    assert _avisados("licencias.por_aprobar", solicitud["id"]) == {"julia"}

    # Quien no la tiene pendiente no la aprueba.
    assert th.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").status_code in (403, 404)

    paso2 = jefa.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/", {"comentario": "Ok"}).json()
    assert paso2["paso_actual"] == "Talento Humano"
    assert [p["nombre"] for p in paso2["pendiente_de"]] == ["Tatiana"]

    final = th.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").json()
    assert final["estado"] == "aprobada"
    # Aprobada: quien solicitó, quienes aprobaron y Gerencia General.
    assert _avisados("licencias.aprobada", solicitud["id"]) == {
        "ana",
        "julia",
        "tatiana",
        "gerardo",
    }
    acciones = [a["accion"] for a in final["acciones"]]
    assert acciones[0] == "creada" and acciones[-1] == "terminada"


def test_vacaciones_rechazadas_avisan_a_quien_solicito_y_a_su_jefe(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, jefa = e["jefa"]
    solicitud = _pedir(ana, e["vacaciones"])
    sin_motivo = jefa.post(f"{SOLICITUDES}{solicitud['id']}/rechazar/")
    assert sin_motivo.status_code == 400
    final = jefa.post(
        f"{SOLICITUDES}{solicitud['id']}/rechazar/", {"comentario": "Cierre de mes"}
    ).json()
    assert final["estado"] == "rechazada"
    assert _avisados("licencias.rechazada", solicitud["id"]) == {"ana", "julia"}


def test_permiso_medico_lo_aprueba_la_jefa_o_talento_humano(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, th = e["th"]
    solicitud = _pedir(ana, e["medico"])
    assert {p["nombre"] for p in solicitud["pendiente_de"]} == {"Julia", "Tatiana"}
    final = th.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").json()
    assert final["estado"] == "aprobada"
    assert _avisados("licencias.aprobada", solicitud["id"]) == {"ana"}


def test_se_escala_a_otra_persona_o_rol(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, jefa = e["jefa"]
    gerente, cliente_gerente = e["gerente"]
    solicitud = _pedir(ana, e["vacaciones"])
    escalada = jefa.post(
        f"{SOLICITUDES}{solicitud['id']}/escalar/",
        {"destino": {"tipo": "persona", "usuario": gerente.id}, "comentario": "Decide gerencia"},
        format="json",
    ).json()
    assert [p["nombre"] for p in escalada["pendiente_de"]] == ["Gerardo"]
    # La jefa ya no la tiene pendiente; el gerente sí, y sigue el flujo.
    assert jefa.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").status_code == 403
    siguiente = cliente_gerente.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").json()
    assert siguiente["paso_actual"] == "Talento Humano"


def test_sin_jefe_en_el_organigrama_queda_en_manos_de_quien_administra(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, sin_cargo = _persona("sofia")
    solicitud = _pedir(sin_cargo, e["vacaciones"])
    assert [p["nombre"] for p in solicitud["pendiente_de"]] == ["Ines"]
    detalle = sin_cargo.get(f"{SOLICITUDES}{solicitud['id']}/").json()
    assert "no encontró aprobador" in detalle["acciones"][-1]["detalle"]


def test_nadie_aprueba_lo_suyo_y_quien_solicita_puede_cancelar(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, jefa = e["jefa"]
    # La jefa pide: su jefe es el gerente, no ella misma.
    solicitud = _pedir(jefa, e["medico"])
    assert "Julia" not in {p["nombre"] for p in solicitud["pendiente_de"]}
    cancelada = jefa.post(f"{SOLICITUDES}{solicitud['id']}/cancelar/").json()
    assert cancelada["estado"] == "cancelada"
    assert SolicitudPermiso.objects.todas().get(pk=solicitud["id"]).pendiente_de.count() == 0


def test_las_vistas_y_la_configuracion_piden_permiso(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, ana = e["ana"]
    _, jefa = e["jefa"]
    _, admin = e["admin"]
    solicitud = _pedir(ana, e["vacaciones"])
    assert [s["id"] for s in ana.get(SOLICITUDES).json()] == [solicitud["id"]]
    assert [s["id"] for s in jefa.get(SOLICITUDES, {"vista": "por_aprobar"}).json()] == [
        solicitud["id"]
    ]
    assert jefa.get(f"{SOLICITUDES}resumen/").json() == {"por_aprobar": 1}
    assert ana.get(SOLICITUDES, {"vista": "todas"}).status_code == 403
    assert len(admin.get(SOLICITUDES, {"vista": "todas"}).json()) == 1
    assert ana.get(FLUJOS).status_code == 403
    # Un flujo con solicitudes no se borra: se desactiva.
    assert admin.delete(f"{FLUJOS}{e['vacaciones']}/").status_code == 409


def test_el_documento_obligatorio_y_las_fechas_se_validan(empresa_con_organigrama):
    e = empresa_con_organigrama
    _, admin = e["admin"]
    _, ana = e["ana"]
    admin.patch(f"{FLUJOS}{e['medico']}/", {"adjunto": "obligatorio"}, format="json")
    sin_documento = ana.post(
        SOLICITUDES,
        {"flujo": e["medico"], "desde": "2026-11-02", "hasta": "2026-11-02"},
        format="multipart",
    )
    assert sin_documento.status_code == 400
    al_reves = ana.post(
        SOLICITUDES,
        {"flujo": e["vacaciones"], "desde": "2026-11-05", "hasta": "2026-11-02"},
        format="multipart",
    )
    assert al_reves.status_code == 400
    assert datetime.date(2026, 11, 2)  # fechas en formato ISO
