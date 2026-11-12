"""Solicitud de procesos sobre el motor de proyectos (US-008, 12/11/2026).

Lo que se protege:

- La categoría del tipo (`proyecto` o `proceso`) sale de `?categoria=`; sin
  él vale `proyecto` (la pantalla de proyectos no cambia) y cualquier otro
  valor es 400.
- Separación total: los tipos, las solicitudes, sus acciones y el resumen de
  una categoría no se ven desde la otra; lo ajeno responde 404.
- Permisos propios: `proyectos.configurar` no configura procesos ni al revés;
  `procesos.ver_todas` es el `ver_todas` de los procesos.
- Numeración `PRC-AAAA-NNNN`, avisos que dicen «proceso» y enlazan a
  `/admin/institucional/procesos`, y la migración que reparte los permisos
  nuevos según los de proyectos.
"""

import importlib
import json
import re

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission

from apps.core.models import AuditLog
from apps.licencias.tests.test_licencias import _persona
from apps.notificaciones.models import Notificacion
from apps.proyectos.models import TipoProyecto
from apps.proyectos.tests.test_proyectos import (  # noqa: F401 — `proyecto` es un fixture
    PARA_SOLICITAR,
    SOLICITUDES,
    TIPOS,
    _activar,
    _docx,
    _solicitar,
    proyecto,
)

PROCESO = {"categoria": "proceso"}
RESUMEN = f"{SOLICITUDES}resumen/"
OPCIONES = "/api/v1/proyectos/opciones/"


def _q(url, categoria="proceso"):
    return f"{url}?categoria={categoria}"


def _crear_tipo_de_proceso(cliente, nombre="Alta de proveedor en el ERP", aprobadores=None):
    creado = cliente.post(
        _q(TIPOS),
        {
            "nombre": nombre,
            "descripcion": "Procesos de Compras y Contabilidad (señora Núñez).",
            "campos": [
                {"etiqueta": "Área dueña del proceso", "tipo": "texto", "obligatorio": True}
            ],
            "pasos": [{"nombre": "Revisión de Procesos", "aprobadores": aprobadores}],
        },
        format="json",
    )
    assert creado.status_code == 201, creado.data
    tipo = creado.json()
    subida = cliente.post(
        _q(f"{TIPOS}{tipo['id']}/plantilla/"), {"plantilla": _docx()}, format="multipart"
    )
    assert subida.status_code == 200, subida.data
    activado = cliente.patch(_q(f"{TIPOS}{tipo['id']}/"), {"activo": True}, format="json")
    assert activado.status_code == 200, activado.data
    return activado.json()


def _solicitar_proceso(cliente, tipo, categoria="proceso", titulo="Alta de Ñandú S.A."):
    clave = tipo["campos"][0]["clave"]
    return cliente.post(
        _q(SOLICITUDES, categoria),
        {
            "tipo_proyecto": tipo["id"],
            "titulo": titulo,
            "respuestas": json.dumps({clave: "Contabilidad"}),
            "archivo": _docx("plantilla-llena.docx"),
        },
        format="multipart",
    )


@pytest.fixture
def proceso(proyecto):  # noqa: F811
    """Lo de `proyecto` (un tipo de proyecto activo, con Inés que configura
    proyectos y ve todas) más Pedro, que configura procesos y ve todas, y un
    tipo de proceso activo que decide Tatiana (Talento Humano)."""
    e = proyecto
    _, ines = e["admin"]
    e["tipo"] = _activar(ines, e["tipo"])
    e["pedro"] = _persona("pedro", "procesos.configurar", "procesos.ver_todas")
    _, pedro = e["pedro"]
    th, _ = e["th"]
    e["tipo_proceso"] = _crear_tipo_de_proceso(
        pedro, aprobadores=[{"tipo": "persona", "usuario": th.id}]
    )
    return e


def _codigos_de_error(respuesta):
    return respuesta.json()["error"]["details"]


# --- Categoría por defecto y parámetro inválido ------------------------------------------


def test_sin_categoria_todo_es_proyecto_como_antes(proyecto):  # noqa: F811
    _, ines = proyecto["admin"]
    assert proyecto["tipo"]["categoria"] == "proyecto"
    assert TipoProyecto.objects.get(pk=proyecto["tipo"]["id"]).categoria == "proyecto"
    tipo = _activar(ines, proyecto["tipo"])
    _, ana = proyecto["ana"]
    listado = ana.get(PARA_SOLICITAR).json()
    assert [t["categoria"] for t in listado] == ["proyecto"]
    creada = _solicitar(ana, tipo)
    assert creada.status_code == 201, creada.data
    assert re.fullmatch(r"PRY-\d{4}-\d{4,}", creada.json()["numero"])


@pytest.mark.parametrize(
    "url",
    [PARA_SOLICITAR, TIPOS, SOLICITUDES, RESUMEN, OPCIONES],
)
def test_una_categoria_que_no_existe_es_400(proceso, url):
    _, pedro = proceso["pedro"]
    respuesta = pedro.get(_q(url, "procesoz"))
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "invalid"
    assert "categoria" in _codigos_de_error(respuesta)


def test_categoria_invalida_sin_sesion_sigue_siendo_401(db):
    from rest_framework.test import APIClient

    assert APIClient().get(_q(PARA_SOLICITAR, "otra")).status_code == 401
    assert APIClient().get(_q(TIPOS, "otra")).status_code == 401


def test_categoria_invalida_al_crear_una_solicitud_es_400(proceso):
    _, ana = proceso["ana"]
    respuesta = _solicitar_proceso(ana, proceso["tipo_proceso"], categoria="PROCESOS")
    assert respuesta.status_code == 400
    assert "categoria" in _codigos_de_error(respuesta)


# --- La categoría de un tipo se fija al crear y no cambia --------------------------------


def test_el_tipo_nace_con_la_categoria_del_parametro_y_no_la_cambia(proceso):
    _, pedro = proceso["pedro"]
    tipo = proceso["tipo_proceso"]
    assert tipo["categoria"] == "proceso"
    url = _q(f"{TIPOS}{tipo['id']}/")

    otra = pedro.patch(url, {"categoria": "proyecto"}, format="json")
    assert otra.status_code == 400
    assert "categoria" in _codigos_de_error(otra)

    igual = pedro.patch(url, {"categoria": "proceso", "orden": 3}, format="json")
    assert igual.status_code == 200, igual.data
    assert TipoProyecto.objects.get(pk=tipo["id"]).categoria == "proceso"

    distinta_al_crear = pedro.post(
        _q(TIPOS),
        {
            "nombre": "Baja de proveedor",
            "categoria": "proyecto",
            "pasos": [{"nombre": "Revisión", "aprobadores": [{"tipo": "jefe_inmediato"}]}],
        },
        format="json",
    )
    assert distinta_al_crear.status_code == 400
    assert "categoria" in _codigos_de_error(distinta_al_crear)


def test_el_nombre_no_se_repite_entre_categorias(proceso):
    _, pedro = proceso["pedro"]
    repetido = pedro.post(
        _q(TIPOS),
        {
            "nombre": "proyecto de ti",
            "pasos": [{"nombre": "Revisión", "aprobadores": [{"tipo": "jefe_inmediato"}]}],
        },
        format="json",
    )
    assert repetido.status_code == 400
    assert _codigos_de_error(repetido)["nombre"] == [
        "Ese nombre ya lo usa un tipo de proyecto (en «Solicitud de proyectos»). "
        "Use otro nombre."
    ]

    _, ines = proceso["admin"]
    al_reves = ines.post(
        TIPOS,
        {
            "nombre": "ALTA DE PROVEEDOR EN EL ERP",
            "pasos": [{"nombre": "Revisión", "aprobadores": [{"tipo": "jefe_inmediato"}]}],
        },
        format="json",
    )
    assert al_reves.status_code == 400
    assert _codigos_de_error(al_reves)["nombre"] == [
        "Ese nombre ya lo usa un tipo de proceso (en «Solicitud de procesos»). Use otro nombre."
    ]

    misma = pedro.post(
        _q(TIPOS),
        {
            "nombre": "Alta de proveedor en el ERP",
            "pasos": [{"nombre": "Revisión", "aprobadores": [{"tipo": "jefe_inmediato"}]}],
        },
        format="json",
    )
    assert misma.status_code == 400
    assert _codigos_de_error(misma)["nombre"] == ["Ya hay un tipo de proceso con ese nombre."]


# --- Aislamiento -----------------------------------------------------------------------


def test_los_tipos_de_cada_categoria_no_se_ven_desde_la_otra(proceso):
    _, ana = proceso["ana"]
    proyecto_id, proceso_id = proceso["tipo"]["id"], proceso["tipo_proceso"]["id"]

    assert [t["id"] for t in ana.get(PARA_SOLICITAR).json()] == [proyecto_id]
    assert [t["id"] for t in ana.get(_q(PARA_SOLICITAR)).json()] == [proceso_id]
    assert ana.get(_q(PARA_SOLICITAR)).json()[0]["categoria"] == "proceso"

    # La plantilla para solicitar: la de otra categoría no existe.
    assert ana.get(f"{PARA_SOLICITAR}{proceso_id}/plantilla/").status_code == 404
    assert ana.get(_q(f"{PARA_SOLICITAR}{proceso_id}/plantilla/")).status_code == 200
    assert ana.get(_q(f"{PARA_SOLICITAR}{proyecto_id}/plantilla/")).status_code == 404

    # La configuración, con quien tiene los dos permisos de configurar.
    _, ambos = _persona("ambar", "proyectos.configurar", "procesos.configurar")
    # En proyectos está además el tipo inicial «Solicitud de proyecto» (0002).
    de_proyectos = ambos.get(TIPOS).json()
    assert proyecto_id in [t["id"] for t in de_proyectos]
    assert {t["categoria"] for t in de_proyectos} == {"proyecto"}
    assert [t["id"] for t in ambos.get(_q(TIPOS)).json()] == [proceso_id]
    assert ambos.get(f"{TIPOS}{proceso_id}/").status_code == 404
    assert ambos.patch(f"{TIPOS}{proceso_id}/", {"orden": 9}, format="json").status_code == 404
    assert ambos.delete(f"{TIPOS}{proceso_id}/").status_code == 404
    assert ambos.get(f"{TIPOS}{proceso_id}/plantilla/").status_code == 404
    assert ambos.get(_q(f"{TIPOS}{proyecto_id}/")).status_code == 404
    assert TipoProyecto.objects.filter(pk=proceso_id).exists()


def test_no_se_pide_un_proceso_desde_proyectos_ni_al_reves(proceso):
    _, ana = proceso["ana"]
    desde_proyectos = _solicitar_proceso(ana, proceso["tipo_proceso"], categoria="proyecto")
    inexistente = _solicitar_proceso(ana, {**proceso["tipo_proceso"], "id": 999999})
    # Igual que con un tipo que no existe: el error va en el campo.
    assert desde_proyectos.status_code == inexistente.status_code == 400
    assert "tipo_proyecto" in _codigos_de_error(desde_proyectos)
    # El mismo mensaje, salvo el id que cita.
    assert _codigos_de_error(desde_proyectos)["tipo_proyecto"][0].replace(
        str(proceso["tipo_proceso"]["id"]), "N"
    ) == _codigos_de_error(inexistente)["tipo_proyecto"][0].replace("999999", "N")

    al_reves = ana.post(
        _q(SOLICITUDES),
        {
            "tipo_proyecto": proceso["tipo"]["id"],
            "titulo": "Nuevo CRM",
            "respuestas": "{}",
            "archivo": _docx("plantilla-llena.docx"),
        },
        format="multipart",
    )
    assert al_reves.status_code == 400
    assert "tipo_proyecto" in _codigos_de_error(al_reves)


def test_una_solicitud_de_proceso_da_404_desde_proyectos(proceso):
    _, ana = proceso["ana"]
    th, tatiana = proceso["th"]
    _, ines = proceso["admin"]  # ve todas las de proyecto, no las de proceso
    _, pedro = proceso["pedro"]
    creada = _solicitar_proceso(ana, proceso["tipo_proceso"])
    assert creada.status_code == 201, creada.data
    sid = creada.json()["id"]

    for cliente in (ana, tatiana, pedro):
        assert cliente.get(f"{SOLICITUDES}{sid}/").status_code == 404
        assert cliente.get(f"{SOLICITUDES}{sid}/archivo/").status_code == 404
        assert cliente.get(_q(f"{SOLICITUDES}{sid}/")).status_code == 200
    for accion in ("aprobar", "rechazar", "cancelar", "escalar"):
        respuesta = tatiana.post(
            f"{SOLICITUDES}{sid}/{accion}/", {"comentario": "No."}, format="json"
        )
        assert respuesta.status_code == 404, accion

    # Los listados de proyectos no la traen; los de procesos sí.
    assert ana.get(SOLICITUDES).json() == []
    assert [s["id"] for s in ana.get(_q(SOLICITUDES)).json()] == [sid]
    assert tatiana.get(SOLICITUDES, {"vista": "por_atender"}).json() == []
    assert [
        s["id"] for s in tatiana.get(SOLICITUDES, {"vista": "por_atender", **PROCESO}).json()
    ] == [sid]
    assert sid not in [s["id"] for s in ines.get(SOLICITUDES, {"vista": "todas"}).json()]
    assert [s["id"] for s in pedro.get(SOLICITUDES, {"vista": "todas", **PROCESO}).json()] == [sid]

    # Ver todas las de proyecto no abre una de proceso.
    assert ines.get(_q(f"{SOLICITUDES}{sid}/")).status_code == 404

    aprobada = tatiana.post(_q(f"{SOLICITUDES}{sid}/aprobar/"), {}, format="json")
    assert aprobada.status_code == 200, aprobada.data
    assert aprobada.json()["estado"] == "aprobada"


def test_el_resumen_cuenta_solo_lo_de_su_categoria(proceso):
    _, ana = proceso["ana"]
    th, tatiana = proceso["th"]
    assert _solicitar_proceso(ana, proceso["tipo_proceso"]).status_code == 201
    assert _solicitar_proceso(ana, proceso["tipo_proceso"], titulo="Otro").status_code == 201
    # La de proyecto empieza con la jefa inmediata, no con Tatiana.
    _, julia = proceso["jefa"]
    assert _solicitar(ana, proceso["tipo"]).status_code == 201

    assert tatiana.get(RESUMEN).json() == {"por_atender": 0}
    assert tatiana.get(_q(RESUMEN)).json() == {"por_atender": 2}
    assert julia.get(RESUMEN).json() == {"por_atender": 1}
    assert julia.get(_q(RESUMEN)).json() == {"por_atender": 0}
    assert julia.get(_q(RESUMEN, "proyecto")).json() == {"por_atender": 1}


# --- Permisos por categoría -----------------------------------------------------------


def test_configurar_proyectos_no_configura_procesos_ni_al_reves(proceso):
    _, solo_proyectos = _persona("sofia", "proyectos.configurar")
    _, solo_procesos = _persona("pablo", "procesos.configurar")
    proceso_id = proceso["tipo_proceso"]["id"]
    nuevo = {
        "nombre": "Cierre contable mensual",
        "pasos": [{"nombre": "Revisión", "aprobadores": [{"tipo": "jefe_inmediato"}]}],
    }

    assert solo_proyectos.get(_q(TIPOS)).status_code == 403
    assert solo_proyectos.post(_q(TIPOS), nuevo, format="json").status_code == 403
    assert solo_proyectos.get(_q(f"{TIPOS}{proceso_id}/")).status_code == 403
    assert solo_proyectos.get(_q(OPCIONES)).status_code == 403
    denegado = solo_proyectos.get(_q(TIPOS)).json()["error"]
    assert "procesos.configurar" in denegado["message"]

    assert solo_procesos.get(TIPOS).status_code == 403
    assert solo_procesos.post(TIPOS, nuevo, format="json").status_code == 403
    assert solo_procesos.get(OPCIONES).status_code == 403
    assert solo_procesos.get(_q(TIPOS)).status_code == 200
    assert solo_procesos.get(_q(OPCIONES)).status_code == 200
    creado = solo_procesos.post(_q(TIPOS), nuevo, format="json")
    assert creado.status_code == 201, creado.data
    assert creado.json()["categoria"] == "proceso"

    assert AuditLog.objects.filter(
        action="procesos.tipo.creado", module="procesos", target_id=str(creado.json()["id"])
    ).exists()


def test_ver_todas_es_de_cada_categoria(proceso):
    _, ana = proceso["ana"]
    _, ines = proceso["admin"]  # proyectos.ver_todas
    _, pedro = proceso["pedro"]  # procesos.ver_todas
    sid = _solicitar_proceso(ana, proceso["tipo_proceso"]).json()["id"]

    assert ines.get(SOLICITUDES, {"vista": "todas", **PROCESO}).status_code == 403
    assert pedro.get(SOLICITUDES, {"vista": "todas"}).status_code == 403
    detalle = pedro.get(_q(f"{SOLICITUDES}{sid}/")).json()
    assert detalle["puedo"]["escalar"] is True


def test_con_ver_todas_de_procesos_se_escala_un_proceso_ajeno(proceso):
    """QA-FUNC (US-008): `procesos.ver_todas` escala una PRC que no tiene
    pendiente; `proyectos.ver_todas` ni siquiera la ve."""
    _, ana = proceso["ana"]
    th, _ = proceso["th"]
    _, ines = proceso["admin"]  # proyectos.ver_todas
    _, pedro = proceso["pedro"]  # procesos.ver_todas
    otro, _ = proceso["otro"]
    sid = _solicitar_proceso(ana, proceso["tipo_proceso"]).json()["id"]
    cuerpo = {
        "destino": {"tipo": "persona", "usuario": otro.id},
        "comentario": "Lo revisa Óscar mientras Tatiana está en auditoría.",
    }

    ajeno = ines.post(_q(f"{SOLICITUDES}{sid}/escalar/"), cuerpo, format="json")
    assert ajeno.status_code == 404

    escalada = pedro.post(_q(f"{SOLICITUDES}{sid}/escalar/"), cuerpo, format="json")
    assert escalada.status_code == 200, escalada.data
    assert [p["id"] for p in escalada.json()["pendiente_de"]] == [otro.id]
    assert th.id not in [p["id"] for p in escalada.json()["pendiente_de"]]
    aviso = Notificacion.objects.get(usuario=otro, tipo="procesos.por_atender")
    assert aviso.enlace == f"/admin/institucional/procesos?solicitud={sid}"


def test_quien_tiene_un_proceso_pendiente_ve_las_opciones_solo_de_procesos(proceso):
    """QA-FUNC (US-008): tener por decidir una PRC abre las opciones de
    procesos, no las de proyectos."""
    _, ana = proceso["ana"]
    _, tatiana = proceso["th"]  # sin permisos de proyectos ni de procesos
    assert tatiana.get(_q(OPCIONES)).status_code == 403
    assert _solicitar_proceso(ana, proceso["tipo_proceso"]).status_code == 201

    assert tatiana.get(OPCIONES).status_code == 403
    opciones = tatiana.get(_q(OPCIONES))
    assert opciones.status_code == 200
    assert {"personas", "roles", "cargos", "destinos"} <= set(opciones.json())


def test_mis_datos_separa_las_solicitudes_de_procesos(proceso):
    """El export de datos personales (LOPDP) trae las de proceso en su propia
    sección, y las de proyecto en la de siempre."""
    from apps.privacidad import mis_datos

    ana_usuario, ana = proceso["ana"]
    de_proceso = _solicitar_proceso(ana, proceso["tipo_proceso"]).json()
    de_proyecto = _solicitar(ana, proceso["tipo"]).json()
    ctx = mis_datos.Contexto(titular=ana_usuario, lector=ana_usuario)

    procesos = mis_datos._solicitudes_de_procesos(ctx)
    proyectos = mis_datos._solicitudes_de_proyectos(ctx)
    assert [f["numero"] for f in procesos] == [de_proceso["numero"]]
    assert procesos[0]["tipo_de_proceso"] == "Alta de proveedor en el ERP"
    assert [f["numero"] for f in proyectos] == [de_proyecto["numero"]]
    assert proyectos[0]["tipo_de_proyecto"] == "Proyecto de TI"
    claves = [s.clave for s in mis_datos.SECCIONES]
    assert claves.index("solicitudes_de_procesos") == claves.index("solicitudes_de_proyectos") + 1


def test_sin_nadie_para_decidir_queda_en_manos_de_quien_configura_procesos(proceso):
    _, pedro = proceso["pedro"]
    _, ana = proceso["ana"]
    rol_vacio = Group.objects.create(name="Auditoría de procesos (sin miembros)")
    tipo = _crear_tipo_de_proceso(
        pedro,
        nombre="Rediseño del proceso de cobro",
        aprobadores=[{"tipo": "rol", "rol": rol_vacio.id}],
    )
    creada = _solicitar_proceso(ana, tipo)
    assert creada.status_code == 201, creada.data
    pendientes = {p["nombre"] for p in creada.json()["pendiente_de"]}
    assert pendientes == {"Pedro"}  # no Inés, que configura proyectos
    asignada = [a for a in creada.json()["acciones"] if a["accion"] == "asignada"][-1]
    assert "quien administra los tipos de proceso" in asignada["detalle"]


# --- Numeración, avisos y auditoría ---------------------------------------------------


def test_los_procesos_se_numeran_prc_y_los_proyectos_pry(proceso):
    _, ana = proceso["ana"]
    de_proceso = _solicitar_proceso(ana, proceso["tipo_proceso"]).json()
    de_proyecto = _solicitar(ana, proceso["tipo"]).json()
    assert re.fullmatch(r"PRC-\d{4}-\d{4,}", de_proceso["numero"])
    assert de_proceso["numero"].endswith(f"-{de_proceso['id']:04d}")
    assert re.fullmatch(r"PRY-\d{4}-\d{4,}", de_proyecto["numero"])
    assert AuditLog.objects.filter(
        action="procesos.solicitud.creada", module="procesos", target_id=str(de_proceso["id"])
    ).exists()
    assert AuditLog.objects.filter(
        action="proyectos.solicitud.creada", module="proyectos", target_id=str(de_proyecto["id"])
    ).exists()


def test_los_avisos_de_un_proceso_dicen_proceso_y_enlazan_a_procesos(proceso):
    ana_usuario, ana = proceso["ana"]
    th, tatiana = proceso["th"]
    julia_usuario, _ = proceso["jefa"]
    sid = _solicitar_proceso(ana, proceso["tipo_proceso"]).json()["id"]

    aviso = Notificacion.objects.get(usuario=th, tipo="procesos.por_atender")
    assert aviso.enlace == f"/admin/institucional/procesos?solicitud={sid}"
    assert aviso.titulo.startswith("Solicitud de proceso por atender")
    assert aviso.modulo == "procesos"

    assert tatiana.post(_q(f"{SOLICITUDES}{sid}/aprobar/"), {}, format="json").status_code == 200
    resultado = Notificacion.objects.get(usuario=ana_usuario, tipo="procesos.aprobada")
    assert resultado.titulo == "Su proceso fue aprobado: se puede iniciar"
    assert resultado.enlace == f"/admin/institucional/procesos?solicitud={sid}"
    assert AuditLog.objects.filter(action="procesos.solicitud.aprobada", module="procesos").exists()

    # Los de proyecto siguen igual.
    pid = _solicitar(ana, proceso["tipo"]).json()["id"]
    de_proyecto = Notificacion.objects.get(usuario=julia_usuario, tipo="proyectos.por_atender")
    assert de_proyecto.enlace == f"/admin/institucional/proyectos?solicitud={pid}"
    assert "proyecto" in de_proyecto.titulo


def test_la_reasignacion_por_ausencia_avisa_con_el_enlace_de_su_categoria(proceso):
    """`reasignar_por_ausencia` recorre las dos categorías y cada aviso lleva a
    su pantalla."""
    from apps.proyectos import services

    ana_usuario, ana = proceso["ana"]
    th, _ = proceso["th"]
    reemplazo, _ = _persona("rebeca")
    sid = _solicitar_proceso(ana, proceso["tipo_proceso"]).json()["id"]

    assert services.reasignar_por_ausencia(th, base=reemplazo) == 1
    aviso = Notificacion.objects.get(usuario=reemplazo, tipo="procesos.por_atender")
    assert aviso.enlace == f"/admin/institucional/procesos?solicitud={sid}"


# --- La migración de roles ------------------------------------------------------------


def test_la_migracion_concede_los_permisos_de_procesos_segun_los_de_proyectos(db):
    migracion = importlib.import_module("apps.roles.migrations.0048_permisos_de_procesos")
    tipo = {"content_type__app_label": "permissions"}
    p_conf = Permission.objects.get(codename="proyectos.configurar", **tipo)
    p_todas = Permission.objects.get(codename="proyectos.ver_todas", **tipo)
    c_conf = Permission.objects.get(codename="procesos.configurar", **tipo)
    c_todas = Permission.objects.get(codename="procesos.ver_todas", **tipo)

    configura = Group.objects.create(name="Coordinador de Proyectos (prueba)")
    configura.permissions.add(p_conf)
    ve_todas = Group.objects.create(name="Gerencia de Operaciones (prueba)")
    ve_todas.permissions.add(p_todas)
    otro = Group.objects.create(name="Analista de Cobranzas (prueba)")
    administrador, _ = Group.objects.get_or_create(name="Administrador")
    superusuario, _ = Group.objects.get_or_create(name="Superusuario")
    for rol in (administrador, superusuario):
        rol.permissions.remove(c_conf, c_todas)
    cuenta, _ = _persona("cuenta.directa", "proyectos.configurar", con_rol=False)
    cuenta_todas, _ = _persona("cuenta.todas", "proyectos.ver_todas", con_rol=False)

    migracion.conceder(django_apps, None)
    migracion.conceder(django_apps, None)  # idempotente

    def tiene(rol, permiso):
        return rol.permissions.filter(pk=permiso.pk).exists()

    assert tiene(configura, c_conf) and not tiene(configura, c_todas)
    assert tiene(ve_todas, c_todas) and not tiene(ve_todas, c_conf)
    assert not tiene(otro, c_conf) and not tiene(otro, c_todas)
    for rol in (administrador, superusuario):
        assert tiene(rol, c_conf) and tiene(rol, c_todas)
    assert set(cuenta.user_permissions.values_list("codename", flat=True)) == {
        "proyectos.configurar",
        "procesos.configurar",
    }
    assert set(cuenta_todas.user_permissions.values_list("codename", flat=True)) == {
        "proyectos.ver_todas",
        "procesos.ver_todas",
    }

    migracion.retirar(django_apps, None)
    assert not tiene(configura, c_conf)
    assert not tiene(ve_todas, c_todas)
    assert not tiene(administrador, c_conf)
    assert not cuenta.user_permissions.filter(pk=c_conf.pk).exists()
    # Los permisos de proyectos no se tocan al revertir.
    assert tiene(configura, p_conf) and tiene(ve_todas, p_todas)
    assert cuenta.user_permissions.filter(pk=p_conf.pk).exists()


def test_los_permisos_de_procesos_estan_en_el_catalogo_del_grupo_institucional():
    from apps.permissions.catalog import PERMISSION_CATALOG, all_codenames

    assert {"procesos.configurar", "procesos.ver_todas"} <= set(all_codenames())
    assert PERMISSION_CATALOG["procesos"]["grupo"]["id"] == "institucional"
