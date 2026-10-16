import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DashboardHistoricoPage from '../pages/dashboards/DashboardHistoricoPage'
import * as historicoService from '../services/historicoService'
import * as carteraService from '../services/carteraService'

vi.mock('../services/historicoService')
vi.mock('../services/carteraService')

const CARGAS = [
  { carga_id: 'carga-1', nombre_original: 'enero.xlsx', fecha_carga: '2026-01-15T10:00:00', fecha_corte: '2026-01-31', total_filas: 10, incluir_en_historico: true },
  { carga_id: 'carga-2', nombre_original: 'febrero.xlsx', fecha_carga: '2026-02-15T10:00:00', fecha_corte: null, total_filas: 12, incluir_en_historico: true },
]

function renderPagina() {
  return render(
    <MemoryRouter initialEntries={['/admin/dashboards/finanzas/historico']}>
      <Routes>
        <Route path="/admin/dashboards/:dashboardId/historico" element={<DashboardHistoricoPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardHistoricoPage', () => {
  it('sin cargas históricas, muestra el estado vacío', async () => {
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: [], columnas_disponibles: [] })
    renderPagina()
    expect(await screen.findByText(/Todavía no hay cargas históricas/)).toBeInTheDocument()
  })

  it('si falla la carga inicial, muestra un error', async () => {
    historicoService.listarCargasHistoricas.mockRejectedValue(new Error('falló'))
    renderPagina()
    expect(await screen.findByText('No se pudo cargar el histórico de este dashboard.')).toBeInTheDocument()
  })

  it('lista las cargas con sus checkboxes, reflejando el estado de incluir_en_historico', async () => {
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [CARGAS[0], { ...CARGAS[1], incluir_en_historico: false }], columnas_disponibles: ['Ventas'],
    })
    renderPagina()

    expect(await screen.findByText('enero.xlsx')).toBeInTheDocument()
    expect(screen.getByText('febrero.xlsx')).toBeInTheDocument()
    expect(screen.getByLabelText('Incluir enero.xlsx')).toBeChecked()
    expect(screen.getByLabelText('Incluir febrero.xlsx')).not.toBeChecked()
  })

  it('destildar una carga persiste de inmediato y actualiza el checkbox sin esperar a recargar la lista', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    historicoService.establecerCargaIncluida.mockResolvedValue({ carga_id: 'carga-2', incluir_en_historico: false })
    renderPagina()
    await screen.findByText('enero.xlsx')

    await usuario.click(screen.getByLabelText('Incluir febrero.xlsx'))

    expect(historicoService.establecerCargaIncluida).toHaveBeenCalledWith('carga-2', false)
    expect(screen.getByLabelText('Incluir febrero.xlsx')).not.toBeChecked()
    expect(screen.getByLabelText('Incluir enero.xlsx')).toBeChecked()
  })

  it('tildar de nuevo una carga deshabilitada la vuelve a incluir', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [CARGAS[0], { ...CARGAS[1], incluir_en_historico: false }], columnas_disponibles: ['Ventas'],
    })
    historicoService.establecerCargaIncluida.mockResolvedValue({ carga_id: 'carga-2', incluir_en_historico: true })
    renderPagina()
    await screen.findByText('febrero.xlsx')

    await usuario.click(screen.getByLabelText('Incluir febrero.xlsx'))

    expect(historicoService.establecerCargaIncluida).toHaveBeenCalledWith('carga-2', true)
    expect(screen.getByLabelText('Incluir febrero.xlsx')).toBeChecked()
  })

  it('si falla al persistir, revierte el checkbox y muestra un error', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    historicoService.establecerCargaIncluida.mockRejectedValue(new Error('falló'))
    renderPagina()
    await screen.findByText('enero.xlsx')

    await usuario.click(screen.getByLabelText('Incluir febrero.xlsx'))

    await waitFor(() => expect(screen.getByLabelText('Incluir febrero.xlsx')).toBeChecked())
    expect(await screen.findByText('No se pudo actualizar la carga. Intentá de nuevo.')).toBeInTheDocument()
  })

  it('"Generar tabla histórica" ya no manda una selección de cargas: usa el criterio por defecto del backend (las habilitadas)', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    historicoService.calcularTablaHistorica.mockResolvedValue({ columnas: ['Archivo', 'Ventas'], filas: [['enero.xlsx', 100]] })
    renderPagina()
    await screen.findByText('enero.xlsx')

    await usuario.selectOptions(screen.getByLabelText('Columna 1 de histórico'), 'Ventas')
    await usuario.click(screen.getByRole('button', { name: 'Generar tabla histórica' }))

    await waitFor(() => expect(historicoService.calcularTablaHistorica).toHaveBeenCalledWith(
      'finanzas', [{ columna: 'Ventas', tipo_agregacion: 'suma' }],
    ))
  })

  it('sin elegir ninguna columna, "Generar tabla histórica" muestra un error de validación', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    renderPagina()
    await screen.findByText('enero.xlsx')

    await usuario.click(screen.getByRole('button', { name: 'Generar tabla histórica' }))

    expect(await screen.findByText('Elegí al menos una columna para comparar.')).toBeInTheDocument()
    expect(historicoService.calcularTablaHistorica).not.toHaveBeenCalled()
  })

  it('"+ Agregar columna" agrega otra fila de selector, cada una con su propio tipo de cálculo', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas', 'Costo'] })
    renderPagina()
    await screen.findByText('enero.xlsx')

    await usuario.click(screen.getByRole('button', { name: '+ Agregar columna' }))

    expect(screen.getByLabelText('Columna 1 de histórico')).toBeInTheDocument()
    expect(screen.getByLabelText('Columna 2 de histórico')).toBeInTheDocument()
  })

  it('genera la tabla histórica y la muestra con GenericDataTable', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    historicoService.calcularTablaHistorica.mockResolvedValue({
      columnas: ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'Ventas'],
      filas: [['enero.xlsx', 'ana', '2026-01-15', '2026-01-31', 100], ['febrero.xlsx', 'ana', '2026-02-15', '', 200]],
    })
    renderPagina()
    await screen.findByText('enero.xlsx')

    await usuario.selectOptions(screen.getByLabelText('Columna 1 de histórico'), 'Ventas')
    await usuario.click(screen.getByRole('button', { name: 'Generar tabla histórica' }))

    await waitFor(() => expect(historicoService.calcularTablaHistorica).toHaveBeenCalledWith(
      'finanzas', [{ columna: 'Ventas', tipo_agregacion: 'suma' }],
    ))
    expect(await screen.findByText('Tabla histórica')).toBeInTheDocument()
    // La tabla generada (dentro de GenericDataTable) es una fila más, aparte de la que ya
    // muestra el nombre del archivo en la lista de cargas de arriba.
    expect(screen.getAllByText('febrero.xlsx').length).toBeGreaterThan(1)
    expect(screen.queryByText('Hallazgos clave', { exact: false })).not.toBeInTheDocument()
  })

  it('"Eliminar" pide confirmación y, al confirmar, borra la carga y recarga la lista', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    carteraService.eliminarArchivo.mockResolvedValue({})
    renderPagina()
    await screen.findByText('enero.xlsx')

    const filaEnero = screen.getByText('enero.xlsx').closest('tr')
    await usuario.click(within(filaEnero).getByRole('button', { name: 'Eliminar' }))

    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/Se eliminará "enero\.xlsx"/)).toBeInTheDocument()
    await usuario.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(carteraService.eliminarArchivo).toHaveBeenCalledWith('carga-1'))
    await waitFor(() => expect(historicoService.listarCargasHistoricas).toHaveBeenCalledTimes(2))
  })

  it('"Ver archivo" abre un modal con todas las columnas y filas del archivo', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    historicoService.obtenerArchivoCarga.mockResolvedValue({
      columnas: ['Producto', 'Ventas'],
      filas: [['Producto A', 100], ['Producto B', 200]],
    })
    renderPagina()
    await screen.findByText('enero.xlsx')

    const filaEnero = screen.getByText('enero.xlsx').closest('tr')
    await usuario.click(within(filaEnero).getByRole('button', { name: 'Ver archivo' }))

    expect(historicoService.obtenerArchivoCarga).toHaveBeenCalledWith('carga-1')
    const dialogo = await screen.findByRole('dialog')
    // "enero.xlsx" aparece dos veces dentro del modal: el título del modal y, dentro de
    // GenericDataTable, el título de la tarjeta.
    expect(within(dialogo).getAllByText('enero.xlsx').length).toBeGreaterThanOrEqual(2)
    expect(await within(dialogo).findByText('Producto A')).toBeInTheDocument()
    expect(within(dialogo).getByText('Producto B')).toBeInTheDocument()
  })

  it('"Ver archivo" no muestra el párrafo de "Hallazgos clave" (solo la previsualización cruda)', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    historicoService.obtenerArchivoCarga.mockResolvedValue({
      columnas: ['Producto', 'Ventas'],
      filas: [['Producto A', 100], ['Producto B', 200]],
    })
    renderPagina()
    await screen.findByText('enero.xlsx')

    const filaEnero = screen.getByText('enero.xlsx').closest('tr')
    await usuario.click(within(filaEnero).getByRole('button', { name: 'Ver archivo' }))

    const dialogo = await screen.findByRole('dialog')
    await within(dialogo).findByText('Producto A')
    expect(within(dialogo).queryByText('Hallazgos clave', { exact: false })).not.toBeInTheDocument()
  })

  it('"Ver archivo" muestra un error si falla la carga', async () => {
    const usuario = userEvent.setup()
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: CARGAS, columnas_disponibles: ['Ventas'] })
    historicoService.obtenerArchivoCarga.mockRejectedValue(new Error('falló'))
    renderPagina()
    await screen.findByText('enero.xlsx')

    const filaEnero = screen.getByText('enero.xlsx').closest('tr')
    await usuario.click(within(filaEnero).getByRole('button', { name: 'Ver archivo' }))

    const dialogo = await screen.findByRole('dialog')
    expect(await within(dialogo).findByText('No se pudo cargar el archivo.')).toBeInTheDocument()
  })
})
