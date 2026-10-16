"""El comando que manda una muestra de cada aviso a un buzón.

Existe para lo que ninguna prueba puede contestar —cómo se ve el correo al
llegar a Outlook—, pero lo que sí se puede sostener aquí es que **las muestras
cubran todos los casos** y que las plantillas se dibujen sin romperse. Una
muestra que falla al renderizar no se descubre hasta que alguien la pide, y
para entonces ya está delante del buzón de otro.
"""

import pytest
from django.core import mail
from django.core.management import CommandError, call_command

from apps.alertas.management.commands.enviar_avisos_de_muestra import muestras

pytestmark = pytest.mark.django_db


def test_hay_una_muestra_por_cada_situacion_que_el_sistema_avisa():
    """Entrada y salida, y dentro de la salida los cuatro desenlaces."""
    titulos = [titulo for titulo, _, _, _ in muestras()]

    assert "Entra al taller" in titulos
    assert "Vuelve reparado" in titulos
    assert "Vuelve pendiente" in titulos
    assert "No reparable" in titulos


def test_todas_las_plantillas_se_dibujan(settings):
    """Sin mandar nada: una variable mal escrita en la plantilla se nota aquí,
    y no cuando alguien pide las muestras."""
    from apps.alertas.management.commands.enviar_avisos_de_muestra import variables_de_muestra
    from apps.correos import servicio

    for titulo, clave, mantenimiento, _ in muestras():
        correo = servicio.renderizar(clave, variables_de_muestra(clave, mantenimiento))
        assert mantenimiento.activo.codigo_barras in correo["html"], titulo
        assert correo["texto"].strip(), titulo


def test_manda_una_por_cada_muestra():
    call_command("enviar_avisos_de_muestra", "--a", "quien.sea@empresa.com")

    assert len(mail.outbox) == len(muestras())
    assert all(correo.bcc == ["quien.sea@empresa.com"] for correo in mail.outbox)


def test_el_asunto_dice_que_es_una_muestra():
    """Para que nadie las confunda con un aviso de un equipo de verdad."""
    call_command("enviar_avisos_de_muestra", "--a", "quien.sea@empresa.com")

    assert all("[Muestra" in correo.subject for correo in mail.outbox)


def test_una_direccion_que_no_lo_es_se_rechaza_antes_de_enviar():
    with pytest.raises(CommandError):
        call_command("enviar_avisos_de_muestra", "--a", "no-es-un-correo")

    assert mail.outbox == []


def test_no_deja_nada_en_la_base():
    """Arma los objetos en memoria: revisar un texto no debe ensuciar el
    inventario con equipos de prueba."""
    from apps.activos.models import Activo
    from apps.mantenimientos.models import Mantenimiento

    antes = (Activo.objects.count(), Mantenimiento.objects.count())

    call_command("enviar_avisos_de_muestra", "--a", "quien.sea@empresa.com")

    assert (Activo.objects.count(), Mantenimiento.objects.count()) == antes
