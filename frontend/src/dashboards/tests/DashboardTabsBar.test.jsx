import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DashboardTabsBar from '../components/dashboards/DashboardTabsBar'
import * as dashboardLayoutService from '../services/dashboardLayoutService'
import { useAuth } from '../context/AuthContext'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../services/dashboardLayoutService')
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

function renderBarra(dashboardId = 'finanzas', permissions = ['dashboard.crear'], modoEdicion = false) {
  useAuth.mockReturnValue({ user: { permissions } })
  return render(
    <MemoryRouter initialEntries={[`/admin/dashboards/${dashboardId}`]}>
      <Routes>
        <Route path="/admin/dashboards/:dashboardId" element={<DashboardTabsBar dashboardId={dashboardId} modoEdicion={modoEdicion} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DashboardTabsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })

  it('sin pestañas adicionales, muestra solo la raíz y el "+"', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    renderBarra()

    expect(await screen.findByRole('link', { name: 'Finanzas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar pestaña' })).toBeInTheDocument()
  })

  it('marca como activa la pestaña que coincide con dashboardId', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      { dashboard_id: 'finanzas-2', name: 'Vista regional', orden: 2 },
    ])
    renderBarra('finanzas-2')

    expect(await screen.findByRole('link', { name: 'Vista regional' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Finanzas' })).not.toHaveClass('active')
  })

  it('con 5 pestañas, no muestra el "+"', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      { dashboard_id: 'finanzas-2', name: 'P2', orden: 2 },
      { dashboard_id: 'finanzas-3', name: 'P3', orden: 3 },
      { dashboard_id: 'finanzas-4', name: 'P4', orden: 4 },
      { dashboard_id: 'finanzas-5', name: 'P5', orden: 5 },
    ])
    renderBarra()

    await screen.findByRole('link', { name: 'Finanzas' })
    expect(screen.queryByRole('button', { name: 'Agregar pestaña' })).not.toBeInTheDocument()
  })

  it('sin el permiso dashboard.crear, no muestra el "+"', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    renderBarra('finanzas', [])

    await screen.findByRole('link', { name: 'Finanzas' })
    expect(screen.queryByRole('button', { name: 'Agregar pestaña' })).not.toBeInTheDocument()
  })

  it('crear una pestaña llama al servicio con el nombre ingresado', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    dashboardLayoutService.crearPestana.mockResolvedValue({ dashboard_id: 'finanzas-2', name: 'Vista regional', orden: 2 })
    renderBarra()

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar pestaña' }))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Vista regional')
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }))

    expect(dashboardLayoutService.crearPestana).toHaveBeenCalledWith('finanzas', { name: 'Vista regional' })
  })

  it('si crear la pestaña falla, muestra el mensaje de error del backend', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    dashboardLayoutService.crearPestana.mockRejectedValue({ response: { data: { mensaje: 'Un dashboard no puede tener más de 5 pestañas.' } } })
    renderBarra()

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar pestaña' }))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Vista regional')
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByText('Un dashboard no puede tener más de 5 pestañas.')).toBeInTheDocument()
  })

  it('fuera de modo edición, no muestra el lápiz para renombrar', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1, area: 'Finanzas y Contabilidad' },
    ])
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.editar'], false)

    await screen.findByRole('link', { name: 'Finanzas' })
    expect(screen.queryByRole('button', { name: /^Editar el nombre de la pestaña/ })).not.toBeInTheDocument()
  })

  it('en modo edición sin el permiso dashboard.editar, no muestra el lápiz', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1, area: 'Finanzas y Contabilidad' },
    ])
    renderBarra('finanzas', ['dashboard.crear'], true)

    await screen.findByRole('link', { name: 'Finanzas' })
    expect(screen.queryByRole('button', { name: /^Editar el nombre de la pestaña/ })).not.toBeInTheDocument()
  })

  it('en modo edición con el permiso, el lápiz solo aparece en la pestaña activa', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1, area: 'Finanzas y Contabilidad' },
      { dashboard_id: 'finanzas-2', name: 'Vista regional', orden: 2, area: 'Finanzas y Contabilidad' },
    ])
    renderBarra('finanzas-2', ['dashboard.crear', 'dashboard.editar'], true)

    await screen.findByText('Vista regional')
    expect(screen.getAllByRole('button', { name: /^Editar el nombre de la pestaña/ })).toHaveLength(1)
  })

  it('renombrar la pestaña activa llama al servicio conservando el área y refresca la lista', async () => {
    dashboardLayoutService.obtenerPestanas
      .mockResolvedValueOnce([
        { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1, area: 'Finanzas y Contabilidad' },
      ])
      .mockResolvedValueOnce([
        { dashboard_id: 'finanzas', name: 'Finanzas Nacionales', orden: 1, area: 'Finanzas y Contabilidad' },
      ])
    dashboardLayoutService.actualizarDashboard.mockResolvedValue({})
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.editar'], true)

    await userEvent.click(await screen.findByRole('button', { name: /^Editar el nombre de la pestaña/ }))
    const nombreInput = await screen.findByLabelText('Nombre')
    expect(nombreInput).toHaveValue('Finanzas')

    await userEvent.clear(nombreInput)
    await userEvent.type(nombreInput, 'Finanzas Nacionales')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(dashboardLayoutService.actualizarDashboard).toHaveBeenCalledWith('finanzas', { name: 'Finanzas Nacionales', area: 'Finanzas y Contabilidad' })
    expect(await screen.findByText('Finanzas Nacionales')).toBeInTheDocument()
  })

  it('si renombrar la pestaña falla, muestra el mensaje de error del backend', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1, area: 'Finanzas y Contabilidad' },
    ])
    dashboardLayoutService.actualizarDashboard.mockRejectedValue({ response: { data: { mensaje: 'No se pudo editar la pestaña.' } } })
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.editar'], true)

    await userEvent.click(await screen.findByRole('button', { name: /^Editar el nombre de la pestaña/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('No se pudo editar la pestaña.')).toBeInTheDocument()
  })

  it('fuera de modo edición, no muestra la papelera para eliminar', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.eliminar'], false)

    await screen.findByRole('link', { name: 'Finanzas' })
    expect(screen.queryByRole('button', { name: /^Eliminar la pestaña/ })).not.toBeInTheDocument()
  })

  it('en modo edición sin el permiso dashboard.eliminar, no muestra la papelera', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    renderBarra('finanzas', ['dashboard.crear'], true)

    await screen.findByRole('link', { name: 'Finanzas' })
    expect(screen.queryByRole('button', { name: /^Eliminar la pestaña/ })).not.toBeInTheDocument()
  })

  it('en modo edición con el permiso, la papelera solo aparece en la pestaña activa', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      { dashboard_id: 'finanzas-2', name: 'Vista regional', orden: 2 },
    ])
    renderBarra('finanzas-2', ['dashboard.crear', 'dashboard.eliminar'], true)

    await screen.findByText('Vista regional')
    expect(screen.getAllByRole('button', { name: /^Eliminar la pestaña/ })).toHaveLength(1)
  })

  it('el lápiz y la papelera pueden aparecer juntos, cada uno gateado por su propio permiso', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.editar', 'dashboard.eliminar'], true)

    expect(await screen.findByRole('button', { name: /^Editar el nombre de la pestaña/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Eliminar la pestaña/ })).toBeInTheDocument()
  })

  it('el botón Eliminar exige escribir el nombre exacto de la pestaña y muestra ese nombre en un <span>', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.eliminar'], true)

    await userEvent.click(await screen.findByRole('button', { name: /^Eliminar la pestaña/ }))

    const dialogo = await screen.findByRole('dialog')
    const spanNombre = within(dialogo).getByText('Finanzas', { selector: 'span' })
    expect(spanNombre).toBeInTheDocument()

    const botonEliminar = within(dialogo).getByRole('button', { name: 'Eliminar' })
    expect(botonEliminar).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Confirmar nombre de la pestaña'), 'nombre incorrecto')
    expect(botonEliminar).toBeDisabled()
  })

  it('eliminar una pestaña que no es la raíz llama al servicio y navega a la raíz', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      { dashboard_id: 'finanzas-2', name: 'Vista regional', orden: 2 },
    ])
    dashboardLayoutService.eliminarDashboard.mockResolvedValue({})
    renderBarra('finanzas-2', ['dashboard.crear', 'dashboard.eliminar'], true)

    await userEvent.click(await screen.findByRole('button', { name: /^Eliminar la pestaña/ }))
    const dialogo = await screen.findByRole('dialog')
    await userEvent.type(within(dialogo).getByLabelText('Confirmar nombre de la pestaña'), 'Vista regional')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(dashboardLayoutService.eliminarDashboard).toHaveBeenCalledWith('finanzas-2', 'Vista regional')
    expect(mockNavigate).toHaveBeenCalledWith('/admin/dashboards/finanzas')
  })

  it('eliminar la pestaña raíz llama al servicio y navega a "Mis dashboards"', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      { dashboard_id: 'finanzas-2', name: 'Vista regional', orden: 2 },
    ])
    dashboardLayoutService.eliminarDashboard.mockResolvedValue({})
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.eliminar'], true)

    await userEvent.click(await screen.findByRole('button', { name: /^Eliminar la pestaña/ }))
    const dialogo = await screen.findByRole('dialog')
    await userEvent.type(within(dialogo).getByLabelText('Confirmar nombre de la pestaña'), 'Finanzas')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(dashboardLayoutService.eliminarDashboard).toHaveBeenCalledWith('finanzas', 'Finanzas')
    expect(mockNavigate).toHaveBeenCalledWith('/admin/dashboards')
  })

  it('si eliminar la pestaña falla, muestra el mensaje de error del backend', async () => {
    dashboardLayoutService.obtenerPestanas.mockResolvedValue([
      { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
    ])
    dashboardLayoutService.eliminarDashboard.mockRejectedValue({ response: { data: { mensaje: 'No se pudo eliminar la pestaña.' } } })
    renderBarra('finanzas', ['dashboard.crear', 'dashboard.eliminar'], true)

    await userEvent.click(await screen.findByRole('button', { name: /^Eliminar la pestaña/ }))
    const dialogo = await screen.findByRole('dialog')
    await userEvent.type(within(dialogo).getByLabelText('Confirmar nombre de la pestaña'), 'Finanzas')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('No se pudo eliminar la pestaña.')).toBeInTheDocument()
  })

  describe('carga de las pestañas', () => {
    // `cargar` está memoizado con `useCallback([dashboardId])` y listado en las dependencias del
    // efecto. Estas dos pruebas fijan justamente lo que ese cambio pone en juego: que la función
    // memoizada no cambie de identidad en cada render (lo que reejecutaría el efecto en bucle) y
    // que sí cambie cuando cambia el dashboard (lo que antes dependía de que `dashboardId`
    // estuviera declarado a mano).
    it('consulta las pestañas una sola vez por dashboard, sin reejecutarse en bucle', async () => {
      dashboardLayoutService.obtenerPestanas.mockResolvedValue([
        { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      ])
      renderBarra('finanzas')

      await screen.findByRole('link', { name: 'Finanzas' })
      // Una resolución de promesa provoca un render más: si el efecto dependiera de una función
      // recreada en cada render, ese render volvería a dispararlo y el contador seguiría subiendo.
      expect(dashboardLayoutService.obtenerPestanas).toHaveBeenCalledTimes(1)
      expect(dashboardLayoutService.obtenerPestanas).toHaveBeenCalledWith('finanzas')
    })

    it('vuelve a consultar cuando cambia el dashboard', async () => {
      dashboardLayoutService.obtenerPestanas.mockResolvedValue([
        { dashboard_id: 'finanzas', name: 'Finanzas', orden: 1 },
      ])
      useAuth.mockReturnValue({ user: { permissions: [] } })
      const { rerender } = render(
        <MemoryRouter initialEntries={['/x']}>
          <DashboardTabsBar dashboardId="finanzas" />
        </MemoryRouter>,
      )
      await screen.findByRole('link', { name: 'Finanzas' })

      dashboardLayoutService.obtenerPestanas.mockResolvedValue([
        { dashboard_id: 'logistica', name: 'Logística', orden: 1 },
      ])
      rerender(
        <MemoryRouter initialEntries={['/x']}>
          <DashboardTabsBar dashboardId="logistica" />
        </MemoryRouter>,
      )

      expect(await screen.findByRole('link', { name: 'Logística' })).toBeInTheDocument()
      expect(dashboardLayoutService.obtenerPestanas).toHaveBeenLastCalledWith('logistica')
    })
  })
})
