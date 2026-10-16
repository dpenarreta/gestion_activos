import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileUploadZone from '../components/upload/FileUploadZone'

function crearArchivo(nombre, tipo) {
  return new File(['contenido'], nombre, { type: tipo })
}

describe('FileUploadZone', () => {
  it('rechaza extensiones no permitidas antes de llamar a la API', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const onValidar = vi.fn()
    render(<FileUploadZone onValidar={onValidar} cargando={false} error={null} />)

    const input = screen.getByTestId('input-archivo')
    const archivo = crearArchivo('cartera.txt', 'text/plain')
    await user.upload(input, archivo)

    expect(await screen.findByText(/solo se permiten archivos/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /validar archivo/i })).toBeDisabled()
  })

  it('habilita Validar archivo con un .xlsx valido y lo envia al hacer clic', async () => {
    const onValidar = vi.fn()
    render(<FileUploadZone onValidar={onValidar} cargando={false} error={null} />)

    const input = screen.getByTestId('input-archivo')
    const archivo = crearArchivo('cartera.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    await userEvent.upload(input, archivo)

    const boton = screen.getByRole('button', { name: /validar archivo/i })
    expect(boton).toBeEnabled()

    await userEvent.click(boton)
    expect(onValidar).toHaveBeenCalledWith(archivo)
  })

  it('muestra el error del servidor cuando se provee', () => {
    render(<FileUploadZone onValidar={vi.fn()} cargando={false} error="El archivo está corrupto." />)
    expect(screen.getByText('El archivo está corrupto.')).toBeInTheDocument()
  })
})
