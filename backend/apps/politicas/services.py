"""Motor de sugerencia de renovación (RF-07).

`evaluar_activo` es la única fuente de verdad del veredicto y se calcula
siempre al vuelo. Los campos `requiere_renovacion` / `motivos_renovacion` del
activo son una caché para poder filtrar y ordenar el listado sin recorrer la
bitácora — nunca se consultan para *decidir*, solo para *buscar*.

La distinción importa porque uno de los tres criterios, la longevidad, cambia
sin que ocurra ningún evento en el sistema: un equipo cruza su vida útil por
el mero paso del tiempo. Si el veredicto viviera solo en la caché, un activo
que nadie tocó nunca dispararía la alerta. De ahí que el comando
`recalcular_indicadores` deba correr periódicamente para refrescarla, y que
las respuestas de la API expongan el cálculo en vivo y no la columna.
"""

from dataclasses import dataclass, field

from django.utils import timezone

from .models import NivelRenovacion, PoliticaObsolescencia, mas_severo


@dataclass
class ResultadoEvaluacion:
    """Veredicto del motor para un activo."""

    requiere_renovacion: bool = False
    nivel: str = NivelRenovacion.NINGUNO
    motivos: list[dict] = field(default_factory=list)
    politica_aplicada: str | None = None

    @property
    def nivel_display(self) -> str:
        return NivelRenovacion(self.nivel).label

    def as_dict(self) -> dict:
        return {
            "requiere_renovacion": self.requiere_renovacion,
            "nivel_renovacion": self.nivel,
            "nivel_renovacion_display": self.nivel_display,
            "motivos": self.motivos,
            "politica_aplicada": self.politica_aplicada,
        }


def restar_meses(fecha, meses: int):
    """Misma fecha `meses` atrás, en aritmética de calendario.

    Se calcula aquí en vez de restar `meses * 30` días para que la ventana de
    12 meses termine exactamente un año antes, y en vez de sumar
    `python-dateutil` al proyecto solo por esta resta. Si el día no existe en
    el mes destino (un 31 de marzo doce meses atrás de un 31 de marzo sí
    existe, pero un 31 de mayo tres meses atrás caería en un 31 de febrero),
    se toma el último día de ese mes.
    """
    import calendar

    total = fecha.month - 1 - meses
    anio = fecha.year + total // 12
    mes = total % 12 + 1
    dia = min(fecha.day, calendar.monthrange(anio, mes)[1])
    return fecha.replace(year=anio, month=mes, day=dia)


def contar_mantenimientos_en_ventana(activo_ids, meses: int) -> dict[int, int]:
    """Intervenciones por activo dentro de los últimos `meses`.

    Una sola consulta agregada para todo el lote: hacerla por activo dentro
    del bucle de evaluación pondría una consulta por equipo, y el documento
    funcional dimensiona el parque entre 5.000 y 10.000.
    """
    from django.db.models import Count

    from apps.mantenimientos.models import Mantenimiento

    activo_ids = list(activo_ids)
    if not activo_ids:
        return {}

    desde = restar_meses(timezone.localdate(), meses)
    filas = (
        Mantenimiento.objects.filter(activo_id__in=activo_ids, fecha_intervencion__gte=desde)
        .values("activo_id")
        .annotate(total=Count("id"))
    )
    return {fila["activo_id"]: fila["total"] for fila in filas}


def _mantenimientos_a_evaluar(activo, politica) -> tuple[int, str]:
    """Cuántas intervenciones se comparan contra el umbral, y cómo describirlo.

    Con ventana móvil se cuentan solo las recientes; sin ella, el historial
    completo. El texto acompaña al número porque «5 mantenimientos» significa
    cosas muy distintas según de qué periodo se hable.
    """
    if politica.cuenta_historial_completo:
        return activo.total_mantenimientos, "en total"

    meses = politica.ventana_mantenimientos_meses
    precalculado = getattr(activo, "mantenimientos_en_ventana", None)
    if precalculado is None:
        precalculado = contar_mantenimientos_en_ventana([activo.id], meses).get(activo.id, 0)
    return precalculado, f"en los últimos {meses} meses"


#: Centinela para distinguir «no me pasaron política» de «este tipo no tiene».
#: Sin él, `evaluar_activo(activo, politica=None)` no puede saber si el
#: llamador ya resolvió la política —y el resultado fue «ninguna»— o si no la
#: resolvió: al asumir lo segundo, volvía a consultarla por cada activo, y
#: recorrer 10.000 equipos costaba 10.000 consultas. Medido: el panel tardaba
#: 55 segundos con 9.000 consultas (ver docs/rendimiento.md).
SIN_RESOLVER = object()


def resolver_politica(tipo_dispositivo) -> PoliticaObsolescencia | None:
    """Política vigente para un tipo de dispositivo.

    La específica gana sobre la global. Una política inactiva no cae de vuelta
    a la global: desactivarla significa "este tipo no se evalúa", que es
    distinto de "este tipo usa el criterio común" — para eso se la elimina.
    """
    especifica = PoliticaObsolescencia.objects.filter(tipo_dispositivo=tipo_dispositivo).first()
    if especifica is not None:
        return especifica if especifica.activa else None
    return PoliticaObsolescencia.objects.filter(tipo_dispositivo__isnull=True, activa=True).first()


def evaluar_activo(activo, politica=SIN_RESOLVER) -> ResultadoEvaluacion:
    """Compara un activo contra su política y devuelve el veredicto.

    Pasar `politica` explícita —incluido `None`, que significa «este tipo no
    tiene política»— evita una consulta por activo al evaluar lotes (ver
    `evaluar_lote` y `recalcular_indicadores`).
    """
    if politica is SIN_RESOLVER:
        politica = resolver_politica(activo.tipo)

    resultado = ResultadoEvaluacion()
    if politica is None:
        return resultado

    resultado.politica_aplicada = politica.nombre

    # Un equipo que ya salió del parque —de baja, perdido o robado— no se
    # "sugiere renovar": lo que hay que hacer con él no es comprar su
    # reemplazo por obsolescencia, y aparecería compitiendo por el
    # presupuesto con equipos que sí están en uso.
    if not activo.esta_operativo:
        return resultado

    if politica.max_mantenimientos is not None:
        intervenciones, periodo = _mantenimientos_a_evaluar(activo, politica)
        if intervenciones > politica.max_mantenimientos:
            resultado.motivos.append(
                {
                    "criterio": "mantenimientos",
                    "nivel": NivelRenovacion.EVALUAR,
                    "detalle": (
                        f"Acumula {intervenciones} mantenimientos {periodo} y la política "
                        f"tolera hasta {politica.max_mantenimientos}."
                    ),
                    "valor_actual": intervenciones,
                    "umbral": politica.max_mantenimientos,
                }
            )

    if (
        politica.max_componentes_criticos is not None
        and activo.total_componentes_criticos > politica.max_componentes_criticos
    ):
        resultado.motivos.append(
            {
                "criterio": "componentes_criticos",
                "nivel": NivelRenovacion.EVALUAR,
                "detalle": (
                    f"Se le han sustituido {activo.total_componentes_criticos} piezas críticas "
                    f"y la política tolera hasta {politica.max_componentes_criticos}."
                ),
                "valor_actual": activo.total_componentes_criticos,
                "umbral": politica.max_componentes_criticos,
            }
        )

    # Longevidad: se reporta un solo motivo, con el nivel más alto que alcance.
    # Emitir dos ("evaluar" y "recomendado" por la misma antigüedad) diría dos
    # veces lo mismo en la ficha del equipo.
    antiguedad = activo.antiguedad_meses
    critica = politica.vida_util_critica_meses
    if critica is not None and antiguedad >= critica:
        resultado.motivos.append(
            {
                "criterio": "longevidad",
                "nivel": NivelRenovacion.RECOMENDADO,
                "detalle": (
                    f"Tiene {antiguedad} meses de antigüedad y supera los {critica} meses "
                    "a partir de los cuales se recomienda reemplazarlo."
                ),
                "valor_actual": antiguedad,
                "umbral": critica,
            }
        )
    elif politica.vida_util_meses is not None and antiguedad >= politica.vida_util_meses:
        resultado.motivos.append(
            {
                "criterio": "longevidad",
                "nivel": NivelRenovacion.EVALUAR,
                "detalle": (
                    f"Tiene {antiguedad} meses de antigüedad y su vida útil "
                    f"es de {politica.vida_util_meses} meses."
                ),
                "valor_actual": antiguedad,
                "umbral": politica.vida_util_meses,
            }
        )

    resultado.nivel = mas_severo(*(motivo["nivel"] for motivo in resultado.motivos))
    resultado.requiere_renovacion = resultado.nivel != NivelRenovacion.NINGUNO
    return resultado


def refrescar_indicadores_renovacion(
    activo,
    politica=SIN_RESOLVER,
    resultado: "ResultadoEvaluacion | None" = None,
):
    """Escribe el veredicto en la caché del activo y lo devuelve.

    Solo toca las columnas de caché: nunca guarda el modelo completo, para no
    pisar una edición concurrente de la ficha técnica. `resultado` permite
    reutilizar un veredicto ya calculado en lote (ver `evaluar_lote`) en vez de
    recalcularlo activo por activo.
    """
    if resultado is None:
        resultado = evaluar_activo(activo, politica=politica)
    activo.requiere_renovacion = resultado.requiere_renovacion
    activo.nivel_renovacion = resultado.nivel
    activo.motivos_renovacion = resultado.motivos
    activo.renovacion_evaluada_en = timezone.now()
    activo.save(
        update_fields=[
            "requiere_renovacion",
            "nivel_renovacion",
            "motivos_renovacion",
            "renovacion_evaluada_en",
        ]
    )
    return resultado


def resolver_politicas_de(tipo_ids) -> dict:
    """Política vigente de cada tipo, en dos consultas para todos.

    `resolver_politica` cuesta dos consultas por tipo; con ocho tipos eran
    dieciséis viajes a la base para una tabla que cabe entera en memoria.
    """
    tipo_ids = set(tipo_ids)
    if not tipo_ids:
        return {}

    especificas = {
        politica.tipo_dispositivo_id: politica
        for politica in PoliticaObsolescencia.objects.filter(tipo_dispositivo_id__in=tipo_ids)
    }
    # La global solo se consulta si algún tipo se quedó sin la suya: cuando
    # todos tienen política propia, esa consulta no se usaría para nada.
    global_ = None
    if tipo_ids - set(especificas):
        global_ = PoliticaObsolescencia.objects.filter(
            tipo_dispositivo__isnull=True, activa=True
        ).first()

    resueltas = {}
    for tipo_id in tipo_ids:
        especifica = especificas.get(tipo_id)
        if especifica is not None:
            # Una política inactiva no cae de vuelta a la global: desactivarla
            # significa «este tipo no se evalúa».
            resueltas[tipo_id] = especifica if especifica.activa else None
        else:
            resueltas[tipo_id] = global_
    return resueltas


def evaluar_lote(activos, politicas_por_tipo=None):
    """Evalúa varios activos resolviendo la ventana móvil en pocas consultas.

    Devuelve `[(activo, resultado)]`. Los llamadores que recorren el parque
    entero (sugerencias, reevaluación masiva, el comando diario) pasan por
    aquí para no multiplicar consultas por activo.
    """
    activos, politicas = precalcular_ventanas(activos, politicas_por_tipo)
    return [
        (activo, evaluar_activo(activo, politica=politicas.get(activo.tipo_id)))
        for activo in activos
    ]


def precalcular_ventanas(activos, politicas_por_tipo=None):
    """Resuelve las políticas y deja el conteo de la ventana móvil en memoria.

    Devuelve `(activos, politicas_por_tipo)`. Se agrupa por ventana porque cada
    tipo de dispositivo puede tener la suya: contar todo con una sola daría
    cifras equivocadas al que tenga otra configurada.
    """
    activos = list(activos)
    politicas = politicas_por_tipo if politicas_por_tipo is not None else {}
    politicas.update(resolver_politicas_de({activo.tipo_id for activo in activos} - set(politicas)))

    por_ventana: dict[int, list[int]] = {}
    for activo in activos:
        politica = politicas.get(activo.tipo_id)
        if politica is None or politica.cuenta_historial_completo:
            continue
        por_ventana.setdefault(politica.ventana_mantenimientos_meses, []).append(activo.id)

    conteos = {
        meses: contar_mantenimientos_en_ventana(ids, meses) for meses, ids in por_ventana.items()
    }

    for activo in activos:
        politica = politicas.get(activo.tipo_id)
        if politica is not None and not politica.cuenta_historial_completo:
            ventana = politica.ventana_mantenimientos_meses
            activo.mantenimientos_en_ventana = conteos.get(ventana, {}).get(activo.id, 0)
    return activos, politicas


def candidatos_a_renovacion(activos, politicas_por_tipo=None):
    """Reduce en SQL el parque a los que *podrían* requerir renovación.

    Evaluar el veredicto exige Python —los motivos se redactan uno a uno— pero
    traer diez mil activos para descartar nueve mil quinientos cuesta casi dos
    segundos en las pantallas que más se consultan. Este prefiltro deja pasar
    solo a los que superan algún umbral, y la evaluación real se hace sobre
    ellos. Devuelve `(queryset, politicas_por_tipo)` para que el llamador se
    ahorre resolver las políticas otra vez.

    Es deliberadamente **más ancho que el criterio final**: usa el total
    histórico de mantenimientos aunque la política cuente una ventana móvil.
    El total siempre es mayor o igual que el de la ventana, así que ningún
    candidato se pierde; a lo sumo entran algunos que la evaluación después
    descarta, que es el error que se puede permitir. Al revés —un filtro más
    estrecho que el criterio— escondería equipos que sí hay que reemplazar.

    No lo usan los endpoints de reevaluación: esos recorren el parque entero
    porque además de encender la marca deben apagarla en los que dejaron de
    calificar.
    """
    from django.db.models import Q
    from django.utils import timezone

    politicas = dict(politicas_por_tipo or {})
    if not politicas:
        # Los tipos presentes se preguntan con un DISTINCT, no trayendo los
        # activos: materializarlos aquí anularía el ahorro que busca el
        # prefiltro.
        politicas = resolver_politicas_de(activos.values_list("tipo_id", flat=True).distinct())

    hoy = timezone.localdate()
    condicion = Q(pk__in=[])
    for tipo_id, politica in politicas.items():
        if politica is None:
            continue
        criterios = Q(pk__in=[])
        umbral_vida = politica.vida_util_meses or politica.vida_util_critica_meses
        if umbral_vida:
            criterios |= Q(fecha_adquisicion__lte=restar_meses(hoy, umbral_vida))
        if politica.max_mantenimientos is not None:
            criterios |= Q(total_mantenimientos__gt=politica.max_mantenimientos)
        if politica.max_componentes_criticos is not None:
            criterios |= Q(total_componentes_criticos__gt=politica.max_componentes_criticos)
        condicion |= Q(tipo_id=tipo_id) & criterios

    return activos.filter(condicion), politicas
