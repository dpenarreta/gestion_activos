"""US-005 (11/11/2026): el área sale del cargo y queda bloqueada en «Mi perfil».

Lo que se protege:

- El área del cargo es la de su unidad o, si no tiene, la de la unidad
  superior más cercana que tenga una activa; sin ninguna, no hay área (y un
  ciclo en el árbol no cuelga la consulta).
- El catálogo de cargos de «Mi perfil» trae el área de cada cargo.
- La persona guarda su área una sola vez; después, otra da 400 en `area` y
  se conserva la guardada.
- La cambia quien tiene `organizacion.cambiar_area`, desde «Asignación de
  cargos», con auditoría (anterior, nueva y quién) y los roles del cargo
  sincronizados; sin el permiso, 403.
- La migración da el permiso a Administrador y a quien asigna cargos.
"""

import importlib
from unittest import mock

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.organizacion import areas
from apps.organizacion.models import (
    Cargo,
    DatosDeContacto,
    Departamento,
    NivelJerarquico,
    Sede,
    UnidadOrganizacional,
)
from apps.organizacion.tests.test_organigrama import _cuenta
from apps.users.models import User

MIS_DATOS = "/api/v1/organizacion/mis-datos/"
CAMBIAR_AREA = "/api/v1/organizacion/asignaciones/area/"
ASIGNACIONES = "/api/v1/organizacion/asignaciones/"


@pytest.fixture
def arbol(db):
    """Gerencia Financiera (área «Financiero Administrativo») > Cartera (sin
    área propia) > Cobranzas (sin área), y una unidad suelta sin área."""
    empresa = empresa_actual()
    with usando_empresa(empresa):
        gerencia_n = NivelJerarquico.objects.create(nombre="Gerencia", orden=1)
        area_n = NivelJerarquico.objects.create(nombre="Área", orden=2)
        seccion_n = NivelJerarquico.objects.create(nombre="Sección", orden=3)
        financiero = Departamento.objects.create(nombre="Financiero Administrativo", codigo="FA")
        logistica = Departamento.objects.create(nombre="Logística y Distribución", codigo="LOG")
        inactiva = Departamento.objects.create(
            nombre="Compañía (inactiva)", codigo="CIN", activo=False
        )
        gerencia = UnidadOrganizacional.objects.create(
            nombre="Gerencia Financiera", nivel=gerencia_n, departamento=financiero
        )
        cartera = UnidadOrganizacional.objects.create(
            nombre="Cartera", nivel=area_n, padre=gerencia
        )
        cobranzas = UnidadOrganizacional.objects.create(
            nombre="Cobranzas", nivel=seccion_n, padre=cartera
        )
        suelta = UnidadOrganizacional.objects.create(nombre="Proyectos especiales", nivel=area_n)
        bodega = UnidadOrganizacional.objects.create(
            nombre="Bodega", nivel=area_n, departamento=logistica
        )
        sede = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        cargos = {
            "gerente": Cargo.objects.create(nombre="Gerente Financiero", unidad=gerencia),
            "gestor": Cargo.objects.create(nombre="Gestor de Cobranzas", unidad=cobranzas),
            "asesor": Cargo.objects.create(nombre="Asesor de proyectos", unidad=suelta),
            "sin_unidad": Cargo.objects.create(nombre="Consultor externo"),
            "bodeguero": Cargo.objects.create(nombre="Bodeguero", unidad=bodega),
        }
    return {
        "empresa": empresa,
        "financiero": financiero,
        "logistica": logistica,
        "inactiva": inactiva,
        "unidades": {"gerencia": gerencia, "cartera": cartera, "cobranzas": cobranzas},
        "sede": sede,
        **cargos,
    }


def _persona(empresa, nombre="maria.peña"):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@grupolaar.com",
        password="Sup3r-Secr3t!",
        first_name="María José",
        last_name="Peña Núñez",
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return usuario, cliente


def _datos(arbol, area, cargo):
    return {
        "nombres": "María José",
        "apellidos": "Peña Núñez",
        "tiene_telefono_corporativo": False,
        "area": area.id,
        "agencia": arbol["sede"].id,
        "cargo": cargo.id,
    }


# --- 1. El área del cargo ---------------------------------------------------------


def test_el_area_del_cargo_es_la_de_su_unidad(arbol):
    assert areas.area_del_cargo(arbol["gerente"]) == arbol["financiero"]
    assert areas.area_del_cargo(arbol["bodeguero"]) == arbol["logistica"]


def test_sin_area_propia_se_hereda_de_la_unidad_superior_mas_cercana(arbol):
    # Cobranzas y Cartera no tienen área: se sube hasta la Gerencia Financiera.
    assert areas.area_del_cargo(arbol["gestor"]) == arbol["financiero"]


def test_sin_area_en_ninguna_unidad_superior_no_hay_area(arbol):
    assert areas.area_del_cargo(arbol["asesor"]) is None
    assert areas.area_del_cargo(arbol["sin_unidad"]) is None
    assert areas.area_del_cargo(None) is None


def test_un_area_inactiva_no_se_propone_y_se_busca_mas_arriba(arbol):
    with usando_empresa(arbol["empresa"]):
        cartera = arbol["unidades"]["cartera"]
        cartera.departamento = arbol["inactiva"]
        cartera.save()
    assert areas.area_del_cargo(arbol["gestor"]) == arbol["financiero"]


def test_una_unidad_inactiva_no_da_area_y_se_sigue_subiendo(arbol):
    """QA-TECH (11/11/2026): una unidad inactiva se salta, aunque tenga área
    activa; se toma la de la unidad superior."""
    unidades = arbol["unidades"]
    with usando_empresa(arbol["empresa"]):
        UnidadOrganizacional.objects.filter(pk=unidades["cartera"].pk).update(
            departamento=arbol["logistica"], activa=False
        )
    assert areas.area_del_cargo(arbol["gestor"]) == arbol["financiero"]
    # Si la inactiva es la raíz con área, no queda ninguna.
    with usando_empresa(arbol["empresa"]):
        UnidadOrganizacional.objects.filter(pk=unidades["gerencia"].pk).update(activa=False)
    assert areas.area_del_cargo(arbol["gerente"]) is None
    assert areas.area_del_cargo(arbol["gestor"]) is None


def test_un_ciclo_en_el_arbol_termina_sin_area(arbol):
    """El organigrama no admite ciclos, pero una carga o una reversión a medias
    no debe colgar «Mi perfil»."""
    unidades = arbol["unidades"]
    with usando_empresa(arbol["empresa"]):
        # Gerencia > Cartera > Cobranzas > Gerencia, sin área en ninguna.
        UnidadOrganizacional.objects.filter(pk=unidades["gerencia"].pk).update(
            padre=unidades["cobranzas"], departamento=None
        )
    assert areas.area_del_cargo(arbol["gestor"]) is None


def test_el_catalogo_de_cargos_de_mi_perfil_trae_el_area_de_cada_cargo(arbol):
    _, cliente = _persona(arbol["empresa"])
    datos = cliente.get(MIS_DATOS).json()
    por_cargo = {c["id"]: c["area"] for c in datos["cargos"]}
    financiero = {"id": arbol["financiero"].id, "nombre": "Financiero Administrativo"}
    assert por_cargo[arbol["gerente"].id] == financiero
    assert por_cargo[arbol["gestor"].id] == financiero
    assert por_cargo[arbol["bodeguero"].id] == {
        "id": arbol["logistica"].id,
        "nombre": "Logística y Distribución",
    }
    assert por_cargo[arbol["asesor"].id] is None
    assert por_cargo[arbol["sin_unidad"].id] is None
    assert datos["area_fija"] is False


# --- 2. Mi perfil: el área se elige una sola vez ----------------------------------


def test_la_primera_vez_se_guarda_el_area_que_elige_aunque_no_sea_la_del_cargo(arbol):
    usuario, cliente = _persona(arbol["empresa"])
    # El cargo propone Financiero Administrativo; ella elige Logística.
    respuesta = cliente.put(
        MIS_DATOS, _datos(arbol, arbol["logistica"], arbol["gestor"]), format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["area"]["nombre"] == "Logística y Distribución"
    assert respuesta.json()["area_fija"] is True
    with usando_empresa(arbol["empresa"]):
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["logistica"]


def test_despues_cambiar_el_area_desde_mi_perfil_da_400_y_conserva_la_guardada(arbol):
    usuario, cliente = _persona(arbol["empresa"])
    primera = _datos(arbol, arbol["financiero"], arbol["gestor"])
    assert cliente.put(MIS_DATOS, primera, format="json").status_code == 200

    otra = cliente.put(MIS_DATOS, _datos(arbol, arbol["logistica"], arbol["gestor"]), format="json")
    assert otra.status_code == 400
    error = otra.json()["error"]
    assert error["details"]["area"] == [areas.AREA_FIJA]
    with usando_empresa(arbol["empresa"]):
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["financiero"]

    # Con la misma área puede seguir actualizando lo demás.
    mismo = cliente.put(MIS_DATOS, {**primera, "nombres": "María"}, format="json")
    assert mismo.status_code == 200, mismo.data
    assert mismo.json()["nombres"] == "María"


def test_la_primera_vez_no_vale_un_area_inactiva(arbol):
    usuario, cliente = _persona(arbol["empresa"])
    respuesta = cliente.put(
        MIS_DATOS, _datos(arbol, arbol["inactiva"], arbol["gestor"]), format="json"
    )
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["details"]["area"] == [areas.AREA_INACTIVA]
    with usando_empresa(arbol["empresa"]):
        assert not DatosDeContacto.objects.filter(usuario=usuario, departamento__isnull=False)


def test_si_su_area_guardada_se_desactiva_la_reenvia_y_guarda_lo_demas(arbol):
    """Decisión del Tech Lead (11/11/2026): la misma área guardada se acepta
    aunque esté inactiva; otra, no."""
    usuario, cliente = _persona(arbol["empresa"])
    primera = _datos(arbol, arbol["logistica"], arbol["gestor"])
    assert cliente.put(MIS_DATOS, primera, format="json").status_code == 200
    with usando_empresa(arbol["empresa"]):
        Departamento.objects.filter(pk=arbol["logistica"].pk).update(activo=False)

    mismo = cliente.put(MIS_DATOS, {**primera, "nombres": "María"}, format="json")
    assert mismo.status_code == 200, mismo.data
    assert mismo.json()["nombres"] == "María"
    assert mismo.json()["area"]["nombre"] == "Logística y Distribución"

    otra = cliente.put(
        MIS_DATOS, _datos(arbol, arbol["financiero"], arbol["gestor"]), format="json"
    )
    assert otra.status_code == 400
    assert otra.json()["error"]["details"]["area"] == [areas.AREA_FIJA]


def test_el_area_de_la_ficha_de_empleado_no_la_fija(arbol):
    """Quien solo tiene el área de su ficha de nómina no la guardó en «Mi
    perfil»: la elige la primera vez."""
    from apps.organizacion.models import Empleado

    usuario, cliente = _persona(arbol["empresa"])
    with usando_empresa(arbol["empresa"]):
        Empleado.objects.create(
            nombres="María José",
            apellidos="Peña Núñez",
            codigo_empleado="E-0099",
            departamento=arbol["logistica"],
            usuario=usuario,
        )
    datos = cliente.get(MIS_DATOS).json()
    assert datos["area"]["nombre"] == "Logística y Distribución"
    assert datos["area_fija"] is False
    respuesta = cliente.put(
        MIS_DATOS, _datos(arbol, arbol["financiero"], arbol["gestor"]), format="json"
    )
    assert respuesta.status_code == 200, respuesta.data


# --- 3. El cambio administrativo --------------------------------------------------


def _con_area(arbol, area):
    usuario, cliente = _persona(arbol["empresa"])
    assert (
        cliente.put(MIS_DATOS, _datos(arbol, area, arbol["gestor"]), format="json").status_code
        == 200
    )
    return usuario, cliente


def test_con_el_permiso_se_cambia_el_area_con_auditoria_y_roles_sincronizados(arbol):
    usuario, cliente = _con_area(arbol, arbol["financiero"])
    actor, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")

    admin.credentials(HTTP_X_MOTIVO_CAMBIO="")  # sin motivo
    with mock.patch("apps.organizacion.views.roles_de_cargo.sincronizar") as sincronizar:
        respuesta = admin.put(
            CAMBIAR_AREA, {"usuario": usuario.id, "area": arbol["logistica"].id}, format="json"
        )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json() == {
        "usuario": usuario.id,
        "area": {"id": arbol["logistica"].id, "nombre": "Logística y Distribución"},
    }
    sincronizar.assert_called_once()
    assert list(sincronizar.call_args.args[1]) == [usuario]
    with usando_empresa(arbol["empresa"]):
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["logistica"]

    evento = AuditLog.objects.get(action="organizacion.area_cambiada")
    assert evento.actor_id == actor.id
    assert str(evento.target_id) == str(usuario.id)
    assert evento.previous_values == {
        "area": {"id": arbol["financiero"].id, "nombre": "Financiero Administrativo"}
    }
    assert evento.new_values == {
        "area": {"id": arbol["logistica"].id, "nombre": "Logística y Distribución"}
    }

    # La persona la ve y sigue sin poder cambiarla ella.
    assert cliente.get(MIS_DATOS).json()["area"]["nombre"] == "Logística y Distribución"


def test_mandar_la_misma_area_no_duplica_la_auditoria(arbol):
    usuario, _ = _con_area(arbol, arbol["financiero"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    cuerpo = {"usuario": usuario.id, "area": arbol["financiero"].id}
    assert admin.put(CAMBIAR_AREA, cuerpo, format="json").status_code == 200
    assert not AuditLog.objects.filter(action="organizacion.area_cambiada").exists()


def test_tambien_fija_el_area_de_quien_aun_no_la_tenia(arbol):
    usuario, cliente = _persona(arbol["empresa"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    respuesta = admin.put(
        CAMBIAR_AREA, {"usuario": usuario.id, "area": arbol["financiero"].id}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    evento = AuditLog.objects.get(action="organizacion.area_cambiada")
    assert evento.previous_values == {"area": None}
    assert cliente.get(MIS_DATOS).json()["area_fija"] is True


def test_sin_el_permiso_el_cambio_da_403(arbol):
    usuario, _ = _con_area(arbol, arbol["financiero"])
    # Asignar cargos no basta: cambiar el área es un permiso aparte.
    _, asigna = _cuenta("asigna", "asignar")
    _, nadie = _cuenta("nadie")
    cuerpo = {"usuario": usuario.id, "area": arbol["logistica"].id}
    for cliente in (asigna, nadie):
        respuesta = cliente.put(CAMBIAR_AREA, cuerpo, format="json")
        assert respuesta.status_code == 403
    assert APIClient().put(CAMBIAR_AREA, cuerpo, format="json").status_code == 401
    with usando_empresa(arbol["empresa"]):
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["financiero"]
    assert not AuditLog.objects.filter(action="organizacion.area_cambiada").exists()


def test_el_area_debe_ser_activa_y_de_la_empresa(arbol):
    usuario, _ = _con_area(arbol, arbol["financiero"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    with usando_empresa(otra):
        ajena = Departamento.objects.create(nombre="Operaciones LS", codigo="OPLS")
    for area in (arbol["inactiva"], ajena):
        respuesta = admin.put(CAMBIAR_AREA, {"usuario": usuario.id, "area": area.id}, format="json")
        assert respuesta.status_code == 400
        assert "area" in respuesta.json()["error"]["details"]
    sin_area = admin.put(CAMBIAR_AREA, {"usuario": usuario.id}, format="json")
    assert sin_area.status_code == 400
    assert "area" in sin_area.json()["error"]["details"]


def test_la_persona_debe_ser_de_la_empresa(arbol):
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    ajena, _ = _persona(otra, nombre="ajena")
    respuesta = admin.put(
        CAMBIAR_AREA, {"usuario": ajena.id, "area": arbol["financiero"].id}, format="json"
    )
    assert respuesta.status_code == 400
    assert "usuario" in respuesta.json()["error"]["details"]


def test_asignacion_de_cargos_muestra_el_area_de_cada_persona(arbol):
    usuario, _ = _con_area(arbol, arbol["financiero"])
    _, asigna = _cuenta("asigna", "asignar")
    filas = asigna.get(ASIGNACIONES, {"q": "Peña"}).json()
    fila = next(f for f in filas if f["id"] == usuario.id)
    assert fila["area"] == {"id": arbol["financiero"].id, "nombre": "Financiero Administrativo"}


# --- 4. El permiso y su migración -------------------------------------------------


def test_la_migracion_da_el_permiso_a_administrador_y_a_quien_asigna_cargos(db):
    migracion = importlib.import_module("apps.roles.migrations.0046_permiso_cambiar_area")
    tipo = {"content_type__app_label": "permissions"}
    asignar = Permission.objects.get(codename="institucional.asignar", **tipo)
    nuevo = Permission.objects.get(codename=areas.PERMISO_CAMBIAR, **tipo)
    gestion_humana = Group.objects.create(name="Coordinador Nacional de GGHH (prueba)")
    gestion_humana.permissions.add(asignar)
    administrador, _ = Group.objects.get_or_create(name="Administrador")
    administrador.permissions.remove(nuevo)
    otro = Group.objects.create(name="Analista de Cobranzas (prueba)")
    cuenta, _ = _cuenta("cuenta.directa", "asignar")

    migracion.conceder(django_apps, None)
    migracion.conceder(django_apps, None)  # idempotente

    assert gestion_humana.permissions.filter(pk=nuevo.pk).exists()
    assert administrador.permissions.filter(pk=nuevo.pk).exists()
    assert cuenta.user_permissions.filter(pk=nuevo.pk).exists()
    assert not otro.permissions.filter(pk=nuevo.pk).exists()

    migracion.retirar(django_apps, None)
    assert not gestion_humana.permissions.filter(pk=nuevo.pk).exists()
    assert not administrador.permissions.filter(pk=nuevo.pk).exists()
    assert not cuenta.user_permissions.filter(pk=nuevo.pk).exists()
    # El permiso de base no se toca al revertir.
    assert gestion_humana.permissions.filter(pk=asignar.pk).exists()
    assert cuenta.user_permissions.filter(pk=asignar.pk).exists()


def test_el_permiso_esta_en_el_catalogo_y_lo_llevan_los_cargos_que_asignan():
    from apps.organizacion.permisos_por_cargo import REGLAS
    from apps.permissions.catalog import all_codenames

    assert areas.PERMISO_CAMBIAR in all_codenames()
    assert REGLAS[areas.PERMISO_CAMBIAR] == REGLAS["institucional.asignar"]


def test_privacidad_textos_lo_llevan_los_cargos_de_nomina():
    """QA-FUNC O-4 de US-004: los términos del rol de pagos se editan en
    Protección de datos; los cargos que configuran el rol de pagos lo llevan."""
    from apps.organizacion.permisos_por_cargo import REGLAS, permisos_del_cargo

    assert REGLAS["privacidad.textos"] == REGLAS["roles_pago.configurar"]
    assert "privacidad.textos" in permisos_del_cargo("Asistente de Nómina")
    assert "privacidad.textos" not in permisos_del_cargo("Analista Clima y Cultura")


def test_un_cargo_de_nomina_creado_despues_puede_editar_los_textos(db):
    from apps.organizacion.tests.test_permisos_por_cargo import _codenames, _crear

    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    nivel = _crear(admin, "niveles", nombre="Área", orden=1)
    gh = _crear(admin, "unidades", nombre="Gestión Humana", nivel=nivel["id"])
    cargo = _crear(admin, "cargos", nombre="Asistente de Nómina", unidad=gh["id"])
    assert {"privacidad.textos", "roles_pago.configurar"} <= _codenames(cargo["id"])


# --- 5. Motivo, transacción y concurrencia del cambio administrativo --------------


def test_el_motivo_opcional_queda_en_la_auditoria(arbol):
    usuario, _ = _con_area(arbol, arbol["financiero"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    motivo = "Traslado a Logística por reorganización de la sede Guayaquil (señora Núñez)"
    respuesta = admin.put(
        CAMBIAR_AREA,
        {"usuario": usuario.id, "area": arbol["logistica"].id, "motivo": motivo},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    evento = AuditLog.objects.get(action="organizacion.area_cambiada")
    assert evento.new_values["motivo"] == motivo


def test_el_motivo_tambien_llega_por_el_encabezado_como_en_el_cambio_de_cargo(arbol):
    usuario, _ = _con_area(arbol, arbol["financiero"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    admin.credentials(HTTP_X_MOTIVO_CAMBIO="Correcci%C3%B3n%20del%20%C3%A1rea")
    respuesta = admin.put(
        CAMBIAR_AREA, {"usuario": usuario.id, "area": arbol["logistica"].id}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    evento = AuditLog.objects.get(action="organizacion.area_cambiada")
    assert evento.new_values["motivo"] == "Corrección del área"


def test_sin_motivo_no_se_guarda_la_clave_y_uno_largo_da_400(arbol):
    usuario, _ = _con_area(arbol, arbol["financiero"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    largo = admin.put(
        CAMBIAR_AREA,
        {"usuario": usuario.id, "area": arbol["logistica"].id, "motivo": "ñ" * 301},
        format="json",
    )
    assert largo.status_code == 400
    assert "motivo" in largo.json()["error"]["details"]
    assert not AuditLog.objects.filter(action="organizacion.area_cambiada").exists()
    admin.credentials(HTTP_X_MOTIVO_CAMBIO="")
    bien = admin.put(
        CAMBIAR_AREA, {"usuario": usuario.id, "area": arbol["logistica"].id}, format="json"
    )
    assert bien.status_code == 200
    assert "motivo" not in AuditLog.objects.get(action="organizacion.area_cambiada").new_values


def test_si_falla_la_auditoria_no_queda_el_cambio(arbol):
    """El cambio, los roles y la auditoría van en una sola transacción."""
    usuario, _ = _con_area(arbol, arbol["financiero"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    admin.raise_request_exception = False
    with mock.patch(
        "apps.organizacion.views.record_audit_event", side_effect=RuntimeError("sin auditoría")
    ):
        respuesta = admin.put(
            CAMBIAR_AREA, {"usuario": usuario.id, "area": arbol["logistica"].id}, format="json"
        )
    assert respuesta.status_code == 500
    with usando_empresa(arbol["empresa"]):
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["financiero"]


def test_si_otra_peticion_crea_el_perfil_a_la_vez_se_actualiza_el_suyo(arbol):
    """Dos peticiones a la vez para quien no tenía perfil: la segunda choca con
    `datos_de_contacto_unicos` y actualiza el que creó la primera."""
    usuario, _ = _persona(arbol["empresa"])
    with usando_empresa(arbol["empresa"]):
        DatosDeContacto.objects.create(usuario=usuario, departamento=arbol["financiero"])
        real = areas._bloquear(usuario)
        # La primera lectura no lo ve (la otra petición aún no confirmaba).
        with mock.patch.object(areas, "_bloquear", side_effect=[None, real]):
            anterior, cambio = areas.cambiar_area(usuario, arbol["logistica"])
        assert (anterior, cambio) == (arbol["financiero"], True)
        assert DatosDeContacto.objects.filter(usuario=usuario).count() == 1
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["logistica"]


# --- 6. La lista de áreas de la administración ------------------------------------


def test_la_administracion_lista_las_mismas_areas_que_mi_perfil(arbol):
    _, cliente = _persona(arbol["empresa"])
    _, admin = _cuenta("gestion.humana", "organizacion.cambiar_area")
    respuesta = admin.get(CAMBIAR_AREA)
    assert respuesta.status_code == 200
    assert respuesta.json()["areas"] == cliente.get(MIS_DATOS).json()["areas"]
    nombres = [a["nombre"] for a in respuesta.json()["areas"]]
    assert "Logística y Distribución" in nombres
    assert "Compañía (inactiva)" not in nombres
    _, asigna = _cuenta("asigna", "asignar")
    assert asigna.get(CAMBIAR_AREA).status_code == 403


# --- 7. Número de consultas -------------------------------------------------------


def test_el_area_de_muchos_cargos_cuesta_dos_consultas(arbol, django_assert_num_queries):
    cargos = [arbol[c] for c in ("gerente", "gestor", "asesor", "bodeguero", "sin_unidad")]
    with django_assert_num_queries(2):
        resultado = areas.areas_de_cargos(cargos)
    assert resultado[arbol["gestor"].pk] == arbol["financiero"]


def _consultas(funcion):
    with CaptureQueriesContext(connection) as capturadas:
        funcion()
    return len(capturadas.captured_queries)


def test_el_area_no_agrega_consultas_por_cargo_al_catalogo_de_mi_perfil(arbol):
    """`opciones()` hace una consulta por cargo con unidad para su nombre
    (`nombre_con_unidad`, de antes); el área no suma ninguna por cargo."""
    from apps.organizacion import contacto

    with usando_empresa(arbol["empresa"]):
        antes = _consultas(contacto.opciones)
        cobranzas = arbol["unidades"]["cobranzas"]
        for n in range(5):
            Cargo.objects.create(nombre=f"Gestor {n}", unidad=cobranzas)
        despues = _consultas(contacto.opciones)
    assert despues - antes == 5


def test_asignacion_de_cargos_no_suma_consultas_por_el_area(arbol):
    _, asigna = _cuenta("asigna", "asignar")
    _con_area(arbol, arbol["financiero"])
    asigna.get(ASIGNACIONES, {"q": "Peña"})  # la primera carga sus permisos
    antes = _consultas(lambda: asigna.get(ASIGNACIONES, {"q": "Peña"}))
    for n in range(3):
        usuario, _ = _persona(arbol["empresa"], nombre=f"pena.{n}")
        with usando_empresa(arbol["empresa"]):
            DatosDeContacto.objects.create(usuario=usuario, departamento=arbol["logistica"])
    filas = asigna.get(ASIGNACIONES, {"q": "Peña"}).json()
    assert sum(1 for f in filas if f["area"]) == 4
    assert _consultas(lambda: asigna.get(ASIGNACIONES, {"q": "Peña"})) == antes


# --- 8. El área del cargo asignado en «Mi perfil» (QA-FUNC O-1) -------------------


def test_con_area_fija_mi_perfil_no_propone_el_area_del_cargo(arbol):
    """Ronda 2 (QA-TECH): con área fija no hay nada que proponer, así que no
    se calcula (ver `test_area_del_cargo_solo_sin_area_fija`)."""
    _, cliente = _con_area(arbol, arbol["logistica"])
    datos = cliente.get(MIS_DATOS).json()
    assert datos["area_fija"] is True
    assert datos["area_del_cargo"] is None


# --- 9. Ronda 2 (QA-TECH): nada pisa el área que cambia Gestión Humana ------------


def _vieja_y_cambiada(arbol):
    """La persona con área Financiero; su perfil leído antes de que Gestión
    Humana la cambie a Logística."""
    from apps.organizacion import contacto

    usuario, _ = _con_area(arbol, arbol["financiero"])
    with usando_empresa(arbol["empresa"]):
        vieja = contacto._propios(usuario)
        areas.cambiar_area(usuario, arbol["logistica"])
    return usuario, vieja


def test_guardar_el_cumpleanos_no_devuelve_el_area_vieja(arbol):
    from apps.organizacion import contacto

    usuario, vieja = _vieja_y_cambiada(arbol)
    with usando_empresa(arbol["empresa"]):
        with mock.patch.object(contacto, "_propios", return_value=vieja):
            contacto.guardar_cumpleanos(usuario, mostrar=False)
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["logistica"]


def test_guardar_el_aniversario_no_devuelve_el_area_vieja(arbol):
    from apps.organizacion import contacto

    usuario, vieja = _vieja_y_cambiada(arbol)
    with usando_empresa(arbol["empresa"]):
        with mock.patch.object(contacto, "_propios", return_value=vieja):
            contacto.guardar_aniversario(usuario, mostrar=False)
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["logistica"]


def test_el_cumpleanos_de_quien_no_tiene_perfil_lo_crea(arbol):
    from apps.organizacion import contacto

    usuario, _ = _persona(arbol["empresa"])
    with usando_empresa(arbol["empresa"]):
        contacto.guardar_aniversario(usuario, mostrar=False)
        assert DatosDeContacto.objects.filter(usuario=usuario).count() == 1


def test_area_del_cargo_solo_sin_area_fija(arbol):
    from apps.organizacion import organigrama

    usuario, cliente = _persona(arbol["empresa"])
    with usando_empresa(arbol["empresa"]):
        organigrama.asignar(usuario, arbol["gestor"])
    datos = cliente.get(MIS_DATOS).json()
    assert datos["area_fija"] is False
    assert datos["area_del_cargo"] == {
        "id": arbol["financiero"].id,
        "nombre": "Financiero Administrativo",
    }
    respuesta = cliente.put(
        MIS_DATOS, _datos(arbol, arbol["logistica"], arbol["gestor"]), format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["area_fija"] is True
    assert respuesta.json()["area_del_cargo"] is None


def _guardar(usuario, arbol, area):
    from apps.organizacion import contacto

    return contacto.guardar(
        usuario,
        nombres="María José",
        apellidos="Peña Núñez",
        telefono="",
        departamento=area,
        sede=arbol["sede"],
        cargo=arbol["gestor"],
        tiene_telefono_corporativo=False,
    )


def test_mi_perfil_creado_a_la_vez_por_gestion_humana_se_valida_contra_su_area(arbol):
    """Quien no tenía perfil guarda «Mi perfil» mientras Gestión Humana le fija
    el área: el INSERT choca con `datos_de_contacto_unicos`, se reintenta
    sobre la fila creada y, si el área es otra, da 400 en `area`."""
    from rest_framework.exceptions import ValidationError

    from apps.organizacion import contacto

    usuario, _ = _persona(arbol["empresa"])
    with usando_empresa(arbol["empresa"]):
        DatosDeContacto.objects.create(usuario=usuario, departamento=arbol["logistica"])
        real = contacto._bloquear(usuario)
        with mock.patch.object(contacto, "_bloquear", side_effect=[None, real]):
            with pytest.raises(ValidationError) as error:
                _guardar(usuario, arbol, arbol["financiero"])
        assert "area" in error.value.detail
        assert DatosDeContacto.objects.get(usuario=usuario).departamento == arbol["logistica"]

        real = contacto._bloquear(usuario)
        with mock.patch.object(contacto, "_bloquear", side_effect=[None, real]):
            datos = _guardar(usuario, arbol, arbol["logistica"])
        assert datos["area"]["nombre"] == "Logística y Distribución"
        assert DatosDeContacto.objects.filter(usuario=usuario).count() == 1
        assert DatosDeContacto.objects.get(usuario=usuario).cargo == arbol["gestor"]
