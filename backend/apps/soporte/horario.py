"""El tiempo hábil de un técnico: cuándo atiende y cuánto falta para un plazo.

El SLA no se descuenta minuto a minuto: al tomar un ticket se calcula su
vencimiento absoluto proyectando los minutos del plazo sobre el horario de
quien lo tomó (sus franjas semanales menos sus ausencias). Así la tarea
programada solo compara fechas.

Todo se calcula en la zona horaria del sistema (`TIME_ZONE`): un horario de
08:00 a 17:00 es de Guayaquil, no de UTC.
"""

from datetime import datetime, timedelta

from django.utils import timezone

#: Hasta dónde se busca hacia adelante. Un técnico sin horario, o de vacaciones
#: un año, no debe dejar el cálculo dando vueltas para siempre.
DIAS_MAXIMOS = 120


class Agenda:
    """Las franjas y ausencias de un técnico, cargadas una vez."""

    def __init__(self, tecnico):
        self.franjas = {}
        for franja in tecnico.horarios.all():
            if franja.hora_fin > franja.hora_inicio:
                self.franjas.setdefault(franja.dia_semana, []).append(
                    (franja.hora_inicio, franja.hora_fin)
                )
        for lista in self.franjas.values():
            lista.sort()
        self.ausencias = [(a.desde, a.hasta) for a in tecnico.ausencias.all()]

    @property
    def tiene_horario(self) -> bool:
        return bool(self.franjas)

    def _ausente(self, dia) -> bool:
        return any(desde <= dia <= hasta for desde, hasta in self.ausencias)

    def tramos_del_dia(self, dia):
        """Los tramos de atención de una fecha, como datetimes locales."""
        if self._ausente(dia):
            return []
        zona = timezone.get_current_timezone()
        return [
            (
                timezone.make_aware(datetime.combine(dia, inicio), zona),
                timezone.make_aware(datetime.combine(dia, fin), zona),
            )
            for inicio, fin in self.franjas.get(dia.weekday(), [])
        ]

    def en_horario(self, momento=None) -> bool:
        momento = timezone.localtime(momento or timezone.now())
        return any(inicio <= momento < fin for inicio, fin in self.tramos_del_dia(momento.date()))

    def sumar_minutos(self, desde, minutos: int):
        """El momento en que se cumplen `minutos` hábiles contados desde `desde`.

        `None` si el técnico no tiene horario o no lo alcanza en el horizonte.
        """
        if not self.tiene_horario:
            return None
        restante = timedelta(minutes=minutos)
        actual = timezone.localtime(desde)
        for _ in range(DIAS_MAXIMOS):
            for inicio, fin in self.tramos_del_dia(actual.date()):
                if fin <= actual:
                    continue
                comienzo = max(inicio, actual)
                disponible = fin - comienzo
                if restante <= disponible:
                    return comienzo + restante
                restante -= disponible
            siguiente = actual.date() + timedelta(days=1)
            actual = timezone.make_aware(
                datetime.combine(siguiente, datetime.min.time()), timezone.get_current_timezone()
            )
        return None

    def minutos_entre(self, desde, hasta) -> int:
        """Minutos hábiles entre dos momentos (0 si `hasta` es anterior)."""
        if hasta <= desde:
            return 0
        total = timedelta()
        actual = timezone.localtime(desde)
        fin_total = timezone.localtime(hasta)
        dia = actual.date()
        for _ in range(DIAS_MAXIMOS):
            if dia > fin_total.date():
                break
            for inicio, fin in self.tramos_del_dia(dia):
                comienzo = max(inicio, actual)
                termino = min(fin, fin_total)
                if termino > comienzo:
                    total += termino - comienzo
            dia += timedelta(days=1)
        return int(total.total_seconds() // 60)

    def proximo_inicio(self, desde=None):
        """Cuándo empieza su próxima franja de atención (o `None`)."""
        actual = timezone.localtime(desde or timezone.now())
        for _ in range(DIAS_MAXIMOS):
            for inicio, fin in self.tramos_del_dia(actual.date()):
                if fin > actual:
                    return max(inicio, actual)
            siguiente = actual.date() + timedelta(days=1)
            actual = timezone.make_aware(
                datetime.combine(siguiente, datetime.min.time()), timezone.get_current_timezone()
            )
        return None
