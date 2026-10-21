import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DashboardsListPage from '../pages/dashboards/DashboardsListPage'
import * as dashboardLayoutService from '../services/dashboardLayoutService'
import * as rolesService from '../services/rolesService'
import * as usersService from '../services/usersService'
import { useAuth } from '../context/AuthContext'

vi.mock('../services/dashboardLayoutService')
vi.mock('../services/rolesService')
vi.mock('../services/usersService')
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

function renderPagina(permissions = [], overridesUsuario = {}) {
  useAuth.mockReturnValue({ user: { permissions, ...overridesUsuario } })
  return render(<MemoryRouter><DashboardsListPage /></MemoryRouter>)
}

describe('DashboardsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rolesService.list.mockResolvedValue({ results: [{ id: 1, name: 'Analista' }, { id: 2, name: 'Supervisor' }] })
  })

  it('muestra un spinner mientras carga', () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockReturnValue(new Promise(() => {}))
    renderPagina()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renderiza los dashboards autorizados devueltos por el backend, con un botón "Entrar" que enlaza al dashboard', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'cartera', name: 'Dashboard de cartera', area: 'Cartera' },
    ])
    renderPagina()
    expect(await screen.findByText('Dashboard de cartera')).toBeInTheDocument()
    const tarjeta = screen.getByTestId('dashboard-card-cartera')
    expect(within(tarjeta).getByRole('button', { name: 'Entrar' })).toHaveAttribute('href', '/admin/dashboards/cartera')
  })

  it('un dashboard que no es "cartera" enlaza a la página genérica por dashboard_id', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    renderPagina()
    expect(await screen.findByText('Finanzas')).toBeInTheDocument()
    const tarjeta = screen.getByTestId('dashboard-card-finanzas')
    expect(within(tarjeta).getByRole('button', { name: 'Entrar' })).toHaveAttribute('href', '/admin/dashboards/finanzas')
  })

  it('muestra un mensaje cuando no hay dashboards autorizados', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([])
    renderPagina()
    expect(await screen.findByText(/no tiene ningún dashboard autorizado/i)).toBeInTheDocument()
  })

  it('muestra un mensaje de error si falla la consulta', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockRejectedValue(new Error('red caída'))
    renderPagina()
    expect(await screen.findByText(/no se pudieron cargar los dashboards/i)).toBeInTheDocument()
  })

  it('sin el permiso dashboard.crear, no muestra el botón de crear dashboard', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([])
    renderPagina([])
    await screen.findByText(/no tiene ningún dashboard autorizado/i)
    expect(screen.queryByRole('button', { name: 'Crear dashboard' })).not.toBeInTheDocument()
  })

  it('con el permiso, crear un dashboard llama al servicio y refresca la lista', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' }])
    dashboardLayoutService.crearDashboard.mockResolvedValue({ dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' })
    renderPagina(['dashboard.crear'])

    await userEvent.click(await screen.findByRole('button', { name: 'Crear dashboard' }))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Finanzas')
    await userEvent.type(screen.getByLabelText('Área'), 'Finanzas')
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }))

    expect(dashboardLayoutService.crearDashboard).toHaveBeenCalledWith({ name: 'Finanzas', area: 'Finanzas', description: '', contexto: '' })
    expect(await screen.findByText('Finanzas')).toBeInTheDocument()
  })

  it('al crear, el contexto para la IA se envía al servicio', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ dashboard_id: 'finanzas', name: 'Finanzas', area: '' }])
    dashboardLayoutService.crearDashboard.mockResolvedValue({ dashboard_id: 'finanzas', name: 'Finanzas', area: '' })
    renderPagina(['dashboard.crear'])

    await userEvent.click(await screen.findByRole('button', { name: 'Crear dashboard' }))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Finanzas')
    await userEvent.type(screen.getByLabelText('Contexto para la IA (opcional)'), 'Cartera vencida de la región norte.')
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }))

    expect(dashboardLayoutService.crearDashboard).toHaveBeenCalledWith({
      name: 'Finanzas', area: '', description: '', contexto: 'Cartera vencida de la región norte.',
    })
  })

  it('sin los permisos dashboard.editar/dashboard.eliminar, no muestra esos botones en la tarjeta', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    renderPagina([])
    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    expect(within(tarjeta).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(within(tarjeta).queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })

  it('con el permiso dashboard.editar, editar un dashboard llama al servicio y refresca la lista', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados
      .mockResolvedValueOnce([{ dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' }])
      .mockResolvedValueOnce([{ dashboard_id: 'finanzas', name: 'Finanzas Nacionales', area: 'Finanzas' }])
    dashboardLayoutService.actualizarDashboard.mockResolvedValue({ dashboard_id: 'finanzas', name: 'Finanzas Nacionales', area: 'Finanzas' })
    renderPagina(['dashboard.editar'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    const nombreInput = await screen.findByLabelText('Nombre')
    expect(nombreInput).toHaveValue('Finanzas')
    expect(screen.getByLabelText('Área')).toHaveValue('Finanzas y Contabilidad')

    await userEvent.clear(nombreInput)
    await userEvent.type(nombreInput, 'Finanzas Nacionales')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(dashboardLayoutService.actualizarDashboard).toHaveBeenCalledWith('finanzas', { name: 'Finanzas Nacionales', area: 'Finanzas y Contabilidad', contexto: '' })
    expect(await screen.findByText('Finanzas Nacionales')).toBeInTheDocument()
  })

  it('al editar, el contexto ya guardado se precarga y se puede cambiar', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValueOnce([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad', contexto: 'Contexto original.' },
    ]).mockResolvedValueOnce([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad', contexto: 'Contexto nuevo.' },
    ])
    dashboardLayoutService.actualizarDashboard.mockResolvedValue({
      dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad', contexto: 'Contexto nuevo.',
    })
    renderPagina(['dashboard.editar'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    const campoContexto = await screen.findByLabelText('Contexto para la IA (opcional)')
    expect(campoContexto).toHaveValue('Contexto original.')

    await userEvent.clear(campoContexto)
    await userEvent.type(campoContexto, 'Contexto nuevo.')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(dashboardLayoutService.actualizarDashboard).toHaveBeenCalledWith('finanzas', {
      name: 'Finanzas', area: 'Finanzas y Contabilidad', contexto: 'Contexto nuevo.',
    })
  })

  it('con el permiso dashboard.eliminar, el botón Eliminar exige escribir el nombre exacto y muestra ese nombre en un <span>', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    renderPagina(['dashboard.eliminar'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Eliminar' }))

    const dialogo = await screen.findByRole('dialog')
    const spanNombre = within(dialogo).getByText('Finanzas', { selector: 'span' })
    expect(spanNombre).toBeInTheDocument()

    const botonEliminar = within(dialogo).getByRole('button', { name: 'Eliminar' })
    expect(botonEliminar).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Confirmar nombre del dashboard'), 'nombre incorrecto')
    expect(botonEliminar).toBeDisabled()
  })

  it('escribiendo el nombre exacto, eliminar llama al servicio con la confirmación y refresca la lista', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados
      .mockResolvedValueOnce([{ dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' }])
      .mockResolvedValueOnce([])
    dashboardLayoutService.eliminarDashboard.mockResolvedValue({})
    renderPagina(['dashboard.eliminar'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Eliminar' }))

    const dialogo = await screen.findByRole('dialog')
    await userEvent.type(within(dialogo).getByLabelText('Confirmar nombre del dashboard'), 'Finanzas')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(dashboardLayoutService.eliminarDashboard).toHaveBeenCalledWith('finanzas', 'Finanzas')
    expect(await screen.findByText(/no tiene ningún dashboard autorizado/i)).toBeInTheDocument()
  })

  it('el botón "Editar" también aparece sin el permiso dashboard.editar cuando puede_administrar_acceso es true', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '', puede_administrar_acceso: true },
      { dashboard_id: 'ventas', name: 'Ventas', area: '', puede_administrar_acceso: false },
    ])
    renderPagina([])

    const tarjetaConAcceso = await screen.findByTestId('dashboard-card-finanzas')
    expect(within(tarjetaConAcceso).getByRole('button', { name: 'Editar' })).toBeInTheDocument()

    const tarjetaSinAcceso = screen.getByTestId('dashboard-card-ventas')
    expect(within(tarjetaSinAcceso).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
  })

  it('sin permiso dashboard.editar pero con puede_administrar_acceso, el modal solo muestra la sección de acceso, no nombre/área', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.obtenerAcceso.mockResolvedValue({
      dashboard_id: 'finanzas', owner: null, roles_editores: [], roles_lectores: [],
    })
    renderPagina([])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    expect(await screen.findByText('Ver y editar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Área')).not.toBeInTheDocument()
  })

  it('marcar roles y guardar llama a actualizarAcceso con los ids correctos', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.obtenerAcceso.mockResolvedValue({
      dashboard_id: 'finanzas', owner: null, roles_editores: [], roles_lectores: [],
    })
    dashboardLayoutService.actualizarAcceso.mockResolvedValue({})
    renderPagina([])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    await userEvent.click(await screen.findByLabelText('Analista', { selector: '#acceso-editor-1' }))
    await userEvent.click(screen.getByLabelText('Supervisor', { selector: '#acceso-lector-2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [1], rolesLectores: [2] })
  })

  it('sin superusuario, el modal de edición no muestra el selector de dueño', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.obtenerAcceso.mockResolvedValue({
      dashboard_id: 'finanzas', owner: { id: 5, username: 'ana' }, roles_editores: [], roles_lectores: [],
    })
    renderPagina([], { is_superuser: false })

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    await screen.findByText('Ver y editar')
    expect(screen.queryByLabelText('Dueño')).not.toBeInTheDocument()
    expect(screen.getByText(/Solo un superusuario puede reasignar/)).toBeInTheDocument()
  })

  it('con dashboard.reasignar_dueno, cambiar el dueño y guardar llama a reasignarDueno', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.obtenerAcceso.mockResolvedValue({
      dashboard_id: 'finanzas', owner: { id: 5, username: 'ana' }, roles_editores: [], roles_lectores: [],
    })
    usersService.list.mockResolvedValue({ results: [{ id: 5, username: 'ana' }, { id: 7, username: 'luis' }] })
    dashboardLayoutService.actualizarAcceso.mockResolvedValue({})
    dashboardLayoutService.reasignarDueno.mockResolvedValue({})
    renderPagina(['dashboard.reasignar_dueno'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    const selectorDueno = await screen.findByLabelText('Dueño')
    await userEvent.selectOptions(selectorDueno, '7')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(dashboardLayoutService.reasignarDueno).toHaveBeenCalledWith('finanzas', '7')
  })

  it('con dashboard.editar y puede_administrar_acceso a la vez, el modal muestra ambas secciones y guarda ambas', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValueOnce([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad', puede_administrar_acceso: true },
    ]).mockResolvedValueOnce([
      { dashboard_id: 'finanzas', name: 'Finanzas Nacionales', area: 'Finanzas', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.obtenerAcceso.mockResolvedValue({
      dashboard_id: 'finanzas', owner: null, roles_editores: [], roles_lectores: [],
    })
    dashboardLayoutService.actualizarDashboard.mockResolvedValue({ dashboard_id: 'finanzas', name: 'Finanzas Nacionales', area: 'Finanzas' })
    dashboardLayoutService.actualizarAcceso.mockResolvedValue({})
    renderPagina(['dashboard.editar'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    expect(await screen.findByLabelText('Nombre')).toBeInTheDocument()
    expect(screen.getByText('Ver y editar')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Analista', { selector: '#acceso-editor-1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(dashboardLayoutService.actualizarDashboard).toHaveBeenCalledWith('finanzas', { name: 'Finanzas', area: 'Finanzas y Contabilidad', contexto: '' })
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [1], rolesLectores: [] })
    expect(await screen.findByText('Finanzas Nacionales')).toBeInTheDocument()
  })

  it('el modal de edición organiza cada área en una sección con encabezado propio, contraíble por separado', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.obtenerAcceso.mockResolvedValue({
      dashboard_id: 'finanzas', owner: { id: 5, username: 'ana' }, roles_editores: [], roles_lectores: [],
    })
    renderPagina(['dashboard.editar', 'dashboard.reasignar_dueno'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar' }))

    const encabezadoGenerales = await screen.findByRole('button', { name: 'Ajustes generales' })
    const encabezadoPermisos = screen.getByRole('button', { name: 'Permisos de visualización y edición' })
    const encabezadoDueno = screen.getByRole('button', { name: 'Dueño del tablero' })

    // Las 3 secciones empiezan expandidas.
    expect(encabezadoGenerales).toHaveAttribute('aria-expanded', 'true')
    expect(encabezadoPermisos).toHaveAttribute('aria-expanded', 'true')
    expect(encabezadoDueno).toHaveAttribute('aria-expanded', 'true')

    // Cada una se contrae de forma independiente al pulsar su propio encabezado, sin afectar a
    // las demás (el Accordion es `alwaysOpen`, no exclusivo).
    await userEvent.click(encabezadoGenerales)
    expect(encabezadoGenerales).toHaveAttribute('aria-expanded', 'false')
    expect(encabezadoPermisos).toHaveAttribute('aria-expanded', 'true')
    expect(encabezadoDueno).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(encabezadoPermisos)
    expect(encabezadoPermisos).toHaveAttribute('aria-expanded', 'false')
    expect(encabezadoDueno).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(encabezadoDueno)
    expect(encabezadoDueno).toHaveAttribute('aria-expanded', 'false')

    // Reabrir una no afecta a las otras, que siguen contraídas.
    await userEvent.click(encabezadoGenerales)
    expect(encabezadoGenerales).toHaveAttribute('aria-expanded', 'true')
    expect(encabezadoPermisos).toHaveAttribute('aria-expanded', 'false')
    expect(encabezadoDueno).toHaveAttribute('aria-expanded', 'false')
  })

  it('si la eliminación falla, muestra el mensaje de error del backend', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '' },
    ])
    dashboardLayoutService.eliminarDashboard.mockRejectedValue({ response: { data: { mensaje: 'El nombre ingresado no coincide.' } } })
    renderPagina(['dashboard.eliminar'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Eliminar' }))

    const dialogo = await screen.findByRole('dialog')
    await userEvent.type(within(dialogo).getByLabelText('Confirmar nombre del dashboard'), 'Finanzas')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('El nombre ingresado no coincide.')).toBeInTheDocument()
  })
})
