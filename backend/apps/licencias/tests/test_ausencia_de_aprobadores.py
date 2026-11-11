"""Solicitud de permisos con aprobadores ausentes (11/11/2026, US-001).

Lo que se protege:

- Una solicitud nueva que le tocaría a alguien ausente pasa a su reemplazo,
  que recibe la campana; el historial dice «Escalada a X por ausencia de Y»
  (CA-4). Se respetan las exclusiones de `escalar` (CA-6).
- Lo pendiente de quien empieza su ausencia pasa al reemplazo, una sola vez,
  también al aprobarse un permiso suyo de día completo que cubre hoy (CA-5).
- La lista y el detalle dicen junto a cada aprobador pendiente si está
  ausente, sin el tipo de permiso, calculado en lote (CA-7, CA-8).
"""

import datetime
import json

import pytest
from django.utils import timezone

from apps.ausencias.models import LeaveRecord
from apps.chat.models import EstadoChat
from apps.licencias import services
from apps.licencias.models import AccionSolicitud, SolicitudPermiso
from apps.licencias.tests.test_licencias import (  # noqa: F401 (fixture)
    SOLICITUDES,
    _avisados,
    _pedir,
    empresa_con_organigrama,
)
from apps.organizacion.models import DatosDeContacto

UN_DIA = datetime.timedelta(days=1)


@pytest.fixture
def e(empresa_con_organigrama):  # noqa: F811 (el fixture importado)
    """Gerardo (Gerente General) > Julia (Jefa de Cobranzas) > Ana (Analista);
    Tatiana (Talento Humano) e Inés (administra los flujos)."""
    return empresa_con_organigrama


def _fuera(usuario):
    EstadoChat.objects.update_or_create(
        usuario=usuario,
        defaults={
            "estado": EstadoChat.Estado.FUERA_OFICINA,
            "hasta": timezone.now() + 2 * UN_DIA,
        },
    )


def _de_permiso(usuario, tipo=LeaveRecord.Type.MEDICO):
    LeaveRecord.objects.create(
        user=usuario,
        type=tipo,
        date=timezone.localdate(),
        is_full_day=True,
        observation="Reposo por cirugía",
        created_by=usuario,
    )


def _escaladas(solicitud_id):
    return list(
        AccionSolicitud.objects.filter(
            solicitud_id=solicitud_id, accion=AccionSolicitud.Accion.ESCALADA
        ).values_list("comentario", flat=True)
    )


def test_una_solicitud_nueva_pasa_al_reemplazo_de_la_jefa_ausente(e):
    _, ana = e["ana"]
    _fuera(e["jefa"][0])
    solicitud = _pedir(ana, e["vacaciones"])
    assert [p["nombre"] for p in solicitud["pendiente_de"]] == ["Gerardo"]
    # El reemplazo recibe la campana de siempre; la jefa ausente, no.
    assert _avisados("licencias.por_aprobar", solicitud["id"]) == {"gerardo"}
    assert _escaladas(solicitud["id"]) == ["Escalada a Gerardo por ausencia de Julia"]
    detalle = ana.get(f"{SOLICITUDES}{solicitud['id']}/").json()
    escalada = next(a for a in detalle["acciones"] if a["accion"] == "escalada")
    assert escalada["comentario"] == "Escalada a Gerardo por ausencia de Julia"
    # Gerardo decide y la solicitud sigue su curso.
    _, gerente = e["gerente"]
    siguiente = gerente.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").json()
    assert siguiente["paso_actual"] == "Talento Humano"


def test_el_reemplazo_nunca_es_quien_pidio(e):
    ana, cliente_ana = e["ana"]
    julia = e["jefa"][0]
    # Julia eligió a Ana como reemplazo, pero Ana es quien pide.
    DatosDeContacto.objects.filter(usuario=julia).update(reemplazo_modo="persona", reemplazo=ana)
    _fuera(julia)
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    # No queda nadie válido en la cadena: se queda con Julia, como hoy.
    assert [p["nombre"] for p in solicitud["pendiente_de"]] == ["Julia"]
    assert _escaladas(solicitud["id"]) == []


def test_quien_ya_aprobo_un_paso_no_es_reemplazo_del_siguiente(e):
    _, cliente_ana = e["ana"]
    julia, cliente_julia = e["jefa"]
    tatiana = e["th"][0]
    # Tatiana (paso 2) eligió a Julia, que ya aprobó el paso 1.
    DatosDeContacto.objects.update_or_create(
        usuario=tatiana, defaults={"reemplazo_modo": "persona", "reemplazo": julia}
    )
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    _fuera(tatiana)
    paso2 = cliente_julia.post(f"{SOLICITUDES}{solicitud['id']}/aprobar/").json()
    # Julia se salta y la cadena sigue por ella: su jefe, Gerardo.
    assert [p["nombre"] for p in paso2["pendiente_de"]] == ["Gerardo"]
    assert _escaladas(solicitud["id"]) == ["Escalada a Gerardo por ausencia de Tatiana"]


def test_lo_pendiente_pasa_al_reemplazo_al_marcar_la_ausencia_y_una_sola_vez(e):
    _, cliente_ana = e["ana"]
    julia = e["jefa"][0]
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    _de_permiso(julia)
    from apps.organizacion import ausencia

    assert ausencia.reasignar_pendientes(julia) == 1
    assert ausencia.reasignar_pendientes(julia) == 0
    fila = SolicitudPermiso.objects.get(pk=solicitud["id"])
    assert [u.username for u in fila.pendiente_de.all()] == ["gerardo"]
    assert _escaladas(solicitud["id"]) == ["Escalada a Gerardo por ausencia de Julia"]
    assert _avisados("licencias.por_aprobar", solicitud["id"]) == {"julia", "gerardo"}


def test_al_aprobarse_un_permiso_que_cubre_hoy_pasa_lo_pendiente(
    e, monkeypatch, django_capture_on_commit_callbacks
):
    hoy = timezone.localdate()
    # Hoy cuenta aunque las pruebas corran en fin de semana o feriado.
    monkeypatch.setattr(
        "apps.ausencias.services.days_for_request", lambda flujo, desde, hasta, **k: [hoy]
    )
    _, cliente_ana = e["ana"]
    julia, cliente_julia = e["jefa"]
    _, cliente_th = e["th"]
    de_ana = _pedir(cliente_ana, e["vacaciones"])
    # Julia pide sus vacaciones desde hoy: las aprueban Gerardo y Talento Humano.
    propia = _pedir(cliente_julia, e["vacaciones"], desde=hoy.isoformat(), hasta=hoy.isoformat())
    _, cliente_gerente = e["gerente"]
    cliente_gerente.post(f"{SOLICITUDES}{propia['id']}/aprobar/")
    with django_capture_on_commit_callbacks(execute=True):
        final = cliente_th.post(f"{SOLICITUDES}{propia['id']}/aprobar/").json()
    assert final["estado"] == "aprobada"
    fila = SolicitudPermiso.objects.get(pk=de_ana["id"])
    assert [u.username for u in fila.pendiente_de.all()] == ["gerardo"]
    assert _escaladas(de_ana["id"]) == ["Escalada a Gerardo por ausencia de Julia"]


def test_la_lista_dice_que_el_aprobador_esta_ausente_sin_el_tipo(e, django_assert_max_num_queries):
    _, cliente_ana = e["ana"]
    julia = e["jefa"][0]
    primera = _pedir(cliente_ana, e["vacaciones"])
    _pedir(cliente_ana, e["vacaciones"], desde="2026-12-01", hasta="2026-12-02")
    # Ausente después de asignada, y sin que haya corrido la revisión.
    _de_permiso(julia, tipo=LeaveRecord.Type.MEDICO)
    lista = cliente_ana.get(SOLICITUDES, {"mias": "1"}).json()
    filas = lista["results"] if isinstance(lista, dict) else lista
    assert len(filas) == 2
    for fila in filas:
        [aprobadora] = fila["pendiente_de"]
        assert aprobadora["nombre"] == "Julia"
        assert aprobadora["ausencia"]["clave"] == "fuera_oficina"
        assert aprobadora["ausencia"]["texto"].startswith("Fuera de la oficina hasta el ")
        assert aprobadora["ausencia"]["reemplazo"] == {
            "id": e["gerente"][0].pk,
            "nombre": "Gerardo",
        }
    texto = json.dumps(lista, ensure_ascii=False)
    assert "MEDICO" not in texto and "cirugía" not in texto
    detalle = cliente_ana.get(f"{SOLICITUDES}{primera['id']}/").json()
    assert detalle["pendiente_de"][0]["ausencia"]["clave"] == "fuera_oficina"

    # En lote: el número de consultas no crece con las filas.
    with django_assert_max_num_queries(40) as consultas:
        cliente_ana.get(SOLICITUDES, {"mias": "1"})
    con_dos = len(consultas.captured_queries)
    _pedir(cliente_ana, e["vacaciones"], desde="2026-12-10", hasta="2026-12-11")
    _pedir(cliente_ana, e["vacaciones"], desde="2026-12-14", hasta="2026-12-15")
    with django_assert_max_num_queries(con_dos):
        cliente_ana.get(SOLICITUDES, {"mias": "1"})


def test_sin_ausencias_el_campo_es_nulo(e):
    _, cliente_ana = e["ana"]
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    assert solicitud["pendiente_de"][0]["ausencia"] is None


def test_reasignar_no_toca_las_solicitudes_cerradas(e):
    _, cliente_ana = e["ana"]
    julia, cliente_julia = e["jefa"]
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    cliente_julia.post(f"{SOLICITUDES}{solicitud['id']}/rechazar/", {"comentario": "Cierre"})
    _fuera(julia)
    assert services.reasignar_por_ausencia(julia) == 0


# --- Ronda 1 de correcciones (QA, 11/11/2026) ----------------------------------------------


def test_el_reemplazo_mostrado_nunca_es_quien_pidio(e):
    ana, cliente_ana = e["ana"]
    julia = e["jefa"][0]
    DatosDeContacto.objects.filter(usuario=julia).update(reemplazo_modo="persona", reemplazo=ana)
    solicitud = _pedir(cliente_ana, e["vacaciones"])
    _de_permiso(julia)
    [aprobadora] = cliente_ana.get(SOLICITUDES).json()[0]["pendiente_de"]
    assert aprobadora["id"] == julia.pk and solicitud["id"]
    # Ana no puede aprobar lo suyo y la cadena desde ella vuelve a Julia: nadie.
    assert aprobadora["ausencia"]["clave"] == "fuera_oficina"
    assert aprobadora["ausencia"]["reemplazo"] is None


def test_un_sabado_dentro_de_unas_vacaciones_aprobadas_tambien_esta_ausente(e):
    from apps.organizacion import ausencia

    julia = e["jefa"][0]
    lunes, viernes = datetime.date(2026, 11, 16), datetime.date(2026, 11, 27)
    sabado = datetime.date(2026, 11, 21)
    solicitud = SolicitudPermiso.objects.create(
        flujo_id=e["vacaciones"],
        solicitante=julia,
        desde=lunes,
        hasta=viernes,
        estado=SolicitudPermiso.Estado.APROBADA,
    )
    # La clasificación se copia del tipo al guardar: aquí, un tipo de vacaciones.
    SolicitudPermiso.objects.filter(pk=solicitud.pk).update(tipo_ausencia="VACACIONES")
    # Solo los días laborables tienen registro, como los crea la aprobación.
    for dia in (lunes + i * UN_DIA for i in range(12)):
        if dia.weekday() < 5:
            LeaveRecord.objects.create(
                user=julia,
                type=LeaveRecord.Type.VACACIONES,
                date=dia,
                is_full_day=True,
                created_by=julia,
                solicitud=solicitud,
            )
    datos = ausencia.ausencias_de([julia], fecha=sabado)[julia.pk]
    assert datos["clave"] == "vacaciones" and datos["hasta"] == viernes
    assert datos["reemplazo"] == {"id": e["gerente"][0].pk, "nombre": "Gerardo"}


def test_una_solicitud_nueva_va_al_reemplazo_aunque_hoy_no_tenga_registro(e):
    """Hoy cae dentro de unas vacaciones aprobadas pero sin `LeaveRecord`
    (como un sábado o un feriado): igual cuenta como ausente."""
    julia = e["jefa"][0]
    hoy = timezone.localdate()
    SolicitudPermiso.objects.create(
        flujo_id=e["vacaciones"],
        solicitante=julia,
        desde=hoy - UN_DIA,
        hasta=hoy + 5 * UN_DIA,
        estado=SolicitudPermiso.Estado.APROBADA,
    )
    _, cliente_ana = e["ana"]
    nueva = _pedir(cliente_ana, e["vacaciones"])
    assert [p["nombre"] for p in nueva["pendiente_de"]] == ["Gerardo"]
    assert _escaladas(nueva["id"]) == ["Escalada a Gerardo por ausencia de Julia"]


def test_aprobar_un_permiso_por_horas_no_reasigna(e, django_capture_on_commit_callbacks):
    from apps.licencias.tests.test_ausencias_generadas import _clasificar

    hoy = timezone.localdate().isoformat()
    _clasificar(e, "medico", unidad="horas")
    _, cliente_ana = e["ana"]
    _, cliente_julia = e["jefa"]
    _, cliente_th = e["th"]
    de_ana = _pedir(cliente_ana, e["vacaciones"])
    propia = _pedir(
        cliente_julia,
        e["medico"],
        desde=hoy,
        hasta=hoy,
        hora_desde="09:00",
        hora_hasta="11:00",
        motivo="Trámite",
    )
    with django_capture_on_commit_callbacks(execute=True):
        final = cliente_th.post(f"{SOLICITUDES}{propia['id']}/aprobar/").json()
    assert final["estado"] == "aprobada"
    fila = SolicitudPermiso.objects.get(pk=de_ana["id"])
    assert [u.username for u in fila.pendiente_de.all()] == ["julia"]
    assert _escaladas(de_ana["id"]) == []


def test_si_la_reasignacion_falla_la_aprobacion_igual_responde(
    e, monkeypatch, django_capture_on_commit_callbacks
):
    hoy = timezone.localdate()
    monkeypatch.setattr(
        "apps.ausencias.services.days_for_request", lambda flujo, desde, hasta, **k: [hoy]
    )

    def falla(*args, **kwargs):
        raise RuntimeError("base caída")

    monkeypatch.setattr("apps.organizacion.ausencia.reasignar_pendientes", falla)
    _, cliente_julia = e["jefa"]
    _, cliente_gerente = e["gerente"]
    _, cliente_th = e["th"]
    propia = _pedir(cliente_julia, e["vacaciones"], desde=hoy.isoformat(), hasta=hoy.isoformat())
    cliente_gerente.post(f"{SOLICITUDES}{propia['id']}/aprobar/")
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = cliente_th.post(f"{SOLICITUDES}{propia['id']}/aprobar/")
    assert respuesta.status_code == 200
    assert respuesta.json()["estado"] == "aprobada"
