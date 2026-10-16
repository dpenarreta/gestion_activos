export function construirOverride(componente) {
  return {
    titulo: componente?.content?.titulo || undefined,
    descripcion: componente?.content?.descripcion || undefined,
    colores: componente?.styles || {},
  }
}

/** Reconstruye la forma `{tipo, ...}` que esperan los renderers genéricos a partir de lo que
 * quedó guardado en `component.content` (ver `services/plantilla.py`/`dashboard_layout.py` para
 * el lado que lo escribe). Compartida entre `DashboardAreaPage.jsx` (dashboards reales) y
 * `PlantillaBasePage.jsx` (plantilla base personalizable, mismos datos ficticios). */
export function datosDesdeComponente(componente) {
  if (componente.type === 'kpi') {
    return {
      datos: {
        valor: componente.content?.valor, formato: componente.content?.formato,
        tendencia: componente.content?.tendencia, meta: componente.content?.meta,
      },
    }
  }
  if (componente.chart_type === 'dispersion') {
    return { datos: { puntos: componente.content?.puntos } }
  }
  if (componente.chart_type === 'tabla') {
    return {
      datos: {
        columnas: componente.content?.columnas, filas: componente.content?.filas, total: componente.content?.total,
        categorias: componente.content?.categorias, valores: componente.content?.valores,
      },
    }
  }
  // El contenido de una posición `multivalor`/`multiserie` (2+ columnas de valor) siempre llega
  // como `{categorias, series}`, sin importar el `chart_type` elegido (`_calcular_contenido_slot`
  // en el backend no sabe ni le importa cómo se va a dibujar) — se detecta por la FORMA del
  // contenido, no por el tipo: desde que pastel/dona son compatibles con estas posiciones
  // (`TIPOS_COMPATIBLES`), un `chart_type` "de una sola porción" puede convivir con contenido de
  // varias series (`GenericChartRenderer` es quien las colapsa en una sola porción por categoría).
  if (componente.content?.series) {
    return { datosMultiserie: { categorias: componente.content?.categorias, series: componente.content?.series } }
  }
  return { datos: { categorias: componente.content?.categorias, valores: componente.content?.valores } }
}
