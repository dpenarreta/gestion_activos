"""«Fuera de la oficina» y los permisos aprobados en el chat (11/11/2026,
US-001).

Lo que se protege:

- «Fuera de la oficina» pide fecha de regreso futura; una fecha sola vale
  hasta el final de ese día. Quien escribe ve «Fuera de la oficina hasta el
  dd/mm», el mensaje y el reemplazo (CA-1).
- Un permiso aprobado de día completo se ve sin cambiar el estado: vacaciones
  como «De vacaciones», cualquier otro como «Fuera de la oficina», nunca el
  tipo ni el motivo (CA-2, CA-8).
- Al quedar ausente por su estado, lo pendiente pasa al reemplazo (CA-5).
"""

import datetime
import json

from django.utils import timezone

from apps.ausencias.models import LeaveRecord
from apps.chat.models import EstadoChat
from apps.chat.tests.test_chat import URL, _cliente, _persona, empresa  # noqa: F401
from apps.empresas.contexto import usando_empresa
from apps.organizacion.models import DatosDeContacto

MI_ESTADO = f"{URL}mi-estado/"
UN_DIA = datetime.timedelta(days=1)


def _con_reemplazo(usuario, reemplazo, de_la_empresa):
    with usando_empresa(de_la_empresa):
        DatosDeContacto.objects.create(
            usuario=usuario, reemplazo_modo="persona", reemplazo=reemplazo
        )


def _permiso(usuario, tipo, de_la_empresa, dias=1):
    hoy = timezone.localdate()
    with usando_empresa(de_la_empresa):
        for i in range(dias):
            LeaveRecord.objects.create(
                user=usuario,
                type=tipo,
                date=hoy + i * UN_DIA,
                is_full_day=True,
                observation="Cita con el traumatólogo",
                created_by=usuario,
            )


def test_fuera_de_la_oficina_pide_una_fecha_de_regreso_futura(empresa):  # noqa: F811
    cliente = _cliente(_persona("beto", empresa), empresa)
    sin_fecha = cliente.put(MI_ESTADO, {"estado": "fuera_oficina"}, format="json")
    assert sin_fecha.status_code == 400
    assert "hasta" in sin_fecha.json()["error"]["details"]
    ayer = (timezone.localdate() - UN_DIA).isoformat()
    pasada = cliente.put(MI_ESTADO, {"estado": "fuera_oficina", "hasta": ayer}, format="json")
    assert pasada.status_code == 400
    hace_un_rato = (timezone.now() - datetime.timedelta(minutes=5)).isoformat()
    assert (
        cliente.put(
            MI_ESTADO, {"estado": "fuera_oficina", "hasta": hace_un_rato}, format="json"
        ).status_code
        == 400
    )
    # Nada de lo rechazado cambió su estado.
    assert cliente.get(MI_ESTADO).json()["estado"] == "disponible"
    # Una fecha en la hora de reunión tampoco vale: pide la hora.
    manana = (timezone.localdate() + UN_DIA).isoformat()
    assert (
        cliente.put(MI_ESTADO, {"estado": "reunion", "hasta": manana}, format="json").status_code
        == 400
    )


def test_con_fecha_sola_vale_hasta_el_final_de_ese_dia(empresa):  # noqa: F811
    ana, beto, carla = (_persona(n, empresa) for n in ("ana", "beto", "carla"))
    _con_reemplazo(beto, carla, empresa)
    cliente_beto = _cliente(beto, empresa)
    regreso = timezone.localdate() + 2 * UN_DIA
    guardado = cliente_beto.put(
        MI_ESTADO,
        {
            "estado": "fuera_oficina",
            "hasta": regreso.isoformat(),
            "mensaje": "En la agencia de Loja",
        },
        format="json",
    )
    assert guardado.status_code == 200, guardado.data
    datos = guardado.json()
    hasta = timezone.localtime(datetime.datetime.fromisoformat(datos["hasta"]))
    assert hasta.date() == regreso and (hasta.hour, hasta.minute) == (23, 59)
    assert datos["vigente"]["detalle"] == f"Fuera de la oficina hasta el {regreso:%d/%m}"

    # Quien le escribe lo ve, con el mensaje y quién aprueba por él.
    cliente_ana = _cliente(ana, empresa)
    estado = cliente_ana.get(f"{URL}presencia/", {"ids": beto.id}).json()[str(beto.id)]["estado"]
    assert estado["clave"] == "fuera_oficina"
    assert estado["mensaje"] == "En la agencia de Loja"
    assert estado["reemplazo"] == {"id": carla.id, "nombre": "Carla"}
    directa = cliente_ana.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    enviado = cliente_ana.post(
        f"{URL}conversaciones/{directa['id']}/mensajes/", {"texto": "¿Revisó el informe?"}
    ).json()
    [aviso] = enviado["avisos"]
    assert aviso["clave"] == "fuera_oficina"
    assert aviso["reemplazo"] == {"id": carla.id, "nombre": "Carla"}


def test_un_permiso_aprobado_se_ve_sin_cambiar_el_estado_y_sin_su_tipo(empresa):  # noqa: F811
    ana, beto, dora = (_persona(n, empresa) for n in ("ana", "beto", "dora"))
    _permiso(beto, LeaveRecord.Type.MEDICO, empresa, dias=2)
    _permiso(dora, LeaveRecord.Type.VACACIONES, empresa)
    presencia = (
        _cliente(ana, empresa).get(f"{URL}presencia/", {"ids": f"{beto.id},{dora.id}"}).json()
    )
    de_beto = presencia[str(beto.id)]["estado"]
    assert de_beto["clave"] == "fuera_oficina"
    fin = timezone.localdate() + UN_DIA
    assert de_beto["detalle"] == f"Fuera de la oficina hasta el {fin:%d/%m}"
    assert de_beto["mensaje"] == ""
    assert presencia[str(dora.id)]["estado"]["clave"] == "vacaciones"
    texto = json.dumps(presencia, ensure_ascii=False)
    assert "MEDICO" not in texto and "traumatólogo" not in texto
    # Sin jefe ni reemplazo elegido, no hay a quién señalar.
    assert de_beto["reemplazo"] is None


def test_el_permiso_manda_sobre_un_estado_que_no_es_ausencia(empresa):  # noqa: F811
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    _cliente(beto, empresa).put(MI_ESTADO, {"estado": "no_disponible"}, format="json")
    _permiso(beto, LeaveRecord.Type.VACACIONES, empresa)
    estado = (
        _cliente(ana, empresa).get(f"{URL}presencia/", {"ids": beto.id}).json()[str(beto.id)]
    )["estado"]
    assert estado["clave"] == "vacaciones"


def test_al_quedar_ausente_por_su_estado_se_reasigna_lo_pendiente(
    empresa, monkeypatch  # noqa: F811
):
    llamadas = []
    monkeypatch.setattr(
        "apps.organizacion.ausencia.reasignar_pendientes",
        lambda usuario, empresas=None: llamadas.append(usuario.username) or 0,
    )
    beto = _persona("beto", empresa)
    cliente = _cliente(beto, empresa)
    cliente.put(MI_ESTADO, {"estado": "reunion"}, format="json")
    assert llamadas == []
    manana = (timezone.localdate() + UN_DIA).isoformat()
    cliente.put(MI_ESTADO, {"estado": "fuera_oficina", "hasta": manana}, format="json")
    assert llamadas == ["beto"]
    hoy = timezone.localdate()
    cliente.put(
        MI_ESTADO,
        {
            "estado": "vacaciones",
            "vacaciones_desde": hoy.isoformat(),
            "vacaciones_hasta": (hoy + 3 * UN_DIA).isoformat(),
        },
        format="json",
    )
    assert llamadas == ["beto", "beto"]
    # Unas vacaciones que todavía no empiezan no reasignan.
    cliente.put(
        MI_ESTADO,
        {
            "estado": "vacaciones",
            "vacaciones_desde": (hoy + 10 * UN_DIA).isoformat(),
            "vacaciones_hasta": (hoy + 12 * UN_DIA).isoformat(),
        },
        format="json",
    )
    assert llamadas == ["beto", "beto"]
    assert EstadoChat.objects.get(usuario=beto).estado == "fuera_oficina"


def test_fuera_de_la_oficina_no_pasa_de_seis_meses(empresa):  # noqa: F811
    cliente = _cliente(_persona("beto", empresa), empresa)
    lejos = (timezone.localdate() + datetime.timedelta(days=200)).isoformat()
    respuesta = cliente.put(MI_ESTADO, {"estado": "fuera_oficina", "hasta": lejos}, format="json")
    assert respuesta.status_code == 400
    assert "Elija una fecha dentro de los próximos 6 meses." in str(
        respuesta.json()["error"]["details"]["hasta"]
    )
    cerca = (timezone.localdate() + datetime.timedelta(days=170)).isoformat()
    assert (
        cliente.put(
            MI_ESTADO, {"estado": "fuera_oficina", "hasta": cerca}, format="json"
        ).status_code
        == 200
    )
