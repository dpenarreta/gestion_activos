import { useCallback, useEffect, useState } from 'react'
import * as plantillaBaseService from '../services/plantillaBaseService'

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
 * que nunca puede haber superposición ni huecos que reorganizar a mano. `row` se recalcula solo
 * para guardarlo en el backend, no gobierna el renderizado.
 */
function recalcularFilas(componentes) {
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

/**
 * Mismo estado/lógica que `useDashboardLayout.js`, pero apuntando a la plantilla base
 * personalizable (`plantillaBaseService`, siempre la misma fila reservada — sin `dashboardId`).
 * Se duplica en vez de generalizar el hook de dashboards reales para no arriesgar regresiones en
 * ese editor, que ya tiene amplia cobertura de tests.
 */
export function usePlantillaBaseLayout() {
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
      const data = await plantillaBaseService.obtenerLayout()
      setLayoutGuardado(data)
      setBorrador(clonar(data.components))
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo cargar la plantilla base.')
    } finally {
      setCargando(false)
    }
  }, [])

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

  const guardar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const data = await plantillaBaseService.guardarLayout({
        version: layoutGuardado.version,
        components: recalcularFilas(borrador),
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
      setError(e.response?.data?.mensaje || 'No se pudo guardar la plantilla base.')
      return { ok: false }
    } finally {
      setCargando(false)
    }
  }, [layoutGuardado, borrador])

  const recargarPorConflicto = useCallback(() => {
    if (!conflicto) return
    setLayoutGuardado(conflicto)
    setBorrador(clonar(conflicto.components))
    setConflicto(null)
  }, [conflicto])

  const restablecer = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const data = await plantillaBaseService.restablecer()
      setLayoutGuardado(data)
      setBorrador(clonar(data.components))
      setModoEdicion(false)
      setVistaPrevia(false)
      setSeleccionado(null)
      return { ok: true }
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo restablecer la plantilla base.')
      return { ok: false }
    } finally {
      setCargando(false)
    }
  }, [])

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
    moverComponente,
    reordenarPorIds,
    guardar,
    restablecer,
    recargarPorConflicto,
    hayCambiosSinGuardar,
  }
}
