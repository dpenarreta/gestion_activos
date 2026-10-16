import { useEffect, useState } from 'react'
import { Accordion, Button, Form, Offcanvas } from 'react-bootstrap'
import WidthHeightControls from './WidthHeightControls'
import FilterFieldReorderList from './FilterFieldReorderList'
import ComponentDataSection from './ComponentDataSection'
import SelectorColumnaIdentificador from './SelectorColumnaIdentificador'
import SelectorColumnasDetalle from './SelectorColumnasDetalle'
import TableCellsEditor from './TableCellsEditor'
import { SelectorTipoGrafico } from '../dashboard-generic/SlotFields'
import { POSICIONES_LEYENDA } from '../../utils/legendPosition'
import { PLANTILLA_SLOTS, TIPOS_COMPATIBLES } from '../../utils/plantillaSlots'
import { PAGE_SIZES_PERMITIDOS } from '../../config/pageSizes'

// Tipos de `calculo` con tipo de gráfico intercambiable — único criterio que decide si, en modo
// plantilla base, la sección "Datos" muestra el selector de tipo de gráfico o no aparece (mismo
// criterio que ya usa `SlotFields.jsx::SelectorTipoGrafico`/`TIPOS_COMPATIBLES`).
const _CALCULO_POR_COMPONENT_ID = Object.fromEntries(PLANTILLA_SLOTS.map((s) => [s.id, s.calculo]))

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
// Espejo de `TIPOS_CON_LEYENDA` en `cartera/services/dashboard_layout.py`: los únicos tipos de
// gráfica que dibujan una leyenda, y por lo tanto los únicos donde tiene sentido reposicionarla.
const TIPOS_CON_LEYENDA = new Set(['barras_agrupadas', 'barras_apiladas', 'area_apilada', 'lineas_multiples', 'pastel', 'dona'])
// Tipos de gráfica de varias series (barras agrupadas/apiladas, área apilada, líneas múltiples):
// reparten un color por serie (`content.series`), no por categoría.
const TIPOS_MULTISERIE = new Set(['barras_agrupadas', 'barras_apiladas', 'area_apilada', 'lineas_multiples'])

// Colores realmente pintados hoy cuando no hay override (`styles/dashboard.css`, variables
// `--series-1`.."--series-8"/`--text-primary`/`--surface-1`) — a diferencia de los colores
// institucionales (`--color-primary`, etc.), ThemeProvider nunca reescribe estas variables en
// runtime, así que su valor estático es siempre el color efectivamente en pantalla. Se usan para
// precargar cada selector con el color "actual" en vez de dejarlo en blanco cuando todavía no hay
// un override guardado. Mismo orden que `PALETA_CATEGORICA` (utils/colors.js), que es la que
// reparte estos colores por índice en los componentes Generic*.
const PALETA_HEX = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const COLOR_TEXTO_HEX = '#000000'
const COLOR_FONDO_HEX = '#ffffff'

/** Construye las filas de color a mostrar para un componente: cada una es `{id, etiqueta, valor,
 * porDefecto, onCambiar(valor)}` — `onCambiar` ya sabe cómo empaquetar ese cambio dentro de
 * `styles` (colector plano para KPI/título/fondo, mapa por nombre para categorías/series), así el
 * panel solo necesita renderizar la lista sin saber de la forma interna de cada campo.
 *
 * "Cada categoría/serie debe tener su propio color editable" (no un único "color principal"
 * compartido): una tarjeta KPI solo tiene un acento opcional; una tabla no tiene barras/porciones
 * que teñir (solo título y fondo); una línea es un único trazo continuo (un color, no uno por
 * punto); el resto (barras, pastel/dona, agrupadas/apiladas) reparten un color por cada categoría
 * o serie que traiga el propio componente (`content.categorias`/`content.series`). */
function filasColorPara(componente) {
  const estilos = componente.styles || {}
  const filaTextoYFondo = [
    { id: 'colorTexto', etiqueta: 'Color del título', porDefecto: COLOR_TEXTO_HEX, valor: estilos.colorTexto, onCambiar: (v) => ({ colorTexto: v }) },
    { id: 'colorFondo', etiqueta: 'Color de fondo', porDefecto: COLOR_FONDO_HEX, valor: estilos.colorFondo, onCambiar: (v) => ({ colorFondo: v }) },
  ]

  if (componente.type === 'kpi') {
    return [{ id: 'colorPrincipal', etiqueta: 'Color principal', porDefecto: '', valor: estilos.colorPrincipal, onCambiar: (v) => ({ colorPrincipal: v }) }]
  }
  if (componente.chart_type === 'tabla') {
    return filaTextoYFondo
  }
  if (componente.chart_type === 'lineas' || componente.chart_type === 'dispersion') {
    const etiqueta = componente.chart_type === 'dispersion' ? 'Color de los puntos' : 'Color de la línea'
    return [
      { id: 'colorPrincipal', etiqueta, porDefecto: PALETA_HEX[0], valor: estilos.colorPrincipal, onCambiar: (v) => ({ colorPrincipal: v }) },
      ...filaTextoYFondo,
    ]
  }
  if (TIPOS_MULTISERIE.has(componente.chart_type)) {
    const series = componente.content?.series || []
    const coloresPorSerie = estilos.coloresPorSerie || {}
    const filasSerie = series.map((s, i) => ({
      id: `serie-${s.nombre}`, etiqueta: `Color de "${s.nombre}"`, porDefecto: PALETA_HEX[i % PALETA_HEX.length],
      valor: coloresPorSerie[s.nombre], onCambiar: (v) => ({ coloresPorSerie: { ...coloresPorSerie, [s.nombre]: v } }),
    }))
    return [...filasSerie, ...filaTextoYFondo]
  }
  if (componente.type === 'chart') {
    const categorias = componente.content?.categorias || []
    const coloresPorCategoria = estilos.coloresPorCategoria || {}
    const filasCategoria = categorias.map((cat, i) => ({
      id: `categoria-${cat}`, etiqueta: `Color de "${cat}"`, porDefecto: PALETA_HEX[i % PALETA_HEX.length],
      valor: coloresPorCategoria[cat], onCambiar: (v) => ({ coloresPorCategoria: { ...coloresPorCategoria, [cat]: v } }),
    }))
    return [...filasCategoria, ...filaTextoYFondo]
  }
  return []
}

/** Nombres reales (sin renombrar) de los ítems que dibuja la leyenda de esta posición — categorías
 * (pastel/dona) o series (barras agrupadas/apiladas, área apilada, líneas múltiples), el mismo
 * criterio que ya separa `coloresPorCategoria`/`coloresPorSerie` en `filasColorPara`. Solo tiene
 * sentido para los tipos que de verdad dibujan una leyenda (`TIPOS_CON_LEYENDA`): el resto no
 * tiene nada que renombrar ahí (p. ej. una barra de una sola columna no dibuja leyenda, aunque sí
 * tenga colores por categoría). */
function nombresLeyendaPara(componente) {
  if (!TIPOS_CON_LEYENDA.has(componente.chart_type)) return []
  if (TIPOS_MULTISERIE.has(componente.chart_type)) return (componente.content?.series || []).map((s) => s.nombre)
  return componente.content?.categorias || []
}

/** Bajo qué clave de `styles` viven los títulos de leyenda personalizados de esta posición — mismo
 * criterio categoría/serie que `nombresLeyendaPara`, consumido por `GenericPieChart` (`.../
 * etiquetasPorCategoria`) o por `GenericMultiSeriesBarChart`/`GenericStackedAreaChart`/
 * `GenericMultiLineChart` (`.../etiquetasPorSerie`). */
function campoEtiquetasPara(componente) {
  return TIPOS_MULTISERIE.has(componente.chart_type) ? 'etiquetasPorSerie' : 'etiquetasPorCategoria'
}

/** Qué escribir en `styles` cuando se pulsa "Restablecer colores": limpia el/los campo(s) de
 * datos (el mapa completo por categoría/serie, no solo la última fila tocada) más título/fondo. */
function estilosDeRestablecerPara(componente) {
  if (componente.type === 'kpi') return { colorPrincipal: '' }
  if (componente.chart_type === 'tabla') return { colorTexto: '', colorFondo: '' }
  if (componente.chart_type === 'lineas' || componente.chart_type === 'dispersion') {
    return { colorPrincipal: '', colorTexto: '', colorFondo: '' }
  }
  if (TIPOS_MULTISERIE.has(componente.chart_type)) {
    return { coloresPorSerie: {}, colorTexto: '', colorFondo: '' }
  }
  if (componente.type === 'chart') return { coloresPorCategoria: {}, colorTexto: '', colorFondo: '' }
  return {}
}

function CampoColor({ etiqueta, valor, porDefecto, onCambiar }) {
  const [texto, setTexto] = useState(valor || porDefecto || '')
  const [errorLocal, setErrorLocal] = useState('')

  useEffect(() => setTexto(valor || porDefecto || ''), [valor, porDefecto])

  const aplicar = (nuevo) => {
    setTexto(nuevo)
    if (nuevo === '') {
      setErrorLocal('')
      onCambiar('')
      return
    }
    if (!HEX_RE.test(nuevo)) {
      setErrorLocal('Color inválido. Use formato hexadecimal, ej. #1F4E78.')
      return
    }
    setErrorLocal('')
    onCambiar(nuevo)
  }

  return (
    <Form.Group className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>{etiqueta}</Form.Label>
      <div className="d-flex gap-2 align-items-center">
        <Form.Control
          type="color"
          style={{ width: 44, padding: 2 }}
          value={HEX_RE.test(texto) ? texto : '#ffffff'}
          onChange={(e) => aplicar(e.target.value)}
          aria-label={`${etiqueta} (selector visual)`}
        />
        <Form.Control
          size="sm"
          value={texto}
          placeholder="#RRGGBB"
          onChange={(e) => aplicar(e.target.value)}
          aria-label={`${etiqueta} (hexadecimal)`}
        />
      </div>
      {errorLocal && <div className="text-danger" style={{ fontSize: '0.75rem' }}>{errorLocal}</div>}
    </Form.Group>
  )
}

export default function ComponentPropertiesPanel({
  componente, dashboardId, onCerrar, onActualizarContenido, onActualizarEstilos, onCambiarAncho, onCambiarAlto,
  onActualizarConfig, onActualizarComponente, modoPlantillaBase = false, esSuperusuario,
  estructuraBloqueada = false,
}) {
  if (!componente) return null

  // Mismo criterio que `ComponentWrapper.jsx`: ni el bloqueo del componente ni el del dashboard
  // entero permiten cambiar el tamaño, y a un superusuario no se le deshabilita nada porque de
  // uno está exento y del otro puede salir confirmando su contraseña. El mapeo/contenido de datos
  // (sección "Datos" más abajo) NUNCA se bloquea, para nadie: es lo que hay que poder arreglar
  // cuando cambian las columnas del origen.
  const bloqueado = (Boolean(componente.config?.bloqueado) || estructuraBloqueada) && !esSuperusuario

  const filasColor = filasColorPara(componente)
  const restablecerColores = () => onActualizarEstilos(componente.component_id, estilosDeRestablecerPara(componente))

  const nombresLeyenda = nombresLeyendaPara(componente)
  const campoEtiquetas = campoEtiquetasPara(componente)
  const etiquetasLeyenda = componente.styles?.[campoEtiquetas] || {}
  const restablecerEtiquetasLeyenda = () => onActualizarEstilos(componente.component_id, { [campoEtiquetas]: {} })

  // En modo plantilla base no hay archivo real que mapear (`ComponentDataSection` asume uno) —
  // la sección "Datos" se reemplaza por un selector de tipo de gráfico cuando aplica (mismo
  // criterio que el resto de la app: solo los `calculo` con tipos intercambiables), y no aparece
  // en absoluto para KPI/dispersión/tabla.
  const calculoPlantillaBase = _CALCULO_POR_COMPONENT_ID[componente.component_id]
  const tipoIntercambiablePlantillaBase = Boolean(TIPOS_COMPATIBLES[calculoPlantillaBase])
  const mostrarSeccionDatos = !modoPlantillaBase || tipoIntercambiablePlantillaBase

  return (
    <Offcanvas show={Boolean(componente)} onHide={onCerrar} placement="end" className="mz-propiedades">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>Configurar componente</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        <p className="mz-desc mt-0 mb-3">
          <code className="mz-code">{componente.component_id}</code>
        </p>

        <Accordion defaultActiveKey={['general', 'datos', 'personalizacion']} alwaysOpen className="mb-3">
          <Accordion.Item eventKey="general">
            <Accordion.Header>Información general</Accordion.Header>
            <Accordion.Body>
              <Form.Group className="mb-2" controlId={`titulo-${componente.component_id}`}>
                <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Título</Form.Label>
                <Form.Control
                  size="sm"
                  value={componente.content?.titulo || ''}
                  onChange={(e) => onActualizarContenido(componente.component_id, { titulo: e.target.value })}
                  maxLength={200}
                />
              </Form.Group>
              <Form.Group controlId={`descripcion-${componente.component_id}`}>
                <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Descripción</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  size="sm"
                  value={componente.content?.descripcion || ''}
                  onChange={(e) => onActualizarContenido(componente.component_id, { descripcion: e.target.value })}
                  maxLength={500}
                />
              </Form.Group>
            </Accordion.Body>
          </Accordion.Item>

          {mostrarSeccionDatos && (
            <Accordion.Item eventKey="datos">
              <Accordion.Header>Datos</Accordion.Header>
              <Accordion.Body>
                {modoPlantillaBase ? (
                  <SelectorTipoGrafico
                    contexto={componente.content?.titulo || componente.component_id}
                    calculo={calculoPlantillaBase}
                    valor={componente.chart_type}
                    valorDefecto={componente.chart_type}
                    onCambiar={(chartType) => onActualizarComponente(componente.component_id, { chart_type: chartType })}
                  />
                ) : (
                  <ComponentDataSection
                    componente={componente} dashboardId={dashboardId}
                    onActualizarComponente={onActualizarComponente} onActualizarContenido={onActualizarContenido}
                  />
                )}
              </Accordion.Body>
            </Accordion.Item>
          )}

          <Accordion.Item eventKey="personalizacion">
            <Accordion.Header>Personalización</Accordion.Header>
            <Accordion.Body>
              <h6>Tamaño</h6>
              <div className="mb-3">
                <WidthHeightControls
                  width={componente.width}
                  height={componente.height}
                  onCambiarAncho={(w) => onCambiarAncho(componente.component_id, w)}
                  onCambiarAlto={(h) => onCambiarAlto(componente.component_id, h)}
                  disabled={bloqueado}
                />
                {bloqueado && (
                  <div className="text-secondary mt-1" style={{ fontSize: '0.75rem' }}>
                    Este componente está bloqueado: su tamaño no se puede cambiar.
                  </div>
                )}
              </div>

              {filasColor.length > 0 && (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h6 className="mb-0">Colores</h6>
                    <Button size="sm" variant="link" onClick={restablecerColores}>Restablecer colores</Button>
                  </div>
                  {filasColor.map((f) => (
                    <CampoColor
                      key={f.id}
                      etiqueta={f.etiqueta}
                      valor={f.valor}
                      porDefecto={f.porDefecto}
                      onCambiar={(valor) => onActualizarEstilos(componente.component_id, f.onCambiar(valor))}
                    />
                  ))}
                </>
              )}

              {TIPOS_CON_LEYENDA.has(componente.chart_type) && (
                <>
                  <h6>Leyenda</h6>
                  <Form.Group className="mb-3" controlId={`leyenda-posicion-${componente.component_id}`}>
                    <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Posición de la leyenda</Form.Label>
                    <Form.Select
                      size="sm"
                      value={componente.config?.leyenda_posicion || 'abajo'}
                      onChange={(e) => onActualizarConfig(componente.component_id, {
                        ...componente.config,
                        leyenda_posicion: e.target.value,
                      })}
                    >
                      {POSICIONES_LEYENDA.map((p) => (
                        <option key={p.id} value={p.id}>{p.etiqueta}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>

                  {nombresLeyenda.length > 0 && (
                    <>
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <Form.Label className="mb-0" style={{ fontSize: '0.85rem' }}>Títulos de la leyenda</Form.Label>
                        <Button size="sm" variant="link" onClick={restablecerEtiquetasLeyenda}>Restablecer títulos</Button>
                      </div>
                      {nombresLeyenda.map((nombre) => (
                        <Form.Group key={nombre} className="mb-2">
                          <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>{nombre}</Form.Label>
                          <Form.Control
                            size="sm"
                            value={etiquetasLeyenda[nombre] || ''}
                            placeholder={nombre}
                            maxLength={60}
                            onChange={(e) => onActualizarEstilos(componente.component_id, {
                              [campoEtiquetas]: { ...etiquetasLeyenda, [nombre]: e.target.value },
                            })}
                            aria-label={`Título de leyenda para "${nombre}"`}
                          />
                        </Form.Group>
                      ))}
                    </>
                  )}
                </>
              )}

              {componente.type === 'table' && (
                <>
                  <h6>Paginación</h6>
                  <Form.Group className="mb-3" controlId={`page-size-${componente.component_id}`}>
                    <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Registros visibles por defecto</Form.Label>
                    <Form.Select
                      size="sm"
                      value={componente.config?.defaultPageSize || 10}
                      onChange={(e) => onActualizarConfig(componente.component_id, {
                        ...componente.config,
                        defaultPageSize: Number(e.target.value),
                      })}
                    >
                      {(componente.config?.allowedPageSizes || PAGE_SIZES_PERMITIDOS).map((n) => (
                        <option key={n} value={n}>{n} registros</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </>
              )}

              {componente.type === 'chart' && componente.chart_type === 'tabla'
                && Array.isArray(componente.content?.columnas) && Array.isArray(componente.content?.filas) && (
                <>
                  <h6>Valores de la tabla</h6>
                  <div className="mb-3">
                    <TableCellsEditor
                      columnas={componente.content.columnas}
                      filas={componente.content.filas}
                      total={componente.content.total}
                      onCambiarFilas={(filas) => onActualizarContenido(componente.component_id, { filas })}
                      onCambiarTotal={(total) => onActualizarContenido(componente.component_id, { total })}
                    />
                  </div>
                </>
              )}

              {/* La consulta por cliente no tiene "valores de la tabla" que editar —su contenido
                  se consulta en vivo— pero sí decide qué columnas del archivo muestra el detalle.
                  Se guarda en el componente, así que todos ven las mismas. */}
              {componente.config?.bloque === 'consulta-deudor' && (
                <>
                  <h6>Identificador del cliente</h6>
                  <SelectorColumnaIdentificador
                    dashboardId={dashboardId}
                    valor={componente.mapeo?.columna_ruc}
                    onCambiar={(columna) => onActualizarComponente(componente.component_id, {
                      mapeo: { ...componente.mapeo, columna_ruc: columna },
                    })}
                  />

                  <h6>Columnas del detalle</h6>
                  <SelectorColumnasDetalle
                    dashboardId={dashboardId}
                    seleccionadas={componente.config?.columnas_detalle}
                    onCambiar={(columnas) => onActualizarConfig(componente.component_id, {
                      ...componente.config,
                      columnas_detalle: columnas,
                    })}
                  />
                </>
              )}

              {componente.type === 'filters_panel' && componente.config?.filtros && (
                <>
                  <h6>Orden de los filtros</h6>
                  <FilterFieldReorderList
                    filtros={componente.config.filtros}
                    onCambiar={(nuevosFiltros) => onActualizarConfig(componente.component_id, { ...componente.config, filtros: nuevosFiltros })}
                  />
                </>
              )}
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>

        <Button variant="outline-secondary" size="sm" className="mt-2" onClick={onCerrar}>Cerrar</Button>
      </Offcanvas.Body>
    </Offcanvas>
  )
}
