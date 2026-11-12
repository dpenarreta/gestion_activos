"""Los permisos de los llamados de atención (US-013, CA-9).

- El catálogo trae `llamados.ver`, `emitir`, `configurar` y `solicitar`, en el
  grupo de Gestión Humana, materializados en la base.
- `roles/0051` da ver, emitir y configurar a los roles de Gestión Humana y a
  Superusuario (no a Administrador), y `solicitar` a los roles de los cargos
  que tienen a alguien a cargo.
- `crear_roles_iniciales` deja `llamados.` fuera de Administrador.
- La regla de `solicitar` sigue al organigrama: se da y se quita sola al
  cambiar el jefe de un cargo, su línea punteada o al borrarlo; no toca los
  roles que no son de cargo.
"""

import importlib

from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command

from apps.organizacion import roles_de_cargo
from apps.organizacion.models import Cargo, NivelJerarquico, UnidadOrganizacional
from apps.organizacion.permisos_por_cargo import POR_TENER_EQUIPO, sincronizar_por_equipo
from apps.permissions.catalog import PERMISSION_CATALOG
from apps.roles.management.commands.crear_roles_iniciales import ROLES

SOLICITAR = "llamados.solicitar"
GESTION = ("llamados.ver", "llamados.emitir", "llamados.configurar")


def _permiso(codename):
    return Permission.objects.get(content_type__app_label="permissions", codename=codename)


def _tiene(rol, codename) -> bool:
    rol.refresh_from_db()
    return rol.permissions.filter(codename=codename).exists()


def _cargo(nombre, jefe=None, unidad=None):
    cargo = Cargo.objects.create(nombre=nombre, jefe=jefe, unidad=unidad)
    roles_de_cargo.asegurar_rol(cargo)
    cargo.refresh_from_db()
    return cargo


def test_el_catalogo_trae_los_cuatro_permisos(db):
    bloque = PERMISSION_CATALOG["llamados"]
    assert set(bloque["permissions"]) == {*GESTION, SOLICITAR}
    assert bloque["grupo"]["id"] == "gestion_humana"
    for codename in (*GESTION, SOLICITAR):
        assert _permiso(codename)
    assert POR_TENER_EQUIPO == {SOLICITAR}


def test_administrador_no_recibe_los_llamados(db):
    assert "llamados." in ROLES["Administrador"]["excluir_prefijos"]
    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    administrador = Group.objects.get(name="Administrador")
    superusuario = Group.objects.get(name="Superusuario")
    assert not administrador.permissions.filter(codename__startswith="llamados.").exists()
    assert superusuario.permissions.filter(codename__startswith="llamados.").count() == 4


def test_la_migracion_0051_reparte_los_permisos(db):
    migracion = importlib.import_module(
        "apps.roles.migrations.0051_permisos_de_llamados_de_atencion"
    )
    nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
    unidad = UnidadOrganizacional.objects.create(nombre="Gestión Humana", nivel=nivel)
    coordinador = _cargo("Coordinador Nacional de GGHH", unidad=unidad)
    asistente = _cargo("Asistente de GGHH", jefe=coordinador, unidad=unidad)
    jefe_th = _cargo("Jefe Nacional de Talento Humano y SSO", unidad=unidad)
    # Un rol de cargo homónimo, con la unidad en el nombre.
    otra = UnidadOrganizacional.objects.create(nombre="Zona Sur", nivel=nivel)
    homonimo = _cargo("Coordinador Nacional de GGHH", unidad=otra)
    assert homonimo.rol.name != "Coordinador Nacional de GGHH"
    # Un cargo con un subordinado solo por la línea punteada.
    punteado_jefe = _cargo("Jefe Financiero")
    punteado = _cargo("Jefa de Cartera")
    punteado.jefes_secundarios.add(punteado_jefe)

    administrador, _ = Group.objects.get_or_create(name="Administrador")
    superusuario, _ = Group.objects.get_or_create(name="Superusuario")
    personalizado = Group.objects.create(name="Auditor externo (prueba)")
    todos = [*GESTION, SOLICITAR]
    for rol in Group.objects.all():
        rol.permissions.remove(*Permission.objects.filter(codename__in=todos))

    migracion.conceder(django_apps, None)
    migracion.conceder(django_apps, None)  # idempotente

    for cargo in (coordinador, jefe_th, homonimo):
        for codename in GESTION:
            assert _tiene(cargo.rol, codename), (cargo.rol.name, codename)
    for codename in todos:
        assert _tiene(superusuario, codename)
        assert not _tiene(administrador, codename)
        assert not _tiene(personalizado, codename)
    assert not _tiene(asistente.rol, "llamados.emitir")

    assert _tiene(coordinador.rol, SOLICITAR)  # el asistente le reporta
    assert _tiene(punteado_jefe.rol, SOLICITAR)  # línea punteada
    assert not _tiene(asistente.rol, SOLICITAR)
    assert not _tiene(jefe_th.rol, SOLICITAR)  # nadie le reporta
    assert not _tiene(punteado.rol, SOLICITAR)

    migracion.retirar(django_apps, None)
    assert not Group.objects.filter(permissions__codename__in=todos).exists()


def test_solicitar_sigue_al_organigrama(db):
    jefa = _cargo("Jefa de Cartera")
    otro = _cargo("Jefe de Operaciones")
    analista = _cargo("Analista de Cartera")
    assert not _tiene(jefa.rol, SOLICITAR)

    # Le asignan un subordinado: lo recibe.
    analista.jefe = jefa
    analista.save()
    assert _tiene(jefa.rol, SOLICITAR)
    assert not _tiene(analista.rol, SOLICITAR)

    # El analista cambia de jefe: la jefa lo pierde y el otro lo gana.
    analista.jefe = otro
    analista.save()
    assert not _tiene(jefa.rol, SOLICITAR)
    assert _tiene(otro.rol, SOLICITAR)

    # Marcarlo a mano en el rol de un cargo sin equipo no dura (gobernado): el
    # siguiente `asegurar_rol` del cargo lo devuelve a la regla.
    jefa.rol.permissions.add(_permiso(SOLICITAR))
    roles_de_cargo.asegurar_rol(Cargo.objects.get(pk=jefa.pk))
    assert not _tiene(jefa.rol, SOLICITAR)

    # La línea punteada cuenta, y quitarla lo quita.
    analista.jefes_secundarios.add(jefa)
    assert _tiene(jefa.rol, SOLICITAR)
    analista.jefes_secundarios.remove(jefa)
    assert not _tiene(jefa.rol, SOLICITAR)

    # Un rol que no es de cargo no se toca.
    personalizado = Group.objects.create(name="Supervisión externa (prueba)")
    personalizado.permissions.add(_permiso(SOLICITAR))

    # Borrar al único subordinado se lo quita al jefe.
    analista.delete()
    assert not _tiene(otro.rol, SOLICITAR)
    assert _tiene(personalizado, SOLICITAR)


def test_un_cargo_nuevo_bajo_un_jefe_le_da_el_permiso(db):
    jefa = _cargo("Jefa de Cartera")
    _cargo("Analista de Cartera", jefe=jefa)
    assert _tiene(jefa.rol, SOLICITAR)
    # Y recalcular la empresa entera no cambia nada.
    assert sincronizar_por_equipo(jefa.empresa_id) == 0


def test_un_subordinado_inactivo_no_cuenta(db):
    """Decisión del Tech Lead (12/11/2026): solo los cargos activos."""
    jefa = _cargo("Jefa de Cartera")
    analista = _cargo("Analista de Cartera", jefe=jefa)
    assert _tiene(jefa.rol, SOLICITAR)
    analista.activo = False
    analista.save()
    assert not _tiene(jefa.rol, SOLICITAR)
    analista.activo = True
    analista.save(update_fields=["activo"])
    assert _tiene(jefa.rol, SOLICITAR)


def test_guardar_el_nombre_o_el_perfil_no_recalcula(db, monkeypatch):
    from apps.organizacion import senales_equipo

    jefa = _cargo("Jefa de Cartera")
    analista = _cargo("Analista de Cartera", jefe=jefa)
    llamadas = []
    monkeypatch.setattr(senales_equipo, "sincronizar_por_equipo", llamadas.append)

    analista = Cargo.objects.get(pk=analista.pk)
    analista.nombre = "Analista Senior de Cartera"
    analista.funciones = "Cobranza y conciliación"
    analista.save()
    analista.plazas = 3
    analista.save(update_fields=["plazas"])
    Cargo.objects.create(nombre="Cargo suelto")  # nuevo y sin jefe
    assert llamadas == []

    analista.jefe = None
    analista.save()
    assert llamadas == [analista.empresa_id]


def test_en_lote_recalcula_una_sola_vez(db, monkeypatch):
    from apps.organizacion import senales_equipo

    jefa = _cargo("Jefa de Cartera")
    otro = _cargo("Jefe de Operaciones")
    uno = _cargo("Analista uno")
    dos = _cargo("Analista dos")
    llamadas = []
    real = senales_equipo.sincronizar_por_equipo
    monkeypatch.setattr(
        senales_equipo,
        "sincronizar_por_equipo",
        lambda empresa_id: llamadas.append(empresa_id) or real(empresa_id),
    )
    with senales_equipo.en_lote():
        for cargo, jefe in ((uno, jefa), (dos, jefa), (uno, otro)):
            cargo.jefe = jefe
            cargo.save()
        dos.jefes_secundarios.add(otro)
        assert llamadas == []  # nada mientras dura el lote
    assert llamadas == [jefa.empresa_id]
    assert _tiene(jefa.rol, SOLICITAR) and _tiene(otro.rol, SOLICITAR)

    # Si el bloque falla, no recalcula.
    llamadas.clear()
    try:
        with senales_equipo.en_lote():
            uno.jefe = None
            uno.save()
            raise RuntimeError("falla")
    except RuntimeError:
        pass
    assert llamadas == []
