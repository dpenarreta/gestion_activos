/** Cómo va a tratarse un valor en blanco de esta columna si no se elige ningún reemplazo — se
 * deriva de su aptitud (`apta_para_valor`/`apta_para_categoria`, mutuamente excluyentes, ver
 * `services/generic_charts.py::analizar_columnas`), no de en qué posición concreta termine
 * usándose: una columna numérica siempre ignora sus blancos al sumar/promediar, una de categoría
 * siempre los agrupa como "Sin dato", sin importar qué gráfica/tabla la use. Usado tanto por el
 * aviso informativo del paso MAPEO (`TemplateMappingStep`) como por el paso `VALORES_EN_BLANCO`
 * (`ValoresEnBlancoStep`), que además deja elegir un reemplazo real en vez de este tratamiento
 * por defecto. */
export function tratamientoColumnaEnBlanco(columnaInfo) {
  if (columnaInfo?.apta_para_valor) {
    return 'Como es una columna numérica, esas filas se van a ignorar en las sumas y promedios (no se cuentan como cero).'
  }
  if (columnaInfo?.apta_para_categoria) {
    return 'Como es una columna de categoría, esas filas se van a agrupar bajo la etiqueta "Sin dato" — es solo una etiqueta de vista en el dashboard, tu archivo original no se modifica.'
  }
  return `Esta columna no se usa en ningún cálculo de la plantilla (${columnaInfo?.motivo_no_apta || 'no es apta ni como valor ni como categoría'}), así que esos valores en blanco no tienen efecto.`
}
