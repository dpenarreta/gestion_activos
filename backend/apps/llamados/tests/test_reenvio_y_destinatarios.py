"""Ronda 2 de QA (US-013, 12/11/2026).

- Un correo nunca se queda «Por enviar»: si el envío falla al armarlo, queda
  «No se pudo enviar».
- `reenviar-correo/` vuelve a mandar el de un emitido que no salió, con los
  datos de hoy; solo con `emitir`, nunca sobre lo propio y sin doble clic.
- `propuesta/` y `propuesta_vigente` dicen si la persona tiene correo (sin
  mostrarlo) y quién es el jefe que recibiría la copia.
- Confirmar con `nivel_esperado` cuando la propuesta cambió responde 409
  `propuesta_cambio` con el nivel nuevo.
"""

from datetime import timedelta

from django.core import mail
from django.utils import timezone

from apps.core.models import AuditLog
from apps.llamados import services
from apps.llamados.models import LlamadoAtencion
from apps.llamados.tests.conftest import (
    LLAMADOS,
    PROPUESTA,
    accion,
    cliente,
    codigo,
    emitir,
    releer,
    usuario,
)


def _escrito(e, **extra):
    _, escrito, _ = e["niveles"]
    respuesta = emitir(e, nivel=escrito.pk, justificacion_cambio="Ya advertida.", **extra)
    assert respuesta.status_code == 201, respuesta.content
    return respuesta.json()["id"]


def _sin_correo(e, nombre="ana"):
    persona = usuario(e, nombre)
    persona.email = ""
    persona.save(update_fields=["email"])
    return persona


# --- Correo que no se queda pendiente ---------------------------------------------------------


def test_si_el_envio_falla_queda_no_se_pudo_enviar(e, monkeypatch, caplog):
    def falla(*args, **kwargs):
        raise RuntimeError("plantilla rota para ana@grupolaar.com")

    monkeypatch.setattr(services, "renderizar", falla)
    llamado_id = _escrito(e)
    llamado = LlamadoAtencion.objects.get(pk=llamado_id)
    assert llamado.estado == "emitido"
    assert llamado.correo_estado == "fallido"
    assert mail.outbox == []
    assert "ana@grupolaar.com" not in caplog.text
    assert releer(e, llamado_id)["puede"]["reenviar"] is True


# --- Reenviar ---------------------------------------------------------------------------------


def test_reenviar_tras_registrar_el_correo(e):
    persona = _sin_correo(e)
    llamado_id = _escrito(e)
    detalle = releer(e, llamado_id)
    assert detalle["correo"]["estado"] == "sin_direccion"
    assert detalle["puede"]["reenviar"] is True

    persona.email = "ana.penafiel@grupolaar.com"
    persona.save(update_fields=["email"])
    respuesta = accion(e, "carolina", llamado_id, "reenviar-correo")
    assert respuesta.status_code == 200, respuesta.content
    detalle = releer(e, llamado_id)
    assert detalle["correo"]["estado"] == "enviado"
    assert detalle["puede"]["reenviar"] is False
    assert mail.outbox[0].to == ["ana.penafiel@grupolaar.com"]
    acciones = [a["accion"] for a in detalle["historial"]]
    assert "reenvio_correo" in acciones and acciones[-1] == "correo"
    assert AuditLog.objects.filter(
        action="llamados.correo_reenviado", target_id=str(llamado_id)
    ).exists()

    # Ya salió: no se reenvía.
    otra = accion(e, "carolina", llamado_id, "reenviar-correo")
    assert otra.status_code == 409 and codigo(otra) == "estado_invalido"
    assert len(mail.outbox) == 1


def test_el_doble_clic_no_reenvia_dos_veces(e):
    _, escrito, _ = e["niveles"]
    # Emitido sin correr el commit: queda «Por enviar» recién programado.
    with e["tras_commit"](execute=False):
        creado = (
            cliente(e, "carolina")
            .post(
                LLAMADOS,
                {
                    "persona": usuario(e, "ana").pk,
                    "causa": e["causa"].pk,
                    "fecha_hecho": services.hoy().isoformat(),
                    "descripcion": "Atraso.",
                    "nivel": escrito.pk,
                    "justificacion_cambio": "Ya advertida.",
                },
                format="json",
            )
            .json()
        )
    recien = accion(e, "carolina", creado["id"], "reenviar-correo")
    assert recien.status_code == 409 and codigo(recien) == "duplicado"
    assert mail.outbox == []

    # Pasado el minuto sigue «Por enviar» (el proceso se cayó): se reenvía una vez.
    LlamadoAtencion.objects.filter(pk=creado["id"]).update(
        updated_at=timezone.now() - timedelta(minutes=2)
    )
    assert accion(e, "carolina", creado["id"], "reenviar-correo").status_code == 200
    assert len(mail.outbox) == 1
    assert accion(e, "carolina", creado["id"], "reenviar-correo").status_code == 409


def test_reenviar_pide_emitir_y_nunca_sobre_lo_propio(e):
    _sin_correo(e)
    llamado_id = _escrito(e)
    for quien in ("victor", "julia", "nadia"):
        assert accion(e, quien, llamado_id, "reenviar-correo").status_code == 403, quien

    solicitado = emitir(e, quien="julia", descripcion="Pendiente.").json()
    assert accion(e, "carolina", solicitado["id"], "reenviar-correo").status_code == 409

    llamado = LlamadoAtencion.objects.get(pk=llamado_id)
    llamado.persona = usuario(e, "carolina")
    llamado.save(update_fields=["persona"])
    assert accion(e, "carolina", llamado_id, "reenviar-correo").status_code == 404
    assert services.puede_decidir(usuario(e, "carolina"), llamado)["reenviar"] is False


# --- Destinatarios previstos ------------------------------------------------------------------


def test_la_propuesta_dice_el_jefe_y_si_hay_correo_sin_mostrarlo(e):
    def propuesta(persona):
        respuesta = cliente(e, "carolina").get(
            PROPUESTA, {"persona": usuario(e, persona).pk, "causa": e["causa"].pk}
        )
        assert respuesta.status_code == 200
        return respuesta

    respuesta = propuesta("ana")
    datos = respuesta.json()
    assert datos["persona_tiene_correo"] is True
    assert datos["jefe"] == {"nombre": "Julia"}
    assert b"ana@grupolaar.com" not in respuesta.content
    assert b"julia@grupolaar.com" not in respuesta.content

    assert propuesta("gerardo").json()["jefe"] is None  # nadie le reporta arriba
    _sin_correo(e)
    assert propuesta("ana").json()["persona_tiene_correo"] is False


def test_la_propuesta_vigente_tambien(e):
    solicitado = emitir(e, quien="julia").json()
    vigente = releer(e, solicitado["id"])["propuesta_vigente"]
    assert vigente["jefe"] == {"nombre": "Julia"}
    assert vigente["persona_tiene_correo"] is True


# --- La propuesta cambió mientras se confirmaba -------------------------------------------------


def test_confirmar_con_nivel_esperado_viejo_responde_409(e):
    verbal, escrito, _ = e["niveles"]
    solicitado = emitir(e, quien="julia").json()
    assert emitir(e, descripcion="Otro atraso emitido.").status_code == 201

    respuesta = accion(e, "carolina", solicitado["id"], "confirmar", {"nivel_esperado": verbal.pk})
    assert respuesta.status_code == 409
    error = respuesta.json()["error"]
    assert error["code"] == "propuesta_cambio"
    assert error["message"].startswith("El nivel propuesto cambió")
    assert error["details"]["nivel_propuesto"]["id"] == escrito.pk
    assert error["details"]["nivel_propuesto"]["tipo"] == "escrito"
    assert LlamadoAtencion.objects.get(pk=solicitado["id"]).estado == "solicitado"

    # Con el esperado al día, confirma con el vigente.
    ok = accion(e, "carolina", solicitado["id"], "confirmar", {"nivel_esperado": escrito.pk})
    assert ok.status_code == 200, ok.content
    assert ok.json()["nivel_aplicado"]["id"] == escrito.pk


def test_nivel_esperado_no_aplica_si_se_elige_nivel(e):
    verbal, escrito, _ = e["niveles"]
    solicitado = emitir(e, quien="julia").json()
    assert emitir(e, descripcion="Otro atraso emitido.").status_code == 201
    respuesta = accion(
        e,
        "carolina",
        solicitado["id"],
        "confirmar",
        {"nivel": escrito.pk, "nivel_esperado": verbal.pk},
    )
    assert respuesta.status_code == 200, respuesta.content
