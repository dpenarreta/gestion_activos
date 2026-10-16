import { useCallback, useEffect, useState } from 'react'
import * as dashboardLayoutService from '../services/dashboardLayoutService'

/**
 * Traduce el rechazo de un dashboard con el diseño bloqueado a algo que la pantalla pueda usar.
 *
 * Son DOS los códigos que piden la contraseña, y hay que cubrir los dos: `DASHBOARD_BLOQUEADO`
 * (todavía no se escribió ninguna) y `CONFIRMACION_INVALIDA` (se escribió y estaba mal). Con solo
 * el primero, escribir mal la contraseña dejaba el cuadro girando para siempre: el segundo error
 * se propagaba como excepción y nadie lo atrapaba.
 *
 * Distingue además la situación sin salida: cuando `puede_confirmar` es falso —un usuario que no
 * es superusuario— lo único honesto es mostrar el mensaje, y ofrecerle el cuadro sería mandarlo a
 * escribir una contraseña que no va a servirle. Si la interfaz lo dedujera por su cuenta de
 * `is_superuser`, esa decisión quedaría duplicada en dos lugares.
 *
 * Devuelve `null` cuando el error es cualquier otra cosa, para que el llamador siga con su
 * manejo de siempre.
 */
export function requiereConfirmacion(error) {
  const datos = error?.response?.data
  const codigo = datos?.error
  if (codigo !== 'DASHBOARD_BLOQUEADO' && codigo !== 'CONFIRMACION_INVALIDA') return null
  if (!datos?.detalles?.puede_confirmar) return null
  return { ok: false, requiereConfirmacion: true, mensaje: datos.mensaje }
}

function clonar(componentes) {
  return componentes.map((c) => ({
    ...c,
    content: { ...c.content },
    styles: { ...c.styles },
    config: { ...c.config },
  }))
}

/**
 * El "orden" es una única secuencia (no una cuadrícula fila/columna que haya que mantener a
 * mano): cada componente tiene un ancho de 1 a 12 y el contenedor los acomoda con flex-wrap, así
 * que nunca puede haber superposición ni huecos que reorganizar a mano (sección 9). `row` se
 * recalcula solo para guardarlo en el backend (auditoría/compatibilidad de esquema), no gobierna
 * el renderizado.
 */
function recalcularFilas(componentes) {
  // El array de entrada YA viene en el orden final deseado (lo construyen moverComponente /
  // reordenarPorIds antes de llamar aquí); no debe volver a ordenarse por el campo `order`
  // viejo, o se deshace el reordenamiento que se acaba de hacer.
  let fila = 1
  let acumulado = 0
  return componentes.map((c, i) => {
    if (acumulado + c.width > 12) {
      fila += 1
      acumulado = 0
    }
    acumulado += c.width
    return { ...c, row: fila, order: i + 1 }
  })
}

export function useDashboardLayout(dashboardId) {
  const [layoutGuardado, setLayoutGuardado] = useState(null)
  const [borrador, setBorrador] = useState([])
  const [modoEdicion, setModoEdicion] = useState(false)
  const [vistaPrevia, setVistaPrevia] = useState(false)
  const [seleccionado, setSeleccionado] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [conflicto, setConflicto] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const data = await dashboardLayoutService.obtenerLayout(dashboardId)
      setLayoutGuardado(data)
      setBorrador(clonar(data.components))
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo cargar la configuración del dashboard.')
    } finally {
      setCargando(false)
    }
  }, [dashboardId])

  useEffect(() => { cargar() }, [cargar])

  const activarEdicion = useCallback(() => {
    setBorrador(clonar(layoutGuardado?.components || []))
    setModoEdicion(true)
    setVistaPrevia(false)
  }, [layoutGuardado])

  const hayCambiosSinGuardar = useCallback(() => {
    if (!layoutGuardado) return false
    return JSON.stringify(clonar(layoutGuardado.components)) !== JSON.stringify(borrador)
  }, [layoutGuardado, borrador])

  const cancelar = useCallback(() => {
    setBorrador(clonar(layoutGuardado?.components || []))
    setModoEdicion(false)
    setVistaPrevia(false)
    setSeleccionado(null)
  }, [layoutGuardado])

  const alternarVistaPrevia = useCallback(() => setVistaPrevia((v) => !v), [])

  const actualizarComponente = useCallback((componentId, cambios) => {
    setBorrador((prev) => prev.map((c) => (c.component_id === componentId ? { ...c, ...cambios } : c)))
  }, [])

  const actualizarContenido = useCallback((componentId, contenido) => {
    setBorrador((prev) => prev.map((c) => (
      c.component_id === componentId ? { ...c, content: { ...c.content, ...contenido } } : c
    )))
  }, [])

  const actualizarEstilos = useCallback((componentId, estilos) => {
    setBorrador((prev) => prev.map((c) => (
      c.component_id === componentId ? { ...c, styles: { ...c.styles, ...estilos } } : c
    )))
  }, [])

  /**
   * A diferencia de ocultar (reversible, is_visible=false), esto quita el componente del
   * borrador: al guardar, `aplicar_layout` interpreta cualquier componente que ya no venga en la
   * lista como eliminado (sección "editor del dashboard debe permitir borrar componentes").
   */
  const eliminarComponente = useCallback((componentId) => {
    setBorrador((prev) => prev.filter((c) => c.component_id !== componentId))
    setSeleccionado((prev) => (prev === componentId ? null : prev))
  }, [])

  const moverComponente = useCallback((componentId, direccion) => {
    setBorrador((prev) => {
      const ordenados = [...prev].sort((a, b) => a.order - b.order)
      const indice = ordenados.findIndex((c) => c.component_id === componentId)
      if (indice === -1) return prev

      let destino = indice
      if (direccion === 'arriba') destino = Math.max(0, indice - 1)
      else if (direccion === 'abajo') destino = Math.min(ordenados.length - 1, indice + 1)
      else if (direccion === 'inicio') destino = 0
      else if (direccion === 'fin') destino = ordenados.length - 1

      if (destino === indice) return prev

      const [item] = ordenados.splice(indice, 1)
      ordenados.splice(destino, 0, item)
      return recalcularFilas(ordenados)
    })
  }, [])

  const reordenarPorIds = useCallback((idsEnNuevoOrden) => {
    setBorrador((prev) => {
      const porId = new Map(prev.map((c) => [c.component_id, c]))
      const ordenados = idsEnNuevoOrden.map((id) => porId.get(id)).filter(Boolean)
      return recalcularFilas(ordenados)
    })
  }, [])

  const guardar = useCallback(async (passwordConfirmacion) => {
    setCargando(true)
    setError(null)
    try {
      const data = await dashboardLayoutService.guardarLayout(dashboardId, {
        version: layoutGuardado.version,
        components: recalcularFilas(borrador),
        passwordConfirmacion,
      })
      setLayoutGuardado(data)
      setBorrador(clonar(data.components))
      setModoEdicion(false)
      setVistaPrevia(false)
      setSeleccionado(null)
      return { ok: true }
    } catch (e) {
      if (e.response?.status === 409) {
        setConflicto(e.response.data)
        return { ok: false, conflicto: true }
      }
      const confirmacion = requiereConfirmacion(e)
      if (confirmacion) return confirmacion
      setError(e.response?.data?.mensaje || 'No se pudo guardar la configuración.')
      return { ok: false }
    } finally {
      setCargando(false)
    }
  }, [dashboardId, layoutGuardado, borrador])

  const recargarPorConflicto = useCallback(() => {
    if (!conflicto) return
    setLayoutGuardado(conflicto)
    setBorrador(clonar(conflicto.components))
    setConflicto(null)
  }, [conflicto])

  const restablecer = useCallback(async (passwordConfirmacion) => {
    setCargando(true)
    setError(null)
    try {
      const data = await dashboardLayoutService.restablecerLayout(dashboardId, { passwordConfirmacion })
      setLayoutGuardado(data)
      setBorrador(clonar(data.components))
      return { ok: true }
    } catch (e) {
      const confirmacion = requiereConfirmacion(e)
      if (confirmacion) return confirmacion
      setError(e.response?.data?.mensaje || 'No se pudo restablecer el diseño.')
      return { ok: false }
    } finally {
      setCargando(false)
    }
  }, [dashboardId])

  return {
    layoutGuardado,
    borrador,
    modoEdicion,
    vistaPrevia,
    seleccionado,
    cargando,
    error,
    conflicto,
    setSeleccionado,
    activarEdicion,
    cancelar,
    alternarVistaPrevia,
    actualizarComponente,
    actualizarContenido,
    actualizarEstilos,
    eliminarComponente,
    moverComponente,
    reordenarPorIds,
    guardar,
    restablecer,
    recargarPorConflicto,
    hayCambiosSinGuardar,
    // Expuesto para refrescar el layout tras una acción externa a este hook (p. ej. generar el
    // dashboard a partir de columnas elegidas en `useGenericDashboardBuilder`).
    recargar: cargar,
  }
}
