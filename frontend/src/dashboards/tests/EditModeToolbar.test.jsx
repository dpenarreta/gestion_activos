import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditModeToolbar from '../components/dashboard-editor/EditModeToolbar'
import { PERMISOS } from '../hooks/usePermisos'

vi.mock('../hooks/usePermisos', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, usePermisos: vi.fn(() => ({ tiene: () => true })) }
})

function renderToolbar(overrides = {}) {
  const props = {
    modoEdicion: false,
    vistaPrevia: false,
    cargando: false,
    hayCambiosSinGuardar: () => false,
    onActivarEdicion: vi.fn(),
    onGuardar: vi.fn(),
    onCancelar: vi.fn(),
    onAlternarVistaPrevia: vi.fn(),
    onRestablecer: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<EditModeToolbar {...props} />) }
}

describe('EditModeToolbar', () => {
  it('fuera de modo edición solo muestra "Editar dashboard"', () => {
    renderToolbar()
    expect(screen.getByRole('button', { name: 'Editar dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
  })

  it('al pulsar "Editar dashboard" invoca onActivarEdicion', async () => {
    const { props } = renderToolbar()
    await userEvent.click(screen.getByRole('button', { name: 'Editar dashboard' }))
    expect(props.onActivarEdicion).toHaveBeenCalledTimes(1)
  })

  it('en modo edición muestra vista previa, restablecer, cancelar y guardar', () => {
    renderToolbar({ modoEdicion: true })
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restablecer diseño' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
  })

  it('cancelar sin cambios sin guardar no pide confirmación', async () => {
    const { props } = renderToolbar({ modoEdicion: true, hayCambiosSinGuardar: () => false })
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onCancelar).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Descartar cambios sin guardar')).not.toBeInTheDocument()
  })

  it('cancelar con cambios sin guardar pide confirmación antes de descartar', async () => {
    const { props } = renderToolbar({ modoEdicion: true, hayCambiosSinGuardar: () => true })
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(props.onCancelar).not.toHaveBeenCalled()
    expect(screen.getByText('Descartar cambios sin guardar')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))
    expect(props.onCancelar).toHaveBeenCalledTimes(1)
  })

  it('restablecer pide confirmación antes de invocar onRestablecer', async () => {
    const { props } = renderToolbar({ modoEdicion: true })
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer diseño' }))

    expect(props.onRestablecer).not.toHaveBeenCalled()
    expect(screen.getByText('Restablecer visibilidad de componentes')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }))
    expect(props.onRestablecer).toHaveBeenCalledTimes(1)
  })

  it('guardar invoca onGuardar', async () => {
    const { props } = renderToolbar({ modoEdicion: true })

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(props.onGuardar).toHaveBeenCalledTimes(1)
  })

  it('no ofrece un campo para escribir el nombre del autor del cambio', () => {
    // El autor lo resuelve el backend desde el usuario autenticado. El campo que había acá
    // permitía firmar un cambio de diseño con el nombre de otra persona, y era ese el nombre que
    // mostraba el historial de versiones.
    renderToolbar({ modoEdicion: true })
    expect(screen.queryByLabelText('Nombre para el registro de auditoría')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Tu nombre (auditoría)')).not.toBeInTheDocument()
  })

  it('los botones quedan deshabilitados mientras cargando es true', () => {
    renderToolbar({ modoEdicion: true, cargando: true })
    expect(screen.getByRole('button', { name: 'Restablecer diseño' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  describe('permisos', () => {
    it('sin permiso de ver el dashboard, no renderiza ningún control', async () => {
      const { usePermisos } = await import('../hooks/usePermisos')
      usePermisos.mockReturnValueOnce({ tiene: () => false })

      const { container } = renderToolbar()
      expect(container).toBeEmptyDOMElement()
    })

    it('con permiso de ver pero sin permiso de editar, no muestra "Editar dashboard"', async () => {
      const { usePermisos } = await import('../hooks/usePermisos')
      usePermisos.mockReturnValueOnce({
        tiene: (permiso) => permiso === PERMISOS.DASHBOARD_VIEW,
      })

      const { container } = renderToolbar()
      expect(container).toBeEmptyDOMElement()
    })

    it('sin permiso de restablecer, oculta el botón "Restablecer diseño" pero conserva el resto', async () => {
      const { usePermisos } = await import('../hooks/usePermisos')
      usePermisos.mockReturnValueOnce({
        tiene: (permiso) => permiso !== PERMISOS.DASHBOARD_CONFIGURATION_RESET,
      })

      renderToolbar({ modoEdicion: true })
      expect(screen.queryByRole('button', { name: 'Restablecer diseño' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
    })
  })
})
