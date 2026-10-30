"""Las mejoras «antes de la Ola 1» del flujo ITIL de la empresa.

Lo que se protege: los dos plazos corren desde que se crea el ticket, en el
calendario de su prioridad (P1 las 24 h); escalar no regala tiempo y reabrir
conserva lo que quedaba; la prioridad sale de la matriz impacto × urgencia y
se ajusta con justificación; el equipo registra tickets en nombre de quien
pide, con su canal; la encuesta de satisfacción; el cierre a los días hábiles;
y los indicadores del piloto.
"""

import datetime
from datetime import time, timedelta
from io import StringIO
from unittest import mock

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.empresas.contexto import usando_empresa
from apps.notificaciones.models import Notificacion
from apps.soporte import services, sla
from apps.soporte.models import (
    CasoAyuda,
    ConfiguracionMesa,
    FeriadoMesa,
    HorarioMesa,
    ReglaSLA,
    Ticket,
)
from apps.soporte.tests.test_soporte import (
    SEGUIMIENTO,
    SOLICITAR,
    TICKETS,
    _crear,
    _equipo,
    _formulario,
    _quien_pide,
    _siempre,
    _ticket,
    _usuario,
)

ZONA = timezone.get_current_timezone


def _local(*partes):
    return timezone.make_aware(datetime.datetime(*partes), ZONA())


def _caso_critico(mesa):
    with usando_empresa(mesa["empresa"]):
        return CasoAyuda.objects.create(
            categoria=mesa["hardware"],
            codigo="TRK-01",
            nombre="Tracking caído",
            prioridad="critica",
        )


def _sin_reglas(mesa):
    with usando_empresa(mesa["empresa"]):
        ReglaSLA.objects.all().delete()


# --- Plazos de punta a punta ----------------------------------------------------------


def test_lead_time_desde_la_creacion_y_cycle_time_desde_que_se_toma(mesa):
    """Decidido el 19/10/2026: la respuesta se mide desde que se crea (lead
    time); la solución, desde que un técnico lo toma (cycle time)."""
    _sin_reglas(mesa)
    antes = timezone.now()
    with mock.patch.object(services, "repartir", return_value=0):
        ticket = _ticket(_crear(mesa, caso=_caso_critico(mesa).id)["id"], mesa)
    # P1: 15 min de respuesta y 4 h de solución, en horas calendario.
    assert (ticket.sla_respuesta_minutos, ticket.sla_minutos) == (15, 240)
    assert antes + timedelta(minutes=15) <= ticket.sla_respuesta_vence
    assert ticket.sla_respuesta_vence <= timezone.now() + timedelta(minutes=15)
    assert ticket.sla_vence is None  # en la cola, la solución todavía no corre
    assert ticket.tipo == "incidente" and ticket.prioridad_base == "critica"

    _siempre(mesa["jorge"])
    services.repartir()
    ticket.refresh_from_db()
    assert ticket.tomado_en is not None
    assert abs((ticket.sla_vence - ticket.tomado_en) - timedelta(hours=4)) < timedelta(seconds=5)


def test_p2_a_p4_se_miden_en_el_horario_habil_de_la_mesa(mesa):
    with usando_empresa(mesa["empresa"]):
        for dia in range(5):
            HorarioMesa.objects.create(dia_semana=dia, hora_inicio=time(8), hora_fin=time(17))
        FeriadoMesa.objects.create(
            desde=datetime.date(2026, 10, 19), hasta=datetime.date(2026, 10, 19)
        )
        ticket = Ticket(empresa=mesa["empresa"], prioridad="alta")
        agenda = sla.calendario(ticket)
    viernes = _local(2026, 10, 16, 16, 0)
    # 1 h el viernes; el lunes es feriado; 1 h el martes.
    assert timezone.localtime(agenda.sumar_minutos(viernes, 120)) == _local(2026, 10, 20, 9, 0)
    with usando_empresa(mesa["empresa"]):
        ConfiguracionMesa.objects.create(critica_24x7=False)
        ticket.prioridad = "critica"
        assert sla.calendario(ticket).sumar_minutos(viernes, 120) == agenda.sumar_minutos(
            viernes, 120
        )


def test_escalar_no_regala_tiempo(mesa):
    _siempre(mesa["jorge"])
    _siempre(mesa["experto"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    vence = ticket.sla_vence
    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/escalar/", {"motivo": "Falla de placa"}, format="json"
    )
    ticket.refresh_from_db()
    assert ticket.sla_vence == vence
    assert ticket.escalamientos == 1


def test_reabrir_conserva_lo_que_quedaba(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "atendido"}, format="json"
    )
    ticket.refresh_from_db()
    assert ticket.sla_cumplido is True
    quedaba = ticket.sla_restante_al_pausar
    assert quedaba and quedaba <= ticket.sla_minutos
    _quien_pide(mesa).post(f"{SEGUIMIENTO}{ticket.id}/", {"texto": "Sigue igual"}, format="json")
    ticket.refresh_from_db()
    assert ticket.estado == Ticket.Estado.EN_CURSO
    assert ticket.reaperturas == 1
    assert ticket.sla_restante_al_pausar is None
    assert ticket.sla_cumplido is None
    with usando_empresa(mesa["empresa"]):
        assert sla.restante(ticket, timezone.now()) <= quedaba


def test_la_primera_respuesta_y_su_vencimiento(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    assert ticket.respondido_en is None
    with usando_empresa(mesa["empresa"]):
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_respuesta_vence=timezone.now() - timedelta(minutes=1)
        )
    resumen = services.ciclo()
    assert resumen["sin_respuesta"] == 1
    avisados = set(
        Notificacion.objects.todas()
        .filter(tipo="soporte.respuesta_vencida")
        .values_list("usuario__username", flat=True)
    )
    assert avisados == {"diana", "jorge"}  # la supervisión y el técnico
    assert services.ciclo()["sin_respuesta"] == 0  # no se repite

    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/responder/", {"texto": "Voy en camino"}, format="json"
    )
    ticket.refresh_from_db()
    assert ticket.respondido_en is not None


# --- Prioridad ------------------------------------------------------------------------


def test_la_matriz_puede_subir_la_prioridad_del_caso():
    assert sla.prioridad_inicial("media", "alto", "alta") == "critica"
    assert sla.prioridad_inicial("critica", "bajo", "baja") == "critica"  # nunca la baja
    assert sla.prioridad_inicial("media", "", "") == "media"


def test_el_formulario_aplica_la_matriz(mesa):
    with mock.patch.object(services, "repartir", return_value=0):
        creado = _crear(mesa, impacto="alto", urgencia="alta")
    ticket = _ticket(creado["id"], mesa)
    assert (ticket.prioridad_base, ticket.prioridad) == ("alta", "critica")
    assert ticket.movimientos.filter(descripcion__contains="impacto y urgencia").exists()


def test_cambiar_la_prioridad_exige_justificacion_y_conserva_lo_consumido(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    cliente = _equipo(mesa["jorge"].usuario)
    url = f"{TICKETS}{ticket.id}/prioridad/"
    assert cliente.post(url, {"prioridad": "baja"}, format="json").status_code == 400
    respuesta = cliente.post(
        url,
        {"impacto": "alto", "urgencia": "alta", "justificacion": "Toda la bodega"},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    ticket.refresh_from_db()
    assert ticket.prioridad == "critica"
    assert (ticket.impacto, ticket.urgencia) == ("alto", "alta")
    movimiento = ticket.movimientos.last()
    assert "de P2 · Alta a P1 · Crítica" in movimiento.descripcion
    assert movimiento.nota == "Toda la bodega"
    # Quien no lo trabaja no la cambia.
    otro = _usuario("pedro", "atender", empresa=mesa["empresa"])
    assert _equipo(otro).post(
        url, {"prioridad": "baja", "justificacion": "x"}, format="json"
    ).status_code in (403, 404)


# --- Alta interna ---------------------------------------------------------------------


def test_el_equipo_registra_un_ticket_en_nombre_de_quien_llama(mesa):
    _siempre(mesa["jorge"])
    cliente = _equipo(mesa["jorge"].usuario)
    formulario = cliente.get(f"{TICKETS}formulario/").json()
    assert "portal" not in [c["id"] for c in formulario["canales"]]
    assert formulario["soy_tecnico"] is True
    # Solo se registran tickets de personas con cuenta: se elige de la lista.
    _quien_pide(mesa)  # Carla: registrada, con «Mis datos»
    personas = cliente.get(f"{TICKETS}personas/", {"q": "carla"}).json()
    carla = next(p for p in personas if p["correo"] == "carla@x.com")
    assert carla["agencia"]["nombre"] == "Loja · Agencia"
    datos = _formulario(mesa, canal="telefono", asignarme=True, solicitante=carla["id"])
    respuesta = cliente.post(f"{TICKETS}registrar/", datos, format="json")
    assert respuesta.status_code == 201, respuesta.data
    ticket = Ticket.objects.todas().get(pk=respuesta.json()["id"])
    assert ticket.canal == "telefono"
    assert ticket.solicitante_id == carla["id"]
    assert ticket.solicitante_telefono == "099 418 2273"  # de «Mis datos»
    assert ticket.registrado_por == mesa["jorge"].usuario
    assert ticket.tecnico_id == mesa["jorge"].id  # se lo quedó
    # Sin ser del equipo, no.
    ajeno = _usuario("lucia", "reportes", empresa=mesa["empresa"])
    assert _equipo(ajeno).post(f"{TICKETS}registrar/", datos, format="json").status_code == 403


# --- Encuesta y cierre ----------------------------------------------------------------


def test_la_encuesta_se_ofrece_una_vez_y_con_el_ticket_cerrado(mesa):
    """Decidido el 30/10/2026: con el ticket atendido la encuesta competía con
    «¿Quedó resuelto?»; se ofrece al cerrarse."""
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    url = f"{SEGUIMIENTO}{ticket.id}/encuesta/"
    voto = {"calificacion": 5, "resuelto": True, "comentario": "Rápido"}
    assert _quien_pide(mesa).post(url, voto, format="json").status_code == 400  # aún no
    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "atendido"}, format="json"
    )
    ficha = _quien_pide(mesa).get(f"{SEGUIMIENTO}{ticket.id}/").json()
    assert ficha["puede_encuestar"] is False
    assert ficha["puede_confirmar"] is True
    assert ficha["estado_display"] == "Resuelto: falta su confirmación"
    assert ficha["cierre_automatico"]  # la fecha en que se cierra solo
    _quien_pide(mesa).post(f"{SEGUIMIENTO}{ticket.id}/", {"confirmar": "true"}, format="json")
    assert _quien_pide(mesa).get(f"{SEGUIMIENTO}{ticket.id}/").json()["puede_encuestar"] is True
    respuesta = _quien_pide(mesa).post(url, voto, format="json")
    assert respuesta.status_code == 201
    assert respuesta.json()["encuesta"]["calificacion"] == 5
    assert _quien_pide(mesa).post(url, voto, format="json").status_code == 400


def test_el_cierre_automatico_cuenta_dias_habiles(mesa, settings):
    settings.SOPORTE_DIAS_CIERRE_AUTOMATICO = 3
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "atendido"}, format="json"
    )
    with usando_empresa(mesa["empresa"]):
        Ticket.objects.filter(pk=ticket.pk).update(atendido_en=_local(2026, 10, 16, 10, 0))
    services.ciclo(ahora=_local(2026, 10, 20, 10, 0))  # viernes → martes: 2 días hábiles
    ticket.refresh_from_db()
    assert ticket.estado == Ticket.Estado.ATENDIDO
    services.ciclo(ahora=_local(2026, 10, 21, 10, 0))  # miércoles: 3
    ticket.refresh_from_db()
    assert ticket.estado == Ticket.Estado.CERRADO


# --- Indicadores y configuración ------------------------------------------------------


def test_los_indicadores_del_piloto(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "atendido"}, format="json"
    )
    _quien_pide(mesa).post(
        f"{SEGUIMIENTO}{ticket.id}/encuesta/",
        {"calificacion": 4, "resuelto": True},
        format="json",
    )
    datos = _equipo(mesa["supervisor"]).get("/api/v1/soporte/reportes/").json()
    kpis = datos["kpis"]
    assert kpis["fcr"] == 100.0
    assert kpis["reabiertos"] == 0.0
    assert kpis["csat"] == 4.0
    assert kpis["canal_oficial"] == 100.0
    assert kpis["meta_sla"] == 85
    p1 = next(p for p in datos["prioridades"] if p["prioridad"] == "critica")
    assert p1["meta"] == 95
    assert {g["clave"] for g in datos["graficos"]} >= {"canal", "tipo"}


def test_los_vencidos_sin_atender_cuentan_como_incumplidos(mesa):
    """Auditoría UX/UI (30/10/2026): el reporte daba 100 % de cumplimiento
    con un P1 sin respuesta desde hacía días, porque lo abierto no contaba."""
    _sin_reglas(mesa)
    with mock.patch.object(services, "repartir", return_value=0):
        ticket = _ticket(_crear(mesa, caso=_caso_critico(mesa).id)["id"], mesa)
    cliente = _equipo(mesa["supervisor"])

    # En plazo: todavía no cuenta ni a favor ni en contra.
    kpis = cliente.get("/api/v1/soporte/reportes/").json()["kpis"]
    assert kpis["cumplimiento_respuesta"] is None
    assert kpis["respuestas_vencidas"] == 0

    # Pasada la hora de respuesta, sin que nadie responda: incumplido.
    Ticket.objects.filter(pk=ticket.pk).update(
        sla_respuesta_vence=timezone.now() - timedelta(minutes=1)
    )
    datos = cliente.get("/api/v1/soporte/reportes/").json()
    assert datos["kpis"]["cumplimiento_respuesta"] == 0.0
    assert datos["kpis"]["medidos_respuesta"] == 1
    assert datos["kpis"]["respuestas_vencidas"] == 1
    p1 = next(p for p in datos["prioridades"] if p["prioridad"] == "critica")
    assert (p1["plazo_respuesta"], p1["plazo_solucion"]) == (15, 240)


def test_la_bandeja_ordena_por_lo_que_vence_y_filtra_los_vencidos(mesa):
    """Auditoría UX/UI (30/10/2026): la bandeja no mostraba lo vencido."""
    with mock.patch.object(services, "repartir", return_value=0):
        primero = _ticket(_crear(mesa)["id"], mesa)
        segundo = _ticket(_crear(mesa)["id"], mesa)
    ahora = timezone.now()
    Ticket.objects.filter(pk=primero.pk).update(sla_respuesta_vence=ahora + timedelta(hours=2))
    Ticket.objects.filter(pk=segundo.pk).update(sla_respuesta_vence=ahora - timedelta(days=9))
    cliente = _equipo(mesa["supervisor"])
    lista = cliente.get(TICKETS, {"ambito": "todos"}).json()["results"]
    assert [t["id"] for t in lista][:2] == [segundo.id, primero.id]
    vencidos = cliente.get(TICKETS, {"ambito": "todos", "vencidos": "true"}).json()
    assert [t["id"] for t in vencidos["results"]] == [segundo.id]


def test_el_tecnico_toma_el_ticket_que_esta_mirando(mesa):
    """Auditoría UX/UI (30/10/2026): solo había «Tomar siguiente»."""
    with mock.patch.object(services, "repartir", return_value=0):
        ticket = _ticket(_crear(mesa)["id"], mesa)
    # Otro nivel: no lo puede tomar, y su ficha no se lo ofrece.
    experto = _equipo(mesa["experto"].usuario)
    assert experto.post(f"{TICKETS}{ticket.id}/tomar/").status_code in (403, 404)
    # Quien coordina lo ve y sabe por qué no puede tomarlo.
    permisos = _equipo(mesa["supervisor"]).get(f"{TICKETS}{ticket.id}/").json()["permisos"]
    assert permisos["tomar"] is False
    assert "no es técnico" in permisos["motivo_no_tomar"]

    jorge = _equipo(mesa["jorge"].usuario)
    assert jorge.get(f"{TICKETS}{ticket.id}/").json()["permisos"]["tomar"] is True
    respuesta = jorge.post(f"{TICKETS}{ticket.id}/tomar/")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["estado"] == "asignado"
    assert respuesta.json()["permisos"]["tomar"] is False
    ticket.refresh_from_db()
    assert ticket.tecnico == mesa["jorge"]


def test_quien_pide_ve_sus_plazos_y_puede_responder_solo_con_una_captura(mesa):
    """Auditoría UX/UI (30/10/2026): no sabía cuándo lo iban a atender, y no
    podía mandar solo una captura."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    with mock.patch.object(services, "repartir", return_value=0):
        ticket = _ticket(_crear(mesa)["id"], mesa)
    cliente = _quien_pide(mesa)
    ficha = cliente.get(f"{SEGUIMIENTO}{ticket.id}/").json()
    assert ficha["plazos"]["respuesta"] is not None
    assert ficha["plazos"]["respondido"] is False
    assert ficha["prioridad"] == ticket.prioridad
    lista = cliente.get(SEGUIMIENTO).json()
    assert lista[0]["prioridad_display"]

    captura = SimpleUploadedFile(
        "captura.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, content_type="image/png"
    )
    respuesta = cliente.post(
        f"{SEGUIMIENTO}{ticket.id}/", {"texto": "", "adjuntos": [captura]}, format="multipart"
    )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["mensajes"][-1]["texto"] == "(Adjuntó archivos)"
    # Sin texto y sin archivos, sigue pidiendo el mensaje.
    vacio = cliente.post(f"{SEGUIMIENTO}{ticket.id}/", {"texto": ""}, format="multipart")
    assert vacio.status_code == 400


def test_quien_coordina_ve_las_categorias_sin_tecnicos(mesa):
    datos = _equipo(mesa["supervisor"]).get(f"{TICKETS}bandeja/").json()
    # «Accesos» no tiene técnicos; «Hardware», sí.
    assert datos["categorias_sin_tecnicos"] == ["Accesos"]
    # El técnico no la ve: no es quien lo resuelve.
    tecnico = _equipo(mesa["jorge"].usuario).get(f"{TICKETS}bandeja/").json()
    assert tecnico["categorias_sin_tecnicos"] == []


def test_el_nivel_no_repite_su_codigo(mesa):
    assert str(mesa["n1"]) == "N1 · Mesa de ayuda"
    mesa["n1"].nombre = "N1 · Mesa de ayuda"
    assert str(mesa["n1"]) == "N1 · Mesa de ayuda"


def test_quien_configura_define_el_horario_las_metas_y_los_feriados(mesa):
    cliente = _equipo(_usuario("marco", "configurar", empresa=mesa["empresa"]))
    inicial = cliente.get("/api/v1/soporte/config/mesa/").json()
    assert inicial["horario_por_defecto"] is True
    respuesta = cliente.put(
        "/api/v1/soporte/config/mesa/",
        {
            "meta_sla": 90,
            "meta_sla_critica": 98,
            "critica_24x7": False,
            "horarios": [{"dia_semana": 0, "hora_inicio": "08:00", "hora_fin": "17:30"}],
            "feriados": [{"desde": "2026-11-02", "hasta": "2026-11-03", "motivo": "Difuntos"}],
        },
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    datos = respuesta.json()
    assert (datos["meta_sla"], datos["critica_24x7"], datos["horario_por_defecto"]) == (
        90,
        False,
        False,
    )
    assert len(datos["feriados"]) == 1
    assert _equipo(mesa["jorge"].usuario).get("/api/v1/soporte/config/mesa/").status_code == 403


def test_el_catalogo_de_servicios_se_carga_y_se_puede_repetir(mesa):
    salida = StringIO()
    call_command("cargar_catalogo_ti", "--empresa", "LC", stdout=salida)
    assert "29 servicio(s) nuevo(s)" in salida.getvalue()
    with usando_empresa(mesa["empresa"]):
        trk = CasoAyuda.objects.get(codigo="TRK-01")
        assert (trk.tipo, trk.prioridad, trk.nivel_inicial) == ("incidente", "critica", mesa["n2"])
        assert CasoAyuda.objects.get(codigo="ACC-01").minutos_plazo == 120
    call_command("cargar_catalogo_ti", "--empresa", "LC", stdout=salida)
    assert "0 servicio(s) nuevo(s), 29 actualizado(s)" in salida.getvalue()


def test_soporte_ti_ofrece_la_matriz(mesa):
    datos = _quien_pide(mesa).get(SOLICITAR).json()
    claves = [c["clave"] for c in datos["campos"]]
    assert claves[-2:] == ["impacto", "urgencia"]
    assert [i["id"] for i in datos["impactos"]] == ["bajo", "medio", "alto"]


@pytest.mark.parametrize("estado", ["esperando_usuario"])
def test_esperar_al_usuario_no_cuenta_como_falta_de_respuesta(mesa, estado):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/cambiar-estado/",
        {"estado": estado, "nota": "¿Serie?"},
        format="json",
    )
    ticket.refresh_from_db()
    assert ticket.respondido_en is not None


# --- Decisiones del 19/10/2026: aprobaciones, dominios y nombres ----------------------


def _jefe_de(area, usuario, empresa):
    from apps.organizacion.models import Empleado

    with usando_empresa(empresa):
        empleado = Empleado.objects.create(
            nombres="Rosa",
            apellidos="Vera",
            codigo_empleado=f"EMP-{usuario.pk}",
            departamento=area,
            usuario=usuario,
        )
        area.responsable = empleado
        area.save()


def _caso_con_aprobacion(mesa, **extra):
    with usando_empresa(mesa["empresa"]):
        caso = CasoAyuda.objects.create(
            categoria=mesa["hardware"],
            codigo="ACC-02",
            nombre="Acceso a VPN",
            tipo="solicitud",
            prioridad="media",
            aprueba_jefe_area=True,
            **extra,
        )
    return caso


def test_una_solicitud_con_aprobacion_espera_el_visto_bueno_del_jefe(mesa):
    _siempre(mesa["jorge"])
    jefa = _usuario("rosa", empresa=mesa["empresa"])
    _jefe_de(mesa["area"], jefa, mesa["empresa"])
    caso = _caso_con_aprobacion(mesa)
    creado = _crear(mesa, caso=caso.id)
    ticket = _ticket(creado["id"], mesa)
    assert ticket.estado == "esperando_aprobacion"
    assert ticket.tecnico_id is None  # no entró a la cola
    assert ticket.sla_respuesta_vence is None  # ningún plazo corre todavía
    # La jefa recibe el aviso en la campana (y por correo), con el enlace al sistema.
    aviso = Notificacion.objects.todas().get(usuario=jefa, tipo="soporte.aprobacion_pendiente")
    assert aviso.enlace == "/admin/aprobaciones"
    seguimiento = _quien_pide(mesa).get(f"{SEGUIMIENTO}{ticket.id}/").json()
    assert seguimiento["aprobaciones"][0]["rol"] == "Jefe de área (Cobranzas)"

    # Sin permisos de la mesa, la jefa ve lo suyo y lo aprueba.
    cliente = _equipo(jefa)
    pendientes = cliente.get("/api/v1/soporte/aprobaciones/").json()
    assert [p["ticket"]["numero"] for p in pendientes] == [ticket.numero]
    otro = _equipo(_usuario("tito", empresa=mesa["empresa"]))
    url = f"/api/v1/soporte/aprobaciones/{pendientes[0]['id']}/decidir/"
    assert otro.post(url, {"aprobar": True}, format="json").status_code == 403
    assert cliente.post(url, {"aprobar": True}, format="json").status_code == 200
    ticket.refresh_from_db()
    assert ticket.estado in ("nuevo", "asignado")  # entró a la cola y se repartió
    assert ticket.sla_respuesta_vence is not None
    assert cliente.post(url, {"aprobar": True}, format="json").status_code == 400


def test_un_rechazo_cierra_la_solicitud_y_avisa_con_el_motivo(mesa):
    from django.core import mail

    jefa = _usuario("rosa", empresa=mesa["empresa"])
    _jefe_de(mesa["area"], jefa, mesa["empresa"])
    ticket = _ticket(_crear(mesa, caso=_caso_con_aprobacion(mesa).id)["id"], mesa)
    aprobacion = ticket.aprobaciones.get()
    url = f"/api/v1/soporte/aprobaciones/{aprobacion.id}/decidir/"
    cliente = _equipo(jefa)
    assert cliente.post(url, {"aprobar": False}, format="json").status_code == 400  # sin motivo
    mail.outbox.clear()
    cliente.post(url, {"aprobar": False, "nota": "No corresponde"}, format="json")
    ticket.refresh_from_db()
    assert ticket.estado == "cerrado"
    assert "no fue aprobada" in mail.outbox[-1].subject
    assert mail.outbox[-1].bcc == ["carla@x.com"]


def test_sin_jefe_con_cuenta_decide_quien_coordina(mesa):
    ticket = _ticket(_crear(mesa, caso=_caso_con_aprobacion(mesa).id)["id"], mesa)
    aprobacion = ticket.aprobaciones.get()
    assert aprobacion.aprobador is None
    coordinadora = _equipo(mesa["supervisor"])  # tiene «asignar»
    assert [p["id"] for p in coordinadora.get("/api/v1/soporte/aprobaciones/").json()] == [
        aprobacion.id
    ]
    url = f"/api/v1/soporte/aprobaciones/{aprobacion.id}/decidir/"
    assert coordinadora.post(url, {"aprobar": True}, format="json").status_code == 200


def test_los_nombres_de_estados_y_prioridades_son_de_la_empresa(mesa):
    cliente = _equipo(_usuario("marco", "configurar", empresa=mesa["empresa"]))
    mesa_actual = cliente.get("/api/v1/soporte/config/mesa/").json()
    respuesta = cliente.put(
        "/api/v1/soporte/config/mesa/",
        {
            **{k: mesa_actual[k] for k in ("meta_sla", "meta_sla_critica", "critica_24x7")},
            "horarios": [],
            "feriados": [],
            "etiquetas": {
                "estados": {"atendido": "Resuelto", "inventado": "X"},
                "prioridades": {"alta": "P2", "media": "  "},
            },
        },
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    datos = respuesta.json()
    assert datos["etiquetas"] == {
        "estados": {"atendido": "Resuelto"},
        "prioridades": {"alta": "P2"},
    }

    _siempre(mesa["jorge"])
    with mock.patch.object(services, "repartir", return_value=0):
        ticket = _ticket(_crear(mesa)["id"], mesa)
    seguimiento = _quien_pide(mesa).get(f"{SEGUIMIENTO}{ticket.id}/").json()
    assert seguimiento["prioridad_display"] == "P2"
    nombres = _equipo(mesa["jorge"].usuario).get("/api/v1/soporte/etiquetas/").json()
    assert ["atendido", "Resuelto"] in nombres["estados"]
    assert ["media", "P3 · Media"] in nombres["prioridades"]


def test_registrar_en_nombre_de_otro_es_un_permiso_aparte(mesa):
    """Atender no basta para el alta interna: hace falta `soporte.registrar`. Y
    quien solo registra entra a la mesa sin ver tickets ajenos."""
    solo_atiende = _equipo(_usuario("ana", "atender", empresa=mesa["empresa"]))
    assert solo_atiende.get(f"{TICKETS}personas/").status_code == 403
    assert solo_atiende.post(f"{TICKETS}registrar/", {}, format="json").status_code == 403

    _crear(mesa)
    recepcion = _equipo(_usuario("rita", "registrar", empresa=mesa["empresa"]))
    assert recepcion.get(f"{TICKETS}personas/").status_code == 200
    bandeja = recepcion.get(TICKETS).json()
    assert (bandeja.get("results", bandeja)) == []


# --- Chat del ticket (30/10/2026) -----------------------------------------------------


def test_el_chat_del_ticket_se_abre_al_tomarlo_y_no_toca_los_plazos(mesa):
    """El técnico a cargo y quien reportó conversan dentro del ticket: queda
    guardado, avisa en la campana y no cambia el estado ni el plazo."""
    with mock.patch.object(services, "repartir", return_value=0):
        ticket = _ticket(_crear(mesa)["id"], mesa)
    jorge = _equipo(mesa["jorge"].usuario)
    quien_pide = _quien_pide(mesa)
    chat_equipo = f"{TICKETS}{ticket.id}/chat/"
    chat_suyo = f"{SEGUIMIENTO}{ticket.id}/chat/"

    # En la cola, nadie lo tiene: cerrado.
    assert quien_pide.get(chat_suyo).json()["abierto"] is False
    assert quien_pide.post(chat_suyo, {"texto": "Hola"}, format="json").status_code == 400

    jorge.post(f"{TICKETS}{ticket.id}/tomar/")
    ticket.refresh_from_db()
    respuesta_vence, estado = ticket.sla_respuesta_vence, ticket.estado
    datos = jorge.post(chat_equipo, {"texto": "¿Qué modelo es?"}, format="json").json()
    assert datos["mensajes"][0]["texto"] == "¿Qué modelo es?"
    assert datos["mensajes"][0]["mio"] is True

    datos = quien_pide.post(chat_suyo, {"texto": "Un HP 240"}, format="json").json()
    assert [m["del_solicitante"] for m in datos["mensajes"]] == [False, True]
    assert datos["tecnico"]

    # No es una respuesta del ticket: ni estado, ni plazo, ni primera respuesta.
    ticket.refresh_from_db()
    assert ticket.estado == estado
    assert ticket.sla_respuesta_vence == respuesta_vence
    assert ticket.respondido_en is None
    assert ticket.mensajes.count() == 0

    # Avisa en la campana a quien le toca leerlo.
    assert (
        Notificacion.objects.todas()
        .filter(usuario=mesa["jorge"].usuario, tipo="soporte.chat")
        .exists()
    )

    # Otro técnico no lo lee; quien coordina sí (auditoría), pero no escribe.
    assert _equipo(mesa["experto"].usuario).get(chat_equipo).status_code in (403, 404)
    supervisor = _equipo(mesa["supervisor"])
    assert len(supervisor.get(chat_equipo).json()["mensajes"]) == 2
    assert supervisor.post(chat_equipo, {"texto": "x"}, format="json").status_code == 403


def test_el_chat_se_cierra_con_el_ticket_y_queda_para_auditoria(mesa):
    _siempre(mesa["jorge"])
    with mock.patch.object(services, "repartir", return_value=0):
        ticket = _ticket(_crear(mesa)["id"], mesa)
    jorge = _equipo(mesa["jorge"].usuario)
    jorge.post(f"{TICKETS}{ticket.id}/tomar/")
    jorge.post(f"{TICKETS}{ticket.id}/chat/", {"texto": "Listo"}, format="json")
    jorge.post(f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "atendido"}, format="json")
    # Resuelto: quien reportó no reclama por el chat (no reabriría): se le
    # indica «Responder».
    chat_suyo = f"{SEGUIMIENTO}{ticket.id}/chat/"
    resuelto = _quien_pide(mesa).get(chat_suyo).json()
    assert resuelto["puede_escribir"] is False
    assert "No, sigue el problema" in resuelto["motivo"]
    assert _quien_pide(mesa).post(chat_suyo, {"texto": "Sigue"}, format="json").status_code == 400
    assert _quien_pide(mesa).get(f"{SEGUIMIENTO}{ticket.id}/").json()["chat"]["mensajes"] == 1
    jorge.post(f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": "cerrado"}, format="json")
    datos = _quien_pide(mesa).get(f"{SEGUIMIENTO}{ticket.id}/chat/").json()
    assert datos["abierto"] is False
    assert [m["texto"] for m in datos["mensajes"]] == ["Listo"]
