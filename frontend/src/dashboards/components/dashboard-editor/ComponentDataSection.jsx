import { useEffect, useState } from 'react'
import { Alert, Spinner } from 'react-bootstrap'
import * as carteraService from '../../services/carteraService'
import * as historicoService from '../../services/historicoService'
import { CamposParaSlot, FiltroSlot } from '../dashboard-generic/SlotFields'
import { PLANTILLA_SLOTS } from '../../utils/plantillaSlots'
import TableCellsEditor from './TableCellsEditor'

/** `calculo` que soportan el selector "Fuente de datos" → "Histórico" (`SlotFields.jsx::
 * SelectorFuenteDatos`) — espejo de `dashboard_layout.py::_validar_mapeo_calculo`. El filtro
 * (`FiltroSlot`, más abajo) no tiene sentido en modo histórico para ninguno de estos: se oculta
 * cuando el `calculo` de la posición está en este set y `propuesta.usa_historico` está activo. */
const CALCULOS_CON_HISTORICO = new Set(['kpi', 'chart', 'multivalor', 'multiserie', 'tabla'])

/** Recorta o completa con `null` los `valores` de cada columna manual de una Tabla para que
 * queden con la misma cantidad que `cantidadFilas` (sección 29) — se llama después de cada
 * recálculo, cuando la cantidad de filas resultante pudo haber cambiado (nueva "Identidad de
 * fila" u otra columna real). Nunca borra los valores ya escritos: solo recorta el sobrante o dejan
 * huecos (`null`) para completar. Devuelve `{mapeo, ajustado}` — `ajustado` avisa si de verdad hubo
 * que tocar algo, para poder mostrar un aviso solo cuando corresponde. */
function ajustarColumnasManualesAlNuevoTotal(mapeo, cantidadFilas) {
  if (!Array.isArray(mapeo?.columnas_valor)) return { mapeo, ajustado: false }
  let ajustado = false
  const columnasValor = mapeo.columnas_valor.map((entrada) => {
    if (!entrada?.manual) return entrada
    const valores = Array.isArray(entrada.valores) ? entrada.valores : []
    if (valores.length === cantidadFilas) return entrada
    ajustado = true
    return { ...entrada, valores: Array.from({ length: cantidadFilas }, (_, i) => (i < valores.length ? valores[i] : null)) }
  })
  return { mapeo: ajustado ? { ...mapeo, columnas_valor: columnasValor } : mapeo, ajustado }
}

/** Best-effort: para un componente de Zona Personal creado ANTES de que `agregar_componente_generado`
 * empezara a guardar `mapeo.calculo` (o creado por un script de una sola vez), intenta reconstruir
 * con qué `calculo` se generó a partir de su forma (`type`/`chart_type`/`content`/`config`) —
 * mismas señales que `agregar_componente_generado` ya guardaba en `config` antes de este cambio.
 * `null` si no se puede resolver sin ambigüedad: "2+ columnas de valor" (`multivalor`) y
 * "categoría + serie" (`multiserie`) producen la misma forma `{categorias, series}`, así que sin
 * `config.columna_serie`/`config.columnas_valor` (tampoco guardados siempre históricamente) no hay
 * forma de distinguirlos con certeza. */
function inferirCalculoLegado(componente) {
  if (componente.type === 'kpi') return 'kpi'
  if (componente.chart_type === 'dispersion') return 'dispersion'
  if (componente.chart_type === 'tabla') return 'tabla'
  if (componente.content?.series) {
    if (componente.config?.columna_serie) return 'multiserie'
    if (Array.isArray(componente.config?.columnas_valor) && componente.config.columnas_valor.length > 0) return 'multivalor'
    return null
  }
  if (componente.content?.valores) return 'chart'
  return null
}

/**
 * Sección "Datos" de "Configurar componente": reconfigura qué columna(s)/tipo de cálculo/tipo de
 * gráfico/filtro alimentan un componente ya existente, sea una de las 13 posiciones fijas de la
 * plantilla o un KPI/gráfico de Zona Personal — mismos selectores que el mapeo inicial tras cargar
 * un archivo (`TemplateMappingStep`, vía `SlotFields`), pero sobre el archivo actual del dashboard
 * (`plantilla/archivo-actual`) en vez del de una sesión de carga en curso.
 *
 * Las 13 posiciones fijas recalculan contra TODAS a la vez (`previsualizarMapeoPlantilla`, con
 * dato ficticio de respaldo si la combinación no resuelve — nunca se queda sin contenido). Zona
 * Personal recalcula un único componente (`previsualizarMapeoComponente`, sin dato ficticio: si la
 * combinación de columnas todavía no resuelve, `contenido` viene `null` y se conserva el contenido
 * anterior en el borrador en vez de pisarlo con nada).
 *
 * Cada cambio actualiza el borrador del layout (`onActualizarComponente`); recién queda persistido
 * cuando el usuario guarda el diseño desde la barra de edición, igual que el resto de cambios de
 * este panel (título, colores, tamaño...).
 *
 * Para Tablas, esta sección también fusiona lo que antes era "Valores de la tabla" (sección 29):
 * columnas de valor "manuales" (`ColumnasTabla` en `SlotFields.jsx`) y edición de cualquier celda
 * ya calculada (`TableCellsEditor`, al final) conviven acá — `onActualizarContenido` es lo que
 * necesita esta segunda parte, ya que escribe directo en `content.filas`/`total` sin recalcular
 * contra el archivo (a diferencia de `onActualizarComponente`, que si dispara `recalcular`).
 */
export default function ComponentDataSection({ componente, dashboardId, onActualizarComponente, onActualizarContenido }) {
  const [archivoActual, setArchivoActual] = useState(null)
  const [cargandoArchivo, setCargandoArchivo] = useState(true)
  const [errorArchivo, setErrorArchivo] = useState('')
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [sinResultado, setSinResultado] = useState(false)
  const [avisoAjusteManual, setAvisoAjusteManual] = useState('')
  const [columnasHistoricas, setColumnasHistoricas] = useState([])

  useEffect(() => {
    let cancelado = false
    setCargandoArchivo(true)
    setErrorArchivo('')
    carteraService.obtenerArchivoActualDashboard(dashboardId)
      .then((resultado) => { if (!cancelado) setArchivoActual(resultado) })
      .catch(() => { if (!cancelado) setErrorArchivo('No se pudo cargar la información del archivo de este dashboard.') })
      .finally(() => { if (!cancelado) setCargandoArchivo(false) })
    return () => { cancelado = true }
  }, [dashboardId])

  useEffect(() => {
    let cancelado = false
    // De mejor esfuerzo: si falla, el selector "Fuente de datos" → "Histórico" (KPI/Gráfico/
    // Tabla) simplemente no ofrece ninguna columna (mismo criterio que cualquier otro selector de
    // columna sin datos) en vez de romper el resto del panel.
    historicoService.listarCargasHistoricas(dashboardId)
      .then((resultado) => { if (!cancelado) setColumnasHistoricas(resultado.columnas_disponibles || []) })
      .catch(() => { if (!cancelado) setColumnasHistoricas([]) })
    return () => { cancelado = true }
  }, [dashboardId])

  const slotFijo = PLANTILLA_SLOTS.find((s) => s.id === componente.component_id)
  // Solo KPI/gráfico pueden tener una fuente de datos que reconfigurar — un separador, un título o
  // el panel de filtros nunca calculan nada a partir de columnas (mismo mensaje que ya mostraba
  // esta sección antes de esta función, sin cambios para esos tipos).
  const esDatoZonaPersonal = !slotFijo && (componente.type === 'kpi' || componente.type === 'chart')
  const calculoZonaPersonal = esDatoZonaPersonal ? (componente.mapeo?.calculo || inferirCalculoLegado(componente)) : null

  if (!slotFijo && !esDatoZonaPersonal) {
    return <div className="chart-panel__subtitle mb-0">Esta posición no tiene datos configurables desde acá.</div>
  }

  if (esDatoZonaPersonal && !calculoZonaPersonal) {
    return (
      <div className="chart-panel__subtitle mb-0">
        Este componente se creó antes de poder reconfigurar su fuente de datos y no se puede
        identificar con certeza cómo recalcularlo. Para cambiar de qué columna sale su información,
        te recomendamos borrarlo y crearlo de nuevo desde la paleta de componentes.
      </div>
    )
  }

  if (cargandoArchivo) {
    return <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>
  }

  if (errorArchivo) {
    return <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem' }}>{errorArchivo}</Alert>
  }

  if (!archivoActual?.disponible) {
    return (
      <div className="chart-panel__subtitle mb-0">
        Este dashboard todavía no tiene un archivo real cargado. Usa "Cargar otro archivo" para
        poder configurar los datos de este componente.
      </div>
    )
  }

  const slot = slotFijo || {
    calculo: calculoZonaPersonal, titulo: componente.content?.titulo || componente.component_id,
    tipoVisualizacion: componente.chart_type,
  }
  const propuesta = componente.mapeo || {}
  const columnas = archivoActual.columnas

  // Zona Personal necesita guardar `calculo` dentro del propio mapeo (las posiciones fijas no: su
  // calculo sale de `PLANTILLA_SLOTS`) — si no, la próxima vez que se abra este panel no habría
  // forma de saber con qué calculo se armó este componente sin volver a inferirlo.
  const conCalculo = (mapeo) => (slotFijo ? mapeo : { ...mapeo, calculo: slot.calculo })

  // Solo Tablas pueden tener columnas manuales (sección 29) — para el resto de `calculo` esto
  // nunca ajusta nada, solo limpia el aviso si había quedado de una tabla vista antes.
  const conAjusteManual = (mapeo, contenido) => {
    if (slot.calculo !== 'tabla' || !Array.isArray(contenido?.filas)) {
      setAvisoAjusteManual('')
      return mapeo
    }
    const { mapeo: mapeoAjustado, ajustado } = ajustarColumnasManualesAlNuevoTotal(mapeo, contenido.filas.length)
    setAvisoAjusteManual(ajustado ? 'Se ajustó la cantidad de valores de alguna columna manual a la nueva cantidad de filas — revisala.' : '')
    return mapeoAjustado
  }

  const recalcular = async (nuevoMapeo) => {
    setCargandoPreview(true)
    try {
      if (slotFijo) {
        const resultado = await carteraService.previsualizarMapeoPlantilla(archivoActual.carga_id, { [componente.component_id]: nuevoMapeo })
        const contenidoNuevo = resultado.datos[componente.component_id]
        onActualizarComponente(componente.component_id, { mapeo: conAjusteManual(nuevoMapeo, contenidoNuevo), content: contenidoNuevo })
        setSinResultado(false)
        return
      }
      const resultado = await carteraService.previsualizarMapeoComponente(archivoActual.carga_id, {
        calculo: slot.calculo, titulo: slot.titulo, mapeo: nuevoMapeo,
      })
      if (resultado.contenido) {
        onActualizarComponente(componente.component_id, { mapeo: conAjusteManual(nuevoMapeo, resultado.contenido), content: resultado.contenido })
        setSinResultado(false)
      } else {
        // La combinación de columnas elegida todavía no resuelve (falta alguna, o el filtro no
        // deja ninguna fila) — se guarda igual la selección para poder seguir ajustándola, pero
        // sin pisar el último contenido válido.
        onActualizarComponente(componente.component_id, { mapeo: nuevoMapeo })
        setSinResultado(true)
      }
    } catch {
      // La vista previa es de mejor esfuerzo: el mapeo elegido igual queda guardado en el
      // borrador (se puede reintentar el cálculo cambiando cualquier otro campo).
      onActualizarComponente(componente.component_id, { mapeo: nuevoMapeo })
    } finally {
      setCargandoPreview(false)
    }
  }

  const cambiar = (campo) => (valor) => {
    const nuevoMapeo = conCalculo({ ...propuesta, [campo]: valor, disponible: true })
    if (campo === 'chart_type') {
      // El tipo de gráfico no cambia los datos calculados, solo cómo se dibujan — no hace falta
      // recalcular contra el archivo.
      onActualizarComponente(componente.component_id, { mapeo: nuevoMapeo, chart_type: valor })
      return
    }
    recalcular(nuevoMapeo)
  }

  const cambiarLista = (campo) => (nuevaLista) => recalcular(conCalculo({ ...propuesta, [campo]: nuevaLista, disponible: true }))

  return (
    <div>
      <div className="chart-panel__subtitle d-flex align-items-center gap-2 flex-wrap mb-2">
        <span>Archivo: {archivoActual.nombre_archivo} · {archivoActual.total_filas} fila(s)</span>
        {cargandoPreview && (
          <span className="d-inline-flex align-items-center gap-1">
            <Spinner animation="border" size="sm" role="status" />
            Actualizando…
          </span>
        )}
      </div>
      {sinResultado && !cargandoPreview && (
        <Alert variant="warning" className="py-2" style={{ fontSize: '0.8rem' }}>
          No se pudo calcular con esa combinación de columnas todavía — se conserva el último
          contenido válido hasta que elijas una combinación que resuelva.
        </Alert>
      )}
      {avisoAjusteManual && (
        <Alert variant="warning" className="py-2" style={{ fontSize: '0.8rem' }}>
          {avisoAjusteManual}
        </Alert>
      )}
      <CamposParaSlot
        slot={slot} propuesta={propuesta} columnas={columnas}
        cambiar={cambiar} cambiarLista={cambiarLista}
        cargaId={archivoActual.carga_id} filasActuales={componente.content?.filas}
        columnasHistoricas={columnasHistoricas}
        ocultarHistorico={componente.component_id === 'tabla-3'}
      />
      {!(CALCULOS_CON_HISTORICO.has(slot.calculo) && propuesta.usa_historico) && (
        <FiltroSlot
          contexto={slot.titulo}
          cargaId={archivoActual.carga_id}
          columnas={columnas}
          esKPI={slot.calculo === 'kpi'}
          columnaFiltro={propuesta.columna_filtro}
          tipoFiltro={propuesta.tipo_filtro}
          valorFiltro={propuesta.valor_filtro}
          valoresFiltro={propuesta.valores_filtro}
          operadorValor={propuesta.operador_valor}
          operadorFiltro={propuesta.operador_filtro}
          diasFiltro={propuesta.dias_filtro}
          onCambiarColumna={(valor) => recalcular(conCalculo({
            ...propuesta, columna_filtro: valor, valor_filtro: null, valores_filtro: null,
            dias_filtro: null, disponible: true,
          }))}
          // `valor_filtro: null` al guardar la lista: si quedaran los dos, el mapeo tendría dos
          // fuentes para lo mismo y la anterior gana en los mapeos viejos (ver `valores_filtro_de`).
          onCambiarValores={(lista) => recalcular(conCalculo({
            ...propuesta, valores_filtro: lista, valor_filtro: null, disponible: true,
          }))}
          onCambiarOperadorValor={(valor) => recalcular(conCalculo({
            ...propuesta, operador_valor: valor, disponible: true,
          }))}
          onCambiarTipoFiltro={(valor) => recalcular(conCalculo({
            ...propuesta, tipo_filtro: valor, columna_filtro: null, valor_filtro: null,
            valores_filtro: null, operador_valor: null, operador_filtro: null, dias_filtro: null,
            disponible: true,
          }))}
          onCambiarOperador={(valor) => recalcular(conCalculo({ ...propuesta, operador_filtro: valor, disponible: true }))}
          onCambiarDias={(valor) => recalcular(conCalculo({ ...propuesta, dias_filtro: valor, disponible: true }))}
        />
      )}
      {slot.calculo === 'tabla' && Array.isArray(componente.content?.columnas) && Array.isArray(componente.content?.filas) && (
        <div className="mt-3 pt-3 border-top">
          <div className="chart-panel__subtitle mb-1">Valores calculados</div>
          <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>
            Se puede editar el valor de cualquier celda ya calculada (de una columna real o
            manual). No se pueden agregar ni quitar filas o columnas desde acá — para eso, ajustá
            las columnas de arriba.
          </p>
          <TableCellsEditor
            columnas={componente.content.columnas}
            filas={componente.content.filas}
            total={componente.content.total}
            onCambiarFilas={(filas) => onActualizarContenido(componente.component_id, { filas })}
            onCambiarTotal={(total) => onActualizarContenido(componente.component_id, { total })}
          />
        </div>
      )}
    </div>
  )
}
