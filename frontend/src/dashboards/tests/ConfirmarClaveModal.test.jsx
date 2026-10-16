import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmarClaveModal from '../components/dashboard-editor/ConfirmarClaveModal'

/**
 * El cuadro que pide la contraseña para autorizar UN cambio estructural en un dashboard con el
 * diseño bloqueado.
 *
 * Lo que importa verificar es que una contraseña equivocada no haga perder el trabajo: el cuadro
 * se queda abierto con el mensaje, en vez de cerrarse y dejar a la persona sin saber qué pasó con
 * los cambios que estaba guardando.
 */

function pintar(props = {}) {
  const onConfirmar = props.onConfirmar || vi.fn().mockResolvedValue({ ok: true })
  const onCancelar = props.onCancelar || vi.fn()
  render(
    <ConfirmarClaveModal show accion="guardar estos cambios" onConfirmar={onConfirmar} onCancelar={onCancelar} />,
  )
  return { onConfirmar, onCancelar }
}

async function escribirYConfirmar(usuario, clave) {
  await usuario.type(screen.getByLabelText('Contraseña'), clave)
  await usuario.click(screen.getByRole('button', { name: 'Confirmar' }))
}

describe('ConfirmarClaveModal', () => {
  it('dice qué acción se está autorizando', () => {
    pintar()
    expect(screen.getByText(/guardar estos cambios/)).toBeInTheDocument()
  })

  it('entrega la contraseña escrita', async () => {
    const usuario = userEvent.setup()
    const { onConfirmar } = pintar()
    await escribirYConfirmar(usuario, 'mi-clave')
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith('mi-clave'))
  })

  it('no se puede confirmar sin escribir nada', () => {
    pintar()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('con la contraseña equivocada se queda abierto y muestra el motivo', async () => {
    const usuario = userEvent.setup()
    pintar({ onConfirmar: vi.fn().mockResolvedValue({ ok: false, mensaje: 'La contraseña no es correcta.' }) })
    await escribirYConfirmar(usuario, 'equivocada')
    await waitFor(() => expect(screen.getByText('La contraseña no es correcta.')).toBeInTheDocument())
    // El campo queda vacío y listo para reintentar, no se pierde el cambio que se estaba haciendo.
    expect(screen.getByLabelText('Contraseña')).toHaveValue('')
  })

  it('el campo es de tipo contraseña, no texto visible', () => {
    pintar()
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password')
  })

  it('cancelar no intenta nada', async () => {
    const usuario = userEvent.setup()
    const { onConfirmar, onCancelar } = pintar()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancelar).toHaveBeenCalled()
    expect(onConfirmar).not.toHaveBeenCalled()
  })
})
