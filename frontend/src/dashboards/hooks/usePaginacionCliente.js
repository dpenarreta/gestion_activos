import { useEffect, useState } from 'react'

/**
 * Paginación 100% en memoria para listas pequeñas ya cargadas completas (ej. filas de la
 * matriz recuperador/causal), sin volver a consultar al backend. `resetKey` fuerza volver a
 * la página 1 cuando cambia (ej. la referencia del objeto de agregación tras un nuevo filtro).
 */
export function usePaginacionCliente(items, { defaultPageSize = 10, resetKey } = {}) {
  const [pagina, setPagina] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  useEffect(() => {
    setPagina(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const cambiarPageSize = (nuevo) => {
    setPageSize(nuevo)
    setPagina(1)
  }

  const totalRegistros = items?.length || 0
  const totalPaginas = Math.max(Math.ceil(totalRegistros / pageSize), 1)
  const paginaActual = Math.min(pagina, totalPaginas)
  const inicio = (paginaActual - 1) * pageSize
  const itemsPagina = (items || []).slice(inicio, inicio + pageSize)

  return {
    pagina: paginaActual,
    pageSize,
    totalPaginas,
    totalRegistros,
    itemsPagina,
    irAPagina: setPagina,
    cambiarPageSize,
  }
}
