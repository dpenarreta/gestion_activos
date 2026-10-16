import { useEffect, useState } from 'react'
import { obtenerColumnasDelArchivo } from '../services/dashboardLayoutService'

/**
 * Las columnas del archivo cargado en un dashboard.
 *
 * Se piden al backend y no se leen del layout a propósito: son del ARCHIVO, no del diseño, y
 * cambian cuando se carga uno nuevo. Una lista guardada en la configuración envejecería en
 * silencio y ofrecería columnas que ya no existen.
 *
 * Vive como hook porque el panel de propiedades necesita la misma lista en dos lugares (qué
 * columnas muestra el detalle y cuál es el identificador del cliente), y sin esto cada uno hacía
 * su propia petición al abrir el panel.
 */
export function useColumnasDelArchivo(dashboardId) {
  const [columnas, setColumnas] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    setColumnas(null)
    setError('')
    obtenerColumnasDelArchivo(dashboardId)
      .then((datos) => { if (!cancelado) setColumnas(datos.columnas) })
      .catch((e) => {
        if (!cancelado) setError(e.response?.data?.mensaje || 'No se pudieron leer las columnas del archivo.')
      })
    return () => { cancelado = true }
  }, [dashboardId])

  return { columnas, error, cargando: columnas === null && !error }
}
