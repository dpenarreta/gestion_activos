"""El chat de la empresa: canal general, directos, grupos, avisos y retención.

Lo que se protege, decidido el 19/10/2026: toda persona con cuenta en la
empresa chatea sin permisos; nadie lee conversaciones ajenas; la campana avisa
una vez por conversación; los archivos de más de 10 MB se rechazan sugiriendo
el correo; el historial visible es de 6 meses (12 con el permiso) y a los 12
meses se borra.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.chat import services
from apps.chat.models import Conversacion, Mensaje
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import Departamento, Empleado
from apps.permissions.models import ModulePermission
from apps.users.models import User

URL = "/api/v1/chat/"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


@pytest.fixture
def empresa(db):
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


def _persona(nombre, empresa, *permisos):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@grupolaar.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    if permisos:
        usuario.user_permissions.set(
            Permission.objects.filter(
                content_type=ContentType.objects.get_for_model(ModulePermission),
                codename__in=permisos,
            )
        )
    return usuario


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


def _general(cliente):
    return next(c for c in cliente.get(f"{URL}conversaciones/").json() if c["tipo"] == "general")


def test_todos_estan_en_el_canal_general_sin_permisos(empresa):
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana = _cliente(ana, empresa)
    general = _general(cliente_ana)
    assert general["nombre"] == "Canal general"
    respuesta = cliente_ana.post(
        f"{URL}conversaciones/{general['id']}/mensajes/", {"texto": "Hola a todos"}
    )
    assert respuesta.status_code == 201, respuesta.data
    cliente_beto = _cliente(beto, empresa)
    general_beto = _general(cliente_beto)
    assert general_beto["no_leidos"] == 1
    mensajes = cliente_beto.get(f"{URL}conversaciones/{general['id']}/mensajes/").json()
    assert [m["texto"] for m in mensajes["mensajes"]] == ["Hola a todos"]


def test_un_directo_solo_lo_leen_sus_dos_personas(empresa):
    ana, beto, caro = (_persona(n, empresa) for n in ("ana", "beto", "caro"))
    cliente_ana = _cliente(ana, empresa)
    directa = cliente_ana.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    assert directa["nombre"] == "Beto"
    # Pedirla de nuevo devuelve la misma.
    assert (
        cliente_ana.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()["id"]
        == directa["id"]
    )
    cliente_ana.post(f"{URL}conversaciones/{directa['id']}/mensajes/", {"texto": "¿Almorzamos?"})
    assert (
        _cliente(beto, empresa).get(f"{URL}conversaciones/{directa['id']}/mensajes/").status_code
        == 200
    )
    assert _cliente(caro, empresa).get(
        f"{URL}conversaciones/{directa['id']}/mensajes/"
    ).status_code in (403, 404)


def test_no_se_chatea_con_alguien_de_otra_empresa(empresa):
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    ana, ajeno = _persona("ana", empresa), _persona("zoe", otra)
    respuesta = _cliente(ana, empresa).post(f"{URL}conversaciones/directa/", {"usuario": ajeno.id})
    assert respuesta.status_code == 400
    directorio = _cliente(ana, empresa).get(f"{URL}directorio/").json()
    assert "zoe" not in [p["correo"].split("@")[0] for p in directorio]


def test_la_campana_avisa_una_vez_por_conversacion_y_se_apaga_al_leer(empresa):
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana = _cliente(ana, empresa)
    directa = cliente_ana.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    for texto in ("Hola", "¿Estás?", "Te llamo"):
        cliente_ana.post(f"{URL}conversaciones/{directa['id']}/mensajes/", {"texto": texto})
    avisos = Notificacion.objects.todas().filter(usuario=beto, tipo="chat.mensaje")
    assert avisos.count() == 1  # no una por mensaje
    aviso = avisos.get()
    assert aviso.titulo == "Mensaje de Ana"
    assert aviso.resumen == "Ana: Te llamo"
    assert aviso.enlace == f"/admin/chat?c={directa['id']}"
    assert not Notificacion.objects.todas().filter(usuario=ana).exists()  # lo propio no avisa

    cliente_beto = _cliente(beto, empresa)
    assert cliente_beto.get(f"{URL}novedades/").json()["total_no_leidos"] == 3
    cliente_beto.post(f"{URL}conversaciones/{directa['id']}/leer/", {})
    aviso.refresh_from_db()
    assert aviso.leida_en is not None
    assert cliente_beto.get(f"{URL}novedades/").json()["total_no_leidos"] == 0


def test_las_novedades_traen_solo_lo_nuevo(empresa):
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_beto = _cliente(beto, empresa)
    inicio = cliente_beto.get(f"{URL}novedades/").json()
    assert inicio["mensajes"] == []
    general = _general(_cliente(ana, empresa))
    _cliente(ana, empresa).post(f"{URL}conversaciones/{general['id']}/mensajes/", {"texto": "1"})
    datos = cliente_beto.get(f"{URL}novedades/?desde={inicio['cursor']}").json()
    assert [m["texto"] for m in datos["mensajes"]] == ["1"]
    assert datos["mensajes"][0]["propio"] is False
    otra_vez = cliente_beto.get(f"{URL}novedades/?desde={datos['cursor']}").json()
    assert otra_vez["mensajes"] == []


def test_grupos_personalizados_y_quien_los_administra(empresa):
    ana, beto, caro = (_persona(n, empresa) for n in ("ana", "beto", "caro"))
    cliente_ana = _cliente(ana, empresa)
    grupo = cliente_ana.post(
        f"{URL}conversaciones/",
        {"nombre": "Cierre de mes", "participantes": [beto.id]},
        format="json",
    ).json()
    assert grupo["administra"] is True
    url = f"{URL}conversaciones/{grupo['id']}/"
    assert _cliente(beto, empresa).patch(url, {"nombre": "X"}, format="json").status_code == 403
    respuesta = cliente_ana.patch(url, {"agregar": [caro.id]}, format="json")
    assert len(respuesta.json()["participantes"]) == 3
    assert _cliente(beto, empresa).post(f"{url}salir/").status_code == 204
    assert _cliente(beto, empresa).get(url).status_code in (403, 404)
    # Del canal general no se sale.
    general = _general(cliente_ana)
    assert cliente_ana.post(f"{URL}conversaciones/{general['id']}/salir/").status_code == 400


def test_un_grupo_por_area_reune_a_las_personas_del_area(empresa):
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Operaciones", codigo="OPE")
        otra = Departamento.objects.create(nombre="Comercial", codigo="COM")
    jefa = _persona("jefa", empresa, "chat.grupos_por_area")
    rosa, luis = _persona("rosa", empresa), _persona("luis", empresa)
    with usando_empresa(empresa):
        Empleado.objects.create(
            nombres="Rosa", apellidos="V", codigo_empleado="E1", departamento=area, usuario=rosa
        )
        empleado_luis = Empleado.objects.create(
            nombres="Luis", apellidos="M", codigo_empleado="E2", departamento=otra, usuario=luis
        )
    sin_permiso = _cliente(rosa, empresa).post(
        f"{URL}conversaciones/", {"nombre": "Ops", "departamento": area.id}, format="json"
    )
    assert sin_permiso.status_code == 403
    grupo = (
        _cliente(jefa, empresa)
        .post(
            f"{URL}conversaciones/",
            {"nombre": "Operaciones", "departamento": area.id},
            format="json",
        )
        .json()
    )
    assert grupo["tipo"] == "area"
    nombres = {c["nombre"] for c in _cliente(rosa, empresa).get(f"{URL}conversaciones/").json()}
    assert "Operaciones" in nombres
    # Si Luis pasa a Operaciones, entra solo al abrir el chat.
    with usando_empresa(empresa):
        empleado_luis.departamento = area
        empleado_luis.save()
    nombres = {c["nombre"] for c in _cliente(luis, empresa).get(f"{URL}conversaciones/").json()}
    assert "Operaciones" in nombres


def test_fotos_y_archivos_y_lo_que_pasa_el_limite_sugiere_el_correo(empresa, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente = _cliente(ana, empresa)
    directa = cliente.post(f"{URL}conversaciones/directa/", {"usuario": beto.id}).json()
    url = f"{URL}conversaciones/{directa['id']}/mensajes/"
    foto = SimpleUploadedFile("ruta.png", PNG, content_type="image/png")
    enviado = cliente.post(url, {"archivo": foto}, format="multipart")
    assert enviado.status_code == 201, enviado.data
    assert enviado.json()["archivo"]["es_imagen"] is True
    descarga = _cliente(beto, empresa).get(f"/api/v1{enviado.json()['archivo']['url']}")
    assert descarga.status_code == 200

    grande = SimpleUploadedFile("video.png", PNG + b"0" * (11 * 1024 * 1024))
    rechazo = cliente.post(url, {"archivo": grande}, format="multipart")
    assert rechazo.status_code == 400
    error = rechazo.json()["error"]
    assert error["code"] == "archivo_grande"
    assert error["details"]["correos"] == ["beto@grupolaar.com"]


def test_el_historial_visible_es_de_6_meses_y_12_con_el_permiso(empresa):
    ana = _persona("ana", empresa)
    admin = _persona("admin", empresa, "chat.historial_completo")
    general = _general(_cliente(ana, empresa))
    _general(_cliente(admin, empresa))
    with usando_empresa(empresa):
        conversacion = Conversacion.objects.get(pk=general["id"])
        viejo = Mensaje.objects.create(
            conversacion=conversacion, autor=admin, texto="De hace 8 meses"
        )
        Mensaje.objects.filter(pk=viejo.pk).update(created_at=timezone.now() - timedelta(days=240))
    url = f"{URL}conversaciones/{general['id']}/mensajes/"
    assert _cliente(ana, empresa).get(url).json()["mensajes"] == []
    assert [m["texto"] for m in _cliente(admin, empresa).get(url).json()["mensajes"]] == [
        "De hace 8 meses"
    ]


def test_a_los_12_meses_se_borra(empresa):
    ana = _persona("ana", empresa)
    general = _general(_cliente(ana, empresa))
    with usando_empresa(empresa):
        conversacion = Conversacion.objects.get(pk=general["id"])
        viejo = Mensaje.objects.create(conversacion=conversacion, autor=ana, texto="Viejo")
        Mensaje.objects.create(conversacion=conversacion, autor=ana, texto="Nuevo")
        Mensaje.objects.filter(pk=viejo.pk).update(created_at=timezone.now() - timedelta(days=400))
    assert services.limpiar() == 1
    assert list(Mensaje.objects.todas().values_list("texto", flat=True)) == ["Nuevo"]


def test_sin_sesion_no_hay_chat(empresa):
    assert APIClient().get(f"{URL}conversaciones/").status_code == 401


def test_el_sondeo_no_gasta_el_limite_general_de_la_persona(db):
    """Las novedades del chat se consultan cada 4 s (~900 por hora): con el
    límite general (1000 por hora) dejaban sin servicio a todo lo demás."""
    from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle

    from apps.chat.views import NovedadesView
    from apps.notificaciones.views import NotificacionViewSet

    assert NovedadesView.throttle_scope == "sondeo"
    assert NovedadesView.throttle_classes == [ScopedRateThrottle]
    vista = NotificacionViewSet()
    vista.action = "resumen"
    assert [type(t) for t in vista.get_throttles()] == [ScopedRateThrottle]
    vista.action = "list"
    assert UserRateThrottle in [type(t) for t in vista.get_throttles()]
