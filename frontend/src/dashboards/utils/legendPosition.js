/**
 * Posiciones de leyenda ofrecidas para los tipos de gráfica que dibujan una (`TIPOS_CON_LEYENDA`
 * en `cartera/services/dashboard_layout.py`: barras agrupadas/apiladas, pastel, dona).
 */
export const POSICIONES_LEYENDA = [
  { id: 'abajo', etiqueta: 'Abajo' },
  { id: 'arriba', etiqueta: 'Arriba' },
  { id: 'izquierda', etiqueta: 'Izquierda' },
  { id: 'derecha', etiqueta: 'Derecha' },
]

const PROPS_RECHARTS_POR_POSICION = {
  // `paddingTop`: separa la leyenda de las etiquetas del eje X, que en varias gráficas van
  // rotadas (`angle=-30`) y pueden extenderse más abajo de lo que reserva su `height` — sin este
  // espacio, la leyenda se monta encima de esas etiquetas.
  abajo: { verticalAlign: 'bottom', align: 'center', layout: 'horizontal', wrapperStyle: { paddingTop: 16 } },
  arriba: { verticalAlign: 'top', align: 'center', layout: 'horizontal' },
  izquierda: { verticalAlign: 'middle', align: 'left', layout: 'vertical', wrapperStyle: { paddingRight: 16 } },
  derecha: { verticalAlign: 'middle', align: 'right', layout: 'vertical', wrapperStyle: { paddingLeft: 16 } },
}

/** Traduce una posición ('abajo'/'arriba'/'izquierda'/'derecha') a las props que espera el
 * `<Legend>` de recharts. Cualquier valor desconocido cae al mismo por defecto del backend. */
export function propsLeyendaPara(posicion) {
  return PROPS_RECHARTS_POR_POSICION[posicion] || PROPS_RECHARTS_POR_POSICION.abajo
}
