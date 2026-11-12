"""Causas y niveles configurables, y la causa inicial (US-013, CA-1 y CA-2).

- Con `llamados.configurar` se crean, editan, activan y desactivan causas con
  sus niveles anidados (en el orden de `orden`).
- Lo usado no se borra: una causa con llamados responde 409 `en_uso`; un
  nivel usado que se quita de la lista se desactiva, no cambia de tipo y no
  se reordena.
- Quien emite o solicita lee solo las activas, con sus niveles activos.
- La migración siembra «Incumplimiento de la firma o aceptación del rol de
  pagos» con sus tres niveles en cada empresa, una sola vez.
"""

import importlib

from django.apps import apps as django_apps

from apps.empresas.contexto import empresa_actual
from apps.llamados.models import CausaLlamado, NivelLlamado
from apps.llamados.tests.conftest import CAUSAS, cliente, codigo, detalles, emitir

NIVEL = {
    "nombre": "Llamado escrito",
    "tipo": "escrito",
    "envia_correo": True,
    "asunto": "Llamado: {causa}",
    "cuerpo": "Estimado(a) {nombre}: {descripcion}",
}


def _causa(e, **datos):
    cuerpo = {
        "nombre": "Uso del celular en ruta",
        "descripcion": "Uso del celular mientras conduce.",
        "plazo_reincidencia_meses": 6,
        "activa": True,
        "niveles": [
            {"nombre": "Verbal", "tipo": "verbal", "envia_correo": False, "orden": 1},
            {**NIVEL, "orden": 2},
        ],
        **datos,
    }
    return cliente(e, "carolina").post(CAUSAS, cuerpo, format="json")


def test_crear_y_leer_una_causa(e):
    respuesta = _causa(e)
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["plazo_reincidencia_meses"] == 6
    assert [(n["orden"], n["nombre"], n["en_uso"]) for n in datos["niveles"]] == [
        (1, "Verbal", False),
        (2, "Llamado escrito", False),
    ]
    assert {
        "id",
        "orden",
        "nombre",
        "tipo",
        "envia_correo",
        "copia_jefe",
        "monto_sugerido",
        "asunto",
        "cuerpo",
        "activo",
        "en_uso",
    } <= set(datos["niveles"][1])


def test_el_orden_lo_da_el_campo_orden(e):
    respuesta = _causa(
        e,
        niveles=[
            {**NIVEL, "orden": 2},
            {"nombre": "Verbal", "tipo": "verbal", "envia_correo": False, "orden": 1},
        ],
    )
    assert [n["nombre"] for n in respuesta.json()["niveles"]] == ["Verbal", "Llamado escrito"]


def test_validaciones_de_la_causa_y_sus_niveles(e):
    repetida = _causa(e, nombre="atrasos REITERADOS")
    assert repetida.status_code == 400 and "nombre" in detalles(repetida)
    sin_asunto = _causa(e, niveles=[{**NIVEL, "asunto": ""}])
    assert sin_asunto.status_code == 400
    assert "asunto" in detalles(sin_asunto)["niveles"]["0"]
    inventada = _causa(e, niveles=[{**NIVEL, "cuerpo": "Hola {{inventada}}"}])
    assert inventada.status_code == 400
    assert "inventada" in str(detalles(inventada)["niveles"])
    sin_niveles = _causa(e, niveles=[])
    assert sin_niveles.status_code == 400 and "niveles" in detalles(sin_niveles)
    plazo = _causa(e, plazo_reincidencia_meses=0)
    assert plazo.status_code == 400 and "plazo_reincidencia_meses" in detalles(plazo)


def test_el_monto_sugerido_solo_en_la_sancion(e):
    respuesta = _causa(
        e,
        niveles=[
            {**NIVEL, "monto_sugerido": "10"},
            {**NIVEL, "nombre": "Multa", "tipo": "sancion_economica", "monto_sugerido": "15,50"},
        ],
    )
    niveles = respuesta.json()["niveles"]
    assert niveles[0]["monto_sugerido"] is None
    assert niveles[1]["monto_sugerido"] == "15.50"


def test_solo_configurar_escribe_y_los_demas_leen_las_activas(e):
    inactiva = _causa(e, activa=False).json()
    for quien in ("julia", "victor", "nadia"):
        assert cliente(e, quien).post(CAUSAS, {}, format="json").status_code == 403, quien
    assert (
        cliente(e, "julia")
        .patch(f"{CAUSAS}{e['causa'].pk}/", {"activa": False}, format="json")
        .status_code
        == 403
    )
    assert cliente(e, "nadia").get(CAUSAS).status_code == 403

    e["niveles"][1].activo = False
    e["niveles"][1].save()
    # (La base de pruebas puede traer además la causa inicial de la migración.)
    para_jefe = cliente(e, "julia").get(CAUSAS).json()
    ids = {c["id"] for c in para_jefe}
    assert e["causa"].pk in ids and inactiva["id"] not in ids
    atrasos = next(c for c in para_jefe if c["id"] == e["causa"].pk)
    assert [n["nombre"] for n in atrasos["niveles"]] == [
        "Primer llamado (verbal)",
        "Sanción económica",
    ]
    assert cliente(e, "julia").get(f"{CAUSAS}{inactiva['id']}/").status_code == 404

    # Quien solo solicita no ve los textos de los correos; quien ve, sí.
    assert all("asunto" not in n and "cuerpo" not in n for n in atrasos["niveles"])
    para_ver = cliente(e, "victor").get(CAUSAS).json()
    assert all("asunto" in n and "cuerpo" in n for c in para_ver for n in c["niveles"])

    todas = {c["id"] for c in cliente(e, "carolina").get(CAUSAS).json()}
    assert {e["causa"].pk, inactiva["id"]} <= todas
    activas = {c["id"] for c in cliente(e, "carolina").get(CAUSAS, {"activas": "1"}).json()}
    assert e["causa"].pk in activas and inactiva["id"] not in activas


def _niveles_de(causa):
    return [
        {
            "id": n.pk,
            "orden": n.orden,
            "nombre": n.nombre,
            "tipo": n.tipo,
            "envia_correo": n.envia_correo,
            "asunto": n.asunto,
            "cuerpo": n.cuerpo,
            "monto_sugerido": str(n.monto_sugerido) if n.monto_sugerido is not None else None,
            "copia_jefe": n.copia_jefe,
            "activo": n.activo,
        }
        for n in causa.niveles.order_by("orden")
    ]


def test_lo_usado_se_desactiva_no_se_borra(e):
    causa = e["causa"]
    url = f"{CAUSAS}{causa.pk}/"
    configura = cliente(e, "carolina")
    assert emitir(e).status_code == 201  # usa el primer nivel
    niveles = _niveles_de(causa)

    # Quitar el usado lo desactiva y conserva su lugar.
    respuesta = configura.patch(url, {"niveles": niveles[1:]}, format="json")
    assert respuesta.status_code == 200, respuesta.content
    primero = respuesta.json()["niveles"][0]
    assert primero["nombre"] == "Primer llamado (verbal)"
    assert primero["activo"] is False and primero["en_uso"] is True

    # No se reordena ni cambia de tipo.
    niveles = _niveles_de(causa)
    al_reves = [{**n, "orden": 4 - n["orden"]} for n in niveles]
    reordenar = configura.patch(url, {"niveles": al_reves}, format="json")
    assert reordenar.status_code == 409 and codigo(reordenar) == "en_uso"
    otro_tipo = [{**niveles[0], "tipo": "escrito"}, *niveles[1:]]
    assert configura.patch(url, {"niveles": otro_tipo}, format="json").status_code == 409

    # Los textos se editan y uno nuevo va al final.
    niveles[0]["nombre"] = "Llamado verbal"
    niveles[0]["activo"] = True
    respuesta = configura.patch(
        url,
        {"niveles": [*niveles, {**NIVEL, "nombre": "Cuarto nivel", "orden": 4}]},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.content
    assert [n["nombre"] for n in respuesta.json()["niveles"]] == [
        "Llamado verbal",
        "Segundo llamado (escrito)",
        "Sanción económica",
        "Cuarto nivel",
    ]
    # El llamado conserva el nombre con que se emitió.
    assert causa.llamados.get().nivel_nombre == "Primer llamado (verbal)"

    # Un nivel sin usar sí se quita.
    niveles = _niveles_de(causa)
    respuesta = configura.patch(url, {"niveles": niveles[:3]}, format="json")
    assert respuesta.status_code == 200
    assert NivelLlamado.objects.filter(causa=causa).count() == 3

    # Y la causa usada no se borra: se desactiva.
    borrar = configura.delete(url)
    assert borrar.status_code == 409 and codigo(borrar) == "en_uso"
    assert configura.patch(url, {"activa": False}, format="json").json()["activa"] is False


def test_una_causa_sin_usar_se_borra(e):
    nueva = _causa(e).json()
    assert cliente(e, "carolina").delete(f"{CAUSAS}{nueva['id']}/").status_code == 204
    assert not CausaLlamado.objects.filter(pk=nueva["id"]).exists()


def test_la_migracion_siembra_la_causa_inicial(db):
    migracion = importlib.import_module("apps.llamados.migrations.0002_causa_inicial")
    migracion.crear(django_apps, None)
    migracion.crear(django_apps, None)  # idempotente
    causa = CausaLlamado.objects.get(
        empresa=empresa_actual(), nombre="Incumplimiento de la firma o aceptación del rol de pagos"
    )
    assert causa.meses_reincidencia == 12 and causa.activa
    niveles = list(causa.niveles.order_by("orden"))
    assert [(n.nombre, n.tipo, n.envia_correo) for n in niveles] == [
        ("Primer llamado (verbal)", "verbal", False),
        ("Segundo llamado (escrito)", "escrito", True),
        ("Sanción económica", "sancion_economica", True),
    ]
    assert all(n.asunto and n.cuerpo for n in niveles)
    assert "{monto}" in niveles[2].cuerpo
    # Los textos solo usan variables que existen.
    from apps.llamados import services

    for nivel in niveles:
        assert services.variables_desconocidas(nivel.asunto, nivel.cuerpo) == []
    assert CausaLlamado.objects.filter(nombre=causa.nombre).count() == 1
