import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ValoresEnBlancoStep from '../components/dashboard-generic/ValoresEnBlancoStep'

function renderComponente(overrides = {}) {
  const props = {
    archivoInfo: { nombreArchivo: 'datos.xlsx', totalFilas: 20 },
    columnasConBlancos: [
      { columna: 'Alterno Cliente', cantidad_en_blanco: 15, filas_ejemplo: [{ numero_fila: 2, referencia: { Sucursal: 'MATRIZ' } }] },
    ],
    valoresBlancos: {},
    columnas: [{ nombre: 'Alterno Cliente', tipo: 'vacio', apta_para_valor: false, apta_para_categoria: false, motivo_no_apta: 'La columna está vacía.' }],
    onActualizarValorBlanco: vi.fn(),
    onContinuar: vi.fn(),
    onCancelar: vi.fn(),
    cargando: false,
    error: null,
    ...overrides,
  }
  return { props, ...render(<ValoresEnBlancoStep {...props} />) }
}

describe('ValoresEnBlancoStep', () => {
  it('muestra cada columna con su cantidad de blancos', () => {
    renderComponente()
    expect(screen.getByText('Alterno Cliente')).toBeInTheDocument()
    expect(screen.getByText(/15 fila\(s\) en blanco/)).toBeInTheDocument()
  })

  it('muestra el tratamiento habitual según la aptitud de la columna', () => {
    renderComponente({
      columnas: [{ nombre: 'Alterno Cliente', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false }],
    })
    expect(screen.getByText(/se van a ignorar en las sumas y promedios/)).toBeInTheDocument()
  })

  it('escribir un valor de reemplazo invoca onActualizarValorBlanco con la columna y el valor', async () => {
    const { props } = renderComponente()
    const input = screen.getByLabelText('Valor de reemplazo para Alterno Cliente')
    await userEvent.type(input, '5')
    expect(props.onActualizarValorBlanco).toHaveBeenLastCalledWith('Alterno Cliente', '5')
  })

  it('el input refleja el valor ya elegido en valoresBlancos', () => {
    renderComponente({ valoresBlancos: { 'Alterno Cliente': '7' } })
    expect(screen.getByLabelText('Valor de reemplazo para Alterno Cliente')).toHaveValue('7')
  })

  it('columna marcada como histórica: muestra el badge correspondiente', () => {
    renderComponente({ columnasHistoricas: ['Alterno Cliente'] })
    expect(screen.getByText(/usada en Tabla 3 \(histórica\)/)).toBeInTheDocument()
  })

  it('columna que no está marcada como histórica: no muestra el badge', () => {
    renderComponente({ columnasHistoricas: ['Otra'] })
    expect(screen.queryByText(/usada en .* \(histórica\)/)).not.toBeInTheDocument()
  })

  it('"Continuar" invoca onContinuar y nunca queda deshabilitado por los campos vacíos', async () => {
    const { props } = renderComponente()
    const boton = screen.getByRole('button', { name: 'Continuar' })
    expect(boton).not.toBeDisabled()
    await userEvent.click(boton)
    expect(props.onContinuar).toHaveBeenCalled()
  })

  it('"Cancelar" invoca onCancelar', async () => {
    const { props } = renderComponente()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onCancelar).toHaveBeenCalled()
  })

  it('mientras cargando, "Continuar" queda deshabilitado', () => {
    renderComponente({ cargando: true })
    expect(screen.getByRole('button', { name: /Aplicando/ })).toBeDisabled()
  })

  it('muestra el error recibido', () => {
    renderComponente({ error: 'No se pudo aplicar los valores de reemplazo.' })
    expect(screen.getByText('No se pudo aplicar los valores de reemplazo.')).toBeInTheDocument()
  })
})
