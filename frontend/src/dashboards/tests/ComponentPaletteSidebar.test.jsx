import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import ComponentPaletteSidebar from '../components/dashboard-editor/ComponentPaletteSidebar'

// Mismo `activationConstraint` que usa `DashboardAreaPage.jsx`: sin él, el `PointerSensor` por
// defecto de dnd-kit activa un arrastre con cualquier `pointerdown` (sin umbral de movimiento) y
// se come el clic simple antes de que llegue al `onClick` de la tarjeta.
function EnvoltorioDnd({ children }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  return <DndContext sensors={sensors}>{children}</DndContext>
}

function renderPaleta(overrides = {}) {
  const props = { show: true, onHide: vi.fn(), onElegirTipo: vi.fn(), ...overrides }
  const utils = render(
    <EnvoltorioDnd>
      <ComponentPaletteSidebar {...props} />
    </EnvoltorioDnd>,
  )
  return { props, ...utils }
}

describe('ComponentPaletteSidebar', () => {
  it('muestra las 5 tarjetas de tipos de componente', () => {
    renderPaleta()
    expect(screen.getByText('Separador')).toBeInTheDocument()
    expect(screen.getByText('Título')).toBeInTheDocument()
    expect(screen.getByText('Tarjeta KPI')).toBeInTheDocument()
    expect(screen.getByText('Gráfico')).toBeInTheDocument()
    expect(screen.getByText('Tabla')).toBeInTheDocument()
  })

  it('clic en "Separador" invoca onElegirTipo("separador")', async () => {
    const { props } = renderPaleta()
    await userEvent.click(screen.getByText('Separador'))
    expect(props.onElegirTipo).toHaveBeenCalledWith('separador')
  })

  it('clic en "Título" invoca onElegirTipo("titulo")', async () => {
    const { props } = renderPaleta()
    await userEvent.click(screen.getByText('Título'))
    expect(props.onElegirTipo).toHaveBeenCalledWith('titulo')
  })

  it('clic en "Tarjeta KPI" invoca onElegirTipo("kpi")', async () => {
    const { props } = renderPaleta()
    await userEvent.click(screen.getByText('Tarjeta KPI'))
    expect(props.onElegirTipo).toHaveBeenCalledWith('kpi')
  })

  it('clic en "Gráfico" invoca onElegirTipo("chart")', async () => {
    const { props } = renderPaleta()
    await userEvent.click(screen.getByText('Gráfico'))
    expect(props.onElegirTipo).toHaveBeenCalledWith('chart')
  })

  it('clic en "Tabla" invoca onElegirTipo("tabla")', async () => {
    const { props } = renderPaleta()
    await userEvent.click(screen.getByText('Tabla'))
    expect(props.onElegirTipo).toHaveBeenCalledWith('tabla')
  })

  it('con show=false no muestra las tarjetas', () => {
    renderPaleta({ show: false })
    expect(screen.queryByText('Separador')).not.toBeInTheDocument()
  })
})
