import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ComponentPropertiesPanel from '../components/dashboard-editor/ComponentPropertiesPanel'
import * as carteraService from '../services/carteraService'
import * as dashboardLayoutService from '../services/dashboardLayoutService'

vi.mock('../services/carteraService')
vi.mock('../services/dashboardLayoutService')

function componenteDePrueba(extra = {}) {
  return {
    component_id: 'kpi-cartera-vencida',
    type: 'kpi',
    content: { titulo: 'Cartera vencida', descripcion: '' },
    styles: {},
    mapeo: {},
    width: 2,
    height: 180,
    ...extra,
  }
}

function renderPanel(overrides = {}) {
  const props = {
    componente: componenteDePrueba(),
    dashboardId: 'finanzas',
    onCerrar: vi.fn(),
    onActualizarContenido: vi.fn(),
    onActualizarEstilos: vi.fn(),
    onCambiarAncho: vi.fn(),
    onCambiarAlto: vi.fn(),
    onActualizarConfig: vi.fn(),
    onActualizarComponente: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<ComponentPropertiesPanel {...props} />) }
}

describe('ComponentPropertiesPanel — componente bloqueado (config.bloqueado)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
  })

  function componenteBloqueado(extra = {}) {
    return componenteDePrueba({ config: { bloqueado: true }, ...extra })
  }

  it('sin superusuario, deshabilita los controles de tamaño y muestra el aviso', () => {
    renderPanel({ componente: componenteBloqueado() })
    expect(screen.getByLabelText('Ancho')).toBeDisabled()
    expect(screen.getByLabelText('Alto')).toBeDisabled()
    expect(screen.getByText('Este componente está bloqueado: su tamaño no se puede cambiar.')).toBeInTheDocument()
  })

  it('con superusuario, los controles de tamaño quedan habilitados', () => {
    renderPanel({ componente: componenteBloqueado(), esSuperusuario: true })
    expect(screen.getByLabelText('Ancho')).not.toBeDisabled()
    expect(screen.getByLabelText('Alto')).not.toBeDisabled()
    expect(screen.queryByText('Este componente está bloqueado: su tamaño no se puede cambiar.')).not.toBeInTheDocument()
  })

  it('un componente sin bloquear no muestra el aviso ni deshabilita nada', () => {
    renderPanel()
    expect(screen.getByLabelText('Ancho')).not.toBeDisabled()
    expect(screen.queryByText('Este componente está bloqueado: su tamaño no se puede cambiar.')).not.toBeInTheDocument()
  })
})

describe('ComponentPropertiesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // La sección "Datos" (component_id que no es de la plantilla fija en la mayoría de estos
    // componentes de prueba) no depende de esto, pero cuando sí lo es (`kpi-cartera-vencida` no
    // lo es, así que ni siquiera llama al servicio) igual conviene un mock resuelto por defecto.
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
  })

  it('no renderiza nada cuando no hay componente seleccionado', () => {
    const { container } = renderPanel({ componente: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('editar el título invoca onActualizarContenido con el component_id y el nuevo título', async () => {
    const { props } = renderPanel()
    const campo = screen.getByLabelText('Título')

    await userEvent.type(campo, '!')

    expect(props.onActualizarContenido).toHaveBeenLastCalledWith('kpi-cartera-vencida', { titulo: 'Cartera vencida!' })
  })

  it('editar la descripción invoca onActualizarContenido', () => {
    const { props } = renderPanel()
    const campo = screen.getByLabelText('Descripción')

    fireEvent.change(campo, { target: { value: 'Detalle' } })

    expect(props.onActualizarContenido).toHaveBeenLastCalledWith('kpi-cartera-vencida', { descripcion: 'Detalle' })
  })

  it('un color hexadecimal válido invoca onActualizarEstilos y no muestra error', async () => {
    const { props } = renderPanel()
    const campo = screen.getByLabelText('Color principal (hexadecimal)')

    await userEvent.type(campo, '#1F4E78')

    expect(props.onActualizarEstilos).toHaveBeenCalledWith('kpi-cartera-vencida', { colorPrincipal: '#1F4E78' })
    expect(screen.queryByText(/color inválido/i)).not.toBeInTheDocument()
  })

  it('un color inválido muestra un error y no invoca onActualizarEstilos', async () => {
    const { props } = renderPanel()
    const campo = screen.getByLabelText('Color principal (hexadecimal)')

    await userEvent.type(campo, 'no-es-un-color')

    expect(screen.getByText(/color inválido/i)).toBeInTheDocument()
    expect(props.onActualizarEstilos).not.toHaveBeenCalled()
  })

  it('"Restablecer colores" limpia el mapa de colores por categoría, más título y fondo', async () => {
    const { props } = renderPanel({
      componente: componenteDePrueba({
        component_id: 'saldo-por-causal', type: 'chart', chart_type: 'barras_horizontales',
        content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
        styles: { coloresPorCategoria: { Quito: '#112233' }, colorTexto: '#111111', colorFondo: '#eeeeee' },
      }),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Restablecer colores' }))

    expect(props.onActualizarEstilos).toHaveBeenCalledWith('saldo-por-causal', {
      coloresPorCategoria: {}, colorTexto: '', colorFondo: '',
    })
  })

  describe('colores precargados con lo que realmente está en pantalla', () => {
    it('una tarjeta KPI no precarga ningún color (no tiene acento por defecto)', () => {
      renderPanel()
      expect(screen.getByLabelText('Color principal (hexadecimal)')).toHaveValue('')
    })

    it('una gráfica de tipo tabla no ofrece colores de datos, solo título y fondo', () => {
      renderPanel({
        componente: componenteDePrueba({ component_id: 'saldo-tabla', type: 'chart', chart_type: 'tabla' }),
      })
      expect(screen.queryByLabelText(/Color de "/)).not.toBeInTheDocument()
      expect(screen.getByLabelText('Color del título (hexadecimal)')).toHaveValue('#000000')
      expect(screen.getByLabelText('Color de fondo (hexadecimal)')).toHaveValue('#ffffff')
    })

    it('una gráfica de líneas tiene un único "Color de la línea" (es un solo trazo, no una por categoría)', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-en-el-tiempo', type: 'chart', chart_type: 'lineas',
          content: { titulo: 'Saldo en el tiempo', categorias: ['Enero', 'Febrero'] },
        }),
      })
      expect(screen.getByLabelText('Color de la línea (hexadecimal)')).toHaveValue('#2a78d6')
      expect(screen.queryByLabelText('Color de "Enero" (hexadecimal)')).not.toBeInTheDocument()
    })

    it('una gráfica de barras/pastel ofrece un selector de color por cada categoría, precargado con la paleta que se está dibujando', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'barras_horizontales',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil', 'Cuenca'] },
        }),
      })
      // Debe coincidir con --series-1/2/3 en styles/dashboard.css: son los colores que recharts
      // pinta hoy, en el mismo orden, cuando no hay overrides guardados.
      expect(screen.getByLabelText('Color de "Quito" (hexadecimal)')).toHaveValue('#2a78d6')
      expect(screen.getByLabelText('Color de "Guayaquil" (hexadecimal)')).toHaveValue('#eb6834')
      expect(screen.getByLabelText('Color de "Cuenca" (hexadecimal)')).toHaveValue('#1baf7a')
    })

    it('un override guardado para una categoría tiene prioridad sobre el color por defecto de esa categoría, sin afectar a las demás', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'barras_horizontales',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
          styles: { coloresPorCategoria: { Quito: '#abcdef' } },
        }),
      })
      expect(screen.getByLabelText('Color de "Quito" (hexadecimal)')).toHaveValue('#abcdef')
      expect(screen.getByLabelText('Color de "Guayaquil" (hexadecimal)')).toHaveValue('#eb6834')
    })

    it('cambiar el color de una categoría invoca onActualizarEstilos con el mapa completo, sin perder el color ya guardado de las demás', () => {
      const { props } = renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'barras_horizontales',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
          styles: { coloresPorCategoria: { Guayaquil: '#111111' } },
        }),
      })
      const campo = screen.getByLabelText('Color de "Quito" (hexadecimal)')
      fireEvent.change(campo, { target: { value: '#222222' } })

      expect(props.onActualizarEstilos).toHaveBeenLastCalledWith('saldo-por-causal', {
        coloresPorCategoria: { Guayaquil: '#111111', Quito: '#222222' },
      })
    })

    it('una gráfica agrupada/apilada ofrece un selector de color por cada serie, no por categoría', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-ciudad-y-causal', type: 'chart', chart_type: 'barras_agrupadas',
          content: {
            titulo: 'Saldo por ciudad y causal', categorias: ['Quito', 'Guayaquil'],
            series: [{ nombre: 'Vencido', valores: [10, 20] }, { nombre: 'No vencido', valores: [5, 8] }],
          },
        }),
      })
      expect(screen.getByLabelText('Color de "Vencido" (hexadecimal)')).toHaveValue('#2a78d6')
      expect(screen.getByLabelText('Color de "No vencido" (hexadecimal)')).toHaveValue('#eb6834')
      expect(screen.queryByLabelText('Color de "Quito" (hexadecimal)')).not.toBeInTheDocument()
    })

    it('una gráfica de área apilada ofrece un selector de color por cada serie, igual que agrupada/apilada', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-ciudad-y-causal', type: 'chart', chart_type: 'area_apilada',
          content: {
            titulo: 'Saldo por ciudad y causal', categorias: ['Quito', 'Guayaquil'],
            series: [{ nombre: 'Vencido', valores: [10, 20] }, { nombre: 'No vencido', valores: [5, 8] }],
          },
        }),
      })
      expect(screen.getByLabelText('Color de "Vencido" (hexadecimal)')).toHaveValue('#2a78d6')
      expect(screen.getByLabelText('Color de "No vencido" (hexadecimal)')).toHaveValue('#eb6834')
    })

    it('una gráfica de dispersión tiene un único "Color de los puntos" (no hay categorías ni series)', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-vs-dias-credito', type: 'chart', chart_type: 'dispersion',
          content: { titulo: 'Saldo vs. Dias credito', puntos: [{ x: 100, y: 10 }] },
        }),
      })
      expect(screen.getByLabelText('Color de los puntos (hexadecimal)')).toHaveValue('#2a78d6')
    })
  })

  describe('títulos de leyenda editables (categoría en pastel/dona, serie en agrupada/apilada/área/líneas)', () => {
    it('un tipo sin leyenda (barras_horizontales) no ofrece campos de título de leyenda', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'barras_horizontales',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
        }),
      })
      expect(screen.queryByText('Títulos de la leyenda')).not.toBeInTheDocument()
    })

    it('pastel/dona ofrecen un campo de título por cada categoría', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'dona',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
        }),
      })
      expect(screen.getByLabelText('Título de leyenda para "Quito"')).toHaveValue('')
      expect(screen.getByLabelText('Título de leyenda para "Guayaquil"')).toHaveValue('')
    })

    it('un título de leyenda ya guardado para una categoría se precarga, sin afectar a las demás', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'pastel',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
          styles: { etiquetasPorCategoria: { Quito: 'Capital' } },
        }),
      })
      expect(screen.getByLabelText('Título de leyenda para "Quito"')).toHaveValue('Capital')
      expect(screen.getByLabelText('Título de leyenda para "Guayaquil"')).toHaveValue('')
    })

    it('escribir un título de leyenda invoca onActualizarEstilos con el mapa completo por categoría, sin perder el de las demás', () => {
      const { props } = renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'pastel',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
          styles: { etiquetasPorCategoria: { Guayaquil: 'Puerto' } },
        }),
      })
      const campo = screen.getByLabelText('Título de leyenda para "Quito"')
      fireEvent.change(campo, { target: { value: 'Capital' } })

      expect(props.onActualizarEstilos).toHaveBeenLastCalledWith('saldo-por-causal', {
        etiquetasPorCategoria: { Guayaquil: 'Puerto', Quito: 'Capital' },
      })
    })

    it('"Restablecer títulos" limpia solo el mapa de títulos, sin tocar los colores', async () => {
      const { props } = renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-causal', type: 'chart', chart_type: 'pastel',
          content: { titulo: 'Saldo por causal', categorias: ['Quito', 'Guayaquil'] },
          styles: { etiquetasPorCategoria: { Quito: 'Capital' }, coloresPorCategoria: { Quito: '#112233' } },
        }),
      })

      await userEvent.click(screen.getByRole('button', { name: 'Restablecer títulos' }))

      expect(props.onActualizarEstilos).toHaveBeenCalledWith('saldo-por-causal', { etiquetasPorCategoria: {} })
    })

    it('barras agrupadas/apiladas/área/líneas múltiples ofrecen un campo de título por cada serie, no por categoría', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-ciudad-y-causal', type: 'chart', chart_type: 'barras_agrupadas',
          content: {
            titulo: 'Saldo por ciudad y causal', categorias: ['Quito', 'Guayaquil'],
            series: [{ nombre: 'Vencido', valores: [10, 20] }, { nombre: 'No vencido', valores: [5, 8] }],
          },
        }),
      })
      expect(screen.getByLabelText('Título de leyenda para "Vencido"')).toBeInTheDocument()
      expect(screen.getByLabelText('Título de leyenda para "No vencido"')).toBeInTheDocument()
      expect(screen.queryByLabelText('Título de leyenda para "Quito"')).not.toBeInTheDocument()
    })

    it('escribir un título de leyenda para una serie invoca onActualizarEstilos con etiquetasPorSerie', () => {
      const { props } = renderPanel({
        componente: componenteDePrueba({
          component_id: 'saldo-por-ciudad-y-causal', type: 'chart', chart_type: 'lineas_multiples',
          content: {
            titulo: 'Saldo por ciudad y causal', categorias: ['Quito', 'Guayaquil'],
            series: [{ nombre: 'Vencido', valores: [10, 20] }],
          },
        }),
      })
      const campo = screen.getByLabelText('Título de leyenda para "Vencido"')
      fireEvent.change(campo, { target: { value: 'Cartera vencida' } })

      expect(props.onActualizarEstilos).toHaveBeenLastCalledWith('saldo-por-ciudad-y-causal', {
        etiquetasPorSerie: { Vencido: 'Cartera vencida' },
      })
    })
  })

  it('cambiar el ancho invoca onCambiarAncho con el component_id y el número elegido', async () => {
    const { props } = renderPanel()
    await userEvent.selectOptions(screen.getByLabelText('Ancho'), '6')
    expect(props.onCambiarAncho).toHaveBeenCalledWith('kpi-cartera-vencida', 6)
  })

  it('muestra el reordenamiento de filtros solo para el panel de filtros', () => {
    renderPanel({
      componente: componenteDePrueba({
        component_id: 'panel-filtros',
        type: 'filters_panel',
        config: { filtros: [{ id: 'ciudad', label: 'Ciudad', order: 1, width: 2, is_visible: true }] },
      }),
    })
    expect(screen.getByText('Orden de los filtros')).toBeInTheDocument()
  })

  it('no muestra el reordenamiento de filtros para un componente que no es el panel de filtros', () => {
    renderPanel()
    expect(screen.queryByText('Orden de los filtros')).not.toBeInTheDocument()
  })

  it('muestra el selector de registros por defecto solo para componentes de tipo tabla', () => {
    renderPanel({
      componente: componenteDePrueba({
        component_id: 'tabla-detalle',
        type: 'table',
        config: { defaultPageSize: 10, allowedPageSizes: [5, 10, 25, 50, 100] },
      }),
    })
    expect(screen.getByText('Registros visibles por defecto')).toBeInTheDocument()
  })

  it('no muestra el selector de paginación para un componente que no es tabla', () => {
    renderPanel()
    expect(screen.queryByText('Registros visibles por defecto')).not.toBeInTheDocument()
  })

  it('cambiar el selector de registros por defecto invoca onActualizarConfig con el número elegido', async () => {
    const { props } = renderPanel({
      componente: componenteDePrueba({
        component_id: 'tabla-detalle',
        type: 'table',
        config: { defaultPageSize: 10, allowedPageSizes: [5, 10, 25, 50, 100] },
      }),
    })

    await userEvent.selectOptions(screen.getByLabelText('Registros visibles por defecto'), '50')

    expect(props.onActualizarConfig).toHaveBeenCalledWith('tabla-detalle', expect.objectContaining({ defaultPageSize: 50 }))
  })

  it('muestra el selector de posición de leyenda solo para tipos de gráfica que dibujan una leyenda', () => {
    renderPanel({
      componente: componenteDePrueba({
        component_id: 'saldo-por-causal', type: 'chart', chart_type: 'pastel',
        config: { leyenda_posicion: 'abajo' },
      }),
    })
    expect(screen.getByText('Posición de la leyenda')).toBeInTheDocument()
  })

  it('no muestra el selector de posición de leyenda para una gráfica de una sola serie', () => {
    renderPanel({
      componente: componenteDePrueba({ component_id: 'saldo-total', type: 'chart', chart_type: 'barras_horizontales', config: {} }),
    })
    expect(screen.queryByText('Posición de la leyenda')).not.toBeInTheDocument()
  })

  it('muestra el selector de posición de leyenda para área apilada', () => {
    renderPanel({
      componente: componenteDePrueba({
        component_id: 'saldo-por-ciudad-y-causal', type: 'chart', chart_type: 'area_apilada',
        config: { leyenda_posicion: 'abajo' },
      }),
    })
    expect(screen.getByText('Posición de la leyenda')).toBeInTheDocument()
  })

  it('no muestra el selector de posición de leyenda para una dispersión', () => {
    renderPanel({
      componente: componenteDePrueba({ component_id: 'saldo-vs-dias-credito', type: 'chart', chart_type: 'dispersion', config: {} }),
    })
    expect(screen.queryByText('Posición de la leyenda')).not.toBeInTheDocument()
  })

  it('cambiar la posición de la leyenda invoca onActualizarConfig con el valor elegido', async () => {
    const { props } = renderPanel({
      componente: componenteDePrueba({
        component_id: 'saldo-por-causal', type: 'chart', chart_type: 'dona',
        config: { leyenda_posicion: 'abajo' },
      }),
    })

    await userEvent.selectOptions(screen.getByLabelText('Posición de la leyenda'), 'derecha')

    expect(props.onActualizarConfig).toHaveBeenCalledWith('saldo-por-causal', expect.objectContaining({ leyenda_posicion: 'derecha' }))
  })

  describe('edición de valores de celda (tablas de Zona Personal)', () => {
    function componenteTabla(extra = {}) {
      return componenteDePrueba({
        component_id: 'tabla-top-clientes', type: 'chart', chart_type: 'tabla',
        content: {
          titulo: 'Top clientes', columnas: ['Cliente', 'Saldo'],
          filas: [['A', 100], ['B', 200]], total: ['Total', 300],
        },
        ...extra,
      })
    }

    it('muestra "Valores de la tabla" para una gráfica de tipo tabla con contenido multi-columna', () => {
      renderPanel({ componente: componenteTabla() })
      expect(screen.getByText('Valores de la tabla')).toBeInTheDocument()
    })

    it('no muestra "Valores de la tabla" para las posiciones fijas de la plantilla (type: table)', () => {
      renderPanel({
        componente: componenteDePrueba({
          component_id: 'tabla-detalle', type: 'table',
          config: { defaultPageSize: 10, allowedPageSizes: [5, 10, 25, 50, 100] },
        }),
      })
      expect(screen.queryByText('Valores de la tabla')).not.toBeInTheDocument()
    })

    it('no muestra "Valores de la tabla" para un KPI ni para otro tipo de gráfica', () => {
      renderPanel()
      expect(screen.queryByText('Valores de la tabla')).not.toBeInTheDocument()

      renderPanel({
        componente: componenteDePrueba({ component_id: 'saldo-por-causal', type: 'chart', chart_type: 'barras_horizontales' }),
      })
      expect(screen.queryByText('Valores de la tabla')).not.toBeInTheDocument()
    })

    it('editar una celda numérica y perder el foco invoca onActualizarContenido con las filas completas', () => {
      const { props } = renderPanel({ componente: componenteTabla() })

      const campo = screen.getByLabelText('Saldo — fila 1')
      fireEvent.change(campo, { target: { value: '999' } })
      fireEvent.blur(campo)

      expect(props.onActualizarContenido).toHaveBeenLastCalledWith('tabla-top-clientes', {
        filas: [['A', 999], ['B', 200]],
      })
    })

    it('editar la fila de total invoca onActualizarContenido con el total completo', () => {
      const { props } = renderPanel({ componente: componenteTabla() })

      const campo = screen.getByLabelText('Saldo — total')
      fireEvent.change(campo, { target: { value: '999' } })
      fireEvent.blur(campo)

      expect(props.onActualizarContenido).toHaveBeenLastCalledWith('tabla-top-clientes', {
        total: ['Total', 999],
      })
    })

    it('un valor no numérico en una celda que era numérica no propaga el cambio y muestra un error', () => {
      const { props } = renderPanel({ componente: componenteTabla() })

      const campo = screen.getByLabelText('Saldo — fila 1')
      fireEvent.change(campo, { target: { value: 'abc' } })
      fireEvent.blur(campo)

      expect(screen.getByText('Debe ser un número.')).toBeInTheDocument()
      expect(props.onActualizarContenido).not.toHaveBeenCalled()
    })

    it('editar una celda de texto no exige que sea numérica', () => {
      const { props } = renderPanel({ componente: componenteTabla() })

      const campo = screen.getByLabelText('Cliente — fila 1')
      fireEvent.change(campo, { target: { value: 'Nuevo nombre' } })
      fireEvent.blur(campo)

      expect(props.onActualizarContenido).toHaveBeenLastCalledWith('tabla-top-clientes', {
        filas: [['Nuevo nombre', 100], ['B', 200]],
      })
    })
  })
})


describe('ComponentPropertiesPanel — identificador del cliente (consulta por cliente)', () => {
  /**
   * Sin este selector, habilitar la búsqueda por RUC exigía editar el mapeo a mano en la base:
   * la sección de consulta no declara cálculo, así que el panel no le ofrecía ningún campo de
   * datos. El caso concreto es el de producción, cuya vista todavía no trae el identificador.
   */

  beforeEach(() => {
    vi.clearAllMocks()
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
    dashboardLayoutService.obtenerColumnasDelArchivo.mockResolvedValue({
      columnas: ['Cliente', 'Ruc Cliente', 'Saldo Total'],
    })
  })

  function componenteConsulta(mapeo = {}) {
    return componenteDePrueba({
      component_id: 'consulta-deudor',
      type: 'chart',
      config: { bloque: 'consulta-deudor' },
      mapeo: { columna_id: 'Cliente', ...mapeo },
    })
  }

  it('ofrece las columnas del archivo para elegir el identificador', async () => {
    renderPanel({ componente: componenteConsulta() })
    const selector = await screen.findByLabelText('Columna que identifica al cliente')
    expect([...selector.options].map((o) => o.value)).toEqual(['', 'Cliente', 'Ruc Cliente', 'Saldo Total'])
  })

  it('al elegir una columna la guarda en el mapeo del componente', async () => {
    const { props } = renderPanel({ componente: componenteConsulta() })
    const selector = await screen.findByLabelText('Columna que identifica al cliente')

    await userEvent.selectOptions(selector, 'Ruc Cliente')

    expect(props.onActualizarComponente).toHaveBeenCalledWith('consulta-deudor', {
      mapeo: { columna_id: 'Cliente', columna_ruc: 'Ruc Cliente' },
    })
  })

  it('sin identificador explica qué se pierde, en vez de dejarlo como un campo vacío más', async () => {
    renderPanel({ componente: componenteConsulta() })
    expect(await screen.findByText(/no se puede buscar por RUC/)).toBeInTheDocument()
  })

  it('avisa si la columna configurada ya no viene en el archivo', async () => {
    // El mapeo puede haberse guardado con un archivo anterior; la columna se conserva en la
    // lista para no hacer creer que no hay nada configurado.
    renderPanel({ componente: componenteConsulta({ columna_ruc: 'Ruc Viejo' }) })
    expect(await screen.findByText(/El archivo cargado no trae «Ruc Viejo»/)).toBeInTheDocument()
  })
})
