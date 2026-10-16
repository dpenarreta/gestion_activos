import { useCallback, useRef, useState } from 'react'
import * as carteraService from '../services/carteraService'

const FASE = {
  CARGA: 'CARGA',
  RENOMBRAR: 'RENOMBRAR',
  VALORES_EN_BLANCO: 'VALORES_EN_BLANCO',
  MAPEO: 'MAPEO',
}

// Umbral a partir del cual una columna con blancos recurrentes (`columnasConBlancos`, ver
// `services/generic_charts.py::columnas_con_blancos_recurrentes`) se considera lo bastante grave
// como para ofrecerle al usuario un paso dedicado (`FASE.VALORES_EN_BLANCO`) donde elegir un valor
// de reemplazo — por debajo de esto, la columna solo se menciona en el aviso informativo del paso
// MAPEO (`TemplateMappingStep`), sin campo para actuar.
const UMBRAL_BLANCOS_RENOMBRABLES = 10

/**
 * Flujo "cargar archivo → renombrar columnas → [valores en blanco] → mapeo automático a la
 * plantilla fija → confirmar": todo dashboard nace con las 15 posiciones de la plantilla
 * (`services/plantilla.py`, sembradas al crear el dashboard). Tras validar el archivo, el usuario
 * puede ponerle un nombre más claro a cualquier columna (`aliases`, nombre original -> nuevo
 * nombre) antes de que el sistema proponga qué columna(s) usar en cada posición
 * (`sugerirMapeoPlantilla`, ya con los nombres renombrados) con una vista previa real y las
 * columnas con valores en blanco recurrentes (`columnasConBlancos`). Si alguna tiene más de
 * `UMBRAL_BLANCOS_RENOMBRABLES` blancos, el flujo pasa primero por `FASE.VALORES_EN_BLANCO` (ver
 * `ValoresEnBlancoStep`) para que el usuario elija, columna por columna, un valor de reemplazo
 * real (`valoresBlancos`) o las deje en blanco; si ninguna la supera, ese paso se salta. Ya en
 * MAPEO (`TemplateMappingStep`), el usuario puede ajustar el mapeo antes de confirmarlo
 * (`aplicarMapeoPlantilla`), que sobreescribe esas mismas 15 posiciones — nunca agrega otras
 * nuevas ni deja al usuario armar una lista libre de gráficas (reemplaza al viejo flujo de
 * "reconocer columnas → recomendar → agregar una por una").
 */
export function useGenericDashboardBuilder(dashboardId) {
  const [fase, setFase] = useState(FASE.CARGA)
  const [archivoInfo, setArchivoInfo] = useState(null)
  const [columnasOriginales, setColumnasOriginales] = useState([])
  const [aliases, setAliases] = useState({})
  const [columnas, setColumnas] = useState([])
  const [mapeo, setMapeo] = useState({})
  const [datos, setDatos] = useState({})
  const [columnasConBlancos, setColumnasConBlancos] = useState([])
  const [valoresBlancos, setValoresBlancos] = useState({})
  // Nombres ORIGINALES marcados con la casilla "columna histórica" del paso "Renombrar columnas"
  // (mismo criterio que `aliases`: clave por nombre original, para que la marca no quede
  // "huérfana" si el usuario renombra la columna después de tildarla).
  const [columnasHistoricas, setColumnasHistoricas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [error, setError] = useState(null)
  const archivoLocalRef = useRef(null)

  const subirYValidar = useCallback(async (archivo, hoja) => {
    setCargando(true)
    setError(null)
    archivoLocalRef.current = archivo
    try {
      const data = await carteraService.validarArchivo(archivo, hoja, dashboardId)
      setArchivoInfo({
        cargaId: data.carga_id,
        nombreArchivo: data.nombre_archivo,
        tamanoBytes: data.tamano_bytes,
        totalFilas: data.total_filas_detectadas,
        hojasDisponibles: data.hojas_disponibles,
        hojaSeleccionada: data.hoja_seleccionada,
      })
      const detectadas = data.columnas_detectadas || []
      setColumnasOriginales(detectadas)
      setAliases(Object.fromEntries(detectadas.map((nombre) => [nombre, nombre])))
      setFase(FASE.RENOMBRAR)
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo analizar el archivo.')
    } finally {
      setCargando(false)
    }
  }, [dashboardId])

  const cambiarHoja = useCallback(async (hoja) => {
    if (!archivoLocalRef.current) return
    await subirYValidar(archivoLocalRef.current, hoja)
  }, [subirYValidar])

  /** "Conectar vista de base de datos" — mismo destino (`FASE.RENOMBRAR`) y misma forma de estado
   * que `subirYValidar`, pero la carga viene de `carteraService.conectarFuenteBD` (la vista/
   * procedimiento ya configurado para este dashboard, ver `DashboardAreaPage.jsx`) en vez de un
   * archivo elegido a mano — el backend arma una `CargaArchivo` equivalente con una única "hoja"
   * fija ('Datos'), así el resto del asistente no distingue el origen de los datos.
   *
   * Devuelve `{ok}` (mismo patrón que `confirmarMapeo`) en vez de dejar que el llamador lea
   * `error` después del `await`: leerlo directo sería un closure obsoleto (el `builder` capturado
   * en `DashboardAreaPage.jsx` es el de ESE render, no ve el `setError` de acá). El mensaje
   * técnico del backend queda en `error` igual (por si algo interno lo necesita), pero
   * `DashboardAreaPage.jsx` no lo muestra — ante una falla de conexión no se revela el asistente,
   * se vuelve a la vista normal del dashboard con un mensaje fijo, sin exponer detalles internos. */
  const conectarFuenteBD = useCallback(async () => {
    setCargando(true)
    setError(null)
    archivoLocalRef.current = null
    try {
      const data = await carteraService.conectarFuenteBD(dashboardId)
      setArchivoInfo({
        cargaId: data.carga_id,
        nombreArchivo: data.nombre_archivo,
        tamanoBytes: data.tamano_bytes,
        totalFilas: data.total_filas_detectadas,
        hojasDisponibles: data.hojas_disponibles,
        hojaSeleccionada: data.hoja_seleccionada,
      })
      const detectadas = data.columnas_detectadas || []
      setColumnasOriginales(detectadas)
      setAliases(Object.fromEntries(detectadas.map((nombre) => [nombre, nombre])))
      setFase(FASE.RENOMBRAR)
      return { ok: true }
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo conectar con la base de datos.')
      return { ok: false }
    } finally {
      setCargando(false)
    }
  }, [dashboardId])

  /** Ajusta el nuevo nombre propuesto para una columna del archivo — no llama a ningún servicio
   * todavía, eso ocurre recién al confirmar el renombrado ("Continuar"). */
  const actualizarAlias = useCallback((nombreOriginal, alias) => {
    setAliases((prev) => ({ ...prev, [nombreOriginal]: alias }))
  }, [])

  const cancelarRenombrado = useCallback(() => {
    setFase(FASE.CARGA)
    setArchivoInfo(null)
    setColumnasOriginales([])
    setAliases({})
    setColumnasHistoricas([])
    archivoLocalRef.current = null
  }, [])

  /** Marca/desmarca una columna como "histórica" (casilla del paso "Renombrar columnas") — igual
   * que `actualizarAlias`, no llama a ningún servicio todavía, eso ocurre recién al confirmar el
   * mapeo ("Aplicar a la plantilla"). */
  const actualizarColumnaHistorica = useCallback((nombreOriginal, marcada) => {
    setColumnasHistoricas((prev) => (
      marcada ? [...prev, nombreOriginal].filter((n, i, arr) => arr.indexOf(n) === i) : prev.filter((n) => n !== nombreOriginal)
    ))
  }, [])

  /** Pre-tilda las columnas de este archivo que ya estaban marcadas como históricas en una carga
   * anterior del mismo dashboard (`configuradas`, nombres ya renombrados) — la llama
   * `DashboardAreaPage` una vez por carga nueva, con la configuración que ya tiene cargada, para
   * que el hook no necesite su propio fetch. Compara contra `columnasOriginales` porque, apenas
   * subido el archivo, cada alias todavía es igual a su nombre original. */
  const inicializarColumnasHistoricas = useCallback((configuradas) => {
    setColumnasHistoricas(columnasOriginales.filter((c) => configuradas.includes(c)))
  }, [columnasOriginales])

  // Las columnas históricas, ya resueltas al nombre final (post-alias) — lo que de verdad importa
  // fuera del paso "Renombrar columnas" (badge de `TemplateMappingStep`/`ValoresEnBlancoStep`, y lo
  // que se manda a `aplicarMapeoPlantilla`). No es estado propio: se recalcula solo, barato, a
  // partir de `columnasHistoricas` (nombres originales) + `aliases` vigentes.
  const columnasHistoricasFinales = columnasHistoricas.map((orig) => (aliases[orig] || '').trim() || orig)

  /** Confirma los alias elegidos y pide el mapeo sugerido a la plantilla — ya con las columnas
   * renombradas, así que el resto del flujo (selectores, vista previa, datos aplicados) usa el
   * nombre nuevo como si fuera el original del archivo. Si alguna columna tiene más de
   * `UMBRAL_BLANCOS_RENOMBRABLES` valores en blanco, pasa primero por `FASE.VALORES_EN_BLANCO`
   * (para que el usuario elija un reemplazo o los deje en blanco) antes de llegar a MAPEO; si
   * ninguna la supera, va directo a MAPEO como siempre. */
  const confirmarRenombrado = useCallback(async () => {
    if (!archivoInfo?.cargaId) return
    setCargando(true)
    setError(null)
    try {
      const sugerido = await carteraService.sugerirMapeoPlantilla(archivoInfo.cargaId, aliases, valoresBlancos)
      setColumnas(sugerido.columnas)
      setMapeo(sugerido.mapeo)
      setDatos(sugerido.datos)
      const conBlancos = sugerido.columnas_con_blancos || []
      setColumnasConBlancos(conBlancos)
      const hayRenombrables = conBlancos.some((c) => c.cantidad_en_blanco > UMBRAL_BLANCOS_RENOMBRABLES)
      setFase(hayRenombrables ? FASE.VALORES_EN_BLANCO : FASE.MAPEO)
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo analizar el archivo.')
    } finally {
      setCargando(false)
    }
  }, [archivoInfo, aliases, valoresBlancos])

  /** Ajusta el valor propuesto para reemplazar los blancos de una columna (paso
   * `FASE.VALORES_EN_BLANCO`) — igual que `actualizarAlias`, no llama a ningún servicio todavía,
   * eso ocurre recién al confirmar ("Continuar"). */
  const actualizarValorBlanco = useCallback((columna, valor) => {
    setValoresBlancos((prev) => ({ ...prev, [columna]: valor }))
  }, [])

  const cancelarValoresBlancos = useCallback(() => {
    setFase(FASE.CARGA)
    setArchivoInfo(null)
    setColumnasOriginales([])
    setAliases({})
    setValoresBlancos({})
    setColumnasHistoricas([])
    setColumnas([])
    setMapeo({})
    setDatos({})
    setColumnasConBlancos([])
    archivoLocalRef.current = null
  }, [])

  /** Vuelve a pedir el mapeo sugerido, ahora con los valores de reemplazo elegidos — el archivo ya
   * "completado" puede sugerir un mapeo distinto (una columna antes vacía puede volverse apta) y
   * las columnas que se terminaron de rellenar del todo dejan de aparecer en
   * `columnasConBlancos`. Las que el usuario dejó en blanco (o completó a medias) siguen su
   * tratamiento normal, visible en el aviso del paso MAPEO. */
  const confirmarValoresBlancos = useCallback(async () => {
    if (!archivoInfo?.cargaId) return
    setCargando(true)
    setError(null)
    try {
      const sugerido = await carteraService.sugerirMapeoPlantilla(archivoInfo.cargaId, aliases, valoresBlancos)
      setColumnas(sugerido.columnas)
      setMapeo(sugerido.mapeo)
      setDatos(sugerido.datos)
      setColumnasConBlancos(sugerido.columnas_con_blancos || [])
      setFase(FASE.MAPEO)
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo aplicar los valores de reemplazo.')
    } finally {
      setCargando(false)
    }
  }, [archivoInfo, aliases, valoresBlancos])

  /** Recalcula la vista previa de las 13 posiciones a partir de un mapeo ya editado — nunca
   * persiste nada (eso solo ocurre al confirmar); si falla, no interrumpe la edición: el usuario
   * sigue viendo la última vista previa válida y el error real, si lo hay, aparece recién al
   * confirmar. */
  const recalcularPreview = useCallback(async (mapeoActual) => {
    if (!archivoInfo?.cargaId) return
    setCargandoPreview(true)
    try {
      const resultado = await carteraService.previsualizarMapeoPlantilla(archivoInfo.cargaId, mapeoActual, aliases, valoresBlancos)
      setDatos(resultado.datos)
    } catch {
      /* la vista previa es de mejor esfuerzo; el error real se valida al confirmar */
    } finally {
      setCargandoPreview(false)
    }
  }, [archivoInfo, aliases, valoresBlancos])

  /** Ajusta manualmente qué columna(s) alimentan una posición — el resto de campos que no se
   * tocan (p. ej. `columnas_valor` de una tabla) se conservan tal como los propuso el sistema.
   * La vista previa de esa posición (y del resto, por si comparten columnas) se recalcula de
   * inmediato contra el archivo real, sin esperar a "Aplicar a la plantilla". */
  const actualizarMapeoSlot = useCallback((slotId, cambios) => {
    const nuevo = { ...mapeo, [slotId]: { ...mapeo[slotId], ...cambios, disponible: true } }
    setMapeo(nuevo)
    recalcularPreview(nuevo)
  }, [mapeo, recalcularPreview])

  const cancelarMapeo = useCallback(() => {
    setFase(FASE.CARGA)
  }, [])

  const confirmarMapeo = useCallback(async () => {
    if (!archivoInfo?.cargaId) return { ok: false }
    setCargando(true)
    setError(null)
    try {
      await carteraService.aplicarMapeoPlantilla(archivoInfo.cargaId, mapeo, aliases, valoresBlancos, columnasHistoricasFinales)
      setFase(FASE.CARGA)
      setArchivoInfo(null)
      setColumnasOriginales([])
      setAliases({})
      setValoresBlancos({})
      setColumnasHistoricas([])
      setColumnas([])
      setMapeo({})
      setDatos({})
      setColumnasConBlancos([])
      archivoLocalRef.current = null
      return { ok: true }
    } catch (e) {
      setError(e.response?.data?.mensaje || 'No se pudo aplicar la plantilla.')
      return { ok: false }
    } finally {
      setCargando(false)
    }
  }, [archivoInfo, mapeo, aliases, valoresBlancos, columnasHistoricasFinales])

  const limpiar = useCallback(async () => {
    if (archivoInfo?.cargaId) {
      try { await carteraService.eliminarArchivo(archivoInfo.cargaId) } catch { /* noop */ }
    }
    setFase(FASE.CARGA)
    setArchivoInfo(null)
    setColumnasOriginales([])
    setAliases({})
    setValoresBlancos({})
    setColumnasHistoricas([])
    setColumnas([])
    setMapeo({})
    setDatos({})
    setColumnasConBlancos([])
    setError(null)
    archivoLocalRef.current = null
  }, [archivoInfo])

  return {
    FASE,
    fase,
    archivoInfo,
    columnasOriginales,
    aliases,
    columnas,
    mapeo,
    datos,
    columnasConBlancos,
    valoresBlancos,
    columnasHistoricas,
    columnasHistoricasFinales,
    cargando,
    cargandoPreview,
    error,
    subirYValidar,
    cambiarHoja,
    conectarFuenteBD,
    actualizarAlias,
    cancelarRenombrado,
    confirmarRenombrado,
    actualizarValorBlanco,
    cancelarValoresBlancos,
    confirmarValoresBlancos,
    actualizarColumnaHistorica,
    inicializarColumnasHistoricas,
    actualizarMapeoSlot,
    cancelarMapeo,
    confirmarMapeo,
    limpiar,
  }
}
