"""Días hábiles de un mes (aviso del rol de pagos, 29/10/2026).

Hábil es de lunes a viernes y no feriado del calendario institucional: un
feriado puede durar varios días y repetirse cada año. Lo demás del calendario
(eventos, cumpleaños) no quita días.
"""

import datetime

from apps.nomina import dias_habiles
from apps.organizacion.models import EventoCalendario

D = datetime.date


def _feriado(fecha, fecha_fin=None, cada_anio=False, tipo=EventoCalendario.Tipo.FERIADO):
    return EventoCalendario.objects.create(
        titulo="Feriado", tipo=tipo, fecha=fecha, fecha_fin=fecha_fin, cada_anio=cada_anio
    )


def test_sin_feriados_el_primero_es_el_primer_dia_de_semana(db):
    # Octubre de 2026 empieza en jueves.
    assert dias_habiles.primer_dia_habil(2026, 10) == D(2026, 10, 1)
    assert dias_habiles.numero_de_dia_habil(D(2026, 10, 1)) == 1
    assert dias_habiles.numero_de_dia_habil(D(2026, 10, 5)) == 3  # lunes
    # Un sábado cuenta los hábiles ya transcurridos.
    assert dias_habiles.numero_de_dia_habil(D(2026, 10, 3)) == 2
    assert not dias_habiles.es_habil(D(2026, 10, 3))
    assert dias_habiles.es_habil(D(2026, 10, 2))


def test_si_el_mes_empieza_en_fin_de_semana(db):
    # Noviembre de 2026 empieza en domingo.
    assert dias_habiles.primer_dia_habil(2026, 11) == D(2026, 11, 2)
    assert dias_habiles.numero_de_dia_habil(D(2026, 11, 1)) == 0
    assert dias_habiles.numero_de_dia_habil(D(2026, 11, 2)) == 1


def test_un_feriado_el_dia_uno(db):
    _feriado(D(2026, 10, 1))
    assert not dias_habiles.es_habil(D(2026, 10, 1))
    assert dias_habiles.primer_dia_habil(2026, 10) == D(2026, 10, 2)
    assert dias_habiles.numero_de_dia_habil(D(2026, 10, 1)) == 0
    assert dias_habiles.numero_de_dia_habil(D(2026, 10, 5)) == 2


def test_un_feriado_de_varios_dias(db):
    # Del 30 de septiembre al 2 de octubre: quita el jueves 1 y el viernes 2.
    _feriado(D(2026, 9, 30), fecha_fin=D(2026, 10, 2))
    assert dias_habiles.primer_dia_habil(2026, 10) == D(2026, 10, 5)
    assert dias_habiles.numero_de_dia_habil(D(2026, 10, 6)) == 2


def test_un_feriado_de_cada_anio(db):
    _feriado(D(2020, 10, 1), cada_anio=True)
    assert dias_habiles.primer_dia_habil(2026, 10) == D(2026, 10, 2)
    # Uno de varios días que empieza en diciembre y sigue en enero.
    _feriado(D(2020, 12, 31), fecha_fin=D(2021, 1, 1), cada_anio=True)
    # Enero de 2027: el 1 es viernes (feriado); el primero hábil, el lunes 4.
    assert dias_habiles.primer_dia_habil(2027, 1) == D(2027, 1, 4)


def test_otros_eventos_del_calendario_no_quitan_dias(db):
    _feriado(D(2026, 10, 1), tipo=EventoCalendario.Tipo.EVENTO)
    _feriado(D(2020, 10, 2), cada_anio=True, tipo=EventoCalendario.Tipo.CUMPLEANOS)
    assert dias_habiles.primer_dia_habil(2026, 10) == D(2026, 10, 1)
    assert dias_habiles.numero_de_dia_habil(D(2026, 10, 2)) == 2
