"""El dashboard «Interacción de la plataforma» (18/11/2026)."""

import datetime

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.cartera.models import Dashboard
from apps.interaccion import services
from apps.interaccion.models import ActividadDiaria, UsoFuncionalidad
from apps.users.models import User

pytestmark = pytest.mark.django_db
URL = "/api/v1/interaccion/"


@pytest.fixture(autouse=True)
def sin_cache():
    cache.clear()
    yield
    cache.clear()


def _usuario(nombre, **extra):
    return User.objects.create_user(
        username=nombre, email=f"{nombre}@grupolaar.com", password="Sup3r-Secr3t!", **extra
    )


def _en(hora, minuto=0, dia=None):
    dia = dia or timezone.localdate()
    return timezone.make_aware(datetime.datetime.combine(dia, datetime.time(hora, minuto)))


def test_cuenta_un_minuto_por_minuto_y_un_ingreso_tras_media_hora():
    ana = _usuario("ana")
    services.registrar_conexion(ana, _en(9, 0))
    services.registrar_conexion(ana, _en(9, 0).replace(second=40))
    services.registrar_conexion(ana, _en(9, 1))
    services.registrar_conexion(ana, _en(9, 2))
    registro = ActividadDiaria.objects.get(usuario=ana)
    assert registro.minutos_conectado == 3
    assert registro.ingresos == 1
    # Vuelve después del almuerzo: otro ingreso del día.
    services.registrar_conexion(ana, _en(14, 0))
    registro.refresh_from_db()
    assert registro.ingresos == 2
    assert registro.minutos_conectado == 4


def test_el_latido_suma_actividad_y_la_funcionalidad_de_la_pantalla():
    ana = _usuario("ana")
    assert services.registrar_latido(ana, "Organigrama · Intranet LCE", _en(10, 0))
    assert not services.registrar_latido(ana, "Organigrama", _en(10, 0).replace(second=30))
    assert services.registrar_latido(ana, "Organigrama", _en(10, 1))
    assert services.registrar_latido(ana, "Chat", _en(10, 2))
    registro = ActividadDiaria.objects.get(usuario=ana)
    assert registro.minutos_activo == 3
    usos = dict(UsoFuncionalidad.objects.values_list("funcionalidad", "minutos"))
    assert usos == {"Organigrama": 2, "Chat": 1}


def _dashboard(dueno):
    """El dashboard en la empresa del dueño, como en producción."""
    from apps.empresas.models import Empresa, MembresiaEmpresa

    empresa = Empresa.objects.first() or Empresa.objects.create(nombre="Laar", codigo="LAAR")
    MembresiaEmpresa.objects.get_or_create(usuario=dueno, empresa=empresa)
    return Dashboard.objects.todas().update_or_create(
        dashboard_id=services.DASHBOARD_ID,
        defaults={"name": "Interacción de la plataforma", "owner": dueno, "empresa": empresa},
    )[0]


def test_el_resumen_solo_lo_ve_el_dueno():
    dueno = _usuario("dueno")
    otro = _usuario("otro")
    dashboard = _dashboard(dueno)
    from apps.empresas.models import MembresiaEmpresa

    MembresiaEmpresa.objects.create(usuario=otro, empresa=dashboard.empresa)
    cliente = APIClient()
    cliente.force_authenticate(user=otro)
    assert cliente.get(f"{URL}resumen/").status_code == 403
    cliente.force_authenticate(user=dueno)
    assert cliente.get(f"{URL}resumen/").status_code == 200


def test_resumen_con_promedios_maximos_recurrentes_y_sin_ingreso():
    from apps.chat.models import Conversacion, Mensaje

    dueno = _usuario("dueno", first_name="Daniel", last_name="Peña")
    ana = _usuario("ana", first_name="Ana", last_name="Ruiz")
    _usuario("nunca", first_name="Nuevo", last_name="Sin Ingreso")
    _dashboard(dueno)
    hoy = timezone.localdate()
    ayer = hoy - datetime.timedelta(days=1)
    User.objects.filter(pk__in=[dueno.pk, ana.pk]).update(last_login=timezone.now())
    ActividadDiaria.objects.create(
        usuario=ana,
        fecha=hoy,
        primera_conexion=_en(8),
        ultima_senal=_en(12),
        minutos_conectado=240,
        minutos_activo=90,
        ingresos=3,
    )
    ActividadDiaria.objects.create(
        usuario=dueno,
        fecha=hoy,
        primera_conexion=_en(9),
        ultima_senal=_en(9, 5),
        minutos_conectado=5,
        minutos_activo=2,
        ingresos=1,
    )
    ActividadDiaria.objects.create(
        usuario=ana,
        fecha=ayer,
        primera_conexion=_en(8, dia=ayer),
        ultima_senal=_en(10, dia=ayer),
        minutos_conectado=120,
        minutos_activo=30,
        ingresos=2,
    )
    UsoFuncionalidad.objects.create(usuario=ana, fecha=hoy, funcionalidad="Chat", minutos=40)
    UsoFuncionalidad.objects.create(usuario=dueno, fecha=hoy, funcionalidad="Chat", minutos=2)
    UsoFuncionalidad.objects.create(usuario=ana, fecha=hoy, funcionalidad="Organigrama", minutos=10)
    general = Conversacion.objects.create(tipo="general", nombre="General")
    for _ in range(4):
        Mensaje.objects.create(conversacion=general, autor=ana, texto="hola")

    datos = services.resumen(7)

    assert datos["cuentas_activas"] == 3
    assert datos["dias_con_actividad"] == 2
    assert datos["personas_promedio_dia"] == 1.5  # 2 hoy, 1 ayer
    assert datos["personas_hoy"] == 2
    assert datos["conexion_maxima"] == {
        "nombre": "Ana Ruiz",
        "fecha": hoy.isoformat(),
        "minutos": 240,
    }
    assert datos["conexion_minima"]["nombre"] == "Daniel Peña"
    assert datos["conexion_minima"]["minutos"] == 5
    assert datos["minutos_activo_promedio"] == round((90 + 2 + 30) / 3, 1)
    assert datos["mensajes"]["total"] == 4
    assert datos["mensajes"]["promedio_dia"] == 2.0
    assert datos["recurrentes"][0]["nombre"] == "Ana Ruiz"
    assert datos["recurrentes"][0]["ingresos"] == 5
    assert datos["sin_ingreso"]["nunca"] == 1
    assert datos["sin_ingreso"]["personas"][0]["nombre"] == "Nuevo Sin Ingreso"
    assert datos["funcionalidades"][0] == {"nombre": "Chat", "minutos": 42, "personas": 2}
    assert len(datos["serie"]) == 7


def test_el_latido_por_la_api():
    ana = _usuario("ana")
    cliente = APIClient()
    cliente.force_authenticate(user=ana)
    assert cliente.post(f"{URL}latido/", {"titulo": "Mis vacaciones"}).status_code == 204
    assert UsoFuncionalidad.objects.get(usuario=ana).funcionalidad == "Mis vacaciones"


def test_purgar_borra_lo_de_mas_de_400_dias():
    ana = _usuario("ana")
    viejo = timezone.localdate() - datetime.timedelta(days=401)
    ActividadDiaria.objects.create(
        usuario=ana, fecha=viejo, primera_conexion=timezone.now(), ultima_senal=timezone.now()
    )
    assert services.purgar() == 1
