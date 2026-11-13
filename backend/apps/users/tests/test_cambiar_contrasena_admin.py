"""Cambiar la contraseña de otra cuenta o restablecerla a la temporal (US-015).

- `POST /api/v1/admin/users/<id>/password/` (`usuarios.cambiar_password`): la
  contraseña que indica el administrador, con todos los validadores.
- `POST /api/v1/admin/users/<id>/clave-temporal/` (`usuarios.clave_temporal`):
  la clave temporal del servidor, siempre con cambio obligatorio y cierre de
  sesiones.

En las dos: se invalidan los enlaces de recuperación, se desbloquea la cuenta,
se avisa por correo sin la contraseña y queda en la auditoría sin ella. Nadie
las usa sobre su propia cuenta, y sobre un superusuario solo otro superusuario.

La clave temporal de las pruebas es inventada: la real va solo en el .env de
cada servidor (el repositorio es público).
"""

import json
from datetime import timedelta

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import LoginAttempt, PasswordResetToken, Session
from apps.authentication.services import BruteForceProtectionService
from apps.core.models import AuditLog
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

TEMPORAL = "Tempo-De-Prueba7#"
PROPIA = "Clave-Propia-2026!"
NUEVA = "Montaña-Ñandú-2026!"
BASE = "/api/v1/admin/users"


@pytest.fixture(autouse=True)
def _con_clave_temporal(settings):
    settings.CLAVE_INICIAL_USUARIOS = TEMPORAL


def _permisos(*codenames):
    content_type = ContentType.objects.get_for_model(ModulePermission)
    return list(Permission.objects.filter(content_type=content_type, codename__in=codenames))


def _cuenta(nombre, *codenames, superusuario=False, **extra):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@grupolaar.com",
        password=PROPIA,
        is_superuser=superusuario,
        first_name=extra.pop("first_name", "José"),
        last_name=extra.pop("last_name", "Peñafiel"),
        **extra,
    )
    usuario.user_permissions.set(_permisos(*codenames))
    return usuario


def _cliente(usuario):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.fixture
def admin():
    return _cuenta("admin", "usuarios.ver", "usuarios.cambiar_password", "usuarios.clave_temporal")


@pytest.fixture
def ana():
    return _cuenta("ana", first_name="Ana", last_name="Núñez")


def _cambiar(cliente, usuario, **cuerpo):
    datos = {"password": NUEVA, "password_confirmacion": NUEVA, **cuerpo}
    return cliente.post(f"{BASE}/{usuario.id}/password/", datos, format="json")


def _temporal(cliente, usuario):
    return cliente.post(f"{BASE}/{usuario.id}/clave-temporal/", format="json")


def _sesion(usuario):
    return Session.objects.create(
        user=usuario,
        refresh_token_jti=f"jti-{usuario.pk}-{Session.objects.count()}",
        expires_at=timezone.now() + timedelta(days=1),
    )


def _enlace(usuario):
    return PasswordResetToken.objects.create(
        user=usuario,
        token_hash=f"{usuario.pk:064d}",
        expires_at=timezone.now() + timedelta(minutes=30),
    )


def _bloquear(usuario, ip="10.0.0.9"):
    from django.conf import settings

    for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
        BruteForceProtectionService.record_attempt(
            identifier=usuario.username, ip_address=ip, user=usuario, successful=False
        )
    assert BruteForceProtectionService.is_locked_out(usuario.username, ip)


def _entrar(identifier, password):
    return APIClient().post(
        "/api/v1/auth/login/", {"identifier": identifier, "password": password}, format="json"
    )


# --- CA-1: cambiar la contraseña ---------------------------------------------------------


def test_cambia_la_contrasena_con_las_opciones_por_omision(
    admin, ana, django_capture_on_commit_callbacks
):
    sesion = _sesion(ana)
    enlace = _enlace(ana)

    with django_capture_on_commit_callbacks(execute=True):
        respuesta = _cambiar(_cliente(admin), ana)

    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json() == {
        "forzar_cambio": True,
        "cerrar_sesiones": True,
        "sesiones_cerradas": 1,
        "enlaces_invalidados": 1,
        "intentos_fallidos_descartados": 0,
    }
    ana.refresh_from_db()
    assert ana.check_password(NUEVA)
    assert ana.must_change_password
    assert ana.updated_by == admin
    sesion.refresh_from_db()
    enlace.refresh_from_db()
    assert sesion.revoked_at is not None
    assert enlace.used_at is not None
    # Nunca vuelve la contraseña.
    assert NUEVA not in respuesta.content.decode()


def test_se_pueden_desmarcar_el_cambio_obligatorio_y_el_cierre_de_sesiones(admin, ana):
    sesion = _sesion(ana)

    respuesta = _cambiar(_cliente(admin), ana, forzar_cambio=False, cerrar_sesiones=False)

    assert respuesta.status_code == 200
    assert respuesta.json()["sesiones_cerradas"] == 0
    ana.refresh_from_db()
    assert ana.check_password(NUEVA)
    assert not ana.must_change_password
    sesion.refresh_from_db()
    assert sesion.revoked_at is None


def test_una_contrasena_que_no_cumple_las_reglas_da_400_en_password(admin, ana):
    respuesta = _cambiar(_cliente(admin), ana, password="corta", password_confirmacion="corta")

    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "invalid"
    assert "password" in error["details"]
    ana.refresh_from_db()
    assert ana.check_password(PROPIA)


def test_sin_mayuscula_numero_ni_signo_dice_que_falta(admin, ana):
    clave = "solominusculas"
    respuesta = _cambiar(_cliente(admin), ana, password=clave, password_confirmacion=clave)

    assert respuesta.status_code == 400
    motivos = " ".join(respuesta.json()["error"]["details"]["password"])
    assert "mayúscula" in motivos and "número" in motivos and "signo especial" in motivos


def test_no_puede_ser_la_clave_temporal(admin, ana):
    respuesta = _cambiar(_cliente(admin), ana, password=TEMPORAL, password_confirmacion=TEMPORAL)

    assert respuesta.status_code == 400
    assert "clave temporal" in " ".join(respuesta.json()["error"]["details"]["password"])
    ana.refresh_from_db()
    assert ana.check_password(PROPIA)


def test_no_puede_parecerse_a_los_datos_de_la_cuenta(admin):
    """Los validadores reciben la cuenta destino, no la del administrador."""
    marisol = _cuenta("marisolpenafiel")
    clave = "Marisolpenafiel1!"

    respuesta = _cambiar(_cliente(admin), marisol, password=clave, password_confirmacion=clave)

    assert respuesta.status_code == 400
    assert "password" in respuesta.json()["error"]["details"]


def test_la_confirmacion_distinta_da_400_en_password_confirmacion(admin, ana):
    respuesta = _cambiar(_cliente(admin), ana, password_confirmacion=NUEVA + "x")

    assert respuesta.status_code == 400
    assert "password_confirmacion" in respuesta.json()["error"]["details"]
    ana.refresh_from_db()
    assert ana.check_password(PROPIA)


def test_sin_contrasena_da_400(admin, ana):
    respuesta = _cliente(admin).post(f"{BASE}/{ana.id}/password/", {}, format="json")

    assert respuesta.status_code == 400
    detalles = respuesta.json()["error"]["details"]
    assert "password" in detalles and "password_confirmacion" in detalles


def test_los_espacios_son_parte_de_la_contrasena(admin, ana):
    clave = " Con-Espacio-2026! "
    respuesta = _cambiar(_cliente(admin), ana, password=clave, password_confirmacion=clave)

    assert respuesta.status_code == 200
    ana.refresh_from_db()
    assert ana.check_password(clave)


def test_entra_con_la_nueva_y_se_le_pide_cambiarla(admin, ana):
    assert _cambiar(_cliente(admin), ana).status_code == 200

    assert _entrar("ana", PROPIA).status_code == 401
    login = _entrar("ana", NUEVA)
    assert login.status_code == 200
    cliente = APIClient()
    cliente.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    # Con el cambio obligatorio solo alcanza el cambio de contraseña, `me` y salir.
    bloqueada = cliente.get(f"{BASE}/")
    assert bloqueada.status_code == 403
    assert bloqueada.json()["error"]["code"] == "password_change_required"


def test_sin_cambio_obligatorio_entra_y_trabaja(admin, ana):
    assert _cambiar(_cliente(admin), ana, forzar_cambio=False).status_code == 200

    login = _entrar("ana@grupolaar.com", NUEVA)
    assert login.status_code == 200
    cliente = APIClient()
    cliente.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    assert cliente.get("/api/v1/auth/me/").status_code == 200


def test_desbloquea_la_cuenta_bloqueada_por_intentos_fallidos(admin, ana):
    _bloquear(ana)
    # Un fallo con el correo, desde otra IP, también cuenta para la cuenta.
    BruteForceProtectionService.record_attempt(
        identifier="ANA@grupolaar.com", ip_address="10.0.0.8", user=ana, successful=False
    )
    ajeno = LoginAttempt.objects.create(identifier="otra", ip_address="10.0.0.9")

    respuesta = _cambiar(_cliente(admin), ana)

    assert respuesta.status_code == 200
    assert respuesta.json()["intentos_fallidos_descartados"] == 6
    # Las IP de lo borrado van a la auditoría, no a la respuesta.
    assert "ips_de_intentos_descartados" not in respuesta.json()
    evento = AuditLog.objects.get(action="user.password_set_by_admin")
    assert evento.new_values["ips_de_intentos_descartados"] == ["10.0.0.8", "10.0.0.9"]
    assert not BruteForceProtectionService.is_locked_out("ana", "10.0.0.9")
    assert LoginAttempt.objects.filter(pk=ajeno.pk).exists()
    assert _entrar("ana", NUEVA).status_code == 200


def test_desbloquear_conserva_los_fallos_viejos_y_los_aciertos():
    ana = _cuenta("ana")
    viejo = LoginAttempt.objects.create(identifier="ana", successful=False)
    LoginAttempt.objects.filter(pk=viejo.pk).update(created_at=timezone.now() - timedelta(days=2))
    acierto = LoginAttempt.objects.create(identifier="ana", successful=True, user=ana)
    reciente = LoginAttempt.objects.create(identifier="ana", successful=False)

    assert BruteForceProtectionService.desbloquear(ana) == (1, [])

    assert LoginAttempt.objects.filter(pk__in=[viejo.pk, acierto.pk]).count() == 2
    assert not LoginAttempt.objects.filter(pk=reciente.pk).exists()


def test_una_cuenta_deshabilitada_cambia_de_contrasena_pero_sigue_deshabilitada(admin):
    fuera = _cuenta("fuera")
    fuera.status = User.Status.DISABLED
    fuera.save()

    assert _cambiar(_cliente(admin), fuera).status_code == 200

    fuera.refresh_from_db()
    assert fuera.check_password(NUEVA)
    assert fuera.status == User.Status.DISABLED and not fuera.is_active
    assert _entrar("fuera", NUEVA).status_code == 401


def test_avisa_por_correo_sin_la_contrasena(admin, ana, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        assert _cambiar(_cliente(admin), ana).status_code == 200

    assert len(mail.outbox) == 1
    correo = mail.outbox[0]
    assert correo.to == ["ana@grupolaar.com"]
    assert "cambiada por administración" in correo.body
    assert "se te pedirá elegir una contraseña nueva" in correo.body
    html = correo.alternatives[0][0]
    for texto in (correo.subject, correo.body, html):
        assert NUEVA not in texto


def test_el_correo_sin_cambio_obligatorio_no_lo_menciona(
    admin, ana, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        assert _cambiar(_cliente(admin), ana, forzar_cambio=False).status_code == 200

    assert "cambiada por administración" in mail.outbox[0].body
    assert "se te pedirá" not in mail.outbox[0].body


def test_el_cambio_propio_sigue_con_el_texto_de_siempre():
    from apps.authentication.emails import send_password_changed_notification

    send_password_changed_notification(user=_cuenta("ana"))

    assert "fue actualizada correctamente" in mail.outbox[0].body
    assert "administración" not in mail.outbox[0].body


def test_queda_en_la_auditoria_sin_la_contrasena(admin, ana):
    assert _cambiar(_cliente(admin), ana, cerrar_sesiones=False).status_code == 200

    evento = AuditLog.objects.get(action="user.password_set_by_admin")
    assert evento.actor == admin
    assert evento.target_type == "user" and str(evento.target_id) == str(ana.pk)
    assert evento.new_values["forzar_cambio"] is True
    assert evento.new_values["cerrar_sesiones"] is False
    todo = json.dumps(
        list(AuditLog.objects.values("previous_values", "new_values")), ensure_ascii=False
    )
    assert NUEVA not in todo


def test_el_400_auditado_tampoco_guarda_la_contrasena(admin, ana):
    _cambiar(_cliente(admin), ana, password_confirmacion="Otra-Distinta-1!")

    fallo = AuditLog.objects.get(action__endswith="validation_failed")
    assert fallo.new_values["password"] == "***"
    assert fallo.new_values["password_confirmacion"] == "***"
    assert NUEVA not in json.dumps(fallo.new_values, ensure_ascii=False)


# --- CA-2: restablecer a la clave temporal ------------------------------------------------


def test_restablece_a_la_temporal_obliga_a_cambiarla_y_cierra_todo(
    admin, ana, django_capture_on_commit_callbacks
):
    sesion = _sesion(ana)
    enlace = _enlace(ana)
    _bloquear(ana)

    with django_capture_on_commit_callbacks(execute=True):
        respuesta = _temporal(_cliente(admin), ana)

    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json() == {
        "forzar_cambio": True,
        "cerrar_sesiones": True,
        "sesiones_cerradas": 1,
        "enlaces_invalidados": 1,
        "intentos_fallidos_descartados": 5,
    }
    assert TEMPORAL not in respuesta.content.decode()
    ana.refresh_from_db()
    assert ana.check_password(TEMPORAL)
    assert ana.must_change_password
    sesion.refresh_from_db()
    enlace.refresh_from_db()
    assert sesion.revoked_at is not None and enlace.used_at is not None

    assert len(mail.outbox) == 1
    correo = mail.outbox[0]
    assert "cambiada por administración" in correo.body
    assert "se te pedirá elegir una contraseña nueva" in correo.body
    for texto in (correo.subject, correo.body, correo.alternatives[0][0]):
        assert TEMPORAL not in texto

    evento = AuditLog.objects.get(action="user.password_temporal_by_admin")
    assert evento.actor == admin and str(evento.target_id) == str(ana.pk)
    assert TEMPORAL not in json.dumps(evento.new_values, ensure_ascii=False)


def test_la_temporal_ignora_cualquier_cuerpo(admin, ana):
    """Sin cuerpo: aunque alguien mande opciones, siempre obliga y cierra."""
    sesion = _sesion(ana)

    respuesta = _cliente(admin).post(
        f"{BASE}/{ana.id}/clave-temporal/",
        {"forzar_cambio": False, "cerrar_sesiones": False, "password": NUEVA},
        format="json",
    )

    assert respuesta.status_code == 200
    ana.refresh_from_db()
    sesion.refresh_from_db()
    assert ana.check_password(TEMPORAL) and ana.must_change_password
    assert sesion.revoked_at is not None


def test_entra_con_la_temporal_y_se_le_pide_cambiarla(admin, ana):
    assert _temporal(_cliente(admin), ana).status_code == 200

    login = _entrar("ana", TEMPORAL)
    assert login.status_code == 200
    cliente = APIClient()
    cliente.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    assert cliente.get(f"{BASE}/").json()["error"]["code"] == "password_change_required"


def test_sin_clave_temporal_configurada_da_400_y_no_cambia_nada(settings, admin, ana):
    settings.CLAVE_INICIAL_USUARIOS = ""
    sesion = _sesion(ana)
    enlace = _enlace(ana)

    respuesta = _temporal(_cliente(admin), ana)

    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "sin_clave_temporal"
    assert "clave temporal configurada" in error["message"]
    ana.refresh_from_db()
    sesion.refresh_from_db()
    enlace.refresh_from_db()
    assert ana.check_password(PROPIA) and not ana.must_change_password
    assert sesion.revoked_at is None and enlace.used_at is None
    assert not AuditLog.objects.filter(action="user.password_temporal_by_admin").exists()
    assert len(mail.outbox) == 0


# --- CA-3: límites ------------------------------------------------------------------------


@pytest.mark.parametrize("accion", ["password", "clave-temporal"])
def test_nadie_lo_usa_sobre_su_propia_cuenta(admin, accion):
    datos = {"password": NUEVA, "password_confirmacion": NUEVA}

    respuesta = _cliente(admin).post(f"{BASE}/{admin.id}/{accion}/", datos, format="json")

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "propia_cuenta"
    admin.refresh_from_db()
    assert admin.check_password(PROPIA)
    rechazo = AuditLog.objects.get(action__endswith="_by_admin_rejected")
    assert rechazo.result == AuditLog.Result.FAILURE
    assert rechazo.new_values == {"motivo": "propia_cuenta"}


def test_ni_siquiera_un_superusuario_sobre_la_suya():
    jefe = _cuenta("jefe", superusuario=True)

    respuesta = _temporal(_cliente(jefe), jefe)

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "propia_cuenta"


@pytest.mark.parametrize("accion", ["password", "clave-temporal"])
def test_sobre_un_superusuario_solo_otro_superusuario(admin, accion):
    root = _cuenta("root", superusuario=True)
    datos = {"password": NUEVA, "password_confirmacion": NUEVA}

    respuesta = _cliente(admin).post(f"{BASE}/{root.id}/{accion}/", datos, format="json")

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"
    root.refresh_from_db()
    assert root.check_password(PROPIA)
    assert not AuditLog.objects.filter(
        action__startswith="user.password_", result=AuditLog.Result.SUCCESS
    ).exists()
    rechazo = AuditLog.objects.get(action__endswith="_by_admin_rejected")
    assert rechazo.result == AuditLog.Result.FAILURE
    assert rechazo.actor == admin and str(rechazo.target_id) == str(root.pk)
    assert rechazo.new_values == {"motivo": "fuera_de_alcance"}


def test_un_superusuario_si_actua_sobre_otro_superusuario():
    jefe = _cuenta("jefe", superusuario=True)
    root = _cuenta("root", superusuario=True)

    assert _cambiar(_cliente(jefe), root).status_code == 200
    root.refresh_from_db()
    assert root.check_password(NUEVA)


def test_tampoco_sobre_quien_tiene_permisos_que_el_actor_no_tiene(admin):
    auditora = _cuenta("auditora", "auditoria.ver")

    assert _cambiar(_cliente(admin), auditora).status_code == 403
    auditora.refresh_from_db()
    assert auditora.check_password(PROPIA)


def test_sin_cambiar_password_da_403(ana):
    solo_temporal = _cuenta("soporte", "usuarios.ver", "usuarios.clave_temporal")

    respuesta = _cambiar(_cliente(solo_temporal), ana)

    assert respuesta.status_code == 403
    ana.refresh_from_db()
    assert ana.check_password(PROPIA)


def test_sin_clave_temporal_da_403(ana):
    solo_cambiar = _cuenta("soporte", "usuarios.ver", "usuarios.cambiar_password")

    assert _temporal(_cliente(solo_cambiar), ana).status_code == 403
    ana.refresh_from_db()
    assert ana.check_password(PROPIA)


def test_restablecer_password_no_basta_para_ninguna(ana):
    """El permiso viejo solo envía el enlace: no da los nuevos."""
    viejo = _cuenta("viejo", "usuarios.ver", "usuarios.editar", "usuarios.restablecer_password")

    assert _cambiar(_cliente(viejo), ana).status_code == 403
    assert _temporal(_cliente(viejo), ana).status_code == 403


def test_sin_sesion_da_401(ana):
    assert _cambiar(APIClient(), ana).status_code == 401
    assert _temporal(APIClient(), ana).status_code == 401


def test_una_cuenta_que_no_existe_da_404(admin):
    assert _temporal(_cliente(admin), User(pk=999_999)).status_code == 404


def test_los_permisos_nuevos_llegan_al_frontend(admin):
    respuesta = _cliente(admin).get("/api/v1/auth/me/")

    assert {"usuarios.cambiar_password", "usuarios.clave_temporal"} <= set(
        respuesta.json()["permissions"]
    )


# --- Ronda 1: límites antes que la contraseña ---------------------------------------------


def test_una_clave_debil_a_un_superusuario_da_403_y_no_400(admin):
    """QA-FUNC: sobre una cuenta que no puede tocar, el motivo es el 403."""
    root = _cuenta("root", superusuario=True)

    respuesta = _cambiar(_cliente(admin), root, password="débil", password_confirmacion="x")

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"


def test_una_clave_debil_a_la_propia_cuenta_da_403_propia_cuenta(admin):
    respuesta = _cambiar(_cliente(admin), admin, password="débil", password_confirmacion="x")

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "propia_cuenta"


def test_sin_clave_temporal_sobre_un_superusuario_da_403(settings, admin):
    settings.CLAVE_INICIAL_USUARIOS = ""
    root = _cuenta("root", superusuario=True)

    assert _temporal(_cliente(admin), root).status_code == 403


# --- Ronda 1 (P1): el alcance se mide en cada empresa del objetivo -------------------------


def _empresa(codigo):
    from apps.empresas.models import Empresa

    empresa, _ = Empresa.objects.get_or_create(codigo=codigo, defaults={"nombre": codigo})
    return empresa


def _rol(nombre, *codenames):
    from django.contrib.auth.models import Group

    rol = Group.objects.create(name=nombre)
    rol.permissions.set(_permisos(*codenames))
    return rol


def _miembro(usuario, empresa, *roles):
    from apps.empresas.models import MembresiaEmpresa

    membresia, _ = MembresiaEmpresa.objects.get_or_create(usuario=usuario, empresa=empresa)
    membresia.roles.add(*roles)
    return membresia


# Los roles reales traen los de la Mesa de ayuda que toda cuenta sin rol ya tiene
# (`PERMISOS_SIN_ROL`, 09/11/2026); sin ellos, el admin «tendría menos» que una
# cuenta básica y `exigir_alcance_sobre` lo frenaría.
PERMISOS_ADMIN = (
    "usuarios.ver",
    "usuarios.cambiar_password",
    "usuarios.clave_temporal",
    "soporte.crear",
    "soporte.mesa_mis_tickets",
    "soporte.mesa_crear",
)


@pytest.fixture
def dos_empresas():
    """El administrador de A (por su rol en A) y Ana: básica en A y
    Administradora en B, con permisos que el de A no tiene."""
    a, b = _empresa("EMP"), _empresa("EMPB")
    admin_a = _cuenta("admina")
    _miembro(admin_a, a, _rol("Admin de A", *PERMISOS_ADMIN))
    ana = _cuenta("ana")
    _miembro(ana, a)
    _miembro(ana, b, _rol("Admin de B", *PERMISOS_ADMIN, "roles.editar", "auditoria.ver"))
    return {"a": a, "b": b, "admin": admin_a, "ana": ana}


@pytest.mark.parametrize("accion", ["password", "clave-temporal"])
def test_el_admin_de_a_no_toca_a_quien_es_administradora_en_b(dos_empresas, accion):
    admin_a, ana = dos_empresas["admin"], dos_empresas["ana"]
    datos = {"password": NUEVA, "password_confirmacion": NUEVA}

    respuesta = _cliente(admin_a).post(f"{BASE}/{ana.id}/{accion}/", datos, format="json")

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"
    ana.refresh_from_db()
    assert ana.check_password(PROPIA) and not ana.must_change_password
    rechazo = AuditLog.objects.get(action__endswith="_by_admin_rejected")
    assert rechazo.new_values == {"motivo": "fuera_de_alcance"}


def test_estar_en_b_con_menos_permisos_tampoco_basta(dos_empresas):
    admin_a, ana = dos_empresas["admin"], dos_empresas["ana"]
    _miembro(admin_a, dos_empresas["b"], _rol("Consulta en B", "usuarios.ver"))

    assert _cambiar(_cliente(admin_a), ana).status_code == 403
    ana.refresh_from_db()
    assert ana.check_password(PROPIA)


def test_con_los_mismos_permisos_en_las_dos_empresas_si_puede(dos_empresas):
    admin_a, ana = dos_empresas["admin"], dos_empresas["ana"]
    _miembro(
        admin_a,
        dos_empresas["b"],
        _rol("Admin total de B", *PERMISOS_ADMIN, "roles.editar", "auditoria.ver"),
    )

    assert _cambiar(_cliente(admin_a), ana).status_code == 200
    ana.refresh_from_db()
    assert ana.check_password(NUEVA)


def test_una_cuenta_solo_de_b_da_404(dos_empresas):
    solo_b = _cuenta("solob")
    _miembro(solo_b, dos_empresas["b"])

    assert _cambiar(_cliente(dos_empresas["admin"]), solo_b).status_code == 404
    assert _temporal(_cliente(dos_empresas["admin"]), solo_b).status_code == 404
    solo_b.refresh_from_db()
    assert solo_b.check_password(PROPIA)


def test_un_superusuario_actua_en_cualquier_empresa(dos_empresas):
    jefe = _cuenta("jefe", superusuario=True)

    assert _temporal(_cliente(jefe), dos_empresas["ana"]).status_code == 200


def test_con_una_sola_empresa_funciona_como_hoy():
    from apps.empresas.models import Empresa

    a = _empresa("EMP")
    assert Empresa.objects.count() == 1
    admin_a = _cuenta("admina")
    _miembro(admin_a, a, _rol("Admin de A", *PERMISOS_ADMIN))
    ana = _cuenta("ana")
    _miembro(ana, a)

    assert _cambiar(_cliente(admin_a), ana).status_code == 200
    # Y en la empresa activa sigue la regla de siempre.
    jefa = _cuenta("jefa")
    _miembro(jefa, a, _rol("Auditoría", "auditoria.ver"))
    assert _cambiar(_cliente(admin_a), jefa).status_code == 403


# --- Ronda 1: el cambio obligatorio no repite la clave que fijó el administrador -----------


def test_el_cambio_obligatorio_no_admite_la_misma_clave(admin, ana):
    assert _cambiar(_cliente(admin), ana).status_code == 200
    login = _entrar("ana", NUEVA)
    cliente = APIClient()
    cliente.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    url = "/api/v1/auth/password/change/"

    igual = cliente.post(
        url,
        {"current_password": NUEVA, "new_password": NUEVA, "new_password_confirm": NUEVA},
        format="json",
    )
    assert igual.status_code == 400
    assert "distinta de la actual" in " ".join(igual.json()["error"]["details"]["new_password"])

    otra = "Cañaveral-Nueva-27!"
    distinta = cliente.post(
        url,
        {"current_password": NUEVA, "new_password": otra, "new_password_confirm": otra},
        format="json",
    )
    assert distinta.status_code == 204
    ana.refresh_from_db()
    assert ana.check_password(otra) and not ana.must_change_password
