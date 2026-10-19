"""El calendario de Inicio (19/10/2026): eventos importantes, cumpleaños y
feriados que la empresa marca para que todos los vean.

Se pide por rango de fechas (el mes que se mira) y se devuelve cada aparición
en ese rango: un evento de varios días aparece una vez con su inicio y fin, y
uno que se repite cada año aparece en cada año del rango.
"""

import datetime

from .models import EventoCalendario

#: Un rango más largo que esto no lo pide ninguna pantalla.
DIAS_MAXIMOS = 400


def _en_el_anio(fecha: datetime.date, anio: int) -> datetime.date:
    """La misma fecha en otro año; el 29 de febrero cae el 28 si no es
    bisiesto."""
    try:
        return fecha.replace(year=anio)
    except ValueError:
        return fecha.replace(year=anio, day=28)


def _aparicion(evento, inicio, fin):
    return {
        "id": evento.id,
        "titulo": evento.titulo,
        "tipo": evento.tipo,
        "tipo_display": evento.get_tipo_display(),
        "descripcion": evento.descripcion,
        "fecha": inicio.isoformat(),
        "fecha_fin": fin.isoformat(),
        "cada_anio": evento.cada_anio,
    }


def apariciones(desde: datetime.date, hasta: datetime.date) -> list[dict]:
    resultado = []
    for evento in EventoCalendario.objects.all():
        duracion = (evento.fecha_fin - evento.fecha) if evento.fecha_fin else datetime.timedelta()
        if evento.cada_anio:
            anios = range(desde.year - 1, hasta.year + 1)
            inicios = [_en_el_anio(evento.fecha, a) for a in anios if a >= evento.fecha.year]
        else:
            inicios = [evento.fecha]
        for inicio in inicios:
            fin = inicio + duracion
            if inicio <= hasta and fin >= desde:
                resultado.append(_aparicion(evento, inicio, fin))
    return sorted(resultado, key=lambda a: (a["fecha"], a["titulo"]))
