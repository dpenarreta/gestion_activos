import { Alert, Badge, Button, Spinner } from 'react-bootstrap'
import GenericChartRenderer from './GenericChartRenderer'
import { CamposParaSlot, FiltroSlot } from './SlotFields'
import { datosParaPreview, tipoVisualizacionElegido } from './slotFieldsData'
import { ETIQUETAS_TIPO_VISUALIZACION, PLANTILLA_SLOTS } from '../../utils/plantillaSlots'
import { tratamientoColumnaEnBlanco } from '../../utils/tratamientoBlancos'

const GRUPOS = ['KPI', 'Gráficos', 'Tablas']

function filaEjemploTexto(fila) {
  const referencia = Object.entries(fila.referencia || {}).map(([col, val]) => `${col}: ${val ?? '—'}`).join(', ')
  return referencia ? `fila ${fila.numero_fila} (${referencia})` : `fila ${fila.numero_fila}`
}

/** Aviso no bloqueante de columnas con valores en blanco recurrentes (`columnasConBlancos`, ver
 * `services/generic_charts.py::columnas_con_blancos_recurrentes` — ya filtradas a 3+ filas en
 * blanco, una celda suelta no se reporta). Por cada una: su tratamiento real
 * (`tratamientoColumnaEnBlanco`) y, si además es una de las columnas marcadas como históricas
 * (`columnasHistoricas`, casilla del paso "Renombrar columnas" — cualquiera de ellas alimenta por
 * igual a Tabla 3), una marca aparte — ahí el tratamiento importa más porque se arrastra
 * a la comparación histórica de esta carga.
 *
 * A propósito NO es un `Alert variant="warning"` de Bootstrap (fondo amarillo fijo, muy
 * llamativo, y reteñido por el color de marca sin garantía de buen contraste) — usa el mismo tono
 * azul oscuro/texto claro que ya llevan los recuadros "Hallazgos clave" (`.aviso-columnas-blanco`,
 * `styles/dashboard.css`) para que se vea como el resto de tarjetas del dashboard, no como una
 * advertencia urgente: esta información es de referencia, no bloquea nada. */
function AvisoColumnasEnBlanco({ columnasConBlancos, columnas, columnasHistoricas }) {
  if (columnasConBlancos.length === 0) return null
  return (
    <div className="aviso-columnas-blanco">
      <div className="fw-bold mb-2">Columnas con valores en blanco</div>
      <div className="d-flex flex-column gap-2">
        {columnasConBlancos.map((c) => {
          const columnaInfo = columnas.find((col) => col.nombre === c.columna)
          const esHistorica = columnasHistoricas.includes(c.columna)
          return (
            <div key={c.columna}>
              <strong>{c.columna}</strong> — {c.cantidad_en_blanco} fila(s) en blanco.{' '}
              {esHistorica && (
                <Badge bg="danger" className="me-1">
                  usada en Tabla 3 (histórica)
                </Badge>
              )}
              {tratamientoColumnaEnBlanco(columnaInfo)}
              {c.filas_ejemplo?.length > 0 && (
                <span className="aviso-columnas-blanco__ejemplos"> Ejemplos: {c.filas_ejemplo.map(filaEjemploTexto).join(', ')}.</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Paso "mapeo a la plantilla": tras cargar un archivo, muestra las 13 posiciones fijas de la
 * plantilla (KPI 1-4, Gráfico 1-6, Tabla 1-3) con la columna (o columnas) que el sistema propuso
 * para cada una (`services/plantilla.py::sugerir_mapeo`) y una vista previa real de cómo
 * quedaría. El usuario puede cambiar cualquier selector antes de confirmar; una posición sin
 * columnas adecuadas se marca "dato de ejemplo" y conserva su contenido ficticio.
 */
export default function TemplateMappingStep({
  archivoInfo, columnas, mapeo, datos, aliases, onActualizarSlot, onConfirmar, onCancelar, cargando, cargandoPreview, error,
  columnasConBlancos = [], columnasHistoricas = [], valoresBlancos,
}) {
  const camposPorSlot = (slot) => {
    const propuesta = mapeo[slot.id] || {}
    const cambiar = (campo) => (valor) => onActualizarSlot(slot.id, { [campo]: valor })
    const cambiarLista = (campo) => (nuevaLista) => onActualizarSlot(slot.id, { [campo]: nuevaLista })
    return (
      <CamposParaSlot
        slot={slot} propuesta={propuesta} columnas={columnas}
        cambiar={cambiar} cambiarLista={cambiarLista}
        cargaId={archivoInfo?.cargaId} aliases={aliases}
      />
    )
  }

  return (
    <div>
      {archivoInfo && (
        <p className="chart-panel__subtitle">
          Archivo: {archivoInfo.nombreArchivo} · {archivoInfo.totalFilas} fila(s) detectadas
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="chart-panel__subtitle d-flex align-items-center gap-2 flex-wrap">
        <span>
          Así quedarían las 13 posiciones de la plantilla con este archivo. Puedes elegir
          cualquier columna del archivo en cada selector; la vista previa se actualiza al
          instante. Las posiciones sin columnas elegidas conservan su dato de ejemplo.
        </span>
        {cargandoPreview && (
          <span className="d-inline-flex align-items-center gap-1">
            <Spinner animation="border" size="sm" role="status" />
            Actualizando vista previa…
          </span>
        )}
      </div>

      <AvisoColumnasEnBlanco columnasConBlancos={columnasConBlancos} columnas={columnas} columnasHistoricas={columnasHistoricas} />

      {GRUPOS.map((grupo) => (
        <div key={grupo} className="mb-4">
          <h6>{grupo}</h6>
          <div className="d-flex flex-column gap-2">
            {PLANTILLA_SLOTS.filter((s) => s.grupo === grupo).map((slot) => {
              const propuesta = mapeo[slot.id] || {}
              const contenido = datos[slot.id]
              const override = slot.colorDefecto ? { colores: { colorPrincipal: slot.colorDefecto } } : undefined
              const config = { ...slot.configFijo, leyenda_posicion: 'abajo' }
              const tipoVisualizacion = tipoVisualizacionElegido(slot, propuesta)
              return (
                <div key={slot.id} className="chart-panel">
                  <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                    <Badge bg={propuesta.disponible ? 'primary' : 'secondary'}>{ETIQUETAS_TIPO_VISUALIZACION[tipoVisualizacion]}</Badge>
                    <strong>{slot.titulo}</strong>
                    {!propuesta.disponible && <span className="chart-panel__subtitle mb-0">(dato de ejemplo — sin columnas suficientes)</span>}
                  </div>
                  <div className="row g-3">
                    <div className="col-md-4">
                      {slot.id === 'tabla-3' ? (
                        <p className="chart-panel__subtitle mb-0">
                          Esta tabla se arma automáticamente con las columnas que marcaste como
                          históricas en el paso anterior — no hace falta configurarla acá.
                        </p>
                      ) : (
                        <>
                          {camposPorSlot(slot)}
                          <FiltroSlot
                            contexto={slot.titulo}
                            cargaId={archivoInfo?.cargaId}
                            aliases={aliases}
                            valoresBlancos={valoresBlancos}
                            columnas={columnas}
                            esKPI={slot.calculo === 'kpi'}
                            columnaFiltro={propuesta.columna_filtro}
                            tipoFiltro={propuesta.tipo_filtro}
                            valorFiltro={propuesta.valor_filtro}
                            valoresFiltro={propuesta.valores_filtro}
                            operadorValor={propuesta.operador_valor}
                            operadorFiltro={propuesta.operador_filtro}
                            diasFiltro={propuesta.dias_filtro}
                            onCambiarColumna={(valor) => onActualizarSlot(slot.id, {
                              columna_filtro: valor, valor_filtro: null, valores_filtro: null, dias_filtro: null,
                            })}
                            onCambiarValores={(lista) => onActualizarSlot(slot.id, { valores_filtro: lista, valor_filtro: null })}
                            onCambiarOperadorValor={(valor) => onActualizarSlot(slot.id, { operador_valor: valor })}
                            onCambiarTipoFiltro={(valor) => onActualizarSlot(slot.id, {
                              tipo_filtro: valor, columna_filtro: null, valor_filtro: null, valores_filtro: null,
                              operador_valor: null, operador_filtro: null, dias_filtro: null,
                            })}
                            onCambiarOperador={(valor) => onActualizarSlot(slot.id, { operador_filtro: valor })}
                            onCambiarDias={(valor) => onActualizarSlot(slot.id, { dias_filtro: valor })}
                          />
                        </>
                      )}
                    </div>
                    <div className="col-md-8" style={{ maxWidth: slot.calculo === 'kpi' ? 280 : undefined }}>
                      <GenericChartRenderer
                        tipoVisualizacion={tipoVisualizacion}
                        titulo={contenido?.titulo}
                        override={override}
                        config={config}
                        {...datosParaPreview(slot, contenido)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="d-flex gap-2">
        <Button variant="primary" onClick={onConfirmar} disabled={cargando}>
          {cargando ? 'Aplicando…' : 'Aplicar a la plantilla'}
        </Button>
        <Button variant="outline-secondary" onClick={onCancelar} disabled={cargando}>Cancelar</Button>
      </div>
    </div>
  )
}
