import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TemplateMappingStep from '../components/dashboard-generic/TemplateMappingStep'
import { PLANTILLA_SLOTS } from '../utils/plantillaSlots'
import * as carteraService from '../services/carteraService'

vi.mock('../services/carteraService')

const COLUMNAS = [
  { nombre: 'Saldo', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false },
  { nombre: 'Ciudad', tipo: 'categorico', apta_para_valor: false, apta_para_categoria: true },
  { nombre: 'Causal', tipo: 'categorico', apta_para_valor: false, apta_para_categoria: true },
  { nombre: 'Fecha de Vencimiento', tipo: 'fecha', apta_para_valor: false, apta_para_categoria: true },
]

const MAPEO = {
  'kpi-1': { disponible: true, columna_valor: 'Saldo' },
  'grafico-1': { disponible: true, columna_categoria: 'Ciudad', columna_valor: 'Saldo' },
  'grafico-6': { disponible: false, columna_valor: null, columna_valor_y: null },
}

const DATOS = {
  'kpi-1': { titulo: 'KPI 1', valor: 1000, formato: 'numero' },
  'grafico-1': { titulo: 'Gráfico 1', categorias: ['Quito'], valores: [1000] },
}

beforeEach(() => {
  vi.clearAllMocks()
  carteraService.obtenerValoresColumnaPlantilla.mockResolvedValue({ valores: ['GESTIONANDO', 'PAGADO'], total: 2 })
  carteraService.obtenerDuplicadosColumna.mockResolvedValue({ cantidad_valores_duplicados: 0, ejemplos: [] })
})

function renderComponente(overrides = {}) {
  const props = {
    archivoInfo: { nombreArchivo: 'datos.xlsx', totalFilas: 10, cargaId: 'carga-1' },
    columnas: COLUMNAS,
    mapeo: MAPEO,
    datos: DATOS,
    aliases: {},
    onActualizarSlot: vi.fn(),
    onConfirmar: vi.fn(),
    onCancelar: vi.fn(),
    cargando: false,
    cargandoPreview: false,
    error: null,
    ...overrides,
  }
  return { props, ...render(<TemplateMappingStep {...props} />) }
}

describe('TemplateMappingStep', () => {
  it('muestra las 15 posiciones de la plantilla', () => {
    renderComponente()
    for (const slot of PLANTILLA_SLOTS) {
      // Las posiciones con vista previa disponible (kpi-1, grafico-1) repiten el título dentro
      // del propio gráfico, además del encabezado de la tarjeta — de ahí "getAllByText".
      expect(screen.getAllByText(slot.titulo).length).toBeGreaterThan(0)
    }
  })

  it('una posición no disponible se marca como dato de ejemplo', () => {
    renderComponente()
    expect(screen.getAllByText(/dato de ejemplo/).length).toBeGreaterThan(0)
  })

  it('cambiar la columna de valor de un KPI invoca onActualizarSlot con esa posición', async () => {
    const { props } = renderComponente()
    const selector = screen.getByLabelText('Columna de KPI 1')
    await userEvent.selectOptions(selector, 'Saldo')
    expect(props.onActualizarSlot).toHaveBeenCalledWith('kpi-1', { columna_valor: 'Saldo' })
  })

  it('un KPI muestra el selector de tipo de cálculo, con "Suma" por defecto', () => {
    renderComponente()
    expect(screen.getByLabelText('Tipo de cálculo de KPI 1')).toHaveValue('suma')
  })

  it('cambiar el tipo de cálculo de un KPI a "conteo de valores únicos" invoca onActualizarSlot', async () => {
    const { props } = renderComponente()
    const selector = screen.getByLabelText('Tipo de cálculo de KPI 1')
    await userEvent.selectOptions(selector, 'conteo_unicos')
    expect(props.onActualizarSlot).toHaveBeenCalledWith('kpi-1', { tipo_agregacion: 'conteo_unicos' })
  })

  it('cada posición muestra un selector de columna de filtro, sin valor por defecto', () => {
    renderComponente()
    const selector = screen.getByLabelText('Columna de filtro de KPI 1')
    expect(selector).toHaveValue('')
    // Sin columna de filtro elegida, no se muestra el selector de valor.
    expect(screen.queryByLabelText('Valor de filtro de KPI 1')).not.toBeInTheDocument()
  })

  it('elegir una columna de filtro invoca onActualizarSlot y limpia el valor elegido antes', async () => {
    const { props } = renderComponente()
    const selector = screen.getByLabelText('Columna de filtro de KPI 1')
    await userEvent.selectOptions(selector, 'Causal')
    expect(props.onActualizarSlot).toHaveBeenCalledWith('kpi-1', {
      columna_filtro: 'Causal', valor_filtro: null, valores_filtro: null, dias_filtro: null,
    })
  })

  it('con una columna de filtro elegida, carga y muestra sus valores distintos', async () => {
    renderComponente({
      mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], columna_filtro: 'Causal' } },
    })
    await waitFor(() => expect(carteraService.obtenerValoresColumnaPlantilla).toHaveBeenCalledWith('carga-1', 'Causal', {}, undefined))
    const selectorValor = await screen.findByLabelText('Valores de filtro de KPI 1')
    const opciones = Array.from(selectorValor.querySelectorAll('option')).map((o) => o.value)
    expect(opciones).toEqual(expect.arrayContaining(['GESTIONANDO', 'PAGADO']))
  })

  it('elegir valores de filtro invoca onActualizarSlot con la lista', async () => {
    const { props } = renderComponente({
      mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], columna_filtro: 'Causal' } },
    })
    const selectorValor = await screen.findByLabelText('Valores de filtro de KPI 1')
    await userEvent.selectOptions(selectorValor, 'GESTIONANDO')
    expect(props.onActualizarSlot).toHaveBeenCalledWith('kpi-1', {
      valores_filtro: ['GESTIONANDO'], valor_filtro: null,
    })
  })

  it('permite excluir valores en vez de incluirlos ("todos menos X")', async () => {
    // El caso que motivó el filtro por lista: sumar todo el saldo MENOS el anticipado, sin tener
    // que enumerar los demás tramos (que además cambian si el archivo trae una categoría nueva).
    const { props } = renderComponente({
      mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], columna_filtro: 'Causal' } },
    })
    await userEvent.selectOptions(screen.getByLabelText('Comparación de valores de KPI 1'), 'no_en')
    expect(props.onActualizarSlot).toHaveBeenCalledWith('kpi-1', { operador_valor: 'no_en' })
  })

  it('muestra como seleccionado un valor guardado con la forma anterior (un solo valor)', async () => {
    // Retrocompatibilidad: los mapeos guardados antes de que el filtro admitiera varios valores
    // traen `valor_filtro` y no `valores_filtro`. No hay migración que los reescriba.
    renderComponente({
      mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], columna_filtro: 'Causal', valor_filtro: 'PAGADO' } },
    })
    const selectorValor = await screen.findByLabelText('Valores de filtro de KPI 1')
    const seleccionadas = Array.from(selectorValor.selectedOptions).map((o) => o.value)
    expect(seleccionadas).toEqual(['PAGADO'])
  })

  describe('filtro "Días desde una fecha" (solo KPI)', () => {
    it('un KPI muestra el selector "Tipo de filtro", un gráfico no', () => {
      renderComponente()
      expect(screen.getByLabelText('Tipo de filtro de KPI 1')).toHaveValue('igualdad')
      expect(screen.queryByLabelText('Tipo de filtro de Gráfico 1')).not.toBeInTheDocument()
    })

    it('elegir "Días desde una fecha" ofrece solo columnas de tipo fecha en el selector de columna', () => {
      renderComponente({
        mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], tipo_filtro: 'dias_vencidos' } },
      })
      const selectorColumna = screen.getByLabelText('Columna de fecha de KPI 1')
      const opciones = Array.from(selectorColumna.querySelectorAll('option')).map((o) => o.textContent)
      expect(opciones).toEqual(['Sin usar', 'Fecha de Vencimiento'])
    })

    it('cambiar "Tipo de filtro" invoca onActualizarSlot limpiando todos los campos de filtro anteriores', async () => {
      const { props } = renderComponente({
        mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], columna_filtro: 'Causal', valor_filtro: 'PAGADO' } },
      })
      await userEvent.selectOptions(screen.getByLabelText('Tipo de filtro de KPI 1'), 'dias_vencidos')
      expect(props.onActualizarSlot).toHaveBeenCalledWith('kpi-1', {
        tipo_filtro: 'dias_vencidos', columna_filtro: null, valor_filtro: null, valores_filtro: null,
        operador_valor: null, operador_filtro: null, dias_filtro: null,
      })
    })

    it('con la columna de fecha elegida, muestra selector de comparación y campo de días', async () => {
      renderComponente({
        mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], tipo_filtro: 'dias_vencidos', columna_filtro: 'Fecha de Vencimiento' } },
      })
      const selectorComparacion = screen.getByLabelText('Comparación de días de KPI 1')
      expect(selectorComparacion).toHaveValue('mayor')
      expect(screen.getByLabelText('Cantidad de días de KPI 1')).toHaveValue(null)
      const opciones = Array.from(selectorComparacion.querySelectorAll('option')).map((o) => o.value)
      expect(opciones).toEqual(['mayor', 'mayor_igual', 'menor', 'menor_igual'])
    })

    it('cambiar la comparación invoca onActualizarSlot', async () => {
      const { props } = renderComponente({
        mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], tipo_filtro: 'dias_vencidos', columna_filtro: 'Fecha de Vencimiento' } },
      })
      await userEvent.selectOptions(screen.getByLabelText('Comparación de días de KPI 1'), 'mayor_igual')
      expect(props.onActualizarSlot).toHaveBeenCalledWith('kpi-1', { operador_filtro: 'mayor_igual' })
    })

    it('escribir la cantidad de días invoca onActualizarSlot con un número', () => {
      const { props } = renderComponente({
        mapeo: { ...MAPEO, 'kpi-1': { ...MAPEO['kpi-1'], tipo_filtro: 'dias_vencidos', columna_filtro: 'Fecha de Vencimiento' } },
      })
      fireEvent.change(screen.getByLabelText('Cantidad de días de KPI 1'), { target: { value: '30' } })
      expect(props.onActualizarSlot).toHaveBeenLastCalledWith('kpi-1', { dias_filtro: 30 })
    })
  })

  it('un gráfico muestra el selector de tipo de gráfico, con el tipo por defecto del slot', () => {
    renderComponente()
    expect(screen.getByLabelText('Tipo de gráfico de Gráfico 1')).toHaveValue('barras_verticales')
  })

  it('cambiar el tipo de gráfico invoca onActualizarSlot con esa posición', async () => {
    const { props } = renderComponente()
    const selector = screen.getByLabelText('Tipo de gráfico de Gráfico 1')
    await userEvent.selectOptions(selector, 'pastel')
    expect(props.onActualizarSlot).toHaveBeenCalledWith('grafico-1', { chart_type: 'pastel' })
  })

  it('el badge y la vista previa reflejan el tipo de gráfico elegido, no solo el default del slot', () => {
    renderComponente({
      mapeo: { ...MAPEO, 'grafico-1': { ...MAPEO['grafico-1'], chart_type: 'pastel' } },
    })
    // "Pastel" aparece en el badge de Gráfico 1 (ahora en "pastel") y como opción en los
    // selectores de tipo de gráfico (incluido el de Gráfico 5, cuyo default ya es "pastel").
    expect(screen.getAllByText('Pastel').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Tipo de gráfico de Gráfico 1')).toHaveValue('pastel')
  })

  it('un KPI (o dispersión/tabla) no muestra el selector de tipo de gráfico', () => {
    renderComponente()
    expect(screen.queryByLabelText('Tipo de gráfico de KPI 1')).not.toBeInTheDocument()
  })

  it('cada selector ofrece todas las columnas del archivo, sin importar el tipo detectado', () => {
    renderComponente()
    // "Ciudad" es categórica y "Saldo" es numérica; el selector de Categoría de un gráfico debe
    // poder elegir cualquiera de las dos, no solo las marcadas aptas para esa función. Gráfico 1
    // arranca en "barras_verticales" (tipo por defecto del slot), de ahí la etiqueta de eje.
    const selectorCategoria = screen.getByLabelText('Eje horizontal (categoría) de Gráfico 1')
    const opciones = Array.from(selectorCategoria.querySelectorAll('option')).map((o) => o.value)
    expect(opciones).toEqual(expect.arrayContaining(['Saldo', 'Ciudad']))
  })

  it('muestra un indicador mientras se recalcula la vista previa', () => {
    renderComponente({ cargandoPreview: true })
    expect(screen.getByText('Actualizando vista previa…')).toBeInTheDocument()
  })

  it('no muestra el indicador de vista previa cuando no se está recalculando', () => {
    renderComponente({ cargandoPreview: false })
    expect(screen.queryByText('Actualizando vista previa…')).not.toBeInTheDocument()
  })

  it('"Aplicar a la plantilla" invoca onConfirmar', async () => {
    const { props } = renderComponente()
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar a la plantilla' }))
    expect(props.onConfirmar).toHaveBeenCalled()
  })

  it('"Cancelar" invoca onCancelar', async () => {
    const { props } = renderComponente()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onCancelar).toHaveBeenCalled()
  })

  it('mientras cargando, el botón de aplicar queda deshabilitado', () => {
    renderComponente({ cargando: true })
    expect(screen.getByRole('button', { name: /Aplicando/ })).toBeDisabled()
  })

  it('muestra el error recibido', () => {
    renderComponente({ error: 'No se pudo analizar el archivo.' })
    expect(screen.getByText('No se pudo analizar el archivo.')).toBeInTheDocument()
  })

  describe('columnas de una tabla (agregar/quitar/reordenar)', () => {
    it('sin columnas de valor, muestra una única fila de selector y "Quitar" deshabilitado', () => {
      renderComponente({
        mapeo: { ...MAPEO, 'tabla-1': { disponible: false, columna_id: null, columnas_valor: [] } },
      })
      expect(screen.getByLabelText('Columna 1 de Tabla 1')).toBeInTheDocument()
      expect(screen.queryByLabelText('Columna 2 de Tabla 1')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Quitar columna 1 de Tabla 1')).toBeDisabled()
    })

    it('"+ Agregar columna" invoca onActualizarSlot con una fila vacía extra', async () => {
      const { props } = renderComponente({
        mapeo: { ...MAPEO, 'tabla-1': { disponible: true, columna_id: 'Ciudad', columnas_valor: ['Saldo'] } },
      })
      const botones = screen.getAllByRole('button', { name: '+ Agregar columna' })
      await userEvent.click(botones[0])
      expect(props.onActualizarSlot).toHaveBeenCalledWith('tabla-1', {
        columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }, { columna: null, tipo_agregacion: 'suma' }],
      })
    })

    it('"Quitar columna" invoca onActualizarSlot sin esa columna', async () => {
      const { props } = renderComponente({
        mapeo: { ...MAPEO, 'tabla-1': { disponible: true, columna_id: 'Ciudad', columnas_valor: ['Saldo', 'Causal'] } },
      })
      await userEvent.click(screen.getByLabelText('Quitar columna 1 de Tabla 1'))
      expect(props.onActualizarSlot).toHaveBeenCalledWith('tabla-1', {
        columnas_valor: [{ columna: 'Causal', tipo_agregacion: 'suma' }],
      })
    })

    it('"Mover abajo" intercambia la columna con la siguiente', async () => {
      const { props } = renderComponente({
        mapeo: { ...MAPEO, 'tabla-1': { disponible: true, columna_id: 'Ciudad', columnas_valor: ['Saldo', 'Causal'] } },
      })
      await userEvent.click(screen.getByLabelText('Mover columna 1 de Tabla 1 abajo'))
      expect(props.onActualizarSlot).toHaveBeenCalledWith('tabla-1', {
        columnas_valor: [{ columna: 'Causal', tipo_agregacion: 'suma' }, { columna: 'Saldo', tipo_agregacion: 'suma' }],
      })
    })

    it('cada columna tiene su propio selector de tipo de cálculo (suma/promedio/valores únicos)', () => {
      renderComponente({
        mapeo: { ...MAPEO, 'tabla-1': { disponible: true, columna_id: 'Ciudad', columnas_valor: ['Saldo', 'Causal'] } },
      })
      expect(screen.getByLabelText('Tipo de cálculo de columna 1 de Tabla 1')).toHaveValue('suma')
      expect(screen.getByLabelText('Tipo de cálculo de columna 2 de Tabla 1')).toHaveValue('suma')
    })

    it('cambiar el tipo de cálculo de una columna invoca onActualizarSlot conservando la columna elegida', async () => {
      const { props } = renderComponente({
        mapeo: { ...MAPEO, 'tabla-1': { disponible: true, columna_id: 'Ciudad', columnas_valor: ['Saldo', 'Causal'] } },
      })
      await userEvent.selectOptions(screen.getByLabelText('Tipo de cálculo de columna 2 de Tabla 1'), 'conteo_unicos')
      expect(props.onActualizarSlot).toHaveBeenCalledWith('tabla-1', {
        columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }, { columna: 'Causal', tipo_agregacion: 'conteo_unicos' }],
      })
    })

    it('la primera columna no puede moverse arriba ni la última abajo', () => {
      renderComponente({
        mapeo: { ...MAPEO, 'tabla-1': { disponible: true, columna_id: 'Ciudad', columnas_valor: ['Saldo', 'Causal'] } },
      })
      expect(screen.getByLabelText('Mover columna 1 de Tabla 1 arriba')).toBeDisabled()
      expect(screen.getByLabelText('Mover columna 2 de Tabla 1 abajo')).toBeDisabled()
    })
  })

  describe('aviso de columnas con valores en blanco', () => {
    it('sin columnasConBlancos, no muestra ningún aviso', () => {
      renderComponente()
      expect(screen.queryByText('Columnas con valores en blanco')).not.toBeInTheDocument()
    })

    it('columna apta para valor: explica que se ignoran en sumas/promedios', () => {
      renderComponente({
        columnasConBlancos: [{ columna: 'Saldo', cantidad_en_blanco: 5, filas_ejemplo: [] }],
      })
      expect(screen.getByText('Columnas con valores en blanco')).toBeInTheDocument()
      expect(screen.getAllByText('Saldo').length).toBeGreaterThan(0)
      expect(screen.getByText(/5 fila\(s\) en blanco/)).toBeInTheDocument()
      expect(screen.getByText(/se van a ignorar en las sumas y promedios/)).toBeInTheDocument()
    })

    it('columna apta para categoría: explica que se agrupan como "Sin dato"', () => {
      renderComponente({
        columnasConBlancos: [{ columna: 'Ciudad', cantidad_en_blanco: 4, filas_ejemplo: [] }],
      })
      expect(screen.getByText(/se van a agrupar bajo la etiqueta "Sin dato"/)).toBeInTheDocument()
    })

    it('columna que no aparece en `columnas` (no apta para nada): explica que no se usa en ningún cálculo', () => {
      renderComponente({
        columnasConBlancos: [{ columna: 'Observaciones', cantidad_en_blanco: 10, filas_ejemplo: [] }],
      })
      expect(screen.getByText(/no se usa en ningún cálculo de la plantilla/)).toBeInTheDocument()
    })

    it('muestra las filas de ejemplo con su número y la referencia', () => {
      renderComponente({
        columnasConBlancos: [{
          columna: 'Saldo', cantidad_en_blanco: 5,
          filas_ejemplo: [{ numero_fila: 7, referencia: { Sucursal: 'MATRIZ' } }],
        }],
      })
      expect(screen.getByText(/fila 7 \(Sucursal: MATRIZ\)/)).toBeInTheDocument()
    })

    it('columna marcada como histórica: agrega el badge correspondiente', () => {
      renderComponente({
        columnasConBlancos: [{ columna: 'Saldo', cantidad_en_blanco: 5, filas_ejemplo: [] }],
        columnasHistoricas: ['Saldo'],
      })
      expect(screen.getByText(/usada en Tabla 3 \(histórica\)/)).toBeInTheDocument()
    })

    it('columna que no está marcada como histórica: no muestra el badge', () => {
      renderComponente({
        columnasConBlancos: [{ columna: 'Saldo', cantidad_en_blanco: 5, filas_ejemplo: [] }],
        columnasHistoricas: ['Ciudad'],
      })
      expect(screen.queryByText(/usada en .* \(histórica\)/)).not.toBeInTheDocument()
    })

    it('no bloquea "Aplicar a la plantilla"', () => {
      renderComponente({
        columnasConBlancos: [{ columna: 'Saldo', cantidad_en_blanco: 5, filas_ejemplo: [] }],
      })
      expect(screen.getByRole('button', { name: 'Aplicar a la plantilla' })).not.toBeDisabled()
    })
  })
})
