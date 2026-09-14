"""Avisos de entrada y salida del taller, disparados por el hecho.

No tienen frecuencia: o salen cuando ocurre o ya no sirven. Quien responde por
un equipo se entera de que se lo llevaron a reparar en el momento, no en un
resumen de mañana, cuando ya lo notó por el hueco en su escritorio.

La regla de a quién se le manda tiene una parte que no es obvia y es la que
estas pruebas existen para fijar: **el correo del empleado es opcional**, y
quien no lo tiene no recibe nada. Eso no se silencia —la respuesta devuelve sus
nombres para que la pantalla lo diga—, y si no se pudo avisar a nadie, el
correo va a quien hizo la acción. Un aviso que no llega y nadie sabe que no
llegó es peor que no tener avisos.
"""

import datetime

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.mantenimientos.models import Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def tecnico(db):
    """Quien registra la reparación. Su cuenta siempre tiene correo."""
    return User.objects.create_user(
        username="tecnico_taller",
        email="tecnico@laarcourierdocs.com",
        password="Sup3r-Secr3t!",
        is_staff=True,
        is_superuser=True,
    )


@pytest.fixture
def area(db):
    return Departamento.objects.create(nombre="Operaciones", codigo="OPE")


@pytest.fixture
def con_correo(area):
    return Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez",
        codigo_empleado="OPE-0001",
        departamento=area,
        correo="ana.perez@laarcourierdocs.com",
    )


@pytest.fixture
def sin_correo(area):
    return Empleado.objects.create(
        nombres="Luis",
        apellidos="Mora",
        codigo_empleado="OPE-0002",
        departamento=area,
        correo="",
    )


@pytest.fixture
def crear_activo(tecnico, area):
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    contador = {"n": 0}

    def _crear(responsables=(), compartido=False):
        contador["n"] += 1
        return ActivoService.crear_activo(
            actor=tecnico,
            tipo=tipo,
            nombre=f"Laptop {contador['n']}",
            marca="Dell",
            modelo="Latitude",
            numero_serie=f"SN-AVISO-{contador['n']}",
            departamento=area,
            fecha_adquisicion=datetime.date(2025, 1, 10),
            compartido=compartido,
            responsables=list(responsables),
        )

    return _crear


@pytest.fixture
def al_confirmar(django_capture_on_commit_callbacks):
    """Ejecuta lo que el servicio dejó programado para después del `commit`.

    En producción el correo sale al confirmarse la transacción —así un servidor
    de correo lento no retrasa el guardado, ni uno caído deshace una reparación
    ya registrada—. En las pruebas la transacción se deshace al terminar, de
    modo que sin esto los avisos no se enviarían nunca y lo que se estaría
    midiendo es el silencio.
    """
    from contextlib import contextmanager

    @contextmanager
    def _dentro():
        with django_capture_on_commit_callbacks(execute=True):
            yield

    return _dentro


@pytest.fixture
def registrar(tecnico, al_confirmar):
    def _registrar(activo, **extra):
        datos = {
            "tipo": Mantenimiento.Tipo.CORRECTIVO,
            "fecha_intervencion": datetime.date(2026, 9, 14),
            "tipo_responsable": Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            "responsable": "Soporte TI",
            "descripcion": "Cambio de disco",
            "causa": "No enciende",
        }
        datos.update(extra)
        with al_confirmar():
            return MantenimientoService.registrar(actor=tecnico, activo=activo, **datos)

    return _registrar


# --- Entrar al taller -------------------------------------------------------


def test_avisa_a_quien_responde_por_el_equipo(registrar, crear_activo, con_correo):
    activo = crear_activo(responsables=[con_correo])

    registrar(activo)

    assert len(mail.outbox) == 1
    assert mail.outbox[0].bcc == ["ana.perez@laarcourierdocs.com"]
    assert activo.codigo_barras in mail.outbox[0].subject


def test_el_correo_dice_qué_equipo_es_y_por_qué_entró(registrar, crear_activo, con_correo):
    """Sin el equipo el aviso no sirve de nada, y con la causa se sabe si es
    el que uno reportó o algo nuevo."""
    activo = crear_activo(responsables=[con_correo])

    registrar(activo)

    cuerpo = mail.outbox[0].alternatives[0][0]
    assert activo.codigo_barras in cuerpo
    assert "No enciende" in cuerpo


def test_las_direcciones_van_en_copia_oculta(registrar, crear_activo, con_correo, area):
    """Quién más responde por un equipo no es algo que cada destinatario
    necesite saber."""
    otro = Empleado.objects.create(
        nombres="Paola",
        apellidos="Vaca",
        codigo_empleado="OPE-0003",
        departamento=area,
        correo="paola.vaca@laarcourierdocs.com",
    )
    activo = crear_activo(responsables=[con_correo, otro], compartido=True)

    registrar(activo)

    assert mail.outbox[0].to == []
    assert sorted(mail.outbox[0].bcc) == [
        "ana.perez@laarcourierdocs.com",
        "paola.vaca@laarcourierdocs.com",
    ]


# --- Cuando el responsable no tiene correo ---------------------------------


def test_sin_correo_el_aviso_va_a_quien_registro_la_reparacion(registrar, crear_activo, sin_correo):
    """Es el caso que el pedido describe: el técnico se entera porque el
    asignatario del equipo no tiene correo en su ficha."""
    activo = crear_activo(responsables=[sin_correo])

    mantenimiento = registrar(activo)

    assert mail.outbox[0].bcc == ["tecnico@laarcourierdocs.com"]
    assert mantenimiento.aviso.por_defecto is True


def test_y_se_dice_a_quién_no_se_le_avisó(registrar, crear_activo, sin_correo):
    """No se silencia: un aviso que no llega y nadie sabe que no llegó es peor
    que no tener avisos."""
    activo = crear_activo(responsables=[sin_correo])

    mantenimiento = registrar(activo)

    assert mantenimiento.aviso.sin_correo == ["Luis Mora"]


def test_un_equipo_sin_nadie_a_cargo_avisa_a_quien_lo_registro(registrar, crear_activo):
    """Un equipo de bodega que entra al taller: no hay a quién avisar, pero el
    hecho ocurrió igual."""
    activo = crear_activo()

    mantenimiento = registrar(activo)

    assert mail.outbox[0].bcc == ["tecnico@laarcourierdocs.com"]
    assert mantenimiento.aviso.por_defecto is True
    assert mantenimiento.aviso.sin_correo == []


def test_con_uno_sin_correo_y_otro_con_el_no_se_suma_al_tecnico(
    registrar, crear_activo, con_correo, sin_correo
):
    """El respaldo es para cuando **no se avisó a nadie**. Sumar al técnico a
    cada aviso convertiría su buzón en una copia del registro del sistema."""
    activo = crear_activo(responsables=[con_correo, sin_correo], compartido=True)

    mantenimiento = registrar(activo)

    assert mail.outbox[0].bcc == ["ana.perez@laarcourierdocs.com"]
    assert mantenimiento.aviso.sin_correo == ["Luis Mora"]
    assert mantenimiento.aviso.por_defecto is False


# --- Salir del taller -------------------------------------------------------


def test_avisa_cuando_el_equipo_vuelve(registrar, tecnico, al_confirmar, crear_activo, con_correo):
    activo = crear_activo(responsables=[con_correo])
    mantenimiento = registrar(activo)
    mail.outbox.clear()

    with al_confirmar():
        MantenimientoService.actualizar(
            actor=tecnico,
            mantenimiento=mantenimiento,
            fecha_salida=datetime.date(2026, 9, 16),
            estado_final=Mantenimiento.EstadoFinal.REPARADO,
        )

    assert len(mail.outbox) == 1
    assert "de vuelta" in mail.outbox[0].subject
    assert "2 día(s)" in mail.outbox[0].alternatives[0][0]


def test_corregir_una_reparacion_ya_cerrada_no_vuelve_a_avisar(
    registrar, tecnico, al_confirmar, crear_activo, con_correo
):
    """Arreglar una falta de ortografía en la solución no es que el equipo
    haya vuelto otra vez."""
    activo = crear_activo(responsables=[con_correo])
    mantenimiento = registrar(activo, fecha_salida=datetime.date(2026, 9, 14))
    mail.outbox.clear()

    with al_confirmar():
        MantenimientoService.actualizar(
            actor=tecnico, mantenimiento=mantenimiento, solucion="Se cambió el disco"
        )

    assert mail.outbox == []


def test_una_reparacion_registrada_ya_cerrada_avisa_una_sola_vez(
    registrar, crear_activo, con_correo
):
    """Se arregló en el sitio, en diez minutos: contar que entró y salió en dos
    correos seguidos es contar dos veces lo mismo."""
    activo = crear_activo(responsables=[con_correo])

    registrar(activo, fecha_salida=datetime.date(2026, 9, 14))

    assert len(mail.outbox) == 1
    assert "de vuelta" in mail.outbox[0].subject


# --- Lo que no puede pasar --------------------------------------------------


def test_un_correo_que_falla_no_impide_registrar_la_reparacion(
    registrar, crear_activo, con_correo, monkeypatch
):
    """El servidor de correo no es parte del taller: si está caído, la
    reparación se registra igual y el fallo queda en el registro del sistema."""
    from apps.alertas import eventos

    def explota(*args, **kwargs):
        raise OSError("servidor de correo caído")

    monkeypatch.setattr(eventos.EmailMultiAlternatives, "send", explota)
    activo = crear_activo(responsables=[con_correo])

    mantenimiento = registrar(activo)

    assert Mantenimiento.objects.filter(pk=mantenimiento.pk).exists()


def test_se_pueden_apagar_sin_tocar_el_resumen_del_parque(
    registrar, crear_activo, con_correo, settings
):
    """Son dos cosas distintas: el resumen del §19 tiene frecuencia y estos no."""
    settings.AVISAR_EVENTOS_DE_MANTENIMIENTO = False
    activo = crear_activo(responsables=[con_correo])

    mantenimiento = registrar(activo)

    assert mail.outbox == []
    # Y aun así se sabe a quién se habría avisado: la pantalla lo sigue diciendo.
    assert mantenimiento.aviso.direcciones == ["ana.perez@laarcourierdocs.com"]


def test_el_mismo_correo_repetido_no_recibe_dos_veces(registrar, crear_activo, area):
    """Dos fichas de empleado con la misma dirección —pasa cuando alguien se
    registra dos veces— no son dos avisos."""
    uno = Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez",
        codigo_empleado="OPE-0010",
        departamento=area,
        correo="ana.perez@laarcourierdocs.com",
    )
    otro = Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez Ruiz",
        codigo_empleado="OPE-0011",
        departamento=area,
        correo="ANA.PEREZ@laarcourierdocs.com",
    )
    activo = crear_activo(responsables=[uno, otro], compartido=True)

    registrar(activo)

    assert len(mail.outbox[0].bcc) == 1


# --- Desde la API -----------------------------------------------------------


def test_la_respuesta_dice_a_quien_no_se_le_avisara(tecnico, crear_activo, sin_correo):
    """Quien registra la entrada tiene que enterarse ahí mismo, no descubrirlo
    cuando el responsable pregunte por qué nadie le dijo nada."""
    cliente = APIClient()
    cliente.force_authenticate(user=tecnico)
    activo = crear_activo(responsables=[sin_correo])

    respuesta = cliente.post(
        "/api/v1/mantenimientos/",
        {
            "activo": activo.id,
            "tipo": Mantenimiento.Tipo.CORRECTIVO,
            "fecha_intervencion": "2026-09-14",
            "tipo_responsable": Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            "responsable": "Soporte TI",
            "descripcion": "Cambio de disco",
        },
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.data["aviso"]["sin_correo"] == ["Luis Mora"]
    assert respuesta.data["aviso"]["a_quien_registro"] is True
    assert respuesta.data["aviso"]["enviados"] == 1


def test_el_equipo_sigue_saliendo_en_la_ficha_aunque_no_haya_correo(
    registrar, crear_activo, sin_correo
):
    """El aviso es un extra: que no se pueda mandar no cambia el inventario."""
    activo = crear_activo(responsables=[sin_correo])

    registrar(activo)
    activo.refresh_from_db()

    assert activo.total_mantenimientos == 1
