/**
 * Armado de las porciones de un gráfico circular — sin JSX ni React.
 *
 * Vivía en `GenericPieChart.jsx`, donde disparaba el aviso `react(only-export-components)`: un
 * archivo que exporta un componente y además una función suelta obliga a Vite a recargar la
 * página entera al editarlo, en vez de intercambiar en caliente solo el componente.
 */

/** Arma las porciones del gráfico a partir de `{categorias, valores}` — separado del componente
 * para poder probar la sustitución de nombre sin depender de que recharts realmente dibuje nada
 * (bajo jsdom, sin un layout real, `ResponsiveContainer` mide ancho 0 y no renderiza ni el `Pie`
 * ni la `Legend`). `id` (la categoría real, sin renombrar) es la clave estable para el color y
 * `key` de React; `nombre` es lo que de verdad ve el usuario en la leyenda/tooltip
 * (`etiquetasPorCategoria[categoria]` si el usuario le puso un título propio, si no la categoría
 * tal cual) — separarlos evita que renombrar la leyenda rompa la búsqueda de color por categoría. */
export function datosCircularConEtiquetas(data, etiquetasPorCategoria = {}) {
  return (data?.categorias || []).map((categoria, i) => ({
    id: categoria, nombre: etiquetasPorCategoria[categoria] || categoria, valor: data?.valores?.[i] ?? 0,
  }))
}
