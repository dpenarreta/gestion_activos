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
    resultado.extend(_cumpleanos_publicados(desde, hasta))
    resultado.extend(_aniversarios_publicados(desde, hasta))
    return sorted(resultado, key=lambda a: (a["fecha"], a["titulo"]))


def _cumpleanos_publicados(desde, hasta) -> list[dict]:
    """Los cumpleaños que cada persona decidió mostrar (en «Mi perfil»), cada
    año del rango. Solo de personas activas de la empresa."""
    from .models import DatosDeContacto

    resultado = []
    perfiles = DatosDeContacto.objects.filter(
        mostrar_cumpleanos=True,
        cumpleanos_dia__isnull=False,
        cumpleanos_mes__isnull=False,
        usuario__is_active=True,
    ).select_related("usuario")
    for perfil in perfiles:
        nombre = perfil.usuario.get_full_name().strip() or perfil.usuario.username
        for anio in range(desde.year, hasta.year + 1):
            try:
                dia = datetime.date(anio, perfil.cumpleanos_mes, perfil.cumpleanos_dia)
            except ValueError:  # 29 de febrero en un año no bisiesto
                dia = datetime.date(anio, 2, 28)
            if desde <= dia <= hasta:
                resultado.append(
                    {
                        "id": f"cumple-{perfil.usuario_id}",
                        "titulo": f"Cumpleaños de {nombre}",
                        "tipo": "cumpleanos",
                        "tipo_display": "Cumpleaños",
                        "descripcion": "",
                        "fecha": dia.isoformat(),
                        "fecha_fin": dia.isoformat(),
                        "cada_anio": True,
                    }
                )
    return resultado


def _aniversarios_publicados(desde, hasta) -> list[dict]:
    """Los aniversarios en la empresa que cada persona decidió mostrar (en «Mi
    perfil»), cada año del rango. Con el año de ingreso se dicen los años
    cumplidos (y no se muestra antes de cumplir el primero)."""
    from .models import DatosDeContacto

    resultado = []
    perfiles = DatosDeContacto.objects.filter(
        mostrar_aniversario=True,
        aniversario_dia__isnull=False,
        aniversario_mes__isnull=False,
        usuario__is_active=True,
    ).select_related("usuario")
    for perfil in perfiles:
        nombre = perfil.usuario.get_full_name().strip() or perfil.usuario.username
        for anio in range(desde.year, hasta.year + 1):
            try:
                dia = datetime.date(anio, perfil.aniversario_mes, perfil.aniversario_dia)
            except ValueError:  # 29 de febrero en un año no bisiesto
                dia = datetime.date(anio, 2, 28)
            if not desde <= dia <= hasta:
                continue
            anios = anio - perfil.aniversario_anio if perfil.aniversario_anio else None
            if anios is not None and anios < 1:
                continue
            resultado.append(
                {
                    "id": f"aniversario-{perfil.usuario_id}",
                    "titulo": f"Aniversario de {nombre}",
                    "tipo": "aniversario",
                    "tipo_display": "Aniversario en la empresa",
                    "descripcion": (
                        f"{anios} {'año' if anios == 1 else 'años'} en la empresa" if anios else ""
                    ),
                    "fecha": dia.isoformat(),
                    "fecha_fin": dia.isoformat(),
                    "cada_anio": True,
                }
            )
    return resultado
