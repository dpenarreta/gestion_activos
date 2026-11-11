"""Solicitud de proyectos con aprobadores ausentes (11/11/2026, US-001).

Lo que se protege: una solicitud nueva que le tocaría a alguien ausente pasa
a su reemplazo con la constancia en el historial (CA-4); lo que ya tenía
pendiente pasa una sola vez (CA-5); y la lista dice junto al aprobador si
está ausente, sin el tipo de permiso (CA-7, CA-8).
"""

import datetime
import json

from django.utils import timezone

from apps.ausencias.models import LeaveRecord
from apps.chat.models import EstadoChat
from apps.notificaciones.models import Notificacion
from apps.organizacion import ausencia
from apps.proyectos.models import AccionProyecto, SolicitudProyecto
from apps.proyectos.tests.test_proyectos import (  # noqa: F401 (fixture)
    SOLICITUDES,
    _activar,
    _solicitar,
    proyecto,
)


def _fuera(usuario):
    EstadoChat.objects.update_or_create(
        usuario=usuario,
        defaults={
            "estado": EstadoChat.Estado.FUERA_OFICINA,
            "hasta": timezone.now() + datetime.timedelta(days=2),
        },
    )


def _escaladas(solicitud_id):
    return list(
        AccionProyecto.objects.filter(
            solicitud_id=solicitud_id, accion=AccionProyecto.Accion.ESCALADA
        ).values_list("comentario", flat=True)
    )


def test_una_solicitud_nueva_pasa_al_reemplazo_del_aprobador_ausente(proyecto):  # noqa: F811
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    _fuera(proyecto["jefa"][0])
    _, ana = proyecto["ana"]
    creada = _solicitar(ana, tipo)
    assert creada.status_code == 201, creada.data
    datos = creada.json()
    assert [p["nombre"] for p in datos["pendiente_de"]] == ["Gerardo"]
    assert _escaladas(datos["id"]) == ["Escalada a Gerardo por ausencia de Julia"]
    assert (
        Notificacion.objects.todas()
        .filter(usuario=proyecto["gerente"][0], tipo="proyectos.por_atender")
        .exists()
    )


def test_lo_pendiente_pasa_una_sola_vez_y_la_lista_lo_dice(proyecto):  # noqa: F811
    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    julia = proyecto["jefa"][0]
    _, ana = proyecto["ana"]
    datos = _solicitar(ana, tipo).json()
    LeaveRecord.objects.create(
        user=julia,
        type=LeaveRecord.Type.PERSONAL,
        date=timezone.localdate(),
        is_full_day=True,
        observation="Trámite en el registro civil",
        created_by=julia,
    )
    # Antes de la revisión, la lista ya dice que está fuera y quién la reemplaza.
    lista = ana.get(SOLICITUDES).json()
    filas = lista["results"] if isinstance(lista, dict) else lista
    [aprobadora] = filas[0]["pendiente_de"]
    assert aprobadora["ausencia"]["clave"] == "fuera_oficina"
    assert aprobadora["ausencia"]["reemplazo"]["nombre"] == "Gerardo"
    texto = json.dumps(lista, ensure_ascii=False)
    assert "PERSONAL" not in texto and "registro civil" not in texto

    assert ausencia.reasignar_pendientes(julia) == 1
    assert ausencia.reasignar_pendientes(julia) == 0
    fila = SolicitudProyecto.objects.get(pk=datos["id"])
    assert [u.username for u in fila.pendiente_de.all()] == ["gerardo"]
    assert _escaladas(datos["id"]) == ["Escalada a Gerardo por ausencia de Julia"]


def test_decidir_con_una_copia_vieja_relee_la_fila(proyecto):  # noqa: F811
    import pytest
    from rest_framework.exceptions import ValidationError

    from apps.proyectos import services

    _, admin = proyecto["admin"]
    tipo = _activar(admin, proyecto["tipo"])
    julia = proyecto["jefa"][0]
    _, ana = proyecto["ana"]
    datos = _solicitar(ana, tipo).json()
    vieja = SolicitudProyecto.objects.get(pk=datos["id"])
    assert ana.post(f"{SOLICITUDES}{datos['id']}/cancelar/").status_code == 200
    # La copia dice «pendiente», pero la fila ya está cancelada.
    with pytest.raises(ValidationError):
        services.aprobar(vieja, julia)
    assert SolicitudProyecto.objects.get(pk=datos["id"]).estado == "cancelada"
