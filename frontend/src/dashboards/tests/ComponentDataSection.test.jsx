import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ComponentDataSection from '../components/dashboard-editor/ComponentDataSection'
import * as carteraService from '../services/carteraService'
import * as historicoService from '../services/historicoService'
import { ETIQUETAS_TRAMOS_ACUMULADOS } from '../utils/tramosAntiguedad'

vi.mock('../services/carteraService')
vi.mock('../services/historicoService')

const COLUMNAS = [
  { nombre: 'Saldo', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false },
  { nombre: 'Zona', tipo: 'categorico', apta_para_valor: false, apta_para_categoria: true },
  { nombre: 'Fecha de Vencimiento', tipo: 'fecha', apta_para_valor: false, apta_para_categoria: true },
]

const ARCHIVO_DISPONIBLE = {
  disponible: true, carga_id: 'carga-1', nombre_archivo: 'datos.xlsx', total_filas: 100, columnas: COLUMNAS,
}

function renderSeccion(overrides = {}) {
  const props = {
    componente: { component_id: 'kpi-1', mapeo: { disponible: true, columna_valor: 'Saldo' } },
    dashboardId: 'finanzas',
    onActualizarComponente: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<ComponentDataSection {...props} />) }
}

beforeEach(() => {
  vi.clearAllMocks()
  carteraService.obtenerArchivoActualDashboard.mockResolvedValue(ARCHIVO_DISPONIBLE)
  carteraService.obtenerDuplicadosColumna.mockResolvedValue({ cantidad_valores_duplicados: 0, ejemplos: [] })
  historicoService.listarCargasHistoricas.mockResolvedValue({ cargas: [], columnas_disponibles: ['Saldo'] })
})

describe('ComponentDataSection', () => {
  it('un componente que no es una posición fija de la plantilla no muestra selectores', async () => {
    renderSeccion({ componente: { component_id: 'grafico-libre-1', mapeo: {} } })
    expect(await screen.findByText('Esta posición no tiene datos configurables desde acá.')).toBeInTheDocument()
  })

  it('sin archivo real aplicado al dashboard, muestra el mensaje correspondiente', async () => {
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
    renderSeccion()
    expect(await screen.findByText(/todavía no tiene un archivo real cargado/)).toBeInTheDocument()
  })

  it('con archivo disponible, precarga los selectores con el mapeo actual del componente', async () => {
    renderSeccion()
    expect(await screen.findByLabelText('Columna de KPI 1')).toHaveValue('Saldo')
    expect(screen.getByLabelText('Tipo de cálculo de KPI 1')).toHaveValue('suma')
  })

  it('cambiar una columna recalcula contra el archivo y actualiza el borrador con el mapeo y el contenido', async () => {
    carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'kpi-1': { titulo: 'KPI 1', valor: 500, formato: 'numero' } } })
    const { props } = renderSeccion()
    const selector = await screen.findByLabelText('Columna de KPI 1')

    await userEvent.selectOptions(selector, 'Zona')

    await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith(
      'carga-1', { 'kpi-1': { disponible: true, columna_valor: 'Zona' } },
    ))
    await waitFor(() => expect(props.onActualizarComponente).toHaveBeenCalledWith('kpi-1', {
      mapeo: { disponible: true, columna_valor: 'Zona' },
      content: { titulo: 'KPI 1', valor: 500, formato: 'numero' },
    }))
  })

  it('cambiar el tipo de cálculo también recalcula (no es un tipo de gráfico)', async () => {
    carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'kpi-1': { titulo: 'KPI 1', valor: 3, formato: 'numero' } } })
    renderSeccion()
    const selector = await screen.findByLabelText('Tipo de cálculo de KPI 1')

    await userEvent.selectOptions(selector, 'conteo_unicos')

    await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith(
      'carga-1', { 'kpi-1': { disponible: true, columna_valor: 'Saldo', tipo_agregacion: 'conteo_unicos' } },
    ))
  })

  it('cambiar el tipo de gráfico no recalcula contra el archivo (los datos no cambian)', async () => {
    const { props } = renderSeccion({
      componente: {
        component_id: 'grafico-1',
        mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo' },
      },
    })
    const selector = await screen.findByLabelText('Tipo de gráfico de Gráfico 1')

    await userEvent.selectOptions(selector, 'pastel')

    expect(carteraService.previsualizarMapeoPlantilla).not.toHaveBeenCalled()
    expect(props.onActualizarComponente).toHaveBeenCalledWith('grafico-1', {
      mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo', chart_type: 'pastel' },
      chart_type: 'pastel',
    })
  })

  it('el tipo de cálculo de un KPI no ofrece "Ver valor de celda" (no aplica: un KPI no agrupa filas)', async () => {
    renderSeccion()
    const selector = await screen.findByLabelText('Tipo de cálculo de KPI 1')
    const opciones = Array.from(selector.querySelectorAll('option')).map((o) => o.value)
    expect(opciones).not.toContain('valor_celda')
  })

  it('una posición de 2+ columnas de valor (multivalor/multiserie) también ofrece pastel/dona en el tipo de gráfico', async () => {
    const { props } = renderSeccion({
      componente: {
        component_id: 'grafico-2',
        mapeo: { disponible: true, columna_categoria: 'Zona', columnas_valor: ['Saldo'], chart_type: 'lineas_multiples' },
      },
    })
    const selector = await screen.findByLabelText('Tipo de gráfico de Gráfico 2')
    const opciones = Array.from(selector.querySelectorAll('option')).map((o) => o.value)
    expect(opciones).toEqual(expect.arrayContaining(['pastel', 'dona', 'barras_verticales', 'barras_horizontales']))

    await userEvent.selectOptions(selector, 'dona')

    expect(props.onActualizarComponente).toHaveBeenCalledWith('grafico-2', {
      mapeo: { disponible: true, columna_categoria: 'Zona', columnas_valor: ['Saldo'], chart_type: 'dona' },
      chart_type: 'dona',
    })
  })

  it('muestra el selector de columna de filtro, con todas las columnas del archivo', async () => {
    renderSeccion()
    const selectorFiltro = await screen.findByLabelText('Columna de filtro de KPI 1')
    const opciones = Array.from(selectorFiltro.querySelectorAll('option')).map((o) => o.value)
    expect(opciones).toEqual(expect.arrayContaining(['Saldo', 'Zona']))
  })

  describe('filtro "Días desde una fecha" (solo KPI)', () => {
    it('un KPI muestra el selector "Tipo de filtro", un gráfico no', async () => {
      renderSeccion()
      expect(await screen.findByLabelText('Tipo de filtro de KPI 1')).toHaveValue('igualdad')

      renderSeccion({
        componente: { component_id: 'grafico-1', mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo' } },
      })
      await screen.findByLabelText('Columna de filtro de Gráfico 1')
      expect(screen.queryByLabelText('Tipo de filtro de Gráfico 1')).not.toBeInTheDocument()
    })

    it('elegir "Días desde una fecha" recalcula limpiando los campos del filtro anterior', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'kpi-1': { titulo: 'KPI 1', valor: 500, formato: 'numero' } } })
      carteraService.obtenerValoresColumnaPlantilla.mockResolvedValue({ valores: ['Norte', 'Sur'] })
      renderSeccion({
        componente: {
          component_id: 'kpi-1',
          mapeo: { disponible: true, columna_valor: 'Saldo', columna_filtro: 'Zona', valor_filtro: 'Norte' },
        },
      })
      const selector = await screen.findByLabelText('Tipo de filtro de KPI 1')

      await userEvent.selectOptions(selector, 'dias_vencidos')

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'kpi-1': {
          disponible: true, columna_valor: 'Saldo', tipo_filtro: 'dias_vencidos',
          columna_filtro: null, valor_filtro: null, valores_filtro: null, operador_valor: null,
          operador_filtro: null, dias_filtro: null,
        },
      }))
    })

    it('con la columna de fecha ya elegida, muestra selector de comparación y campo de días precargados', async () => {
      renderSeccion({
        componente: {
          component_id: 'kpi-1',
          mapeo: {
            disponible: true, columna_valor: 'Saldo', tipo_filtro: 'dias_vencidos',
            columna_filtro: 'Fecha de Vencimiento', operador_filtro: 'mayor_igual', dias_filtro: 30,
          },
        },
      })
      expect(await screen.findByLabelText('Comparación de días de KPI 1')).toHaveValue('mayor_igual')
      expect(screen.getByLabelText('Cantidad de días de KPI 1')).toHaveValue(30)
    })

    it('cambiar la cantidad de días recalcula contra el archivo', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'kpi-1': { titulo: 'KPI 1', valor: 300, formato: 'numero' } } })
      renderSeccion({
        componente: {
          component_id: 'kpi-1',
          mapeo: {
            disponible: true, columna_valor: 'Saldo', tipo_filtro: 'dias_vencidos',
            columna_filtro: 'Fecha de Vencimiento', operador_filtro: 'mayor',
          },
        },
      })
      const campoDias = await screen.findByLabelText('Cantidad de días de KPI 1')

      fireEvent.change(campoDias, { target: { value: '30' } })

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'kpi-1': {
          disponible: true, columna_valor: 'Saldo', tipo_filtro: 'dias_vencidos',
          columna_filtro: 'Fecha de Vencimiento', operador_filtro: 'mayor', dias_filtro: 30,
        },
      }))
    })
  })

  describe('etiquetas de los campos según el tipo de gráfico elegido', () => {
    function componenteGrafico1(chartType) {
      return { component_id: 'grafico-1', mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo', chart_type: chartType } }
    }
    function componenteGrafico3(chartType) {
      return {
        component_id: 'grafico-3',
        mapeo: { disponible: true, columna_categoria: 'Zona', columna_serie: 'Zona', columna_valor: 'Saldo', chart_type: chartType },
      }
    }

    it('barras verticales: "Eje horizontal (categoría)" / "Eje vertical (valor)"', async () => {
      renderSeccion({ componente: componenteGrafico1('barras_verticales') })
      expect(await screen.findByLabelText('Eje horizontal (categoría) de Gráfico 1')).toHaveValue('Zona')
      expect(screen.getByLabelText('Eje vertical (valor) de Gráfico 1')).toHaveValue('Saldo')
    })

    it('barras horizontales: los ejes se invierten en la etiqueta ("Eje vertical" pasa a ser la categoría)', async () => {
      renderSeccion({ componente: componenteGrafico1('barras_horizontales') })
      expect(await screen.findByLabelText('Eje vertical (categoría) de Gráfico 1')).toHaveValue('Zona')
      expect(screen.getByLabelText('Eje horizontal (valor) de Gráfico 1')).toHaveValue('Saldo')
    })

    it('un chart_type ya no seleccionable (p. ej. "lineas", de antes de este cambio) cae a las etiquetas de eje por defecto', async () => {
      // "lineas" ya no está en TIPOS_COMPATIBLES.chart (catálogo cerrado a los 6 tipos vigentes),
      // pero un componente creado antes de este cambio puede seguir teniéndolo guardado —
      // `tipoVisualizacionElegido` cae al tipo por defecto del slot (barras_verticales), así que
      // las etiquetas también caen a las de eje por defecto, no a las circulares.
      renderSeccion({ componente: componenteGrafico1('lineas') })
      expect(await screen.findByLabelText('Eje horizontal (categoría) de Gráfico 1')).toBeInTheDocument()
    })

    it('pastel: "Categoría (una porción por valor)" / "Valor (tamaño de cada porción)", con aviso de leyenda', async () => {
      renderSeccion({ componente: componenteGrafico1('pastel') })
      expect(await screen.findByLabelText('Categoría (una porción por valor) de Gráfico 1')).toHaveValue('Zona')
      expect(screen.getByLabelText('Valor (tamaño de cada porción) de Gráfico 1')).toHaveValue('Saldo')
      expect(screen.getByText(/aparece en la leyenda/)).toBeInTheDocument()
    })

    it('dona: mismas etiquetas circulares que pastel', async () => {
      renderSeccion({ componente: componenteGrafico1('dona') })
      expect(await screen.findByLabelText('Categoría (una porción por valor) de Gráfico 1')).toBeInTheDocument()
      expect(screen.getByText(/aparece en la leyenda/)).toBeInTheDocument()
    })

    it('barras verticales no muestra el aviso de leyenda (solo aplica a pastel/dona)', async () => {
      renderSeccion({ componente: componenteGrafico1('barras_verticales') })
      await screen.findByLabelText('Eje horizontal (categoría) de Gráfico 1')
      expect(screen.queryByText(/aparece en la leyenda/)).not.toBeInTheDocument()
    })

    it('multiserie (Gráfico 3) con líneas múltiples: etiquetas de eje, incluida "Serie"', async () => {
      renderSeccion({ componente: componenteGrafico3('lineas_multiples') })
      expect(await screen.findByLabelText('Eje horizontal (categoría) de Gráfico 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Serie (una barra, línea o capa por cada valor distinto) de Gráfico 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Eje vertical (valor) de Gráfico 3')).toBeInTheDocument()
    })

    it('multiserie (Gráfico 3) con dona: sigue mostrando los 3 campos (Categoría/Serie/Valor), con etiquetas circulares', async () => {
      renderSeccion({ componente: componenteGrafico3('dona') })
      expect(await screen.findByLabelText('Categoría (una porción por valor) de Gráfico 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Serie (se combina en el total de cada porción) de Gráfico 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Valor (tamaño de cada porción) de Gráfico 3')).toBeInTheDocument()
    })
  })

  describe('columnas de valor de un gráfico multivalor (1 "Valor" si es pastel/dona, 2 o 3 "Métrica" si no)', () => {
    function componenteMultivalor(columnasValor, chartType) {
      return {
        component_id: 'grafico-2',
        mapeo: { disponible: true, columna_categoria: 'Zona', columnas_valor: columnasValor, chart_type: chartType },
      }
    }

    it('con un tipo de gráfico no circular, muestra "Métrica 1" y "Métrica 2" (no "Valor")', async () => {
      renderSeccion({ componente: componenteMultivalor(['Saldo'], 'lineas_multiples') })
      expect(await screen.findByLabelText('Métrica 1 de Gráfico 2')).toHaveValue('Saldo')
      expect(screen.getByLabelText('Métrica 2 de Gráfico 2')).toHaveValue('')
      expect(screen.queryByLabelText('Valor (tamaño de cada porción) de Gráfico 2')).not.toBeInTheDocument()
    })

    it('con pastel elegido, muestra un único selector "Valor" (no "Métrica 1"/"Métrica 2")', async () => {
      renderSeccion({ componente: componenteMultivalor(['Saldo', 'Costo'], 'pastel') })
      expect(await screen.findByLabelText('Valor (tamaño de cada porción) de Gráfico 2')).toHaveValue('Saldo')
      expect(screen.queryByLabelText('Métrica 1 de Gráfico 2')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Métrica 2 de Gráfico 2')).not.toBeInTheDocument()
    })

    it('con dona elegido, también muestra el único selector "Valor"', async () => {
      renderSeccion({ componente: componenteMultivalor(['Saldo'], 'dona') })
      expect(await screen.findByLabelText('Valor (tamaño de cada porción) de Gráfico 2')).toBeInTheDocument()
    })

    it('cambiar de un tipo no circular a pastel colapsa los campos a un único "Valor"', async () => {
      const { rerender } = renderSeccion({ componente: componenteMultivalor(['Saldo', 'Costo'], 'lineas_multiples') })
      await screen.findByLabelText('Métrica 1 de Gráfico 2')

      await userEvent.selectOptions(screen.getByLabelText('Tipo de gráfico de Gráfico 2'), 'pastel')

      rerender(
        <ComponentDataSection
          componente={componenteMultivalor(['Saldo', 'Costo'], 'pastel')} dashboardId="finanzas" onActualizarComponente={vi.fn()}
        />,
      )
      expect(await screen.findByLabelText('Valor (tamaño de cada porción) de Gráfico 2')).toBeInTheDocument()
      expect(screen.queryByLabelText('Métrica 2 de Gráfico 2')).not.toBeInTheDocument()
    })

    it('cambiar de pastel a un tipo no circular expande de nuevo a "Métrica 1"/"Métrica 2"', async () => {
      const { rerender } = renderSeccion({ componente: componenteMultivalor(['Saldo'], 'pastel') })
      await screen.findByLabelText('Valor (tamaño de cada porción) de Gráfico 2')

      rerender(
        <ComponentDataSection
          componente={componenteMultivalor(['Saldo'], 'barras_agrupadas')} dashboardId="finanzas" onActualizarComponente={vi.fn()}
        />,
      )
      expect(await screen.findByLabelText('Métrica 1 de Gráfico 2')).toHaveValue('Saldo')
      expect(screen.getByLabelText('Métrica 2 de Gráfico 2')).toHaveValue('')
    })

    it('"+ Agregar métrica" permite una 3ra columna de valor', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'grafico-2': { categorias: [], series: [] } } })
      renderSeccion({ componente: componenteMultivalor(['Saldo', 'Costo'], 'lineas_multiples') })
      await screen.findByLabelText('Métrica 1 de Gráfico 2')

      await userEvent.click(screen.getByRole('button', { name: '+ Agregar métrica' }))

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'grafico-2': { disponible: true, columna_categoria: 'Zona', columnas_valor: ['Saldo', 'Costo', null], chart_type: 'lineas_multiples' },
      }))
    })

    it('con 3 métricas, "+ Agregar métrica" ya no aparece y cada fila tiene botón para quitar', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'grafico-2': { categorias: [], series: [] } } })
      renderSeccion({ componente: componenteMultivalor(['Saldo', 'Costo', 'Zona'], 'lineas_multiples') })
      expect(await screen.findByLabelText('Métrica 3 de Gráfico 2')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '+ Agregar métrica' })).not.toBeInTheDocument()

      await userEvent.click(screen.getByLabelText('Quitar métrica 3 de Gráfico 2'))

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'grafico-2': { disponible: true, columna_categoria: 'Zona', columnas_valor: ['Saldo', 'Costo'], chart_type: 'lineas_multiples' },
      }))
    })
  })

  describe('columnas de una tabla (agregar/quitar/reordenar)', () => {
    function componenteTabla(columnasValor) {
      return { component_id: 'tabla-1', mapeo: { disponible: true, columna_id: 'Zona', columnas_valor: columnasValor } }
    }

    it('con una sola columna, "Quitar" queda deshabilitado', async () => {
      renderSeccion({ componente: componenteTabla(['Saldo']) })
      expect(await screen.findByLabelText('Quitar columna 1 de Tabla 1')).toBeDisabled()
    })

    it('"+ Agregar columna" recalcula con una fila vacía extra', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'tabla-1': { columnas: [], filas: [], total: [] } } })
      renderSeccion({ componente: componenteTabla(['Saldo']) })
      await userEvent.click(await screen.findByRole('button', { name: '+ Agregar columna' }))

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'tabla-1': {
          disponible: true, columna_id: 'Zona',
          columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }, { columna: null, tipo_agregacion: 'suma' }],
        },
      }))
    })

    it('"Quitar columna" recalcula sin esa columna', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'tabla-1': { columnas: [], filas: [], total: [] } } })
      renderSeccion({ componente: componenteTabla(['Saldo', 'Zona']) })
      await userEvent.click(await screen.findByLabelText('Quitar columna 1 de Tabla 1'))

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'tabla-1': { disponible: true, columna_id: 'Zona', columnas_valor: [{ columna: 'Zona', tipo_agregacion: 'suma' }] },
      }))
    })

    it('"Mover abajo" intercambia la columna con la siguiente', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'tabla-1': { columnas: [], filas: [], total: [] } } })
      renderSeccion({ componente: componenteTabla(['Saldo', 'Zona']) })
      await userEvent.click(await screen.findByLabelText('Mover columna 1 de Tabla 1 abajo'))

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'tabla-1': {
          disponible: true, columna_id: 'Zona',
          columnas_valor: [{ columna: 'Zona', tipo_agregacion: 'suma' }, { columna: 'Saldo', tipo_agregacion: 'suma' }],
        },
      }))
    })

    it('cambiar el tipo de cálculo de una columna de valor recalcula conservando la columna elegida', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'tabla-1': { columnas: [], filas: [], total: [] } } })
      renderSeccion({ componente: componenteTabla([{ columna: 'Saldo', tipo_agregacion: 'suma' }]) })
      const selector = await screen.findByLabelText('Tipo de cálculo de columna 1 de Tabla 1')

      await userEvent.selectOptions(selector, 'promedio')

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'tabla-1': {
          disponible: true, columna_id: 'Zona',
          columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'promedio' }],
        },
      }))
    })

    it('el tipo de cálculo de una columna de tabla sí ofrece "Ver valor de celda" y se puede elegir', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'tabla-1': { columnas: [], filas: [], total: [] } } })
      renderSeccion({ componente: componenteTabla([{ columna: 'Saldo', tipo_agregacion: 'suma' }]) })
      const selector = await screen.findByLabelText('Tipo de cálculo de columna 1 de Tabla 1')
      const opciones = Array.from(selector.querySelectorAll('option')).map((o) => o.value)
      expect(opciones).toContain('valor_celda')

      await userEvent.selectOptions(selector, 'valor_celda')

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'tabla-1': {
          disponible: true, columna_id: 'Zona',
          columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'valor_celda' }],
        },
      }))
    })
  })

  describe('componentes de Zona Personal (component_id fuera de las 13 posiciones fijas)', () => {
    it('con calculo ya guardado en el mapeo, arma el slot sintético y muestra los selectores', async () => {
      renderSeccion({
        componente: {
          component_id: 'mi-kpi', type: 'kpi', content: { titulo: 'Mi KPI' },
          mapeo: { disponible: true, calculo: 'kpi', columna_valor: 'Saldo' },
        },
      })
      expect(await screen.findByLabelText('Columna de Mi KPI')).toHaveValue('Saldo')
    })

    it('sin mapeo pero con forma inferible sin ambigüedad (KPI), igual se puede reconfigurar', async () => {
      renderSeccion({
        componente: { component_id: 'mi-kpi', type: 'kpi', content: { titulo: 'Mi KPI' }, mapeo: {} },
      })
      expect(await screen.findByLabelText('Columna de Mi KPI')).toBeInTheDocument()
    })

    it('dispersión se infiere sin ambigüedad por chart_type', async () => {
      renderSeccion({
        componente: {
          component_id: 'mi-dispersion', type: 'chart', chart_type: 'dispersion',
          content: { titulo: 'Mi dispersión' }, mapeo: {},
        },
      })
      expect(await screen.findByLabelText('Eje X de Mi dispersión')).toBeInTheDocument()
    })

    it('tabla se infiere sin ambigüedad por chart_type', async () => {
      renderSeccion({
        componente: {
          component_id: 'mi-tabla', type: 'chart', chart_type: 'tabla',
          content: { titulo: 'Mi tabla' }, mapeo: {},
        },
      })
      expect(await screen.findByLabelText('Identidad de fila de Mi tabla')).toBeInTheDocument()
    })

    it('multiserie se infiere sin ambigüedad cuando config trae columna_serie', async () => {
      renderSeccion({
        componente: {
          component_id: 'mi-multiserie', type: 'chart', chart_type: 'barras_agrupadas',
          content: { titulo: 'Mi gráfico', series: [] }, config: { columna_serie: 'Zona' }, mapeo: {},
        },
      })
      expect(await screen.findByLabelText('Serie (una barra, línea o capa por cada valor distinto) de Mi gráfico')).toBeInTheDocument()
    })

    it('multivalor se infiere sin ambigüedad cuando config trae columnas_valor', async () => {
      renderSeccion({
        componente: {
          component_id: 'mi-multivalor', type: 'chart', chart_type: 'lineas_multiples',
          content: { titulo: 'Mi gráfico', series: [] }, config: { columnas_valor: ['Saldo', 'Costo'] }, mapeo: {},
        },
      })
      expect(await screen.findByLabelText('Métrica 1 de Mi gráfico')).toBeInTheDocument()
    })

    it('series presente sin ninguna señal de config (calculo ambiguo) muestra el aviso de recrear el componente', async () => {
      renderSeccion({
        componente: {
          component_id: 'mi-ambiguo', type: 'chart', chart_type: 'barras_agrupadas',
          content: { titulo: 'Mi gráfico', series: [] }, config: {}, mapeo: {},
        },
      })
      expect(await screen.findByText(/se creó antes de poder reconfigurar/)).toBeInTheDocument()
      expect(screen.queryByLabelText(/de Mi gráfico/)).not.toBeInTheDocument()
    })

    it('un separador/título de Zona Personal sigue mostrando el mensaje genérico, no el de recrear', async () => {
      renderSeccion({ componente: { component_id: 'mi-separador', type: 'text', content: { titulo: '' }, mapeo: {} } })
      expect(await screen.findByText('Esta posición no tiene datos configurables desde acá.')).toBeInTheDocument()
    })

    it('el panel de filtros de Zona Personal sigue mostrando el mensaje genérico', async () => {
      renderSeccion({ componente: { component_id: 'mis-filtros', type: 'filters_panel', config: { filtros: [] }, mapeo: {} } })
      expect(await screen.findByText('Esta posición no tiene datos configurables desde acá.')).toBeInTheDocument()
    })

    it('cambiar una columna llama a previsualizarMapeoComponente y actualiza mapeo+content', async () => {
      carteraService.previsualizarMapeoComponente.mockResolvedValue({
        contenido: { titulo: 'Mi KPI', descripcion: 'Suma de "Zona".', valor: 42, formato: 'numero' },
      })
      const { props } = renderSeccion({
        componente: {
          component_id: 'mi-kpi', type: 'kpi', content: { titulo: 'Mi KPI' },
          mapeo: { disponible: true, calculo: 'kpi', columna_valor: 'Saldo' },
        },
      })
      const selector = await screen.findByLabelText('Columna de Mi KPI')

      await userEvent.selectOptions(selector, 'Zona')

      await waitFor(() => expect(carteraService.previsualizarMapeoComponente).toHaveBeenCalledWith('carga-1', {
        calculo: 'kpi', titulo: 'Mi KPI', mapeo: { disponible: true, calculo: 'kpi', columna_valor: 'Zona' },
      }))
      await waitFor(() => expect(props.onActualizarComponente).toHaveBeenCalledWith('mi-kpi', {
        mapeo: { disponible: true, calculo: 'kpi', columna_valor: 'Zona' },
        content: { titulo: 'Mi KPI', descripcion: 'Suma de "Zona".', valor: 42, formato: 'numero' },
      }))
    })

    it('contenido null no pisa el contenido anterior y muestra un aviso', async () => {
      carteraService.previsualizarMapeoComponente.mockResolvedValue({ contenido: null })
      const { props } = renderSeccion({
        componente: {
          component_id: 'mi-kpi', type: 'kpi', content: { titulo: 'Mi KPI' },
          mapeo: { disponible: true, calculo: 'kpi', columna_valor: 'Saldo' },
        },
      })
      const selector = await screen.findByLabelText('Columna de Mi KPI')

      await userEvent.selectOptions(selector, 'Zona')

      await waitFor(() => expect(props.onActualizarComponente).toHaveBeenCalledWith('mi-kpi', {
        mapeo: { disponible: true, calculo: 'kpi', columna_valor: 'Zona' },
      }))
      expect(await screen.findByText(/No se pudo calcular con esa combinación de columnas todavía/)).toBeInTheDocument()
    })
  })

  describe('aviso de valores duplicados al elegir columna de categoría/identidad de fila', () => {
    it('no consulta duplicados si todavía no hay columna elegida', async () => {
      renderSeccion({
        componente: {
          component_id: 'grafico-1', type: 'chart', chart_type: 'barras_verticales',
          mapeo: { disponible: true, columna_valor: 'Saldo' },
        },
      })
      await screen.findByLabelText('Eje horizontal (categoría) de Gráfico 1')
      expect(carteraService.obtenerDuplicadosColumna).not.toHaveBeenCalled()
    })

    it('sin duplicados, no muestra ningún aviso', async () => {
      carteraService.obtenerDuplicadosColumna.mockResolvedValue({ cantidad_valores_duplicados: 0, ejemplos: [] })
      renderSeccion({
        componente: {
          component_id: 'grafico-1', type: 'chart', chart_type: 'barras_verticales',
          mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo' },
        },
      })
      await screen.findByLabelText('Eje horizontal (categoría) de Gráfico 1')
      await waitFor(() => expect(carteraService.obtenerDuplicadosColumna).toHaveBeenCalledWith('carga-1', 'Zona', undefined))
      expect(screen.queryByText(/valor\(es\) duplicado\(s\)/)).not.toBeInTheDocument()
    })

    it('con duplicados, muestra cantidad y ejemplos junto al selector de categoría', async () => {
      carteraService.obtenerDuplicadosColumna.mockResolvedValue({
        cantidad_valores_duplicados: 2,
        ejemplos: [{ valor: 'Quito', cantidad: 12 }, { valor: 'Guayaquil', cantidad: 8 }],
      })
      renderSeccion({
        componente: {
          component_id: 'grafico-1', type: 'chart', chart_type: 'barras_verticales',
          mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo' },
        },
      })
      expect(await screen.findByText(/Esta columna tiene 2 valor\(es\) duplicado\(s\)\./)).toBeInTheDocument()
      expect(screen.getByText(/Quito \(12 veces\), Guayaquil \(8 veces\)/)).toBeInTheDocument()
    })

    it('con duplicados en la identidad de fila de una tabla, también muestra el aviso', async () => {
      carteraService.obtenerDuplicadosColumna.mockResolvedValue({
        cantidad_valores_duplicados: 1, ejemplos: [{ valor: 'Zona A', cantidad: 5 }],
      })
      renderSeccion({
        componente: {
          component_id: 'tabla-1', type: 'chart', chart_type: 'tabla',
          mapeo: { disponible: true, columna_id: 'Zona', columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }] },
        },
      })
      expect(await screen.findByText(/Esta columna tiene 1 valor\(es\) duplicado\(s\)\./)).toBeInTheDocument()
      await waitFor(() => expect(carteraService.obtenerDuplicadosColumna).toHaveBeenCalledWith('carga-1', 'Zona', undefined))
    })

    it('si la consulta falla, no muestra ningún aviso (informativo, nunca bloquea)', async () => {
      carteraService.obtenerDuplicadosColumna.mockRejectedValue(new Error('falló'))
      renderSeccion({
        componente: {
          component_id: 'grafico-1', type: 'chart', chart_type: 'barras_verticales',
          mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo' },
        },
      })
      await screen.findByLabelText('Eje horizontal (categoría) de Gráfico 1')
      await waitFor(() => expect(carteraService.obtenerDuplicadosColumna).toHaveBeenCalled())
      expect(screen.queryByText(/valor\(es\) duplicado\(s\)/)).not.toBeInTheDocument()
    })

    it('no muestra el aviso junto al selector de "Valor" (solo aplica a categoría/identidad de fila)', async () => {
      carteraService.obtenerDuplicadosColumna.mockResolvedValue({
        cantidad_valores_duplicados: 3, ejemplos: [{ valor: '100', cantidad: 4 }],
      })
      renderSeccion({
        componente: {
          component_id: 'grafico-1', type: 'chart', chart_type: 'barras_verticales',
          mapeo: { disponible: true, columna_categoria: 'Zona', columna_valor: 'Saldo' },
        },
      })
      await screen.findByText(/Esta columna tiene 3 valor\(es\) duplicado\(s\)\./)
      // Solo se consultó la columna de categoría, nunca la de valor.
      expect(carteraService.obtenerDuplicadosColumna).toHaveBeenCalledTimes(1)
      expect(carteraService.obtenerDuplicadosColumna).toHaveBeenCalledWith('carga-1', 'Zona', undefined)
    })
  })

  describe('KPI con meta', () => {
    it('precarga la meta ya guardada de un KPI (posición fija)', async () => {
      renderSeccion({
        componente: { component_id: 'kpi-1', mapeo: { disponible: true, columna_valor: 'Saldo', meta_min: 50, meta_max: 200 } },
      })
      expect(await screen.findByLabelText('Meta mínima de KPI 1')).toHaveValue(50)
      expect(screen.getByLabelText('Meta máxima de KPI 1')).toHaveValue(200)
    })

    it('cambiar la meta recalcula contra el archivo', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: { 'kpi-1': { titulo: 'KPI 1', valor: 500, formato: 'numero' } } })
      renderSeccion()
      const campo = await screen.findByLabelText('Meta mínima de KPI 1')

      fireEvent.change(campo, { target: { value: '50' } })

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith(
        'carga-1', { 'kpi-1': { disponible: true, columna_valor: 'Saldo', meta_min: 50 } },
      ))
    })
  })

  describe('Zona Personal — calculo "tramos_antiguedad"', () => {
    function componenteTramos(extra = {}) {
      return {
        component_id: 'mi-antiguedad', type: 'chart', chart_type: 'barras_verticales',
        content: { titulo: 'Mi antigüedad' },
        mapeo: { disponible: true, calculo: 'tramos_antiguedad', columna_fecha: 'Fecha de Vencimiento' },
        ...extra,
      }
    }

    it('muestra los selectores de columna de fecha y de valor, precargados', async () => {
      renderSeccion({ componente: componenteTramos({ mapeo: { disponible: true, calculo: 'tramos_antiguedad', columna_fecha: 'Fecha de Vencimiento', columna_valor: 'Saldo' } }) })
      expect(await screen.findByLabelText('Columna de fecha de Mi antigüedad')).toHaveValue('Fecha de Vencimiento')
      expect(screen.getByLabelText('Columna de valor de Mi antigüedad')).toHaveValue('Saldo')
    })

    it('cambiar la columna de valor recalcula vía previsualizarMapeoComponente', async () => {
      carteraService.previsualizarMapeoComponente.mockResolvedValue({ contenido: { titulo: 'Mi antigüedad', categorias: [], valores: [] } })
      renderSeccion({ componente: componenteTramos() })
      const selector = await screen.findByLabelText('Columna de valor de Mi antigüedad')

      await userEvent.selectOptions(selector, 'Saldo')

      await waitFor(() => expect(carteraService.previsualizarMapeoComponente).toHaveBeenCalledWith('carga-1', {
        calculo: 'tramos_antiguedad', titulo: 'Mi antigüedad',
        mapeo: { disponible: true, calculo: 'tramos_antiguedad', columna_fecha: 'Fecha de Vencimiento', columna_valor: 'Saldo' },
      }))
    })
  })

  describe('Zona Personal — calculo "cumplimiento_metas"', () => {
    function componenteCumplimiento(extra = {}) {
      return {
        component_id: 'mi-cumplimiento', type: 'chart', chart_type: 'tabla',
        content: { titulo: 'Mi cumplimiento', columnas: ['Tramo', 'Saldo', '% acumulado', 'Resultado'], filas: [], total: null },
        mapeo: { disponible: true, calculo: 'cumplimiento_metas', columna_fecha: 'Fecha de Vencimiento', columna_valor: 'Saldo' },
        ...extra,
      }
    }

    it('muestra los selectores de columna y las 6 filas fijas de metas por tramo', async () => {
      renderSeccion({ componente: componenteCumplimiento() })
      expect(await screen.findByLabelText('Columna de fecha de Mi cumplimiento')).toHaveValue('Fecha de Vencimiento')
      expect(screen.getByLabelText('Columna de valor de Mi cumplimiento')).toHaveValue('Saldo')
      for (const etiqueta of ETIQUETAS_TRAMOS_ACUMULADOS) {
        expect(screen.getByLabelText(`Meta mínima de tramo "${etiqueta}" de Mi cumplimiento`)).toBeInTheDocument()
      }
    })

    it('cambiar una meta recalcula vía previsualizarMapeoComponente con el arreglo completo de metas', async () => {
      carteraService.previsualizarMapeoComponente.mockResolvedValue({
        contenido: { titulo: 'Mi cumplimiento', columnas: ['Tramo', 'Saldo', '% acumulado', 'Resultado'], filas: [], total: null },
      })
      renderSeccion({ componente: componenteCumplimiento() })
      const campo = await screen.findByLabelText(`Meta mínima de tramo "${ETIQUETAS_TRAMOS_ACUMULADOS[0]}" de Mi cumplimiento`)

      fireEvent.change(campo, { target: { value: '50' } })

      await waitFor(() => expect(carteraService.previsualizarMapeoComponente).toHaveBeenCalledWith('carga-1', {
        calculo: 'cumplimiento_metas', titulo: 'Mi cumplimiento',
        mapeo: {
          disponible: true, calculo: 'cumplimiento_metas', columna_fecha: 'Fecha de Vencimiento', columna_valor: 'Saldo',
          metas: [{ meta_min: 50 }, {}, {}, {}, {}, {}],
        },
      }))
    })
  })

  describe('Zona Personal — calculo "concentracion"', () => {
    function componenteConcentracion(extra = {}) {
      return {
        component_id: 'mi-concentracion', type: 'chart', chart_type: 'tabla',
        content: { titulo: 'Mi concentración', columnas: ['Zona', 'Saldo', '% del total', '% acumulado'], filas: [], total: null },
        mapeo: { disponible: true, calculo: 'concentracion', columna_id: 'Zona', columna_valor: 'Saldo', top_n: 5 },
        ...extra,
      }
    }

    it('precarga columna, valor y cantidad (top-N)', async () => {
      renderSeccion({ componente: componenteConcentracion() })
      expect(await screen.findByLabelText('Identidad de Mi concentración')).toHaveValue('Zona')
      expect(screen.getByLabelText('Columna de valor de Mi concentración')).toHaveValue('Saldo')
      expect(screen.getByLabelText('Cantidad (top-N) de Mi concentración')).toHaveValue(5)
    })

    it('cambiar la cantidad (top-N) recalcula vía previsualizarMapeoComponente', async () => {
      carteraService.previsualizarMapeoComponente.mockResolvedValue({
        contenido: { titulo: 'Mi concentración', columnas: ['Zona', 'Saldo', '% del total', '% acumulado'], filas: [], total: null },
      })
      renderSeccion({ componente: componenteConcentracion() })
      const campo = await screen.findByLabelText('Cantidad (top-N) de Mi concentración')

      fireEvent.change(campo, { target: { value: '10' } })

      await waitFor(() => expect(carteraService.previsualizarMapeoComponente).toHaveBeenCalledWith('carga-1', {
        calculo: 'concentracion', titulo: 'Mi concentración',
        mapeo: { disponible: true, calculo: 'concentracion', columna_id: 'Zona', columna_valor: 'Saldo', top_n: 10 },
      }))
    })
  })

  describe('Tabla — fuente de datos (actual vs. histórico)', () => {
    function componenteTablaFija(componentId, extra = {}) {
      return {
        component_id: componentId,
        content: { titulo: componentId, columnas: ['Zona', 'Saldo'], filas: [], total: null },
        mapeo: { disponible: true, columna_id: 'Zona', columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }] },
        ...extra,
      }
    }

    it('tabla-1 (posición fija) muestra el selector "Fuente de datos"', async () => {
      renderSeccion({ componente: componenteTablaFija('tabla-1') })
      expect(await screen.findByLabelText('Fuente de datos de Tabla 1')).toHaveValue('actual')
    })

    it('tabla-3 (ya histórica por su propio mecanismo dedicado) no muestra el selector "Fuente de datos"', async () => {
      renderSeccion({ componente: componenteTablaFija('tabla-3') })
      await screen.findByLabelText('Identidad de fila de Tabla 3')
      expect(screen.queryByLabelText('Fuente de datos de Tabla 3')).not.toBeInTheDocument()
    })

    it('elegir "Histórico" recalcula vía previsualizarMapeoPlantilla con usa_historico=true', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({
        datos: {
          'tabla-1': {
            titulo: 'Tabla 1', columnas: ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'Saldo'], filas: [], total: null,
          },
        },
      })
      renderSeccion({ componente: componenteTablaFija('tabla-1') })
      const selector = await screen.findByLabelText('Fuente de datos de Tabla 1')

      await userEvent.selectOptions(selector, 'historico')

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'tabla-1': {
          disponible: true, columna_id: 'Zona', columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }], usa_historico: true,
        },
      }))
    })

    it('en modo histórico no muestra la sección de filtro', async () => {
      renderSeccion({
        componente: componenteTablaFija('tabla-1', {
          mapeo: { disponible: true, usa_historico: true, columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }] },
        }),
      })
      await screen.findByLabelText('Fuente de datos de Tabla 1')
      expect(screen.queryByText('Filtro (opcional)')).not.toBeInTheDocument()
    })

    it('fuera de modo histórico sigue mostrando la sección de filtro', async () => {
      renderSeccion({ componente: componenteTablaFija('tabla-1') })
      await screen.findByLabelText('Fuente de datos de Tabla 1')
      expect(screen.getByText('Filtro (opcional)')).toBeInTheDocument()
    })

    it('Zona Personal: elegir "Histórico" recalcula vía previsualizarMapeoComponente con usa_historico=true', async () => {
      carteraService.previsualizarMapeoComponente.mockResolvedValue({
        contenido: {
          titulo: 'Mi tabla', columnas: ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'Saldo'], filas: [], total: null,
        },
      })
      renderSeccion({
        componente: {
          component_id: 'mi-tabla', type: 'chart', chart_type: 'tabla',
          content: { titulo: 'Mi tabla', columnas: ['Zona', 'Saldo'], filas: [], total: null },
          mapeo: {
            disponible: true, calculo: 'tabla', columna_id: 'Zona',
            columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }],
          },
        },
      })
      const selector = await screen.findByLabelText('Fuente de datos de Mi tabla')

      await userEvent.selectOptions(selector, 'historico')

      await waitFor(() => expect(carteraService.previsualizarMapeoComponente).toHaveBeenCalledWith('carga-1', {
        calculo: 'tabla', titulo: 'Mi tabla',
        mapeo: {
          disponible: true, calculo: 'tabla', columna_id: 'Zona',
          columnas_valor: [{ columna: 'Saldo', tipo_agregacion: 'suma' }], usa_historico: true,
        },
      }))
    })
  })

  describe('KPI/Gráfico — fuente de datos (actual vs. histórico)', () => {
    it('KPI (posición fija) muestra el selector "Fuente de datos"', async () => {
      renderSeccion()
      expect(await screen.findByLabelText('Fuente de datos de KPI 1')).toHaveValue('actual')
    })

    it('elegir "Histórico" en un KPI recalcula vía previsualizarMapeoPlantilla con usa_historico=true', async () => {
      carteraService.previsualizarMapeoPlantilla.mockResolvedValue({
        datos: { 'kpi-1': { titulo: 'KPI 1', valor: 500, formato: 'numero' } },
      })
      renderSeccion()
      const selector = await screen.findByLabelText('Fuente de datos de KPI 1')

      await userEvent.selectOptions(selector, 'historico')

      await waitFor(() => expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', {
        'kpi-1': { disponible: true, columna_valor: 'Saldo', usa_historico: true },
      }))
    })

    it('en modo histórico, un KPI no muestra la sección de filtro', async () => {
      renderSeccion({
        componente: { component_id: 'kpi-1', mapeo: { disponible: true, columna_valor: 'Saldo', usa_historico: true } },
      })
      await screen.findByLabelText('Fuente de datos de KPI 1')
      expect(screen.queryByText('Filtro (opcional)')).not.toBeInTheDocument()
    })

    it('Zona Personal: un Gráfico de una columna elegido "Histórico" oculta la categoría y recalcula con usa_historico=true', async () => {
      carteraService.previsualizarMapeoComponente.mockResolvedValue({
        contenido: { titulo: 'Mi gráfico', categorias: ['enero.xlsx'], valores: [300] },
      })
      renderSeccion({
        componente: {
          component_id: 'mi-grafico', type: 'chart', chart_type: 'barras_verticales',
          content: { titulo: 'Mi gráfico', categorias: ['A'], valores: [1] },
          mapeo: { disponible: true, calculo: 'chart', columna_categoria: 'Zona', columna_valor: 'Saldo' },
        },
      })
      const selector = await screen.findByLabelText('Fuente de datos de Mi gráfico')

      await userEvent.selectOptions(selector, 'historico')

      await waitFor(() => expect(carteraService.previsualizarMapeoComponente).toHaveBeenCalledWith('carga-1', {
        calculo: 'chart', titulo: 'Mi gráfico',
        mapeo: { disponible: true, calculo: 'chart', columna_categoria: 'Zona', columna_valor: 'Saldo', usa_historico: true },
      }))
    })
  })
})

describe('ComponentDataSection — antigüedad por deudor', () => {
  const COMPONENTE = {
    component_id: 'mayores-deudores',
    // `type` importa: `ComponentDataSection` solo ofrece datos configurables a un KPI o un gráfico
    // de Zona Personal (un separador o un título no calculan nada a partir de columnas).
    type: 'chart',
    mapeo: {
      disponible: true, calculo: 'antiguedad_por_deudor', columna_id: 'Zona',
      columna_fecha: 'Fecha de Vencimiento', columna_valor: 'Saldo', cuantos: 2,
    },
  }

  it('ofrece los selectores de identidad, fecha, valor y cantidad de deudores', async () => {
    // La sección se agregó como un `calculo` de primera clase justamente para que se pueda
    // reconfigurar desde acá: era la única del Dashboard Directorio que estaba quemada.
    renderSeccion({ componente: COMPONENTE })

    expect(await screen.findByLabelText('Identidad del deudor de mayores-deudores')).toHaveValue('Zona')
    expect(screen.getByLabelText('Columna de fecha de mayores-deudores')).toHaveValue('Fecha de Vencimiento')
    expect(screen.getByLabelText('Columna de valor de mayores-deudores')).toHaveValue('Saldo')
    expect(screen.getByLabelText('Cantidad de deudores de mayores-deudores')).toHaveValue(2)
  })

  it('la columna de fecha solo ofrece columnas de tipo fecha', async () => {
    renderSeccion({ componente: COMPONENTE })
    const selector = await screen.findByLabelText('Columna de fecha de mayores-deudores')
    const opciones = [...selector.querySelectorAll('option')].map((o) => o.value).filter(Boolean)
    expect(opciones).toEqual(['Fecha de Vencimiento'])
  })

  it('cambiar la cantidad de deudores recalcula el componente', async () => {
    carteraService.previsualizarMapeoComponente.mockResolvedValue({
      contenido: { titulo: 'Mayores deudores', deudores: [] },
    })
    renderSeccion({ componente: COMPONENTE })

    const campo = await screen.findByLabelText('Cantidad de deudores de mayores-deudores')
    fireEvent.change(campo, { target: { value: '4' } })

    await waitFor(() => expect(carteraService.previsualizarMapeoComponente).toHaveBeenCalledWith(
      'carga-1',
      expect.objectContaining({ mapeo: expect.objectContaining({ cuantos: 4 }) }),
    ))
  })
})
