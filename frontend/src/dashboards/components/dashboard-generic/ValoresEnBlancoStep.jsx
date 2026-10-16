import { Alert, Badge, Button, Form } from 'react-bootstrap'
import { tratamientoColumnaEnBlanco } from '../../utils/tratamientoBlancos'

/**
 * Paso "valores en blanco": se muestra solo cuando alguna columna tiene más de
 * `UMBRAL_BLANCOS_RENOMBRABLES` valores en blanco (`useGenericDashboardBuilder`, que ya filtra
 * `columnasConBlancos` a esas antes de pasarlas acá) — entre "Renombrar columnas" y "Mapeo a la
 * plantilla". Por cada columna, el usuario puede escribir un valor que reemplace esas celdas
 * vacías (afecta de verdad los cálculos — sumas, agrupaciones, comparación histórica — igual que
 * el renombrado de columnas del paso anterior) o dejar el campo vacío para conservar el
 * tratamiento habitual de un blanco (`tratamientoColumnaEnBlanco`).
 */
export default function ValoresEnBlancoStep({
  archivoInfo, columnasConBlancos, valoresBlancos, columnas, columnasHistoricas = [],
  onActualizarValorBlanco, onContinuar, onCancelar, cargando, error,
}) {
  return (
    <div>
      {archivoInfo && (
        <p className="chart-panel__subtitle">
          Archivo: {archivoInfo.nombreArchivo} · {archivoInfo.totalFilas} fila(s) detectadas
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      <div className="chart-panel mb-3">
        <h6>Valores en blanco</h6>
        <p className="chart-panel__subtitle">
          Estas columnas tienen muchos valores en blanco. Podés escribir un valor para
          reemplazarlos — afecta sumas, agrupaciones y la comparación histórica — o dejar el campo
          vacío para conservar el tratamiento habitual.
        </p>

        <div className="d-flex flex-column gap-3">
          {columnasConBlancos.map((c) => {
            const columnaInfo = columnas.find((col) => col.nombre === c.columna)
            const esHistorica = columnasHistoricas.includes(c.columna)
            return (
              <div key={c.columna} className="border-bottom pb-3">
                <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                  <strong>{c.columna}</strong>
                  <span className="chart-panel__subtitle mb-0">{c.cantidad_en_blanco} fila(s) en blanco</span>
                  {esHistorica && <Badge bg="danger">usada en Tabla 3 (histórica)</Badge>}
                </div>
                <Form.Control
                  size="sm"
                  placeholder="Dejar en blanco (sin cambios)"
                  value={valoresBlancos[c.columna] || ''}
                  onChange={(e) => onActualizarValorBlanco(c.columna, e.target.value)}
                  aria-label={`Valor de reemplazo para ${c.columna}`}
                />
                <div className="chart-panel__subtitle mt-1 mb-0">
                  {tratamientoColumnaEnBlanco(columnaInfo)} Si preferís, escribí arriba un valor
                  para reemplazarlas en vez de dejarlas así.
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="d-flex gap-2">
        <Button variant="primary" onClick={onContinuar} disabled={cargando}>
          {cargando ? 'Aplicando…' : 'Continuar'}
        </Button>
        <Button variant="outline-secondary" onClick={onCancelar} disabled={cargando}>Cancelar</Button>
      </div>
    </div>
  )
}
