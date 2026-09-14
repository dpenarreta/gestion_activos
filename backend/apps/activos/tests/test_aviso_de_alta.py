"""Avisar a quien pidió un equipo de que ya llegó.

La regla tiene dos mitades y la primera es la que evita el ruido: **un alta
normal no avisa a nadie**. Una compra de reposición no la pide nadie en
particular, y un correo por cada equipo que entra al inventario se convierte en
un correo que se archiva sin leer —y entonces tampoco se lee el que sí
importaba—.

La segunda es la que da el servicio: cuando el alta dice quién lo pidió, a esa
persona se le avisa. Es una persona aunque el pedido venga de un área, porque a
un área no se le manda un correo: cuando pide Contabilidad se anota a quien lo
pidió en su nombre, y el área viene con ella.
"""

import datetime

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def comprador(db):
    """Quien registra el alta: administración, normalmente."""
    return User.objects.create_superuser(
        username="admin_compras",
        email="compras@laarcourierdocs.com",
        password="Sup3r-Secr3t!",
    )


@pytest.fixture
def area(db):
    return Departamento.objects.create(nombre="Contabilidad", codigo="CTB")


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def quien_pidio(area):
    return Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez",
        codigo_empleado="CTB-0001",
        departamento=area,
        correo="ana.perez@laarcourierdocs.com",
    )


@pytest.fixture
def pidio_sin_correo(area):
    return Empleado.objects.create(
        nombres="Luis",
        apellidos="Mora",
        codigo_empleado="CTB-0002",
        departamento=area,
        correo="",
    )


@pytest.fixture
def al_confirmar(django_capture_on_commit_callbacks):
    """El envío ocurre al confirmarse la transacción; en pruebas se deshace."""
    from contextlib import contextmanager

    @contextmanager
    def _dentro():
        with django_capture_on_commit_callbacks(execute=True):
            yield

    return _dentro


@pytest.fixture
def dar_de_alta(comprador, area, tipo, al_confirmar):
    contador = {"n": 0}

    def _alta(**extra):
        contador["n"] += 1
        with al_confirmar():
            return ActivoService.crear_activo(
                actor=comprador,
                tipo=tipo,
                nombre=f"Laptop {contador['n']}",
                marca="Dell",
                modelo="Latitude",
                numero_serie=f"SN-ALTA-{contador['n']}",
                departamento=area,
                fecha_adquisicion=datetime.date(2026, 9, 14),
                **extra,
            )

    return _alta


@pytest.fixture
def cliente(comprador):
    api = APIClient()
    api.force_authenticate(user=comprador)
    return api


def _cuerpo(area, tipo, **extra):
    datos = {
        "tipo": tipo.id,
        "nombre": "Laptop pedida por Contabilidad",
        "marca": "Dell",
        "modelo": "Latitude 5440",
        "numero_serie": "SN-API-ALTA-1",
        "departamento": area.id,
        "fecha_adquisicion": "2026-09-14",
    }
    datos.update(extra)
    return datos


# --- Lo normal: nadie lo pidió ---------------------------------------------


def test_un_alta_sin_solicitante_no_avisa_a_nadie(dar_de_alta):
    """Una compra de reposición no la pide nadie en particular."""
    activo = dar_de_alta()

    assert mail.outbox == []
    assert activo.aviso is None


def test_ni_siquiera_avisa_a_quien_lo_registro(dar_de_alta):
    """El respaldo de los otros avisos no aplica aquí: no es que no se pudiera
    avisar a nadie, es que no había a quién."""
    dar_de_alta()

    assert mail.outbox == []


# --- Cuando alguien lo pidió ------------------------------------------------


def test_avisa_a_quien_lo_pidio(dar_de_alta, quien_pidio):
    activo = dar_de_alta(solicitado_por=quien_pidio)

    assert len(mail.outbox) == 1
    assert mail.outbox[0].bcc == ["ana.perez@laarcourierdocs.com"]
    assert activo.nombre in mail.outbox[0].subject


def test_el_correo_dice_que_equipo_llego(dar_de_alta, quien_pidio):
    activo = dar_de_alta(solicitado_por=quien_pidio)

    cuerpo = mail.outbox[0].alternatives[0][0]
    assert activo.codigo_barras in cuerpo
    assert "Contabilidad" in cuerpo


def test_dice_que_todavia_no_esta_entregado(dar_de_alta, quien_pidio):
    """Que llegue no es que ya sea suyo: la entrega es otra acción, y deja su
    acta."""
    dar_de_alta(solicitado_por=quien_pidio)

    # Sin los saltos de línea de la plantilla, que parten las frases.
    cuerpo = " ".join(mail.outbox[0].alternatives[0][0].split())
    assert "Todavía no está entregado a nadie" in cuerpo


def test_sin_correo_el_aviso_va_a_quien_registro_el_alta(dar_de_alta, pidio_sin_correo):
    """La misma regla que en el taller: quien actuó puede hacer algo con la
    noticia —avisarle por otro medio, o completarle la ficha—."""
    activo = dar_de_alta(solicitado_por=pidio_sin_correo)

    assert mail.outbox[0].bcc == ["compras@laarcourierdocs.com"]
    assert activo.aviso.por_defecto is True
    assert activo.aviso.sin_correo == ["Luis Mora"]


# --- Desde la API -----------------------------------------------------------


def test_el_alta_desde_la_api_acepta_quien_lo_pidio(cliente, area, tipo, quien_pidio):
    respuesta = cliente.post(
        "/api/v1/activos/",
        _cuerpo(area, tipo, solicitado_por=quien_pidio.id),
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.data["solicitado_por_nombre"] == "Ana Pérez"


def test_la_respuesta_dice_a_quien_no_se_le_avisara(cliente, area, tipo, pidio_sin_correo):
    respuesta = cliente.post(
        "/api/v1/activos/",
        _cuerpo(area, tipo, solicitado_por=pidio_sin_correo.id),
        format="json",
    )

    assert respuesta.data["aviso"]["sin_correo"] == ["Luis Mora"]
    assert respuesta.data["aviso"]["a_quien_registro"] is True


def test_un_alta_sin_solicitante_no_trae_bloque_de_aviso(cliente, area, tipo):
    """No hay nada que contar, y es distinto de «no se pudo avisar»."""
    respuesta = cliente.post("/api/v1/activos/", _cuerpo(area, tipo), format="json")

    assert "aviso" not in respuesta.data


def test_se_puede_anotar_a_alguien_marcado_como_inactivo(cliente, area, tipo):
    """La marca de activo del empleado no la mantiene ninguna integración.

    Sin enlace con RRHH ni con el directorio, esa casilla dice lo que alguien
    puso el día que la puso. Filtrar por ella no protege de nada —quien de
    verdad se fue puede seguir marcado como activo— y sí esconde a gente que sí
    está, que es el fallo que se nota: no se puede registrar quién pidió el
    equipo. Dejar constancia vale más.
    """
    quizas_se_fue = Empleado.objects.create(
        nombres="Paola",
        apellidos="Vaca",
        codigo_empleado="CTB-0009",
        departamento=area,
        correo="paola.vaca@laarcourierdocs.com",
        activo=False,
    )

    respuesta = cliente.post(
        "/api/v1/activos/",
        _cuerpo(area, tipo, solicitado_por=quizas_se_fue.id),
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.data["solicitado_por_nombre"] == "Paola Vaca"


def test_y_si_esa_ficha_no_tiene_correo_el_aviso_cae_en_el_respaldo(cliente, area, tipo):
    """No hace falta una regla propia: la de siempre ya cubre el caso."""
    sin_nada = Empleado.objects.create(
        nombres="Jorge",
        apellidos="Andrade",
        codigo_empleado="CTB-0010",
        departamento=area,
        correo="",
        activo=False,
    )

    respuesta = cliente.post(
        "/api/v1/activos/", _cuerpo(area, tipo, solicitado_por=sin_nada.id), format="json"
    )

    assert respuesta.status_code == 201
    assert respuesta.data["aviso"]["a_quien_registro"] is True
    assert respuesta.data["aviso"]["sin_correo"] == ["Jorge Andrade"]


def test_quien_lo_pidio_no_se_cambia_al_editar(cliente, area, tipo, quien_pidio):
    """Es un hecho del alta: cambiarlo después reescribiría la historia de una
    compra que ya ocurrió."""
    creado = cliente.post("/api/v1/activos/", _cuerpo(area, tipo), format="json")

    cliente.patch(
        f"/api/v1/activos/{creado.data['id']}/",
        {"solicitado_por": quien_pidio.id},
        format="json",
    )

    assert Activo.objects.get(pk=creado.data["id"]).solicitado_por_id is None
