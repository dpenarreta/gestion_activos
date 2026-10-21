import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Spinner } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { useGenericDashboardBuilder } from '../../hooks/useGenericDashboardBuilder'
import { requiereConfirmacion, useDashboardLayout } from '../../hooks/useDashboardLayout'
import { PERMISOS, usePermisos } from '../../hooks/usePermisos'
import { useAuth } from '../../context/AuthContext'
import FileUploadZone from '../../components/upload/FileUploadZone'
import RenameColumnsStep from '../../components/dashboard-generic/RenameColumnsStep'
import ValoresEnBlancoStep from '../../components/dashboard-generic/ValoresEnBlancoStep'
import TemplateMappingStep from '../../components/dashboard-generic/TemplateMappingStep'
import DirectorioSeccion from '../../components/dashboard-directorio/DirectorioSeccion'
import GenericChartRenderer from '../../components/dashboard-generic/GenericChartRenderer'
import GenericTitleBlock from '../../components/dashboard-generic/GenericTitleBlock'
import GenericSeparator from '../../components/dashboard-generic/GenericSeparator'
import TablaHistoricaAutomatica from '../../components/dashboard-generic/TablaHistoricaAutomatica'
import EditModeToolbar from '../../components/dashboard-editor/EditModeToolbar'
import EditableGrid from '../../components/dashboard-editor/EditableGrid'
import ComponentPropertiesPanel from '../../components/dashboard-editor/ComponentPropertiesPanel'
import AgregarComponentePersonalModal from '../../components/dashboard-editor/AgregarComponentePersonalModal'
import ComponentPaletteSidebar from '../../components/dashboard-editor/ComponentPaletteSidebar'
import ConfirmModal from '../../components/dashboard-editor/ConfirmModal'
import ConfirmarClaveModal from '../../components/dashboard-editor/ConfirmarClaveModal'
import DashboardTabsBar from '../../components/dashboards/DashboardTabsBar'
import InterpretacionDashboardModal from '../../components/dashboards/InterpretacionDashboardModal'
import ConectarFuenteBDModal from '../../components/dashboards/ConectarFuenteBDModal'
import * as carteraService from '../../services/carteraService'
import * as dashboardLayoutService from '../../services/dashboardLayoutService'
import * as historicoService from '../../services/historicoService'
import { construirOverride, datosDesdeComponente } from '../../utils/datosDesdeComponente'
import { generarPDFDesdeElemento } from '../../utils/pdfExport'

// Tipos de la paleta sin datos (se crean de inmediato al soltar/elegir, sin pasar por
// `AgregarComponentePersonalModal`) — mapea el vocabulario de `ComponentPaletteSidebar` al
// `DashboardComponent.Tipo` real del backend (`title`/`text`).
const TIPO_BACKEND_PRESENTACIONAL = { titulo: 'title', separador: 'text' }

// `estadoFuenteBD.ultima_actualizacion`/`proxima_actualizacion` llegan como fecha ISO ('YYYY-MM-DD',
// sin hora) — se arma el string a mano en vez de pasar por `Date`/`toLocaleDateString` para no
// arriesgar un corrimiento de un día por interpretación UTC según la zona horaria del navegador.
function formatearFechaISO(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

// Días corridos entre `iso` ('YYYY-MM-DD') y hoy, para el "1 D"/"2 D"... junto a "Última
// actualización". Ambas fechas se arman como medianoche LOCAL (nunca UTC) antes de restar, mismo
// motivo que `formatearFechaISO`: evita que la resta dé un día de más o de menos según la zona
// horaria del navegador.
function diasDesdeISO(iso) {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-').map(Number)
  const fecha = new Date(anio, mes - 1, dia)
  const hoy = new Date()
  const hoyMedianoche = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  return Math.round((hoyMedianoche - fecha) / (1000 * 60 * 60 * 24))
}

// 'YYYY-MM-DD' de `fecha` en hora LOCAL — `toISOString()` la pasa a UTC y, de noche en Ecuador
// (UTC-5), sugeriría la fecha de mañana.
function fechaLocalISO(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

/** Único destino de suelta de la paleta de componentes (`ComponentPaletteSidebar`) — vive en un
 * `DndContext` separado del de `EditableGrid.jsx` (que gobierna el reordenamiento interno del
 * grid) para no interferir con esa lógica ya probada. Como es el ÚNICO droppable registrado en
 * ese `DndContext`, es estructuralmente imposible soltar un componente de la paleta en otro
 * lugar que no sea la Zona Personal — no depende de ninguna validación en tiempo de ejecución. */
function ZonaPersonalDropTarget() {
  const { isOver, setNodeRef } = useDroppable({ id: 'zona-personal-drop' })
  return (
    <div ref={setNodeRef} className={`mz-drop mb-3 ${isOver ? 'is-drag' : ''}`}>
      <i className="bi bi-plus-square-dotted" aria-hidden="true"></i>
      <div>Soltá aquí un componente para agregarlo a la Zona Personal</div>
    </div>
  )
}

/**
 * Página de un dashboard por área. Todo dashboard nace con las 13 posiciones fijas de la
 * plantilla (`services/plantilla.py`, sembradas al crearlo) con datos ficticios — nunca vacío.
 * "Cargar otro archivo" abre el flujo `CARGA → RENOMBRAR → [VALORES_EN_BLANCO] → MAPEO`
 * (`useGenericDashboardBuilder`): analiza el archivo, deja renombrar cualquier columna y marcarla
 * como "histórica" (`RenameColumnsStep` — esa marca queda guardada por dashboard, se reconoce sola
 * en la próxima carga, y alimenta automáticamente Tabla 3, ver `columnasHistoricasConfiguradas`
 * más abajo), propone qué columna(s) usar en cada una de las 13 posiciones (`TemplateMappingStep`)
 * y, al confirmar, sobreescribe esas mismas posiciones con datos reales.
 * Cada posición sigue siendo un componente normal del layout (`useDashboardLayout`), así que
 * conserva el editor de grid (mover/redimensionar/ocultar/recolorear) ya existente.
 *
 * "Conectar vista de base de datos" entra al MISMO flujo por otra puerta: `ConectarFuenteBDModal`
 * pide (y guarda) qué vista/procedimiento de la conexión externa "por defecto" usar, y recién al
 * confirmar ahí dispara `builder.conectarFuenteBD()` — de ahí en más es indistinguible de haber
 * subido un Excel (mismas fases RENOMBRAR/VALORES_EN_BLANCO/MAPEO, ver `services/db_source.py`).
 *
 * En modo edición, el panel lateral de componentes (`ComponentPaletteSidebar`) se abre solo al
 * entrar en modo edición y permite arrastrar (o hacer clic, como alternativa sin arrastre) un
 * tipo de componente hasta `ZonaPersonalDropTarget` — separador/título se crean de inmediato
 * (`dashboardLayoutService.agregarComponentePresentacional`); KPI/gráfico/tabla abren
 * `AgregarComponentePersonalModal` ya preseleccionado en ese tipo, porque necesitan elegir
 * columna(s) del archivo antes de poder calcular su contenido.
 */
export default function DashboardAreaPage() {
  const { dashboardId } = useParams()
  const [dashboardInfo, setDashboardInfo] = useState(null)
  const [mostrarConstructor, setMostrarConstructor] = useState(false)
  const [mostrarModalPersonal, setMostrarModalPersonal] = useState(false)
  const [tipoModalPersonal, setTipoModalPersonal] = useState(null)
  const [mostrarPaleta, setMostrarPaleta] = useState(false)
  const [mostrarInterpretacion, setMostrarInterpretacion] = useState(false)
  const [mostrarConectarFuenteBD, setMostrarConectarFuenteBD] = useState(false)
  const [confirmandoAgregarTipo, setConfirmandoAgregarTipo] = useState(null)
  // Cambio estructural esperando que se confirme la contraseña, en un dashboard con el diseño
  // bloqueado: `{ accion, ejecutar }`. `ejecutar(clave)` reintenta la MISMA operación que acaba
  // de ser rechazada — no se guarda la contraseña en ningún lado, solo se la pasa a ese reintento.
  const [confirmacionClave, setConfirmacionClave] = useState(null)
  const [claveComponenteNuevo, setClaveComponenteNuevo] = useState('')
  const builder = useGenericDashboardBuilder(dashboardId)
  const layout = useDashboardLayout(dashboardId)
  // Estado de "Última actualización"/"Próxima actualización automática" bajo los botones del
  // encabezado (`obtenerFuenteBD` ya trae ambas fechas calculadas, ver
  // `services/dashboards.py::obtener_fuente_bd`) — se vuelve a pedir después de cualquier acción
  // que pueda haber cambiado alguna de las dos (conectar, aplicar un mapeo, actualizar ahora, o
  // simplemente guardar la configuración del modal aunque no haya llegado a conectar).
  const [estadoFuenteBD, setEstadoFuenteBD] = useState(null)
  const [actualizandoAhora, setActualizandoAhora] = useState(false)
  const [errorActualizarAhora, setErrorActualizarAhora] = useState('')
  const cargarEstadoFuenteBD = () => {
    dashboardLayoutService.obtenerFuenteBD(dashboardId).then(setEstadoFuenteBD).catch(() => setEstadoFuenteBD(null))
  }
  useEffect(cargarEstadoFuenteBD, [dashboardId])

  // Con un procedimiento que recibe fecha, "Actualizar ahora" pregunta primero con qué fecha
  // ejecutarlo (sugiere hoy): sin frecuencia no hay período que avanzar y reenviar la fecha
  // guardada traía exactamente los mismos datos. Una vista (sin parámetros) actualiza directo.
  const [fechaActualizarAhora, setFechaActualizarAhora] = useState(null)
  const parametroFechaFuente = Object.keys(estadoFuenteBD?.parametros || {})[0] || ''
  const pulsarActualizarAhora = () => {
    if (parametroFechaFuente) setFechaActualizarAhora(fechaLocalISO(new Date()))
    else actualizarAhora()
  }

  const actualizarAhora = async (fechaCorte) => {
    setFechaActualizarAhora(null)
    setActualizandoAhora(true)
    setErrorActualizarAhora('')
    try {
      const resultado = await carteraService.actualizarFuenteBDAhora(dashboardId, fechaCorte)
      if (resultado.ok) {
        await layout.recargar()
      } else {
        setErrorActualizarAhora(resultado.mensaje)
      }
    } catch (e) {
      setErrorActualizarAhora(e.response?.data?.mensaje || 'No se pudo actualizar.')
    } finally {
      setActualizandoAhora(false)
      cargarEstadoFuenteBD()
    }
  }
  // "Imprimir como PDF" (botón del encabezado) — captura `dashboardRef` (el contenedor de todo el
  // dashboard, `.cartera-app`) tal cual está renderizado en pantalla con `html2canvas` y arma el
  // PDF con `jsPDF` (`utils/pdfExport.js`). Se descartó `window.print()`/`@media print`: la foto
  // de impresión nativa del navegador se toma antes de que Recharts termine de re-medir sus
  // gráficos, dejándolos rotos (sobre todo los circulares). Capturar el DOM ya renderizado evita
  // ese problema de raíz, a cambio de que el PDF sea una imagen (sin texto seleccionable).
  const dashboardRef = useRef(null)
  const [generandoPDF, setGenerandoPDF] = useState(false)
  const [errorPDF, setErrorPDF] = useState('')
  const imprimirComoPDF = async () => {
    if (!dashboardRef.current) return
    setGenerandoPDF(true)
    setErrorPDF('')
    try {
      await generarPDFDesdeElemento(dashboardRef.current, `${dashboardInfo?.name || dashboardId}.pdf`)
    } catch (e) {
      // El error se registra además de mostrarse: la captura falla por cosas que el mensaje
      // amable no puede explicar (un recurso que no carga, un color que html2canvas no sabe
      // parsear), y sin esto no queda rastro de cuál fue — el usuario solo ve "no se pudo".
      console.error('[PDF] No se pudo generar el PDF:', e)
      setErrorPDF('No se pudo generar el PDF. Intentá de nuevo.')
    } finally {
      setGenerandoPDF(false)
    }
  }
  const permisos = usePermisos()
  const sensoresPaleta = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  // `usePermisos()` es un stub que concede todo el editor visual siempre (ver `hooks/CLAUDE.md`)
  // — para gates reales de IA se usa `user.permissions` directo, igual que el resto de la app.
  const { user } = useAuth()
  // Desbloquear el diseño pide su permiso (21/10/2026; antes, ser superusuario).
  const puedeDesbloquear = Boolean(user?.permissions?.includes('dashboard.desbloquear'))
  const puedeInterpretar = Boolean(user?.permissions?.includes('dashboard.interpretar'))
  const puedeHallazgosIA = Boolean(user?.permissions?.includes('dashboard.hallazgos_ia'))

  // Las columnas que el usuario ya marcó como "históricas" para este dashboard (`ColumnaHistorica`,
  // configuración persistente — no lo que aparece en los datos ya guardados). Alimenta Tabla 3
  // en la vista normal del dashboard (más abajo) y, durante el asistente de carga, deja
  // pre-tildadas las mismas columnas en "Renombrar columnas" y avisa si alguna falta en el archivo
  // nuevo. Se pide siempre (no solo durante el asistente): Tabla 3 la necesita igual fuera de
  // él. `builder.fase` como dependencia hace que se refresque sola después de aplicar un mapeo
  // nuevo (esa acción vuelve la fase a CARGA).
  const [columnasHistoricasConfiguradas, setColumnasHistoricasConfiguradas] = useState([])
  useEffect(() => {
    let cancelado = false
    historicoService.listarCargasHistoricas(dashboardId)
      .then((resultado) => { if (!cancelado) setColumnasHistoricasConfiguradas(resultado.columnas_historicas_configuradas || []) })
      .catch(() => { if (!cancelado) setColumnasHistoricasConfiguradas([]) })
    return () => { cancelado = true }
  }, [dashboardId, builder.fase])

  // Pre-tilda, una vez por carga nueva (cuando aparece un `cargaId`), las columnas de ese archivo
  // que ya estaban marcadas como históricas antes — así el usuario no tiene que volver a elegirlas
  // a mano cada vez que sube un archivo de la misma fuente.
  useEffect(() => {
    if (builder.archivoInfo?.cargaId) {
      builder.inicializarColumnasHistoricas(columnasHistoricasConfiguradas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se dispara una vez por carga (cargaId), no en cada cambio de columnasHistoricasConfiguradas
  }, [builder.archivoInfo?.cargaId])

  // El título general y el área mostrados en el encabezado son siempre los del dashboard raíz de
  // la familia, no los de la pestaña activa (`listar_pestanas` ya resuelve la raíz sin importar
  // desde qué pestaña se llame) — el nombre de la pestaña en sí solo se ve en la barra de
  // pestañas, nunca reemplaza el título general.
  useEffect(() => {
    let cancelado = false
    dashboardLayoutService.obtenerPestanas(dashboardId).then((pestanas) => {
      const raiz = pestanas[0]
      if (!raiz) return
      dashboardLayoutService.obtenerDashboardsAutorizados().then((lista) => {
        const encontrado = lista.find((d) => d.dashboard_id === raiz.dashboard_id)
        if (!cancelado) setDashboardInfo(encontrado || { dashboard_id: raiz.dashboard_id, name: raiz.name, area: '' })
      })
      // Sin acceso a la familia de pestañas (control de acceso por dashboard): el título general
      // se queda en el fallback del `dashboardId` crudo — `layout.error`, más abajo, ya explica
      // por qué no se puede ver este dashboard.
    }).catch(() => {})
    return () => { cancelado = true }
  }, [dashboardId])

  // El panel de paleta se abre solo al entrar en modo edición — reacciona a la transición de
  // `layout.modoEdicion` en vez de acoplarse al clic puntual de "Editar dashboard", así también
  // queda correcto si el modo edición se activa por cualquier otro camino futuro.
  useEffect(() => {
    if (layout.modoEdicion) setMostrarPaleta(true)
  }, [layout.modoEdicion])

  // "Hallazgos clave" por componente generados por IA (`HallazgosClaveCard.jsx`) — un único
  // llamado batch para todo el dashboard, no uno por componente (evitaría N llamadas externas en
  // cada carga de página). Se pide una vez que el layout GUARDADO está disponible y se vuelve a
  // pedir solo cuando su versión cambia (nuevo archivo cargado, componente agregado/editado) — no
  // en cada movimiento sin guardar del borrador. Si falla o todavía no resolvió, cada
  // `HallazgosClaveCard` sigue mostrando su texto por reglas (fallback instantáneo) — por eso acá
  // no hay estado de error ni de carga, un `catch` silencioso alcanza. Sin `dashboard.hallazgos_ia`
  // ni siquiera se dispara la llamada (evita un 403 esperado en cada carga de página para
  // cualquier usuario sin ese permiso — la protección real de todos modos vive en el backend).
  const [hallazgosIA, setHallazgosIA] = useState({})
  useEffect(() => {
    if (!layout.layoutGuardado || !puedeHallazgosIA) return undefined
    let cancelado = false
    dashboardLayoutService.generarHallazgosIA(dashboardId)
      .then((resultado) => { if (!cancelado) setHallazgosIA(resultado.hallazgos || {}) })
      .catch(() => {})
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe repetirse cuando cambia la versión guardada, no en cada referencia nueva de layoutGuardado
  }, [dashboardId, layout.layoutGuardado?.version, puedeHallazgosIA])

  const cancelarConstructor = () => {
    builder.limpiar()
    setMostrarConstructor(false)
  }

  const confirmarMapeo = async () => {
    const resultado = await builder.confirmarMapeo()
    if (resultado.ok) {
      await layout.recargar()
      setMostrarConstructor(false)
      cargarEstadoFuenteBD()
    }
  }

  // Le pasa `ConectarFuenteBDModal` como `onConectar`: se llama recién después de guardar la
  // configuración (tipo/nombre/parámetros) elegida en el modal, y le devuelve `{ok}` para que el
  // modal decida qué mostrar — con `ok:false` el modal se queda abierto con su propio mensaje fijo
  // hasta que el usuario confirma "Aceptar" (ver `ConectarFuenteBDModal.jsx`), así que acá solo
  // hace falta revelar el asistente si salió bien, o limpiar el estado a medio armar de la carga
  // fallida si no (`builder.limpiar`, ya sabe no hacer nada raro si nunca llegó a crearse una
  // `CargaArchivo`) — nunca mostrar nada de error acá, eso es responsabilidad del modal.
  const conectarFuenteBD = async () => {
    const resultado = await builder.conectarFuenteBD()
    if (resultado.ok) {
      setMostrarConstructor(true)
    } else {
      await builder.limpiar()
    }
    cargarEstadoFuenteBD()
    return resultado
  }

  // Le pasa `ConectarFuenteBDModal` como `onDatosBorrados`: borra TODA la información real del
  // dashboard (cargas de Excel, histórico, conexión a BD, Zona Personal) y lo deja como recién
  // creado (`services/dashboards.py::borrar_datos_dashboard`) — hay que refrescar tanto el layout
  // (ahora con las posiciones fijas en datos de ejemplo) como el estado de fuente BD (ahora vacío)
  // para que la pantalla deje de mostrar el archivo/conexión que ya no existe.

  /**
   * Corre una operación estructural y, si el backend la rechaza por el bloqueo del dashboard,
   * abre el cuadro de contraseña con el mismo reintento adentro.
   *
   * Está acá y no dentro del hook porque el hook no puede abrir modales, y la pantalla no debería
   * tener que saber qué operaciones son estructurales: cada una se envuelve igual y el backend
   * decide.
   */
  const conConfirmacion = (accion, operacion) => async (...args) => {
    // Un handler escrito como `onClick={guardarLayout}` entrega el evento de React como primer
    // argumento. Sin descartarlo, ese evento viajaba como si fuera la contraseña.
    const resultado = await operacion(...args.filter((a) => !(a && typeof a === 'object' && 'nativeEvent' in a)))
    if (resultado?.requiereConfirmacion) {
      setConfirmacionClave({
        accion,
        ejecutar: async (clave) => {
          // El try/catch no es defensivo de más: si algo acá lanza, el cuadro se queda girando
          // para siempre porque nadie más atrapa esa excepción — ya pasó con la contraseña
          // incorrecta, antes de que `requiereConfirmacion` reconociera ese código.
          try {
            const reintento = await operacion(...args, clave)
            if (reintento?.ok) setConfirmacionClave(null)
            return reintento
          } catch (e) {
            return { ok: false, mensaje: e.response?.data?.mensaje || 'No se pudo completar el cambio.' }
          }
        },
      })
    }
    return resultado
  }

  // Agregar un componente (desde la paleta, sea presentacional o vía el modal) persiste de
  // inmediato y refresca el layout con la última versión guardada en el servidor — no pasa por
  // "Guardar cambios". Si hay ediciones de diseño sin guardar (mover/ocultar/redimensionar), se
  // pide confirmación antes de perderlas en silencio (`manejarElegirTipo`); esta función solo
  // ejecuta la acción ya confirmada.
  const ejecutarAgregarTipo = async (tipo, clave = '') => {
    if (tipo in TIPO_BACKEND_PRESENTACIONAL) {
      try {
        await dashboardLayoutService.agregarComponentePresentacional(dashboardId, {
          // La clave solo se agrega si hay una: sin bloqueo, la llamada queda igual que siempre.
          tipo: TIPO_BACKEND_PRESENTACIONAL[tipo], zona: 'personal',
          ...(clave ? { passwordConfirmacion: clave } : {}),
        })
      } catch (e) {
        const confirmacion = requiereConfirmacion(e)
        if (!confirmacion) throw e
        return confirmacion
      }
      await layout.recargar()
      return { ok: true }
    }
    // KPI/gráfico/tabla se arman en un modal con varios pasos, así que la contraseña se pide
    // ANTES de abrirlo y viaja con el alta final: pedirla al confirmar el modal obligaría a
    // encadenar dos cuadros y a rehacer el formulario si la primera vez se escribe mal.
    if (layout.layoutGuardado?.estructura_bloqueada && !clave) {
      return { ok: false, requiereConfirmacion: true }
    }
    setClaveComponenteNuevo(clave)
    setTipoModalPersonal(tipo)
    setMostrarModalPersonal(true)
    return { ok: true }
  }

  const agregarTipoConConfirmacion = conConfirmacion(
    'agregar un componente', (tipo, clave) => ejecutarAgregarTipo(tipo, clave),
  )

  const estructuraBloqueada = Boolean(layout.layoutGuardado?.estructura_bloqueada)
  // El mismo criterio con el que se eligen los renderers propios (`config.render`): así el
  // encabezado no necesita saber el id del dashboard ni mantener una lista aparte.
  const esInformeDirectorio = (layout.borrador || []).some((c) => c.config?.render === 'directorio')

  // Descarga del archivo que alimenta el dashboard, con todas sus filas y columnas. Lo que se
  // baja es la carga VIGENTE —lo mismo que la pantalla está mostrando—, no una ejecución nueva
  // del origen: ver `services/descarga_datos.py`.
  const [descargando, setDescargando] = useState(false)
  const [errorDescarga, setErrorDescarga] = useState('')
  const descargarDatos = async () => {
    setDescargando(true)
    setErrorDescarga('')
    try {
      const { blob, nombre } = await dashboardLayoutService.descargarDatos(dashboardId)
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = nombre
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      // El cuerpo del error viaja como blob (la petición pide `responseType: 'blob'`), así que
      // el mensaje del backend no se puede leer directo: se muestra uno propio.
      setErrorDescarga(e.response?.status === 400
        ? 'Este dashboard todavía no tiene datos cargados para descargar.'
        : 'No se pudo descargar el archivo.')
    } finally {
      setDescargando(false)
    }
  }

  // "Borrar datos" también se lleva los componentes de la Zona Personal, así que en un dashboard
  // bloqueado pasa por la misma puerta que el resto. Va después de `conConfirmacion` porque lo usa.
  const ejecutarBorrarDatos = async (confirmationName, clave) => {
    try {
      // La clave solo se agrega si hay una: sin bloqueo, la llamada queda igual que siempre.
      await (clave
        ? dashboardLayoutService.borrarDatosDashboard(dashboardId, confirmationName, clave)
        : dashboardLayoutService.borrarDatosDashboard(dashboardId, confirmationName))
    } catch (e) {
      const confirmacion = requiereConfirmacion(e)
      if (!confirmacion) throw e
      return confirmacion
    }
    await layout.recargar()
    cargarEstadoFuenteBD()
    return { ok: true }
  }
  const borrarDatosDashboard = conConfirmacion('borrar los datos de este dashboard', ejecutarBorrarDatos)

  const guardarLayout = conConfirmacion('guardar estos cambios', (clave) => layout.guardar(clave))
  const restablecerLayout = conConfirmacion('restablecer el diseño', (clave) => layout.restablecer(clave))

  const manejarElegirTipo = (tipo) => {
    if (layout.hayCambiosSinGuardar()) {
      setConfirmandoAgregarTipo(tipo)
      return
    }
    agregarTipoConConfirmacion(tipo)
  }

  const manejarSoltarPaleta = (event) => {
    const { active, over } = event
    if (over?.id !== 'zona-personal-drop') return
    if (typeof active.id !== 'string' || !active.id.startsWith('paleta-')) return
    manejarElegirTipo(active.id.replace('paleta-', ''))
  }

  const cargandoInicial = layout.layoutGuardado === null
  const mostrandoConstructor = !cargandoInicial && mostrarConstructor
  // El panel de paleta y `ComponentPropertiesPanel` (ambos `Offcanvas placement="end"`) quedan
  // mutuamente excluyentes sin estado extra: al seleccionar un componente existente para
  // configurarlo, la paleta se oculta sola; al cerrar el panel de propiedades, reaparece si
  // seguía activa.
  const mostrarPaletaEfectivo = mostrarPaleta && !layout.seleccionado

  const registro = Object.fromEntries(layout.borrador.map((c) => [
    c.component_id,
    {
      render: (componente) => {
        // El Dashboard Directorio replica una pestaña de un informe financiero impreso, con
        // secciones que los componentes genéricos no saben dibujar (etiquetas sobre las barras,
        // meta con ✓/✗, tarjetas resumen dentro de una sección, mini-tablas por deudor). Es el
        // único dashboard con renderers propios, y se reconoce por `config.render`.
        if (componente.config?.render === 'directorio') {
          // El hallazgo de IA llega igual que a los genéricos: el informe pone bajo cada sección
          // un párrafo de análisis, no la descripción del cálculo, y ese párrafo ya lo genera
          // `generar_hallazgos_ia` por componente. Sin él (sin permiso, sin clave de Gemini o
          // mientras la llamada está en vuelo), cada sección cae a su descripción.
          return <DirectorioSeccion
            componente={componente}
            componentes={layout.borrador}
            hallazgoIA={hallazgosIA[componente.component_id]}
            dashboardId={dashboardId}
          />
        }
        if (componente.type === 'title') return <GenericTitleBlock content={componente.content} />
        if (componente.type === 'text') return <GenericSeparator content={componente.content} />
        if (componente.type !== 'kpi' && componente.type !== 'chart') return null
        const override = construirOverride(componente)
        const { datos, datosMultiserie } = datosDesdeComponente(componente)
        const esTablaHistorica = componente.component_id === 'tabla-3'
        // Cualquier otra Tabla (fija o de Zona Personal) puede elegir "Histórico" desde
        // "Configurar componente" → "Datos" (ver `SlotFields.jsx::SelectorFuenteDatosTabla`) — a
        // diferencia de Tabla 3, ahí el contenido YA viene calculado en `componente.content`
        // (`plantilla.py::_contenido_tabla_historica`, mismo momento que cualquier otro
        // recálculo), no hace falta el wrapper de refetch en vivo. Solo cambia la etiqueta
        // "Histórica" del título.
        const esHistorica = esTablaHistorica || Boolean(componente.mapeo?.usa_historico)
        const contenidoNormal = (
          <GenericChartRenderer
            tipoVisualizacion={componente.type === 'kpi' ? 'kpi' : (componente.chart_type || 'barras_horizontales')}
            datos={datos}
            datosMultiserie={datosMultiserie}
            titulo={componente.content?.titulo}
            override={override}
            config={componente.config}
            esHistorica={esHistorica}
            hallazgoIA={hallazgosIA[componente.component_id]}
          />
        )
        // Tabla 3 es la única posición que, en vez de mostrar el detalle del archivo actual,
        // compara en vivo las cargas históricas HABILITADAS del dashboard (ver
        // `TablaHistoricaAutomatica.jsx`) — cae a `contenidoNormal` si todavía no hay historial
        // habilitado o esta posición no tiene columnas mapeadas.
        if (esTablaHistorica) {
          return (
            <TablaHistoricaAutomatica
              dashboardId={dashboardId}
              columnasValor={columnasHistoricasConfiguradas.map((nombre) => ({ columna: nombre, tipo_agregacion: 'suma' }))}
              override={override}
              contenidoNormal={contenidoNormal}
            />
          )
        }
        return contenidoNormal
      },
    },
  ]))

  return (
    // Con la paleta de componentes abierta (a la derecha, alto completo y sin fondo que bloquee),
    // el dashboard le deja su ancho libre para que no tape la barra de "Guardar cambios". El panel
    // de propiedades no lo necesita: es modal, con fondo, y se cierra para seguir editando.
    <div
      className={`cartera-app ${layout.modoEdicion && mostrarPaletaEfectivo ? 'cartera-app--con-panel' : ''}`}
      ref={dashboardRef}
    >
      <div className="mz-view-head">
        <div>
          <h2>{dashboardInfo?.name || dashboardId}</h2>
          {dashboardInfo?.area && <p className="mz-desc">Área: {dashboardInfo.area}</p>}
        </div>
        {/* `acciones-dashboard` deja que los botones pasen a la fila siguiente en vez de
            encogerse: sin eso, a 700px la barra medía 94px de alto porque cada botón se
            comprimía hasta partir su texto en cuatro renglones. */}
        <div className="acciones-dashboard d-print-none">
          {puedeInterpretar && (
            <Button variant="outline-secondary" size="sm" onClick={() => setMostrarInterpretacion(true)}>
              <i className="bi bi-stars" aria-hidden="true"></i> Interpretación completa
            </Button>
          )}
          <Button variant="outline-secondary" size="sm" onClick={() => setMostrarConectarFuenteBD(true)}>
            <i className="bi bi-database" aria-hidden="true"></i> Conectar vista de base de datos
          </Button>
          {/* El Dashboard Directorio replica un informe impreso y no usa el histórico de cargas:
              ahí ese botón cede el lugar a la descarga del archivo completo. En los demás
              dashboards el histórico sigue como estaba. */}
          {esInformeDirectorio ? (
            <Button variant="outline-secondary" size="sm" onClick={descargarDatos} disabled={descargando}>
              <i className="bi bi-download" aria-hidden="true"></i> {descargando ? 'Preparando…' : 'Descargar Excel'}
            </Button>
          ) : (
            <Button as={Link} to={`/admin/dashboards/${dashboardId}/historico`} variant="outline-secondary" size="sm">
              <i className="bi bi-clock-history" aria-hidden="true"></i> Ver histórico
            </Button>
          )}
          {!mostrarConstructor && (
            <Button variant="outline-secondary" size="sm" onClick={() => setMostrarConstructor(true)}><i className="bi bi-upload" aria-hidden="true"></i> Cargar otro archivo</Button>
          )}
          <Button variant="outline-secondary" size="sm" onClick={imprimirComoPDF} disabled={generandoPDF}>
            {generandoPDF ? <Spinner size="sm" animation="border" className="me-1" /> : <i className="bi bi-printer" aria-hidden="true"></i>}
            {' '}Imprimir como PDF
          </Button>
        </div>
      </div>
      {errorPDF && (
        <Alert variant="danger" dismissible onClose={() => setErrorPDF('')} className="py-2 d-print-none" style={{ fontSize: '0.85rem' }}>
          {errorPDF}
        </Alert>
      )}

      {/* Estado de actualización de datos — bajo los botones del encabezado, siempre con sus 3
          valores visibles: última actualización, días transcurridos desde esa fecha, y la próxima
          actualización. Los primeros dos siempre se muestran (con "Nunca" si todavía no hay
          ninguna carga real). El tercero es una fecha SOLO con una frecuencia automática
          configurada (`services/fuente_bd_scheduler.py::proxima_actualizacion`); en cualquier otro
          caso (frecuencia en Manual, o directamente sin fuente configurada) se muestra en su lugar
          el ícono "Actualizar ahora" — con fuente configurada corre la actualización sin asistente
          en el momento (`ActualizarFuenteBDAhoraView`); sin fuente, abre el modal de "Conectar
          vista de base de datos" para configurarla, ya que no hay nada que reconectar todavía. */}
      {estadoFuenteBD && (
        <div className="d-flex align-items-center flex-wrap gap-2 mb-3 chart-panel__subtitle d-print-none">
          <span>
            Última actualización: {estadoFuenteBD.ultima_actualizacion ? formatearFechaISO(estadoFuenteBD.ultima_actualizacion) : 'Nunca'}
            {estadoFuenteBD.ultima_actualizacion ? ` (${diasDesdeISO(estadoFuenteBD.ultima_actualizacion)} D)` : ''}
          </span>
          {estadoFuenteBD.frecuencia_actualizacion && estadoFuenteBD.proxima_actualizacion ? (
            <span>· Próxima actualización automática: {formatearFechaISO(estadoFuenteBD.proxima_actualizacion)}</span>
          ) : (
            <Button
              variant="link" size="sm" className="p-0 d-print-none"
              onClick={estadoFuenteBD.nombre ? pulsarActualizarAhora : () => setMostrarConectarFuenteBD(true)}
              disabled={actualizandoAhora}
            >
              {actualizandoAhora ? <Spinner size="sm" animation="border" className="me-1" /> : null}
              {actualizandoAhora ? null : <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>} Actualizar ahora
            </Button>
          )}
        </div>
      )}
      {errorActualizarAhora && (
        <Alert variant="warning" dismissible onClose={() => setErrorActualizarAhora('')} className="py-2 d-print-none" style={{ fontSize: '0.85rem' }}>
          {errorActualizarAhora}
        </Alert>
      )}
      {errorDescarga && (
        <Alert variant="warning" dismissible onClose={() => setErrorDescarga('')} className="py-2 d-print-none" style={{ fontSize: '0.85rem' }}>
          {errorDescarga}
        </Alert>
      )}

      {/* Un `layout.error` durante la carga inicial (p. ej. 403 del control de acceso por
          dashboard: el usuario no es dueño/superusuario ni tiene un rol asignado) corta acá — ni
          la barra de pestañas ni el resto de la página tienen nada válido que mostrar. */}
      {cargandoInicial && layout.error && <Alert variant="danger">{layout.error}</Alert>}

      {!(cargandoInicial && layout.error) && (
        <div className="d-print-none">
          <DashboardTabsBar dashboardId={dashboardId} modoEdicion={layout.modoEdicion} />
        </div>
      )}

      {cargandoInicial && !layout.error && <div className="text-center mb-3" role="status"><Spinner animation="border" /></div>}

      {!cargandoInicial && mostrandoConstructor && (
        <>
          {builder.fase === builder.FASE.CARGA && (
            <>
              <FileUploadZone onValidar={(archivo) => builder.subirYValidar(archivo)} cargando={builder.cargando} error={builder.error} />
              <div className="mt-2">
                <Button variant="outline-secondary" size="sm" onClick={cancelarConstructor}>Cancelar</Button>
              </div>
            </>
          )}

          {builder.fase === builder.FASE.RENOMBRAR && (
            <RenameColumnsStep
              archivoInfo={builder.archivoInfo}
              columnas={builder.columnasOriginales}
              aliases={builder.aliases}
              onActualizarAlias={builder.actualizarAlias}
              onContinuar={builder.confirmarRenombrado}
              onCancelar={builder.cancelarRenombrado}
              cargando={builder.cargando}
              error={builder.error}
              columnasHistoricas={builder.columnasHistoricas}
              onCambiarColumnaHistorica={builder.actualizarColumnaHistorica}
              columnasHistoricasConfiguradas={columnasHistoricasConfiguradas}
            />
          )}

          {builder.fase === builder.FASE.VALORES_EN_BLANCO && (
            <ValoresEnBlancoStep
              archivoInfo={builder.archivoInfo}
              columnasConBlancos={builder.columnasConBlancos}
              valoresBlancos={builder.valoresBlancos}
              columnas={builder.columnas}
              columnasHistoricas={builder.columnasHistoricasFinales}
              onActualizarValorBlanco={builder.actualizarValorBlanco}
              onContinuar={builder.confirmarValoresBlancos}
              onCancelar={builder.cancelarValoresBlancos}
              cargando={builder.cargando}
              error={builder.error}
            />
          )}

          {builder.fase === builder.FASE.MAPEO && (
            <TemplateMappingStep
              archivoInfo={builder.archivoInfo}
              columnas={builder.columnas}
              mapeo={builder.mapeo}
              datos={builder.datos}
              aliases={builder.aliases}
              valoresBlancos={builder.valoresBlancos}
              onActualizarSlot={builder.actualizarMapeoSlot}
              onConfirmar={confirmarMapeo}
              onCancelar={builder.cancelarMapeo}
              cargando={builder.cargando}
              cargandoPreview={builder.cargandoPreview}
              error={builder.error}
              columnasConBlancos={builder.columnasConBlancos}
              columnasHistoricas={builder.columnasHistoricasFinales}
            />
          )}
        </>
      )}

      {!cargandoInicial && !mostrandoConstructor && (
        <>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3 d-print-none">
            <div className="chart-panel__subtitle mb-0">Diseño del dashboard</div>
            <EditModeToolbar
              modoEdicion={layout.modoEdicion}
              vistaPrevia={layout.vistaPrevia}
              cargando={layout.cargando}
              hayCambiosSinGuardar={layout.hayCambiosSinGuardar}
              onActivarEdicion={layout.activarEdicion}
              onGuardar={() => guardarLayout()}
              onCancelar={layout.cancelar}
              onAlternarVistaPrevia={layout.alternarVistaPrevia}
              onRestablecer={restablecerLayout}
            />
          </div>

          {estructuraBloqueada && layout.modoEdicion && (
            <Alert variant="secondary" className="py-2">
              <i className="bi bi-lock-fill" aria-hidden="true"></i> El diseño de este dashboard está bloqueado: no se puede agregar, eliminar,
              reordenar, redimensionar ni ocultar componentes.{' '}
              {puedeDesbloquear
                ? 'Al guardar se te va a pedir tu contraseña para autorizar el cambio.'
                : 'Los datos, títulos y colores sí se pueden seguir editando.'}
            </Alert>
          )}

          {layout.error && <Alert variant="danger">{layout.error}</Alert>}
          {layout.conflicto && (
            <Alert variant="warning" className="d-flex justify-content-between align-items-center">
              <span>Existe una versión más reciente de este dashboard guardada por otra persona.</span>
              <Button size="sm" variant="warning" onClick={layout.recargarPorConflicto}>Recargar configuración</Button>
            </Alert>
          )}

          <DndContext sensors={sensoresPaleta} onDragEnd={manejarSoltarPaleta}>
            <EditableGrid
              componentes={layout.borrador}
              registro={registro}
              modoEdicion={layout.modoEdicion}
              vistaPrevia={layout.vistaPrevia}
              seleccionado={layout.seleccionado}
              onSeleccionar={layout.setSeleccionado}
              onMover={layout.moverComponente}
              onOcultar={(id) => layout.actualizarComponente(id, { is_visible: false })}
              onMostrar={(id) => layout.actualizarComponente(id, { is_visible: true })}
              onEliminar={layout.eliminarComponente}
              onReordenar={layout.reordenarPorIds}
              permiteEstilo={permisos.tiene(PERMISOS.DASHBOARD_COMPONENT_STYLE)}
              permiteEliminar={permisos.tiene(PERMISOS.DASHBOARD_COMPONENT_DELETE)}
              esSuperusuario={puedeDesbloquear}
              estructuraBloqueada={estructuraBloqueada}
            />

            {layout.modoEdicion && mostrarPaletaEfectivo && <ZonaPersonalDropTarget />}

            <ComponentPaletteSidebar
              show={layout.modoEdicion && mostrarPaletaEfectivo}
              onHide={() => setMostrarPaleta(false)}
              onElegirTipo={manejarElegirTipo}
            />
          </DndContext>

          {layout.modoEdicion && !layout.vistaPrevia && (
            <ComponentPropertiesPanel
              componente={layout.seleccionado ? layout.borrador.find((c) => c.component_id === layout.seleccionado) : null}
              dashboardId={dashboardId}
              onCerrar={() => layout.setSeleccionado(null)}
              onActualizarContenido={layout.actualizarContenido}
              onActualizarEstilos={layout.actualizarEstilos}
              onCambiarAncho={(id, w) => layout.actualizarComponente(id, { width: w })}
              onCambiarAlto={(id, h) => layout.actualizarComponente(id, { height: h })}
              onActualizarConfig={(id, config) => layout.actualizarComponente(id, { config })}
              onActualizarComponente={layout.actualizarComponente}
              esSuperusuario={puedeDesbloquear}
              estructuraBloqueada={estructuraBloqueada}
            />
          )}

          <AgregarComponentePersonalModal
            show={mostrarModalPersonal}
            onHide={() => setMostrarModalPersonal(false)}
            dashboardId={dashboardId}
            componentesPersonales={layout.borrador.filter((c) => c.config?.zona === 'personal')}
            tipoInicial={tipoModalPersonal}
            passwordConfirmacion={claveComponenteNuevo}
            onAgregado={async () => {
              await layout.recargar()
              setMostrarModalPersonal(false)
              // La contraseña no sobrevive al alta: la próxima vez se vuelve a pedir.
              setClaveComponenteNuevo('')
            }}
          />

          <ConfirmModal
            show={Boolean(confirmandoAgregarTipo)}
            title="Agregar a la Zona Personal"
            confirmLabel="Continuar"
            confirmVariant="primary"
            onConfirm={() => {
              const tipo = confirmandoAgregarTipo
              setConfirmandoAgregarTipo(null)
              agregarTipoConConfirmacion(tipo)
            }}
            onCancel={() => setConfirmandoAgregarTipo(null)}
          >
            <Alert variant="warning" className="mb-0">
              Agregar un componente a la Zona Personal se guarda de inmediato y actualiza el
              dashboard con la última versión guardada en el servidor — tus cambios de diseño sin
              guardar se perderán. ¿Continuar?
            </Alert>
          </ConfirmModal>
        </>
      )}

      <InterpretacionDashboardModal
        show={mostrarInterpretacion}
        onHide={() => setMostrarInterpretacion(false)}
        dashboardId={dashboardId}
      />

      <ConfirmModal
        show={fechaActualizarAhora !== null}
        title="Actualizar ahora"
        confirmLabel="Actualizar"
        confirmVariant="primary"
        onConfirm={() => fechaActualizarAhora && actualizarAhora(fechaActualizarAhora)}
        onCancel={() => setFechaActualizarAhora(null)}
      >
        <Form.Group controlId="fecha-actualizar-ahora">
          <Form.Label>Fecha de corte ({parametroFechaFuente})</Form.Label>
          <Form.Control
            type="date"
            value={fechaActualizarAhora || ''}
            onChange={(e) => setFechaActualizarAhora(e.target.value)}
          />
          <Form.Text muted>
            Con esta fecha se ejecuta {estadoFuenteBD?.nombre} y queda guardada en la conexión.
            {estadoFuenteBD?.parametros?.[parametroFechaFuente]
              ? ` Última usada: ${formatearFechaISO(estadoFuenteBD.parametros[parametroFechaFuente])}.`
              : ''}
          </Form.Text>
        </Form.Group>
      </ConfirmModal>

      <ConectarFuenteBDModal
        show={mostrarConectarFuenteBD}
        onHide={() => setMostrarConectarFuenteBD(false)}
        dashboardId={dashboardId}
        dashboardNombre={dashboardInfo?.name || dashboardId}
        onConectar={conectarFuenteBD}
        onDatosBorrados={borrarDatosDashboard}
      />

      <ConfirmarClaveModal
        show={Boolean(confirmacionClave)}
        accion={confirmacionClave?.accion}
        onConfirmar={(clave) => confirmacionClave.ejecutar(clave)}
        onCancelar={() => setConfirmacionClave(null)}
      />
    </div>
  )
}
