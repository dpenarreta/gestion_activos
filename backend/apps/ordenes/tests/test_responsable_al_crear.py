"""US-006: la orden nace con responsable y fecha programada.

Lo que se protege: que no se pueda crear una orden sin quién la realiza ni
para cuándo (CA-1, CA-4), que el campo «Quién la realiza» ofrezca proveedores
y personas de la empresa (CA-2), que se pueda registrar un proveedor nuevo sin
duplicar el catálogo (CA-3) y que la orden creada con responsable quede igual
que una asignada después: estado, movimiento y aviso (CA-5).
"""

import datetime

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.notificaciones.models import Notificacion
from apps.ordenes.models import OrdenTrabajo
from apps.organizacion.models import Proveedor
from apps.permissions.models import ModulePermission
from apps.users.models import User

# El fixture `escenario` se importa y se pide como argumento: ruff ve una
# redefinición (F811) donde pytest ve una inyección.
# ruff: noqa: F811
from .test_ordenes import (
    BASE,
    _campos_con_error,
    _cliente,
    _crear,
    _cuenta,
    escenario,  # noqa: F401 (fixture)
)

pytestmark = pytest.mark.django_db

RESPONSABLES = f"{BASE}responsables/"
PROVEEDORES = f"{BASE}proveedores/"


def _hoy():
    return timezone.localdate()


def _datos(sede, **extra):
    return {
        "sede": sede.id,
        "categoria": "climatizacion",
        "prioridad": "media",
        "titulo": "El aire de la bodega gotea",
        "telefono_contacto": "099 418 2273",
        **extra,
    }


def _otra_empresa():
    return Empresa.objects.get_or_create(codigo="OTR", defaults={"nombre": "Otra empresa"})[0]


def _cuenta_en(empresa, nombre, *permisos, **datos):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!", **datos
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=[f"ordenes.{p}" for p in permisos],
        )
    )
    MembresiaEmpresa.objects.get_or_create(usuario=usuario, empresa=empresa)
    return usuario


# --- CA-1 y CA-4: responsable y fecha obligatorios -------------------------


def test_sin_responsable_no_se_crea(escenario):
    r = _cliente(escenario["solicitante"]).post(
        BASE, _datos(escenario["quito"], fecha_programada=_hoy().isoformat()), format="json"
    )
    assert r.status_code == 400
    assert r.data["error"]["details"]["responsable"] == [
        "Indique el proveedor o la persona que realizará la orden."
    ]
    assert not OrdenTrabajo.objects.exists()


def test_responsables_nulos_explicitos_tambien_fallan(escenario):
    r = _cliente(escenario["solicitante"]).post(
        BASE,
        _datos(
            escenario["quito"], tecnico=None, proveedor=None, fecha_programada=_hoy().isoformat()
        ),
        format="json",
    )
    assert r.status_code == 400 and "responsable" in _campos_con_error(r)


def test_sin_fecha_programada_no_se_crea(escenario):
    proveedor = Proveedor.objects.create(nombre="Climatización Ñuñoa")
    r = _cliente(escenario["solicitante"]).post(
        BASE, _datos(escenario["quito"], proveedor=proveedor.id), format="json"
    )
    assert r.status_code == 400
    assert _campos_con_error(r) == {"fecha_programada"}
    assert not OrdenTrabajo.objects.exists()


def test_fecha_pasada_no_se_acepta_y_hoy_si(escenario):
    proveedor = Proveedor.objects.create(nombre="Climatización Ñuñoa")
    cliente = _cliente(escenario["solicitante"])
    ayer = (_hoy() - datetime.timedelta(days=1)).isoformat()
    r = cliente.post(
        BASE,
        _datos(escenario["quito"], proveedor=proveedor.id, fecha_programada=ayer),
        format="json",
    )
    assert r.status_code == 400
    assert r.data["error"]["details"]["fecha_programada"] == [
        "La fecha programada no puede ser anterior a hoy."
    ]
    r = cliente.post(
        BASE,
        _datos(escenario["quito"], proveedor=proveedor.id, fecha_programada=_hoy().isoformat()),
        format="json",
    )
    assert r.status_code == 201, r.data


def test_faltan_los_dos_y_se_dicen_los_dos(escenario):
    r = _cliente(escenario["solicitante"]).post(BASE, _datos(escenario["quito"]), format="json")
    assert r.status_code == 400
    assert _campos_con_error(r) == {"responsable", "fecha_programada"}


# --- CA-2 y CA-5: con proveedor, con técnico, con técnico de proveedor -----


def test_con_proveedor_sin_persona(escenario, django_capture_on_commit_callbacks):
    proveedor = Proveedor.objects.create(nombre="Técnico Peñaherrera")
    manana = _hoy() + datetime.timedelta(days=1)
    with django_capture_on_commit_callbacks(execute=True):
        orden = _crear(
            _cliente(escenario["solicitante"]),
            escenario["quito"],
            proveedor=proveedor.id,
            fecha_programada=manana.isoformat(),
        )
    assert orden["estado"] == "programada"
    assert orden["tecnico"] is None
    assert orden["proveedor"] == {"id": proveedor.id, "nombre": "Técnico Peñaherrera"}
    assert orden["responsable"] == "Técnico Peñaherrera"
    assert orden["fecha_programada"] == manana.isoformat()
    ultimo = orden["movimientos"][-1]
    assert ultimo["descripcion"] == (
        f"Asignó {orden['numero']} a Técnico Peñaherrera para el {manana:%Y-%m-%d}"
    )
    assert (ultimo["estado_anterior"], ultimo["estado_nuevo"]) == ("solicitada", "programada")
    # Sin persona con cuenta no hay a quién avisar.
    assert not Notificacion.objects.filter(tipo="ordenes.asignada").exists()


def test_con_tecnico_interno_se_le_avisa_y_la_ve(escenario, django_capture_on_commit_callbacks):
    e = escenario
    with django_capture_on_commit_callbacks(execute=True):
        orden = _crear(
            _cliente(e["solicitante"]),
            e["quito"],
            tecnico=e["tecnico"].id,
            fecha_programada=_hoy().isoformat(),
        )
    assert orden["estado"] == "programada"
    assert orden["tecnico"] == {"id": e["tecnico"].id, "nombre": "Jorge"}
    assert orden["proveedor"] is None
    assert orden["responsable"] == "Jorge"
    aviso = Notificacion.objects.get(usuario=e["tecnico"], tipo="ordenes.asignada")
    assert aviso.titulo == "Orden de trabajo asignada"
    assert aviso.enlace == f"/admin/ordenes/lista/{orden['id']}"
    assert orden["numero"] in aviso.resumen
    # El técnico la ve y puede empezarla.
    detalle = _cliente(e["tecnico"]).get(f"{BASE}{orden['id']}/")
    assert detalle.status_code == 200
    assert detalle.data["permisos"]["acciones"] == ["en_ejecucion"]


def test_con_persona_de_un_proveedor_guarda_las_dos_cosas(escenario):
    e = escenario
    proveedor = Proveedor.objects.create(nombre="Climas del Sur")
    orden = _crear(
        _cliente(e["solicitante"]),
        e["quito"],
        tecnico=e["tecnico"].id,
        proveedor=proveedor.id,
        fecha_programada=_hoy().isoformat(),
    )
    assert orden["tecnico"]["id"] == e["tecnico"].id
    assert orden["proveedor"]["id"] == proveedor.id
    assert orden["responsable"] == "Jorge (Climas del Sur)"
    registro = AuditLog.objects.get(module="ordenes", action="orden.created")
    assert registro.new_values["tecnico"] == e["tecnico"].id
    assert registro.new_values["proveedor"] == proveedor.id
    assert registro.new_values["estado"] == "programada"


def test_solo_personas_que_pueden_atender(escenario):
    e = escenario
    r = _cliente(e["solicitante"]).post(
        BASE,
        _datos(e["quito"], tecnico=e["responsable"].id, fecha_programada=_hoy().isoformat()),
        format="json",
    )
    assert r.status_code == 400
    assert _campos_con_error(r) == {"tecnico"}


def test_tecnico_de_otra_empresa_no_vale(escenario):
    ajeno = _cuenta_en(_otra_empresa(), "ramiro", "ver", "ejecutar", first_name="Ramiro")
    r = _cliente(escenario["solicitante"]).post(
        BASE,
        _datos(escenario["quito"], tecnico=ajeno.id, fecha_programada=_hoy().isoformat()),
        format="json",
    )
    assert r.status_code == 400 and "tecnico" in _campos_con_error(r)


def test_proveedor_de_otra_empresa_o_desactivado_no_vale(escenario):
    with usando_empresa(_otra_empresa()):
        ajeno = Proveedor.objects.create(nombre="Proveedor Ajeno")
    inactivo = Proveedor.objects.create(nombre="Ya No Trabaja", activo=False)
    cliente = _cliente(escenario["solicitante"])
    for proveedor in (ajeno, inactivo):
        r = cliente.post(
            BASE,
            _datos(escenario["quito"], proveedor=proveedor.id, fecha_programada=_hoy().isoformat()),
            format="json",
        )
        assert r.status_code == 400 and "proveedor" in _campos_con_error(r), proveedor.nombre


def test_crear_con_responsable_deja_lo_mismo_que_asignar(
    escenario, django_capture_on_commit_callbacks
):
    """CA-5: el movimiento y el aviso de la orden que nace con técnico son los
    de la asignación de siempre."""
    e = escenario
    fecha = _hoy() + datetime.timedelta(days=2)
    with django_capture_on_commit_callbacks(execute=True):
        creada = _crear(
            _cliente(e["coordinador"]),
            e["quito"],
            tecnico=e["tecnico"].id,
            fecha_programada=fecha.isoformat(),
        )
        asignada = _crear(_cliente(e["coordinador"]), e["manta"])
        r = _cliente(e["coordinador"]).post(
            f"{BASE}{asignada['id']}/asignar/",
            # `proveedor: null` quita el proveedor con el que nació.
            {"tecnico": e["tecnico"].id, "proveedor": None, "fecha_programada": fecha.isoformat()},
            format="json",
        )
        assert r.status_code == 200, r.data
        asignada = r.data

    def sin_numero(orden):
        return orden["movimientos"][-1]["descripcion"].replace(orden["numero"], "OT")

    assert (
        sin_numero(creada) == sin_numero(asignada) == f"Asignó OT a Jorge para el {fecha:%Y-%m-%d}"
    )
    assert creada["estado"] == asignada["estado"] == "programada"
    avisos = Notificacion.objects.filter(usuario=e["tecnico"], tipo="ordenes.asignada")
    assert avisos.count() == 2
    assert {a.titulo for a in avisos} == {"Orden de trabajo asignada"}
    assert {a.enlace for a in avisos} == {
        f"/admin/ordenes/lista/{creada['id']}",
        f"/admin/ordenes/lista/{asignada['id']}",
    }


def test_quien_se_asigna_a_si_mismo_no_se_avisa(escenario, django_capture_on_commit_callbacks):
    autonomo = _cuenta("lucia", "ver", "crear", "ejecutar")
    with django_capture_on_commit_callbacks(execute=True):
        _crear(
            _cliente(autonomo),
            escenario["quito"],
            tecnico=autonomo.id,
            fecha_programada=_hoy().isoformat(),
        )
    assert not Notificacion.objects.filter(usuario=autonomo).exists()


def test_reasignar_a_una_persona_conserva_el_proveedor_salvo_null(
    escenario, django_capture_on_commit_callbacks
):
    e = escenario
    orden = _crear(_cliente(e["solicitante"]), e["quito"])  # solo proveedor
    url = f"{BASE}{orden['id']}/asignar/"
    # Reasignar sigue siendo de quien coordina.
    assert (
        _cliente(e["solicitante"])
        .post(url, {"tecnico": e["tecnico"].id}, format="json")
        .status_code
        == 403
    )
    nueva = (_hoy() + datetime.timedelta(days=5)).isoformat()
    with django_capture_on_commit_callbacks(execute=True):
        r = _cliente(e["coordinador"]).post(
            url, {"tecnico": e["tecnico"].id, "fecha_programada": nueva}, format="json"
        )
    assert r.status_code == 200, r.data
    assert r.data["responsable"] == "Jorge (Electro Servicios Andinos)"
    assert r.data["fecha_programada"] == nueva
    # Pasó de no tener técnico a tenerlo: se le avisa.
    assert Notificacion.objects.filter(usuario=e["tecnico"], tipo="ordenes.asignada").count() == 1

    r = _cliente(e["coordinador"]).post(
        url, {"tecnico": e["tecnico"].id, "proveedor": None}, format="json"
    )
    assert r.status_code == 200, r.data
    assert r.data["responsable"] == "Jorge" and r.data["proveedor"] is None


def test_asignar_solo_a_un_proveedor_sin_inventar_tecnico(
    escenario, django_capture_on_commit_callbacks
):
    e = escenario
    climas = Proveedor.objects.create(nombre="Climas del Sur")
    orden = _crear(
        _cliente(e["coordinador"]),
        e["quito"],
        tecnico=e["tecnico"].id,
        fecha_programada=_hoy().isoformat(),
    )
    url = f"{BASE}{orden['id']}/asignar/"
    with django_capture_on_commit_callbacks(execute=True):
        r = _cliente(e["coordinador"]).post(
            url, {"tecnico": None, "proveedor": climas.id}, format="json"
        )
    assert r.status_code == 200, r.data
    assert r.data["tecnico"] is None
    assert r.data["responsable"] == "Climas del Sur"
    assert r.data["movimientos"][-1]["descripcion"].endswith(
        "a Climas del Sur para el " + _hoy().isoformat()
    )
    # Sin persona nueva no hay a quién avisar (el alta quedó fuera del bloque
    # que ejecuta los avisos: lo único que podría haber es el de este paso).
    assert not Notificacion.objects.filter(tipo="ordenes.asignada").exists()
    # Y el técnico que la tenía deja de verla.
    assert _cliente(e["tecnico"]).get(f"{BASE}{orden['id']}/").status_code == 404


def test_asignar_valida_como_al_crear(escenario):
    e = escenario
    orden = _crear(_cliente(e["coordinador"]), e["quito"])
    url = f"{BASE}{orden['id']}/asignar/"
    coordinador = _cliente(e["coordinador"])

    r = coordinador.post(url, {"tecnico": None, "proveedor": None}, format="json")
    assert r.status_code == 400 and _campos_con_error(r) == {"responsable"}

    inactivo = Proveedor.objects.create(nombre="Ya No Trabaja", activo=False)
    r = coordinador.post(url, {"proveedor": inactivo.id}, format="json")
    assert r.status_code == 400 and _campos_con_error(r) == {"proveedor"}

    ayer = (_hoy() - datetime.timedelta(days=1)).isoformat()
    r = coordinador.post(url, {"fecha_programada": ayer}, format="json")
    assert r.status_code == 400 and _campos_con_error(r) == {"fecha_programada"}

    r = coordinador.post(url, {"tecnico": e["responsable"].id}, format="json")
    assert r.status_code == 400 and _campos_con_error(r) == {"tecnico"}

    # Sin cambiar nada no hay nada que asignar.
    r = coordinador.post(url, {}, format="json")
    assert r.status_code == 400 and _campos_con_error(r) == {"responsable"}


def test_reprogramar_con_el_mismo_responsable_no_reasigna(
    escenario, django_capture_on_commit_callbacks
):
    e = escenario
    with django_capture_on_commit_callbacks(execute=True):
        orden = _crear(
            _cliente(e["coordinador"]),
            e["quito"],
            tecnico=e["tecnico"].id,
            fecha_programada=_hoy().isoformat(),
        )
    url = f"{BASE}{orden['id']}/asignar/"
    nueva = _hoy() + datetime.timedelta(days=3)
    with django_capture_on_commit_callbacks(execute=True):
        r = _cliente(e["coordinador"]).post(
            url,
            {"fecha_programada": nueva.isoformat(), "nota": "Llega el repuesto el jueves."},
            format="json",
        )
    assert r.status_code == 200, r.data
    ultimo = r.data["movimientos"][-1]
    assert ultimo["descripcion"] == f"Reprogramó {orden['numero']} para el {nueva:%Y-%m-%d}"
    assert ultimo["nota"] == "Llega el repuesto el jueves."
    assert r.data["fecha_programada"] == nueva.isoformat()
    assert r.data["responsable"] == "Jorge"
    # Solo el aviso del alta: reprogramar no vuelve a mandar «asignada».
    assert Notificacion.objects.filter(usuario=e["tecnico"], tipo="ordenes.asignada").count() == 1


def test_reprogramar_con_proveedor_desactivado_despues(escenario):
    e = escenario
    climas = Proveedor.objects.create(nombre="Climas del Sur")
    orden = _crear(
        _cliente(e["coordinador"]),
        e["quito"],
        proveedor=climas.id,
        fecha_programada=_hoy().isoformat(),
    )
    Proveedor.objects.filter(pk=climas.pk).update(activo=False)
    nueva = (_hoy() + datetime.timedelta(days=1)).isoformat()
    r = _cliente(e["coordinador"]).post(
        f"{BASE}{orden['id']}/asignar/", {"fecha_programada": nueva}, format="json"
    )
    assert r.status_code == 200, r.data
    assert r.data["responsable"] == "Climas del Sur"


def test_orden_nueva_avisa_a_quien_coordina(escenario, django_capture_on_commit_callbacks):
    e = escenario
    with django_capture_on_commit_callbacks(execute=True):
        orden = _crear(_cliente(e["solicitante"]), e["quito"])
    aviso = Notificacion.objects.get(tipo="ordenes.creada")
    assert aviso.usuario == e["coordinador"]
    assert aviso.titulo == "Orden de trabajo nueva"
    assert aviso.enlace == f"/admin/ordenes/lista/{orden['id']}"
    assert "a cargo de Electro Servicios Andinos" in aviso.resumen
    # Quien coordina y crea no se avisa a sí mismo ni a sus pares.
    with django_capture_on_commit_callbacks(execute=True):
        _crear(_cliente(e["coordinador"]), e["manta"])
    assert Notificacion.objects.filter(tipo="ordenes.creada").count() == 1


def test_crear_sigue_pidiendo_el_permiso_de_crear(escenario):
    r = _cliente(escenario["tecnico"]).post(
        BASE,
        _datos(
            escenario["quito"], tecnico=escenario["tecnico"].id, fecha_programada=_hoy().isoformat()
        ),
        format="json",
    )
    assert r.status_code == 403


# --- CA-2: búsqueda de responsables ---------------------------------------


def test_busqueda_agrupada_por_empresa_y_sin_tildes(escenario):
    e = escenario
    climas = Proveedor.objects.create(nombre="Climatización Peñaherrera")
    Proveedor.objects.create(nombre="Climatizadora Retirada", activo=False)
    Proveedor.objects.create(nombre="Electricidad Andina")
    with usando_empresa(_otra_empresa()):
        Proveedor.objects.create(nombre="Climatización Ajena")
    _cuenta_en(_otra_empresa(), "climaco", "ver", "ejecutar", first_name="Clímaco")
    andres = _cuenta("andres", "ver", "ejecutar")
    andres.first_name, andres.last_name = "Andrés", "Climaco Núñez"
    andres.save()
    # Andrés ya trabajó una orden con Climatización Peñaherrera: quien puede
    # ver esa orden lo ve ofrecido con ese proveedor.
    _crear(
        _cliente(e["coordinador"]),
        e["quito"],
        tecnico=andres.id,
        proveedor=climas.id,
        fecha_programada=_hoy().isoformat(),
    )

    r = _cliente(e["coordinador"]).get(RESPONSABLES, {"q": "CLIMA"})
    assert r.status_code == 200
    assert r.data["proveedores"] == [{"id": climas.id, "nombre": "Climatización Peñaherrera"}]
    assert r.data["personas"] == [
        {
            "id": andres.id,
            "nombre": "Andrés Climaco Núñez",
            "proveedor": {"id": climas.id, "nombre": "Climatización Peñaherrera"},
        }
    ]
    # Quien no ve esa orden no se entera de con quién trabajó Andrés.
    r = _cliente(e["solicitante"]).get(RESPONSABLES, {"q": "CLIMA"})
    assert r.data["personas"] == [
        {"id": andres.id, "nombre": "Andrés Climaco Núñez", "proveedor": None}
    ]


def test_busqueda_no_encuentra_por_cedula_ni_ruc(escenario):
    """Buscar por identificación sería un oráculo de cédulas para quien solo
    crea órdenes: se busca por nombre o contacto."""
    Proveedor.objects.create(
        nombre="Íñigo Peñafiel", identificacion="1712345678", contacto="Íñigo Peñafiel"
    )
    cliente = _cliente(escenario["solicitante"])
    assert cliente.get(RESPONSABLES, {"q": "1712345678"}).data["proveedores"] == []
    assert [
        p["nombre"] for p in cliente.get(RESPONSABLES, {"q": "penafiel"}).data["proveedores"]
    ] == ["Íñigo Peñafiel"]


def test_busqueda_solo_proveedores(escenario):
    Proveedor.objects.create(nombre="Electricidad Andina")
    r = _cliente(escenario["solicitante"]).get(RESPONSABLES, {"solo": "proveedores"})
    assert r.status_code == 200
    assert r.data == {
        "proveedores": [{"id": r.data["proveedores"][0]["id"], "nombre": "Electricidad Andina"}]
    }


def test_busqueda_no_ofrece_superusuarios_sin_ejecutar(escenario):
    admin = User.objects.create_superuser(
        username="admin", email="admin@example.com", password="Sup3r-Secr3t!"
    )
    MembresiaEmpresa.objects.get_or_create(usuario=admin, empresa=Empresa.objects.get(codigo="EMP"))
    r = _cliente(escenario["solicitante"]).get(RESPONSABLES)
    assert admin.id not in {p["id"] for p in r.data["personas"]}


def test_busqueda_sin_texto_ofrece_tecnicos_y_proveedores(escenario):
    e = escenario
    Proveedor.objects.create(nombre="Electricidad Andina")
    r = _cliente(e["solicitante"]).get(RESPONSABLES)
    assert r.status_code == 200
    assert [p["nombre"] for p in r.data["proveedores"]] == ["Electricidad Andina"]
    # Solo quien puede atender órdenes: ni quien pide ni quien coordina sin `ejecutar`.
    assert r.data["personas"] == [{"id": e["tecnico"].id, "nombre": "Jorge", "proveedor": None}]


def test_busqueda_limita_a_veinte_por_grupo(escenario):
    Proveedor.objects.bulk_create(
        [
            Proveedor(nombre=f"Proveedor {n:02d}", empresa=Empresa.objects.get(codigo="EMP"))
            for n in range(25)
        ]
    )
    for n in range(22):
        _cuenta(f"tecnico{n:02d}", "ver", "ejecutar")
    r = _cliente(escenario["solicitante"]).get(RESPONSABLES)
    assert len(r.data["proveedores"]) == 20
    assert len(r.data["personas"]) == 20


def test_busqueda_exige_poder_crear_ordenes(escenario):
    assert _cliente(escenario["tecnico"]).get(RESPONSABLES).status_code == 403
    assert APIClient().get(RESPONSABLES).status_code == 401


# --- CA-3: proveedor nuevo desde la orden ---------------------------------


def test_registrar_proveedor_y_usarlo_en_la_orden(escenario):
    cliente = _cliente(escenario["solicitante"])
    r = cliente.post(
        PROVEEDORES,
        {"nombre": "  José   Muñoz  ", "telefono": "098 765 4321", "contacto": "José Muñoz"},
        format="json",
    )
    assert r.status_code == 201, r.data
    assert set(r.data) == {"id", "nombre"}
    assert r.data["nombre"] == "José Muñoz"
    proveedor = Proveedor.objects.get(pk=r.data["id"])
    assert proveedor.empresa.codigo == "EMP"
    assert proveedor.telefono == "098 765 4321"
    registro = AuditLog.objects.get(module="ordenes", action="proveedor.created")
    # La bitácora dice qué se aportó, no los valores: pueden ser de una persona.
    assert registro.new_values == {
        "nombre": "José Muñoz",
        "origen": "orden de trabajo",
        "datos_aportados": ["contacto", "nombre", "telefono"],
    }

    orden = _crear(
        cliente, escenario["quito"], proveedor=proveedor.id, fecha_programada=_hoy().isoformat()
    )
    assert orden["responsable"] == "José Muñoz"


def test_la_bitacora_no_guarda_la_cedula_ni_el_correo(escenario):
    r = _cliente(escenario["solicitante"]).post(
        PROVEEDORES,
        {"nombre": "Íñigo Peñafiel", "identificacion": "1712345678", "correo": "inigo@correo.ec"},
        format="json",
    )
    assert r.status_code == 201, r.data
    assert Proveedor.objects.get(pk=r.data["id"]).identificacion == "1712345678"
    registro = AuditLog.objects.get(module="ordenes", action="proveedor.created")
    texto = str(registro.new_values) + str(registro.previous_values)
    assert "1712345678" not in texto and "inigo@correo.ec" not in texto
    assert registro.new_values["datos_aportados"] == ["correo", "identificacion", "nombre"]


def test_identificacion_numerica_es_cedula_o_ruc(escenario):
    cliente = _cliente(escenario["solicitante"])
    for malo in ("12345", "17123456789"):
        r = cliente.post(
            PROVEEDORES,
            {"nombre": f"Proveedor {malo}", "telefono": "0987654321", "identificacion": malo},
            format="json",
        )
        assert r.status_code == 400 and _campos_con_error(r) == {"identificacion"}, malo
    for bueno in ("0991234567001", "1712345678", "PE-20512345678"):
        r = cliente.post(
            PROVEEDORES,
            {"nombre": f"Proveedor {bueno}", "telefono": "0987654321", "identificacion": bueno},
            format="json",
        )
        assert r.status_code == 201, (bueno, r.data)


def test_el_listado_encuentra_por_el_proveedor(escenario):
    cliente = _cliente(escenario["coordinador"])
    climas = Proveedor.objects.create(nombre="Climatización Peñaherrera")
    _crear(cliente, escenario["quito"], proveedor=climas.id, titulo="Aire de bodega")
    _crear(cliente, escenario["manta"], titulo="Luz de cajas")
    r = cliente.get(BASE, {"q": "penaherrera"})
    assert [o["titulo"] for o in r.data["results"]] == ["Aire de bodega"]


def test_proveedor_duplicado_sin_tildes_ni_mayusculas(escenario):
    Proveedor.objects.create(nombre="Climatización del Sur")
    Proveedor.objects.create(nombre="Plomería Antigua", activo=False)
    cliente = _cliente(escenario["solicitante"])
    r = cliente.post(
        PROVEEDORES,
        {"nombre": "CLIMATIZACION DEL SUR", "correo": "ventas@climas.ec"},
        format="json",
    )
    assert r.status_code == 400
    assert r.data["error"]["details"]["nombre"] == [
        "Ya existe un proveedor llamado «Climatización del Sur»: búsquelo y elíjalo."
    ]
    r = cliente.post(PROVEEDORES, {"nombre": "plomeria antigua", "correo": "a@b.ec"}, format="json")
    assert r.status_code == 400
    assert "desactivado" in r.data["error"]["details"]["nombre"][0]
    assert Proveedor.objects.count() == 2


def test_el_mismo_nombre_en_otra_empresa_no_choca(escenario):
    with usando_empresa(_otra_empresa()):
        Proveedor.objects.create(nombre="Climas del Sur")
    r = _cliente(escenario["solicitante"]).post(
        PROVEEDORES, {"nombre": "Climas del Sur", "telefono": "0987654321"}, format="json"
    )
    assert r.status_code == 201, r.data


def test_proveedor_nuevo_pide_nombre_y_contacto(escenario):
    cliente = _cliente(escenario["solicitante"])
    r = cliente.post(PROVEEDORES, {"nombre": "Sin Contacto"}, format="json")
    assert r.status_code == 400 and _campos_con_error(r) == {"telefono"}
    r = cliente.post(PROVEEDORES, {"nombre": "   ", "telefono": "0987654321"}, format="json")
    assert r.status_code == 400 and "nombre" in _campos_con_error(r)
    r = cliente.post(PROVEEDORES, {"nombre": "Con Teléfono Raro", "telefono": "12"}, format="json")
    assert r.status_code == 400 and "telefono" in _campos_con_error(r)
    r = cliente.post(
        PROVEEDORES, {"nombre": "Correo Malo", "correo": "no-es-correo"}, format="json"
    )
    assert r.status_code == 400 and "correo" in _campos_con_error(r)
    assert not Proveedor.objects.exists()


def test_proveedor_nuevo_exige_poder_crear_ordenes(escenario):
    datos = {"nombre": "Climas del Sur", "telefono": "0987654321"}
    assert _cliente(escenario["tecnico"]).post(PROVEEDORES, datos, format="json").status_code == 403
    assert APIClient().post(PROVEEDORES, datos, format="json").status_code == 401
    assert not Proveedor.objects.exists()
