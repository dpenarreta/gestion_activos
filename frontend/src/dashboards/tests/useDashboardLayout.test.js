import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDashboardLayout } from '../hooks/useDashboardLayout'
import * as dashboardLayoutService from '../services/dashboardLayoutService'

vi.mock('../services/dashboardLayoutService')

function componente(component_id, order, extra = {}) {
  return {
    component_id, type: 'kpi', chart_type: '', row: order, order, width: 2, height: 180,
    is_visible: true, content: {}, styles: {}, config: {}, ...extra,
  }
}

function layoutDePrueba(version = 1) {
  return {
    dashboard_id: 'cartera',
    version,
    components: [
      componente('a', 1), componente('b', 2), componente('c', 3), componente('d', 4),
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dashboardLayoutService.obtenerLayout.mockResolvedValue(layoutDePrueba())
})

async function montarYCargar() {
  const { result } = renderHook(() => useDashboardLayout('cartera'))
  await waitFor(() => expect(result.current.layoutGuardado).not.toBeNull())
  return result
}

describe('useDashboardLayout', () => {
  it('carga el layout guardado y lo clona como borrador al montar', async () => {
    const result = await montarYCargar()
    expect(dashboardLayoutService.obtenerLayout).toHaveBeenCalledWith('cartera')
    expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('activarEdicion entra en modo edición sin llamar de nuevo al servicio', async () => {
    const result = await montarYCargar()
    act(() => result.current.activarEdicion())
    expect(result.current.modoEdicion).toBe(true)
    expect(dashboardLayoutService.obtenerLayout).toHaveBeenCalledTimes(1)
  })

  describe('moverComponente (regresión: el reordenamiento no debe deshacerse a sí mismo)', () => {
    it('"abajo" intercambia el componente con el siguiente y dos movimientos lo devuelven a su posición', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.moverComponente('b', 'abajo'))
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'c', 'b', 'd'])

      act(() => result.current.moverComponente('b', 'abajo'))
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'c', 'd', 'b'])
    })

    it('"arriba" intercambia el componente con el anterior', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.moverComponente('c', 'arriba'))
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'c', 'b', 'd'])
    })

    it('"inicio" mueve el componente al principio', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.moverComponente('d', 'inicio'))
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['d', 'a', 'b', 'c'])
    })

    it('"fin" mueve el componente al final', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.moverComponente('a', 'fin'))
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['b', 'c', 'd', 'a'])
    })

    it('reasigna los valores de "order" de forma secuencial y única tras mover', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.moverComponente('b', 'abajo'))

      const ordenes = result.current.borrador.map((c) => c.order)
      expect(ordenes).toEqual([1, 2, 3, 4])
      expect(new Set(ordenes).size).toBe(4)
    })

    it('mover el primero "arriba" no cambia nada (límite superior)', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.moverComponente('a', 'arriba'))
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  describe('reordenarPorIds (arrastre con dnd-kit)', () => {
    it('reordena el borrador según la lista de ids provista', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.reordenarPorIds(['d', 'a', 'c', 'b']))

      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['d', 'a', 'c', 'b'])
      expect(result.current.borrador.map((c) => c.order)).toEqual([1, 2, 3, 4])
    })
  })

  describe('separación entre estilo/contenido y datos', () => {
    it('actualizarEstilos y actualizarContenido no llaman al servicio de layout (sin round-trip)', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.actualizarEstilos('a', { colorPrincipal: '#112233' }))
      act(() => result.current.actualizarContenido('a', { titulo: 'Nuevo título' }))

      expect(result.current.borrador.find((c) => c.component_id === 'a').styles.colorPrincipal).toBe('#112233')
      expect(result.current.borrador.find((c) => c.component_id === 'a').content.titulo).toBe('Nuevo título')
      expect(dashboardLayoutService.obtenerLayout).toHaveBeenCalledTimes(1)
      expect(dashboardLayoutService.guardarLayout).not.toHaveBeenCalled()
    })
  })

  describe('eliminarComponente', () => {
    it('quita el componente del borrador', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      act(() => result.current.eliminarComponente('b'))
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'c', 'd'])
    })

    it('si el componente eliminado estaba seleccionado, limpia la selección', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())
      act(() => result.current.setSeleccionado('b'))

      act(() => result.current.eliminarComponente('b'))
      expect(result.current.seleccionado).toBeNull()
    })

    it('al guardar, un componente eliminado no viaja en la lista enviada al servidor', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())
      act(() => result.current.eliminarComponente('b'))

      dashboardLayoutService.guardarLayout.mockResolvedValue({ dashboard_id: 'cartera', version: 2, components: [] })
      await act(async () => { await result.current.guardar('Ana') })

      const enviados = dashboardLayoutService.guardarLayout.mock.calls[0][1].components
      expect(enviados.map((c) => c.component_id)).toEqual(['a', 'c', 'd'])
    })
  })

  describe('guardar / cancelar / restablecer', () => {
    it('guardar envía la version y los componentes, y sale del modo edición', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())
      act(() => result.current.moverComponente('b', 'abajo'))

      dashboardLayoutService.guardarLayout.mockResolvedValue(layoutDePrueba(2))
      await act(async () => { await result.current.guardar() })

      // Sin `changedBy`: el autor del cambio lo resuelve el backend desde el usuario
      // autenticado, ya no viaja desde el cliente (era falsificable).
      expect(dashboardLayoutService.guardarLayout).toHaveBeenCalledWith('cartera', expect.objectContaining({
        version: 1,
      }))
      expect(dashboardLayoutService.guardarLayout.mock.calls[0][1]).not.toHaveProperty('changedBy')
      expect(result.current.modoEdicion).toBe(false)
    })

    it('un 409 del servidor deja el conflicto disponible sin tocar el borrador', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())

      dashboardLayoutService.guardarLayout.mockRejectedValue({ response: { status: 409, data: layoutDePrueba(5) } })
      const respuesta = await act(async () => result.current.guardar('Ana'))

      expect(respuesta).toEqual({ ok: false, conflicto: true })
      expect(result.current.conflicto).toEqual(layoutDePrueba(5))
    })

    it('cancelar descarta el borrador y restaura el guardado', async () => {
      const result = await montarYCargar()
      act(() => result.current.activarEdicion())
      act(() => result.current.moverComponente('b', 'abajo'))

      act(() => result.current.cancelar())

      expect(result.current.modoEdicion).toBe(false)
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('restablecer llama al endpoint de reset y reemplaza guardado/borrador', async () => {
      const result = await montarYCargar()
      const layoutPorDefecto = layoutDePrueba(1)
      dashboardLayoutService.restablecerLayout.mockResolvedValue(layoutPorDefecto)

      await act(async () => { await result.current.restablecer() })

      // El segundo argumento lleva la confirmación de contraseña cuando el dashboard está
      // bloqueado; sin bloqueo viaja vacía (ver "useDashboardLayout con el diseño bloqueado").
      expect(dashboardLayoutService.restablecerLayout).toHaveBeenCalledWith(
        'cartera', { passwordConfirmacion: undefined },
      )
      expect(result.current.borrador.map((c) => c.component_id)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('hayCambiosSinGuardar detecta cambios y guardar los limpia', async () => {
      const result = await montarYCargar()
      expect(result.current.hayCambiosSinGuardar()).toBe(false)

      act(() => result.current.activarEdicion())
      act(() => result.current.moverComponente('b', 'abajo'))
      expect(result.current.hayCambiosSinGuardar()).toBe(true)
    })
  })
})

describe('useDashboardLayout con el diseño bloqueado', () => {
  /**
   * Un dashboard con `estructura_bloqueada` rechaza los cambios de estructura con
   * `DASHBOARD_BLOQUEADO`. El hook no decide nada por su cuenta: traduce ese rechazo a
   * `requiereConfirmacion` para que la pantalla abra el cuadro de contraseña, y reenvía la
   * contraseña al reintento. Lo que se protege acá es que no la guarde ni la reutilice.
   */

  function rechazoBloqueado(puedeConfirmar = true) {
    return {
      response: {
        status: 400,
        data: {
          error: 'DASHBOARD_BLOQUEADO',
          mensaje: 'El diseño de este dashboard está bloqueado.',
          detalles: { puede_confirmar: puedeConfirmar },
        },
      },
    }
  }

  it('pide confirmación en vez de dejar el error como un fallo cualquiera', async () => {
    dashboardLayoutService.guardarLayout.mockRejectedValue(rechazoBloqueado())
    const result = await montarYCargar()

    let resultado
    await act(async () => { resultado = await result.current.guardar() })

    expect(resultado.requiereConfirmacion).toBe(true)
    // El mensaje lo muestra el cuadro de contraseña, así que no se duplica como error de pantalla.
    expect(result.current.error).toBeNull()
  })

  it('a quien no puede confirmar le muestra el error, sin ofrecerle un cuadro inútil', async () => {
    dashboardLayoutService.guardarLayout.mockRejectedValue(rechazoBloqueado(false))
    const result = await montarYCargar()

    let resultado
    await act(async () => { resultado = await result.current.guardar() })

    expect(resultado.requiereConfirmacion).toBeUndefined()
    await waitFor(() => expect(result.current.error).toBe('El diseño de este dashboard está bloqueado.'))
  })

  it('reenvía la contraseña al reintentar, y no la manda cuando no hay ninguna', async () => {
    dashboardLayoutService.guardarLayout.mockResolvedValue(layoutDePrueba(2))
    const result = await montarYCargar()

    await act(async () => { await result.current.guardar() })
    expect(dashboardLayoutService.guardarLayout.mock.calls[0][1].passwordConfirmacion).toBeUndefined()

    await act(async () => { await result.current.guardar('mi-clave') })
    expect(dashboardLayoutService.guardarLayout.mock.calls[1][1].passwordConfirmacion).toBe('mi-clave')
  })

  it('restablecer el diseño sigue el mismo camino', async () => {
    dashboardLayoutService.restablecerLayout.mockRejectedValue(rechazoBloqueado())
    const result = await montarYCargar()

    let resultado
    await act(async () => { resultado = await result.current.restablecer() })
    expect(resultado.requiereConfirmacion).toBe(true)

    dashboardLayoutService.restablecerLayout.mockResolvedValue(layoutDePrueba(2))
    await act(async () => { await result.current.restablecer('mi-clave') })
    expect(dashboardLayoutService.restablecerLayout).toHaveBeenLastCalledWith(
      'cartera', { passwordConfirmacion: 'mi-clave' },
    )
  })

  it('un conflicto de versión sigue siendo un conflicto, no una confirmación', async () => {
    dashboardLayoutService.guardarLayout.mockRejectedValue({ response: { status: 409, data: layoutDePrueba(9) } })
    const result = await montarYCargar()

    let resultado
    await act(async () => { resultado = await result.current.guardar() })
    expect(resultado.conflicto).toBe(true)
    expect(resultado.requiereConfirmacion).toBeUndefined()
  })
})
