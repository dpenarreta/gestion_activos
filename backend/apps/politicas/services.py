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

from .models import PoliticaObsolescencia


@dataclass
class ResultadoEvaluacion:
    """Veredicto del motor para un activo."""

    requiere_renovacion: bool = False
    motivos: list[dict] = field(default_factory=list)
    politica_aplicada: str | None = None

    def as_dict(self) -> dict:
        return {
            "requiere_renovacion": self.requiere_renovacion,
            "motivos": self.motivos,
            "politica_aplicada": self.politica_aplicada,
        }


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


def evaluar_activo(activo, politica: PoliticaObsolescencia | None = None) -> ResultadoEvaluacion:
    """Compara un activo contra su política y devuelve el veredicto.

    Pasar `politica` explícita evita una consulta por activo al evaluar lotes
    (ver `recalcular_indicadores`).
    """
    if politica is None:
        politica = resolver_politica(activo.tipo)

    resultado = ResultadoEvaluacion()
    if politica is None:
        return resultado

    resultado.politica_aplicada = politica.nombre

    # Un equipo ya dado de baja no se "sugiere renovar": ya salió del parque.
    if activo.estado == activo.Estado.DADO_DE_BAJA:
        return resultado

    if (
        politica.max_mantenimientos is not None
        and activo.total_mantenimientos > politica.max_mantenimientos
    ):
        resultado.motivos.append(
            {
                "criterio": "mantenimientos",
                "detalle": (
                    f"Acumula {activo.total_mantenimientos} mantenimientos y la política "
                    f"tolera hasta {politica.max_mantenimientos}."
                ),
                "valor_actual": activo.total_mantenimientos,
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
                "detalle": (
                    f"Se le han sustituido {activo.total_componentes_criticos} piezas críticas "
                    f"y la política tolera hasta {politica.max_componentes_criticos}."
                ),
                "valor_actual": activo.total_componentes_criticos,
                "umbral": politica.max_componentes_criticos,
            }
        )

    if politica.vida_util_meses is not None:
        antiguedad = activo.antiguedad_meses
        if antiguedad >= politica.vida_util_meses:
            resultado.motivos.append(
                {
                    "criterio": "longevidad",
                    "detalle": (
                        f"Tiene {antiguedad} meses de antigüedad y su vida útil "
                        f"es de {politica.vida_util_meses} meses."
                    ),
                    "valor_actual": antiguedad,
                    "umbral": politica.vida_util_meses,
                }
            )

    resultado.requiere_renovacion = bool(resultado.motivos)
    return resultado


def refrescar_indicadores_renovacion(activo, politica: PoliticaObsolescencia | None = None):
    """Escribe el veredicto en la caché del activo y lo devuelve.

    Solo toca las tres columnas de caché: nunca guarda el modelo completo, para
    no pisar una edición concurrente de la ficha técnica.
    """
    resultado = evaluar_activo(activo, politica=politica)
    activo.requiere_renovacion = resultado.requiere_renovacion
    activo.motivos_renovacion = resultado.motivos
    activo.renovacion_evaluada_en = timezone.now()
    activo.save(
        update_fields=["requiere_renovacion", "motivos_renovacion", "renovacion_evaluada_en"]
    )
    return resultado
