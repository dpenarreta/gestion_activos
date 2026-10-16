import { useState } from 'react'
import { Alert, Button, Form, Table } from 'react-bootstrap'

const SIN_ELEGIR = ''
const YA_NO_EXISTE = '__ya_no_existe__'

function columnasFinales(columnas, aliases) {
  return columnas.map((c) => (aliases[c] || '').trim() || c)
}

function nombresDuplicados(finales) {
  return finales.filter((nombre, indice) => finales.indexOf(nombre) !== indice)
}

/** Columnas que ya estaban marcadas como históricas en una carga anterior de este dashboard
 * (`columnasHistoricasConfiguradas`, ver `ColumnaHistorica`) pero que no aparecen en este archivo
 * (ya renombrado) — si el usuario les cambió el nombre de más de la cuenta, o el archivo dejó de
 * traerlas, esta es la única señal de que se van a "perder" de la comparación histórica: al no
 * estar en la lista, ni siquiera tienen una fila con casilla para volver a tildarlas acá. */
function columnasHistoricasFaltantes(finales, columnasHistoricasConfiguradas) {
  return columnasHistoricasConfiguradas.filter((c) => !finales.includes(c))
}

/** Una fila de reconciliación por columna histórica faltante: el usuario identifica cuál columna
 * de ESTE archivo (por su nombre original, el que se ve en la tabla de arriba) es en realidad esa
 * columna histórica con otro nombre — elegirla aplica de una sola vez el alias (`onActualizarAlias`,
 * mismo mecanismo que renombrar a mano) y la vuelve a marcar como histórica (`onCambiarColumnaHistorica`),
 * así retoma la comparación en la próxima carga sin que el usuario tenga que hacer las dos cosas
 * por separado. La alternativa es confirmar que la columna ya no existe (`YA_NO_EXISTE`): no
 * cambia ningún alias, solo la marca como "resuelta" para esta pantalla (`onResolverAusente`) —
 * "Continuar" exige que cada faltante quede en uno de los dos estados, nunca sin decidir. */
function FilaColumnaFaltante({ nombreHistorico, columnas, resuelta, onIdentificar, onResolverAusente, onDeshacerResolucion }) {
  if (resuelta) {
    return (
      <div className="d-flex align-items-center justify-content-between gap-2 py-1">
        <span>
          Confirmaste que <strong>"{nombreHistorico}"</strong> ya no está en este archivo — no se
          va a seguir actualizando en la comparación histórica.
        </span>
        <Button size="sm" variant="link" className="p-0" onClick={onDeshacerResolucion}>Deshacer</Button>
      </div>
    )
  }
  return (
    <Form.Group className="py-1">
      <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>
        ¿Qué columna de este archivo corresponde a la columna histórica <strong>"{nombreHistorico}"</strong>?
      </Form.Label>
      <Form.Select
        size="sm"
        value={SIN_ELEGIR}
        onChange={(e) => (e.target.value === YA_NO_EXISTE ? onResolverAusente() : onIdentificar(e.target.value))}
        aria-label={`Columna que corresponde a la columna histórica "${nombreHistorico}"`}
      >
        <option value={SIN_ELEGIR}>Elegí una columna de este archivo…</option>
        {columnas.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value={YA_NO_EXISTE}>Ya no existe en este archivo</option>
      </Form.Select>
    </Form.Group>
  )
}

/**
 * Paso "renombrar columnas": tras validar el archivo, se muestran TODAS sus columnas para que el
 * usuario les ponga un nombre más claro antes del mapeo a la plantilla — a la izquierda el nuevo
 * nombre (editable, precargado con el original), a la derecha la columna fuente tal como viene en
 * el archivo. Ninguna columna se excluye ni se marca como no utilizable acá; eso lo decide el
 * mapeo (`TemplateMappingStep`), que ya trabaja sobre los nombres renombrados.
 *
 * Cada fila tiene además una casilla "Histórica" (`columnasHistoricas`/`onCambiarColumnaHistorica`)
 * — las columnas tildadas quedan guardadas como configuración del dashboard (`ColumnaHistorica`,
 * backend) y alimentan automáticamente Tabla 3 de ahí en más, sin tener que elegir nada en el paso
 * de Mapeo. `columnasHistoricasConfiguradas` (lo que ya estaba tildado en una carga anterior) se
 * usa para pre-tildar (`DashboardAreaPage`/`useGenericDashboardBuilder::inicializarColumnasHistoricas`)
 * y, acá, para detectar columnas históricas que "se perdieron" en este archivo
 * (`columnasHistoricasFaltantes`) — a diferencia de antes, esto ahora es OBLIGATORIO de resolver:
 * "Continuar" queda deshabilitado hasta que cada faltante quede identificada con una columna real
 * de este archivo (`FilaColumnaFaltante`, aplica alias + marca histórica de una sola vez) o
 * confirmada como efectivamente ausente — nunca se puede avanzar dejando una sin decidir.
 */
export default function RenameColumnsStep({
  archivoInfo, columnas, aliases, onActualizarAlias, onContinuar, onCancelar, cargando, error,
  columnasHistoricas = [], onCambiarColumnaHistorica, columnasHistoricasConfiguradas = [],
}) {
  const [ausentesResueltas, setAusentesResueltas] = useState(() => new Set())

  const finales = columnasFinales(columnas, aliases)
  const duplicados = nombresDuplicados(finales)
  const hayDuplicados = duplicados.length > 0
  const faltantes = columnasHistoricasFaltantes(finales, columnasHistoricasConfiguradas)
  const hayFaltantesSinResolver = faltantes.some((f) => !ausentesResueltas.has(f))

  const identificarFaltante = (nombreHistorico, columnaOriginal) => {
    onActualizarAlias(columnaOriginal, nombreHistorico)
    onCambiarColumnaHistorica(columnaOriginal, true)
  }
  const resolverAusente = (nombreHistorico) => {
    setAusentesResueltas((prev) => new Set(prev).add(nombreHistorico))
  }
  const deshacerResolucion = (nombreHistorico) => {
    setAusentesResueltas((prev) => {
      const siguiente = new Set(prev)
      siguiente.delete(nombreHistorico)
      return siguiente
    })
  }

  return (
    <div>
      {archivoInfo && (
        <p className="chart-panel__subtitle">
          Archivo: {archivoInfo.nombreArchivo} · {archivoInfo.totalFilas} fila(s) detectadas
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      <div className="chart-panel mb-3">
        <h6>Renombrar columnas</h6>
        <p className="chart-panel__subtitle">
          Ponle un nombre más claro a cualquier columna del archivo antes de armar la plantilla.
          Si no cambias algo, se usa el nombre original.
        </p>

        {columnas.length === 0 ? (
          <Alert variant="warning" className="mb-0">No se detectaron columnas en el archivo.</Alert>
        ) : (
          <Table responsive size="sm">
            <thead>
              <tr>
                <th>Nuevo nombre</th>
                <th>Columna en el archivo</th>
                <th>Histórica</th>
              </tr>
            </thead>
            <tbody>
              {columnas.map((nombre) => (
                <tr key={nombre}>
                  <td>
                    <Form.Control
                      size="sm"
                      value={aliases[nombre] ?? nombre}
                      onChange={(e) => onActualizarAlias(nombre, e.target.value)}
                      aria-label={`Nuevo nombre para ${nombre}`}
                    />
                  </td>
                  <td className="chart-panel__subtitle mb-0">{nombre}</td>
                  <td>
                    <Form.Check
                      type="checkbox"
                      checked={columnasHistoricas.includes(nombre)}
                      onChange={(e) => onCambiarColumnaHistorica(nombre, e.target.checked)}
                      aria-label={`Marcar "${nombre}" como columna histórica`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {hayDuplicados && (
        <Alert variant="danger">
          Hay columnas con el mismo nuevo nombre ({[...new Set(duplicados)].join(', ')}). Cambia
          alguna para poder continuar.
        </Alert>
      )}

      {faltantes.length > 0 && (
        <Alert variant="warning">
          <div className="mb-2">
            Estas columnas estaban marcadas como históricas y no están en este archivo. Identificá
            con qué columna corresponden ahora, o confirmá que ya no vienen, para poder continuar:
          </div>
          {faltantes.map((nombreHistorico) => (
            <FilaColumnaFaltante
              key={nombreHistorico}
              nombreHistorico={nombreHistorico}
              columnas={columnas}
              resuelta={ausentesResueltas.has(nombreHistorico)}
              onIdentificar={(columnaOriginal) => identificarFaltante(nombreHistorico, columnaOriginal)}
              onResolverAusente={() => resolverAusente(nombreHistorico)}
              onDeshacerResolucion={() => deshacerResolucion(nombreHistorico)}
            />
          ))}
        </Alert>
      )}

      <div className="d-flex gap-2">
        <Button variant="primary" onClick={onContinuar} disabled={cargando || hayDuplicados || hayFaltantesSinResolver}>
          {cargando ? 'Analizando…' : 'Continuar'}
        </Button>
        <Button variant="outline-secondary" onClick={onCancelar} disabled={cargando}>Cancelar</Button>
      </div>
    </div>
  )
}
