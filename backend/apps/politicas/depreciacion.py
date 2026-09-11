"""Qué vale hoy un equipo, y cuánto valor ha perdido por el camino (§22.3).

Depreciación **lineal**: el costo menos el valor residual se reparte en partes
iguales entre los meses de vida contable. Es el único método, y es una decisión
—no una simplificación pendiente de ampliar—: lo que se declara ante el SRI lo
lleva el ERP (§20), y el §25 deja la «depreciación contable avanzada» en
prioridad baja. Aquí la pregunta es otra: qué vale el parque, y cuánto se
pierde al dar de baja un equipo antes de tiempo.

Todo lo de este módulo son funciones puras sobre valores, sin tocar la base:
el mismo cálculo lo usan la ficha del activo, el reporte del §16 y las pruebas,
y ninguno debería depender de que exista una petición.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from .models import PoliticaDepreciacion

#: Dos decimales, como el dinero que se escribe en un informe.
CENTAVO = Decimal("0.01")


def meses_cumplidos(desde: date, hasta: date) -> int:
    """Meses enteros entre dos fechas, en aritmética de calendario.

    Un equipo que entró el 15 de enero cumple un mes el 15 de febrero, tenga
    febrero 28 o 29 días. Es la misma regla que `Activo.antiguedad_meses`, y
    deliberadamente **no** la de `apps.core.duracion`: aquella recibe un número
    de días —no dos fechas— y por eso fija el mes en 30. Aquí hay fechas, así
    que se cuenta el calendario.
    """
    meses = (hasta.year - desde.year) * 12 + (hasta.month - desde.month)
    if hasta.day < desde.day:
        meses -= 1
    return max(meses, 0)


@dataclass(frozen=True)
class Depreciacion:
    """Lo que se sabe del valor de un equipo en una fecha dada."""

    costo: Decimal
    #: Desde cuándo se deprecia: el día en que entró en servicio.
    desde: date
    meses_vida_contable: int
    meses_transcurridos: int
    cuota_mensual: Decimal
    acumulada: Decimal
    valor_en_libros: Decimal
    porcentaje_depreciado: Decimal
    #: El día en que el equipo termina de depreciarse. Sirve para responder
    #: «¿cuándo deja de valer?» sin tener que contar meses a mano.
    fin: date

    @property
    def totalmente_depreciado(self) -> bool:
        return self.meses_transcurridos >= self.meses_vida_contable


#: Por qué un equipo no tiene depreciación que mostrar. Se dice en vez de
#: devolver ceros: un valor en libros de 0 significa «ya no vale nada», que es
#: muy distinto de «nadie capturó lo que costó».
SIN_COSTO = "El equipo no tiene costo de compra registrado, así que no hay de qué partir."
SIN_POLITICA = (
    "El tipo de dispositivo no tiene política de depreciación ni hay una global configurada."
)


def resolver_politica(tipo_dispositivo) -> PoliticaDepreciacion | None:
    """Política vigente para un tipo, con la específica ganando sobre la global.

    Igual que en obsolescencia, una política inactiva **no** cae de vuelta a la
    global: desactivarla significa «este tipo no se deprecia aquí», que es
    distinto de «este tipo usa el criterio común» —para eso se la elimina—.
    """
    especifica = PoliticaDepreciacion.objects.filter(tipo_dispositivo=tipo_dispositivo).first()
    if especifica is not None:
        return especifica if especifica.activa else None
    return PoliticaDepreciacion.objects.filter(tipo_dispositivo__isnull=True, activa=True).first()


def resolver_politicas_de(tipo_ids) -> dict:
    """La política de cada tipo, en dos consultas para todos.

    Lo necesita el reporte: resolver una por una costaba dos viajes a la base
    por cada activo listado.
    """
    tipo_ids = set(tipo_ids)
    if not tipo_ids:
        return {}

    especificas = {
        politica.tipo_dispositivo_id: politica
        for politica in PoliticaDepreciacion.objects.filter(tipo_dispositivo_id__in=tipo_ids)
    }
    global_ = None
    if tipo_ids - set(especificas):
        global_ = PoliticaDepreciacion.objects.filter(
            tipo_dispositivo__isnull=True, activa=True
        ).first()

    resueltas = {}
    for tipo_id in tipo_ids:
        especifica = especificas.get(tipo_id)
        if especifica is not None:
            resueltas[tipo_id] = especifica if especifica.activa else None
        else:
            resueltas[tipo_id] = global_
    return resueltas


def calcular(costo, desde: date, politica: PoliticaDepreciacion, a_fecha: date | None = None):
    """Depreciación de un equipo a una fecha, o `None` si no hay con qué.

    `desde` es el día en que el equipo entró en servicio, no el de la factura:
    un equipo comprado en diciembre que se entrega en marzo empieza a perder
    valor en marzo, porque hasta entonces no estuvo produciendo nada.
    """
    if costo is None or politica is None:
        return None
    costo = Decimal(costo)
    if costo <= 0:
        return None

    a_fecha = a_fecha or timezone.localdate()
    meses_vida = politica.meses_vida_contable
    residual = costo * Decimal(politica.porcentaje_residual) / Decimal(100)
    base = costo - residual

    transcurridos = meses_cumplidos(desde, a_fecha)
    cuota = base / Decimal(meses_vida)
    # El tope es lo que impide que un equipo de ocho años tenga valor negativo:
    # una vez depreciado, deja de perder.
    acumulada = min(cuota * Decimal(min(transcurridos, meses_vida)), base)

    return Depreciacion(
        costo=_centavos(costo),
        desde=desde,
        meses_vida_contable=meses_vida,
        meses_transcurridos=transcurridos,
        cuota_mensual=_centavos(cuota),
        acumulada=_centavos(acumulada),
        valor_en_libros=_centavos(costo - acumulada),
        # Sobre el costo y no sobre la base depreciable: es el porcentaje que
        # alguien espera leer —«está depreciado al 90 %»— y con residual cero
        # las dos cuentas coinciden de todos modos.
        porcentaje_depreciado=_centavos(acumulada / costo * Decimal(100)),
        fin=_sumar_meses(desde, meses_vida),
    )


def calcular_de(activo, politica) -> Depreciacion | None:
    """La depreciación de un activo, con su fecha de puesta en servicio."""
    return calcular(activo.costo_adquisicion, fecha_en_servicio(activo), politica)


def fecha_en_servicio(activo) -> date:
    """Desde cuándo se deprecia este equipo.

    La fecha de ingreso al inventario si está capturada y, si no, la de compra.
    Es la misma distinción que ya hace el resto del sistema: la garantía corre
    desde la compra y la custodia desde el ingreso.
    """
    return activo.fecha_ingreso or activo.fecha_adquisicion


def motivo_sin_depreciacion(activo, politica) -> str | None:
    """Por qué este equipo no muestra valor en libros, si es que no lo muestra."""
    if politica is None:
        return SIN_POLITICA
    if not activo.costo_adquisicion or Decimal(activo.costo_adquisicion) <= 0:
        return SIN_COSTO
    return None


def _centavos(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def _sumar_meses(desde: date, meses: int) -> date:
    """La misma fecha, `meses` más tarde.

    El día se recorta al último del mes cuando no existe: un equipo que entró
    el 31 de enero termina de depreciarse el 28 o 29 de febrero, no el 3 de
    marzo.
    """
    total = desde.month - 1 + meses
    anio = desde.year + total // 12
    mes = total % 12 + 1
    dia = min(desde.day, _dias_del_mes(anio, mes))
    return date(anio, mes, dia)


def _dias_del_mes(anio: int, mes: int) -> int:
    import calendar

    return calendar.monthrange(anio, mes)[1]
