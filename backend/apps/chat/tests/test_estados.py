"""Los estados en el chat (22/10/2026): almuerzo, vacaciones, en reunión y no
disponible.

Lo que se protege:

- El almuerzo dura lo que la persona configuró y vuelve solo a disponible.
- Las vacaciones se proponen desde su solicitud aprobada; antes de empezar
  se avisa «Estará de vacaciones…» y durante mandan sobre lo demás.
- Quien escribe a alguien con un estado recibe el aviso al enviar.
- Los demás ven el estado junto a «en línea».
"""

import datetime

from django.utils import timezone

from apps.chat.models import EstadoChat
from apps.chat.tests.test_chat import URL, _cliente, _persona, empresa  # noqa: F401
from apps.empresas.contexto import usando_empresa
from apps.licencias.models import FlujoPermiso, SolicitudPermiso

MI_ESTADO = f"{URL}mi-estado/"


def test_el_almuerzo_dura_lo_configurado_y_avisa_a_quien_escribe(empresa):  # noqa: F811
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana, cliente_beto = _cliente(ana, empresa), _cliente(beto, empresa)
    horario = cliente_beto.put(
        MI_ESTADO, {"almuerzo_inicio": "12:30", "almuerzo_minutos": 45}, format="json"
    ).json()
    assert horario["almuerzo_inicio"] == "12:30" and horario["estado"] == "disponible"
    salio = cliente_beto.put(MI_ESTADO, {"estado": "almuerzo"}, format="json").json()
    assert salio["vigente"]["clave"] == "almuerzo"
    hasta = datetime.datetime.fromisoformat(salio["hasta"])
    assert abs((hasta - timezone.now()).total_seconds() - 45 * 60) < 60

    # Ana lo ve en la presencia y, al escribirle, recibe el aviso.
    presencia = cliente_ana.get(f"{URL}presencia/", {"ids": beto.id}).json()
    assert presencia[str(beto.id)]["estado"]["detalle"].startswith("En almuerzo hasta las ")
    directa = cliente_ana.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    enviado = cliente_ana.post(
        f"{URL}conversaciones/{directa['id']}/mensajes/", {"texto": "¿Tienes un minuto?"}
    ).json()
    assert [(a["nombre"], a["clave"]) for a in enviado["avisos"]] == [("Beto", "almuerzo")]

    # Pasada la hora, vuelve solo a disponible y ya no se avisa.
    EstadoChat.objects.filter(usuario=beto).update(
        hasta=timezone.now() - datetime.timedelta(minutes=1)
    )
    assert cliente_beto.get(MI_ESTADO).json()["estado"] == "disponible"
    otra = cliente_ana.post(
        f"{URL}conversaciones/{directa['id']}/mensajes/", {"texto": "Ya volviste"}
    ).json()
    assert otra["avisos"] == []


def test_las_vacaciones_se_proponen_desde_su_solicitud_y_mandan(empresa):  # noqa: F811
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    hoy = timezone.localdate()
    with usando_empresa(empresa):
        flujo = FlujoPermiso.objects.create(nombre="Vacaciones", descuenta_vacaciones=True)
        SolicitudPermiso.objects.create(
            flujo=flujo,
            solicitante=beto,
            desde=hoy + datetime.timedelta(days=5),
            hasta=hoy + datetime.timedelta(days=12),
            estado=SolicitudPermiso.Estado.APROBADA,
        )
    cliente_beto = _cliente(beto, empresa)
    sugeridas = cliente_beto.get(MI_ESTADO).json()["vacaciones_sugeridas"]
    assert sugeridas["aprobada"] is True
    assert sugeridas["desde"] == (hoy + datetime.timedelta(days=5)).isoformat()

    guardado = cliente_beto.put(
        MI_ESTADO,
        {
            "estado": "vacaciones",
            "vacaciones_desde": sugeridas["desde"],
            "vacaciones_hasta": sugeridas["hasta"],
            "mensaje": "Escriba a Carla para lo urgente.",
        },
        format="json",
    ).json()
    # Antes de salir, quien le escribe ya sabe cuándo no estará.
    assert guardado["vigente"]["clave"] == "vacaciones_proximas"
    assert guardado["vigente"]["detalle"].startswith("Estará de vacaciones del ")

    # Mientras tanto puede salir a reunión; y durante las vacaciones, mandan ellas.
    en_reunion = cliente_beto.put(MI_ESTADO, {"estado": "reunion"}, format="json").json()
    assert en_reunion["vigente"]["clave"] == "reunion"
    EstadoChat.objects.filter(usuario=beto).update(vacaciones_desde=hoy)
    presencia = _cliente(ana, empresa).get(f"{URL}presencia/", {"ids": beto.id}).json()
    estado = presencia[str(beto.id)]["estado"]
    assert estado["clave"] == "vacaciones"
    assert estado["mensaje"] == "Escriba a Carla para lo urgente."

    # Si regresa antes, «disponible» termina las vacaciones.
    de_vuelta = cliente_beto.put(MI_ESTADO, {"estado": "disponible"}, format="json").json()
    assert de_vuelta["vigente"] is None and de_vuelta["vacaciones_desde"] is None


def test_validaciones(empresa):  # noqa: F811
    cliente = _cliente(_persona("ana", empresa), empresa)
    hoy = timezone.localdate()
    assert cliente.put(MI_ESTADO, {"almuerzo_minutos": 500}, format="json").status_code == 400
    al_reves = {
        "estado": "vacaciones",
        "vacaciones_desde": (hoy + datetime.timedelta(days=3)).isoformat(),
        "vacaciones_hasta": hoy.isoformat(),
    }
    assert cliente.put(MI_ESTADO, al_reves, format="json").status_code == 400
    pasada = (timezone.now() - datetime.timedelta(hours=1)).isoformat()
    assert (
        cliente.put(MI_ESTADO, {"estado": "reunion", "hasta": pasada}, format="json").status_code
        == 400
    )
    sin_fin = cliente.put(MI_ESTADO, {"estado": "no_disponible"}, format="json").json()
    assert sin_fin["vigente"]["detalle"] == "No disponible" and sin_fin["hasta"] is None


def test_en_el_canal_general_no_se_avisa(empresa):  # noqa: F811
    from apps.chat.models import Conversacion

    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana = _cliente(ana, empresa)
    _cliente(beto, empresa).put(MI_ESTADO, {"estado": "reunion"}, format="json")
    cliente_ana.get(f"{URL}conversaciones/")  # entra al canal general
    with usando_empresa(empresa):
        general = Conversacion.objects.get(clave="general")
    enviado = cliente_ana.post(
        f"{URL}conversaciones/{general.id}/mensajes/", {"texto": "Hola a todos"}
    )
    assert enviado.status_code == 201 and enviado.json()["avisos"] == []
