import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGenericDashboardBuilder } from '../hooks/useGenericDashboardBuilder'
import * as carteraService from '../services/carteraService'

vi.mock('../services/carteraService')

function archivoDePrueba() {
  return new File(['contenido'], 'datos.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const COLUMNAS_DETECTADAS = ['Saldo', 'Ciudad']

const MAPEO_SUGERIDO = {
  'kpi-1': { disponible: true, columna_valor: 'Saldo' },
  'grafico-1': { disponible: true, columna_categoria: 'Ciudad', columna_valor: 'Saldo' },
}

const DATOS_SUGERIDOS = {
  'kpi-1': { titulo: 'KPI 1', valor: 1000, formato: 'numero' },
  'grafico-1': { titulo: 'Gráfico 1', categorias: ['Quito'], valores: [1000] },
}

/** Sube y valida el archivo, y confirma el paso de renombrado (sin cambiar ningún alias) para
 * llegar a la fase MAPEO — la mayoría de los tests de mapeo no les interesa el renombrado en sí. */
async function subirYLlegarAMapeo(result) {
  await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })
  await act(async () => { await result.current.confirmarRenombrado() })
}

beforeEach(() => {
  vi.clearAllMocks()
  carteraService.validarArchivo.mockResolvedValue({
    carga_id: 'carga-1', nombre_archivo: 'datos.xlsx', tamano_bytes: 100, total_filas_detectadas: 10,
    hojas_disponibles: ['Hoja1'], hoja_seleccionada: 'Hoja1', columnas_detectadas: COLUMNAS_DETECTADAS,
  })
  carteraService.sugerirMapeoPlantilla.mockResolvedValue({
    carga_id: 'carga-1',
    columnas: [
      { nombre: 'Saldo', tipo: 'numerico', apta_para_valor: true, apta_para_categoria: false },
      { nombre: 'Ciudad', tipo: 'categorico', apta_para_valor: false, apta_para_categoria: true },
    ],
    mapeo: MAPEO_SUGERIDO,
    datos: DATOS_SUGERIDOS,
  })
  carteraService.aplicarMapeoPlantilla.mockResolvedValue({ dashboard_id: 'finanzas', version: 2, components: [] })
  carteraService.previsualizarMapeoPlantilla.mockResolvedValue({ datos: DATOS_SUGERIDOS })
})

describe('useGenericDashboardBuilder', () => {
  it('subirYValidar analiza el archivo y pasa a la fase RENOMBRAR con las columnas detectadas', async () => {
    const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))

    await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

    expect(carteraService.sugerirMapeoPlantilla).not.toHaveBeenCalled()
    expect(result.current.fase).toBe(result.current.FASE.RENOMBRAR)
    expect(result.current.columnasOriginales).toEqual(COLUMNAS_DETECTADAS)
    // Por defecto el alias de cada columna es su propio nombre.
    expect(result.current.aliases).toEqual({ Saldo: 'Saldo', Ciudad: 'Ciudad' })
  })

  it('subirYValidar propaga el error cuando la validación falla', async () => {
    carteraService.validarArchivo.mockRejectedValue({ response: { data: { mensaje: 'Archivo inválido.' } } })
    const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))

    await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

    expect(result.current.error).toBe('Archivo inválido.')
    expect(result.current.fase).toBe(result.current.FASE.CARGA)
  })

  describe('actualizarAlias', () => {
    it('ajusta el alias de una columna sin perder los de las demás', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

      act(() => result.current.actualizarAlias('Saldo', 'Monto Adeudado'))

      expect(result.current.aliases).toEqual({ Saldo: 'Monto Adeudado', Ciudad: 'Ciudad' })
    })
  })

  describe('cancelarRenombrado', () => {
    it('regresa a la fase CARGA sin llamar a ningún servicio', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

      act(() => result.current.cancelarRenombrado())

      expect(result.current.fase).toBe(result.current.FASE.CARGA)
      expect(result.current.archivoInfo).toBeNull()
      expect(carteraService.sugerirMapeoPlantilla).not.toHaveBeenCalled()
    })
  })

  describe('actualizarColumnaHistorica / inicializarColumnasHistoricas / columnasHistoricasFinales', () => {
    it('actualizarColumnaHistorica marca y desmarca una columna sin afectar a las demás', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

      act(() => result.current.actualizarColumnaHistorica('Saldo', true))
      act(() => result.current.actualizarColumnaHistorica('Ciudad', true))
      expect(result.current.columnasHistoricas).toEqual(['Saldo', 'Ciudad'])

      act(() => result.current.actualizarColumnaHistorica('Saldo', false))
      expect(result.current.columnasHistoricas).toEqual(['Ciudad'])
    })

    it('marcar la misma columna dos veces no la duplica', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

      act(() => result.current.actualizarColumnaHistorica('Saldo', true))
      act(() => result.current.actualizarColumnaHistorica('Saldo', true))

      expect(result.current.columnasHistoricas).toEqual(['Saldo'])
    })

    it('inicializarColumnasHistoricas pre-tilda solo las columnas de este archivo que ya estaban configuradas', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) }) // columnasOriginales: ['Saldo', 'Ciudad']

      act(() => result.current.inicializarColumnasHistoricas(['Ciudad', 'Costo']))

      expect(result.current.columnasHistoricas).toEqual(['Ciudad']) // 'Costo' no está en este archivo
    })

    it('columnasHistoricasFinales resuelve cada columna marcada al alias vigente', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })
      act(() => result.current.actualizarColumnaHistorica('Saldo', true))

      act(() => result.current.actualizarAlias('Saldo', 'Monto Adeudado'))

      expect(result.current.columnasHistoricasFinales).toEqual(['Monto Adeudado'])
    })
  })

  describe('confirmarRenombrado', () => {
    it('pide el mapeo sugerido con los alias elegidos y pasa a la fase MAPEO', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })
      act(() => result.current.actualizarAlias('Saldo', 'Monto Adeudado'))

      await act(async () => { await result.current.confirmarRenombrado() })

      expect(carteraService.sugerirMapeoPlantilla).toHaveBeenCalledWith('carga-1', { Saldo: 'Monto Adeudado', Ciudad: 'Ciudad' }, {})
      expect(result.current.fase).toBe(result.current.FASE.MAPEO)
      expect(result.current.columnas).toHaveLength(2)
      expect(result.current.mapeo).toEqual(MAPEO_SUGERIDO)
      expect(result.current.datos).toEqual(DATOS_SUGERIDOS)
    })

    it('propaga el error cuando el análisis falla y se queda en la fase RENOMBRAR', async () => {
      carteraService.sugerirMapeoPlantilla.mockRejectedValue({ response: { data: { mensaje: 'Archivo inválido.' } } })
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

      await act(async () => { await result.current.confirmarRenombrado() })

      expect(result.current.error).toBe('Archivo inválido.')
      expect(result.current.fase).toBe(result.current.FASE.RENOMBRAR)
    })

    it('con una columna de 10 blancos o menos, no pasa por VALORES_EN_BLANCO', async () => {
      carteraService.sugerirMapeoPlantilla.mockResolvedValue({
        carga_id: 'carga-1', columnas: [], mapeo: MAPEO_SUGERIDO, datos: DATOS_SUGERIDOS,
        columnas_con_blancos: [{ columna: 'Causal', cantidad_en_blanco: 10, filas_ejemplo: [] }],
      })
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

      await act(async () => { await result.current.confirmarRenombrado() })

      expect(result.current.fase).toBe(result.current.FASE.MAPEO)
    })

    it('con una columna de más de 10 blancos, pasa a la fase VALORES_EN_BLANCO en vez de MAPEO', async () => {
      carteraService.sugerirMapeoPlantilla.mockResolvedValue({
        carga_id: 'carga-1', columnas: [], mapeo: MAPEO_SUGERIDO, datos: DATOS_SUGERIDOS,
        columnas_con_blancos: [{ columna: 'Alterno Cliente', cantidad_en_blanco: 11, filas_ejemplo: [] }],
      })
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })

      await act(async () => { await result.current.confirmarRenombrado() })

      expect(result.current.fase).toBe(result.current.FASE.VALORES_EN_BLANCO)
      expect(result.current.columnasConBlancos).toHaveLength(1)
    })
  })

  describe('actualizarValorBlanco / confirmarValoresBlancos / cancelarValoresBlancos', () => {
    async function llegarAValoresEnBlanco(result) {
      carteraService.sugerirMapeoPlantilla.mockResolvedValueOnce({
        carga_id: 'carga-1', columnas: [], mapeo: MAPEO_SUGERIDO, datos: DATOS_SUGERIDOS,
        columnas_con_blancos: [{ columna: 'Alterno Cliente', cantidad_en_blanco: 11, filas_ejemplo: [] }],
      })
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })
      await act(async () => { await result.current.confirmarRenombrado() })
    }

    it('actualizarValorBlanco ajusta el reemplazo de una columna sin perder los de las demás', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await llegarAValoresEnBlanco(result)

      act(() => result.current.actualizarValorBlanco('Alterno Cliente', '5'))
      act(() => result.current.actualizarValorBlanco('OBSERVACION', '5'))

      expect(result.current.valoresBlancos).toEqual({ 'Alterno Cliente': '5', OBSERVACION: '5' })
    })

    it('confirmarValoresBlancos vuelve a pedir el mapeo con los reemplazos y pasa a MAPEO', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await llegarAValoresEnBlanco(result)
      act(() => result.current.actualizarValorBlanco('Alterno Cliente', '5'))
      carteraService.sugerirMapeoPlantilla.mockResolvedValueOnce({
        carga_id: 'carga-1', columnas: [], mapeo: MAPEO_SUGERIDO, datos: DATOS_SUGERIDOS, columnas_con_blancos: [],
      })

      await act(async () => { await result.current.confirmarValoresBlancos() })

      expect(carteraService.sugerirMapeoPlantilla).toHaveBeenLastCalledWith(
        'carga-1', { Saldo: 'Saldo', Ciudad: 'Ciudad' }, { 'Alterno Cliente': '5' },
      )
      expect(result.current.fase).toBe(result.current.FASE.MAPEO)
      expect(result.current.columnasConBlancos).toEqual([])
    })

    it('propaga el error cuando confirmarValoresBlancos falla y se queda en la fase VALORES_EN_BLANCO', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await llegarAValoresEnBlanco(result)
      carteraService.sugerirMapeoPlantilla.mockRejectedValueOnce({ response: { data: { mensaje: 'No se pudo.' } } })

      await act(async () => { await result.current.confirmarValoresBlancos() })

      expect(result.current.error).toBe('No se pudo.')
      expect(result.current.fase).toBe(result.current.FASE.VALORES_EN_BLANCO)
    })

    it('cancelarValoresBlancos regresa a la fase CARGA y limpia el estado', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await llegarAValoresEnBlanco(result)
      act(() => result.current.actualizarValorBlanco('Alterno Cliente', '5'))

      act(() => result.current.cancelarValoresBlancos())

      expect(result.current.fase).toBe(result.current.FASE.CARGA)
      expect(result.current.archivoInfo).toBeNull()
      expect(result.current.valoresBlancos).toEqual({})
    })
  })

  describe('actualizarMapeoSlot', () => {
    it('ajusta la propuesta de una posición sin perder los demás campos', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await subirYLlegarAMapeo(result)

      act(() => result.current.actualizarMapeoSlot('grafico-1', { columna_categoria: 'Vendedor' }))

      expect(result.current.mapeo['grafico-1']).toEqual({
        disponible: true, columna_categoria: 'Vendedor', columna_valor: 'Saldo',
      })
      // El resto de posiciones no se tocan.
      expect(result.current.mapeo['kpi-1']).toEqual(MAPEO_SUGERIDO['kpi-1'])
    })

    it('recalcula la vista previa contra el archivo real sin esperar a "Aplicar a la plantilla"', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await subirYLlegarAMapeo(result)
      carteraService.previsualizarMapeoPlantilla.mockClear()

      await act(async () => {
        result.current.actualizarMapeoSlot('grafico-1', { columna_categoria: 'Vendedor' })
        await Promise.resolve()
      })

      expect(carteraService.previsualizarMapeoPlantilla).toHaveBeenCalledWith('carga-1', expect.objectContaining({
        'grafico-1': expect.objectContaining({ columna_categoria: 'Vendedor' }),
      }), { Saldo: 'Saldo', Ciudad: 'Ciudad' }, {})
      expect(carteraService.aplicarMapeoPlantilla).not.toHaveBeenCalled()
    })

    it('si la previsualización falla, conserva el último dato válido sin romper la edición', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await subirYLlegarAMapeo(result)
      carteraService.previsualizarMapeoPlantilla.mockRejectedValue(new Error('red caída'))

      await act(async () => {
        result.current.actualizarMapeoSlot('grafico-1', { columna_categoria: 'Vendedor' })
        await Promise.resolve()
      })

      expect(result.current.datos).toEqual(DATOS_SUGERIDOS)
      expect(result.current.cargandoPreview).toBe(false)
    })
  })

  describe('cancelarMapeo', () => {
    it('regresa a la fase CARGA sin llamar a ningún servicio', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await subirYLlegarAMapeo(result)

      act(() => result.current.cancelarMapeo())

      expect(result.current.fase).toBe(result.current.FASE.CARGA)
      expect(carteraService.aplicarMapeoPlantilla).not.toHaveBeenCalled()
    })
  })

  describe('confirmarMapeo', () => {
    it('aplica el mapeo actual (con los alias elegidos) y vuelve a la fase CARGA limpiando el estado', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await subirYLlegarAMapeo(result)
      act(() => result.current.actualizarMapeoSlot('grafico-1', { columna_categoria: 'Vendedor' }))

      let resultado
      await act(async () => { resultado = await result.current.confirmarMapeo() })

      expect(resultado.ok).toBe(true)
      expect(carteraService.aplicarMapeoPlantilla).toHaveBeenCalledWith('carga-1', expect.objectContaining({
        'grafico-1': expect.objectContaining({ columna_categoria: 'Vendedor' }),
      }), { Saldo: 'Saldo', Ciudad: 'Ciudad' }, {}, [])
      expect(result.current.fase).toBe(result.current.FASE.CARGA)
      expect(result.current.archivoInfo).toBeNull()
      expect(result.current.valoresBlancos).toEqual({})
    })

    it('manda las columnas históricas marcadas, ya resueltas al alias vigente', async () => {
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await act(async () => { await result.current.subirYValidar(archivoDePrueba()) })
      act(() => result.current.actualizarColumnaHistorica('Saldo', true))
      act(() => result.current.actualizarAlias('Saldo', 'Monto Adeudado'))
      await act(async () => { await result.current.confirmarRenombrado() })

      await act(async () => { await result.current.confirmarMapeo() })

      expect(carteraService.aplicarMapeoPlantilla).toHaveBeenCalledWith(
        'carga-1', expect.anything(), expect.anything(), expect.anything(), ['Monto Adeudado'],
      )
      expect(result.current.columnasHistoricas).toEqual([])
    })

    it('propaga el error cuando aplicar falla y se queda en la fase MAPEO', async () => {
      carteraService.aplicarMapeoPlantilla.mockRejectedValue({ response: { data: { mensaje: 'No se pudo aplicar.' } } })
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await subirYLlegarAMapeo(result)

      let resultado
      await act(async () => { resultado = await result.current.confirmarMapeo() })

      expect(resultado.ok).toBe(false)
      expect(result.current.error).toBe('No se pudo aplicar.')
      expect(result.current.fase).toBe(result.current.FASE.MAPEO)
    })
  })

  describe('conectarFuenteBD', () => {
    it('conecta a la fuente configurada y pasa a la fase RENOMBRAR con las columnas detectadas', async () => {
      carteraService.conectarFuenteBD.mockResolvedValue({
        carga_id: 'carga-db-1', nombre_archivo: 'dbo.sp_reporte (base de datos)', tamano_bytes: 500,
        total_filas_detectadas: 40, hojas_disponibles: ['Datos'], hoja_seleccionada: 'Datos',
        columnas_detectadas: COLUMNAS_DETECTADAS,
      })
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))

      let resultado
      await act(async () => { resultado = await result.current.conectarFuenteBD() })

      expect(resultado.ok).toBe(true)
      expect(carteraService.conectarFuenteBD).toHaveBeenCalledWith('finanzas')
      expect(carteraService.validarArchivo).not.toHaveBeenCalled()
      expect(result.current.fase).toBe(result.current.FASE.RENOMBRAR)
      expect(result.current.archivoInfo.cargaId).toBe('carga-db-1')
      expect(result.current.columnasOriginales).toEqual(COLUMNAS_DETECTADAS)
      expect(result.current.aliases).toEqual({ Saldo: 'Saldo', Ciudad: 'Ciudad' })
    })

    it('propaga el error cuando la conexión falla, devuelve ok:false y se queda en la fase CARGA', async () => {
      carteraService.conectarFuenteBD.mockRejectedValue({
        response: { data: { mensaje: 'No se pudo conectar con la base de datos externa.' } },
      })
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))

      let resultado
      await act(async () => { resultado = await result.current.conectarFuenteBD() })

      expect(resultado.ok).toBe(false)
      expect(result.current.error).toBe('No se pudo conectar con la base de datos externa.')
      expect(result.current.fase).toBe(result.current.FASE.CARGA)
    })
  })

  describe('limpiar', () => {
    it('elimina el archivo temporal y regresa a la fase CARGA', async () => {
      carteraService.eliminarArchivo.mockResolvedValue({})
      const { result } = renderHook(() => useGenericDashboardBuilder('finanzas'))
      await subirYLlegarAMapeo(result)

      await act(async () => { await result.current.limpiar() })

      expect(carteraService.eliminarArchivo).toHaveBeenCalledWith('carga-1')
      expect(result.current.fase).toBe(result.current.FASE.CARGA)
      expect(result.current.archivoInfo).toBeNull()
    })
  })
})
