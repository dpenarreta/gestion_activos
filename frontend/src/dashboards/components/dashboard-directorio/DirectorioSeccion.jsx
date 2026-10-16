import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import BuscadorDeudor from './BuscadorDeudor'
import { HallazgosClave, Nota, TituloSeccion } from './comunes'
import {
  compacto, conCorte, etiquetaResto, mesYAnio, moneda, porcentaje, ticksRedondos,
} from './formato'

/**
 * Renderers del Dashboard Directorio — réplica de la pestaña "6. Cartera" de un informe financiero.
 *
 * Existen porque los genéricos no saben mostrar lo que ese informe muestra: el monto y el % SOBRE
 * cada barra, la meta al lado del valor con una marca ✓/✗, y dos tarjetas resumen antes del detalle
 * de concentración.
 *
 * IMPORTANTE: consumen el contenido GENÉRICO, el mismo que `calcular_contenido_por_calculo` produce
 * para cualquier dashboard, y derivan la presentación de ahí más el `mapeo` del componente. Esa es
 * la razón de que las secciones sean parametrizables: "Configurar componente → Datos" recalcula por
 * el endpoint de siempre y estos renderers siguen funcionando con el resultado. Si esperaran una
 * forma propia, la primera edición desde la interfaz dejaría la sección en blanco.
 *
 * Qué sección es cada una viene de `config.bloque` —que el editor conserva— y no del contenido, que
 * se reemplaza entero en cada recálculo.
 */

function TarjetaKpi({ componente, componentes }) {
  const { content, styles, config } = componente
  // El "% del portafolio" que el informe muestra bajo tres de los KPI se calcula acá, contra el KPI
  // marcado como base, en vez de guardarse: así sigue siendo correcto después de cambiar cualquier
  // mapeo, sin que el backend tenga que recalcular nada.
  const base = componentes?.find((c) => c.config?.es_base_porcentaje)
  const total = base?.content?.valor
  const participacion = !config?.es_base_porcentaje && total ? (content.valor / total) * 100 : null

  // El informe pone bajo cada KPI el dato que hace falta para leerlo, no la descripción del
  // cálculo: la fecha del corte bajo el total (a qué foto corresponde) y, bajo "vencida +120
  // días", cuánto excede su meta de control. Sin eso, el KPI que el informe señala como el único
  // fuera de meta se lee igual que los demás.
  const metaMaxima = config?.meta_maxima_porcentaje
  const excedeMeta = metaMaxima !== undefined && metaMaxima !== null
    && participacion !== null && participacion > metaMaxima
  const corte = config?.es_base_porcentaje ? mesYAnio(content?.fecha_corte) : null

  const meta = content?.meta
  const tono = meta
    ? (meta.cumple ? 'ok' : 'alerta')
    : (excedeMeta ? 'alerta' : (config?.tono || 'neutro'))

  let subtitulo
  if (meta) subtitulo = meta.cumple ? '✓ Cumple la meta' : `▲ ${meta.motivos.join('; ')}`
  else if (corte) subtitulo = `Corte ${corte}`
  else if (excedeMeta) subtitulo = `▲ ${porcentaje(participacion)} · excede meta máx. ${metaMaxima}%`
  // Dentro de meta se muestra el porcentaje simple: la alerta solo aparece cuando hay algo que
  // señalar, así no compite con el resto de la fila.
  else if (participacion !== null) subtitulo = `${porcentaje(participacion)} del portafolio`
  else subtitulo = content?.descripcion

  return (
    // El filete toma el color de estado del tono (`mz-kpi--ok/bad/info`); si el componente tiene
    // un color principal elegido en "Configurar componente", ese gana — es una preferencia
    // explícita de quien armó el dashboard.
    <div className={`directorio-kpi directorio-kpi--${tono}`} style={{ borderLeftColor: styles?.colorPrincipal }}>
      <div className="directorio-kpi__etiqueta">{content?.titulo}</div>
      <div className="directorio-kpi__valor">{moneda(content?.valor)}</div>
      <div className={`directorio-kpi__sub directorio-kpi__sub--${tono}`}>{subtitulo}</div>
    </div>
  )
}

function GraficoAntiguedad({ componente, componentes, hallazgoIA }) {
  const { content, styles } = componente
  const valores = content?.valores || []
  const total = valores.reduce((suma, valor) => suma + (valor || 0), 0)
  const ticks = ticksRedondos(Math.max(0, ...valores.map((v) => v || 0)))
  const colores = styles?.coloresPorCategoria || {}
  const filas = (content?.categorias || []).map((categoria, i) => ({
    categoria,
    valor: valores[i] ?? 0,
    // El monto y el % van SOBRE la barra: la altura sola no deja leer un tramo de $10K al lado de
    // uno de $2.100K. Se derivan del contenido, así que se actualizan solos al cambiar el mapeo.
    etiqueta: `${compacto(valores[i] ?? 0)} (${porcentaje(total ? ((valores[i] ?? 0) / total) * 100 : 0)})`,
    // Sin color elegido para el tramo, la serie de la paleta (que el modo oscuro reteñe sola).
    color: colores[categoria] || `var(--series-${(i % 8) + 1})`,
  }))

  return (
    <div className="chart-panel directorio-seccion">
      <TituloSeccion>{conCorte(content?.titulo, componentes)}</TituloSeccion>
      <ResponsiveContainer width="100%" height={300}>
        {/* `top: 28` deja aire para la etiqueta de la barra más alta; sin eso recharts la recorta. */}
        <BarChart data={filas} margin={{ left: 8, right: 16, top: 28, bottom: 8 }}>
          <CartesianGrid horizontal vertical={false} stroke="var(--border)" />
          <XAxis dataKey="categoria" interval={0} tick={{ fontSize: 12 }} />
          {/* `domain` acompaña a `ticks`: sin fijar el tope, recharts dibuja los cortes pedidos
              pero recorta el eje en el máximo real y el último queda fuera del área. */}
          <YAxis
            width={76}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => compacto(v)}
            ticks={ticks}
            domain={ticks ? [0, ticks[ticks.length - 1]] : undefined}
          />
          <Tooltip formatter={(valor) => moneda(valor)} />
          <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={64}>
            <LabelList dataKey="etiqueta" position="top" className="directorio-barra__etiqueta" />
            {filas.map((fila) => <Cell key={fila.categoria} fill={fila.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <HallazgosClave texto={hallazgoIA || content?.descripcion} />
    </div>
  )
}

/** `≥ 50%` / `≤ 5%` a partir de la meta guardada en el mapeo; `—` si esa fila no tiene meta. */
function etiquetaMeta(meta) {
  if (!meta) return '—'
  if (meta.meta_min !== undefined && meta.meta_min !== null) return `≥ ${meta.meta_min}%`
  if (meta.meta_max !== undefined && meta.meta_max !== null) return `≤ ${meta.meta_max}%`
  return '—'
}

function TablaCumplimiento({ componente, hallazgoIA }) {
  const { content, mapeo } = componente
  const metas = mapeo?.metas || []
  const filas = content?.filas || []

  return (
    <div className="chart-panel directorio-seccion">
      <TituloSeccion>{content?.titulo}</TituloSeccion>
      <div className="directorio-tabla-ancho">
      <table className="directorio-tabla">
        <thead>
          <tr>
            <th>EDAD DE CARTERA</th>
            <th className="text-end">META (MÍN./MÁX.)</th>
            <th className="text-end">VALOR ACUMULADO</th>
            <th className="text-end">RESULTADO</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(([tramo, valor, pct, resultado], i) => {
            const sinMeta = resultado === 'Sin meta'
            const cumple = resultado === 'Cumple'
            return (
              <tr key={tramo} className={i === filas.length - 1 ? 'directorio-tabla__fila--cierre' : undefined}>
                <td>{tramo}</td>
                <td className="text-end directorio-tabla__meta">{etiquetaMeta(metas[i])}</td>
                <td className="text-end">{moneda(valor)}</td>
                <td className="text-end">
                  {/* Con meta, el resultado va como píldora de estado de la Matriz. */}
                  {sinMeta ? porcentaje(pct) : (
                    <span className={`mz-pill directorio-pill ${cumple ? 'mz-pill--ok' : 'mz-pill--bad'}`}>
                      {porcentaje(pct)} {cumple ? '✓' : '✗'}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      <Nota texto={hallazgoIA || content?.descripcion} />
    </div>
  )
}

function SeccionConcentracion({ componente, hallazgoIA }) {
  const { content, mapeo } = componente
  const filas = content?.filas || []
  // La última fila que devuelve el cálculo es siempre el "Resto (N)": el informe la muestra también
  // aparte, como contrapeso del Top-N.
  const principales = filas.slice(0, -1)
  const resto = filas[filas.length - 1]
  const topN = mapeo?.top_n ?? principales.length
  const saldoTop = principales.reduce((suma, fila) => suma + (fila[1] || 0), 0)
  const pctTop = principales.reduce((suma, fila) => suma + (fila[2] || 0), 0)
  // El título trae `{n}` como marcador del Top-N vigente: el número vive en un solo lugar (el
  // mapeo) y no puede quedar diciendo "TOP 16" después de cambiarlo a 5. Un título editado a mano
  // sin el marcador se muestra tal cual.
  const titulo = String(content?.titulo ?? '').replace('{n}', topN)

  return (
    <div className="chart-panel directorio-seccion">
      <TituloSeccion>{titulo}</TituloSeccion>
      <div className="directorio-resumen">
        <div className="directorio-kpi directorio-kpi--interno directorio-kpi--top">
          <div className="directorio-kpi__etiqueta">TOP {topN} CLIENTES</div>
          <div className="directorio-kpi__valor">{moneda(saldoTop)}</div>
          <div className="directorio-kpi__sub">{porcentaje(pctTop, 2)} del saldo total</div>
        </div>
        {resto && (
          <div className="directorio-kpi directorio-kpi--interno directorio-kpi--resto">
            <div className="directorio-kpi__etiqueta">{etiquetaResto(resto[0], mapeo?.columna_id).toUpperCase()}</div>
            <div className="directorio-kpi__valor">{moneda(resto[1])}</div>
            <div className="directorio-kpi__sub">{porcentaje(resto[2], 2)} del saldo total</div>
          </div>
        )}
      </div>
      <div className="directorio-tabla-ancho">
      <table className="directorio-tabla">
        <thead>
          <tr>
            {/* Los dos primeros encabezados siguen a las columnas elegidas en el mapeo (son
                parametrizables); los de porcentaje llevan el nombre del informe, que dice qué
                miden: "% sobre total" y "% acumulado (calculado)". */}
            <th>{String(content?.columnas?.[0] ?? '').toUpperCase()}</th>
            <th className="text-end">{String(content?.columnas?.[1] ?? '').toUpperCase()}</th>
            <th className="text-end">% SOBRE TOTAL</th>
            <th className="text-end">% ACUMULADO (CALCULADO)</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            // eslint-disable-next-line react/no-array-index-key -- dos clientes pueden compartir nombre
            <tr key={i} className={i === filas.length - 1 ? 'directorio-tabla__fila--resto' : undefined}>
              <td>{i === filas.length - 1 ? etiquetaResto(fila[0], mapeo?.columna_id) : fila[0]}</td>
              <td className="text-end">{moneda(fila[1])}</td>
              <td className="text-end">{porcentaje(fila[2], 2)}</td>
              <td className="text-end">{porcentaje(fila[3], 2)}</td>
            </tr>
          ))}
          {content?.total && (
            <tr className="directorio-tabla__fila--total">
              <td>TOTAL CARTERA</td>
              <td className="text-end">{moneda(content.total[1])}</td>
              <td className="text-end">{porcentaje(content.total[2], 2)}</td>
              <td className="text-end">—</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <HallazgosClave texto={hallazgoIA || content?.descripcion} />
    </div>
  )
}

function SeccionDeudores({ componente, componentes, hallazgoIA }) {
  const { content, mapeo } = componente
  const deudores = content?.deudores || []
  // `{n}` es la cantidad de deudores del mapeo, igual que el Top-N de concentración: el número
  // vive en un solo lugar y el título no puede quedar diciendo "DOS" después de cambiarlo a tres.
  const titulo = conCorte(String(content?.titulo ?? '').replace('{n}', mapeo?.cuantos ?? deudores.length), componentes)

  return (
    <div className="chart-panel directorio-seccion">
      <TituloSeccion>{titulo}</TituloSeccion>
      <div className="directorio-deudores">
        {deudores.map((deudor) => (
          <div key={deudor.nombre} className="directorio-deudor">
            <div className="directorio-deudor__titulo">
              {deudor.nombre} — {moneda(deudor.total)} ({porcentaje(deudor.porcentaje_cartera, 2)} de la cartera total)
            </div>
            <div className="directorio-tabla-ancho">
            <table className="directorio-tabla directorio-tabla--compacta">
              <thead>
                <tr>
                  {(deudor.columnas || []).map((columna, i) => (
                    // eslint-disable-next-line react/no-array-index-key -- encabezados de la sección
                    <th key={i} className={i === 0 ? undefined : 'text-end'}>{String(columna).toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(deudor.filas || []).map(([tramo, saldo, pct]) => (
                  <tr
                    key={tramo}
                    // El tramo más pesado es lo que distingue una mora crónica de una reciente.
                    className={tramo === deudor.tramo_mayor ? 'directorio-tabla__fila--destacada' : undefined}
                  >
                    <td>{tramo}</td>
                    <td className="text-end">{moneda(saldo)}</td>
                    <td className="text-end">{porcentaje(pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ))}
      </div>
      <Nota texto={hallazgoIA || content?.descripcion} />
    </div>
  )
}

const POR_BLOQUE = {
  kpi: TarjetaKpi,
  'consulta-deudor': BuscadorDeudor,
  antiguedad: GraficoAntiguedad,
  cumplimiento: TablaCumplimiento,
  concentracion: SeccionConcentracion,
  deudores: SeccionDeudores,
}

export default function DirectorioSeccion({ componente, componentes, hallazgoIA, dashboardId }) {
  const Componente = POR_BLOQUE[componente?.config?.bloque]
  if (!Componente || !componente?.content) return null
  return (
    <Componente
      componente={componente}
      componentes={componentes}
      hallazgoIA={hallazgoIA}
      dashboardId={dashboardId}
    />
  )
}
