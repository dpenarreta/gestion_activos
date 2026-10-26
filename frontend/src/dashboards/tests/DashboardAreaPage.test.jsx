import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DashboardAreaPage from '../pages/dashboards/DashboardAreaPage'
import { useGenericDashboardBuilder } from '../hooks/useGenericDashboardBuilder'
import { useDashboardLayout } from '../hooks/useDashboardLayout'
import * as dashboardLayoutService from '../services/dashboardLayoutService'
import * as historicoService from '../services/historicoService'
import * as carteraService from '../services/carteraService'
import { useAuth } from '../context/AuthContext'
import * as pdfExport from '../utils/pdfExport'

vi.mock('../hooks/useGenericDashboardBuilder')
vi.mock('../hooks/useDashboardLayout')
vi.mock('../services/dashboardLayoutService')
vi.mock('../services/historicoService')
vi.mock('../services/carteraService')
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../utils/pdfExport')

const FASE = { CARGA: 'CARGA', RENOMBRAR: 'RENOMBRAR', VALORES_EN_BLANCO: 'VALORES_EN_BLANCO', MAPEO: 'MAPEO' }

function builderBase(overrides = {}) {
  return {
    FASE,
    fase: FASE.CARGA,
    archivoInfo: null,
    columnasOriginales: [],
    aliases: {},
    columnas: [],
    mapeo: {},
    datos: {},
    columnasConBlancos: [],
    valoresBlancos: {},
    columnasHistoricas: [],
    columnasHistoricasFinales: [],
    cargando: false,
    cargandoPreview: false,
    error: null,
    subirYValidar: vi.fn(),
    cambiarHoja: vi.fn(),
    actualizarAlias: vi.fn(),
    cancelarRenombrado: vi.fn(),
    confirmarRenombrado: vi.fn(),
    actualizarValorBlanco: vi.fn(),
    confirmarValoresBlancos: vi.fn(),
    cancelarValoresBlancos: vi.fn(),
    actualizarColumnaHistorica: vi.fn(),
    inicializarColumnasHistoricas: vi.fn(),
    actualizarMapeoSlot: vi.fn(),
    cancelarMapeo: vi.fn(),
    confirmarMapeo: vi.fn().mockResolvedValue({ ok: true }),
    limpiar: vi.fn(),
    ...overrides,
  }
}

function layoutBase(overrides = {}) {
  return {
    layoutGuardado: { version: 1, components: [] },
    borrador: [],
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
    recargar: vi.fn(),
    ...overrides,
  }
}

const KPI_COMPONENTE = {
  component_id: 'kpi-1', type: 'kpi', chart_type: '', row: 1, order: 1, width: 3, height: 180,
  is_visible: true, content: { titulo: 'Total ventas', valor: 1234 }, styles: {}, config: {},
}

const CHART_COMPONENTE = {
  component_id: 'grafico-1', type: 'chart', chart_type: 'barras_verticales', row: 1, order: 2, width: 6, height: 420,
  is_visible: true, content: { titulo: 'Ventas por ciudad', categorias: ['Quito', 'Guayaquil'], valores: [100, 50] }, styles: {}, config: {},
}

function renderPagina(dashboardId = 'finanzas') {
  return render(
    <MemoryRouter initialEntries={[`/admin/dashboards/${dashboardId}`]}>
      <Routes>
        <Route path="/admin/dashboards/:dashboardId" element={<DashboardAreaPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DashboardAreaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    useAuth.mockReturnValue({ user: { permissions: [] } })
    // La página pide `columnasHistoricasConfiguradas` siempre (Tabla 3 la necesita también
    // fuera del asistente de carga) — sin este default, cualquier test que no le interese esa
    // parte rompería al llamar `.then` sobre un mock sin resolver.
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [], columnas_disponibles: [], columnas_historicas_configuradas: [],
    })
    // `AgregarComponentePersonalModal` (siempre montado, oculto por defecto) pide el archivo
    // actual apenas se abre — sin este default, un test que active el modal rompería al llamar
    // `.then()` sobre un mock sin resolver.
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
    // Se pide apenas el layout guardado está disponible (ver efecto de `hallazgosIA` en
    // `DashboardAreaPage.jsx`) — sin este default, cualquier test rompería al llamar `.then()`
    // sobre un mock sin resolver.
    dashboardLayoutService.generarHallazgosIA.mockResolvedValue({ hallazgos: {} })
    // Vista/procedimiento configurado para este dashboard (`ConfigurarFuenteBDModal`) — sin este
    // default, cualquier test rompería al llamar `.then()` sobre un mock sin resolver. Sin fuente
    // configurada por defecto, igual que un dashboard recién creado.
    dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({ tipo: '', nombre: '' })
  })

  it('muestra el nombre y el área del dashboard, resueltos por dashboard_id', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase())
    renderPagina()

    expect(await screen.findByRole('heading', { name: 'Finanzas' })).toBeInTheDocument()
    expect(screen.getByText(/Finanzas y Contabilidad/)).toBeInTheDocument()
    expect(useDashboardLayout).toHaveBeenCalledWith('finanzas')
  })

  it('sin acceso al dashboard (403 en la carga inicial), muestra el error en vez de spinnear indefinidamente', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({
      layoutGuardado: null, error: 'No tiene permiso para ver este dashboard.',
    }))
    renderPagina()

    expect(await screen.findByText('No tiene permiso para ver este dashboard.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('en una pestaña que no es la raíz, el título y el área siguen siendo los de la raíz, no los de la pestaña', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      { dashboard_id: 'finanzas-2', name: 'Vista regional', orden: 2 },
    ])
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase())
    renderPagina('finanzas-2')

    expect(await screen.findByRole('heading', { name: 'Finanzas' })).toBeInTheDocument()
    expect(screen.getByText(/Finanzas y Contabilidad/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vista regional' })).not.toBeInTheDocument()
  })

  it('por defecto muestra el grid con las posiciones de la plantilla, no la zona de carga', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE, CHART_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    expect(screen.getByText('Total ventas')).toBeInTheDocument()
    expect(screen.getByText('Ventas por ciudad')).toBeInTheDocument()
    expect(screen.queryByTestId('input-archivo')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar otro archivo' })).toBeInTheDocument()
  })

  it('"Imprimir como PDF" captura el dashboard con html2canvas/jsPDF (utils/pdfExport)', async () => {
    let resolverGeneracion
    pdfExport.generarPDFDesdeElemento.mockReturnValue(new Promise((resolve) => { resolverGeneracion = resolve }))
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase())
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    const boton = screen.getByRole('button', { name: /Imprimir como PDF/ })
    await userEvent.click(boton)

    expect(pdfExport.generarPDFDesdeElemento).toHaveBeenCalledTimes(1)
    expect(pdfExport.generarPDFDesdeElemento.mock.calls[0][1]).toBe('Finanzas.pdf')
    expect(boton).toBeDisabled()

    resolverGeneracion()
    await waitFor(() => expect(boton).not.toBeDisabled())
  })

  it('"Imprimir como PDF" con error muestra un mensaje, sin romper la página', async () => {
    pdfExport.generarPDFDesdeElemento.mockRejectedValue(new Error('boom'))
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase())
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    await userEvent.click(screen.getByRole('button', { name: /Imprimir como PDF/ }))

    expect(await screen.findByText('No se pudo generar el PDF. Intentá de nuevo.')).toBeInTheDocument()
  })

  it('el PDF solo muestra el nombre y el área del dashboard — todo el resto del "chrome" queda marcado d-print-none', async () => {
    dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
      tipo: '', nombre: '', frecuencia_actualizacion: '', ultima_actualizacion: null, proxima_actualizacion: null,
    })
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase())
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await screen.findByText('Última actualización: Nunca')

    // Se mantienen (no d-print-none): el título del dashboard y el área.
    expect(screen.getByRole('heading', { name: 'Finanzas' })).not.toHaveClass('d-print-none')
    expect(screen.getByText(/Finanzas y Contabilidad/)).not.toHaveClass('d-print-none')

    // Se excluyen del PDF: la fila de botones del encabezado, la fila de "Última actualización",
    // la barra de pestañas y la fila "Diseño del dashboard" / "Editar dashboard".
    expect(screen.getByRole('button', { name: 'Conectar vista de base de datos' }).closest('.d-print-none')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Cargar otro archivo' }).closest('.d-print-none')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Imprimir como PDF/ }).closest('.d-print-none')).not.toBeNull()
    expect(screen.getByText('Última actualización: Nunca').closest('.d-print-none')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Finanzas' }).closest('.d-print-none')).not.toBeNull()
    expect(screen.getByText('Diseño del dashboard').closest('.d-print-none')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Editar dashboard' }).closest('.d-print-none')).not.toBeNull()
  })

  it('"Cargar otro archivo" muestra la zona de carga; "Cancelar" vuelve a mostrar el grid y llama a limpiar()', async () => {
    const limpiar = vi.fn()
    useGenericDashboardBuilder.mockReturnValue(builderBase({ limpiar }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))
    expect(screen.getByTestId('input-archivo')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(limpiar).toHaveBeenCalled()
    expect(screen.getByText('Total ventas')).toBeInTheDocument()
  })

  it('en fase RENOMBRAR, muestra el paso de renombrar columnas', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.RENOMBRAR,
      archivoInfo: { nombreArchivo: 'datos.xlsx', totalFilas: 10 },
      columnasOriginales: ['Saldo', 'Ciudad'],
      aliases: { Saldo: 'Saldo', Ciudad: 'Ciudad' },
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    expect(screen.getByText(/datos\.xlsx/)).toBeInTheDocument()
    expect(screen.getByLabelText('Nuevo nombre para Saldo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument()
  })

  it('"Continuar" en el paso de renombrar llama a confirmarRenombrado()', async () => {
    const confirmarRenombrado = vi.fn()
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.RENOMBRAR, columnasOriginales: ['Saldo'], aliases: { Saldo: 'Saldo' }, confirmarRenombrado,
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(confirmarRenombrado).toHaveBeenCalled()
  })

  it('en fase VALORES_EN_BLANCO, muestra el paso de valores en blanco', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.VALORES_EN_BLANCO,
      archivoInfo: { nombreArchivo: 'datos.xlsx', totalFilas: 20 },
      columnasConBlancos: [{ columna: 'Alterno Cliente', cantidad_en_blanco: 15, filas_ejemplo: [] }],
      columnas: [{ nombre: 'Alterno Cliente', tipo: 'vacio', apta_para_valor: false, apta_para_categoria: false }],
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    expect(screen.getByText('Valores en blanco')).toBeInTheDocument()
    expect(screen.getByText('Alterno Cliente')).toBeInTheDocument()
    expect(screen.getByLabelText('Valor de reemplazo para Alterno Cliente')).toBeInTheDocument()
  })

  it('"Continuar" en el paso de valores en blanco llama a confirmarValoresBlancos()', async () => {
    const confirmarValoresBlancos = vi.fn()
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.VALORES_EN_BLANCO,
      columnasConBlancos: [{ columna: 'Alterno Cliente', cantidad_en_blanco: 15, filas_ejemplo: [] }],
      confirmarValoresBlancos,
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(confirmarValoresBlancos).toHaveBeenCalled()
  })

  it('"Cancelar" en el paso de valores en blanco llama a cancelarValoresBlancos()', async () => {
    const cancelarValoresBlancos = vi.fn()
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.VALORES_EN_BLANCO,
      columnasConBlancos: [{ columna: 'Alterno Cliente', cantidad_en_blanco: 15, filas_ejemplo: [] }],
      cancelarValoresBlancos,
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(cancelarValoresBlancos).toHaveBeenCalled()
  })

  it('"Cancelar" en el paso de renombrar llama a cancelarRenombrado()', async () => {
    const cancelarRenombrado = vi.fn()
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.RENOMBRAR, columnasOriginales: ['Saldo'], aliases: { Saldo: 'Saldo' }, cancelarRenombrado,
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(cancelarRenombrado).toHaveBeenCalled()
  })

  describe('advertencia de columnas históricas en el paso de renombrar', () => {
    it('sin ninguna columna histórica configurada, no muestra advertencia', async () => {
      historicoService.listarCargasHistoricas.mockResolvedValue({
        cargas: [], columnas_disponibles: [], columnas_historicas_configuradas: [],
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase({
        fase: FASE.RENOMBRAR, columnasOriginales: ['Costo'], aliases: { Costo: 'Costo' },
      }))
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })
      await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

      expect(screen.getByLabelText('Nuevo nombre para Costo')).toBeInTheDocument()
      expect(screen.queryByText(/estaban marcadas como históricas/)).not.toBeInTheDocument()
    })

    it('con una columna histórica configurada que no está en el archivo nuevo, advierte', async () => {
      historicoService.listarCargasHistoricas.mockResolvedValue({
        cargas: [], columnas_disponibles: ['Ventas', 'Costo'], columnas_historicas_configuradas: ['Ventas', 'Costo'],
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase({
        fase: FASE.RENOMBRAR, columnasOriginales: ['Costo'], aliases: { Costo: 'Costo' },
      }))
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })
      await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

      expect(historicoService.listarCargasHistoricas).toHaveBeenCalledWith('finanzas')
      expect(await screen.findByText(/estaban marcadas como históricas/)).toBeInTheDocument()
      expect(screen.getByText(/"Ventas"/)).toBeInTheDocument()
    })

    it('con las columnas históricas configuradas presentes en el archivo, no muestra advertencia', async () => {
      historicoService.listarCargasHistoricas.mockResolvedValue({
        cargas: [], columnas_disponibles: ['Ventas'], columnas_historicas_configuradas: ['Ventas'],
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase({
        fase: FASE.RENOMBRAR, columnasOriginales: ['Ventas'], aliases: { Ventas: 'Ventas' },
      }))
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })
      await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

      await waitFor(() => expect(historicoService.listarCargasHistoricas).toHaveBeenCalled())
      expect(screen.queryByText(/estaban marcadas como históricas/)).not.toBeInTheDocument()
    })
  })

  it('en fase MAPEO, muestra el paso de mapeo a la plantilla', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.MAPEO,
      archivoInfo: { nombreArchivo: 'datos.xlsx', totalFilas: 10 },
      columnas: [{ nombre: 'Saldo', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false }],
      mapeo: { 'kpi-1': { disponible: true, columna_valor: 'Saldo' } },
      datos: { 'kpi-1': { titulo: 'KPI 1', valor: 1000, formato: 'numero' } },
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    // El paso de mapeo solo se muestra dentro del constructor, que arranca oculto.
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    expect(screen.getByText(/datos\.xlsx/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar a la plantilla' })).toBeInTheDocument()
  })

  it('en fase MAPEO, con una columna con blancos marcada como histórica, muestra el aviso con el badge histórico', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase({
      fase: FASE.MAPEO,
      archivoInfo: { nombreArchivo: 'datos.xlsx', totalFilas: 10 },
      columnas: [{ nombre: 'Saldo', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false }],
      mapeo: { 'kpi-1': { disponible: true, columna_valor: 'Saldo' } },
      datos: { 'kpi-1': { titulo: 'KPI 1', valor: 1000, formato: 'numero' } },
      columnasConBlancos: [{ columna: 'Saldo', cantidad_en_blanco: 5, filas_ejemplo: [] }],
      columnasHistoricasFinales: ['Saldo'],
    }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    expect(screen.getByText('Columnas con valores en blanco')).toBeInTheDocument()
    expect(screen.getByText(/usada en Tabla 3 \(histórica\)/)).toBeInTheDocument()
  })

  it('confirmar el mapeo recarga el layout y vuelve a mostrar el grid', async () => {
    const confirmarMapeo = vi.fn().mockResolvedValue({ ok: true })
    const recargar = vi.fn()
    useGenericDashboardBuilder.mockReturnValue(builderBase({ fase: FASE.MAPEO, confirmarMapeo }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE], recargar }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar a la plantilla' }))

    expect(confirmarMapeo).toHaveBeenCalled()
    expect(recargar).toHaveBeenCalled()
    expect(screen.getByText('Total ventas')).toBeInTheDocument()
  })

  it('cancelar desde el paso de mapeo llama a cancelarMapeo()', async () => {
    const cancelarMapeo = vi.fn()
    useGenericDashboardBuilder.mockReturnValue(builderBase({ fase: FASE.MAPEO, cancelarMapeo }))
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Cargar otro archivo' }))

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(cancelarMapeo).toHaveBeenCalled()
  })

  describe('"Conectar vista de base de datos"', () => {
    it('el botón siempre está habilitado y abre el modal de conexión', async () => {
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()
      const boton = await screen.findByRole('button', { name: 'Conectar vista de base de datos' })
      expect(boton).not.toBeDisabled()

      await userEvent.click(boton)

      await screen.findByLabelText('Tipo de fuente')
      expect(screen.getAllByText('Conectar vista de base de datos')).toHaveLength(2) // el botón y el título del modal
    })

    it('completar tipo/nombre y confirmar guarda la configuración, conecta y revela el asistente', async () => {
      dashboardLayoutService.actualizarFuenteBD.mockResolvedValue({ tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: {} })
      const conectarFuenteBD = vi.fn().mockResolvedValue({ ok: true })
      useGenericDashboardBuilder.mockReturnValue(builderBase({ conectarFuenteBD }))
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()
      await userEvent.click(await screen.findByRole('button', { name: 'Conectar vista de base de datos' }))
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_Reporte')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
        'finanzas',
        { tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: {}, fechaFormato: 'YYYY-MM-DD', frecuenciaActualizacion: '' },
      ))
      await waitFor(() => expect(conectarFuenteBD).toHaveBeenCalledTimes(1))
      // Con `ok: true`, `builderBase()` sigue en FASE.CARGA por defecto — lo que importa acá es
      // que no aparezca el mensaje fijo de error de conexión.
      expect(screen.queryByText(/Error de conexión/)).not.toBeInTheDocument()
    })

    it('una conexión fallida no revela el asistente ni cierra el modal: muestra el mensaje fijo y limpia el estado a medio armar', async () => {
      dashboardLayoutService.actualizarFuenteBD.mockResolvedValue({ tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: {} })
      const conectarFuenteBD = vi.fn().mockResolvedValue({ ok: false })
      const limpiar = vi.fn().mockResolvedValue()
      useGenericDashboardBuilder.mockReturnValue(builderBase({ conectarFuenteBD, limpiar }))
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()
      await userEvent.click(await screen.findByRole('button', { name: 'Conectar vista de base de datos' }))
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_no_existe')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      // El mensaje aparece DENTRO del modal (que sigue abierto) — nunca se llegó a mostrar el
      // asistente de columnas.
      expect(await screen.findByText(
        'Error de conexión: No se encontró la vista seleccionada. Por favor, comuníquese con el departamento de TI.',
      )).toBeInTheDocument()
      expect(limpiar).toHaveBeenCalledTimes(1)
      expect(screen.queryByLabelText('Tipo de fuente')).not.toBeInTheDocument()

      // Recién "Aceptar" cierra el modal y vuelve al dashboard.
      await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }))
      await waitFor(() => expect(screen.queryByText(/Error de conexión/)).not.toBeInTheDocument())
      expect(screen.getByText('Diseño del dashboard')).toBeInTheDocument()
    })

    it('borrar todos los datos confirma con el nombre del dashboard, borra y refresca layout/fuente BD', async () => {
      dashboardLayoutService.borrarDatosDashboard.mockResolvedValue()
      const layout = layoutBase()
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layout)
      renderPagina()
      await userEvent.click(await screen.findByRole('button', { name: 'Conectar vista de base de datos' }))
      await screen.findByLabelText('Tipo de fuente')

      await userEvent.click(screen.getByRole('button', { name: 'Borrar todos los datos' }))
      await userEvent.type(screen.getByLabelText('Confirmar nombre del dashboard'), 'Finanzas')
      await userEvent.click(screen.getByRole('button', { name: 'Borrar todo' }))

      await waitFor(() => expect(dashboardLayoutService.borrarDatosDashboard).toHaveBeenCalledWith('finanzas', 'Finanzas'))
      await waitFor(() => expect(layout.recargar).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.queryByLabelText('Tipo de fuente')).not.toBeInTheDocument())
    })

    it('cancelar el modal no guarda ni conecta nada', async () => {
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()
      await userEvent.click(await screen.findByRole('button', { name: 'Conectar vista de base de datos' }))
      await screen.findByLabelText('Tipo de fuente')

      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

      expect(dashboardLayoutService.actualizarFuenteBD).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByLabelText('Tipo de fuente')).not.toBeInTheDocument())
    })
  })

  describe('estado de actualización de datos (bajo los botones del encabezado)', () => {
    it('sin fuente configurada y sin nunca haber cargado datos, igual muestra los 3 valores: "Nunca", sin próxima automática y el ícono', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: '', nombre: '', frecuencia_actualizacion: '', ultima_actualizacion: null, proxima_actualizacion: null,
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()

      expect(await screen.findByText('Última actualización: Nunca')).toBeInTheDocument()
      expect(screen.queryByText(/Próxima actualización automática/)).not.toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /Actualizar ahora/ })).toBeInTheDocument()
    })

    it('la fila de "Última actualización" queda marcada d-print-none (afuera del PDF)', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: '', nombre: '', frecuencia_actualizacion: '', ultima_actualizacion: null, proxima_actualizacion: null,
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()

      const fila = (await screen.findByText('Última actualización: Nunca')).closest('div')
      expect(fila).toHaveClass('d-print-none')
    })

    it('sin fuente configurada, el ícono "Actualizar ahora" abre el modal de conexión en vez de llamar al servicio de actualización instantánea', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: '', nombre: '', frecuencia_actualizacion: '', ultima_actualizacion: null, proxima_actualizacion: null,
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()

      await userEvent.click(await screen.findByRole('button', { name: /Actualizar ahora/ }))

      await screen.findByLabelText('Tipo de fuente')
      expect(carteraService.actualizarFuenteBDAhora).not.toHaveBeenCalled()
    })

    // Fecha ISO local (no `toISOString()`, que usa UTC y podría correr un día según la zona
    // horaria) de "hoy menos N días" — mismo criterio de armado que `diasDesdeISO` en el
    // componente, para que el test sea determinístico sin importar en qué día corra de verdad.
    function isoHaceNDias(n) {
      const objetivo = new Date()
      objetivo.setDate(objetivo.getDate() - n)
      const mes = String(objetivo.getMonth() + 1).padStart(2, '0')
      const dia = String(objetivo.getDate()).padStart(2, '0')
      return `${objetivo.getFullYear()}-${mes}-${dia}`
    }

    it('muestra la fecha de la última actualización junto con los días transcurridos', async () => {
      const iso = isoHaceNDias(3)
      const [anio, mes, dia] = iso.split('-')
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: '', nombre: '', frecuencia_actualizacion: '', ultima_actualizacion: iso, proxima_actualizacion: null,
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()

      expect(await screen.findByText(`Última actualización: ${dia}/${mes}/${anio} (3 D)`)).toBeInTheDocument()
    })

    it('actualizado hoy mismo muestra "(0 D)"', async () => {
      const iso = isoHaceNDias(0)
      const [anio, mes, dia] = iso.split('-')
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: '', nombre: '', frecuencia_actualizacion: '', ultima_actualizacion: iso, proxima_actualizacion: null,
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()

      expect(await screen.findByText(`Última actualización: ${dia}/${mes}/${anio} (0 D)`)).toBeInTheDocument()
    })

    it('con frecuencia automática configurada, muestra la próxima actualización en vez del ícono', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'vista', nombre: 'dbo.v', frecuencia_actualizacion: 'semanal',
        ultima_actualizacion: '2026-08-09', proxima_actualizacion: '2026-08-16',
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()

      expect(await screen.findByText(/Próxima actualización automática: 16\/08\/2026/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Actualizar ahora/ })).not.toBeInTheDocument()
    })

    it('con fuente configurada pero sin frecuencia automática, muestra el ícono "Actualizar ahora"', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'vista', nombre: 'dbo.v', frecuencia_actualizacion: '', ultima_actualizacion: '2026-08-09', proxima_actualizacion: null,
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase())
      renderPagina()

      expect(await screen.findByRole('button', { name: /Actualizar ahora/ })).toBeInTheDocument()
      expect(screen.queryByText(/Próxima actualización automática/)).not.toBeInTheDocument()
    })

    it('clic en "Actualizar ahora" llama al servicio y, si sale bien, recarga el layout', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'vista', nombre: 'dbo.v', frecuencia_actualizacion: '', ultima_actualizacion: '2026-08-09', proxima_actualizacion: null,
      })
      carteraService.actualizarFuenteBDAhora.mockResolvedValue({ ok: true, mensaje: 'Actualizado con 10 fila(s).' })
      const recargar = vi.fn()
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ recargar }))
      renderPagina()

      await userEvent.click(await screen.findByRole('button', { name: /Actualizar ahora/ }))

      await waitFor(() => expect(carteraService.actualizarFuenteBDAhora).toHaveBeenCalledWith('finanzas', undefined))
      await waitFor(() => expect(recargar).toHaveBeenCalled())
    })

    it('con un procedimiento con fecha, "Actualizar ahora" pide la fecha (sugiere hoy) y la envía', async () => {
      // Sin frecuencia no hay período que avanzar: sin este paso se reenviaba la fecha guardada y el
      // procedimiento devolvía los mismos datos de la vez anterior.
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'procedimiento', nombre: 'dbo.sp_cartera', parametros: { FechaCorte: '2026-09-30' },
        frecuencia_actualizacion: '', ultima_actualizacion: '2026-09-30', proxima_actualizacion: null,
      })
      carteraService.actualizarFuenteBDAhora.mockResolvedValue({ ok: true, mensaje: 'Actualizado con 10 fila(s).' })
      const recargar = vi.fn()
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ recargar }))
      renderPagina()

      await userEvent.click(await screen.findByRole('button', { name: /Actualizar ahora/ }))

      const campo = await screen.findByLabelText(/Fecha de corte/)
      const hoy = new Date()
      const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
      expect(campo).toHaveValue(hoyISO)
      expect(screen.getByText(/Última usada: 30\/09\/2026/)).toBeInTheDocument()
      expect(carteraService.actualizarFuenteBDAhora).not.toHaveBeenCalled()

      fireEvent.change(campo, { target: { value: '2026-10-13' } })
      await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }))

      await waitFor(() => expect(carteraService.actualizarFuenteBDAhora).toHaveBeenCalledWith('finanzas', '2026-10-13'))
      await waitFor(() => expect(recargar).toHaveBeenCalled())
    })

    it('clic en "Actualizar ahora" con ok:false muestra el mensaje devuelto, sin recargar el layout', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'vista', nombre: 'dbo.v', frecuencia_actualizacion: '', ultima_actualizacion: null, proxima_actualizacion: null,
      })
      carteraService.actualizarFuenteBDAhora.mockResolvedValue({
        ok: false, mensaje: 'Este dashboard nunca tuvo un mapeo confirmado manualmente.',
      })
      const recargar = vi.fn()
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ recargar }))
      renderPagina()

      await userEvent.click(await screen.findByRole('button', { name: /Actualizar ahora/ }))

      expect(await screen.findByText('Este dashboard nunca tuvo un mapeo confirmado manualmente.')).toBeInTheDocument()
      expect(recargar).not.toHaveBeenCalled()
    })
  })

  it('la descripción guardada de un KPI y de una gráfica se muestran en el grid', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({
      borrador: [
        { ...KPI_COMPONENTE, content: { ...KPI_COMPONENTE.content, descripcion: 'Suma de ventas del mes.' } },
        { ...CHART_COMPONENTE, content: { ...CHART_COMPONENTE.content, descripcion: 'Ventas agrupadas por ciudad.' } },
      ],
    }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    expect(screen.getByText('Suma de ventas del mes.')).toBeInTheDocument()
    expect(screen.getByText('Ventas agrupadas por ciudad.')).toBeInTheDocument()
  })

  it('un componente de tipo dispersión y uno de área apilada se renderizan en el grid', async () => {
    const DISPERSION_COMPONENTE = {
      component_id: 'grafico-6', type: 'chart', chart_type: 'dispersion', row: 1, order: 3, width: 6, height: 420,
      is_visible: true, content: { titulo: 'Saldo vs. Dias credito', puntos: [{ x: 100, y: 10 }] }, styles: {}, config: {},
    }
    const AREA_APILADA_COMPONENTE = {
      component_id: 'grafico-3', type: 'chart', chart_type: 'area_apilada', row: 1, order: 4, width: 6, height: 420,
      is_visible: true,
      content: {
        titulo: 'Saldo por ciudad y causal', categorias: ['Quito', 'Guayaquil'],
        series: [{ nombre: 'Vencido', valores: [10, 20] }],
      },
      styles: {}, config: {},
    }
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [DISPERSION_COMPONENTE, AREA_APILADA_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    expect(screen.getByText('Saldo vs. Dias credito')).toBeInTheDocument()
    expect(screen.getByText('Saldo por ciudad y causal')).toBeInTheDocument()
  })

  it('una tabla multi-columna (Tabla 1) se renderiza en el grid', async () => {
    const TABLA_COMPONENTE = {
      component_id: 'tabla-1', type: 'chart', chart_type: 'tabla', row: 1, order: 5, width: 12, height: 380,
      is_visible: true,
      content: {
        titulo: 'Tabla 1', columnas: ['Producto', 'Ventas', '% del total'],
        filas: [['A', 100, 100]], total: ['Total', 100, 100],
      },
      styles: {}, config: {},
    }
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [TABLA_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    expect(screen.getByText('Tabla 1')).toBeInTheDocument()
    expect(screen.getByText('% del total')).toBeInTheDocument()
  })

  it('un componente de la Zona Personal (config.zona=personal) se renderiza en el grid, fuera del modo edición', async () => {
    const KPI_PERSONAL = {
      component_id: 'mi-kpi', type: 'kpi', chart_type: '', row: 1, order: 20, width: 6, height: 180,
      is_visible: true, content: { titulo: 'Mi KPI personal', valor: 42 }, styles: {}, config: { zona: 'personal' },
    }
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE, KPI_PERSONAL] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    expect(screen.getByText('Mi KPI personal')).toBeInTheDocument()
    // Fuera de modo edición no hay ningún recuadro/rótulo de zona — solo aparece en el editor.
    expect(screen.queryByText('Zona personal')).not.toBeInTheDocument()
  })

  describe('panel de paleta de componentes (Zona Personal)', () => {
    it('fuera de modo edición, el panel de paleta no aparece', async () => {
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ modoEdicion: false }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(screen.queryByText('Componentes')).not.toBeInTheDocument()
    })

    it('"Guardar cambios" en un dashboard bloqueado abre el cuadro de contraseña', async () => {
      // La prueba que faltaba. `EditModeToolbar` usa `onClick={onGuardar}`, así que el handler
      // recibe el EVENTO de React como primer argumento; el envoltorio lo tomaba por la
      // contraseña y axios moría al serializarlo, antes de hacer la petición. En pantalla se veía
      // "No se pudo guardar la configuración" y ningún cuadro donde escribir nada.
      const guardar = vi.fn(async (clave) => (clave
        ? { ok: true }
        : { ok: false, requiereConfirmacion: true, mensaje: 'El diseño está bloqueado.' }))
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({
        modoEdicion: true, guardar,
        layoutGuardado: { version: 1, components: [], estructura_bloqueada: true },
      }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

      expect(await screen.findByText('Confirmá tu contraseña')).toBeInTheDocument()
      // Lo que se le pasó a `guardar` no puede ser un evento: o es la contraseña, o nada.
      expect(guardar.mock.calls[0][0]).toBeUndefined()
    })

    it('la contraseña escrita llega a la operación que se estaba guardando', async () => {
      const guardar = vi.fn(async (clave) => (clave
        ? { ok: true }
        : { ok: false, requiereConfirmacion: true, mensaje: 'El diseño está bloqueado.' }))
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({
        modoEdicion: true, guardar,
        layoutGuardado: { version: 1, components: [], estructura_bloqueada: true },
      }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })
      await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
      await screen.findByText('Confirmá tu contraseña')

      await userEvent.type(screen.getByLabelText('Contraseña'), 'mi-clave')
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

      await waitFor(() => expect(guardar).toHaveBeenCalledWith('mi-clave'))
    })

    it('en modo edición, el panel de paleta se abre solo (sin acción adicional del usuario)', async () => {
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ modoEdicion: true }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(await screen.findByText('Componentes')).toBeInTheDocument()
      expect(screen.getByText('Separador')).toBeInTheDocument()
      expect(screen.getByText('Título')).toBeInTheDocument()
      expect(screen.getByText('Tarjeta KPI')).toBeInTheDocument()
      expect(screen.getByText('Gráfico')).toBeInTheDocument()
      expect(screen.getByText('Tabla')).toBeInTheDocument()
    })

    it('clic en "Separador" (sin cambios sin guardar) lo agrega de inmediato y recarga', async () => {
      const recargar = vi.fn()
      dashboardLayoutService.agregarComponentePresentacional.mockResolvedValue({})
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ modoEdicion: true, hayCambiosSinGuardar: () => false, recargar }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      await userEvent.click(await screen.findByText('Separador'))

      await waitFor(() => expect(dashboardLayoutService.agregarComponentePresentacional).toHaveBeenCalledWith(
        'finanzas', { tipo: 'text', zona: 'personal' },
      ))
      await waitFor(() => expect(recargar).toHaveBeenCalled())
      expect(screen.queryByText('Agregar a la Zona Personal')).not.toBeInTheDocument()
    })

    it('clic en "Gráfico" abre el modal de configuración, preseleccionado en ese tipo', async () => {
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ modoEdicion: true, hayCambiosSinGuardar: () => false }))
      carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      await userEvent.click(await screen.findByText('Gráfico'))

      expect(await screen.findByText('Agregar a la Zona Personal')).toBeInTheDocument()
      expect(dashboardLayoutService.agregarComponentePresentacional).not.toHaveBeenCalled()
    })

    it('con cambios sin guardar, pide confirmación antes de agregar', async () => {
      dashboardLayoutService.agregarComponentePresentacional.mockResolvedValue({})
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ modoEdicion: true, hayCambiosSinGuardar: () => true }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      await userEvent.click(await screen.findByText('Título'))

      expect(dashboardLayoutService.agregarComponentePresentacional).not.toHaveBeenCalled()
      expect(screen.getByText(/se guarda de inmediato y actualiza el/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
      await waitFor(() => expect(dashboardLayoutService.agregarComponentePresentacional).toHaveBeenCalledWith(
        'finanzas', { tipo: 'title', zona: 'personal' },
      ))
    })

    it('abrir "Configurar" de un componente existente oculta el panel de paleta', async () => {
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({
        modoEdicion: true, borrador: [KPI_COMPONENTE], seleccionado: 'kpi-1',
      }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(screen.queryByText('Componentes')).not.toBeInTheDocument()
    })
  })

  it('un componente oculto (is_visible=false) no se renderiza fuera del modo edición', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({
      borrador: [{ ...KPI_COMPONENTE, is_visible: false }],
    }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    expect(screen.queryByText('Total ventas')).not.toBeInTheDocument()
  })

  describe('Tabla 3 (comparación histórica en vivo)', () => {
    const TABLA_3 = {
      component_id: 'tabla-3', type: 'chart', chart_type: 'tabla', row: 1, order: 11, width: 6, height: 340,
      is_visible: true,
      content: { titulo: 'Tabla 3', columnas: ['Producto', 'Ventas'], filas: [['A', 100]] },
      styles: {}, config: {}, mapeo: {},
    }

    it('sin columnas históricas configuradas, muestra el contenido normal (con la etiqueta "Histórica") sin comparar', async () => {
      historicoService.listarCargasHistoricas.mockResolvedValue({
        cargas: [], columnas_disponibles: [], columnas_historicas_configuradas: [],
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [TABLA_3] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(await screen.findByText('Tabla 3')).toBeInTheDocument()
      expect(screen.getByText('Histórica')).toBeInTheDocument()
      expect(historicoService.calcularTablaHistorica).not.toHaveBeenCalled()
    })

    it('con columnas históricas configuradas pero sin cargas históricas, cae al contenido normal', async () => {
      historicoService.listarCargasHistoricas.mockResolvedValue({
        cargas: [], columnas_disponibles: [], columnas_historicas_configuradas: ['Ventas'],
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [TABLA_3] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(await screen.findByText('Tabla 3')).toBeInTheDocument()
      expect(screen.getAllByText('A').length).toBeGreaterThan(0)
      expect(historicoService.calcularTablaHistorica).not.toHaveBeenCalled()
    })

    it('con columnas históricas configuradas y cargas históricas, muestra la tabla comparativa (con la etiqueta "Histórica") en vez del contenido normal', async () => {
      historicoService.listarCargasHistoricas.mockResolvedValue({
        cargas: [{ carga_id: 'c1', nombre_original: 'enero.xlsx', fecha_carga: '2026-01-01T00:00:00', fecha_corte: null, total_filas: 5 }],
        columnas_disponibles: ['Ventas'],
        columnas_historicas_configuradas: ['Ventas'],
      })
      historicoService.calcularTablaHistorica.mockResolvedValue({
        columnas: ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte', 'Ventas'],
        filas: [['enero.xlsx', 'admin', '2026-01-01', '', 100]],
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [TABLA_3] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      await waitFor(() => expect(screen.getAllByText('enero.xlsx').length).toBeGreaterThan(0))
      expect(historicoService.calcularTablaHistorica).toHaveBeenCalledWith(
        'finanzas', [{ columna: 'Ventas', tipo_agregacion: 'suma' }],
      )
      expect(screen.getByText('Histórica')).toBeInTheDocument()
      // No es el contenido normal (que solo tenía la fila "A"/100 de un único archivo).
      expect(screen.queryByText('A')).not.toBeInTheDocument()
    })
  })

  describe('interpretación completa del dashboard', () => {
    it('sin el permiso dashboard.interpretar, no muestra el botón', async () => {
      useAuth.mockReturnValue({ user: { permissions: [] } })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(screen.queryByRole('button', { name: 'Interpretación completa' })).not.toBeInTheDocument()
      expect(dashboardLayoutService.generarInterpretacion).not.toHaveBeenCalled()
    })

    it('con el permiso dashboard.interpretar, "Interpretación completa" abre el modal y muestra el texto generado por IA', async () => {
      useAuth.mockReturnValue({ user: { permissions: ['dashboard.interpretar'] } })
      dashboardLayoutService.generarInterpretacion.mockResolvedValue({
        interpretacion: 'El dashboard muestra una concentración alta en Quito.',
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      await userEvent.click(screen.getByRole('button', { name: 'Interpretación completa' }))
      expect(dashboardLayoutService.generarInterpretacion).toHaveBeenCalledWith('finanzas')
      expect(await screen.findByText('El dashboard muestra una concentración alta en Quito.')).toBeInTheDocument()
    })

    it('si el backend responde con un error de negocio, lo muestra en vez del texto', async () => {
      useAuth.mockReturnValue({ user: { permissions: ['dashboard.interpretar'] } })
      dashboardLayoutService.generarInterpretacion.mockRejectedValue({
        response: { data: { mensaje: 'La interpretación con IA no está configurada en este entorno.' } },
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      await userEvent.click(screen.getByRole('button', { name: 'Interpretación completa' }))
      expect(await screen.findByText('La interpretación con IA no está configurada en este entorno.')).toBeInTheDocument()
    })
  })

  describe('hallazgos clave por componente generados por IA', () => {
    it('sin el permiso dashboard.hallazgos_ia, ni siquiera pide los hallazgos con IA', async () => {
      useAuth.mockReturnValue({ user: { permissions: [] } })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(dashboardLayoutService.generarHallazgosIA).not.toHaveBeenCalled()
      expect(await screen.findByText(/El valor actual es/)).toBeInTheDocument()
    })

    it('con hallazgo IA disponible para el componente, reemplaza el texto por reglas', async () => {
      useAuth.mockReturnValue({ user: { permissions: ['dashboard.hallazgos_ia'] } })
      dashboardLayoutService.generarHallazgosIA.mockResolvedValue({
        hallazgos: { 'kpi-1': 'Según la IA, el total ventas es sobresaliente.' },
      })
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(dashboardLayoutService.generarHallazgosIA).toHaveBeenCalledWith('finanzas')
      expect(await screen.findByText('Según la IA, el total ventas es sobresaliente.')).toBeInTheDocument()
      expect(screen.queryByText(/El valor actual es/)).not.toBeInTheDocument()
    })

    it('sin hallazgo IA para el componente (todavía no resolvió o falló), muestra el texto por reglas', async () => {
      useAuth.mockReturnValue({ user: { permissions: ['dashboard.hallazgos_ia'] } })
      dashboardLayoutService.generarHallazgosIA.mockRejectedValue(new Error('falló'))
      useGenericDashboardBuilder.mockReturnValue(builderBase())
      useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
      renderPagina()
      await screen.findByRole('heading', { name: 'Finanzas' })

      expect(await screen.findByText(/El valor actual es/)).toBeInTheDocument()
    })
  })
})


describe('DashboardAreaPage — descargar el archivo completo', () => {
  /**
   * El Dashboard Directorio replica un informe impreso y no usa el histórico de cargas; ahí ese
   * botón cede el lugar a la descarga del archivo que alimenta el dashboard, con todas sus filas
   * y columnas. En los demás dashboards el histórico sigue como estaba.
   */

  const COMPONENTE_DIRECTORIO = {
    ...KPI_COMPONENTE,
    component_id: 'cartera-total',
    config: { render: 'directorio', bloque: 'kpi' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Este bloque es hermano del principal, así que no hereda su `beforeEach`: se repiten los
    // mocks mínimos que la página pide siempre al montarse.
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({ configurada: false })
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [], columnas_disponibles: [], columnas_historicas_configuradas: [],
    })
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
    useAuth.mockReturnValue({ user: { permissions: [] } })
  })

  function pintarDirectorio(overrides = {}) {
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({
      borrador: [COMPONENTE_DIRECTORIO],
      layoutGuardado: { version: 1, components: [COMPONENTE_DIRECTORIO] },
      ...overrides,
    }))
    renderPagina()
  }

  it('en el informe, el botón de histórico deja su lugar a la descarga', async () => {
    pintarDirectorio()
    await screen.findByRole('heading', { name: 'Finanzas' })

    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver histórico' })).not.toBeInTheDocument()
  })

  it('en un dashboard cualquiera el histórico sigue estando', async () => {
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase({ borrador: [KPI_COMPONENTE] }))
    renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    // `Button as={Link}` renderiza un <a role="button">: el rol accesible es "button".
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descargar Excel' })).not.toBeInTheDocument()
  })

  it('descarga el archivo con el nombre que propone el backend', async () => {
    const blob = new Blob(['datos'])
    dashboardLayoutService.descargarDatos.mockResolvedValue({
      blob, nombre: 'Dashboard Directorio - datos 2026-09-20.xlsx',
    })
    // `createObjectURL` no existe en jsdom: el enlace de descarga se arma con él.
    const crear = vi.fn(() => 'blob:x')
    const revocar = vi.fn()
    URL.createObjectURL = crear
    URL.revokeObjectURL = revocar
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    pintarDirectorio()
    await screen.findByRole('heading', { name: 'Finanzas' })
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }))

    await waitFor(() => expect(dashboardLayoutService.descargarDatos).toHaveBeenCalledWith('finanzas'))
    expect(crear).toHaveBeenCalledWith(blob)
    expect(clic).toHaveBeenCalled()
    // El objeto URL se libera (un segundo después del clic): sin esto, cada descarga deja el
    // blob retenido en memoria.
    await waitFor(() => expect(revocar).toHaveBeenCalledWith('blob:x'), { timeout: 2000 })
    clic.mockRestore()
  })

  it('un dashboard sin datos lo dice, en vez de descargar un archivo vacío', async () => {
    dashboardLayoutService.descargarDatos.mockRejectedValue({ response: { status: 400 } })
    pintarDirectorio()
    await screen.findByRole('heading', { name: 'Finanzas' })

    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }))

    expect(await screen.findByText(/todavía no tiene datos cargados/)).toBeInTheDocument()
  })
})


describe('DashboardAreaPage — la barra de acciones se reparte en varias filas', () => {
  /**
   * Los botones del encabezado tienen etiquetas largas ("Conectar vista de base de datos"). Un
   * contenedor flex, antes de envolver, reparte la falta de espacio ACHICANDO a sus hijos: a
   * 700px eso dejaba botones de 63px con el texto partido en cuatro renglones y una barra de
   * 94px de alto. Con la clase correcta conservan su ancho y bajan a la fila siguiente.
   *
   * El alto real no se puede medir acá (jsdom no calcula layout), así que lo que se fija es el
   * contrato: el contenedor es el que sabe envolver, y no el `d-flex gap-2` que se comprimía.
   */

  beforeEach(() => {
    vi.clearAllMocks()
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({ configurada: false })
    historicoService.listarCargasHistoricas.mockResolvedValue({
      cargas: [], columnas_disponibles: [], columnas_historicas_configuradas: [],
    })
    carteraService.obtenerArchivoActualDashboard.mockResolvedValue({ disponible: false })
    useAuth.mockReturnValue({ user: { permissions: [] } })
    useGenericDashboardBuilder.mockReturnValue(builderBase())
    useDashboardLayout.mockReturnValue(layoutBase())
  })

  it('los botones viven en un contenedor que los deja pasar a otra fila', async () => {
    const { container } = renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    const barra = container.querySelector('.acciones-dashboard')
    expect(barra).not.toBeNull()
    // Todos los botones del encabezado están adentro, que es lo que hace que se repartan juntos.
    expect(barra.querySelector('button')).not.toBeNull()
  })

  it('el botón de imprimir sigue dentro de la barra', async () => {
    const { container } = renderPagina()
    await screen.findByRole('heading', { name: 'Finanzas' })

    const barra = container.querySelector('.acciones-dashboard')
    const textos = [...barra.querySelectorAll('button, a')].map((b) => b.textContent.trim())
    expect(textos).toContain('Imprimir como PDF')
  })
})
