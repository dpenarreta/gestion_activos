import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TablaHistoricaAutomatica from '../components/dashboard-generic/TablaHistoricaAutomatica'
import * as historicoService from '../services/historicoService'

vi.mock('../services/historicoService')

beforeEach(() => vi.clearAllMocks())

describe('TablaHistoricaAutomatica', () => {
  it('sin columnas de valor, muestra el contenido normal directamente, sin consultar el histórico', () => {
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas" columnasValor={[]} contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    expect(screen.getByText('Contenido normal')).toBeInTheDocument()
    expect(historicoService.listarCargasHistoricas).not.toHaveBeenCalled()
  })

  it('con columnas de valor sin elegir aún (columna null), tampoco consulta el histórico', () => {
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas" columnasValor={[{ columna: null, tipo_agregacion: 'suma' }]}
        contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    expect(screen.getByText('Contenido normal')).toBeInTheDocument()
    expect(historicoService.listarCargasHistoricas).not.toHaveBeenCalled()
  })

  it('mientras consulta el histórico, muestra un spinner', () => {
    historicoService.listarCargasHistoricas.mockReturnValue(new Promise(() => {})) // nunca resuelve
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas" columnasValor={[{ columna: 'Ventas', tipo_agregacion: 'suma' }]}
        contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Contenido normal')).not.toBeInTheDocument()
  })

  it('sin cargas históricas, cae al contenido normal', async () => {
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: [], columnas_disponibles: [] })
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas" columnasValor={[{ columna: 'Ventas', tipo_agregacion: 'suma' }]}
        contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    expect(await screen.findByText('Contenido normal')).toBeInTheDocument()
    expect(historicoService.calcularTablaHistorica).not.toHaveBeenCalled()
  })

  it('con cargas históricas pero ninguna habilitada, cae al contenido normal en vez de mostrar una tabla vacía', async () => {
    // `listarCargasHistoricas` sigue devolviendo cargas deshabilitadas (las necesita "Histórico de
    // cargas" para poder rehabilitarlas), así que `calcularTablaHistorica` igual se llama — pero
    // el backend filtra las deshabilitadas por defecto y devuelve `filas: []`.
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [{ carga_id: 'c1', nombre_original: 'enero.xlsx', incluir_en_historico: false }],
      columnas_disponibles: ['Ventas'],
    })
    historicoService.calcularTablaHistorica.mockResolvedValue({
      columnas: ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'Ventas'], filas: [],
    })
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas" columnasValor={[{ columna: 'Ventas', tipo_agregacion: 'suma' }]}
        contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    expect(await screen.findByText('Contenido normal')).toBeInTheDocument()
    expect(screen.queryByText('Histórica')).not.toBeInTheDocument()
  })

  it('con cargas históricas, pide y muestra la tabla comparativa (no el contenido normal)', async () => {
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [{ carga_id: 'c1', nombre_original: 'enero.xlsx' }], columnas_disponibles: ['Ventas'],
    })
    historicoService.calcularTablaHistorica.mockResolvedValue({
      columnas: ['Archivo', 'Ventas'], filas: [['enero.xlsx', 100]],
    })
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas" columnasValor={[{ columna: 'Ventas', tipo_agregacion: 'suma' }]}
        override={{ titulo: 'Tabla 3' }} contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    await waitFor(() => expect(screen.getAllByText('enero.xlsx').length).toBeGreaterThan(0))
    expect(historicoService.calcularTablaHistorica).toHaveBeenCalledWith(
      'finanzas', [{ columna: 'Ventas', tipo_agregacion: 'suma' }],
    )
    expect(screen.queryByText('Contenido normal')).not.toBeInTheDocument()
    expect(screen.getByText('Histórica')).toBeInTheDocument()
  })

  it('si falla la consulta del histórico, cae al contenido normal en vez de romper', async () => {
    historicoService.listarCargasHistoricas.mockRejectedValue(new Error('falló'))
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas" columnasValor={[{ columna: 'Ventas', tipo_agregacion: 'suma' }]}
        contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    expect(await screen.findByText('Contenido normal')).toBeInTheDocument()
  })

  it('ignora las columnas sin elegir (columna null) al armar la lista para el histórico', async () => {
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [{ carga_id: 'c1' }], columnas_disponibles: ['Ventas'],
    })
    historicoService.calcularTablaHistorica.mockResolvedValue({ columnas: ['Archivo', 'Ventas'], filas: [['x', 1]] })
    render(
      <TablaHistoricaAutomatica
        dashboardId="finanzas"
        columnasValor={[{ columna: 'Ventas', tipo_agregacion: 'suma' }, { columna: null, tipo_agregacion: 'suma' }]}
        contenidoNormal={<div>Contenido normal</div>}
      />,
    )
    await waitFor(() => expect(historicoService.calcularTablaHistorica).toHaveBeenCalledWith(
      'finanzas', [{ columna: 'Ventas', tipo_agregacion: 'suma' }],
    ))
  })
})
