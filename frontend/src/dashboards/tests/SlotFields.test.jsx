import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CamposParaSlot } from '../components/dashboard-generic/SlotFields'
import { ETIQUETAS_TRAMOS_ACUMULADOS } from '../utils/tramosAntiguedad'

vi.mock('../services/carteraService')

const COLUMNAS = [
  { nombre: 'Saldo', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false },
  { nombre: 'Cliente', tipo: 'categorico', apta_para_valor: false, apta_para_categoria: true },
  { nombre: 'Fecha de Vencimiento', tipo: 'fecha', apta_para_valor: false, apta_para_categoria: true },
]

function renderCampos(slot, propuesta = {}, extra = {}) {
  const llamadas = []
  const cambiar = (campo) => (valor) => llamadas.push([campo, valor])
  const cambiarLista = (campo) => (lista) => llamadas.push([campo, lista])
  const utils = render(
    <div><CamposParaSlot slot={slot} propuesta={propuesta} columnas={COLUMNAS} cambiar={cambiar} cambiarLista={cambiarLista} cargaId="carga-1" {...extra} /></div>,
  )
  return { ...utils, llamadas }
}

describe('CamposParaSlot', () => {
  describe('kpi (con meta)', () => {
    const slot = { calculo: 'kpi', titulo: 'KPI 1' }

    it('muestra los campos de meta mínima y máxima, vacíos por defecto', () => {
      renderCampos(slot)
      expect(screen.getByLabelText('Meta mínima de KPI 1')).toHaveValue(null)
      expect(screen.getByLabelText('Meta máxima de KPI 1')).toHaveValue(null)
    })

    it('precarga la meta ya guardada', () => {
      renderCampos(slot, { meta_min: 50, meta_max: 200 })
      expect(screen.getByLabelText('Meta mínima de KPI 1')).toHaveValue(50)
      expect(screen.getByLabelText('Meta máxima de KPI 1')).toHaveValue(200)
    })

    it('cambiar la meta mínima invoca cambiar con "meta_min"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Meta mínima de KPI 1'), { target: { value: '50' } })
      expect(llamadas).toContainEqual(['meta_min', 50])
    })

    it('cambiar la meta máxima invoca cambiar con "meta_max"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Meta máxima de KPI 1'), { target: { value: '200' } })
      expect(llamadas).toContainEqual(['meta_max', 200])
    })

    it('vaciar un campo de meta invoca cambiar con null', () => {
      const { llamadas } = renderCampos(slot, { meta_min: 50 })
      fireEvent.change(screen.getByLabelText('Meta mínima de KPI 1'), { target: { value: '' } })
      expect(llamadas).toContainEqual(['meta_min', null])
    })

    it('muestra el selector de formato del valor, en "Número" por defecto', () => {
      renderCampos(slot)
      expect(screen.getByLabelText('Formato del valor de KPI 1')).toHaveValue('numero')
    })

    it('precarga el formato ya guardado', () => {
      renderCampos(slot, { formato: 'moneda' })
      expect(screen.getByLabelText('Formato del valor de KPI 1')).toHaveValue('moneda')
    })

    it('cambiar el formato invoca cambiar con "formato"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Formato del valor de KPI 1'), { target: { value: 'porcentaje' } })
      expect(llamadas).toContainEqual(['formato', 'porcentaje'])
    })

    it('muestra el selector "Fuente de datos", en "Archivo actual" por defecto', () => {
      renderCampos(slot)
      expect(screen.getByLabelText('Fuente de datos de KPI 1')).toHaveValue('actual')
    })

    it('elegir "Histórico" invoca cambiar con "usa_historico" y restringe la columna a las históricas', () => {
      const { llamadas } = renderCampos(slot, {}, { columnasHistoricas: ['Saldo'] })
      fireEvent.change(screen.getByLabelText('Fuente de datos de KPI 1'), { target: { value: 'historico' } })
      expect(llamadas).toContainEqual(['usa_historico', true])
    })

    it('en modo histórico, la columna solo ofrece las marcadas como históricas', () => {
      renderCampos(slot, { usa_historico: true }, { columnasHistoricas: ['Saldo'] })
      const selector = screen.getByLabelText('Columna de KPI 1')
      const opciones = Array.from(selector.querySelectorAll('option')).map((o) => o.textContent)
      expect(opciones).toEqual(['Sin usar', 'Saldo'])
    })

    it('con ocultarHistorico, no muestra el selector "Fuente de datos"', () => {
      renderCampos(slot, {}, { ocultarHistorico: true })
      expect(screen.queryByLabelText('Fuente de datos de KPI 1')).not.toBeInTheDocument()
    })
  })

  describe('chart (fuente de datos: actual vs. histórico)', () => {
    const slot = { calculo: 'chart', titulo: 'Gráfico 1', tipoVisualizacion: 'barras_verticales' }

    it('por defecto muestra el selector de categoría', () => {
      renderCampos(slot)
      expect(screen.getByLabelText(/Categoría|Eje horizontal/)).toBeInTheDocument()
    })

    it('en modo histórico oculta el selector de categoría y restringe la columna de valor', () => {
      renderCampos(slot, { usa_historico: true }, { columnasHistoricas: ['Saldo'] })
      expect(screen.queryByLabelText(/Categoría|Eje horizontal \(categoría\)/)).not.toBeInTheDocument()
      const selectorValor = screen.getByLabelText(/valor/i)
      const opciones = Array.from(selectorValor.querySelectorAll('option')).map((o) => o.textContent)
      expect(opciones).toEqual(['Sin usar', 'Saldo'])
    })
  })

  describe('multivalor (fuente de datos: actual vs. histórico)', () => {
    const slot = { calculo: 'multivalor', titulo: 'Gráfico 2', tipoVisualizacion: 'lineas_multiples' }

    it('en modo histórico oculta el selector de categoría', () => {
      renderCampos(slot, { usa_historico: true }, { columnasHistoricas: ['Saldo'] })
      expect(screen.queryByLabelText(/Categoría|Eje horizontal \(categoría\)/)).not.toBeInTheDocument()
    })

    it('elegir "Histórico" invoca cambiar con "usa_historico"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Fuente de datos de Gráfico 2'), { target: { value: 'historico' } })
      expect(llamadas).toContainEqual(['usa_historico', true])
    })
  })

  describe('multiserie (fuente de datos: actual vs. histórico)', () => {
    const slot = { calculo: 'multiserie', titulo: 'Gráfico 3', tipoVisualizacion: 'barras_agrupadas' }

    it('en modo histórico oculta el selector de categoría, serie y valor quedan restringidos a las históricas', () => {
      renderCampos(slot, { usa_historico: true }, { columnasHistoricas: ['Saldo'] })
      expect(screen.queryByLabelText(/Categoría|Eje horizontal \(categoría\)/)).not.toBeInTheDocument()
      const selectorSerie = screen.getByLabelText(/Serie/)
      const opciones = Array.from(selectorSerie.querySelectorAll('option')).map((o) => o.textContent)
      expect(opciones).toEqual(['Sin usar', 'Saldo'])
    })
  })

  describe('tramos_antiguedad', () => {
    const slot = { calculo: 'tramos_antiguedad', titulo: 'Antigüedad' }

    it('ofrece solo columnas de tipo fecha en el selector de columna de fecha', () => {
      renderCampos(slot)
      const selector = screen.getByLabelText('Columna de fecha de Antigüedad')
      const opciones = Array.from(selector.querySelectorAll('option')).map((o) => o.textContent)
      expect(opciones).toEqual(['Sin usar', 'Fecha de Vencimiento'])
    })

    it('ofrece todas las columnas en el selector de columna de valor', () => {
      renderCampos(slot)
      const selector = screen.getByLabelText('Columna de valor de Antigüedad')
      const opciones = Array.from(selector.querySelectorAll('option')).map((o) => o.textContent)
      expect(opciones).toEqual(expect.arrayContaining(['Saldo', 'Cliente', 'Fecha de Vencimiento']))
    })

    it('cambiar la columna de fecha invoca cambiar con "columna_fecha"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Columna de fecha de Antigüedad'), { target: { value: 'Fecha de Vencimiento' } })
      expect(llamadas).toContainEqual(['columna_fecha', 'Fecha de Vencimiento'])
    })
  })

  describe('cumplimiento_metas', () => {
    const slot = { calculo: 'cumplimiento_metas', titulo: 'Cumplimiento' }

    it('muestra los selectores de columna de fecha y de valor', () => {
      renderCampos(slot)
      expect(screen.getByLabelText('Columna de fecha de Cumplimiento')).toBeInTheDocument()
      expect(screen.getByLabelText('Columna de valor de Cumplimiento')).toBeInTheDocument()
    })

    it('muestra 6 filas fijas de metas, una por cada tramo acumulado', () => {
      renderCampos(slot)
      for (const etiqueta of ETIQUETAS_TRAMOS_ACUMULADOS) {
        expect(screen.getByLabelText(`Meta mínima de tramo "${etiqueta}" de Cumplimiento`)).toBeInTheDocument()
        expect(screen.getByLabelText(`Meta máxima de tramo "${etiqueta}" de Cumplimiento`)).toBeInTheDocument()
      }
    })

    it('precarga la meta ya guardada de un tramo, sin afectar a los demás', () => {
      renderCampos(slot, { metas: [{ meta_min: 50 }] })
      expect(screen.getByLabelText(`Meta mínima de tramo "${ETIQUETAS_TRAMOS_ACUMULADOS[0]}" de Cumplimiento`)).toHaveValue(50)
      expect(screen.getByLabelText(`Meta mínima de tramo "${ETIQUETAS_TRAMOS_ACUMULADOS[1]}" de Cumplimiento`)).toHaveValue(null)
    })

    it('cambiar la meta de un tramo invoca cambiarLista con "metas", el arreglo completo de 6 posiciones', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText(`Meta mínima de tramo "${ETIQUETAS_TRAMOS_ACUMULADOS[0]}" de Cumplimiento`), { target: { value: '50' } })
      const [campo, metas] = llamadas.find(([c]) => c === 'metas')
      expect(campo).toBe('metas')
      expect(metas).toHaveLength(6)
      expect(metas[0]).toEqual({ meta_min: 50 })
    })

    it('cambiar la meta de un tramo no pisa la meta ya guardada de otro tramo', () => {
      const { llamadas } = renderCampos(slot, { metas: [{ meta_min: 10 }, {}, {}, {}, {}, { meta_max: 5 }] })
      fireEvent.change(screen.getByLabelText(`Meta máxima de tramo "${ETIQUETAS_TRAMOS_ACUMULADOS[1]}" de Cumplimiento`), { target: { value: '99' } })
      const [, metas] = llamadas.find(([c]) => c === 'metas')
      expect(metas[0]).toEqual({ meta_min: 10 })
      expect(metas[1]).toEqual({ meta_max: 99 })
      expect(metas[5]).toEqual({ meta_max: 5 })
    })
  })

  describe('concentracion', () => {
    const slot = { calculo: 'concentracion', titulo: 'Concentración' }

    it('muestra los selectores de identidad, columna de valor y cantidad (top-N)', () => {
      renderCampos(slot)
      expect(screen.getByLabelText('Identidad de Concentración')).toBeInTheDocument()
      expect(screen.getByLabelText('Columna de valor de Concentración')).toBeInTheDocument()
      expect(screen.getByLabelText('Cantidad (top-N) de Concentración')).toHaveValue(null)
    })

    it('precarga la cantidad (top-N) ya guardada', () => {
      renderCampos(slot, { top_n: 16 })
      expect(screen.getByLabelText('Cantidad (top-N) de Concentración')).toHaveValue(16)
    })

    it('cambiar la cantidad (top-N) invoca cambiar con "top_n"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Cantidad (top-N) de Concentración'), { target: { value: '10' } })
      expect(llamadas).toContainEqual(['top_n', 10])
    })

    it('cambiar la identidad invoca cambiar con "columna_id"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Identidad de Concentración'), { target: { value: 'Cliente' } })
      expect(llamadas).toContainEqual(['columna_id', 'Cliente'])
    })
  })

  describe('tabla (fuente de datos: actual vs. histórico)', () => {
    const slot = { calculo: 'tabla', titulo: 'Tabla 1' }

    it('por defecto muestra "Archivo actual" y el selector de identidad de fila', () => {
      renderCampos(slot)
      expect(screen.getByLabelText('Fuente de datos de Tabla 1')).toHaveValue('actual')
      expect(screen.getByLabelText('Identidad de fila de Tabla 1')).toBeInTheDocument()
    })

    it('elegir "Histórico" invoca cambiar con "usa_historico"', () => {
      const { llamadas } = renderCampos(slot)
      fireEvent.change(screen.getByLabelText('Fuente de datos de Tabla 1'), { target: { value: 'historico' } })
      expect(llamadas).toContainEqual(['usa_historico', true])
    })

    it('en modo histórico oculta "Identidad de fila" y restringe las columnas de valor a las históricas', () => {
      renderCampos(slot, { usa_historico: true }, { columnasHistoricas: ['Saldo'] })
      expect(screen.queryByLabelText('Identidad de fila de Tabla 1')).not.toBeInTheDocument()
      const selectorColumna1 = screen.getByLabelText('Columna 1 de Tabla 1')
      const opciones = Array.from(selectorColumna1.querySelectorAll('option')).map((o) => o.textContent)
      expect(opciones).toEqual(['Sin usar', 'Saldo'])
    })

    it('en modo histórico sin columnas históricas configuradas, avisa que no hay ninguna marcada', () => {
      renderCampos(slot, { usa_historico: true }, { columnasHistoricas: [] })
      expect(screen.getByText(/todavía no tiene columnas marcadas como históricas/)).toBeInTheDocument()
    })

    it('con ocultarHistorico, no muestra el selector "Fuente de datos" ni restringe columnas', () => {
      renderCampos(slot, { usa_historico: true }, { ocultarHistorico: true, columnasHistoricas: ['Saldo'] })
      expect(screen.queryByLabelText('Fuente de datos de Tabla 1')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Identidad de fila de Tabla 1')).toBeInTheDocument()
    })
  })
})
