import { formatCurrency, formatNumber, formatPercent } from '../../utils/format'
import HallazgosClaveCard from './HallazgosClaveCard'

const TRAZOS_ICONO = {
  persona: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  dolar: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  carrito: <><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>,
  grafico: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
}

function IconoKpi({ tipo }) {
  if (!TRAZOS_ICONO[tipo]) return null
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {TRAZOS_ICONO[tipo]}
    </svg>
  )
}

function formatearValor(valor, formato) {
  if (formato === 'moneda') return formatCurrency(valor)
  if (formato === 'porcentaje') return formatPercent(valor)
  return formatNumber(valor)
}

/** Estado de cumplimiento de la meta opcional de un KPI (`data.meta`, ver
 * `services/generic_charts.py::evaluar_meta` — `{meta_min, meta_max, cumple, motivos}`). `null`
 * si el KPI no tiene meta configurada (comportamiento actual sin cambios). Reusa
 * `.kpi-card__sub`/las mismas variables de color que ya usa el bloque de `tendencia` — mismo
 * lenguaje visual, sin agregar nada a `dashboard.css`. */
function MetaEstado({ meta }) {
  if (!meta) return null
  return (
    <div className="kpi-card__sub" style={{ color: meta.cumple ? 'var(--status-good)' : 'var(--status-critical)' }}>
      {meta.cumple ? '✓ Cumple la meta' : `✗ No cumple la meta (${meta.motivos.join('; ')})`}
    </div>
  )
}

/**
 * Renderiza un componente type=kpi — `data` es `component.content` tal cual viene del layout:
 * `{titulo, descripcion, valor, formato, tendencia}` (ver `services/plantilla.py`). `formato`
 * decide cómo se muestra el valor ("moneda"/"porcentaje"/"numero"). `config.icono` (una de las
 * 13 posiciones fijas de la plantilla) dibuja un círculo de ícono junto al título.
 * `data.tendencia` (`{valor, texto}`) dibuja la línea "↑/↓ x% <texto>" — solo está presente en
 * los KPI con dato ficticio (inventar una tendencia para datos reales sin una dimensión de
 * tiempo real sería engañoso), así que un KPI con datos reales muestra su descripción en su
 * lugar, igual que el resto de gráficas.
 */
export default function GenericKpiCard({ data, override, config, hallazgoIA }) {
  if (!data) return null
  const colorPrincipal = override?.colores?.colorPrincipal
  const colorIcono = colorPrincipal || '#2a78d6'
  const icono = config?.icono
  const tendencia = data.tendencia
  const titulo = override?.titulo || data.titulo

  return (
    <div className="kpi-card" style={colorPrincipal ? { borderLeft: `4px solid ${colorPrincipal}` } : undefined}>
      {icono ? (
        // Como `mz-kpi-top` de la Matriz: etiqueta a la izquierda e ícono en un cuadro a la derecha.
        <div className="mz-kpi-top align-items-start gap-2">
          <div className="kpi-card__label mb-0">{titulo}</div>
          <div className="mz-kpi-icon" style={{ background: `${colorIcono}22`, color: colorIcono, flexShrink: 0 }}>
            <IconoKpi tipo={icono} />
          </div>
        </div>
      ) : (
        <div className="kpi-card__label">{titulo}</div>
      )}
      <div className="kpi-card__value">{formatearValor(data.valor, data.formato)}</div>
      <MetaEstado meta={data.meta} />
      {tendencia ? (
        <div className="kpi-card__sub" style={{ color: tendencia.valor >= 0 ? 'var(--status-good)' : 'var(--status-critical)' }}>
          {tendencia.valor >= 0 ? '↑' : '↓'} {Math.abs(tendencia.valor)}% {tendencia.texto}
        </div>
      ) : (
        (override?.descripcion || data.descripcion) && (
          <div className="kpi-card__sub">{override?.descripcion || data.descripcion}</div>
        )
      )}
      <HallazgosClaveCard variante="kpi" datos={data} textoIA={hallazgoIA} />
    </div>
  )
}
