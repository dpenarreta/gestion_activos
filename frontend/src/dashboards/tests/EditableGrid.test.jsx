import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditableGrid from '../components/dashboard-editor/EditableGrid'

function componente(id, overrides = {}) {
  return {
    component_id: id, type: 'kpi', chart_type: '', row: 1, order: 1, width: 3, height: 180,
    is_visible: true, content: {}, styles: {}, config: {}, mapeo: {},
    ...overrides,
  }
}

function registroPara(componentes) {
  return Object.fromEntries(componentes.map((c) => [c.component_id, { render: () => <div>{c.component_id}</div> }]))
}

function renderGrid(componentes, overrides = {}) {
  const props = {
    componentes,
    registro: registroPara(componentes),
    modoEdicion: true,
    vistaPrevia: false,
    seleccionado: null,
    onSeleccionar: vi.fn(),
    onMover: vi.fn(),
    onOcultar: vi.fn(),
    onMostrar: vi.fn(),
    onEliminar: vi.fn(),
    onReordenar: vi.fn(),
    permiteEstilo: true,
    permiteEliminar: true,
    ...overrides,
  }
  return { props, ...render(<EditableGrid {...props} />) }
}

describe('EditableGrid — Zona Personal', () => {
  it('sin componentes con config.zona=personal, no aparece el recuadro "Zona personal"', () => {
    renderGrid([componente('kpi-1', { order: 1 })])
    expect(screen.queryByRole('list', { name: 'Zona personal' })).not.toBeInTheDocument()
  })

  it('con 1+ componentes personales, aparece un recuadro "Zona personal" al final', () => {
    renderGrid([
      componente('kpi-1', { order: 1 }),
      componente('mi-kpi', { order: 2, config: { zona: 'personal' } }),
    ])
    const zonaPersonal = screen.getByRole('list', { name: 'Zona personal' })
    expect(zonaPersonal).toBeInTheDocument()
    expect(zonaPersonal.textContent).toContain('mi-kpi')
    expect(zonaPersonal.textContent).not.toContain('kpi-1')
  })

  it('la Zona Personal aparece después de las zonas de la plantilla fija', () => {
    renderGrid([
      componente('mi-kpi', { order: 2, config: { zona: 'personal' } }),
      componente('kpi-1', { order: 1 }),
    ])
    const listas = screen.getAllByRole('list')
    const etiquetas = listas.map((l) => l.getAttribute('aria-label'))
    expect(etiquetas.indexOf('Zona personal')).toBeGreaterThan(etiquetas.indexOf('Zona de KPIs'))
  })

  it('un componente sin zona conocida y sin marca personal sigue cayendo en "Otros componentes", separado de la Zona Personal', () => {
    renderGrid([
      componente('suelto', { order: 1 }),
      componente('mi-kpi', { order: 2, config: { zona: 'personal' } }),
    ])
    const otros = screen.getByRole('list', { name: 'Otros componentes' })
    expect(otros.textContent).toContain('suelto')
    expect(otros.textContent).not.toContain('mi-kpi')
    expect(screen.getByRole('list', { name: 'Zona personal' }).textContent).toContain('mi-kpi')
  })

  it('en vista normal (fuera de edición), un componente personal se renderiza sin ningún recuadro "Zona personal"', () => {
    renderGrid(
      [componente('kpi-1', { order: 1 }), componente('mi-kpi', { order: 2, config: { zona: 'personal' } })],
      { modoEdicion: false },
    )
    expect(screen.queryByRole('list', { name: 'Zona personal' })).not.toBeInTheDocument()
    expect(screen.getByText('mi-kpi')).toBeInTheDocument()
  })
})


describe('EditableGrid — el ancho de cada panel es adaptable', () => {
  /**
   * El ancho en doceavos viaja como variable CSS y no como `flex`/`max-width` inline. La
   * diferencia no es de estilo: un estilo inline le gana a cualquier media query, y era lo que
   * impedía apilar los paneles en pantallas angostas. En un monitor de 1024, dos paneles de media
   * página quedaban en 326px cada uno y la tabla de cumplimiento de metas (470px) se salía de su
   * tarjeta.
   */

  function celdas(contenedor) {
    return [...contenedor.querySelectorAll('.dashboard-grid__celda')]
  }

  it('declara el ancho como variable CSS, no como flex inline', () => {
    const { container } = renderGrid([componente('kpi-1', { width: 3 })], { modoEdicion: false })
    const celda = celdas(container)[0]

    expect(celda.style.getPropertyValue('--ancho-panel')).toBe('25%')
    // Si volviera a fijarse acá, la media query no podría cambiarlo.
    expect(celda.style.flex).toBe('')
    expect(celda.style.maxWidth).toBe('')
  })

  it('expone el ancho en doceavos para que el CSS decida cuántos entran por fila', () => {
    const { container } = renderGrid([
      componente('kpi-1', { width: 3 }),
      componente('grafico-1', { width: 6, order: 2 }),
      componente('tabla-1', { width: 12, order: 3 }),
    ], { modoEdicion: false })

    expect(celdas(container).map((c) => c.dataset.ancho)).toEqual(['3', '6', '12'])
  })

  it('en modo edición vale lo mismo', () => {
    const { container } = renderGrid([componente('kpi-1', { width: 6 })])
    const celda = celdas(container)[0]

    expect(celda.style.getPropertyValue('--ancho-panel')).toBe('50%')
    expect(celda.dataset.ancho).toBe('6')
    expect(celda.style.flex).toBe('')
  })

  /**
   * Los cortes de `dashboard.css` son `@container`, así que miden el grid y no la ventana. Eso
   * solo funciona si el contenedor lleva la clase que declara `container-type`: sin ella las
   * reglas no aplican nunca y todos los paneles se quedan en el ancho de escritorio.
   */
  it('el contenedor se declara como contenedor de consulta', () => {
    for (const modoEdicion of [false, true]) {
      const { container } = renderGrid([componente('kpi-1', { width: 3 })], { modoEdicion })
      const celda = celdas(container)[0]

      expect(celda.closest('.dashboard-grid'), `modoEdicion=${modoEdicion}`).not.toBeNull()
    }
  })
})

// Auditoría UX/UI, fase 3, 28/10/2026: mover con los botones anuncia la nueva posición.
describe('EditableGrid — anuncio al mover', () => {
  it('después de mover, una región aria-live dice en qué posición quedó el componente', async () => {
    const antes = [
      componente('suelto-a', { order: 1, content: { titulo: 'Ventas' } }),
      componente('suelto-b', { order: 2, content: { titulo: 'Cobros' } }),
    ]
    const { props, rerender } = renderGrid(antes)
    // dnd-kit tiene su propia región de anuncios (también role=status); esta es la del movimiento.
    const region = screen.getByTestId('anuncio-movimiento')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()

    await userEvent.click(screen.getByRole('button', { name: 'Mover "Ventas" después' }))
    expect(props.onMover).toHaveBeenCalledWith('suelto-a', 'abajo')

    // El padre aplica el movimiento y vuelve a dibujar la rejilla con el orden nuevo.
    const despues = [{ ...antes[0], order: 2 }, { ...antes[1], order: 1 }]
    rerender(<EditableGrid {...props} componentes={despues} />)
    expect(screen.getByTestId('anuncio-movimiento')).toHaveTextContent('"Ventas" quedó en la posición 2 de 2.')
  })
})
