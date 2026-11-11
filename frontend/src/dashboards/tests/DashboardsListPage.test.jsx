import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

  it('renderiza los dashboards autorizados devueltos por el backend; la tarjeta entera enlaza al dashboard', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'cartera', name: 'Dashboard de cartera', area: 'Cartera' },
    ])
    renderPagina()
    expect(await screen.findByText('Dashboard de cartera')).toBeInTheDocument()
    const tarjeta = screen.getByTestId('dashboard-card-cartera')
    expect(within(tarjeta).getByRole('link', { name: 'Dashboard de cartera Cartera' })).toHaveAttribute('href', '/admin/dashboards/cartera')
  })

  it('un dashboard que no es "cartera" enlaza a la página genérica por dashboard_id', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    renderPagina()
    expect(await screen.findByText('Finanzas')).toBeInTheDocument()
    const tarjeta = screen.getByTestId('dashboard-card-finanzas')
    expect(within(tarjeta).getByRole('link', { name: /^Finanzas/ })).toHaveAttribute('href', '/admin/dashboards/finanzas')
  })

  // Auditoría UX/UI, fase 3, 28/10/2026: antes la tarjeta no era un enlace y sus acciones vivían
  // en una capa que solo aparecía con el cursor encima.
  it('la tarjeta es un enlace y Editar/Eliminar quedan fuera de él, nombrados con el dashboard', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' },
    ])
    renderPagina(['dashboard.editar', 'dashboard.eliminar'])
    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')

    const enlace = within(tarjeta).getByRole('link')
    expect(enlace).toHaveAttribute('href', '/admin/dashboards/finanzas')
    expect(enlace).toHaveTextContent('Finanzas')
    expect(enlace).toHaveTextContent('Finanzas y Contabilidad')

    const editar = within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' })
    const eliminar = within(tarjeta).getByRole('button', { name: 'Eliminar "Finanzas"' })
    // Un botón dentro de un <a> es HTML inválido y confunde a los lectores de pantalla.
    expect(enlace).not.toContainElement(editar)
    expect(enlace).not.toContainElement(eliminar)
    // Ya no hay una capa de acciones que se revele solo con el cursor.
    expect(tarjeta.querySelector('.dashboard-card__actions')).toBeNull()
    expect(within(tarjeta).queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument()
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
    expect(within(tarjeta).queryByRole('button', { name: 'Editar "Finanzas"' })).not.toBeInTheDocument()
    expect(within(tarjeta).queryByRole('button', { name: 'Eliminar "Finanzas"' })).not.toBeInTheDocument()
  })

  it('con el permiso dashboard.editar, editar un dashboard llama al servicio y refresca la lista', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados
      .mockResolvedValueOnce([{ dashboard_id: 'finanzas', name: 'Finanzas', area: 'Finanzas y Contabilidad' }])
      .mockResolvedValueOnce([{ dashboard_id: 'finanzas', name: 'Finanzas Nacionales', area: 'Finanzas' }])
    dashboardLayoutService.actualizarDashboard.mockResolvedValue({ dashboard_id: 'finanzas', name: 'Finanzas Nacionales', area: 'Finanzas' })
    renderPagina(['dashboard.editar'])

    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Eliminar "Finanzas"' }))

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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Eliminar "Finanzas"' }))

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
    expect(within(tarjetaConAcceso).getByRole('button', { name: 'Editar "Finanzas"' })).toBeInTheDocument()

    const tarjetaSinAcceso = screen.getByTestId('dashboard-card-ventas')
    expect(within(tarjetaSinAcceso).queryByRole('button', { name: 'Editar "Ventas"' })).not.toBeInTheDocument()
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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

    expect(await screen.findByLabelText('Buscar rol')).toBeInTheDocument()
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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

    await userEvent.click(await screen.findByLabelText('Editar: Analista'))
    await userEvent.click(screen.getByLabelText('Ver: Supervisor'))
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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

    await screen.findByLabelText('Buscar rol')
    expect(screen.queryByLabelText('Dueño')).not.toBeInTheDocument()
    // El texto nombra el permiso que de verdad decide (`dashboard.reasignar_dueno`), no «superusuario».
    expect(screen.getByText(/requiere el permiso «Reasignar el dueño de cualquier dashboard»/)).toBeInTheDocument()
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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

    expect(await screen.findByLabelText('Nombre')).toBeInTheDocument()
    expect(await screen.findByLabelText('Buscar rol')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Editar: Analista'))
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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

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
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Eliminar "Finanzas"' }))

    const dialogo = await screen.findByRole('dialog')
    await userEvent.type(within(dialogo).getByLabelText('Confirmar nombre del dashboard'), 'Finanzas')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('El nombre ingresado no coincide.')).toBeInTheDocument()
  })
})

// US-003, 11/11/2026: los permisos del dashboard pasan de dos columnas de roles repetidos
// («Ver y editar» / «Solo ver») a una fila por rol con «Ver» y «Editar» y un buscador.
describe('DashboardsListPage — permisos por rol con buscador', () => {
  const roles = [
    { id: 1, name: 'Analista' },
    { id: 2, name: 'Supervisor' },
    { id: 3, name: 'Análisis de cartera' },
    { id: 4, name: 'Gerente General' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    rolesService.list.mockResolvedValue({ results: roles })
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.actualizarAcceso.mockResolvedValue({})
  })

  async function abrirPermisos({ editores = [], lectores = [] } = {}) {
    dashboardLayoutService.obtenerAcceso.mockResolvedValue({
      dashboard_id: 'finanzas',
      owner: null,
      roles_editores: editores.map((id) => roles.find((r) => r.id === id)),
      roles_lectores: lectores.map((id) => roles.find((r) => r.id === id)),
    })
    renderPagina([])
    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))
    return screen.findByLabelText('Buscar rol')
  }

  const ver = (nombre) => screen.getByLabelText(`Ver: ${nombre}`)
  const editar = (nombre) => screen.getByLabelText(`Editar: ${nombre}`)
  const guardar = () => userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

  it('muestra una sola fila por rol, con «Ver» y «Editar» nombrados con el rol', async () => {
    await abrirPermisos()
    const tabla = screen.getByRole('table')
    expect(within(tabla).getAllByRole('row')).toHaveLength(roles.length + 1)
    for (const rol of roles) {
      expect(within(tabla).getByRole('rowheader', { name: rol.name })).toBeInTheDocument()
      expect(ver(rol.name)).toHaveAttribute('type', 'checkbox')
      expect(editar(rol.name)).toHaveAttribute('type', 'checkbox')
    }
    // La ayuda de arriba es corta: lo de «sin roles asignados» lo explica el resumen.
    expect(screen.getByText('Roles con acceso a este dashboard.')).toBeInTheDocument()
  })

  it('al cargar, el lector tiene «Ver», el editor «Ver» y «Editar» y el resto ninguna marca', async () => {
    await abrirPermisos({ editores: [2], lectores: [1] })

    expect(ver('Analista')).toBeChecked()
    expect(editar('Analista')).not.toBeChecked()
    expect(ver('Supervisor')).toBeChecked()
    expect(editar('Supervisor')).toBeChecked()
    expect(ver('Gerente General')).not.toBeChecked()
    expect(editar('Gerente General')).not.toBeChecked()
  })

  it('sin roles asignados, el resumen explica quién lo ve en lugar de decir «0 roles»', async () => {
    await abrirPermisos()
    expect(screen.getByText('Sin roles asignados: lo ve cualquiera con el permiso general de dashboards.')).toBeInTheDocument()
    expect(screen.queryByText(/0 roles pueden ver/)).not.toBeInTheDocument()
  })

  it('explica la regla de Ver y Editar y la enlaza con la tabla', async () => {
    await abrirPermisos()
    const tabla = screen.getByRole('table')
    expect(tabla).toHaveAccessibleDescription('Marcar Editar da también Ver. Quitar Ver quita las dos.')
    expect(within(tabla).getByRole('columnheader', { name: 'Editar (incluye ver)' })).toBeInTheDocument()
  })

  it('al quitar «Ver» a un editor se anuncia que ya no puede ver ni editar', async () => {
    await abrirPermisos({ editores: [1] })
    await userEvent.click(ver('Analista'))
    expect(screen.getByText('Analista ya no puede ver ni editar')).toBeInTheDocument()
  })

  it('al filtrar se anuncia cuántos roles se muestran', async () => {
    const buscador = await abrirPermisos()
    await userEvent.type(buscador, 'analis')
    expect(screen.getByText('Mostrando 2 de 4 roles')).toBeInTheDocument()
  })

  it('Enter en el buscador no envía el formulario ni cierra la ventana', async () => {
    const buscador = await abrirPermisos()
    await userEvent.type(buscador, 'super{Enter}')
    expect(dashboardLayoutService.actualizarAcceso).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(ver('Supervisor')).toBeInTheDocument()
  })

  it('escribir en el buscador no cuenta como cambio: Cancelar cierra sin preguntar', async () => {
    const buscador = await abrirPermisos()
    await userEvent.type(buscador, 'super')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Buscar rol')).not.toBeInTheDocument())
  })

  it('si no hay roles registrados lo dice y explica dónde crearlos', async () => {
    rolesService.list.mockResolvedValue({ results: [] })
    await abrirPermisos()
    expect(screen.getByText('No hay roles registrados. Créelos en Configuración → Roles.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('mientras carga el acceso, «Guardar cambios» está deshabilitado', async () => {
    dashboardLayoutService.obtenerAcceso.mockReturnValue(new Promise(() => {}))
    renderPagina([])
    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))
    expect(await screen.findByText('Cargando roles…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('si la carga del acceso falla, no se guarda el acceso y se puede reintentar', async () => {
    dashboardLayoutService.obtenerAcceso.mockRejectedValueOnce(new Error('caída'))
    renderPagina(['dashboard.editar'])
    const tarjeta = await screen.findByTestId('dashboard-card-finanzas')
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Editar "Finanzas"' }))

    expect(await screen.findByText('No se pudo cargar el acceso de este dashboard.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const botonGuardar = screen.getByRole('button', { name: 'Guardar cambios' })
    expect(botonGuardar).toBeDisabled()
    await userEvent.click(botonGuardar)
    expect(dashboardLayoutService.actualizarAcceso).not.toHaveBeenCalled()
    expect(dashboardLayoutService.actualizarDashboard).not.toHaveBeenCalled()

    dashboardLayoutService.obtenerAcceso.mockResolvedValueOnce({
      dashboard_id: 'finanzas', owner: null, roles_editores: [roles[1]], roles_lectores: [],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText('Editar: Supervisor')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
  })

  it('al abrir otro dashboard no quedan las marcas del anterior, y lo duplicado cuenta como editor', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '', puede_administrar_acceso: true },
      { dashboard_id: 'ventas', name: 'Ventas', area: '', puede_administrar_acceso: true },
    ])
    dashboardLayoutService.obtenerAcceso
      .mockResolvedValueOnce({ dashboard_id: 'finanzas', owner: null, roles_editores: [roles[0]], roles_lectores: [roles[0], roles[1]] })
      .mockRejectedValueOnce(new Error('caída'))
    renderPagina([])

    await userEvent.click(within(await screen.findByTestId('dashboard-card-finanzas')).getByRole('button', { name: 'Editar "Finanzas"' }))
    expect(await screen.findByLabelText('Editar: Analista')).toBeChecked()
    await guardar()
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [1], rolesLectores: [2] })
    await waitFor(() => expect(screen.queryByLabelText('Buscar rol')).not.toBeInTheDocument())

    await userEvent.click(within(screen.getByTestId('dashboard-card-ventas')).getByRole('button', { name: 'Editar "Ventas"' }))
    expect(await screen.findByText('No se pudo cargar el acceso de este dashboard.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Editar: Analista')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('si la carga falla, «Dueño del tablero» no ofrece «Sin dueño» y remite a Reintentar', async () => {
    dashboardLayoutService.obtenerAcceso.mockRejectedValueOnce(new Error('caída'))
    usersService.list.mockResolvedValue({ results: [{ id: 5, username: 'ana' }] })
    renderPagina(['dashboard.reasignar_dueno'])
    await userEvent.click(within(await screen.findByTestId('dashboard-card-finanzas')).getByRole('button', { name: 'Editar "Finanzas"' }))

    expect(await screen.findByText('No se pudo cargar el dueño. Use «Reintentar» en Permisos.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Dueño')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Sin dueño' })).not.toBeInTheDocument()
  })

  it('tras «Reintentar», el foco va al nuevo «Reintentar» si falla otra vez y al buscador si carga', async () => {
    dashboardLayoutService.obtenerAcceso
      .mockRejectedValueOnce(new Error('caída'))
      .mockRejectedValueOnce(new Error('caída'))
      .mockResolvedValueOnce({ dashboard_id: 'finanzas', owner: null, roles_editores: [], roles_lectores: [] })
    renderPagina([])
    await userEvent.click(within(await screen.findByTestId('dashboard-card-finanzas')).getByRole('button', { name: 'Editar "Finanzas"' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' })).toHaveFocus())

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByLabelText('Buscar rol')).toHaveFocus())
  })

  it('Escape con texto en el buscador lo limpia sin cerrar; con el buscador vacío cierra', async () => {
    const buscador = await abrirPermisos()
    await userEvent.type(buscador, 'super')
    expect(screen.queryByLabelText('Ver: Analista')).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(buscador).toHaveValue('')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(ver('Analista')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Buscar rol')).not.toBeInTheDocument())
  })

  it('el anuncio de quitar «Ver» se repite aunque el texto sea el mismo', async () => {
    await abrirPermisos({ editores: [1] })
    const region = screen.getByTestId('anuncio-acceso')

    await userEvent.click(ver('Analista'))
    const primero = within(region).getByText('Analista ya no puede ver ni editar')

    await userEvent.click(editar('Analista'))
    await userEvent.click(ver('Analista'))
    const segundo = within(region).getByText('Analista ya no puede ver ni editar')
    // Nodo nuevo dentro de la misma región viva: el lector de pantalla lo vuelve a leer.
    expect(segundo).not.toBe(primero)
  })

  it('si la respuesta de un dashboard llega después de abrir otro, no pisa sus marcas', async () => {
    dashboardLayoutService.obtenerDashboardsAutorizados.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', area: '', puede_administrar_acceso: true },
      { dashboard_id: 'ventas', name: 'Ventas', area: '', puede_administrar_acceso: true },
    ])
    let responderFinanzas
    dashboardLayoutService.obtenerAcceso.mockImplementation((id) => (id === 'finanzas'
      ? new Promise((resolve) => { responderFinanzas = resolve })
      : Promise.resolve({ dashboard_id: 'ventas', owner: null, roles_editores: [roles[1]], roles_lectores: [] })))
    renderPagina([])

    await userEvent.click(within(await screen.findByTestId('dashboard-card-finanzas')).getByRole('button', { name: 'Editar "Finanzas"' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(within(screen.getByTestId('dashboard-card-ventas')).getByRole('button', { name: 'Editar "Ventas"' }))
    expect(await screen.findByLabelText('Editar: Supervisor')).toBeChecked()

    responderFinanzas({ dashboard_id: 'finanzas', owner: null, roles_editores: [roles[0]], roles_lectores: [roles[3]] })
    await new Promise((r) => setTimeout(r, 0))
    expect(editar('Supervisor')).toBeChecked()
    expect(ver('Analista')).not.toBeChecked()
    expect(ver('Gerente General')).not.toBeChecked()

    await guardar()
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('ventas', { rolesEditores: [2], rolesLectores: [] })
  })

  it('el resumen cuenta a los editores también entre quienes pueden ver', async () => {
    await abrirPermisos({ editores: [2], lectores: [1] })
    expect(screen.getByText('2 roles pueden ver · 1 puede editar')).toBeInTheDocument()

    await userEvent.click(editar('Gerente General'))
    expect(screen.getByText('3 roles pueden ver · 2 pueden editar')).toBeInTheDocument()
  })

  it('el buscador filtra por nombre sin distinguir mayúsculas ni tildes', async () => {
    const buscador = await abrirPermisos()
    expect(buscador).toHaveAttribute('type', 'search')

    await userEvent.type(buscador, 'ANALIS')
    expect(ver('Analista')).toBeInTheDocument()
    expect(ver('Análisis de cartera')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ver: Supervisor')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ver: Gerente General')).not.toBeInTheDocument()

    await userEvent.clear(buscador)
    await userEvent.type(buscador, 'análisis')
    expect(ver('Análisis de cartera')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ver: Analista')).not.toBeInTheDocument()
  })

  it('si ningún rol coincide, lo dice con el texto buscado', async () => {
    const buscador = await abrirPermisos()
    await userEvent.type(buscador, 'zzz')
    expect(screen.getByText('Ningún rol coincide con «zzz».')).toBeInTheDocument()
    // Se anuncia una sola vez, desde la región viva de la lista.
    expect(screen.getByTestId('anuncio-lista-roles')).toHaveTextContent('Ningún rol coincide con «zzz»')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('filtrar no borra lo marcado, ni lo que queda oculto ni lo que se ve', async () => {
    const buscador = await abrirPermisos()
    await userEvent.click(editar('Supervisor'))
    await userEvent.click(ver('Analista'))

    await userEvent.type(buscador, 'super')
    expect(editar('Supervisor')).toBeChecked()
    expect(screen.queryByLabelText('Ver: Analista')).not.toBeInTheDocument()

    await userEvent.clear(buscador)
    expect(ver('Analista')).toBeChecked()
    expect(editar('Supervisor')).toBeChecked()

    await guardar()
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [2], rolesLectores: [1] })
  })

  it('solo «Ver» deja al rol como lector', async () => {
    await abrirPermisos()
    await userEvent.click(ver('Analista'))
    expect(ver('Analista')).toBeChecked()
    expect(editar('Analista')).not.toBeChecked()

    await guardar()
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [], rolesLectores: [1] })
  })

  it('marcar «Editar» marca «Ver» y deja al rol como editor, no en las dos listas', async () => {
    await abrirPermisos({ lectores: [1] })
    await userEvent.click(editar('Analista'))
    expect(ver('Analista')).toBeChecked()
    expect(editar('Analista')).toBeChecked()

    await guardar()
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [1], rolesLectores: [] })
  })

  it('desmarcar «Editar» deja al rol solo con «Ver»', async () => {
    await abrirPermisos({ editores: [1] })
    await userEvent.click(editar('Analista'))
    expect(ver('Analista')).toBeChecked()
    expect(editar('Analista')).not.toBeChecked()

    await guardar()
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [], rolesLectores: [1] })
  })

  it('desmarcar «Ver» de un editor quita las dos marcas y el rol queda sin acceso', async () => {
    await abrirPermisos({ editores: [1], lectores: [2] })
    await userEvent.click(ver('Analista'))
    expect(ver('Analista')).not.toBeChecked()
    expect(editar('Analista')).not.toBeChecked()

    await guardar()
    expect(dashboardLayoutService.actualizarAcceso).toHaveBeenCalledWith('finanzas', { rolesEditores: [], rolesLectores: [2] })
  })

  it('tras muchos cambios, ningún rol se envía en las dos listas', async () => {
    await abrirPermisos({ editores: [1], lectores: [2] })
    await userEvent.click(editar('Supervisor'))
    await userEvent.click(editar('Supervisor'))
    await userEvent.click(editar('Supervisor'))
    await userEvent.click(editar('Analista'))
    await userEvent.click(ver('Gerente General'))
    await userEvent.click(editar('Gerente General'))

    await guardar()
    const [, { rolesEditores, rolesLectores }] = dashboardLayoutService.actualizarAcceso.mock.calls[0]
    expect([...rolesEditores].sort()).toEqual([2, 4])
    expect(rolesLectores).toEqual([1])
    expect(rolesEditores.filter((id) => rolesLectores.includes(id))).toEqual([])
  })
})
