"""Una duración en días, contada como la lee una persona.

Hasta 30 días se dice en días, porque es la unidad en la que se decide algo esta
semana. A partir de ahí «412 días» obliga a dividir mentalmente para saber si es
mucho o poco, así que se pasa a meses y, cuando pasa del año, a años: «1 año,
1 mes y 22 días».

Los días nunca se pierden por el camino: redondear a «11 meses» borraría justo
la diferencia que se busca al comparar dos equipos.

El mes vale 30 días y el año 12 de esos meses. No es el calendario, y no puede
serlo: a esta función llega un número de días, no dos fechas entre las que
contar. Fijar el mes en 30 mantiene la cuenta coherente con el umbral de la
propia regla —lo que pasa de 30 días ya es un mes— en vez de que «1 mes»
signifique una cosa en febrero y otra en marzo.

El mismo cálculo vive en `frontend/src/utils/formato.js`: la interfaz formatea
lo que recibe como número y el backend lo que ya manda escrito (los avisos del
centro de alertas y del correo).
"""

DIAS_POR_MES = 30
MESES_POR_ANIO = 12


def _plural(cantidad: int, singular: str, plural: str) -> str:
    return f"{cantidad} {singular if cantidad == 1 else plural}"


def _enumerar(partes: list[str]) -> str:
    """«1 año, 2 meses y 5 días»: coma entre las primeras, «y» antes de la última."""
    if len(partes) == 1:
        return partes[0]
    return f"{', '.join(partes[:-1])} y {partes[-1]}"


def formatear_dias(dias) -> str:
    """El signo es asunto de quien llama: una garantía vencida se dice «venció
    hace 2 meses», no «hace -2 meses»."""
    if dias is None:
        return "—"
    total = abs(int(dias))
    if total <= DIAS_POR_MES:
        return _plural(total, "día", "días")

    meses_totales, resto = divmod(total, DIAS_POR_MES)
    partes = []
    if meses_totales >= MESES_POR_ANIO:
        anios, meses = divmod(meses_totales, MESES_POR_ANIO)
        partes.append(_plural(anios, "año", "años"))
        if meses:
            partes.append(_plural(meses, "mes", "meses"))
    else:
        partes.append(_plural(meses_totales, "mes", "meses"))
    # Un cero no aporta: «2 meses» se lee mejor que «2 meses y 0 días».
    if resto:
        partes.append(_plural(resto, "día", "días"))
    return _enumerar(partes)


def formatear_meses(meses) -> str:
    """Una antigüedad en meses, con la misma regla.

    «70 meses» obliga a dividir para saber que el equipo lleva casi seis años.
    Los meses sobrantes se conservan por lo mismo que los días: «5 años» y
    «5 años y 10 meses» son decisiones distintas cuando la política de
    renovación mira los seis.
    """
    if meses is None:
        return "—"
    total = abs(int(meses))
    if total <= MESES_POR_ANIO:
        return _plural(total, "mes", "meses")

    anios, resto = divmod(total, MESES_POR_ANIO)
    partes = [_plural(anios, "año", "años")]
    if resto:
        partes.append(_plural(resto, "mes", "meses"))
    return _enumerar(partes)
