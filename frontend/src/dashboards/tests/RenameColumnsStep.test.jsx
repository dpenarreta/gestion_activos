import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RenameColumnsStep from '../components/dashboard-generic/RenameColumnsStep'

function renderComponente(overrides = {}) {
  const props = {
    archivoInfo: { nombreArchivo: 'datos.xlsx', totalFilas: 10 },
    columnas: ['Saldo', 'Ciudad'],
    aliases: { Saldo: 'Saldo', Ciudad: 'Ciudad' },
    onActualizarAlias: vi.fn(),
    onCambiarColumnaHistorica: vi.fn(),
    onContinuar: vi.fn(),
    onCancelar: vi.fn(),
    cargando: false,
    error: null,
    ...overrides,
  }
  const resultado = render(<RenameColumnsStep {...props} />)
  return { props, ...resultado }
}

describe('RenameColumnsStep', () => {
  it('muestra todas las columnas del archivo, con el nombre fuente a la derecha', () => {
    renderComponente()
    expect(screen.getByLabelText('Nuevo nombre para Saldo')).toHaveValue('Saldo')
    expect(screen.getByLabelText('Nuevo nombre para Ciudad')).toHaveValue('Ciudad')
    // El nombre original ("fuente") se muestra como referencia junto al input de cada columna.
    const filas = screen.getAllByRole('row')
    expect(filas.some((f) => f.textContent.includes('Saldo'))).toBe(true)
    expect(filas.some((f) => f.textContent.includes('Ciudad'))).toBe(true)
  })

  it('escribir un nuevo nombre invoca onActualizarAlias con la columna original y el valor nuevo', async () => {
    const { props } = renderComponente()
    const input = screen.getByLabelText('Nuevo nombre para Saldo')
    await userEvent.type(input, 'X')
    expect(props.onActualizarAlias).toHaveBeenCalledWith('Saldo', 'SaldoX')
  })

  it('"Continuar" invoca onContinuar', async () => {
    const { props } = renderComponente()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(props.onContinuar).toHaveBeenCalled()
  })

  it('"Cancelar" invoca onCancelar', async () => {
    const { props } = renderComponente()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onCancelar).toHaveBeenCalled()
  })

  it('dos columnas con el mismo nuevo nombre deshabilitan "Continuar" y muestran una alerta', () => {
    renderComponente({ aliases: { Saldo: 'Monto', Ciudad: 'Monto' } })
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    expect(screen.getByText(/mismo nuevo nombre/)).toBeInTheDocument()
  })

  it('mientras cargando, el botón de continuar queda deshabilitado', () => {
    renderComponente({ cargando: true })
    expect(screen.getByRole('button', { name: /Analizando/ })).toBeDisabled()
  })

  it('muestra el error recibido', () => {
    renderComponente({ error: 'No se pudo analizar el archivo.' })
    expect(screen.getByText('No se pudo analizar el archivo.')).toBeInTheDocument()
  })

  it('sin columnas detectadas, muestra una advertencia', () => {
    renderComponente({ columnas: [], aliases: {} })
    expect(screen.getByText('No se detectaron columnas en el archivo.')).toBeInTheDocument()
  })

  describe('casilla "columna histórica"', () => {
    it('muestra una casilla por columna, sin tildar si no está en columnasHistoricas', () => {
      renderComponente()
      expect(screen.getByLabelText('Marcar "Saldo" como columna histórica')).not.toBeChecked()
      expect(screen.getByLabelText('Marcar "Ciudad" como columna histórica')).not.toBeChecked()
    })

    it('columnasHistoricas tilda la casilla correspondiente', () => {
      renderComponente({ columnasHistoricas: ['Saldo'] })
      expect(screen.getByLabelText('Marcar "Saldo" como columna histórica')).toBeChecked()
      expect(screen.getByLabelText('Marcar "Ciudad" como columna histórica')).not.toBeChecked()
    })

    it('tildar la casilla invoca onCambiarColumnaHistorica con la columna original y true', async () => {
      const { props } = renderComponente()
      await userEvent.click(screen.getByLabelText('Marcar "Saldo" como columna histórica'))
      expect(props.onCambiarColumnaHistorica).toHaveBeenCalledWith('Saldo', true)
    })

    it('destildar la casilla invoca onCambiarColumnaHistorica con false', async () => {
      const { props } = renderComponente({ columnasHistoricas: ['Saldo'] })
      await userEvent.click(screen.getByLabelText('Marcar "Saldo" como columna histórica'))
      expect(props.onCambiarColumnaHistorica).toHaveBeenCalledWith('Saldo', false)
    })
  })

  describe('aviso de columnas históricas faltantes', () => {
    it('sin columnasHistoricasConfiguradas, no muestra ninguna advertencia', () => {
      renderComponente()
      expect(screen.queryByText(/estaban marcadas como históricas/)).not.toBeInTheDocument()
    })

    it('si las columnas configuradas están todas presentes, no muestra nada', () => {
      renderComponente({
        columnas: ['Saldo', 'Ciudad'],
        aliases: { Saldo: 'Saldo', Ciudad: 'Ciudad' },
        columnasHistoricasConfiguradas: ['Saldo'],
      })
      expect(screen.queryByText(/estaban marcadas como históricas/)).not.toBeInTheDocument()
    })

    it('una columna configurada ausente en este archivo: muestra una advertencia que la nombra y BLOQUEA "Continuar"', () => {
      renderComponente({
        columnas: ['Ciudad'],
        aliases: { Ciudad: 'Ciudad' },
        columnasHistoricasConfiguradas: ['Saldo', 'Ciudad'],
      })
      const alerta = screen.getByText(/estaban marcadas como históricas/)
      expect(alerta).toBeInTheDocument()
      expect(screen.getByLabelText('Columna que corresponde a la columna histórica "Saldo"')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    })

    it('el alias aplicado se usa para la comparación, no el nombre original de la columna', () => {
      renderComponente({
        columnas: ['saldo_usd'],
        aliases: { saldo_usd: 'Saldo' },
        columnasHistoricasConfiguradas: ['Saldo'],
      })
      expect(screen.queryByText(/estaban marcadas como históricas/)).not.toBeInTheDocument()
    })

    it('identificar la columna que reemplaza a la histórica aplica el alias y la vuelve a marcar como histórica', async () => {
      const usuario = userEvent.setup()
      const { props } = renderComponente({
        columnas: ['saldo_usd', 'Ciudad'],
        aliases: { saldo_usd: 'saldo_usd', Ciudad: 'Ciudad' },
        columnasHistoricasConfiguradas: ['Saldo'],
      })
      const selector = screen.getByLabelText('Columna que corresponde a la columna histórica "Saldo"')

      await usuario.selectOptions(selector, 'saldo_usd')

      expect(props.onActualizarAlias).toHaveBeenCalledWith('saldo_usd', 'Saldo')
      expect(props.onCambiarColumnaHistorica).toHaveBeenCalledWith('saldo_usd', true)
    })

    it('tras identificar la columna (alias ya aplicado), la fila desaparece y "Continuar" se habilita', () => {
      const { rerender } = renderComponente({
        columnas: ['saldo_usd', 'Ciudad'],
        aliases: { saldo_usd: 'saldo_usd', Ciudad: 'Ciudad' },
        columnasHistoricasConfiguradas: ['Saldo'],
      })
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()

      rerender(
        <RenameColumnsStep
          archivoInfo={{ nombreArchivo: 'datos.xlsx', totalFilas: 10 }}
          columnas={['saldo_usd', 'Ciudad']}
          aliases={{ saldo_usd: 'Saldo', Ciudad: 'Ciudad' }}
          onActualizarAlias={vi.fn()}
          onCambiarColumnaHistorica={vi.fn()}
          onContinuar={vi.fn()}
          onCancelar={vi.fn()}
          cargando={false}
          error={null}
          columnasHistoricasConfiguradas={['Saldo']}
        />,
      )

      expect(screen.queryByText(/estaban marcadas como históricas/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled()
    })

    it('confirmar "Ya no existe en este archivo" desbloquea "Continuar" sin tocar ningún alias', async () => {
      const usuario = userEvent.setup()
      const { props } = renderComponente({
        columnas: ['Ciudad'],
        aliases: { Ciudad: 'Ciudad' },
        columnasHistoricasConfiguradas: ['Saldo'],
      })
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()

      const selector = screen.getByLabelText('Columna que corresponde a la columna histórica "Saldo"')
      await usuario.selectOptions(selector, 'Ya no existe en este archivo')

      expect(props.onActualizarAlias).not.toHaveBeenCalled()
      expect(props.onCambiarColumnaHistorica).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toContain('Confirmaste que "Saldo" ya no está en este archivo')
      expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled()
    })

    it('"Deshacer" sobre una ausencia confirmada vuelve a bloquear "Continuar"', async () => {
      const usuario = userEvent.setup()
      renderComponente({
        columnas: ['Ciudad'],
        aliases: { Ciudad: 'Ciudad' },
        columnasHistoricasConfiguradas: ['Saldo'],
      })
      await usuario.selectOptions(
        screen.getByLabelText('Columna que corresponde a la columna histórica "Saldo"'), 'Ya no existe en este archivo',
      )
      expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled()

      await usuario.click(screen.getByRole('button', { name: 'Deshacer' }))

      expect(screen.getByLabelText('Columna que corresponde a la columna histórica "Saldo"')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    })

    it('con dos columnas faltantes, "Continuar" sigue bloqueado hasta resolver AMBAS', async () => {
      const usuario = userEvent.setup()
      renderComponente({
        columnas: ['Ciudad'],
        aliases: { Ciudad: 'Ciudad' },
        columnasHistoricasConfiguradas: ['Saldo', 'Region'],
      })
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()

      await usuario.selectOptions(
        screen.getByLabelText('Columna que corresponde a la columna histórica "Saldo"'), 'Ya no existe en este archivo',
      )
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()

      await usuario.selectOptions(
        screen.getByLabelText('Columna que corresponde a la columna histórica "Region"'), 'Ya no existe en este archivo',
      )
      expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled()
    })
  })
})
