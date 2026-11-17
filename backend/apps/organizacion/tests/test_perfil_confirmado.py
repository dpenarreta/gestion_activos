"""Tras confirmar Mi perfil, la persona ya no cambia sus datos (17/11/2026).

Decisión del usuario: después de la validación inicial, el nombre, el área,
la agencia y el cargo quedan bloqueados para la persona; solo cambia sus
teléfonos (corporativo, línea fija y el personal). Los corrige quien tenga
`usuarios.corregir_perfil`, desde la ficha del usuario.
"""

from django.contrib.auth.models import Permission
from rest_framework.test import APIClient

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import Cargo, DatosDeContacto, Departamento, Sede
from apps.users.models import User

URL = "/api/v1/organizacion/mis-datos/"


def _escenario(db):
    empresa = empresa_actual()
    with usando_empresa(empresa):
        area = Departamento.objects.create(nombre="Comercial", codigo="COM")
        quito = Sede.objects.create(nombre="Matriz Quito", ciudad="Quito")
        gye = Sede.objects.create(nombre="Guayaquil", ciudad="Guayaquil")
        cargo = Cargo.objects.create(nombre="Asesor comercial")
    usuario = User.objects.create_user(
        username="rosa", email="rosa@grupolaar.com", password="Sup3r-Secr3t!"
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    completo = {
        "nombres": "Rosa",
        "apellidos": "Vera",
        "telefono": "",
        "tiene_telefono_corporativo": False,
        "tiene_linea_fija": False,
        "area": area.id,
        "agencia": quito.id,
        "cargo": cargo.id,
    }
    return empresa, usuario, cliente, completo, quito, gye


def test_al_completar_queda_confirmado_y_bloquea_nombre_y_agencia(db):
    empresa, usuario, cliente, completo, quito, gye = _escenario(db)

    # La validación inicial: todavía se puede escribir todo.
    respuesta = cliente.put(URL, completo, format="json")
    assert respuesta.status_code == 200, respuesta.data
    datos = respuesta.json()
    assert datos["confirmado"] is True
    assert set(datos["bloqueados"]) == {"nombres", "apellidos", "agencia", "area", "cargo"}
    with usando_empresa(empresa):
        assert DatosDeContacto.objects.get(usuario=usuario).confirmado_en is not None

    otro_nombre = cliente.put(URL, {**completo, "nombres": "Rosario"}, format="json")
    assert otro_nombre.status_code == 400
    assert "ya están confirmados" in str(otro_nombre.data)

    otra_agencia = cliente.put(URL, {**completo, "agencia": gye.id}, format="json")
    assert otra_agencia.status_code == 400

    # Los teléfonos sí los sigue cambiando.
    telefonos = cliente.put(
        URL,
        {**completo, "tiene_linea_fija": True, "linea_fija_extension": "1234"},
        format="json",
    )
    assert telefonos.status_code == 200, telefonos.data
    assert telefonos.json()["linea_fija_extension"] == "1234"


def test_quien_tiene_el_permiso_corrige_area_y_agencia_desde_la_ficha(db):
    empresa, usuario, cliente, completo, quito, gye = _escenario(db)
    cliente.put(URL, completo, format="json")

    th = User.objects.create_user(username="th", email="th@grupolaar.com", password="x")
    MembresiaEmpresa.objects.create(usuario=th, empresa=empresa)
    cliente_th = APIClient()
    cliente_th.force_authenticate(user=th)
    ruta = f"/api/v1/organizacion/personas/{usuario.id}/perfil/"
    assert cliente_th.put(ruta, {"agencia": gye.id}, format="json").status_code == 403

    th.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="permissions", codename="usuarios.corregir_perfil"
        )
    )
    cliente_th.force_authenticate(user=User.objects.get(pk=th.pk))
    corregido = cliente_th.put(ruta, {"agencia": gye.id}, format="json")
    assert corregido.status_code == 200, corregido.data
    assert corregido.json()["agencia"]["id"] == gye.id
    assert cliente.get(URL).json()["agencia"]["id"] == gye.id
