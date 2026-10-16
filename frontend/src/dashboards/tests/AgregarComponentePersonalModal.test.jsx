import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgregarComponentePersonalModal from '../components/dashboard-editor/AgregarComponentePersonalModal'
import * as carteraService from '../services/carteraService'
import * as historicoService from '../services/historicoService'
import { ETIQUETAS_TRAMOS_ACUMULADOS } from '../utils/tramosAntiguedad'

vi.mock('../services/carteraService')
vi.mock('../services/historicoService')

const COLUMNAS = [
  { nombre: 'Saldo', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false },
  { nombre: 'Zona', tipo: 'categorico', apta_para_valor: false, apta_para_categoria: true },
  { nombre: 'Cliente', tipo: 'categorico', apta_para_valor: false, apta_para_categoria: true },
  { nombre: 'Fecha de Vencimiento', tipo: 'fecha', apta_para_valor: false, apta_para_categoria: true },
]

const ARCHIVO_DISPONIBLE = {
  disponible: true, carga_id: 'carga-1', nombre_archivo: 'datos.xlsx', total_filas: 100, columnas: COLUMNAS,
}

function renderModal(overrides = {}) {
  const props = {
    show: true,
    onHide: vi.fn(),
    dashboardId: 'finanzas',
    componentesPersonales: [],
    onAgregado: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<AgregarComponentePersonalModal {...props} />) }
}

beforeEach(() => {
  vi.clearAllMocks()
  carteraService.obtenerArchivoActualDashboard.mockResolvedValue(ARCHIVO_DISPONIBLE)
  carteraService.obtenerDuplicadosColumna.mockResolvedValue({ cantidad_valores_duplicados: 0, ejemplos: [] })
  historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: [], columnas_disponibles: ['Saldo'] })
})

describe('AgregarComponentePersonalModal', () => {
  it('sin archivo real aplicado al dashboard, muestra el mensaje correspondiente', async () => {
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
    renderModal()
    expect(await screen.findByText(/todavía no tiene un archivo real cargado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar' })).not.toBeInTheDocument()
  })

  it('con archivo disponible, muestra el formulario con el tipo "KPI" seleccionado por defecto', async () => {
    renderModal()
    expect(await screen.findByLabelText('Título')).toBeInTheDocument()
    expect(screen.getByLabelText('Tipo de componente')).toHaveValue('kpi')
  })

  it('con tipoInicial, el selector de tipo queda preseleccionado en ese valor', async () => {
    renderModal({ tipoInicial: 'tabla' })
    await screen.findByLabelText('Título')
    expect(screen.getByLabelText('Tipo de componente')).toHaveValue('tabla')
  })

  it('el botón "Agregar" queda deshabilitado sin título', async () => {
    renderModal()
    await screen.findByLabelText('Título')
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeDisabled()
  })

  it('sin componentes previos en la Zona Personal, sugiere 2 columnas de ancho', async () => {
    renderModal({ componentesPersonales: [] })
    expect(await screen.findByLabelText('Ancho')).toHaveValue('2')
  })

  it('con un componente previo de ancho 1 columna (width=12), sugiere repetir 1 columna', async () => {
    renderModal({
      componentesPersonales: [{ component_id: 'a', order: 1, width: 12 }],
    })
    expect(await screen.findByLabelText('Ancho')).toHaveValue('1')
  })

  it('con varios componentes previos, sugiere el ancho del último agregado (mayor order)', async () => {
    renderModal({
      componentesPersonales: [
        { component_id: 'a', order: 1, width: 6 },
        { component_id: 'b', order: 2, width: 3 },
      ],
    })
    expect(await screen.findByLabelText('Ancho')).toHaveValue('4')
  })

  it('elegir tipo "Tabla" muestra el selector de identidad de fila y columnas de valor', async () => {
    renderModal()
    const selectorTipo = await screen.findByLabelText('Tipo de componente')
    await userEvent.selectOptions(selectorTipo, 'tabla')
    expect(screen.getByLabelText(/Identidad de fila/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Columna 1/)).toBeInTheDocument()
  })

  it('en tipo "Tabla", elegir fuente de datos "Histórico" oculta identidad de fila y restringe columnas a las históricas', async () => {
    renderModal()
    const selectorTipo = await screen.findByLabelText('Tipo de componente')
    await userEvent.selectOptions(selectorTipo, 'tabla')
    await userEvent.selectOptions(screen.getByLabelText('Fuente de datos de Nuevo componente'), 'historico')
    expect(screen.queryByLabelText(/Identidad de fila/)).not.toBeInTheDocument()
    const selectorColumna1 = screen.getByLabelText(/Columna 1/)
    const opciones = Array.from(selectorColumna1.querySelectorAll('option')).map((o) => o.textContent)
    expect(opciones).toEqual(['Sin usar', 'Saldo'])
  })

  it('confirmar con tipo Tabla y fuente "Histórico" incluye usa_historico en el payload', async () => {
    carteraService.agregarComponentePersonal.mockResolvedValue({})
    renderModal()

    await userEvent.type(await screen.findByLabelText('Título'), 'Saldo histórico')
    await userEvent.selectOptions(screen.getByLabelText('Tipo de componente'), 'tabla')
    await userEvent.selectOptions(screen.getByLabelText('Fuente de datos de Nuevo componente'), 'historico')
    await userEvent.selectOptions(screen.getByLabelText(/Columna 1/), 'Saldo')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
      expect.objectContaining({ calculo: 'tabla', usa_historico: true }),
    ))
  })

  it('confirmar con tipo KPI llama a agregarComponentePersonal con el payload esperado y luego a onAgregado', async () => {
    carteraService.agregarComponentePersonal.mockResolvedValue({})
    const { props } = renderModal()

    await userEvent.type(await screen.findByLabelText('Título'), 'Saldo total')
    await userEvent.selectOptions(screen.getByLabelText(/^Columna de /), 'Saldo')
    await userEvent.selectOptions(screen.getByLabelText('Ancho'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
      expect.objectContaining({
        carga_id: 'carga-1', titulo: 'Saldo total', calculo: 'kpi',
        columna_valor: 'Saldo', ancho_columnas: 1,
      }),
    ))
    await waitFor(() => expect(props.onAgregado).toHaveBeenCalledTimes(1))
  })

  it('en tipo KPI, elegir fuente de datos "Histórico" restringe la columna a las históricas e incluye usa_historico en el payload', async () => {
    historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: [], columnas_disponibles: ['Saldo'] })
    carteraService.agregarComponentePersonal.mockResolvedValue({})
    renderModal()

    await userEvent.type(await screen.findByLabelText('Título'), 'Saldo histórico')
    await userEvent.selectOptions(screen.getByLabelText('Fuente de datos de Nuevo componente'), 'historico')
    const selectorColumna = screen.getByLabelText(/^Columna de /)
    expect(Array.from(selectorColumna.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Sin usar', 'Saldo'])
    await userEvent.selectOptions(selectorColumna, 'Saldo')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
      expect.objectContaining({ calculo: 'kpi', columna_valor: 'Saldo', usa_historico: true }),
    ))
  })

  it('confirmar con tipo KPI y meta incluye meta_min/meta_max en el payload', async () => {
    carteraService.agregarComponentePersonal.mockResolvedValue({})
    renderModal()

    await userEvent.type(await screen.findByLabelText('Título'), 'Saldo total')
    await userEvent.selectOptions(screen.getByLabelText(/^Columna de /), 'Saldo')
    fireEvent.change(screen.getByLabelText('Meta mínima de Nuevo componente'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Meta máxima de Nuevo componente'), { target: { value: '200' } })
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
      expect.objectContaining({ calculo: 'kpi', columna_valor: 'Saldo', meta_min: 50, meta_max: 200 }),
    ))
  })

  it('confirmar con tipo KPI y formato "moneda" elegido lo incluye en el payload', async () => {
    carteraService.agregarComponentePersonal.mockResolvedValue({})
    renderModal()

    await userEvent.type(await screen.findByLabelText('Título'), 'Cartera Total')
    await userEvent.selectOptions(screen.getByLabelText(/^Columna de /), 'Saldo')
    await userEvent.selectOptions(screen.getByLabelText('Formato del valor de Nuevo componente'), 'moneda')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
      expect.objectContaining({ calculo: 'kpi', columna_valor: 'Saldo', formato: 'moneda' }),
    ))
  })

  describe('tipo "Antigüedad por tramos"', () => {
    it('muestra los selectores de columna de fecha y de valor', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de componente'), 'tramos_antiguedad')
      expect(screen.getByLabelText('Columna de fecha de Nuevo componente')).toBeInTheDocument()
      expect(screen.getByLabelText('Columna de valor de Nuevo componente')).toBeInTheDocument()
    })

    it('confirmar arma el payload con columna_fecha y columna_valor', async () => {
      carteraService.agregarComponentePersonal.mockResolvedValue({})
      renderModal()

      await userEvent.type(await screen.findByLabelText('Título'), 'Antigüedad')
      await userEvent.selectOptions(screen.getByLabelText('Tipo de componente'), 'tramos_antiguedad')
      await userEvent.selectOptions(screen.getByLabelText('Columna de fecha de Nuevo componente'), 'Fecha de Vencimiento')
      await userEvent.selectOptions(screen.getByLabelText('Columna de valor de Nuevo componente'), 'Saldo')
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

      await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
        expect.objectContaining({
          calculo: 'tramos_antiguedad', columna_fecha: 'Fecha de Vencimiento', columna_valor: 'Saldo',
        }),
      ))
    })
  })

  describe('tipo "Cumplimiento de metas por tramo"', () => {
    it('muestra los selectores de columna y las 6 filas fijas de metas por tramo', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de componente'), 'cumplimiento_metas')
      expect(screen.getByLabelText('Columna de fecha de Nuevo componente')).toBeInTheDocument()
      expect(screen.getByLabelText('Columna de valor de Nuevo componente')).toBeInTheDocument()
      for (const etiqueta of ETIQUETAS_TRAMOS_ACUMULADOS) {
        expect(screen.getByLabelText(`Meta mínima de tramo "${etiqueta}" de Nuevo componente`)).toBeInTheDocument()
      }
    })

    it('confirmar arma el payload con metas', async () => {
      carteraService.agregarComponentePersonal.mockResolvedValue({})
      renderModal()

      await userEvent.type(await screen.findByLabelText('Título'), 'Cumplimiento')
      await userEvent.selectOptions(screen.getByLabelText('Tipo de componente'), 'cumplimiento_metas')
      await userEvent.selectOptions(screen.getByLabelText('Columna de fecha de Nuevo componente'), 'Fecha de Vencimiento')
      await userEvent.selectOptions(screen.getByLabelText('Columna de valor de Nuevo componente'), 'Saldo')
      fireEvent.change(screen.getByLabelText(`Meta mínima de tramo "${ETIQUETAS_TRAMOS_ACUMULADOS[0]}" de Nuevo componente`), { target: { value: '50' } })
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

      await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalled())
      const payload = carteraService.agregarComponentePersonal.mock.calls[0][0]
      expect(payload.calculo).toBe('cumplimiento_metas')
      expect(payload.metas[0]).toEqual({ meta_min: 50 })
    })
  })

  describe('tipo "Concentración"', () => {
    it('muestra los selectores de identidad, columna de valor y cantidad (top-N)', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de componente'), 'concentracion')
      expect(screen.getByLabelText('Identidad de Nuevo componente')).toBeInTheDocument()
      expect(screen.getByLabelText('Columna de valor de Nuevo componente')).toBeInTheDocument()
      expect(screen.getByLabelText('Cantidad (top-N) de Nuevo componente')).toBeInTheDocument()
    })

    it('confirmar arma el payload con columna_id y top_n', async () => {
      carteraService.agregarComponentePersonal.mockResolvedValue({})
      renderModal()

      await userEvent.type(await screen.findByLabelText('Título'), 'Concentración')
      await userEvent.selectOptions(screen.getByLabelText('Tipo de componente'), 'concentracion')
      await userEvent.selectOptions(screen.getByLabelText('Identidad de Nuevo componente'), 'Cliente')
      await userEvent.selectOptions(screen.getByLabelText('Columna de valor de Nuevo componente'), 'Saldo')
      fireEvent.change(screen.getByLabelText('Cantidad (top-N) de Nuevo componente'), { target: { value: '10' } })
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

      await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
        expect.objectContaining({ calculo: 'concentracion', columna_id: 'Cliente', columna_valor: 'Saldo', top_n: 10 }),
      ))
    })
  })

  it('un error de la API muestra un Alert y no invoca onAgregado', async () => {
    carteraService.agregarComponentePersonal.mockRejectedValue({
      response: { data: { mensaje: 'La gráfica necesita una columna de valor.' } },
    })
    const { props } = renderModal()

    await userEvent.type(await screen.findByLabelText('Título'), 'Sin columna')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(await screen.findByText('La gráfica necesita una columna de valor.')).toBeInTheDocument()
    expect(props.onAgregado).not.toHaveBeenCalled()
  })

  it('cancelar invoca onHide', async () => {
    const { props } = renderModal()
    await screen.findByLabelText('Título')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onHide).toHaveBeenCalledTimes(1)
  })

  describe('Apoyo para la IA', () => {
    it('tipo KPI muestra el selector de desglose adicional y el texto de instrucción', async () => {
      renderModal()
      await screen.findByLabelText('Título')
      expect(screen.getByLabelText(/Desglose adicional por columna/)).toBeInTheDocument()
      expect(screen.getByLabelText('Instrucción para la IA')).toBeInTheDocument()
    })

    it('tipo "Tabla" (sin una única columna de valor) no muestra el selector de desglose', async () => {
      renderModal({ tipoInicial: 'tabla' })
      await screen.findByLabelText('Título')
      expect(screen.queryByLabelText(/Desglose adicional por columna/)).not.toBeInTheDocument()
      expect(screen.getByLabelText('Instrucción para la IA')).toBeInTheDocument()
    })

    it('confirmar incluye instruccion_ia y columna_contexto_ia en el payload cuando se cargan', async () => {
      carteraService.agregarComponentePersonal.mockResolvedValue({})
      renderModal()

      await userEvent.type(await screen.findByLabelText('Título'), 'Saldo por zona')
      await userEvent.selectOptions(screen.getByLabelText(/^Columna de /), 'Saldo')
      await userEvent.selectOptions(screen.getByLabelText(/Desglose adicional por columna/), 'Zona')
      await userEvent.type(screen.getByLabelText('Instrucción para la IA'), 'Explicá los totales por zona.')
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

      await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalledWith(
        expect.objectContaining({
          instruccion_ia: 'Explicá los totales por zona.', columna_contexto_ia: 'Zona',
        }),
      ))
    })

    it('sin cargar ninguno de los dos campos, el payload no incluye instruccion_ia ni columna_contexto_ia', async () => {
      carteraService.agregarComponentePersonal.mockResolvedValue({})
      renderModal()

      await userEvent.type(await screen.findByLabelText('Título'), 'Saldo total')
      await userEvent.selectOptions(screen.getByLabelText(/^Columna de /), 'Saldo')
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))

      await waitFor(() => expect(carteraService.agregarComponentePersonal).toHaveBeenCalled())
      const payload = carteraService.agregarComponentePersonal.mock.calls[0][0]
      expect(payload).not.toHaveProperty('instruccion_ia')
      expect(payload).not.toHaveProperty('columna_contexto_ia')
    })

    it('cambiar de tipo reinicia el desglose adicional elegido', async () => {
      renderModal()
      await screen.findByLabelText('Título')
      await userEvent.selectOptions(screen.getByLabelText(/Desglose adicional por columna/), 'Zona')

      await userEvent.selectOptions(screen.getByLabelText('Tipo de componente'), 'chart')
      expect(screen.getByLabelText(/Desglose adicional por columna/)).toHaveValue('')
    })
  })
})
