import { useEffect, useState } from 'react'
import { Button, Form } from 'react-bootstrap'
import * as carteraService from '../../services/carteraService'
import { ETIQUETAS_TIPO_VISUALIZACION, TIPOS_COMPATIBLES } from '../../utils/plantillaSlots'
import { ETIQUETAS_TRAMOS_ACUMULADOS } from '../../utils/tramosAntiguedad'
import { normalizarColumnaValorTabla, tipoVisualizacionElegido } from './slotFieldsData'

/**
 * Piezas de selección de mapeo (columna/tipo de cálculo/tipo de gráfico/filtro) de una posición
 * de la plantilla fija — compartidas entre el paso de mapeo inicial (`TemplateMappingStep`, tras
 * cargar un archivo) y la sección "Datos" del panel de "Configurar componente"
 * (`ComponentDataSection`, para reconfigurar una posición ya aplicada). Un mismo criterio en un
 * solo lugar evita que ambos flujos diverjan en cómo arman/leen la propuesta de mapeo.
 */

/** Etiquetas de los selectores de columna/categoría/serie/valor, específicas del tipo de gráfico
 * elegido (no un genérico "Categoría"/"Valor" igual para los 5 tipos compatibles con `chart`, o
 * para los 6 compatibles con `multivalor`/`multiserie`) — para que el nombre del campo por sí solo
 * diga qué controla en ESE gráfico puntual: qué eje ocupa en una barra/línea (y de cuál eje,
 * porque una barra horizontal invierte cuál columna va en cada eje — ver
 * `GenericBarChart.jsx::esHorizontal`), o qué arma cada porción/la leyenda en un pastel/dona. */
function etiquetasPorTipoGrafico(chartType) {
  if (chartType === 'barras_horizontales') {
    return {
      categoria: 'Eje vertical (categoría)', valor: 'Eje horizontal (valor)',
      serie: 'Serie (una barra por cada valor distinto)',
    }
  }
  if (chartType === 'pastel' || chartType === 'dona') {
    return {
      categoria: 'Categoría (una porción por valor)', valor: 'Valor (tamaño de cada porción)',
      serie: 'Serie (se combina en el total de cada porción)',
    }
  }
  return {
    categoria: 'Eje horizontal (categoría)', valor: 'Eje vertical (valor)',
    serie: 'Serie (una barra, línea o capa por cada valor distinto)',
  }
}

/** Aclara, debajo de "Categoría", que sus valores se convierten en la leyenda — solo aplica a
 * pastel/dona, donde "la leyenda" es un concepto visible del gráfico (una barra o línea no tiene
 * una leyenda por categoría de la misma forma). */
function AyudaCircular() {
  return (
    <Form.Text className="d-block mb-2" style={{ fontSize: '0.72rem', marginTop: '-0.35rem' }}>
      Cada valor distinto se dibuja como una porción del gráfico y aparece en la leyenda.
    </Form.Text>
  )
}

export function SelectorColumna({ etiqueta, contexto, valor, opciones, onCambiar }) {
  return (
    <Form.Group className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>{etiqueta}</Form.Label>
      <Form.Select
        size="sm"
        value={valor || ''}
        onChange={(e) => onCambiar(e.target.value || null)}
        aria-label={`${etiqueta} de ${contexto}`}
      >
        <option value="">Sin usar</option>
        {opciones.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
      </Form.Select>
    </Form.Group>
  )
}

/** Compartido entre los KPI (un único valor) y cada columna de valor de una Tabla (sección 23,
 * una por columna — no aplica a la columna de "Identidad de fila"): "Suma" agrega los valores de
 * la columna (para montos/cantidades); "Promedio" calcula su media aritmética (para
 * montos/cantidades típicos, p. ej. saldo promedio); "Cantidad de valores únicos" cuenta cuántos
 * valores distintos tiene (para saber, p. ej., cuántos clientes o números de documento diferentes
 * hay, sin importar si la columna es numérica); "Ver valor de celda" (solo Tablas, sección 23bis)
 * no agrega nada — muestra el valor real de la columna cuando es el mismo en todas las filas
 * agrupadas (columnas que identifican algo y no varían, p. ej. "Zona" o "Ciudad" de un cliente).
 * `permitirValorCelda` (por defecto `true`) lo oculta en el contexto de KPI, donde no aplica: un
 * KPI no agrupa filas, así que "el mismo valor en todo el grupo" no tiene sentido ahí. */
export function SelectorTipoAgregacion({ contexto, valor, onCambiar, permitirValorCelda = true }) {
  return (
    <Form.Group className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Tipo de cálculo</Form.Label>
      <Form.Select
        size="sm"
        value={valor || 'suma'}
        onChange={(e) => onCambiar(e.target.value)}
        aria-label={`Tipo de cálculo de ${contexto}`}
      >
        <option value="suma">Suma</option>
        <option value="promedio">Promedio</option>
        <option value="conteo_unicos">Cantidad de valores únicos</option>
        {permitirValorCelda && <option value="valor_celda">Ver valor de celda</option>}
      </Form.Select>
    </Form.Group>
  )
}

/** Solo aplica a Gráficos (no a KPI/dispersión/tabla, cuyo `calculo` solo se puede dibujar de una
 * forma): elegir entre los tipos de visualización compatibles con los datos ya calculados para
 * esta posición (p. ej. Gráfico 1 puede pasar de barras a líneas o pastel sin perder el
 * mapeo de columnas elegido). */
export function SelectorTipoGrafico({ contexto, calculo, valor, valorDefecto, onCambiar }) {
  const opciones = TIPOS_COMPATIBLES[calculo]
  if (!opciones) return null
  return (
    <Form.Group className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Tipo de gráfico</Form.Label>
      <Form.Select
        size="sm"
        value={valor || valorDefecto}
        onChange={(e) => onCambiar(e.target.value)}
        aria-label={`Tipo de gráfico de ${contexto}`}
      >
        {opciones.map((tipo) => <option key={tipo} value={tipo}>{ETIQUETAS_TIPO_VISUALIZACION[tipo]}</option>)}
      </Form.Select>
    </Form.Group>
  )
}

// Operadores del filtro "Días desde una fecha" — catálogo cerrado, mismo que
// `services/plantilla.py::_OPERADORES_DIAS_VENCIDOS`.
// Espejo de `generic_charts.py::LIMITE_DEUDORES`, que es donde se valida de verdad.
const MAX_DEUDORES = 6

const OPERADORES_DIAS_VENCIDOS = [
  { valor: 'mayor', etiqueta: 'Mayor que (>)' },
  { valor: 'mayor_igual', etiqueta: 'Mayor o igual que (≥)' },
  { valor: 'menor', etiqueta: 'Menor que (<)' },
  { valor: 'menor_igual', etiqueta: 'Menor o igual que (≤)' },
]

/**
 * Filtro opcional de una posición (ver `services/plantilla.py::_aplicar_filtro_slot`), con dos
 * formas posibles:
 * - "Valor exacto" (`tipo_filtro: 'igualdad'`, default): elegir una columna carga en vivo sus
 *   valores distintos (`obtenerValoresColumnaPlantilla`) para el segundo selector — el usuario
 *   nunca escribe un valor a mano, elige uno que de verdad existe en el archivo. Disponible para
 *   cualquier posición (KPI, gráfico o tabla).
 * - "Días desde una fecha" (`tipo_filtro: 'dias_vencidos'`, solo `esKPI`): compara, contra HOY,
 *   cuántos días pasaron desde una columna de fecha — ej. "Fecha de Vencimiento" > 30 días. Solo
 *   ofrece columnas de tipo `'fecha'` (`generic_charts.py::analizar_columnas`), y no consulta
 *   valores existentes (el "valor" acá es un número de días, no algo que salga del archivo).
 * El selector "Tipo de filtro" solo aparece en contexto de KPI — el resto de posiciones no tiene
 * forma de elegir otra cosa que "Valor exacto" (decisión explícita del usuario, por ahora).
 */
export function FiltroSlot({
  contexto, cargaId, aliases, valoresBlancos, columnas, esKPI,
  columnaFiltro, tipoFiltro, valorFiltro, valoresFiltro, operadorValor, operadorFiltro, diasFiltro,
  onCambiarColumna, onCambiarValores, onCambiarOperadorValor, onCambiarTipoFiltro,
  onCambiarOperador, onCambiarDias,
}) {
  const [valores, setValores] = useState([])
  const [cargandoValores, setCargandoValores] = useState(false)
  const esDiasVencidos = esKPI && tipoFiltro === 'dias_vencidos'
  // `valor_filtro` es la forma anterior (un único valor). Se sigue leyendo para que un mapeo
  // guardado antes de que el filtro admitiera varios se muestre bien: no hay migración de datos.
  const seleccionados = valoresFiltro?.length ? valoresFiltro : (valorFiltro ? [valorFiltro] : [])

  useEffect(() => {
    if (esDiasVencidos || !columnaFiltro || !cargaId) {
      setValores([])
      return undefined
    }
    let cancelado = false
    setCargandoValores(true)
    carteraService.obtenerValoresColumnaPlantilla(cargaId, columnaFiltro, aliases, valoresBlancos)
      .then((resultado) => { if (!cancelado) setValores(resultado.valores || []) })
      .catch(() => { if (!cancelado) setValores([]) })
      .finally(() => { if (!cancelado) setCargandoValores(false) })
    return () => { cancelado = true }
  }, [columnaFiltro, cargaId, aliases, valoresBlancos, esDiasVencidos])

  return (
    <div className="mt-2 pt-2 border-top">
      <div className="chart-panel__subtitle mb-1">Filtro (opcional)</div>
      {esKPI && (
        <Form.Group className="mb-2">
          <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Tipo de filtro</Form.Label>
          <Form.Select
            size="sm"
            value={tipoFiltro || 'igualdad'}
            onChange={(e) => onCambiarTipoFiltro(e.target.value)}
            aria-label={`Tipo de filtro de ${contexto}`}
          >
            <option value="igualdad">Valor exacto</option>
            <option value="dias_vencidos">Días desde una fecha</option>
          </Form.Select>
        </Form.Group>
      )}
      {esDiasVencidos ? (
        <>
          <SelectorColumna
            etiqueta="Columna de fecha" contexto={contexto} valor={columnaFiltro}
            opciones={columnas.filter((c) => c.tipo === 'fecha')} onCambiar={onCambiarColumna}
          />
          {columnaFiltro && (
            <div className="d-flex gap-2">
              <Form.Group className="mb-2" style={{ flex: 1 }}>
                <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Comparación</Form.Label>
                <Form.Select
                  size="sm"
                  value={operadorFiltro || 'mayor'}
                  onChange={(e) => onCambiarOperador(e.target.value)}
                  aria-label={`Comparación de días de ${contexto}`}
                >
                  {OPERADORES_DIAS_VENCIDOS.map((op) => <option key={op.valor} value={op.valor}>{op.etiqueta}</option>)}
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-2" style={{ flex: 1 }}>
                <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Días</Form.Label>
                <Form.Control
                  size="sm" type="number" min="0"
                  value={diasFiltro ?? ''}
                  onChange={(e) => onCambiarDias(e.target.value === '' ? null : Number(e.target.value))}
                  aria-label={`Cantidad de días de ${contexto}`}
                />
              </Form.Group>
            </div>
          )}
        </>
      ) : (
        <>
          <SelectorColumna
            etiqueta="Columna de filtro" contexto={contexto} valor={columnaFiltro} opciones={columnas}
            onCambiar={onCambiarColumna}
          />
          {columnaFiltro && (
            <>
              <Form.Group className="mb-2">
                <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Comparación</Form.Label>
                <Form.Select
                  size="sm"
                  value={operadorValor || 'en'}
                  onChange={(e) => onCambiarOperadorValor(e.target.value)}
                  aria-label={`Comparación de valores de ${contexto}`}
                >
                  <option value="en">Es uno de</option>
                  <option value="no_en">No es ninguno de</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Valores</Form.Label>
                {/* Selección múltiple: "todo menos lo anticipado" se expresa eligiendo ANTICIPADA
                    con "No es ninguno de", sin tener que enumerar los demás tramos — que además
                    cambiarían si el archivo trae una categoría nueva. */}
                <Form.Select
                  size="sm"
                  multiple
                  htmlSize={Math.min(Math.max(valores.length, 3), 7)}
                  value={seleccionados}
                  onChange={(e) => onCambiarValores(
                    [...e.target.selectedOptions].map((opcion) => opcion.value),
                  )}
                  aria-label={`Valores de filtro de ${contexto}`}
                  disabled={cargandoValores}
                >
                  {valores.map((v) => <option key={v} value={v}>{v}</option>)}
                </Form.Select>
                <Form.Text style={{ fontSize: '0.75rem' }}>
                  {cargandoValores
                    ? 'Cargando valores…'
                    : 'Sin selección, no se filtra nada. Ctrl/Cmd para elegir varios.'}
                </Form.Text>
              </Form.Group>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Input de texto libre con estado local mientras se teclea y commit recién en `onBlur` (mismo
 * patrón que `TableCellsEditor.jsx::CeldaEditable`, pero sin forzar tipo numérico — un valor
 * manual siempre es texto libre, aunque "parezca" un número). No se puede reusar `CeldaEditable`
 * directamente: vive en `dashboard-editor/`, y este archivo (`dashboard-generic/`) nunca debe
 * importar de ahí (la dependencia va siempre editor → genérico, nunca al revés). */
function CampoTexto({ etiqueta, valor, onCambiar, ariaLabel }) {
  const [texto, setTexto] = useState(String(valor ?? ''))
  useEffect(() => setTexto(String(valor ?? '')), [valor])
  return (
    <Form.Group className="mb-2">
      {etiqueta && <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>{etiqueta}</Form.Label>}
      <Form.Control
        size="sm"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => { if (texto !== String(valor ?? '')) onCambiar(texto) }}
        aria-label={ariaLabel}
      />
    </Form.Group>
  )
}

/** Columna de una Tabla cuyos valores el usuario escribe a mano (sección 29, ej. "Meta" con un
 * valor de política por fila) en vez de que salgan de una columna real del archivo. La cantidad de
 * filas la decide la tabla YA calculada (`filasActuales` — el `content.filas` vigente del
 * componente, con al menos una columna real) — acá no hay forma de elegir "cuántas filas", un
 * input de texto por cada fila vigente (etiquetado con la identidad de esa fila) más uno para el
 * valor en la fila "Total" (opcional; sin tecleary queda vacío, igual que hoy una celda sin dato).
 * Si más adelante cambia la cantidad de filas, `ComponentDataSection.jsx` recorta/completa
 * `valores` antes de guardar — acá solo se muestran los inputs que corresponden al estado actual. */
function ColumnaManual({ contexto, entrada, filasActuales, onCambiarTitulo, onCambiarValor, onCambiarTotal }) {
  const filas = filasActuales || []
  return (
    <div className="mb-2">
      <CampoTexto
        etiqueta="Título de la columna" valor={entrada.titulo} onCambiar={onCambiarTitulo}
        ariaLabel={`Título de la columna manual de ${contexto}`}
      />
      {filas.length === 0 ? (
        <Form.Text className="d-block mb-2" style={{ fontSize: '0.72rem' }}>
          Los valores de cada fila aparecen acá una vez que la tabla tenga al menos una columna del
          archivo ya calculada.
        </Form.Text>
      ) : (
        filas.map((fila, i) => (
          <CampoTexto
            // eslint-disable-next-line react/no-array-index-key -- las filas no tienen un id propio
            key={i}
            etiqueta={String(fila[0])}
            valor={entrada.valores?.[i] ?? ''}
            onCambiar={(valor) => onCambiarValor(i, valor)}
            ariaLabel={`${entrada.titulo || 'Columna manual'} — fila ${i + 1} (${fila[0]}) de ${contexto}`}
          />
        ))
      )}
      <CampoTexto
        etiqueta="Valor en la fila Total (opcional)" valor={entrada.total} onCambiar={onCambiarTotal}
        ariaLabel={`${entrada.titulo || 'Columna manual'} — total de ${contexto}`}
      />
    </div>
  )
}

/**
 * Solo aplica a Tablas: a diferencia del resto de posiciones (una cantidad fija de columnas de
 * valor por `calculo`), una tabla puede tener cualquier cantidad — se pueden agregar, quitar y
 * reordenar sin límite fijo (`services/generic_charts.py::generar_datos_tabla` ya acepta una
 * lista de cualquier tamaño). Siempre queda al menos una fila de selector: una tabla sin ninguna
 * columna de valor no tiene nada que calcular y cae al dato ficticio. Cada columna, además de
 * elegir su ORIGEN (una columna real del archivo, con su propio tipo de agregación — sección 23:
 * suma/promedio/cantidad de valores únicos —, o valores escritos a mano — sección 29), es
 * independiente de las demás (p. ej. "Ventas" en suma, "Cliente" en cantidad de valores únicos y
 * "Meta" a mano, en la misma tabla).
 */
function ColumnasTabla({
  contexto, columnasElegidas, opciones, filasActuales,
  onCambiarColumna, onCambiarAgregacion, onCambiarOrigen, onCambiarTituloManual, onCambiarValorManual, onCambiarTotalManual,
  onAgregar, onQuitar, onMover,
}) {
  const lista = (columnasElegidas.length > 0 ? columnasElegidas : [null]).map(normalizarColumnaValorTabla)
  return (
    <div className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Columnas</Form.Label>
      {lista.map((fila, i) => (
        <div key={i} className="mb-2 p-2 border rounded">
          <Form.Group className="mb-2">
            <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Origen de la columna {i + 1}</Form.Label>
            <Form.Select
              size="sm"
              value={fila.manual ? 'manual' : 'archivo'}
              onChange={(e) => onCambiarOrigen(i)(e.target.value === 'manual')}
              aria-label={`Origen de columna ${i + 1} de ${contexto}`}
            >
              <option value="archivo">Columna del archivo</option>
              <option value="manual">Valores escritos a mano</option>
            </Form.Select>
          </Form.Group>
          {fila.manual ? (
            <ColumnaManual
              contexto={`columna ${i + 1} de ${contexto}`}
              entrada={fila}
              filasActuales={filasActuales}
              onCambiarTitulo={onCambiarTituloManual(i)}
              onCambiarValor={onCambiarValorManual(i)}
              onCambiarTotal={onCambiarTotalManual(i)}
            />
          ) : (
            <>
              <SelectorColumna
                etiqueta={`Columna ${i + 1}`} contexto={contexto} valor={fila.columna} opciones={opciones}
                onCambiar={onCambiarColumna(i)}
              />
              <SelectorTipoAgregacion
                contexto={`columna ${i + 1} de ${contexto}`} valor={fila.tipo_agregacion} onCambiar={onCambiarAgregacion(i)}
              />
            </>
          )}
          <div className="d-flex gap-1">
            <Button
              size="sm" variant="outline-secondary" onClick={() => onMover(i, 'arriba')} disabled={i === 0}
              aria-label={`Mover columna ${i + 1} de ${contexto} arriba`} title="Mover arriba"
            >
              ↑
            </Button>
            <Button
              size="sm" variant="outline-secondary" onClick={() => onMover(i, 'abajo')} disabled={i === lista.length - 1}
              aria-label={`Mover columna ${i + 1} de ${contexto} abajo`} title="Mover abajo"
            >
              ↓
            </Button>
            <Button
              size="sm" variant="outline-danger" onClick={() => onQuitar(i)} disabled={lista.length <= 1}
              aria-label={`Quitar columna ${i + 1} de ${contexto}`} title="Quitar columna"
            >
              ×
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline-secondary" onClick={onAgregar}>+ Agregar columna</Button>
    </div>
  )
}

/** Solo aplica a posiciones `multivalor` cuando el tipo de gráfico elegido realmente compara
 * varias métricas a la vez (barras agrupadas/apiladas, área apilada, líneas múltiples) —
 * `CamposParaSlot` decide si se usa este selector o el de una sola "Valor" (pastel/dona, ver más
 * abajo) según el tipo de gráfico, no según el `calculo` de la posición. Entre 2 columnas (mínimo
 * para que "comparar varias métricas" tenga sentido) y 3 (más se vuelve ilegible en un gráfico
 * chico) — a diferencia de `ColumnasTabla` (sin límite), y sin tipo de agregación por columna:
 * cada entrada acá es solo el nombre de columna (string), `generic_charts.generar_datos_multivalor`
 * siempre suma. */
function ColumnasValorMultiples({ contexto, columnasValor, opciones, onCambiar }) {
  const lista = columnasValor.length >= 2 ? columnasValor : [...columnasValor, ...Array(2 - columnasValor.length).fill(null)]
  const cambiarColumna = (i) => (valor) => {
    const nueva = [...lista]
    nueva[i] = valor
    onCambiar(nueva)
  }
  return (
    <div className="mb-2">
      {lista.map((columna, i) => (
        <div key={i} className="d-flex align-items-start gap-1">
          <div className="flex-grow-1">
            <SelectorColumna etiqueta={`Métrica ${i + 1}`} contexto={contexto} valor={columna} opciones={opciones} onCambiar={cambiarColumna(i)} />
          </div>
          {lista.length > 2 && (
            <Button
              size="sm" variant="outline-danger" className="mt-4" onClick={() => onCambiar(lista.filter((_, idx) => idx !== i))}
              aria-label={`Quitar métrica ${i + 1} de ${contexto}`} title="Quitar métrica"
            >
              ×
            </Button>
          )}
        </div>
      ))}
      {lista.length < 3 && (
        <Button size="sm" variant="outline-secondary" onClick={() => onCambiar([...lista, null])}>+ Agregar métrica</Button>
      )}
    </div>
  )
}

/** Aviso, junto al selector de Categoría/Identidad de fila, de que la columna elegida tiene
 * valores repetidos — filas distintas se van a agrupar bajo el mismo valor (comportamiento normal
 * de "agrupar por categoría", pero puede no ser lo que el usuario esperaba; no aplica a
 * "Valor"/"Serie", ahí un duplicado no cambia el cálculo). Silencioso si no hay `columna`/
 * `cargaId`, si esa columna no tiene duplicados, o si la consulta falla — es solo información de
 * referencia, nunca bloquea nada (mismo criterio y misma clase visual que "Columnas con valores en
 * blanco", `.aviso-columnas-blanco` en `dashboard.css`, reusada tal cual). */
function AvisoColumnaDuplicada({ cargaId, aliases, columna }) {
  const [duplicados, setDuplicados] = useState(null)

  useEffect(() => {
    if (!columna || !cargaId) {
      setDuplicados(null)
      return undefined
    }
    let cancelado = false
    carteraService.obtenerDuplicadosColumna(cargaId, columna, aliases)
      .then((resultado) => { if (!cancelado) setDuplicados(resultado) })
      .catch(() => { if (!cancelado) setDuplicados(null) })
    return () => { cancelado = true }
  }, [columna, cargaId, aliases])

  if (!duplicados || duplicados.cantidad_valores_duplicados === 0) return null

  const ejemplos = duplicados.ejemplos.map((e) => `${e.valor} (${e.cantidad} veces)`).join(', ')
  return (
    <div className="aviso-columnas-blanco mb-2 py-2 px-3" style={{ fontSize: '0.8rem' }}>
      Esta columna tiene {duplicados.cantidad_valores_duplicados} valor(es) duplicado(s).
      {ejemplos && <span className="aviso-columnas-blanco__ejemplos"> Ejemplos: {ejemplos}.</span>}
    </div>
  )
}

/** Cómo se muestra el valor de un KPI — "numero" (por defecto, retrocompatible con KPIs creados
 * antes de este selector), "moneda" (antepone "$", ver `utils/format.js::formatCurrency`) o
 * "porcentaje" (agrega "%" al final). Solo aplica a KPI: el resto de posiciones no muestra un
 * único valor formateado de esta forma. La validación real (uno de
 * `dashboard_layout.FORMATOS_KPI_VALIDOS`) vive en el backend, acá solo se elige. */
export function SelectorFormatoKpi({ contexto, valor, onCambiar }) {
  return (
    <Form.Group className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Formato del valor</Form.Label>
      <Form.Select
        size="sm"
        value={valor || 'numero'}
        onChange={(e) => onCambiar(e.target.value)}
        aria-label={`Formato del valor de ${contexto}`}
      >
        <option value="numero">Número</option>
        <option value="moneda">Moneda ($)</option>
        <option value="porcentaje">Porcentaje (%)</option>
      </Form.Select>
    </Form.Group>
  )
}

/** Meta opcional de mínimo y/o máximo (dos números, ambos vacíos por defecto — sin estado local,
 * commit directo en `onChange`, mismo patrón que el input "Días" de `FiltroSlot`) — compartida
 * por el KPI (compara contra su propio valor bruto) y por cada tramo de "Cumplimiento de metas"
 * (`MetasPorTramo`, compara contra el `% acumulado` de ese tramo: `etiquetaSufijo="(%)"` aclara
 * la unidad ahí, ya que en el KPI la unidad es la de su propia columna de valor). Ver
 * `services/generic_charts.py::evaluar_meta` — la validación real (número o vacío) vive en el
 * backend (`dashboard_layout.py::_validar_numero_meta`), acá solo se captura el valor. */
function CamposMeta({ contexto, etiquetaSufijo = '', metaMin, metaMax, onCambiarMin, onCambiarMax }) {
  return (
    <div className="d-flex gap-2 mb-2">
      <Form.Group style={{ flex: 1 }}>
        <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Meta mínima {etiquetaSufijo}</Form.Label>
        <Form.Control
          size="sm" type="number"
          value={metaMin ?? ''}
          onChange={(e) => onCambiarMin(e.target.value === '' ? null : Number(e.target.value))}
          aria-label={`Meta mínima de ${contexto}`}
        />
      </Form.Group>
      <Form.Group style={{ flex: 1 }}>
        <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Meta máxima {etiquetaSufijo}</Form.Label>
        <Form.Control
          size="sm" type="number"
          value={metaMax ?? ''}
          onChange={(e) => onCambiarMax(e.target.value === '' ? null : Number(e.target.value))}
          aria-label={`Meta máxima de ${contexto}`}
        />
      </Form.Group>
    </div>
  )
}

/** Aplica a KPI, Gráfico (una o más columnas) y Tabla: elegir si esta posición lee el archivo
 * actualmente cargado (default) o el histórico de cargas del dashboard — un KPI toma el valor de
 * la carga histórica más reciente incluida; un gráfico/tabla arma una categoría/fila por cada
 * carga incluida en "Histórico de cargas" (`services/historico.py`, mismo cálculo que ya usaba en
 * exclusiva "Tabla 3"). En modo histórico no hay "Categoría"/"Identidad de fila" que elegir (esa
 * posición la ocupa la propia carga) y los selectores de columna de valor se restringen a
 * `columnasHistoricas` — columnas que no se marcaron como "Histórica" al cargar un archivo no
 * tienen datos guardados de cargas pasadas para comparar. Dispersión, tramos de antigüedad,
 * cumplimiento de metas y concentración no lo ofrecen (su cálculo no se traduce a "una carga = un
 * punto"). */
function SelectorFuenteDatos({ contexto, valor, onCambiar }) {
  return (
    <Form.Group className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Fuente de datos</Form.Label>
      <Form.Select
        size="sm"
        value={valor ? 'historico' : 'actual'}
        onChange={(e) => onCambiar(e.target.value === 'historico')}
        aria-label={`Fuente de datos de ${contexto}`}
      >
        <option value="actual">Archivo actual</option>
        <option value="historico">Histórico (una fila/categoría por carga)</option>
      </Form.Select>
    </Form.Group>
  )
}

/** Solo aplica a "Cumplimiento de metas": una meta por cada uno de los 6 tramos ACUMULADOS
 * (`ETIQUETAS_TRAMOS_ACUMULADOS`), en porcentaje — a diferencia de `ColumnasTabla`, la cantidad de
 * filas es siempre 6, fija por diseño del propio cálculo (`generic_charts.py::
 * generar_datos_cumplimiento_tramos`), así que no hay botones de agregar/quitar. `metas` es el
 * array (hasta 6 entradas, alineado por posición) del mapeo — una entrada faltante se trata como
 * "sin meta" para ese tramo. */
function MetasPorTramo({ contexto, metas, onCambiar }) {
  const lista = ETIQUETAS_TRAMOS_ACUMULADOS.map((_, i) => (metas && metas[i]) || {})
  const cambiarEntrada = (i, campo) => (valor) => {
    const nueva = [...lista]
    nueva[i] = { ...nueva[i], [campo]: valor }
    onCambiar(nueva)
  }
  return (
    <div className="mb-2">
      <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Metas por tramo (opcional)</Form.Label>
      {ETIQUETAS_TRAMOS_ACUMULADOS.map((etiqueta, i) => (
        <div key={etiqueta} className="mb-2 p-2 border rounded">
          <div className="mb-1" style={{ fontSize: '0.75rem', fontWeight: 600 }}>{etiqueta}</div>
          <CamposMeta
            contexto={`tramo "${etiqueta}" de ${contexto}`} etiquetaSufijo="(%)"
            metaMin={lista[i].meta_min} metaMax={lista[i].meta_max}
            onCambiarMin={cambiarEntrada(i, 'meta_min')} onCambiarMax={cambiarEntrada(i, 'meta_max')}
          />
        </div>
      ))}
    </div>
  )
}

/** Selectores de columna(s)/tipo de cálculo/tipo de gráfico para una posición, según su
 * `calculo` — sin el filtro (`FiltroSlot`, siempre se agrega aparte, al final). `cambiar(campo)`
 * ya sabe cómo empaquetar cada cambio (mismo contrato que `onActualizarSlot(slotId, cambios)` del
 * builder/mapeo); `cambiarLista(campo)` reemplaza la lista completa de una sola vez (agregar/
 * quitar/reordenar — Tablas, y ahora también Métricas de un `multivalor` no circular). `cargaId`/
 * `aliases` (opcionales) solo alimentan `AvisoColumnaDuplicada` junto al selector de categoría/
 * identidad de fila — sin `cargaId` (p. ej. plantilla base sin archivo real) ese aviso
 * simplemente no aparece. `filasActuales` (opcional, solo Tablas) es el `content.filas` vigente
 * del componente — lo único que le dice a una columna manual (sección 29) cuántos inputs de valor
 * mostrar y cómo etiquetarlos. `columnasHistoricas` (opcional; aplica a KPI/Gráfico/Tabla) son
 * los nombres ya marcados como históricos del dashboard (`historicoService.listarCargasHistoricas`)
 * — restringe el/los selector(es) de columna de valor cuando `propuesta.usa_historico` está
 * activo. `ocultarHistorico` (opcional, default `false`) saca el selector "Fuente de datos" por
 * completo — lo usa `ComponentDataSection.jsx` para Tabla 3, que ya es histórica siempre por su
 * propio mecanismo dedicado (`TablaHistoricaAutomatica.jsx`), sin necesidad de elegir nada acá. */
/**
 * Los campos de mapeo que corresponden a una posición de la plantilla, según su `calculo`.
 *
 * Es un componente y no una función suelta —se usa como `<CamposParaSlot ... />`, no como
 * `camposParaSlot({...})`— porque devuelve JSX y compone una decena de los selectores de este
 * archivo. Como función con nombre en camelCase, la regla `react(only-export-components)` la
 * clasificaba como export "que no es componente" (su heurística es el PascalCase) y hacía que
 * editar este archivo recargara la página entera en vez de intercambiar en caliente. Nombrarla
 * como lo que ya era resuelve eso sin mover nada de su lógica.
 */
export function CamposParaSlot({
  slot, propuesta, columnas, cambiar, cambiarLista, cargaId, aliases, filasActuales,
  columnasHistoricas, ocultarHistorico = false,
}) {
  const contexto = slot.titulo

  if (slot.calculo === 'kpi') {
    const esHistorico = !ocultarHistorico && Boolean(propuesta.usa_historico)
    const opcionesColumna = esHistorico ? columnas.filter((c) => (columnasHistoricas || []).includes(c.nombre)) : columnas
    return (
      <>
        {!ocultarHistorico && (
          <SelectorFuenteDatos contexto={contexto} valor={propuesta.usa_historico} onCambiar={cambiar('usa_historico')} />
        )}
        <SelectorTipoAgregacion contexto={contexto} valor={propuesta.tipo_agregacion} onCambiar={cambiar('tipo_agregacion')} permitirValorCelda={false} />
        <SelectorColumna etiqueta="Columna" contexto={contexto} valor={propuesta.columna_valor} opciones={opcionesColumna} onCambiar={cambiar('columna_valor')} />
        <SelectorFormatoKpi contexto={contexto} valor={propuesta.formato} onCambiar={cambiar('formato')} />
        <CamposMeta
          contexto={contexto} metaMin={propuesta.meta_min} metaMax={propuesta.meta_max}
          onCambiarMin={cambiar('meta_min')} onCambiarMax={cambiar('meta_max')}
        />
      </>
    )
  }
  if (slot.calculo === 'tramos_antiguedad') {
    return (
      <>
        <SelectorColumna
          etiqueta="Columna de fecha" contexto={contexto} valor={propuesta.columna_fecha}
          opciones={columnas.filter((c) => c.tipo === 'fecha')} onCambiar={cambiar('columna_fecha')}
        />
        <SelectorColumna etiqueta="Columna de valor" contexto={contexto} valor={propuesta.columna_valor} opciones={columnas} onCambiar={cambiar('columna_valor')} />
      </>
    )
  }
  if (slot.calculo === 'cumplimiento_metas') {
    return (
      <>
        <SelectorColumna
          etiqueta="Columna de fecha" contexto={contexto} valor={propuesta.columna_fecha}
          opciones={columnas.filter((c) => c.tipo === 'fecha')} onCambiar={cambiar('columna_fecha')}
        />
        <SelectorColumna etiqueta="Columna de valor" contexto={contexto} valor={propuesta.columna_valor} opciones={columnas} onCambiar={cambiar('columna_valor')} />
        <MetasPorTramo contexto={contexto} metas={propuesta.metas} onCambiar={cambiarLista('metas')} />
      </>
    )
  }
  if (slot.calculo === 'concentracion') {
    return (
      <>
        <SelectorColumna etiqueta="Identidad" contexto={contexto} valor={propuesta.columna_id} opciones={columnas} onCambiar={cambiar('columna_id')} />
        <AvisoColumnaDuplicada cargaId={cargaId} aliases={aliases} columna={propuesta.columna_id} />
        <SelectorColumna etiqueta="Columna de valor" contexto={contexto} valor={propuesta.columna_valor} opciones={columnas} onCambiar={cambiar('columna_valor')} />
        <Form.Group className="mb-2">
          <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Cantidad (top-N)</Form.Label>
          <Form.Control
            size="sm" type="number" min="1"
            value={propuesta.top_n ?? ''}
            onChange={(e) => cambiar('top_n')(e.target.value === '' ? null : Number(e.target.value))}
            aria-label={`Cantidad (top-N) de ${contexto}`}
          />
        </Form.Group>
      </>
    )
  }
  if (slot.calculo === 'antiguedad_por_deudor') {
    return (
      <>
        <SelectorColumna etiqueta="Identidad del deudor" contexto={contexto} valor={propuesta.columna_id} opciones={columnas} onCambiar={cambiar('columna_id')} />
        <AvisoColumnaDuplicada cargaId={cargaId} aliases={aliases} columna={propuesta.columna_id} />
        <SelectorColumna
          etiqueta="Columna de fecha" contexto={contexto} valor={propuesta.columna_fecha}
          opciones={columnas.filter((c) => c.tipo === 'fecha')} onCambiar={cambiar('columna_fecha')}
        />
        <SelectorColumna etiqueta="Columna de valor" contexto={contexto} valor={propuesta.columna_valor} opciones={columnas} onCambiar={cambiar('columna_valor')} />
        <Form.Group className="mb-2">
          <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Cantidad de deudores</Form.Label>
          <Form.Control
            size="sm" type="number" min="1" max={MAX_DEUDORES}
            value={propuesta.cuantos ?? ''}
            onChange={(e) => cambiar('cuantos')(e.target.value === '' ? null : Number(e.target.value))}
            aria-label={`Cantidad de deudores de ${contexto}`}
          />
          <Form.Text style={{ fontSize: '0.75rem' }}>
            Hasta {MAX_DEUDORES}: se muestran uno al lado del otro y más deja de ser legible.
          </Form.Text>
        </Form.Group>
      </>
    )
  }
  if (slot.calculo === 'chart') {
    const chartType = tipoVisualizacionElegido(slot, propuesta)
    const esCircular = chartType === 'pastel' || chartType === 'dona'
    const etiquetas = etiquetasPorTipoGrafico(chartType)
    const esHistorico = !ocultarHistorico && Boolean(propuesta.usa_historico)
    const opcionesColumna = esHistorico ? columnas.filter((c) => (columnasHistoricas || []).includes(c.nombre)) : columnas
    return (
      <>
        {!ocultarHistorico && (
          <SelectorFuenteDatos contexto={contexto} valor={propuesta.usa_historico} onCambiar={cambiar('usa_historico')} />
        )}
        <SelectorTipoGrafico contexto={contexto} calculo={slot.calculo} valor={propuesta.chart_type} valorDefecto={slot.tipoVisualizacion} onCambiar={cambiar('chart_type')} />
        {!esHistorico && (
          <>
            <SelectorColumna etiqueta={etiquetas.categoria} contexto={contexto} valor={propuesta.columna_categoria} opciones={columnas} onCambiar={cambiar('columna_categoria')} />
            <AvisoColumnaDuplicada cargaId={cargaId} aliases={aliases} columna={propuesta.columna_categoria} />
          </>
        )}
        {esCircular && <AyudaCircular />}
        <SelectorColumna etiqueta={etiquetas.valor} contexto={contexto} valor={propuesta.columna_valor} opciones={opcionesColumna} onCambiar={cambiar('columna_valor')} />
      </>
    )
  }
  if (slot.calculo === 'multivalor') {
    // El tipo de gráfico decide cuántas columnas de valor hacen falta, no el `calculo` (fijo para
    // toda la posición): pastel/dona solo pueden mostrar una porción por categoría (ver
    // `GenericChartRenderer.jsx::categoricoDesdeMultiserie`), así que ahí alcanza con una sola
    // "Valor" — el resto de tipos compatibles con `multivalor` (barras agrupadas/apiladas, área
    // apilada, líneas múltiples) sí comparan varias métricas a la vez, entre 2 y 3.
    const chartType = tipoVisualizacionElegido(slot, propuesta)
    const esCircular = chartType === 'pastel' || chartType === 'dona'
    const etiquetas = etiquetasPorTipoGrafico(chartType)
    const columnasValor = propuesta.columnas_valor || []
    const esHistorico = !ocultarHistorico && Boolean(propuesta.usa_historico)
    const opcionesColumna = esHistorico ? columnas.filter((c) => (columnasHistoricas || []).includes(c.nombre)) : columnas
    return (
      <>
        {!ocultarHistorico && (
          <SelectorFuenteDatos contexto={contexto} valor={propuesta.usa_historico} onCambiar={cambiar('usa_historico')} />
        )}
        <SelectorTipoGrafico contexto={contexto} calculo={slot.calculo} valor={propuesta.chart_type} valorDefecto={slot.tipoVisualizacion} onCambiar={cambiar('chart_type')} />
        {!esHistorico && (
          <>
            <SelectorColumna etiqueta={etiquetas.categoria} contexto={contexto} valor={propuesta.columna_categoria} opciones={columnas} onCambiar={cambiar('columna_categoria')} />
            <AvisoColumnaDuplicada cargaId={cargaId} aliases={aliases} columna={propuesta.columna_categoria} />
          </>
        )}
        {esCircular ? (
          <>
            <AyudaCircular />
            <SelectorColumna
              etiqueta={etiquetas.valor} contexto={contexto} valor={columnasValor[0]} opciones={opcionesColumna}
              onCambiar={(valor) => cambiarLista('columnas_valor')([valor])}
            />
          </>
        ) : (
          <ColumnasValorMultiples
            contexto={contexto} columnasValor={columnasValor} opciones={opcionesColumna}
            onCambiar={cambiarLista('columnas_valor')}
          />
        )}
      </>
    )
  }
  if (slot.calculo === 'multiserie') {
    // A diferencia de `multivalor`, acá "Serie" no se puede ocultar ni para pastel/dona: el
    // cálculo (`generic_charts.generar_datos_multiserie`) siempre necesita las 3 columnas para
    // poder calcular algo — la etiqueta sí cambia, para explicar que en un gráfico circular las
    // series se combinan dentro de cada porción en vez de dibujarse cada una por separado.
    const chartType = tipoVisualizacionElegido(slot, propuesta)
    const esCircular = chartType === 'pastel' || chartType === 'dona'
    const etiquetas = etiquetasPorTipoGrafico(chartType)
    const esHistorico = !ocultarHistorico && Boolean(propuesta.usa_historico)
    const opcionesColumna = esHistorico ? columnas.filter((c) => (columnasHistoricas || []).includes(c.nombre)) : columnas
    return (
      <>
        {!ocultarHistorico && (
          <SelectorFuenteDatos contexto={contexto} valor={propuesta.usa_historico} onCambiar={cambiar('usa_historico')} />
        )}
        <SelectorTipoGrafico contexto={contexto} calculo={slot.calculo} valor={propuesta.chart_type} valorDefecto={slot.tipoVisualizacion} onCambiar={cambiar('chart_type')} />
        {!esHistorico && (
          <>
            <SelectorColumna etiqueta={etiquetas.categoria} contexto={contexto} valor={propuesta.columna_categoria} opciones={columnas} onCambiar={cambiar('columna_categoria')} />
            <AvisoColumnaDuplicada cargaId={cargaId} aliases={aliases} columna={propuesta.columna_categoria} />
          </>
        )}
        {esCircular && <AyudaCircular />}
        <SelectorColumna etiqueta={etiquetas.serie} contexto={contexto} valor={propuesta.columna_serie} opciones={opcionesColumna} onCambiar={cambiar('columna_serie')} />
        <SelectorColumna etiqueta={etiquetas.valor} contexto={contexto} valor={propuesta.columna_valor} opciones={opcionesColumna} onCambiar={cambiar('columna_valor')} />
      </>
    )
  }
  if (slot.calculo === 'dispersion') {
    return (
      <>
        <SelectorColumna etiqueta="Eje X" contexto={contexto} valor={propuesta.columna_valor} opciones={columnas} onCambiar={cambiar('columna_valor')} />
        <SelectorColumna etiqueta="Eje Y" contexto={contexto} valor={propuesta.columna_valor_y} opciones={columnas} onCambiar={cambiar('columna_valor_y')} />
      </>
    )
  }
  if (slot.calculo === 'tabla') {
    const esHistorico = !ocultarHistorico && Boolean(propuesta.usa_historico)
    const listaColumnas = (propuesta.columnas_valor || []).map(normalizarColumnaValorTabla)
    const setLista = cambiarLista('columnas_valor')
    const base = () => (listaColumnas.length > 0 ? listaColumnas : [normalizarColumnaValorTabla(null)])
    const opcionesColumna = esHistorico
      ? columnas.filter((c) => (columnasHistoricas || []).includes(c.nombre))
      : columnas
    return (
      <>
        {!ocultarHistorico && (
          <SelectorFuenteDatos contexto={contexto} valor={propuesta.usa_historico} onCambiar={cambiar('usa_historico')} />
        )}
        {esHistorico ? (
          (columnasHistoricas || []).length === 0 && (
            <Form.Text className="d-block mb-2" style={{ fontSize: '0.72rem' }}>
              Este dashboard todavía no tiene columnas marcadas como históricas — marcalas en
              "Renombrar columnas" al cargar un archivo.
            </Form.Text>
          )
        ) : (
          <>
            <SelectorColumna etiqueta="Identidad de fila" contexto={contexto} valor={propuesta.columna_id} opciones={columnas} onCambiar={cambiar('columna_id')} />
            <AvisoColumnaDuplicada cargaId={cargaId} aliases={aliases} columna={propuesta.columna_id} />
          </>
        )}
        <ColumnasTabla
          contexto={contexto}
          columnasElegidas={listaColumnas}
          opciones={opcionesColumna}
          filasActuales={filasActuales}
          onCambiarColumna={(i) => (valor) => {
            const nueva = [...base()]
            nueva[i] = { ...nueva[i], columna: valor }
            setLista(nueva)
          }}
          onCambiarAgregacion={(i) => (valor) => {
            const nueva = [...base()]
            nueva[i] = { ...nueva[i], tipo_agregacion: valor }
            setLista(nueva)
          }}
          onCambiarOrigen={(i) => (esManual) => {
            const nueva = [...base()]
            nueva[i] = esManual ? { manual: true, titulo: '', valores: [], total: null } : normalizarColumnaValorTabla(null)
            setLista(nueva)
          }}
          onCambiarTituloManual={(i) => (titulo) => {
            const nueva = [...base()]
            nueva[i] = { ...nueva[i], titulo }
            setLista(nueva)
          }}
          onCambiarValorManual={(i) => (filaIdx, valor) => {
            const nueva = [...base()]
            const valores = [...(nueva[i].valores || [])]
            valores[filaIdx] = valor
            nueva[i] = { ...nueva[i], valores }
            setLista(nueva)
          }}
          onCambiarTotalManual={(i) => (valor) => {
            const nueva = [...base()]
            nueva[i] = { ...nueva[i], total: valor }
            setLista(nueva)
          }}
          onAgregar={() => setLista([...base(), normalizarColumnaValorTabla(null)])}
          onQuitar={(i) => setLista(base().filter((_, idx) => idx !== i))}
          onMover={(i, direccion) => {
            const b = base()
            const destino = direccion === 'arriba' ? i - 1 : i + 1
            if (destino < 0 || destino >= b.length) return
            const nueva = [...b]
            ;[nueva[i], nueva[destino]] = [nueva[destino], nueva[i]]
            setLista(nueva)
          }}
        />
      </>
    )
  }
  return null
}
