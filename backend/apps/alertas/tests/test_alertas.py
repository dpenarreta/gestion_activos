"""Centro de alertas del parque (§19 del documento funcional)."""

import datetime
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.alertas.models import ConfiguracionAlertas
from apps.alertas.reglas import Severidad, construir_alertas
from apps.mantenimientos.models import Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento, Empleado
from apps.politicas.models import PoliticaObsolescencia
from apps.politicas.services import restar_meses
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_alertas", email="admin_alertas@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def crear_activo(admin, departamento, tipo):
    contador = {"n": 0}

    def _crear(meses_de_antiguedad=6, **extra):
        contador["n"] += 1
        return ActivoService.crear_activo(
            actor=admin,
            tipo=tipo,
            nombre=f"Equipo {contador['n']}",
            marca="Dell",
            modelo="Latitude",
            numero_serie=f"SN-ALE-{contador['n']}",
            departamento=departamento,
            fecha_adquisicion=restar_meses(timezone.localdate(), meses_de_antiguedad),
            **extra,
        )

    return _crear


@pytest.fixture
def configuracion(db):
    return ConfiguracionAlertas.cargar()


def _alertas_por_tipo(configuracion):
    return {alerta.tipo: alerta for alerta in construir_alertas(configuracion)}


def _envejecer(activo, dias):
    """Retrasa `updated_at`, que es `auto_now` y no admite asignación directa."""
    Activo.objects.filter(pk=activo.pk).update(updated_at=timezone.now() - timedelta(days=dias))
    activo.refresh_from_db()
    return activo


# --- La configuración es única ---------------------------------------------


def test_la_configuracion_es_una_sola_fila(db):
    """Si cada usuario tuviera sus umbrales, dos personas mirando el mismo
    parque verían realidades distintas y no podrían acordar qué atender."""
    primera = ConfiguracionAlertas.cargar()
    primera.dias_sin_asignar = 45
    primera.save()

    segunda = ConfiguracionAlertas.cargar()

    assert ConfiguracionAlertas.objects.count() == 1
    assert segunda.pk == primera.pk
    assert segunda.dias_sin_asignar == 45


def test_una_sola_configuracion_por_empresa(db):
    """Una por empresa, no una en todo el sistema.

    Fue una fila única mientras hubo una sola empresa; al pasar a dos, esa fila
    pertenecía a la primera y era invisible desde la segunda, así que el centro
    de alertas intentaba crearla de nuevo y devolvía un 500. Ahora cada empresa
    tiene la suya y una segunda dentro de la misma es lo que se rechaza.
    """
    from django.db import IntegrityError

    ConfiguracionAlertas.cargar()

    with pytest.raises(IntegrityError):
        ConfiguracionAlertas(dias_sin_asignar=10).save()


def test_cada_empresa_configura_sus_alertas_por_su_cuenta(db):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa

    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")

    propia = ConfiguracionAlertas.cargar()
    propia.dias_sin_asignar = 45
    propia.save()

    with usando_empresa(otra):
        # La de la otra empresa no existe todavía: se crea con sus valores por
        # defecto en vez de chocar con la que ya está.
        ajena = ConfiguracionAlertas.cargar()
        assert ajena.pk != propia.pk
        assert ajena.dias_sin_asignar != 45


def test_la_configuracion_no_se_elimina(db):
    from django.core.exceptions import ValidationError

    configuracion = ConfiguracionAlertas.cargar()

    with pytest.raises(ValidationError):
        configuracion.delete()


def test_el_centro_responde_aunque_nadie_lo_haya_configurado(cliente):
    """No hace falta pasar por la pantalla de configuración para que las
    alertas funcionen: se crean con los valores por defecto."""
    respuesta = cliente.get("/api/v1/alertas/")

    assert respuesta.status_code == 200
    assert respuesta.json()["configuracion"]["dias_sin_asignar"] == 90


# --- Reglas ----------------------------------------------------------------


def test_avisa_de_las_garantias_por_vencer(crear_activo, configuracion):
    por_vencer = crear_activo()
    por_vencer.fecha_fin_garantia = timezone.localdate() + timedelta(days=10)
    por_vencer.save()
    vigente = crear_activo()
    vigente.fecha_fin_garantia = timezone.localdate() + timedelta(days=400)
    vigente.save()

    alerta = _alertas_por_tipo(configuracion)["garantias_por_vencer"]

    assert alerta.total == 1
    assert alerta.severidad == Severidad.ALTA
    assert alerta.muestra[0]["codigo_barras"] == por_vencer.codigo_barras


def test_una_garantia_ya_vencida_no_entra_en_la_alerta_de_por_vencer(crear_activo, configuracion):
    """Pasada la fecha ya no hay nada que reclamarle al proveedor: es un hecho
    consumado, no un aviso con plazo."""
    vencida = crear_activo()
    vencida.fecha_fin_garantia = timezone.localdate() - timedelta(days=1)
    vencida.save()

    assert _alertas_por_tipo(configuracion)["garantias_por_vencer"].total == 0


def test_avisa_de_los_activos_sin_asignar_por_mucho_tiempo(crear_activo, configuracion):
    olvidado = _envejecer(crear_activo(), dias=120)
    _envejecer(crear_activo(), dias=30)

    alerta = _alertas_por_tipo(configuracion)["sin_asignar"]

    assert alerta.total == 1
    assert alerta.muestra[0]["codigo_barras"] == olvidado.codigo_barras
    assert alerta.severidad == Severidad.BAJA


def test_el_umbral_de_dias_sin_asignar_es_configurable(crear_activo, configuracion):
    _envejecer(crear_activo(), dias=40)

    assert _alertas_por_tipo(configuracion)["sin_asignar"].total == 0

    configuracion.dias_sin_asignar = 30
    configuracion.save()

    assert _alertas_por_tipo(configuracion)["sin_asignar"].total == 1


def test_avisa_de_las_reparaciones_sin_cerrar(admin, crear_activo, configuracion):
    activo = crear_activo(meses_de_antiguedad=24)
    atascada = MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=timezone.localdate() - timedelta(days=40),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion="Cambio de disco",
    )
    # Reciente y aún abierta: todavía no es un problema.
    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=timezone.localdate(),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion="Limpieza",
    )

    alerta = _alertas_por_tipo(configuracion)["reparaciones_pendientes"]

    assert alerta.total == 1
    # Lo que pasa de 30 días se dice en meses: «40 días» obliga a dividir.
    assert "1 mes y 10 días en reparación" == alerta.muestra[0]["dato"]
    assert atascada.fecha_salida is None


def test_una_reparacion_cerrada_no_genera_alerta(admin, crear_activo, configuracion):
    activo = crear_activo(meses_de_antiguedad=24)
    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=timezone.localdate() - timedelta(days=40),
        fecha_salida=timezone.localdate() - timedelta(days=38),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion="Cambio de disco",
    )

    assert _alertas_por_tipo(configuracion)["reparaciones_pendientes"].total == 0


def test_avisa_de_los_equipos_a_cargo_de_un_custodio_inactivo(
    admin, crear_activo, departamento, configuracion
):
    """Un equipo cuyo responsable dejó la empresa no tiene, en la práctica,
    responsable: si se pierde, nadie responde por él."""
    empleado = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", codigo_empleado="EMP-9001", departamento=departamento
    )
    activo = crear_activo()
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)
    empleado.activo = False
    empleado.save(update_fields=["activo"])

    alerta = _alertas_por_tipo(configuracion)["custodios_inactivos"]

    assert alerta.total == 1
    assert alerta.severidad == Severidad.ALTA
    assert "inactivo" in alerta.muestra[0]["dato"]


def test_avisa_de_las_fichas_sin_actualizar(crear_activo, configuracion):
    _envejecer(crear_activo(), dias=400)
    crear_activo()

    alerta = _alertas_por_tipo(configuracion)["sin_actualizacion"]

    assert alerta.total == 1
    assert alerta.severidad == Severidad.BAJA


def test_un_activo_dado_de_baja_no_genera_alertas(admin, crear_activo, configuracion):
    """Ya salió del parque: seguir avisando sobre él llenaría la pantalla de
    situaciones que nadie puede ni debe resolver."""
    activo = _envejecer(crear_activo(), dias=400)
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.DADO_DE_BAJA, motivo="Obsoleto"
    )

    alertas = _alertas_por_tipo(configuracion)

    assert alertas["sin_actualizacion"].total == 0
    assert alertas["sin_asignar"].total == 0


def test_avisa_de_los_equipos_proximos_a_reemplazo(crear_activo, tipo, configuracion):
    PoliticaObsolescencia.objects.create(
        nombre="Laptops",
        tipo_dispositivo=tipo,
        vida_util_meses=48,
        vida_util_critica_meses=60,
    )
    crear_activo(meses_de_antiguedad=70)
    crear_activo(meses_de_antiguedad=50)
    crear_activo(meses_de_antiguedad=6)

    alerta = _alertas_por_tipo(configuracion)["proximos_a_reemplazo"]

    assert alerta.total == 2
    assert alerta.severidad == Severidad.ALTA
    assert "1 con reemplazo recomendado" in alerta.detalle


def test_sin_ninguno_recomendado_la_alerta_de_reemplazo_baja_de_severidad(
    crear_activo, tipo, configuracion
):
    """Un parque con equipos «a evaluar» no está en la misma situación que
    uno con equipos que ya deberían haberse reemplazado."""
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo, vida_util_meses=48, vida_util_critica_meses=60
    )
    crear_activo(meses_de_antiguedad=50)

    assert _alertas_por_tipo(configuracion)["proximos_a_reemplazo"].severidad == Severidad.MEDIA


def test_avisa_de_los_equipos_con_demasiadas_reparaciones(admin, crear_activo, tipo, configuracion):
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo, max_mantenimientos=2
    )
    activo = crear_activo(meses_de_antiguedad=24)
    for numero in range(3):
        MantenimientoService.registrar(
            actor=admin,
            activo=activo,
            tipo=Mantenimiento.Tipo.CORRECTIVO,
            fecha_intervencion=timezone.localdate() - timedelta(days=numero + 1),
            tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            responsable="Soporte",
            descripcion="Intervención",
        )

    alerta = _alertas_por_tipo(configuracion)["demasiadas_reparaciones"]

    assert alerta.total == 1
    assert alerta.muestra[0]["codigo_barras"] == activo.codigo_barras


# --- Encendido y apagado ---------------------------------------------------


def test_una_alerta_apagada_no_se_calcula(crear_activo, configuracion):
    _envejecer(crear_activo(), dias=400)
    configuracion.avisar_sin_actualizacion = False
    configuracion.save()

    assert "sin_actualizacion" not in _alertas_por_tipo(configuracion)


def test_una_alerta_en_cero_se_reporta_igual(configuracion):
    """«Revisado, nada pendiente» es información, y es distinto de una alerta
    apagada, que sencillamente no aparece."""
    alertas = _alertas_por_tipo(configuracion)

    assert "garantias_por_vencer" in alertas
    assert alertas["garantias_por_vencer"].total == 0


# --- API -------------------------------------------------------------------


def test_el_resumen_ordena_las_alertas_por_severidad(cliente, crear_activo):
    _envejecer(crear_activo(), dias=400)
    con_garantia = crear_activo()
    con_garantia.fecha_fin_garantia = timezone.localdate() + timedelta(days=5)
    con_garantia.save()

    datos = cliente.get("/api/v1/alertas/").json()
    con_pendientes = [alerta for alerta in datos["alertas"] if alerta["total"] > 0]

    assert con_pendientes[0]["severidad"] == Severidad.ALTA
    assert datos["total_alertas"] == len(con_pendientes)
    assert datos["por_severidad"]["alta"] == 1


def test_el_resumen_suma_los_elementos_de_todas_las_alertas(cliente, crear_activo):
    _envejecer(crear_activo(), dias=400)
    _envejecer(crear_activo(), dias=400)

    datos = cliente.get("/api/v1/alertas/").json()

    # Cada uno cuenta en «sin asignar» y en «sin actualizar»: son dos
    # situaciones distintas sobre el mismo equipo, y cada una se resuelve de
    # una forma.
    assert datos["total_elementos"] == 4


def test_la_configuracion_se_edita_desde_la_api(cliente):
    respuesta = cliente.patch(
        "/api/v1/alertas/configuracion/",
        {"dias_reparacion_pendiente": 7, "avisar_sin_actualizacion": False},
        format="json",
    )

    assert respuesta.status_code == 200
    configuracion = ConfiguracionAlertas.cargar()
    assert configuracion.dias_reparacion_pendiente == 7
    assert configuracion.avisar_sin_actualizacion is False


def test_un_umbral_en_cero_se_rechaza(cliente):
    """Avisaría de todo el parque desde el primer día, que es indistinguible
    de no tener la alerta."""
    respuesta = cliente.patch(
        "/api/v1/alertas/configuracion/", {"dias_sin_asignar": 0}, format="json"
    )

    assert respuesta.status_code == 400
    assert "dias_sin_asignar" in respuesta.json()["error"]["details"]


def test_cambiar_la_configuracion_queda_auditado(cliente, admin):
    from apps.core.models import AuditLog

    cliente.patch("/api/v1/alertas/configuracion/", {"dias_sin_asignar": 30}, format="json")

    evento = AuditLog.objects.filter(action="alertas.configuracion_actualizada").get()
    assert evento.actor == admin
    assert evento.new_values["dias_sin_asignar"] == 30
    assert evento.previous_values["dias_sin_asignar"] == 90


def test_ver_las_alertas_exige_el_permiso(db):
    from django.contrib.auth.models import Group

    usuario = User.objects.create_user(username="sin_permiso", password="Sup3r-Secr3t!")
    usuario.groups.add(Group.objects.create(name="Solo activos"))
    client = APIClient()
    client.force_authenticate(user=usuario)

    assert client.get("/api/v1/alertas/").status_code == 403


def test_configurar_exige_un_permiso_distinto_de_ver(db):
    """Ver el estado del parque y decidir cuándo el sistema debe avisar son
    decisiones de distinto alcance."""
    from django.contrib.auth.models import Group, Permission
    from django.contrib.contenttypes.models import ContentType

    from apps.permissions.models import ModulePermission

    usuario = User.objects.create_user(username="solo_ve", password="Sup3r-Secr3t!")
    rol = Group.objects.create(name="Observador")
    rol.permissions.add(
        Permission.objects.get(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename="alertas.ver",
        )
    )
    usuario.groups.add(rol)
    client = APIClient()
    client.force_authenticate(user=usuario)

    assert client.get("/api/v1/alertas/").status_code == 200
    assert (
        client.patch(
            "/api/v1/alertas/configuracion/", {"dias_sin_asignar": 30}, format="json"
        ).status_code
        == 403
    )


# --- Filtros que hacen accionables los enlaces -----------------------------


def test_el_inventario_filtra_por_custodio_inactivo(cliente, admin, crear_activo, departamento):
    empleado = Empleado.objects.create(
        nombres="Ana", apellidos="Pérez", codigo_empleado="EMP-9002", departamento=departamento
    )
    activo = crear_activo()
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)
    empleado.activo = False
    empleado.save(update_fields=["activo"])
    crear_activo()

    respuesta = cliente.get("/api/v1/activos/", {"custodio_inactivo": "true"})

    codigos = [fila["codigo_barras"] for fila in respuesta.json()["results"]]
    assert codigos == [activo.codigo_barras]


def test_el_inventario_filtra_por_dias_sin_actualizar(cliente, crear_activo):
    viejo = _envejecer(crear_activo(), dias=400)
    crear_activo()

    respuesta = cliente.get("/api/v1/activos/", {"sin_actualizar_dias": "365"})

    codigos = [fila["codigo_barras"] for fila in respuesta.json()["results"]]
    assert codigos == [viejo.codigo_barras]


def test_la_bitacora_filtra_las_reparaciones_sin_cerrar(cliente, admin, crear_activo):
    activo = crear_activo(meses_de_antiguedad=24)
    abierta = MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2025, 6, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion="Sigue en el taller",
    )
    MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2025, 6, 1),
        fecha_salida=datetime.date(2025, 6, 3),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion="Cerrada",
    )

    respuesta = cliente.get("/api/v1/mantenimientos/", {"pendientes": "true"})

    ids = [fila["id"] for fila in respuesta.json()["results"]]
    assert ids == [abierta.id]


def test_la_muestra_de_reemplazo_no_repite_equipos(crear_activo, tipo, configuracion):
    """Los recomendados encabezan la muestra y el resto la completa: verlos
    dos veces haría dudar de si son dos equipos distintos."""
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo, vida_util_meses=48, vida_util_critica_meses=60
    )
    crear_activo(meses_de_antiguedad=70)
    crear_activo(meses_de_antiguedad=50)

    muestra = _alertas_por_tipo(configuracion)["proximos_a_reemplazo"].muestra

    codigos = [fila["codigo_barras"] for fila in muestra]
    assert len(codigos) == len(set(codigos))
    assert "Reemplazo recomendado" in muestra[0]["dato"]


def test_dos_reparaciones_abiertas_del_mismo_equipo_son_dos_filas(
    admin, crear_activo, configuracion
):
    """Comparten activo pero son dos situaciones distintas, y cada fila
    necesita identificarse por sí sola."""
    activo = crear_activo(meses_de_antiguedad=24)
    for dias in (40, 30):
        MantenimientoService.registrar(
            actor=admin,
            activo=activo,
            tipo=Mantenimiento.Tipo.CORRECTIVO,
            fecha_intervencion=timezone.localdate() - timedelta(days=dias),
            tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            responsable="Soporte",
            descripcion="Intervención",
        )

    muestra = _alertas_por_tipo(configuracion)["reparaciones_pendientes"].muestra

    claves = [fila["clave"] for fila in muestra]
    assert len(claves) == 2
    assert len(set(claves)) == 2
