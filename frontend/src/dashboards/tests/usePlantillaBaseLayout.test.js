import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePlantillaBaseLayout } from '../hooks/usePlantillaBaseLayout'
import * as plantillaBaseService from '../services/plantillaBaseService'

vi.mock('../services/plantillaBaseService')

function componente(component_id, order, extra = {}) {
  return {
    component_id, type: 'kpi', chart_type: '', row: order, order, width: 3, height: 180,
    is_visible: true, content: {}, styles: {}, config: {}, ...extra,
  }
}

function layoutDePrueba(version = 1) {
  return {
    dashboard_id: 'plantilla-base-sistema',
    version,
    components: [componente('kpi-1', 1), componente('kpi-2', 2), componente('kpi-3', 3), componente('kpi-4', 4)],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  plantillaBaseService.obtenerLayout.mockResolvedValue(layoutDePrueba())
})

async function montarYCargar() {
  const { result } = renderHook(() => usePlantillaBaseLayout())
  await waitFor(() => expect(result.current.layoutGuardado).not.toBeNull())
  return result
}

describe('usePlantillaBaseLayout', () => {
  it('carga la plantilla base (sin necesitar un dashboardId) y la clona como borrador', async () => {
    const result = await montarYCargar()
    expect(plantillaBaseService.obtenerLayout).toHaveBeenCalledTimes(1)
    expect(result.current.borrador.map((c) => c.component_id)).toEqual(['kpi-1', 'kpi-2', 'kpi-3', 'kpi-4'])
  })

  it('activarEdicion entra en modo edición sin volver a llamar al servicio', async () => {
    const result = await montarYCargar()
    act(() => result.current.activarEdicion())
    expect(result.current.modoEdicion).toBe(true)
    expect(plantillaBaseService.obtenerLayout).toHaveBeenCalledTimes(1)
  })

  it('guardar llama a plantillaBaseService.guardarLayout con la versión y el borrador actuales', async () => {
    const result = await montarYCargar()
    act(() => result.current.activarEdicion())
    plantillaBaseService.guardarLayout.mockResolvedValue(layoutDePrueba(2))

    await act(async () => { await result.current.guardar() })

    // Sin `changedBy`: lo resuelve el backend desde el usuario autenticado.
    expect(plantillaBaseService.guardarLayout).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }))
    expect(plantillaBaseService.guardarLayout.mock.calls[0][0]).not.toHaveProperty('changedBy')
    expect(result.current.layoutGuardado.version).toBe(2)
    expect(result.current.modoEdicion).toBe(false)
  })

  it('guardar con conflicto de versión (409) expone el conflicto sin lanzar', async () => {
    const result = await montarYCargar()
    act(() => result.current.activarEdicion())
    plantillaBaseService.guardarLayout.mockRejectedValue({ response: { status: 409, data: layoutDePrueba(5) } })

    const resultado = await act(async () => result.current.guardar('Ana'))

    expect(resultado).toEqual({ ok: false, conflicto: true })
    expect(result.current.conflicto.version).toBe(5)
  })

  it('restablecer llama a plantillaBaseService.restablecer (sin argumentos) y sale del modo edición', async () => {
    const result = await montarYCargar()
    act(() => result.current.activarEdicion())
    result.current.setSeleccionado('kpi-1')
    plantillaBaseService.restablecer.mockResolvedValue(layoutDePrueba(3))

    await act(async () => { await result.current.restablecer() })

    expect(plantillaBaseService.restablecer).toHaveBeenCalledWith()
    expect(result.current.layoutGuardado.version).toBe(3)
    expect(result.current.modoEdicion).toBe(false)
  })

  it('si restablecer falla, muestra el mensaje de error del backend', async () => {
    const result = await montarYCargar()
    plantillaBaseService.restablecer.mockRejectedValue({ response: { data: { mensaje: 'No se pudo restablecer la plantilla base.' } } })

    await act(async () => { await result.current.restablecer() })

    expect(result.current.error).toBe('No se pudo restablecer la plantilla base.')
  })
})
