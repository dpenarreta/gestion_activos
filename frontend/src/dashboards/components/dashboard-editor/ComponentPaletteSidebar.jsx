import { useDraggable } from '@dnd-kit/core'
import { Offcanvas } from 'react-bootstrap'

/** Cada tarjeta es tanto arrastrable (`useDraggable`, soltar sobre `zona-personal-drop` en
 * `DashboardAreaPage.jsx`) como clicable (alternativa sin arrastre, misma acción resultante) —
 * `id` es el prefijo `paleta-<tipo>` que `DashboardAreaPage.jsx::manejarElegirTipo` reconoce en
 * `onDragEnd`. Los tipos con datos reales (`kpi`/`chart`/`multivalor`/`multiserie`/`tabla`/
 * `dispersion`) abren `AgregarComponentePersonalModal` para elegir columnas antes de crear el
 * componente; `separador`/`titulo` (sin datos) se crean de inmediato. */
const TARJETAS = [
  { tipo: 'separador', etiqueta: 'Separador', descripcion: 'Línea divisoria', icono: 'bi-dash-lg' },
  { tipo: 'titulo', etiqueta: 'Título', descripcion: 'Bloque de encabezado', icono: 'bi-type-h1' },
  { tipo: 'kpi', etiqueta: 'Tarjeta KPI', descripcion: 'Un solo valor', icono: 'bi-123' },
  { tipo: 'chart', etiqueta: 'Gráfico', descripcion: 'Datos por columna', icono: 'bi-bar-chart-line' },
  { tipo: 'tabla', etiqueta: 'Tabla', descripcion: 'Detalle por filas', icono: 'bi-table' },
]

function TarjetaComponente({ tipo, etiqueta, descripcion, icono, onElegirTipo }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `paleta-${tipo}` })
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onElegirTipo(tipo)}
      className="mz-paleta-item"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <span className="mz-row-ic"><i className={`bi ${icono}`} aria-hidden="true"></i></span>
      <span className="mz-row-info">
        <strong>{etiqueta}</strong>
        <span>{descripcion}</span>
      </span>
    </button>
  )
}

/**
 * Panel lateral derecho del editor de dashboard (sección "panel de componentes"): paleta de
 * tipos de componente arrastrables hacia la Zona Personal (`ZonaPersonalDropTarget`, en
 * `DashboardAreaPage.jsx`) — se abre solo al entrar en modo edición. `Offcanvas` con
 * `backdrop={false}` para no bloquear el lienzo mientras está abierto (a diferencia de
 * `ComponentPropertiesPanel`, que sí es un overlay modal clásico).
 */
export default function ComponentPaletteSidebar({ show, onHide, onElegirTipo }) {
  return (
    // Panel lateral de la Matriz (`mz-drawer`): alto completo, a la derecha. La página le deja su
    // ancho libre (`.cartera-app--con-panel`) para que no tape la barra de "Guardar cambios".
    <Offcanvas show={show} onHide={onHide} placement="end" backdrop={false} scroll className="mz-paleta">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>Componentes</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        <p className="mz-desc mt-0 mb-3">
          Arrastrá un componente hasta la Zona Personal, o hacé clic para elegirlo.
        </p>
        {TARJETAS.map((t) => <TarjetaComponente key={t.tipo} {...t} onElegirTipo={onElegirTipo} />)}
      </Offcanvas.Body>
    </Offcanvas>
  )
}
