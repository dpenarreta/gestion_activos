/**
 * Espejo de `cartera/services/generic_charts.py::ETIQUETAS_TRAMOS_ANTIGUEDAD`/
 * `ETIQUETAS_TRAMOS_ACUMULADOS` — mismos cortes que usa el filtro "Días desde una fecha" de KPI
 * (`SlotFields.jsx::FiltroSlot`): 0 días o menos (fecha hoy o en el futuro) es "Anticipada".
 * Discretos para el gráfico de antigüedad (`calculo: 'tramos_antiguedad'`); acumulados (cada
 * tramo incluye los anteriores, EXCEPTO el último) para la tabla de cumplimiento de metas
 * (`calculo: 'cumplimiento_metas'`) — alineados posicionalmente 1 a 1 con los discretos. El
 * último tramo ("Más de 120 días") no es una fila de cierre al 100%: es la cola ">120 días"
 * sola, mismo valor que el último tramo discreto.
 */
export const ETIQUETAS_TRAMOS_ANTIGUEDAD = ['Anticipada', '30 días', '60 días', '90 días', '120 días', '+120 días']
export const ETIQUETAS_TRAMOS_ACUMULADOS = [
  'Corriente', 'Vencido ≤ 30 días (acum.)', 'Vencido ≤ 60 días (acum.)',
  'Vencido ≤ 90 días (acum.)', 'Vencido ≤ 120 días (acum.)', 'Más de 120 días',
]
