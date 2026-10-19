"""El tiempo hábil: cuándo se atiende y cuánto falta para un plazo.

El SLA no se descuenta minuto a minuto: al crear un ticket se calcula su
vencimiento absoluto proyectando los minutos del plazo sobre el calendario de
su prioridad (el horario hábil de la mesa, o las 24 horas para los P1). Así la
tarea programada solo compara fechas.

Todo se calcula en la zona horaria del sistema (`TIME_ZONE`): un horario de
08:00 a 17:00 es de Guayaquil, no de UTC.
"""

from datetime import datetime, timedelta

from django.utils import timezone

#: Hasta dónde se busca hacia adelante. Un técnico sin horario, o de vacaciones
#: un año, no debe dejar el cálculo dando vueltas para siempre.
DIAS_MAXIMOS = 120


class Agenda:
    """Un calendario de atención: franjas semanales menos fechas sin atención.

    Sirve para tres cosas: el horario de un técnico (`Agenda(tecnico)`, decide
    el reparto), el horario hábil de la mesa (`Agenda.de_franjas`, mide los
    plazos de P2 a P4) y el reloj continuo de los P1 (`Agenda.continua()`, las
    24 horas de todos los días).
    """

    def __init__(self, tecnico=None):
        self.continua_ = False
        self.franjas = {}
        self.ausencias = []
        if tecnico is not None:
            self._cargar(
                [(f.dia_semana, f.hora_inicio, f.hora_fin) for f in tecnico.horarios.all()],
                [(a.desde, a.hasta) for a in tecnico.ausencias.all()],
            )

    @classmethod
    def de_franjas(cls, franjas, ausencias=()):
        """`franjas`: (día, inicio, fin); `ausencias`: (desde, hasta)."""
        agenda = cls()
        agenda._cargar(franjas, ausencias)
        return agenda

    @classmethod
    def continua(cls):
        agenda = cls()
        agenda.continua_ = True
        return agenda

    def _cargar(self, franjas, ausencias):
        for dia, inicio, fin in franjas:
            if fin > inicio:
                self.franjas.setdefault(dia, []).append((inicio, fin))
        for lista in self.franjas.values():
            lista.sort()
        self.ausencias = list(ausencias)

    @property
    def tiene_horario(self) -> bool:
        return self.continua_ or bool(self.franjas)

    def _ausente(self, dia) -> bool:
        return any(desde <= dia <= hasta for desde, hasta in self.ausencias)

    def es_habil(self, dia) -> bool:
        """Si en esa fecha se atiende (tiene franjas y no es feriado)."""
        return bool(self.tramos_del_dia(dia))

    def tramos_del_dia(self, dia):
        """Los tramos de atención de una fecha, como datetimes locales."""
        zona = timezone.get_current_timezone()
        if self.continua_:
            return [
                (
                    timezone.make_aware(datetime.combine(dia, datetime.min.time()), zona),
                    timezone.make_aware(
                        datetime.combine(dia + timedelta(days=1), datetime.min.time()), zona
                    ),
                )
            ]
        if self._ausente(dia):
            return []
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
