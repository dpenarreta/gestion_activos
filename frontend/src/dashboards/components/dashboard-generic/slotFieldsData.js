/**
 * Cálculo y normalización de datos de una posición de la plantilla — sin JSX ni React.
 *
 * Vivían en `SlotFields.jsx`, junto a los componentes de selección que los usan. Ahí disparaban
 * el aviso `react(only-export-components)` de Fast Refresh: un archivo que exporta componentes y
 * además funciones sueltas obliga a Vite a recargar la página entera al editarlo, en vez de
 * intercambiar en caliente solo el componente. Separarlos también deja `SlotFields.jsx` más
 * chico (era el archivo más grande del frontend) y permite probar estas reglas sin montar nada.
 *
 * Los importan tanto `SlotFields.jsx` como `TemplateMappingStep.jsx` y `DashboardHistoricoPage.jsx`.
 */

import { TIPOS_COMPATIBLES } from '../../utils/plantillaSlots'

/** El tipo de gráfico que de verdad se dibuja para una posición: el que el usuario eligió si es
 * compatible con el `calculo` de la posición (mismos datos calculados), o el tipo por defecto del
 * slot en cualquier otro caso — mismo criterio que `services/plantilla.py::_chart_type_elegido`. */
export function tipoVisualizacionElegido(slot, propuesta) {
  const compatibles = TIPOS_COMPATIBLES[slot.calculo]
  if (compatibles && compatibles.includes(propuesta.chart_type)) return propuesta.chart_type
  return slot.tipoVisualizacion
}

/** `datos[slot.id]` (calculado por el backend) viene como `{categorias, valores}` o
 * `{categorias, series}` según el `calculo` de la posición — `GenericChartRenderer` espera esa
 * forma en `datos` o `datosMultiserie` según corresponda. */
export function datosParaPreview(slot, contenido) {
  if (!contenido) return {}
  if (slot.calculo === 'multivalor' || slot.calculo === 'multiserie') return { datosMultiserie: contenido }
  return { datos: contenido }
}

/** Normaliza una entrada de `columnas_valor` de una Tabla a la forma
 * `{columna, tipo_agregacion}`.
 *
 * Acepta las formas históricas —`null` y el nombre de columna como string suelto— y les asigna la
 * agregación "suma", para que una tabla ya mapeada antes de ese cambio se siga editando sin
 * perder su selección. Compartida por `ColumnasTabla` y por quien arma los cambios de la lista
 * (`CamposParaSlot`), así ambos coinciden en la forma normalizada.
 *
 * `{manual: true, titulo, valores, total}` (sección 29) es una forma distinta — una columna cuyos
 * valores el usuario escribe a mano en vez de que salgan de una columna real del archivo — y se
 * devuelve tal cual, sin forzarla a `{columna, tipo_agregacion}`. */
export function normalizarColumnaValorTabla(entrada) {
  if (entrada && typeof entrada === 'object' && entrada.manual) {
    return {
      manual: true, titulo: entrada.titulo || '',
      valores: Array.isArray(entrada.valores) ? entrada.valores : [], total: entrada.total ?? null,
    }
  }
  if (entrada == null) return { columna: null, tipo_agregacion: 'suma' }
  if (typeof entrada === 'string') return { columna: entrada, tipo_agregacion: 'suma' }
  return { columna: entrada.columna ?? null, tipo_agregacion: entrada.tipo_agregacion || 'suma' }
}
