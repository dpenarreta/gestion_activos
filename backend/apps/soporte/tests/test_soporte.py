"""Mesa de ayuda: formulario público, cola, reparto, SLA, escalamiento y seguimiento.

Lo que se protege es lo acordado con el negocio: una sola cola por empresa
cuya posición baja a medida que se atiende; reparto por disponibilidad entre
los técnicos habilitados y en horario; el SLA medido solo en horario de
atención, pausado mientras se espera al usuario; escalamiento a la supervisión
al vencer; y que quien pidió vea su ticket sin ver nada interno.
"""

import datetime
from datetime import time
from unittest import mock

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.organizacion.models import Departamento, Sede
from apps.permissions.models import ModulePermission
from apps.soporte import services
from apps.soporte.horario import Agenda
from apps.soporte.models import (
    CasoAyuda,
    Categoria,
    HorarioTecnico,
    HorasFueraDeHorario,
    NivelSoporte,
    ReglaSLA,
    Tecnico,
    Ticket,
)
from apps.users.models import User

SOLICITAR = "/api/v1/soporte/solicitar/"
#: Los tickets de quien pide, con su sesión (ya no hay enlace sin sesión).
SEGUIMIENTO = "/api/v1/soporte/mis-tickets/"
TICKETS = "/api/v1/soporte/tickets/"


def _usuario(nombre, *permisos, empresa):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@x.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=[f"soporte.{p}" for p in permisos],
        )
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    return usuario


def _siempre(tecnico):
    """Horario de toda la semana, todo el día: está siempre en horario."""
    for dia in range(7):
        HorarioTecnico.objects.create(
            tecnico=tecnico, dia_semana=dia, hora_inicio=time(0, 0), hora_fin=time(23, 59)
        )


@pytest.fixture
def mesa(db):
    """La mesa de ayuda de una empresa, con dos niveles, dos categorías y técnicos."""
    empresa = Empresa.objects.create(nombre="LaarCourier", codigo="LC")
    with usando_empresa(empresa):
        n1 = NivelSoporte.objects.create(nombre="Mesa de ayuda", orden=1)
        n2 = NivelSoporte.objects.create(nombre="Especialistas", orden=2)
        hardware = Categoria.objects.create(nombre="Hardware")
        accesos = Categoria.objects.create(nombre="Accesos")
        no_enciende = CasoAyuda.objects.create(
            categoria=hardware, nombre="No enciende", prioridad="alta"
        )
        clave = CasoAyuda.objects.create(
            categoria=accesos, nombre="Olvidé mi clave", prioridad="baja"
        )
        sede = Sede.objects.create(nombre="Loja · Agencia", ciudad="Loja")
        area = Departamento.objects.create(nombre="Cobranzas", codigo="COB")
        supervisor = _usuario(
            "diana", "ver_todos", "asignar", "aprobar_horas", "reportes", empresa=empresa
        )
        n1.supervisores.add(supervisor)
        jorge_u = _usuario("jorge", "atender", "registrar", empresa=empresa)
        jorge = Tecnico.objects.create(usuario=jorge_u, nivel=n1, capacidad=1)
        jorge.categorias.set([hardware])
        experto_u = _usuario("luis", "atender", empresa=empresa)
        experto = Tecnico.objects.create(usuario=experto_u, nivel=n2, capacidad=2)
        experto.categorias.set([hardware])
        ReglaSLA.objects.create(minutos=480)  # por defecto
        ReglaSLA.objects.create(categoria=hardware, prioridad="alta", minutos=120)
    return {
        "empresa": empresa,
        "n1": n1,
        "n2": n2,
        "hardware": hardware,
        "no_enciende": no_enciende,
        "clave": clave,
        "sede": sede,
        "area": area,
        "supervisor": supervisor,
        "jorge": jorge,
        "experto": experto,
    }


def _formulario(mesa, **extra):
    """Lo que se llena en «Soporte TI»: los datos de contacto salen de «Mis datos»."""
    return {
        "caso": mesa["no_enciende"].id,
        "descripcion": "La laptop no enciende desde esta mañana.",
        # Lo más bajo de la matriz: la prioridad queda la del caso.
        "impacto": "bajo",
        "urgencia": "baja",
        **extra,
    }


def _carla(mesa):
    """Quien pide soporte: una persona registrada con «Mis datos» completos."""
    from apps.organizacion.models import DatosDeContacto

    carla = User.objects.filter(username="carla").first()
    if carla is None:
        carla = _usuario("carla", empresa=mesa["empresa"])
        carla.first_name, carla.last_name = "Carla", "Ordóñez"
        carla.save()
        with usando_empresa(mesa["empresa"]):
            DatosDeContacto.objects.create(
                usuario=carla,
                telefono="099 418 2273",
                departamento=mesa["area"],
                sede=mesa["sede"],
            )
    return carla


def _quien_pide(mesa):
    return _equipo(_carla(mesa))


def _crear(mesa, **extra):
    respuesta = _quien_pide(mesa).post(SOLICITAR, _formulario(mesa, **extra), format="json")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.data


def _ticket(ticket_id, mesa):
    with usando_empresa(mesa["empresa"]):
        return Ticket.objects.get(pk=ticket_id)


def _equipo(usuario):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


# --- Formulario y cola -----------------------------------------------------------------


def test_soporte_ti_muestra_lo_de_su_empresa_y_los_datos_de_quien_pide(mesa):
    datos = _quien_pide(mesa).get(SOLICITAR).json()
    assert datos["empresa"] == "LaarCourier"
    casos = {c["nombre"]: c for categoria in datos["categorias"] for c in categoria["casos"]}
    assert casos["No enciende"]["prioridad_display"] == "P2 · Alta"
    # Nombre, correo, teléfono, área y agencia salen de «Mis datos»: no se preguntan.
    assert {"nombre", "telefono", "correo", "sede", "area"}.isdisjoint(
        c["clave"] for c in datos["campos"]
    )
    assert datos["mis_datos"]["nombre"] == "Carla Ordóñez"
    assert datos["mis_datos"]["agencia"]["nombre"] == "Loja · Agencia"
    assert datos["mis_datos"]["faltan"] == []


def test_solo_las_personas_registradas_piden_soporte(mesa):
    assert APIClient().get(SOLICITAR).status_code == 401
    assert APIClient().post(SOLICITAR, _formulario(mesa), format="json").status_code == 401


def test_crear_un_ticket_fija_la_prioridad_y_avisa_con_el_enlace(mesa):
    with mock.patch.object(services, "repartir", return_value=0):
        creado = _crear(mesa)
    ticket = _ticket(creado["id"], mesa)
    assert creado["numero"] == f"TCK-{timezone.localdate().year}-000001"
    assert creado["posicion"] == 1
    assert ticket.prioridad == "alta"
    assert ticket.estado == Ticket.Estado.NUEVO
    assert ticket.solicitante == _carla(mesa)
    assert (ticket.solicitante_nombre, ticket.solicitante_telefono) == (
        "Carla Ordóñez",
        "099 418 2273",
    )
    assert (ticket.sede, ticket.area) == (mesa["sede"], mesa["area"])
    assert mail.outbox[0].bcc == ["carla@x.com"]
    assert f"/admin/ayuda/tickets/{ticket.id}" in mail.outbox[0].alternatives[0][0]


def test_si_faltan_datos_se_pide_completar_mis_datos(mesa):
    nuevo = _usuario("marta", empresa=mesa["empresa"])
    nuevo.first_name = ""  # sin nombre ni «Mis datos»
    nuevo.save()
    cliente = _equipo(nuevo)
    assert set(cliente.get(SOLICITAR).json()["mis_datos"]["faltan"]) == {
        "nombre",
        "telefono",
        "area",
        "agencia",
    }
    respuesta = cliente.post(SOLICITAR, _formulario(mesa), format="json")
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "faltan_datos"
    actualizado = cliente.put(
        "/api/v1/organizacion/mis-datos/",
        {
            "nombres": "Marta",
            "apellidos": "Mora",
            "telefono": "0991234567",
            "area": mesa["area"].id,
            "agencia": mesa["sede"].id,
        },
        format="json",
    )
    assert actualizado.status_code == 200, actualizado.data
    assert actualizado.json()["faltan"] == []
    with mock.patch.object(services, "repartir", return_value=0):
        assert cliente.post(SOLICITAR, _formulario(mesa), format="json").status_code == 201


def test_la_posicion_baja_a_medida_que_se_atienden_los_anteriores(mesa):
    with mock.patch.object(services, "repartir", return_value=0):
        primero = _crear(mesa)
        segundo = _crear(mesa)
        tercero = _crear(mesa)
    assert tercero["posicion"] == 3
    # Se atiende el primero: el tercero pasa a estar segundo.
    with usando_empresa(mesa["empresa"]):
        services.tomar_siguiente(mesa["jorge"], mesa["jorge"].usuario)
    assert _quien_pide(mesa).get(f"{SEGUIMIENTO}{tercero['id']}/").json()["posicion"] == 2
    assert _quien_pide(mesa).get(f"{SEGUIMIENTO}{primero['id']}/").json()["posicion"] is None
    assert segundo["posicion"] == 2


# --- Reparto por disponibilidad -------------------------------------------------------


def test_se_asigna_al_tecnico_habilitado_y_en_horario(mesa):
    _siempre(mesa["jorge"])
    creado = _crear(mesa)
    ticket = _ticket(creado["id"], mesa)
    assert ticket.estado == Ticket.Estado.ASIGNADO
    assert ticket.tecnico_id == mesa["jorge"].id
    assert ticket.sla_minutos == 120  # la regla de hardware + alta
    assert ticket.sla_vence is not None
    assert creado["posicion"] is None


def test_la_campana_avisa_al_tecnico_lo_asignado_y_lo_que_responde_el_usuario(mesa):
    from apps.notificaciones.models import Notificacion

    _siempre(mesa["jorge"])
    creado = _crear(mesa)
    ticket = _ticket(creado["id"], mesa)
    _quien_pide(mesa).post(f"{SEGUIMIENTO}{creado['id']}/", {"texto": "Sigue igual"})
    avisos = Notificacion.objects.todas().filter(usuario=mesa["jorge"].usuario)
    assert sorted(avisos.values_list("tipo", flat=True)) == [
        "soporte.respuesta_del_usuario",
        "soporte.ticket_asignado",
    ]
    assert {a.enlace for a in avisos} == {f"/admin/soporte/tickets/{ticket.id}"}
    assert {a.empresa_id for a in avisos} == {mesa["empresa"].id}


def test_fuera_de_horario_queda_en_cola_y_se_avisa(mesa):
    creado = _crear(mesa)  # nadie tiene horario
    ticket = _ticket(creado["id"], mesa)
    assert ticket.estado == Ticket.Estado.NUEVO
    assert ticket.fuera_de_horario is True
    assert "fuera del horario de atención" in mail.outbox[0].alternatives[0][0]


def test_al_atender_recibe_el_siguiente_automaticamente(mesa):
    _siempre(mesa["jorge"])
    primero = _ticket(_crear(mesa)["id"], mesa)
    segundo = _ticket(_crear(mesa)["id"], mesa)
    assert segundo.estado == Ticket.Estado.NUEVO  # capacidad 1: espera
    cliente = _equipo(mesa["jorge"].usuario)
    respuesta = cliente.post(
        f"{TICKETS}{primero.id}/cambiar-estado/", {"estado": "atendido"}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    segundo.refresh_from_db()
    assert segundo.tecnico_id == mesa["jorge"].id
    assert segundo.estado == Ticket.Estado.ASIGNADO


def test_tomar_siguiente_aunque_este_fuera_de_horario(mesa):
    _crear(mesa)
    respuesta = _equipo(mesa["jorge"].usuario).post(f"{TICKETS}tomar-siguiente/")
    assert respuesta.status_code == 200
    assert respuesta.json()["registrar_horas"] is True  # fuera de su horario


def test_un_tecnico_no_ve_lo_que_no_puede_atender(mesa):
    with mock.patch.object(services, "repartir", return_value=0):
        _crear(mesa, caso=mesa["clave"].id)  # Accesos: Jorge no la tiene
    cola = _equipo(mesa["jorge"].usuario).get(TICKETS, {"ambito": "cola"}).json()["results"]
    assert cola == []
    todos = _equipo(mesa["supervisor"]).get(TICKETS, {"ambito": "cola"}).json()["results"]
    assert len(todos) == 1


# --- SLA -------------------------------------------------------------------------------


def test_el_plazo_solo_corre_en_horario(mesa):
    with usando_empresa(mesa["empresa"]):
        for dia in range(5):  # lunes a viernes, 08:00–17:00
            HorarioTecnico.objects.create(tecnico=mesa["jorge"], dia_semana=dia)
        agenda = Agenda(
            Tecnico.objects.prefetch_related("horarios", "ausencias").get(pk=mesa["jorge"].pk)
        )
    zona = timezone.get_current_timezone()
    viernes = timezone.make_aware(datetime.datetime(2026, 10, 16, 16, 0), zona)
    vence = timezone.localtime(agenda.sumar_minutos(viernes, 120))
    # 1 h el viernes y 1 h el lunes siguiente.
    assert vence == timezone.make_aware(datetime.datetime(2026, 10, 19, 9, 0), zona)
    assert agenda.minutos_entre(viernes, vence) == 120


def test_esperar_al_usuario_pausa_el_plazo(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    cliente = _equipo(mesa["jorge"].usuario)
    sin_motivo = cliente.post(
        f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "esperando_usuario"}, format="json"
    )
    assert sin_motivo.status_code == 400
    cliente.post(
        f"{TICKETS}{ticket.id}/cambiar-estado/",
        {"estado": "esperando_usuario", "nota": "¿Cuál es el número de serie?"},
        format="json",
    )
    ticket.refresh_from_db()
    assert ticket.sla_restante_al_pausar is not None
    # Quien pidió responde desde su enlace: vuelve a curso y el reloj sigue.
    _quien_pide(mesa).post(f"{SEGUIMIENTO}{ticket.id}/", {"texto": "Es 5CD1234"}, format="json")
    ticket.refresh_from_db()
    assert ticket.estado == Ticket.Estado.EN_CURSO
    assert ticket.sla_restante_al_pausar is None


def test_el_ciclo_avisa_al_80_y_escala_al_vencer(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    mail.outbox.clear()
    with usando_empresa(mesa["empresa"]):
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_alerta_en=timezone.now() - datetime.timedelta(minutes=1)
        )
    services.ciclo()
    assert "SLA por vencer" in mail.outbox[0].subject
    assert set(mail.outbox[0].bcc) == {"jorge@x.com", "diana@x.com"}

    with usando_empresa(mesa["empresa"]):
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_vence=timezone.now() - datetime.timedelta(minutes=1)
        )
    services.ciclo()
    ticket.refresh_from_db()
    assert ticket.escalado_por_sla is True
    assert "Escalamiento" in mail.outbox[-1].subject
    services.ciclo()  # no se repite
    assert sum("Escalamiento" in m.subject for m in mail.outbox) == 1


def test_lo_atendido_sin_respuesta_se_cierra_solo(mesa, settings):
    settings.SOPORTE_DIAS_CIERRE_AUTOMATICO = 3
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "atendido"}, format="json"
    )
    with usando_empresa(mesa["empresa"]):
        Ticket.objects.filter(pk=ticket.pk).update(
            # Una semana y un día: más de 3 días hábiles, caiga en el día que caiga.
            atendido_en=timezone.now()
            - datetime.timedelta(days=8)
        )
    services.ciclo()
    ticket.refresh_from_db()
    assert ticket.estado == Ticket.Estado.CERRADO


# --- Escalamiento ----------------------------------------------------------------------


def test_escalar_lo_pasa_al_siguiente_nivel_sin_perder_su_lugar(mesa):
    _siempre(mesa["jorge"])
    _siempre(mesa["experto"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    original = ticket.en_cola_desde
    cliente = _equipo(mesa["jorge"].usuario)
    assert (
        cliente.post(f"{TICKETS}{ticket.id}/escalar/", {"motivo": ""}, format="json").status_code
        == 400
    )
    respuesta = cliente.post(
        f"{TICKETS}{ticket.id}/escalar/", {"motivo": "Falla de placa"}, format="json"
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["visible"] is False  # tras escalar, Jorge ya no lo ve
    ticket.refresh_from_db()
    assert ticket.nivel_id == mesa["n2"].id
    assert ticket.tecnico_id == mesa["experto"].id  # lo tomó el N2 disponible
    assert ticket.en_cola_desde == original


# --- Seguimiento -----------------------------------------------------------------------


def test_quien_pidio_no_ve_las_notas_internas_y_puede_confirmar(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    cliente = _equipo(mesa["jorge"].usuario)
    cliente.post(
        f"{TICKETS}{ticket.id}/responder/",
        {"texto": "Nota del equipo", "interno": True},
        format="json",
    )
    cliente.post(f"{TICKETS}{ticket.id}/responder/", {"texto": "Ya vamos para allá"}, format="json")
    vista = _quien_pide(mesa).get(f"{SEGUIMIENTO}{ticket.id}/").json()
    textos = [m["texto"] for m in vista["mensajes"]]
    assert textos == ["Ya vamos para allá"]
    assert vista["estado"] == "en_curso"

    cliente.post(f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "atendido"}, format="json")
    respuesta = _quien_pide(mesa).post(
        f"{SEGUIMIENTO}{ticket.id}/", {"confirmar": True}, format="json"
    )
    assert respuesta.json()["estado"] == "cerrado"
    # Nadie más ve el ticket de Carla, aunque sepa su número.
    otro = _equipo(_usuario("tito", empresa=mesa["empresa"]))
    assert otro.get(f"{SEGUIMIENTO}{ticket.id}/").status_code == 404
    assert [t["numero"] for t in _quien_pide(mesa).get(SEGUIMIENTO).json()] == [ticket.numero]


# --- Horas fuera de horario ------------------------------------------------------------


def test_horas_fuera_de_horario_se_registran_y_las_aprueba_la_supervision(mesa):
    _crear(mesa)
    tecnico = _equipo(mesa["jorge"].usuario)
    ticket = tecnico.post(f"{TICKETS}tomar-siguiente/").json()
    respuesta = tecnico.post(
        f"{TICKETS}{ticket['id']}/horas/",
        {"fecha": "2026-10-16", "horas": "1.5", "descripcion": "Reinstalé el sistema"},
        format="json",
    )
    assert respuesta.status_code == 201
    registro = respuesta.json()["id"]
    assert (
        tecnico.post(
            f"/api/v1/soporte/horas/{registro}/revisar/", {"aprobar": True}, format="json"
        ).status_code
        == 403
    )
    revisado = _equipo(mesa["supervisor"]).post(
        f"/api/v1/soporte/horas/{registro}/revisar/", {"aprobar": True}, format="json"
    )
    assert revisado.json()["estado"] == "aprobado"
    with usando_empresa(mesa["empresa"]):
        assert HorasFueraDeHorario.objects.get(pk=registro).revisado_por == mesa["supervisor"]


# --- Aislamiento -----------------------------------------------------------------------


def test_cada_empresa_tiene_su_cola_y_su_equipo(mesa):
    with mock.patch.object(services, "repartir", return_value=0):
        _crear(mesa)
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    MembresiaEmpresa.objects.create(usuario=mesa["supervisor"], empresa=otra)
    cliente = _equipo(mesa["supervisor"])
    cliente.credentials(HTTP_X_EMPRESA=str(otra.id))
    assert cliente.get(TICKETS, {"ambito": "cola"}).json()["results"] == []
    # La otra empresa no configuró su mesa: Soporte TI lo dice.
    assert cliente.get(SOLICITAR).json()["disponible"] is False


# --- Configuración ---------------------------------------------------------------------


def test_quien_configura_da_de_alta_un_tecnico_con_su_horario(mesa):
    coordinador = _usuario("marco", "configurar", empresa=mesa["empresa"])
    nueva = _usuario("paola", "atender", empresa=mesa["empresa"])
    cliente = _equipo(coordinador)
    respuesta = cliente.post(
        "/api/v1/soporte/config/tecnicos/",
        {
            "usuario": nueva.id,
            "nivel": mesa["n1"].id,
            "categorias": [mesa["hardware"].id],
            "capacidad": 2,
            "horarios": [{"dia_semana": 0, "hora_inicio": "08:00", "hora_fin": "17:00"}],
            "ausencias": [{"desde": "2026-12-24", "hasta": "2026-12-26", "motivo": "Navidad"}],
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data
    assert len(respuesta.json()["horarios"]) == 1
    # Sin permiso de configurar, no.
    assert _equipo(nueva).get("/api/v1/soporte/config/tecnicos/").status_code == 403


def test_cada_tecnico_cambia_su_propio_horario(mesa):
    cliente = _equipo(mesa["jorge"].usuario)
    respuesta = cliente.put(
        "/api/v1/soporte/mi-horario/",
        {
            "horarios": [
                {"dia_semana": 1, "hora_inicio": "08:00", "hora_fin": "12:00"},
                {"dia_semana": 1, "hora_inicio": "14:00", "hora_fin": "18:00"},
            ],
            "ausencias": [],
        },
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    assert len(respuesta.json()["horarios"]) == 2
    malo = cliente.put(
        "/api/v1/soporte/mi-horario/",
        {
            "horarios": [{"dia_semana": 1, "hora_inicio": "12:00", "hora_fin": "08:00"}],
            "ausencias": [],
        },
        format="json",
    )
    assert malo.status_code == 400
