import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WidthHeightControls from '../components/dashboard-editor/WidthHeightControls'

describe('WidthHeightControls', () => {
  it('elegir un preset de alto invoca onCambiarAlto con el valor en píxeles', async () => {
    const onCambiarAlto = vi.fn()
    render(<WidthHeightControls width={6} height={240} onCambiarAncho={vi.fn()} onCambiarAlto={onCambiarAlto} />)

    await userEvent.selectOptions(screen.getByLabelText('Alto'), '600')

    expect(onCambiarAlto).toHaveBeenCalledWith(600)
  })

  it('cuando el alto no coincide con ningún preset, selecciona "Personalizado" y muestra el campo numérico', () => {
    render(<WidthHeightControls width={6} height={321} onCambiarAncho={vi.fn()} onCambiarAlto={vi.fn()} />)

    expect(screen.getByLabelText('Alto')).toHaveValue('personalizado')
    expect(screen.getByLabelText('Alto personalizado (px)')).toHaveValue(321)
  })

  it('el campo de alto personalizado respeta el mínimo de 60px', () => {
    const onCambiarAlto = vi.fn()
    render(<WidthHeightControls width={6} height={321} onCambiarAncho={vi.fn()} onCambiarAlto={onCambiarAlto} />)

    fireEvent.change(screen.getByLabelText('Alto personalizado (px)'), { target: { value: '10' } })

    expect(onCambiarAlto).toHaveBeenLastCalledWith(60)
  })

  it('elegir un ancho invoca onCambiarAncho con el número de columnas', async () => {
    const onCambiarAncho = vi.fn()
    render(<WidthHeightControls width={2} height={240} onCambiarAncho={onCambiarAncho} onCambiarAlto={vi.fn()} />)

    await userEvent.selectOptions(screen.getByLabelText('Ancho'), '9')

    expect(onCambiarAncho).toHaveBeenCalledWith(9)
  })

  it('disabled deshabilita los selectores de ancho y alto', () => {
    render(<WidthHeightControls width={6} height={240} onCambiarAncho={vi.fn()} onCambiarAlto={vi.fn()} disabled />)

    expect(screen.getByLabelText('Ancho')).toBeDisabled()
    expect(screen.getByLabelText('Alto')).toBeDisabled()
  })

  it('disabled deshabilita también el campo de alto personalizado', () => {
    render(<WidthHeightControls width={6} height={321} onCambiarAncho={vi.fn()} onCambiarAlto={vi.fn()} disabled />)

    expect(screen.getByLabelText('Alto personalizado (px)')).toBeDisabled()
  })
})
