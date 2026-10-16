import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Pagination from '../components/common/Pagination'

describe('Pagination', () => {
  it('muestra el resumen "Mostrando X a Y de Z registros"', () => {
    render(
      <Pagination
        idBase="test"
        paginaActual={2}
        totalPaginas={10}
        totalRegistros={248}
        pageSize={25}
        onCambiarPagina={vi.fn()}
        onCambiarPageSize={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Mostrando 26 a 50 de 248 registros')
  })

  it('el selector de registros por página está asociado a su etiqueta', () => {
    render(
      <Pagination
        idBase="test"
        paginaActual={1}
        totalPaginas={1}
        totalRegistros={5}
        pageSize={10}
        onCambiarPagina={vi.fn()}
        onCambiarPageSize={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Registros por página')).toHaveValue('10')
  })

  it('llama a onCambiarPageSize con el valor numérico elegido', async () => {
    const onCambiarPageSize = vi.fn()
    render(
      <Pagination
        idBase="test"
        paginaActual={1}
        totalPaginas={5}
        totalRegistros={50}
        pageSize={10}
        onCambiarPagina={vi.fn()}
        onCambiarPageSize={onCambiarPageSize}
      />
    )
    await userEvent.selectOptions(screen.getByLabelText('Registros por página'), '50')
    expect(onCambiarPageSize).toHaveBeenCalledWith(50)
  })

  it('deshabilita primera/anterior en la primera página y siguiente/última en la última', () => {
    const { rerender } = render(
      <Pagination
        idBase="test"
        paginaActual={1}
        totalPaginas={3}
        totalRegistros={30}
        pageSize={10}
        onCambiarPagina={vi.fn()}
        onCambiarPageSize={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Primera página' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Página siguiente' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Última página' })).not.toBeDisabled()

    rerender(
      <Pagination
        idBase="test"
        paginaActual={3}
        totalPaginas={3}
        totalRegistros={30}
        pageSize={10}
        onCambiarPagina={vi.fn()}
        onCambiarPageSize={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Última página' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Primera página' })).not.toBeDisabled()
  })

  it('los botones de navegación llaman a onCambiarPagina con el número correcto', async () => {
    const onCambiarPagina = vi.fn()
    render(
      <Pagination
        idBase="test"
        paginaActual={2}
        totalPaginas={5}
        totalRegistros={50}
        pageSize={10}
        onCambiarPagina={onCambiarPagina}
        onCambiarPageSize={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    expect(onCambiarPagina).toHaveBeenCalledWith(3)
    await userEvent.click(screen.getByRole('button', { name: 'Página anterior' }))
    expect(onCambiarPagina).toHaveBeenCalledWith(1)
    await userEvent.click(screen.getByRole('button', { name: 'Primera página' }))
    expect(onCambiarPagina).toHaveBeenCalledWith(1)
    await userEvent.click(screen.getByRole('button', { name: 'Última página' }))
    expect(onCambiarPagina).toHaveBeenCalledWith(5)
  })
})
