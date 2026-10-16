import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PlantillaBasePage from '../pages/plantilla/PlantillaBasePage'
import { usePlantillaBaseLayout } from '../hooks/usePlantillaBaseLayout'
import { useAuth } from '../context/AuthContext'
import * as historicoService from '../services/historicoService'

vi.mock('../hooks/usePlantillaBaseLayout')
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../services/historicoService')

const KPI_1 = {
  component_id: 'kpi-1', type: 'kpi', chart_type: '', row: 1, order: 1, width: 3, height: 180,
  is_visible: true, content: { titulo: 'KPI 1', valor: 12458 }, styles: {}, config: {},
}
const GRAFICO_1 = {
  component_id: 'grafico-1', type: 'chart', chart_type: 'barras_verticales', row: 2, order: 5, width: 6, height: 380,
  is_visible: true, content: { titulo: 'Gráfico 1', categorias: ['Ene'], valores: [100] }, styles: {}, config: {},
}
const TABLA_3 = {
  component_id: 'tabla-3', type: 'chart', chart_type: 'tabla', row: 3, order: 13, width: 6, height: 340,
  is_visible: true,
  content: { titulo: 'Tabla 3', columnas: ['Vendedor', 'Ventas'], filas: [['María', 100]] },
  styles: {}, config: {},
  mapeo: { disponible: true, columna_id: 'Vendedor', columnas_valor: [{ columna: 'Ventas', tipo_agregacion: 'suma' }] },
}

function layoutBase(overrides = {}) {
  return {
    layoutGuardado: { version: 1, components: [KPI_1, GRAFICO_1] },
    borrador: [KPI_1, GRAFICO_1],
    modoEdicion: false,
    vistaPrevia: false,
    seleccionado: null,
    cargando: false,
    error: null,
    conflicto: null,
    setSeleccionado: vi.fn(),
    activarEdicion: vi.fn(),
    cancelar: vi.fn(),
    alternarVistaPrevia: vi.fn(),
    actualizarComponente: vi.fn(),
    actualizarContenido: vi.fn(),
    actualizarEstilos: vi.fn(),
    moverComponente: vi.fn(),
    reordenarPorIds: vi.fn(),
    guardar: vi.fn(),
    restablecer: vi.fn(),
    recargarPorConflicto: vi.fn(),
    hayCambiosSinGuardar: vi.fn(() => false),
    ...overrides,
  }
}

function renderPagina(permissions = ['configuracion.editar']) {
  useAuth.mockReturnValue({ user: { permissions } })
  return render(<MemoryRouter><PlantillaBasePage /></MemoryRouter>)
}

describe('PlantillaBasePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra las posiciones de la plantilla base con sus datos de ejemplo', async () => {
    usePlantillaBaseLayout.mockReturnValue(layoutBase())
    renderPagina()

    expect(await screen.findByText('KPI 1')).toBeInTheDocument()
    expect(screen.getByText('Gráfico 1')).toBeInTheDocument()
  })

  it('sin el permiso configuracion.editar, no muestra ningún control de edición', async () => {
    usePlantillaBaseLayout.mockReturnValue(layoutBase())
    renderPagina([])

    await screen.findByText('KPI 1')
    expect(screen.queryByRole('button', { name: 'Editar plantilla base' })).not.toBeInTheDocument()
  })

  it('con el permiso, aparece el botón para entrar en modo edición', async () => {
    usePlantillaBaseLayout.mockReturnValue(layoutBase())
    renderPagina()

    expect(await screen.findByRole('button', { name: 'Editar plantilla base' })).toBeInTheDocument()
  })

  it('en modo edición, "Restablecer al patrón Z" pide confirmación con el texto correcto y llama a layout.restablecer', async () => {
    const restablecer = vi.fn()
    usePlantillaBaseLayout.mockReturnValue(layoutBase({ modoEdicion: true, restablecer }))
    renderPagina()

    await userEvent.click(await screen.findByRole('button', { name: 'Restablecer al patrón Z' }))
    expect(await screen.findByText('Restablecer al patrón Z recomendado')).toBeInTheDocument()
    expect(screen.getByText(/descarta toda la personalización/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }))
    expect(restablecer).toHaveBeenCalled()
  })

  it('guardar cambios llama a layout.guardar', async () => {
    const guardar = vi.fn()
    usePlantillaBaseLayout.mockReturnValue(layoutBase({ modoEdicion: true, guardar }))
    renderPagina()

    await userEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    expect(guardar).toHaveBeenCalled()
  })

  it('seleccionar un gráfico (calculo intercambiable) en modo edición muestra el selector de tipo de gráfico', async () => {
    usePlantillaBaseLayout.mockReturnValue(layoutBase({ modoEdicion: true, seleccionado: 'grafico-1' }))
    renderPagina()

    expect(await screen.findByLabelText(/Tipo de gráfico de/)).toBeInTheDocument()
  })

  it('seleccionar un KPI (calculo no intercambiable) en modo edición no muestra selector de tipo de gráfico ni sección Datos', async () => {
    usePlantillaBaseLayout.mockReturnValue(layoutBase({ modoEdicion: true, seleccionado: 'kpi-1' }))
    renderPagina()

    await screen.findByText('Información general')
    expect(screen.queryByText('Datos')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Tipo de gráfico de/)).not.toBeInTheDocument()
  })

  it('muestra un error si la carga inicial falla', async () => {
    usePlantillaBaseLayout.mockReturnValue(layoutBase({ layoutGuardado: null, error: 'No se pudo cargar la plantilla base.' }))
    renderPagina()

    expect(await screen.findByText('No se pudo cargar la plantilla base.')).toBeInTheDocument()
  })

  describe('Tabla 3 (comparación histórica en vivo)', () => {
    // La plantilla base nunca tiene columnas históricas configuradas (no existe un flujo de carga
    // de archivo para el dashboard_id reservado `plantilla-base-sistema`) — Tabla 3 siempre cae al
    // contenido ficticio, con la etiqueta "Histórica" igual (es una posición histórica por
    // naturaleza, sin importar si en este momento tiene o no con qué comparar).
    it('muestra siempre el contenido ficticio con la etiqueta "Histórica", sin consultar el histórico', async () => {
      usePlantillaBaseLayout.mockReturnValue(layoutBase({ borrador: [KPI_1, TABLA_3] }))
      renderPagina()

      expect(await screen.findByText('Tabla 3')).toBeInTheDocument()
      expect(screen.getAllByText('María').length).toBeGreaterThan(0)
      expect(screen.getByText('Histórica')).toBeInTheDocument()
      expect(historicoService.listarCargasHistoricas).not.toHaveBeenCalled()
    })
  })
})
