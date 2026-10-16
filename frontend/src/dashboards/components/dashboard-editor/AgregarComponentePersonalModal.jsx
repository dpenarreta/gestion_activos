import { useEffect, useState } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import * as carteraService from '../../services/carteraService'
import * as historicoService from '../../services/historicoService'
import { CamposParaSlot, SelectorColumna } from '../dashboard-generic/SlotFields'

/** Tipos de componente cuya propuesta trae una única `columna_valor` (ver `construirPayload`) —
 * son los únicos donde tiene sentido pedir una "columna de contexto adicional": el backend
 * (`AgregarGraficaView.post`) calcula ese desglose con `generar_datos_grafica(df, columna_valor,
 * columna_contexto_ia)`, que necesita justamente esa columna de valor. `multivalor` (varias
 * métricas) y `tabla` (sin una columna de valor única) quedan afuera. */
const TIPOS_CON_CONTEXTO_IA = new Set(['kpi', 'chart', 'multiserie', 'dispersion'])

/** Cada opción define el `calculo` que se manda al backend (`AgregarGraficaView`) y el tipo de
 * visualización por defecto — mismo vocabulario que `PLANTILLA_SLOTS`/`CamposParaSlot`, así el
 * formulario de "Zona Personal" reutiliza tal cual los selectores ya usados por las 15 posiciones
 * fijas, sin reinventar ninguno. */
const TIPOS_COMPONENTE = [
  { id: 'kpi', etiqueta: 'KPI (un solo valor)', tipoVisualizacion: 'kpi' },
  { id: 'chart', etiqueta: 'Gráfico de una columna', tipoVisualizacion: 'barras_verticales' },
  { id: 'multivalor', etiqueta: 'Gráfico de 2+ columnas (comparar métricas)', tipoVisualizacion: 'lineas_multiples' },
  { id: 'multiserie', etiqueta: 'Gráfico de 2+ columnas (categoría y serie)', tipoVisualizacion: 'barras_agrupadas' },
  { id: 'tabla', etiqueta: 'Tabla', tipoVisualizacion: 'tabla' },
  { id: 'dispersion', etiqueta: 'Dispersión', tipoVisualizacion: 'dispersion' },
  { id: 'tramos_antiguedad', etiqueta: 'Antigüedad por tramos (gráfico)', tipoVisualizacion: 'barras_verticales' },
  { id: 'cumplimiento_metas', etiqueta: 'Cumplimiento de metas por tramo (tabla)', tipoVisualizacion: 'tabla' },
  { id: 'concentracion', etiqueta: 'Concentración (top-N + resto)', tipoVisualizacion: 'tabla' },
]

/** 1/2/4 columnas del grid de 12 — mismo vocabulario que pidió el usuario ("1, 2 o 4 columnas"),
 * traducido a `width` (12/6/3) recién en el backend (`agregar_componente_generado`). */
const ANCHOS = [
  { valor: 1, etiqueta: '1 columna (ancho completo)' },
  { valor: 2, etiqueta: '2 columnas (mitad)' },
  { valor: 4, etiqueta: '4 columnas (un cuarto)' },
]
const ANCHO_POR_DEFECTO = 2
const WIDTH_A_ANCHO = { 12: 1, 6: 2, 3: 4 }

/** Sugiere el ancho pre-seleccionado para mantener el equilibrio visual del patrón Z: si ya hay
 * algo en la Zona Personal, repite el ancho del último agregado (mayor `order`) — así una serie
 * de componentes agregados en la misma sesión queda alineada; si todavía no hay ninguno, 2
 * columnas (mismo criterio que ya usan las zonas de apoyo de la plantilla fija: ítems de a
 * pares). El usuario puede cambiarla libremente antes de confirmar. */
function anchoSugerido(componentesPersonales) {
  if (!componentesPersonales?.length) return ANCHO_POR_DEFECTO
  const ultimo = [...componentesPersonales].sort((a, b) => b.order - a.order)[0]
  return WIDTH_A_ANCHO[ultimo.width] || ANCHO_POR_DEFECTO
}

function construirPayload({ tipoId, tipoVisualizacionPorDefecto, cargaId, titulo, descripcion, propuesta, ancho, instruccionIA, columnaContextoIA }) {
  const base = {
    carga_id: cargaId, titulo: titulo.trim(), descripcion: descripcion.trim(),
    calculo: tipoId, ancho_columnas: ancho,
  }
  if (instruccionIA.trim()) base.instruccion_ia = instruccionIA.trim()
  if (TIPOS_CON_CONTEXTO_IA.has(tipoId) && columnaContextoIA) base.columna_contexto_ia = columnaContextoIA
  const tipoVisualizacion = propuesta.chart_type || tipoVisualizacionPorDefecto
  if (tipoId === 'kpi') {
    return {
      ...base, columna_valor: propuesta.columna_valor, tipo_agregacion: propuesta.tipo_agregacion,
      meta_min: propuesta.meta_min, meta_max: propuesta.meta_max, formato: propuesta.formato,
      usa_historico: Boolean(propuesta.usa_historico),
    }
  }
  if (tipoId === 'chart') {
    return {
      ...base, columna_valor: propuesta.columna_valor, columna_categoria: propuesta.columna_categoria,
      tipo_visualizacion: tipoVisualizacion, usa_historico: Boolean(propuesta.usa_historico),
    }
  }
  if (tipoId === 'multivalor') {
    return {
      ...base, columna_categoria: propuesta.columna_categoria,
      columnas_valor: (propuesta.columnas_valor || []).filter(Boolean), tipo_visualizacion: tipoVisualizacion,
      usa_historico: Boolean(propuesta.usa_historico),
    }
  }
  if (tipoId === 'multiserie') {
    return {
      ...base, columna_categoria: propuesta.columna_categoria, columna_serie: propuesta.columna_serie,
      columna_valor: propuesta.columna_valor, tipo_visualizacion: tipoVisualizacion,
      usa_historico: Boolean(propuesta.usa_historico),
    }
  }
  if (tipoId === 'dispersion') {
    return { ...base, columna_valor: propuesta.columna_valor, columna_valor_y: propuesta.columna_valor_y }
  }
  if (tipoId === 'tramos_antiguedad') {
    return { ...base, columna_fecha: propuesta.columna_fecha, columna_valor: propuesta.columna_valor }
  }
  if (tipoId === 'cumplimiento_metas') {
    return {
      ...base, columna_fecha: propuesta.columna_fecha, columna_valor: propuesta.columna_valor, metas: propuesta.metas,
    }
  }
  if (tipoId === 'concentracion') {
    return { ...base, columna_id: propuesta.columna_id, columna_valor: propuesta.columna_valor, top_n: propuesta.top_n }
  }
  // tabla
  return {
    ...base, columna_id: propuesta.columna_id, usa_historico: Boolean(propuesta.usa_historico),
    columnas_valor: (propuesta.columnas_valor || []).filter((c) => c?.columna),
  }
}

/**
 * Modal para agregar UN componente (KPI/gráfico/tabla, con datos reales del archivo del
 * dashboard) a la "Zona Personal" — la zona final y dinámica del dashboard, que solo se muestra
 * en modo edición cuando tiene 1+ componentes (`EditableGrid.jsx`). A diferencia del resto del
 * editor de dashboard, esta acción persiste de inmediato (`carteraService.agregarComponentePersonal`,
 * reutiliza el flujo legado `agregar_componente_generado`): no pasa por el borrador ni por
 * "Guardar cambios", así que al confirmar el llamador debe refrescar el layout
 * (`useDashboardLayout().recargar()`).
 *
 * Reutiliza tal cual `CamposParaSlot` (`SlotFields.jsx`) con un `slot` sintético — mismos
 * selectores de columna/tipo de cálculo/tipo de gráfico que ya arma el mapeo de las 15 posiciones
 * fijas, sin duplicar esa lógica. Sin vista previa en vivo contra el backend (alcance v1): el
 * componente se calcula y aparece recién al confirmar.
 *
 * "Apoyo para la IA": una instrucción de texto libre (`instruccion_ia`) y, para los tipos con una
 * única columna de valor (`TIPOS_CON_CONTEXTO_IA`), una columna adicional de contexto
 * (`columna_contexto_ia`) — el backend calcula ese desglose una sola vez al crear el componente y
 * ambos quedan guardados en `DashboardComponent.config` para que "Hallazgos clave" los use al
 * interpretar este componente puntual, sin afectar cómo se calcula ni se dibuja.
 */
export default function AgregarComponentePersonalModal({ show, onHide, dashboardId, componentesPersonales, onAgregado, tipoInicial, passwordConfirmacion }) {
  const [archivoActual, setArchivoActual] = useState(null)
  const [cargandoArchivo, setCargandoArchivo] = useState(true)
  const [errorArchivo, setErrorArchivo] = useState('')
  const [tipoId, setTipoId] = useState(tipoInicial || TIPOS_COMPONENTE[0].id)
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [ancho, setAncho] = useState(ANCHO_POR_DEFECTO)
  const [propuesta, setPropuesta] = useState({})
  const [instruccionIA, setInstruccionIA] = useState('')
  const [columnaContextoIA, setColumnaContextoIA] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [columnasHistoricas, setColumnasHistoricas] = useState([])

  useEffect(() => {
    if (!show) return undefined
    // Reinicia el formulario cada vez que se abre, para no arrastrar la selección del componente
    // agregado anteriormente. `tipoInicial` (venido del panel lateral de componentes, si el
    // usuario arrastró/eligió un tipo puntual) tiene prioridad sobre el primero de la lista.
    setTipoId(tipoInicial || TIPOS_COMPONENTE[0].id)
    setTitulo('')
    setDescripcion('')
    setAncho(anchoSugerido(componentesPersonales))
    setPropuesta({})
    setInstruccionIA('')
    setColumnaContextoIA(null)
    setError('')

    let cancelado = false
    setCargandoArchivo(true)
    setErrorArchivo('')
    carteraService.obtenerArchivoActualDashboard(dashboardId)
      .then((resultado) => { if (!cancelado) setArchivoActual(resultado) })
      .catch(() => { if (!cancelado) setErrorArchivo('No se pudo cargar la información del archivo de este dashboard.') })
      .finally(() => { if (!cancelado) setCargandoArchivo(false) })
    // De mejor esfuerzo, igual que el resto de este efecto: sin columnas históricas, el selector
    // "Fuente de datos" → "Histórico" de una Tabla simplemente no ofrece ninguna columna.
    historicoService.listarCargasHistoricas(dashboardId)
      .then((resultado) => { if (!cancelado) setColumnasHistoricas(resultado.columnas_disponibles || []) })
      .catch(() => { if (!cancelado) setColumnasHistoricas([]) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe reiniciar/recargar al abrir, no en cada cambio de componentesPersonales
  }, [show, dashboardId, tipoInicial])

  const tipoSeleccionado = TIPOS_COMPONENTE.find((t) => t.id === tipoId)
  const slot = { calculo: tipoId, titulo: 'Nuevo componente', tipoVisualizacion: tipoSeleccionado.tipoVisualizacion }

  const cambiar = (campo) => (valor) => setPropuesta((prev) => ({ ...prev, [campo]: valor }))
  const cambiarLista = (campo) => (nuevaLista) => setPropuesta((prev) => ({ ...prev, [campo]: nuevaLista }))

  const cambiarTipo = (nuevoTipoId) => {
    setTipoId(nuevoTipoId)
    setPropuesta({})
    setColumnaContextoIA(null)
  }

  const confirmar = async () => {
    setEnviando(true)
    setError('')
    try {
      const payload = construirPayload({
        tipoId, tipoVisualizacionPorDefecto: tipoSeleccionado.tipoVisualizacion,
        cargaId: archivoActual.carga_id, titulo, descripcion, propuesta, ancho,
        instruccionIA, columnaContextoIA,
      })
      // La confirmación se pasa solo si existe: en un dashboard sin bloquear la llamada queda
      // exactamente como era, con un único argumento.
      await (passwordConfirmacion
        ? carteraService.agregarComponentePersonal(payload, passwordConfirmacion)
        : carteraService.agregarComponentePersonal(payload))
      await onAgregado()
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo agregar el componente.')
    } finally {
      setEnviando(false)
    }
  }

  const tituloValido = titulo.trim().length > 0

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Agregar a la Zona Personal</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {cargandoArchivo && <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>}
        {!cargandoArchivo && errorArchivo && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem' }}>{errorArchivo}</Alert>}
        {!cargandoArchivo && !errorArchivo && !archivoActual?.disponible && (
          <div className="chart-panel__subtitle mb-0">
            Este dashboard todavía no tiene un archivo real cargado. Usa "Cargar otro archivo" para
            poder configurar los datos de este componente.
          </div>
        )}
        {!cargandoArchivo && !errorArchivo && archivoActual?.disponible && (
          <>
            <Form.Group className="mb-2" controlId="agregar-personal-titulo">
              <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Título</Form.Label>
              <Form.Control size="sm" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} />
            </Form.Group>
            <Form.Group className="mb-2" controlId="agregar-personal-descripcion">
              <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Descripción (opcional)</Form.Label>
              <Form.Control
                as="textarea" rows={2} size="sm" value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)} maxLength={500}
              />
            </Form.Group>
            <Form.Group className="mb-2" controlId="agregar-personal-tipo">
              <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Tipo de componente</Form.Label>
              <Form.Select size="sm" value={tipoId} onChange={(e) => cambiarTipo(e.target.value)}>
                {TIPOS_COMPONENTE.map((t) => <option key={t.id} value={t.id}>{t.etiqueta}</option>)}
              </Form.Select>
            </Form.Group>

            <CamposParaSlot
              slot={slot} propuesta={propuesta} columnas={archivoActual.columnas}
              cambiar={cambiar} cambiarLista={cambiarLista}
              cargaId={archivoActual.carga_id} columnasHistoricas={columnasHistoricas}
            />

            <div className="mb-2 pt-2 border-top">
              <div className="chart-panel__subtitle mb-1">Apoyo para la IA (opcional)</div>
              {TIPOS_CON_CONTEXTO_IA.has(tipoId) && (
                <SelectorColumna
                  etiqueta="Desglose adicional por columna" contexto="este componente"
                  valor={columnaContextoIA} opciones={archivoActual.columnas}
                  onCambiar={setColumnaContextoIA}
                />
              )}
              <Form.Group className="mb-2" controlId="agregar-personal-instruccion-ia">
                <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Instrucción para la IA</Form.Label>
                <Form.Control
                  as="textarea" rows={2} size="sm" value={instruccionIA}
                  onChange={(e) => setInstruccionIA(e.target.value)} maxLength={500}
                  placeholder='Ej.: "explicá los totales por la columna de contexto elegida"'
                />
                <Form.Text style={{ fontSize: '0.72rem' }}>
                  Se usa al generar "Hallazgos clave" para este componente — no cambia el gráfico en sí.
                </Form.Text>
              </Form.Group>
            </div>

            <Form.Group className="mb-2" controlId="agregar-personal-ancho">
              <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Ancho</Form.Label>
              <Form.Select size="sm" value={ancho} onChange={(e) => setAncho(Number(e.target.value))}>
                {ANCHOS.map((a) => <option key={a.valor} value={a.valor}>{a.etiqueta}</option>)}
              </Form.Select>
            </Form.Group>

            {error && <Alert variant="danger" className="py-2 mb-0" style={{ fontSize: '0.85rem' }}>{error}</Alert>}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={enviando}>Cancelar</Button>
        {archivoActual?.disponible && (
          <Button variant="primary" onClick={confirmar} disabled={enviando || !tituloValido}>
            {enviando ? 'Agregando…' : 'Agregar'}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  )
}
