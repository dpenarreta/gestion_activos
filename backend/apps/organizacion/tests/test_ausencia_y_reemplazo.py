"""Ausencias visibles y reemplazo en las aprobaciones (11/11/2026, US-001).

Lo que se protege:

- Ausente = permiso o vacaciones aprobados de día completo (de la empresa
  activa), vacaciones en curso o «Fuera de la oficina» en el chat. Un permiso
  por horas no cuenta (CA-1, CA-2).
- A terceros solo se dice «vacaciones» o «fuera_oficina», hasta cuándo y el
  reemplazo: nunca el tipo de permiso (CA-8).
- El reemplazo es el jefe inmediato o la persona elegida; si también está
  ausente se sigue la cadena, con tope y sin ciclos, y se salta a quien no
  puede aprobar (CA-3, CA-6).
- «Mi reemplazo» se lee y se guarda con sus validaciones (CA-3).
- La revisión periódica (`reasignar_por_ausencia`) pasa lo pendiente y no lo
  repite (CA-5).
- La configuración del reemplazo sale en «Mis datos» (CA-8).
"""

import datetime
import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.ausencias.models import LeaveRecord
from apps.chat.models import EstadoChat
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.licencias.models import AccionSolicitud, SolicitudPermiso
from apps.licencias.tests.test_licencias import (  # noqa: F401 (fixture)
    _pedir,
    _persona,
    empresa_con_organigrama,
)
from apps.organizacion import ausencia
from apps.organizacion.models import DatosDeContacto
from apps.users.models import User

URL = "/api/v1/organizacion/mi-reemplazo/"
HOY = timezone.localdate
UN_DIA = datetime.timedelta(days=1)


@pytest.fixture
def e(empresa_con_organigrama):  # noqa: F811 (el fixture importado)
    """Gerardo (Gerente General) > Julia (Jefa de Cobranzas) > Ana (Analista);
    Tatiana (Talento Humano) e Inés (administra los flujos)."""
    return empresa_con_organigrama


def _permiso(usuario, *dias, tipo=LeaveRecord.Type.VACACIONES, completo=True):
    for dia in dias:
        LeaveRecord.objects.create(
            user=usuario,
            type=tipo,
            date=dia,
            is_full_day=completo,
            duration_minutes=None if completo else 120,
            observation="Control de embarazo" if tipo == LeaveRecord.Type.MEDICO else None,
            created_by=usuario,
        )


def _fuera(usuario, dias=2):
    EstadoChat.objects.update_or_create(
        usuario=usuario,
        defaults={
            "estado": EstadoChat.Estado.FUERA_OFICINA,
            "hasta": timezone.now() + datetime.timedelta(days=dias),
            "mensaje": "Escriba a Gerardo para lo urgente.",
        },
    )


def _elige(usuario, reemplazo):
    DatosDeContacto.objects.update_or_create(
        usuario=usuario,
        defaults={"reemplazo_modo": DatosDeContacto.ReemplazoModo.PERSONA, "reemplazo": reemplazo},
    )


# --- ¿Quién está ausente? (CA-1, CA-2, CA-8) ---------------------------------------------


def test_un_permiso_aprobado_de_dia_completo_la_vuelve_ausente_hasta_su_ultimo_dia(e):
    julia, ana, tatiana = e["jefa"][0], e["ana"][0], e["th"][0]
    hoy = HOY()
    # Registrados a mano: se encadenan aunque en medio haya un fin de semana.
    _permiso(julia, hoy, hoy + 3 * UN_DIA, hoy + 5 * UN_DIA)
    _permiso(julia, hoy + 20 * UN_DIA)  # otra ausencia, lejos: no es la misma
    _permiso(ana, hoy, tipo=LeaveRecord.Type.MEDICO)
    _permiso(tatiana, hoy, tipo=LeaveRecord.Type.PERSONAL, completo=False)  # por horas

    ausentes = ausencia.ausencias_de([julia, ana.pk, tatiana])

    fin = hoy + 5 * UN_DIA
    assert ausentes[julia.pk]["clave"] == "vacaciones"
    assert ausentes[julia.pk]["hasta"] == fin
    assert ausentes[julia.pk]["texto"] == f"De vacaciones hasta el {fin:%d/%m}"
    # Un permiso médico se ve como «fuera de la oficina»: nunca su tipo.
    assert ausentes[ana.pk]["clave"] == "fuera_oficina"
    assert ausentes[ana.pk]["texto"] == f"Fuera de la oficina hasta el {hoy:%d/%m}"
    assert "MEDICO" not in json.dumps(ausentes, default=str)
    assert "embarazo" not in json.dumps(ausentes, default=str)
    # Un permiso por horas no la vuelve ausente: regresa el mismo día.
    assert tatiana.pk not in ausentes


def test_el_hasta_de_un_permiso_de_una_solicitud_es_su_ultimo_dia(e):
    julia = e["jefa"][0]
    hoy = HOY()
    solicitud = SolicitudPermiso.objects.create(
        flujo_id=e["vacaciones"],
        solicitante=julia,
        desde=hoy,
        hasta=hoy + 9 * UN_DIA,
        estado=SolicitudPermiso.Estado.APROBADA,
    )
    for dia in (hoy, hoy + 9 * UN_DIA):
        LeaveRecord.objects.create(
            user=julia,
            type=LeaveRecord.Type.VACACIONES,
            date=dia,
            is_full_day=True,
            created_by=julia,
            solicitud=solicitud,
        )
    assert ausencia.ausencia_de(julia)["hasta"] == hoy + 9 * UN_DIA


def test_los_permisos_de_otra_empresa_no_cuentan(e):
    julia = e["jefa"][0]
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    with usando_empresa(otra):
        _permiso(julia, HOY())
    assert ausencia.ausencias_de([julia]) == {}
    with usando_empresa(otra):
        assert julia.pk in ausencia.ausencias_de([julia], con_reemplazo=False)


def test_el_estado_del_chat_tambien_la_vuelve_ausente(e):
    julia, ana = e["jefa"][0], e["ana"][0]
    hoy = HOY()
    _fuera(julia, dias=3)
    EstadoChat.objects.create(
        usuario=ana, vacaciones_desde=hoy - UN_DIA, vacaciones_hasta=hoy + 4 * UN_DIA
    )
    ausentes = ausencia.ausencias_de([julia, ana])
    assert ausentes[julia.pk]["clave"] == "fuera_oficina"
    assert ausentes[julia.pk]["hasta"] == timezone.localdate(
        EstadoChat.objects.get(usuario=julia).hasta
    )
    assert ausentes[ana.pk] == {
        "clave": "vacaciones",
        "texto": f"De vacaciones hasta el {hoy + 4 * UN_DIA:%d/%m}",
        "hasta": hoy + 4 * UN_DIA,
        # La jefa de Ana también está ausente: pasa a Gerardo.
        "reemplazo": {"id": e["gerente"][0].pk, "nombre": "Gerardo"},
    }
    # Vencido, deja de contar.
    EstadoChat.objects.filter(usuario=julia).update(hasta=timezone.now() - UN_DIA)
    assert julia.pk not in ausencia.ausencias_de([julia])


def test_ausencias_de_es_en_lote(e, django_assert_max_num_queries):
    personas = [e[k][0] for k in ("gerente", "jefa", "ana", "th", "admin")]
    for p in personas:
        _permiso(p, HOY())
    # Una consulta por fuente, sin importar cuántas personas (sin reemplazos).
    with django_assert_max_num_queries(4):
        ausentes = ausencia.ausencias_de(personas, con_reemplazo=False)
    assert len(ausentes) == 5


# --- El reemplazo (CA-3, CA-6) -----------------------------------------------------------


def test_por_defecto_es_el_jefe_inmediato_y_si_no_la_persona_elegida(e):
    gerardo, julia, ana, tatiana = (e[k][0] for k in ("gerente", "jefa", "ana", "th"))
    assert ausencia.reemplazo_para(ana) == julia
    _elige(ana, tatiana)
    assert ausencia.reemplazo_para(ana) == tatiana
    # El Gerente General no tiene jefe ni eligió a nadie: no hay reemplazo.
    assert ausencia.reemplazo_para(gerardo) is None


def test_si_el_reemplazo_esta_ausente_se_sigue_la_cadena(e):
    gerardo, julia, ana = (e[k][0] for k in ("gerente", "jefa", "ana"))
    _fuera(julia)
    assert ausencia.reemplazo_para(ana) == gerardo
    _permiso(gerardo, HOY())
    # Toda la cadena está ausente: no queda nadie.
    assert ausencia.reemplazo_para(ana) is None


def test_un_ciclo_de_reemplazos_se_corta(e):
    julia, tatiana, ana = e["jefa"][0], e["th"][0], e["ana"][0]
    _elige(julia, tatiana)
    _elige(tatiana, julia)
    _fuera(tatiana)
    _fuera(julia)
    # Julia → Tatiana (ausente) → Julia (ya visitada): nadie.
    assert ausencia.reemplazo_para(julia) is None
    # Ana → Julia (ausente) → Tatiana (ausente) → Julia: nadie, sin colgarse.
    assert ausencia.reemplazo_para(ana) is None


def test_la_cadena_tiene_un_tope_de_cinco_saltos(e):
    empresa = empresa_actual()
    cadena = []
    for i in range(7):
        usuario = User.objects.create_user(
            username=f"eslabon{i}",
            email=f"eslabon{i}@grupolaar.com",
            password="Sup3r-Secr3t!",
            first_name=f"Eslabón {i}",
        )
        MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
        cadena.append(usuario)
    for actual, siguiente in zip(cadena, cadena[1:], strict=False):
        _elige(actual, siguiente)
    for usuario in cadena[1:5]:
        _fuera(usuario)
    # Saltos: 1, 2, 3, 4 ausentes; el 5.º está: dentro del tope.
    assert ausencia.reemplazo_para(cadena[0]) == cadena[5]
    _fuera(cadena[5])
    # El 6.º ya está a seis saltos: fuera del tope.
    assert ausencia.reemplazo_para(cadena[0]) is None


def test_se_salta_a_quien_no_puede_aprobar(e):
    gerardo, julia, ana = (e[k][0] for k in ("gerente", "jefa", "ana"))
    _elige(julia, ana)
    _elige(ana, gerardo)
    # Ana pidió: no aprueba lo suyo; se sigue por su reemplazo.
    assert ausencia.reemplazo_para(julia, excluir={ana.pk}) == gerardo


def test_una_persona_elegida_que_ya_no_esta_en_la_empresa_vuelve_al_jefe(e):
    julia, ana, tatiana = e["jefa"][0], e["ana"][0], e["th"][0]
    _elige(ana, tatiana)
    tatiana.status = User.Status.DISABLED
    tatiana.save()
    assert ausencia.reemplazo_para(ana) == julia


# --- «Mi reemplazo» (CA-3) ---------------------------------------------------------------


def test_mi_reemplazo_por_defecto_es_el_jefe(e):
    _, cliente = e["ana"]
    datos = cliente.get(URL).json()
    assert datos == {
        "modo": "jefe",
        "persona": None,
        "jefe": {"id": e["jefa"][0].pk, "nombre": "Julia"},
    }


def test_guardar_otra_persona_y_volver_al_jefe(e):
    _, cliente = e["ana"]
    tatiana = e["th"][0]
    guardado = cliente.put(URL, {"modo": "persona", "persona_id": tatiana.pk}, format="json")
    assert guardado.status_code == 200, guardado.data
    assert guardado.json()["persona"] == {"id": tatiana.pk, "nombre": "Tatiana"}
    assert cliente.get(URL).json()["modo"] == "persona"
    assert ausencia.reemplazo_para(e["ana"][0]) == tatiana

    de_vuelta = cliente.put(URL, {"modo": "jefe", "persona_id": tatiana.pk}, format="json")
    assert de_vuelta.json() == {
        "modo": "jefe",
        "persona": None,
        "jefe": {"id": e["jefa"][0].pk, "nombre": "Julia"},
    }
    assert DatosDeContacto.objects.get(usuario=e["ana"][0]).reemplazo_id is None


def test_validaciones_de_mi_reemplazo(e):
    ana, cliente = e["ana"]
    sin_persona = cliente.put(URL, {"modo": "persona"}, format="json")
    assert sin_persona.status_code == 400
    assert "persona_id" in sin_persona.json()["error"]["details"]

    yo_mismo = cliente.put(URL, {"modo": "persona", "persona_id": ana.pk}, format="json")
    assert yo_mismo.status_code == 400
    assert "No puede elegirse a usted mismo" in json.dumps(yo_mismo.json(), ensure_ascii=False)

    ajena = User.objects.create_user(
        username="ñusta", email="nusta@otra.com", password="Sup3r-Secr3t!"
    )
    MembresiaEmpresa.objects.create(
        usuario=ajena, empresa=Empresa.objects.create(nombre="Otra", codigo="OT")
    )
    de_otra = cliente.put(URL, {"modo": "persona", "persona_id": ajena.pk}, format="json")
    assert de_otra.status_code == 400
    assert "cuenta activa en esta empresa" in json.dumps(de_otra.json(), ensure_ascii=False)

    inexistente = cliente.put(URL, {"modo": "persona", "persona_id": 999999}, format="json")
    assert inexistente.status_code == 400
    assert cliente.put(URL, {"modo": "cualquiera"}, format="json").status_code == 400
    # Nada de lo rechazado se guardó.
    assert cliente.get(URL).json()["modo"] == "jefe"


def test_mi_reemplazo_pide_sesion(e):
    assert APIClient().get(URL).status_code == 401
    assert APIClient().put(URL, {"modo": "jefe"}, format="json").status_code == 401


# --- Revisión periódica (CA-5) -----------------------------------------------------------


def test_el_comando_pasa_lo_pendiente_de_quien_empezo_su_ausencia_y_no_lo_repite(e):
    _, cliente_ana = e["ana"]
    julia = e["jefa"][0]
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    assert [p["nombre"] for p in solicitud["pendiente_de"]] == ["Julia"]
    # Sus vacaciones empiezan hoy: nadie toca nada, y la revisión lo nota.
    _permiso(julia, HOY())
    salida = StringIO()
    with usando_empresa(None):
        call_command("reasignar_por_ausencia", stdout=salida)
    assert "1 aprobación(es) reasignada(s)" in salida.getvalue()
    fila = SolicitudPermiso.objects.get(pk=solicitud["id"])
    assert [u.username for u in fila.pendiente_de.all()] == ["gerardo"]
    escaladas = AccionSolicitud.objects.filter(
        solicitud=fila, accion=AccionSolicitud.Accion.ESCALADA
    )
    assert [a.comentario for a in escaladas] == ["Escalada a Gerardo por ausencia de Julia"]

    # Otra pasada no hace nada más.
    otra = StringIO()
    with usando_empresa(None):
        call_command("reasignar_por_ausencia", stdout=otra)
    assert otra.getvalue() == ""
    assert escaladas.count() == 1


def test_al_volver_lo_reasignado_se_queda_con_el_reemplazo(e):
    _, cliente_ana = e["ana"]
    julia = e["jefa"][0]
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    _fuera(julia)
    assert ausencia.reasignar_pendientes(julia) == 1
    EstadoChat.objects.filter(usuario=julia).update(estado=EstadoChat.Estado.DISPONIBLE)
    assert ausencia.reasignar_pendientes(julia) == 0
    fila = SolicitudPermiso.objects.get(pk=solicitud["id"])
    assert [u.username for u in fila.pendiente_de.all()] == ["gerardo"]


def test_sin_reemplazo_lo_pendiente_se_queda_con_quien_estaba(e):
    _, cliente_ana = e["ana"]
    julia, gerardo = e["jefa"][0], e["gerente"][0]
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    _fuera(julia)
    _fuera(gerardo)
    assert ausencia.reasignar_pendientes(julia) == 0
    fila = SolicitudPermiso.objects.get(pk=solicitud["id"])
    assert [u.username for u in fila.pendiente_de.all()] == ["julia"]


# --- «Mis datos» (CA-8) ------------------------------------------------------------------


def test_la_configuracion_del_reemplazo_sale_en_mis_datos(e):
    from apps.privacidad.mis_datos import Contexto, _chat, _perfil

    ana, tatiana = e["ana"][0], e["th"][0]
    _elige(ana, tatiana)
    _fuera(ana)
    with usando_empresa(empresa_actual()):
        ctx = Contexto(titular=ana, lector=ana)
        perfil = _perfil(ctx)
        chat = _chat(ctx)
    assert perfil[0]["quien_aprueba_por_usted_si_esta_ausente"] == "persona"
    assert perfil[0]["persona_elegida_nombres"] == "Tatiana"
    estado = next(f for f in chat if f["registro"] == "Estado")
    assert estado["estado"] == "fuera_oficina"
    assert estado["texto"] == "Escriba a Gerardo para lo urgente."
    assert estado["hasta"] is not None


# --- Ronda 1 de correcciones (QA, 11/11/2026) ----------------------------------------------


def test_sin_reemplazo_posible_no_se_toca_ningun_flujo(e, monkeypatch):
    from apps.licencias import services as licencias

    gerardo = e["gerente"][0]
    _fuera(gerardo)  # el Gerente General no tiene jefe ni reemplazo

    def no_deberia(*args, **kwargs):
        raise AssertionError("no debía abrir el flujo")

    monkeypatch.setattr(licencias, "reasignar_por_ausencia", no_deberia)
    assert ausencia.reasignar_pendientes(gerardo) == 0


def test_cada_flujo_recibe_el_reemplazo_ya_calculado(e, monkeypatch):
    from apps.licencias import services as licencias
    from apps.proyectos import services as proyectos
    from apps.soporte import services as soporte

    julia, gerardo = e["jefa"][0], e["gerente"][0]
    _fuera(julia)
    recibidos = []
    for modulo in (licencias, proyectos, soporte):
        monkeypatch.setattr(
            modulo,
            "reasignar_por_ausencia",
            lambda ausente, base=None: recibidos.append(base) or 0,
        )
    ausencia.reasignar_pendientes(julia)
    assert recibidos == [gerardo, gerardo, gerardo]


def test_el_reemplazo_mostrado_se_recuerda_y_se_olvida_al_cambiarlo(e, django_assert_num_queries):
    _, cliente_ana = e["ana"]
    ana, julia, tatiana = e["ana"][0], e["jefa"][0], e["th"][0]
    assert ausencia.reemplazos_mostrados([ana.pk])[ana.pk]["nombre"] == "Julia"
    with django_assert_num_queries(0):
        assert ausencia.reemplazos_mostrados([ana.pk])[ana.pk]["nombre"] == "Julia"
    # Lo que reasigna no usa la memoria.
    _elige(ana, tatiana)
    assert ausencia.reemplazo_para(ana) == tatiana
    # Guardar desde «Mi reemplazo» la olvida.
    cliente_ana.put(URL, {"modo": "persona", "persona_id": julia.pk}, format="json")
    assert ausencia.reemplazos_mostrados([ana.pk])[ana.pk]["nombre"] == "Julia"
    cliente_ana.put(URL, {"modo": "persona", "persona_id": tatiana.pk}, format="json")
    assert ausencia.reemplazos_mostrados([ana.pk])[ana.pk]["nombre"] == "Tatiana"


def test_dos_guardados_a_la_vez_no_fallan(e, monkeypatch):
    from django.db import IntegrityError

    ana, tatiana = e["ana"][0], e["th"][0]
    DatosDeContacto.objects.filter(usuario=ana).delete()
    original = DatosDeContacto.save
    intentos = []

    def choca_la_primera_vez(self, *args, **kwargs):
        intentos.append(1)
        if len(intentos) == 1:
            # Como si otra petición hubiera creado la fila entretanto.
            original(DatosDeContacto(usuario=ana))
            raise IntegrityError("datos_de_contacto_unicos")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(DatosDeContacto, "save", choca_la_primera_vez)
    resultado = ausencia.guardar_reemplazo(ana, modo="persona", persona_id=tatiana.pk)
    assert resultado["persona"] == {"id": tatiana.pk, "nombre": "Tatiana"}
    assert len(intentos) == 2
    assert DatosDeContacto.objects.filter(usuario=ana).count() == 1
