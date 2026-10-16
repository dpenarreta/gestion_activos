import { useEffect, useState } from 'react'
import { Alert, Button, Modal, Spinner } from 'react-bootstrap'
import * as dashboardLayoutService from '../../services/dashboardLayoutService'

/** Interpreta `**dobles asteriscos**` como negrita real — mismo criterio simple que
 * `HallazgosClaveCard.jsx::renderConNegritas`, sin traer una librería de markdown para esto. */
function renderConNegritas(texto) {
  return texto.split('**').map((parte, i) => (
    i % 2 === 1
      // eslint-disable-next-line react/no-array-index-key -- segmentos de un mismo texto generado, sin id propio
      ? <strong key={i}>{parte}</strong>
      // eslint-disable-next-line react/no-array-index-key -- ídem
      : <span key={i}>{parte}</span>
  ))
}

/** Gemini devuelve el texto con un subconjunto simple de markdown (encabezados `###`, viñetas
 * `*`/`-`, negrita `**`) — se interpreta a mano en vez de sumar una librería de markdown solo
 * para esto, agrupando líneas de viñeta consecutivas en una única lista. */
function renderTexto(texto) {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  const bloques = []
  let listaActual = null

  lineas.forEach((linea) => {
    const viñeta = linea.match(/^[*-]\s+(.*)$/)
    if (viñeta) {
      if (!listaActual) { listaActual = []; bloques.push({ tipo: 'lista', items: listaActual }) }
      listaActual.push(viñeta[1])
      return
    }
    listaActual = null

    const encabezado = linea.match(/^#{1,6}\s+(.*)$/)
    bloques.push(encabezado ? { tipo: 'encabezado', texto: encabezado[1] } : { tipo: 'parrafo', texto: linea })
  })

  return bloques.map((bloque, i) => {
    if (bloque.tipo === 'lista') {
      return (
        // eslint-disable-next-line react/no-array-index-key -- bloques de un mismo texto generado, sin id propio
        <ul key={i}>
          {bloque.items.map((item, j) => (
            // eslint-disable-next-line react/no-array-index-key -- ídem
            <li key={j}>{renderConNegritas(item)}</li>
          ))}
        </ul>
      )
    }
    if (bloque.tipo === 'encabezado') {
      // eslint-disable-next-line react/no-array-index-key -- ídem
      return <h6 key={i}>{renderConNegritas(bloque.texto)}</h6>
    }
    // eslint-disable-next-line react/no-array-index-key -- ídem
    return <p key={i}>{renderConNegritas(bloque.texto)}</p>
  })
}

/**
 * Modal de "Interpretación completa" del dashboard (botón en `DashboardAreaPage.jsx`, antes de
 * "Conectar vista de base de datos"): a diferencia de los "Hallazgos clave" por componente
 * (`HallazgosClaveCard`, texto generado con reglas fijas), acá se pide un análisis en lenguaje
 * natural de TODO el dashboard a la vez a un LLM externo (`generarInterpretacion`,
 * `backend/cartera/services/dashboard_interpretation.py`) — se dispara una sola vez al abrir el
 * modal, no en cada render.
 */
export default function InterpretacionDashboardModal({ show, onHide, dashboardId }) {
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState('')

  const generar = () => {
    setCargando(true)
    setError('')
    dashboardLayoutService.generarInterpretacion(dashboardId)
      .then((datos) => setTexto(datos.interpretacion))
      .catch((e) => setError(e.response?.data?.mensaje || 'No se pudo generar la interpretación. Intente nuevamente.'))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    if (show) generar()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se dispara una vez por apertura del modal, no en cada cambio de dashboardId
  }, [show])

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Interpretación completa del dashboard</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {cargando && (
          <div className="text-center py-4" role="status">
            <Spinner animation="border" />
            <p className="mt-2 mb-0 text-secondary">Generando interpretación con IA…</p>
          </div>
        )}
        {!cargando && error && <Alert variant="danger">{error}</Alert>}
        {!cargando && !error && texto && <div>{renderTexto(texto)}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>Cerrar</Button>
        <Button variant="primary" onClick={generar} disabled={cargando}>Generar de nuevo</Button>
      </Modal.Footer>
    </Modal>
  )
}
