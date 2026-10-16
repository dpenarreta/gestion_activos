import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConectarFuenteBDModal from '../components/dashboards/ConectarFuenteBDModal'
import * as dashboardLayoutService from '../services/dashboardLayoutService'

vi.mock('../services/dashboardLayoutService')

function renderModal(overrides = {}) {
  const props = {
    show: true,
    onHide: vi.fn(),
    dashboardId: 'finanzas',
    dashboardNombre: 'Finanzas',
    onConectar: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
  return { props, ...render(<ConectarFuenteBDModal {...props} />) }
}

beforeEach(() => {
  vi.clearAllMocks()
  dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({ tipo: '', nombre: '' })
  dashboardLayoutService.actualizarFuenteBD.mockResolvedValue({ tipo: '', nombre: '' })
})

describe('ConectarFuenteBDModal', () => {
  it('sin fuente configurada, carga sin tipo elegido y sin campo de nombre', async () => {
    renderModal()
    expect(await screen.findByLabelText('Tipo de fuente')).toHaveValue('')
    expect(screen.queryByLabelText(/^Nombre/)).not.toBeInTheDocument()
  })

  it('sin tipo elegido, "Conectar" queda deshabilitado', async () => {
    renderModal()
    await screen.findByLabelText('Tipo de fuente')
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeDisabled()
  })

  it('con una fuente ya configurada, precarga el tipo y el nombre', async () => {
    dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({ tipo: 'procedimiento', nombre: 'dbo.sp_Reporte' })
    renderModal()
    expect(await screen.findByLabelText('Tipo de fuente')).toHaveValue('procedimiento')
    expect(screen.getByLabelText('Nombre del procedimiento')).toHaveValue('dbo.sp_Reporte')
  })

  it('elegir "Vista" muestra el campo de nombre con la etiqueta correspondiente', async () => {
    renderModal()
    await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'vista')
    expect(screen.getByLabelText('Nombre de la vista')).toBeInTheDocument()
  })

  it('elegir "Procedimiento almacenado" muestra el campo de nombre con la etiqueta correspondiente', async () => {
    renderModal()
    await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
    expect(screen.getByLabelText('Nombre del procedimiento')).toBeInTheDocument()
  })

  it('un nombre con caracteres inválidos deshabilita "Conectar"', async () => {
    renderModal()
    await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'vista')
    await userEvent.type(screen.getByLabelText('Nombre de la vista'), 'vista; drop table x')
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeDisabled()
  })

  it('un nombre válido con esquema habilita "Conectar", guarda, conecta y cierra el modal', async () => {
    const { props } = renderModal()
    await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
    await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_Reporte_Seguimiento_Cartera')

    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
      'finanzas',
      {
        tipo: 'procedimiento', nombre: 'dbo.sp_Reporte_Seguimiento_Cartera', parametros: {},
        fechaFormato: 'YYYY-MM-DD', frecuenciaActualizacion: '',
      },
    ))
    await waitFor(() => expect(props.onConectar).toHaveBeenCalledTimes(1))
    expect(props.onHide).toHaveBeenCalledTimes(1)
  })

  it('un error del backend al guardar se muestra, no llama a onConectar y no cierra el modal', async () => {
    dashboardLayoutService.actualizarFuenteBD.mockRejectedValue({
      response: { data: { mensaje: 'El nombre de la vista/procedimiento solo puede tener letras, números, guion bajo...' } },
    })
    const { props } = renderModal()
    await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'vista')
    await userEvent.type(screen.getByLabelText('Nombre de la vista'), 'dbo.v')

    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    expect(await screen.findByText(/El nombre de la vista\/procedimiento solo puede tener/)).toBeInTheDocument()
    expect(props.onConectar).not.toHaveBeenCalled()
    expect(props.onHide).not.toHaveBeenCalled()
  })

  it('"Cancelar" invoca onHide sin guardar ni conectar', async () => {
    const { props } = renderModal()
    await screen.findByLabelText('Tipo de fuente')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onHide).toHaveBeenCalledTimes(1)
    expect(dashboardLayoutService.actualizarFuenteBD).not.toHaveBeenCalled()
    expect(props.onConectar).not.toHaveBeenCalled()
  })

  describe('la conexión en sí falla (onConectar devuelve ok:false)', () => {
    async function llegarAErrorDeConexion(props) {
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_no_existe')
      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      return props
    }

    it('no cierra el modal y muestra el mensaje fijo como span, sin exponer el detalle técnico', async () => {
      const onConectar = vi.fn().mockResolvedValue({ ok: false })
      const { props } = renderModal({ onConectar })

      await llegarAErrorDeConexion(props)

      const span = screen.getByRole('alert')
      expect(span.tagName).toBe('SPAN')
      expect(span).toHaveTextContent(
        'Error de conexión: No se encontró la vista seleccionada. Por favor, comuníquese con el departamento de TI.',
      )
      expect(props.onHide).not.toHaveBeenCalled()
      // La configuración sí se guardó (solo la CONEXIÓN falló) — eso ya pasó antes de llegar acá.
      expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledTimes(1)
    })

    it('"Aceptar" recién ahí cierra el modal y vuelve al dashboard', async () => {
      const onConectar = vi.fn().mockResolvedValue({ ok: false })
      const { props } = renderModal({ onConectar })
      await llegarAErrorDeConexion(props)
      expect(props.onHide).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }))

      expect(props.onHide).toHaveBeenCalledTimes(1)
    })

    it('no muestra el formulario de tipo/nombre mientras el mensaje de error está visible', async () => {
      const onConectar = vi.fn().mockResolvedValue({ ok: false })
      const { props } = renderModal({ onConectar })
      await llegarAErrorDeConexion(props)

      expect(screen.queryByLabelText('Tipo de fuente')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Conectar' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
    })
  })

  describe('parámetro del procedimiento (FechaCorte)', () => {
    it('tipo "Vista" no muestra la sección de parámetros', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'vista')
      expect(screen.queryByText('Parámetro del procedimiento (opcional)')).not.toBeInTheDocument()
    })

    it('tipo "Procedimiento almacenado" muestra el campo FechaCorte vacío, como selector de fecha', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      const campo = screen.getByLabelText('FechaCorte')
      expect(campo).toHaveValue('')
      expect(campo).toHaveAttribute('type', 'date')
    })

    it('con la fecha de corte ya configurada, precarga el valor', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: { FechaCorte: '2026-07-31' },
      })
      renderModal()
      await screen.findByLabelText('Tipo de fuente')
      expect(screen.getByLabelText('FechaCorte')).toHaveValue('2026-07-31')
    })

    it('conectar arma el diccionario de parámetros con la fecha elegida', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_Reporte')
      await userEvent.type(screen.getByLabelText('FechaCorte'), '2026-07-31')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
        'finanzas',
        {
          tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: { FechaCorte: '2026-07-31' },
          fechaFormato: 'YYYY-MM-DD', frecuenciaActualizacion: '',
        },
      ))
    })

    it('cambiar de "Procedimiento" a "Vista" no envía parámetros aunque haya quedado cargada una fecha', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('FechaCorte'), '2026-07-31')
      await userEvent.selectOptions(screen.getByLabelText('Tipo de fuente'), 'vista')
      await userEvent.type(screen.getByLabelText('Nombre de la vista'), 'dbo.v')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
        'finanzas', { tipo: 'vista', nombre: 'dbo.v', parametros: {}, fechaFormato: 'YYYY-MM-DD', frecuenciaActualizacion: '' },
      ))
    })

    it('muestra el selector "Formato de envío" con AAAA-MM-DD por defecto', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      expect(screen.getByLabelText('Formato de envío de FechaCorte')).toHaveValue('YYYY-MM-DD')
    })

    it('con un formato ya configurado, lo precarga', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', fecha_formato: 'DD/MM/YYYY',
      })
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      expect(screen.getByLabelText('Formato de envío de FechaCorte')).toHaveValue('DD/MM/YYYY')
    })

    it('tipo "Vista" no muestra el selector de formato de envío', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'vista')
      expect(screen.queryByLabelText('Formato de envío de FechaCorte')).not.toBeInTheDocument()
    })

    it('cambiar el formato de envío lo incluye en el payload al conectar', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_Reporte')
      await userEvent.selectOptions(screen.getByLabelText('Formato de envío de FechaCorte'), 'DD/MM/YYYY')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
        'finanzas',
        { tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: {}, fechaFormato: 'DD/MM/YYYY', frecuenciaActualizacion: '' },
      ))
    })
  })

  describe('nombre del parámetro (configurable)', () => {
    it('tipo "Procedimiento almacenado" muestra el campo "Nombre del parámetro" vacío por defecto', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      expect(screen.getByLabelText('Nombre del parámetro')).toHaveValue('')
    })

    it('con un nombre de parámetro ya configurado, distinto del default, lo precarga y renombra el selector de fecha', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: { Fecha: '2026-07-31' },
      })
      renderModal()
      await screen.findByLabelText('Tipo de fuente')
      expect(screen.getByLabelText('Nombre del parámetro')).toHaveValue('Fecha')
      expect(screen.getByLabelText('Fecha')).toHaveValue('2026-07-31')
      expect(screen.queryByLabelText('FechaCorte')).not.toBeInTheDocument()
    })

    it('con el nombre de parámetro guardado igual al default, deja el campo de nombre en blanco', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: { FechaCorte: '2026-07-31' },
      })
      renderModal()
      await screen.findByLabelText('Tipo de fuente')
      expect(screen.getByLabelText('Nombre del parámetro')).toHaveValue('')
    })

    it('un nombre de parámetro con espacios deshabilita "Conectar"', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_Reporte')
      await userEvent.type(screen.getByLabelText('Nombre del parámetro'), 'Fecha Corte')
      expect(screen.getByRole('button', { name: 'Conectar' })).toBeDisabled()
    })

    it('un nombre de parámetro personalizado se usa como clave del payload de parámetros', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_Reporte')
      await userEvent.type(screen.getByLabelText('Nombre del parámetro'), 'Fecha')
      await userEvent.type(screen.getByLabelText('Fecha'), '2026-07-31')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
        'finanzas',
        {
          tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: { Fecha: '2026-07-31' },
          fechaFormato: 'YYYY-MM-DD', frecuenciaActualizacion: '',
        },
      ))
    })

    it('dejar el nombre de parámetro en blanco procesa igual, usando "FechaCorte" como clave', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'procedimiento')
      await userEvent.type(screen.getByLabelText('Nombre del procedimiento'), 'dbo.sp_Reporte')
      await userEvent.type(screen.getByLabelText('FechaCorte'), '2026-07-31')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
        'finanzas',
        {
          tipo: 'procedimiento', nombre: 'dbo.sp_Reporte', parametros: { FechaCorte: '2026-07-31' },
          fechaFormato: 'YYYY-MM-DD', frecuenciaActualizacion: '',
        },
      ))
    })
  })

  describe('borrar todos los datos', () => {
    it('sin onDatosBorrados, no muestra el botón de borrado', async () => {
      renderModal({ onDatosBorrados: undefined })
      await screen.findByLabelText('Tipo de fuente')
      expect(screen.queryByRole('button', { name: 'Borrar todos los datos' })).not.toBeInTheDocument()
    })

    it('con onDatosBorrados, muestra el botón y al hacer clic pide confirmar el nombre', async () => {
      renderModal({ onDatosBorrados: vi.fn() })
      await screen.findByLabelText('Tipo de fuente')

      await userEvent.click(screen.getByRole('button', { name: 'Borrar todos los datos' }))

      expect(screen.getByText('Finanzas')).toBeInTheDocument()
      expect(screen.getByLabelText('Confirmar nombre del dashboard')).toHaveValue('')
      expect(screen.getByRole('button', { name: 'Borrar todo' })).toBeDisabled()
    })

    it('un nombre que no coincide deja "Borrar todo" deshabilitado', async () => {
      renderModal({ onDatosBorrados: vi.fn() })
      await screen.findByLabelText('Tipo de fuente')
      await userEvent.click(screen.getByRole('button', { name: 'Borrar todos los datos' }))

      await userEvent.type(screen.getByLabelText('Confirmar nombre del dashboard'), 'Finanzas mal escrito')

      expect(screen.getByRole('button', { name: 'Borrar todo' })).toBeDisabled()
    })

    it('el nombre exacto habilita "Borrar todo", lo confirma y cierra el modal', async () => {
      const onDatosBorrados = vi.fn().mockResolvedValue()
      const { props } = renderModal({ onDatosBorrados })
      await screen.findByLabelText('Tipo de fuente')
      await userEvent.click(screen.getByRole('button', { name: 'Borrar todos los datos' }))
      await userEvent.type(screen.getByLabelText('Confirmar nombre del dashboard'), 'Finanzas')

      await userEvent.click(screen.getByRole('button', { name: 'Borrar todo' }))

      await waitFor(() => expect(onDatosBorrados).toHaveBeenCalledWith('Finanzas'))
      await waitFor(() => expect(props.onHide).toHaveBeenCalledTimes(1))
    })

    it('"Cancelar" en la confirmación vuelve al formulario sin borrar nada', async () => {
      const onDatosBorrados = vi.fn()
      renderModal({ onDatosBorrados })
      await screen.findByLabelText('Tipo de fuente')
      await userEvent.click(screen.getByRole('button', { name: 'Borrar todos los datos' }))

      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

      expect(screen.getByLabelText('Tipo de fuente')).toBeInTheDocument()
      expect(onDatosBorrados).not.toHaveBeenCalled()
    })

    it('un error al borrar se muestra y no cierra el modal', async () => {
      const onDatosBorrados = vi.fn().mockRejectedValue({ response: { data: { mensaje: 'No tiene permiso.' } } })
      const { props } = renderModal({ onDatosBorrados })
      await screen.findByLabelText('Tipo de fuente')
      await userEvent.click(screen.getByRole('button', { name: 'Borrar todos los datos' }))
      await userEvent.type(screen.getByLabelText('Confirmar nombre del dashboard'), 'Finanzas')

      await userEvent.click(screen.getByRole('button', { name: 'Borrar todo' }))

      expect(await screen.findByText('No tiene permiso.')).toBeInTheDocument()
      expect(props.onHide).not.toHaveBeenCalled()
    })
  })

  describe('actualización automática (frecuencia)', () => {
    it('tipo "Ninguna" (sin fuente) no muestra el selector de frecuencia', async () => {
      renderModal()
      await screen.findByLabelText('Tipo de fuente')
      expect(screen.queryByLabelText('Actualización automática')).not.toBeInTheDocument()
    })

    it('con un tipo elegido, muestra el selector de frecuencia en "Manual" por defecto', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'vista')
      expect(screen.getByLabelText('Actualización automática')).toHaveValue('')
    })

    it('con una frecuencia ya configurada, la precarga', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'vista', nombre: 'dbo.v', frecuencia_actualizacion: 'semanal',
      })
      renderModal()
      expect(await screen.findByLabelText('Actualización automática')).toHaveValue('semanal')
    })

    it('elegir "Semanal" y confirmar la envía en el payload', async () => {
      renderModal()
      await userEvent.selectOptions(await screen.findByLabelText('Tipo de fuente'), 'vista')
      await userEvent.type(screen.getByLabelText('Nombre de la vista'), 'dbo.v')
      await userEvent.selectOptions(screen.getByLabelText('Actualización automática'), 'semanal')

      await userEvent.click(screen.getByRole('button', { name: 'Conectar' }))

      await waitFor(() => expect(dashboardLayoutService.actualizarFuenteBD).toHaveBeenCalledWith(
        'finanzas', { tipo: 'vista', nombre: 'dbo.v', parametros: {}, fechaFormato: 'YYYY-MM-DD', frecuenciaActualizacion: 'semanal' },
      ))
    })

    it('con frecuencia mensual ya anclada a un día, muestra ese día en el texto de ayuda', async () => {
      dashboardLayoutService.obtenerFuenteBD.mockResolvedValue({
        tipo: 'vista', nombre: 'dbo.v', frecuencia_actualizacion: 'mensual', dia_configuracion_mensual: 12,
      })
      renderModal()
      await screen.findByLabelText('Actualización automática')
      expect(screen.getByText(/el día 12 de cada mes/)).toBeInTheDocument()
    })
  })
})
