import { useEffect, useState } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import * as dashboardLayoutService from '../../services/dashboardLayoutService'

const SIN_FUENTE = ''
const SIN_FRECUENCIA = ''

// Mensaje fijo para cualquier falla de conexión — a propósito NO se muestra el mensaje técnico
// que devuelve el backend (podría exponer detalles internos de la base externa); un mismo mensaje
// genérico, sin importar la causa real (vista inexistente, credenciales, servidor caído), dirige
// siempre al mismo canal de soporte.
const MENSAJE_ERROR_CONEXION =
  'Error de conexión: No se encontró la vista seleccionada. Por favor, comuníquese con el departamento de TI.'

// Mismo criterio que `backend/cartera/services/db_source.py::_PATRON_NOMBRE_FUENTE` — validación
// de mejor esfuerzo en el cliente para no hacer un viaje al servidor por un typo obvio (espacios,
// punto y coma); el backend igual la vuelve a aplicar, es la barrera real.
const PATRON_NOMBRE_FUENTE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/

// Único parámetro que aceptan hoy los procedimientos conectables (a diferencia de una lista
// arbitraria nombre/valor, el backend sigue aceptando cualquier dict de parámetros —
// `db_source.py::leer_fuente` — acá simplemente no se ofrece la UI para agregar un segundo). Su
// NOMBRE es editable (campo "Nombre del parámetro" más abajo) — vacío usa este valor por defecto,
// el nombre histórico antes de que ese campo existiera.
const NOMBRE_PARAMETRO_POR_DEFECTO = 'FechaCorte'

// Mismo criterio que `backend/cartera/services/db_source.py::_PATRON_NOMBRE_PARAMETRO` —
// validación de mejor esfuerzo en el cliente; el backend igual la vuelve a aplicar.
const PATRON_NOMBRE_PARAMETRO = /^[A-Za-z_][A-Za-z0-9_]*$/

// Espejo de `backend/cartera/models.py::Dashboard.FuenteBDFechaFormato` — cómo se reescribe el
// valor de FechaCorte (el `<input type="date">` de abajo siempre entrega AAAA-MM-DD) recién al
// armar la consulta contra la base externa; nunca cambia lo que queda guardado acá. `'YYYY-MM-DD'`
// (el default del backend) reproduce el comportamiento de siempre.
const FORMATO_FECHA_POR_DEFECTO = 'YYYY-MM-DD'
const OPCIONES_FORMATO_FECHA = [
  { valor: 'YYYY-MM-DD', etiqueta: 'AAAA-MM-DD (2026-07-31)' },
  { valor: 'DD/MM/YYYY', etiqueta: 'DD/MM/AAAA (31/07/2026)' },
  { valor: 'MM/DD/YYYY', etiqueta: 'MM/DD/AAAA (07/31/2026)' },
  { valor: 'YYYY-MM-DD HH:mm:ss', etiqueta: 'AAAA-MM-DD HH:mm:ss (2026-07-31 00:00:00)' },
]

/**
 * TODO el flujo de "Conectar vista de base de datos" vive en este único modal — no hay un botón
 * separado de "configurar" la fuente: cada vez que se hace clic en "Conectar vista de base de
 * datos" (`DashboardAreaPage.jsx`), primero se pide/confirma acá qué vista o stored procedure de
 * la conexión externa "por defecto" (`EXTERNAL_DB_*`, un único servidor para toda la app) y con
 * qué parámetros (ej. una fecha de corte, que cambia seguido — por eso se re-confirma cada vez en
 * vez de quedar oculta en una pantalla de configuración aparte) — recién al confirmar acá arranca
 * la conexión real y, si sale bien, el asistente de columnas (`RenameColumnsStep`/
 * `TemplateMappingStep`, igual que si fuera un Excel). Precarga con lo último guardado para este
 * dashboard/pestaña (cada pestaña es un `Dashboard` independiente), así en la práctica alcanza con
 * revisar/tocar "Guardar y conectar" salvo que algo cambió (típicamente la fecha de corte).
 *
 * Si la conexión en sí falla (`onConectar` devuelve `{ok: false}` — el guardado de la
 * configuración salió bien, pero `db_source.leer_fuente` no pudo leer la vista/procedimiento), el
 * modal NO se cierra: se reemplaza por un mensaje fijo (`MENSAJE_ERROR_CONEXION`, nunca el detalle
 * técnico) con un único botón "Aceptar" — recién ahí, al confirmarlo, se cierra y vuelve a la
 * vista normal del dashboard. El usuario nunca pierde de vista que estaba configurando la
 * conexión hasta que decide seguir.
 *
 * "Actualización automática" (solo con tipo/nombre configurados) activa
 * `services/fuente_bd_scheduler.py` sin intervención humana — únicamente dos frecuencias
 * (semanal, siempre domingo; mensual, el mismo día del mes en que se activó), nunca en día hábil.
 */
export default function ConectarFuenteBDModal({ show, onHide, dashboardId, dashboardNombre, onConectar, onDatosBorrados }) {
  const [tipo, setTipo] = useState(SIN_FUENTE)
  const [nombre, setNombre] = useState('')
  const [nombreParametro, setNombreParametro] = useState('')
  const [fechaCorte, setFechaCorte] = useState('')
  const [fechaFormato, setFechaFormato] = useState(FORMATO_FECHA_POR_DEFECTO)
  const [frecuencia, setFrecuencia] = useState(SIN_FRECUENCIA)
  // "Borrar todos los datos" (Excel cargado + conexión a BD + Zona Personal, ver
  // `services/dashboards.py::borrar_datos_dashboard`) reemplaza el cuerpo del modal por una
  // confirmación de nombre — mismo patrón que `DashboardsListPage.jsx::ModalEliminarDashboard`,
  // porque es igual de irreversible (a diferencia de "Restablecer diseño", que solo cambia
  // visibilidad). `confirmandoBorrado` es independiente de `errorConexion`: nunca se muestran a
  // la vez, cada uno reemplaza el cuerpo entero del modal por su propia vista.
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)
  const [confirmacionBorrado, setConfirmacionBorrado] = useState('')
  const [borrando, setBorrando] = useState(false)
  const [errorBorrado, setErrorBorrado] = useState('')
  // Día-del-mes YA anclado (`Dashboard.fuente_bd_fecha_configuracion`) si la frecuencia cargada ya
  // era 'mensual' — para mostrar el día real en que corre en vez de asumir "hoy", que solo es
  // correcto si recién se está activando ahora (ver helper text más abajo).
  const [diaMensualAnclado, setDiaMensualAnclado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [conectando, setConectando] = useState(false)
  const [error, setError] = useState('')
  const [errorConexion, setErrorConexion] = useState('')

  useEffect(() => {
    if (!show) return undefined
    let cancelado = false
    setCargando(true)
    setError('')
    setErrorConexion('')
    setConfirmandoBorrado(false)
    setConfirmacionBorrado('')
    setErrorBorrado('')
    dashboardLayoutService.obtenerFuenteBD(dashboardId)
      .then((data) => {
        if (cancelado) return
        setTipo(data.tipo || SIN_FUENTE)
        setNombre(data.nombre || '')
        // El nombre del parámetro guardado es la (única) clave de `parametros` — sin uno
        // configurado explícitamente, esa clave ya es `NOMBRE_PARAMETRO_POR_DEFECTO` (lo que
        // manda `conectar` más abajo cuando el campo queda vacío), así que el campo se deja en
        // blanco en vez de mostrar "FechaCorte" tal cual: en blanco significa "usa el default".
        const claveParametro = Object.keys(data.parametros || {})[0] || ''
        setNombreParametro(claveParametro && claveParametro !== NOMBRE_PARAMETRO_POR_DEFECTO ? claveParametro : '')
        setFechaCorte((claveParametro && data.parametros?.[claveParametro]) || '')
        setFechaFormato(data.fecha_formato || FORMATO_FECHA_POR_DEFECTO)
        setFrecuencia(data.frecuencia_actualizacion || SIN_FRECUENCIA)
        setDiaMensualAnclado(data.dia_configuracion_mensual ?? null)
      })
      .catch(() => { if (!cancelado) setError('No se pudo cargar la configuración actual.') })
      .finally(() => { if (!cancelado) setCargando(false) })
    return () => { cancelado = true }
  }, [show, dashboardId])

  const nombreValido = tipo !== SIN_FUENTE && PATRON_NOMBRE_FUENTE.test(nombre.trim())
  const nombreParametroFinal = nombreParametro.trim() || NOMBRE_PARAMETRO_POR_DEFECTO
  const nombreParametroValido = !nombreParametro.trim() || PATRON_NOMBRE_PARAMETRO.test(nombreParametro.trim())

  // Guarda la configuración (tipo/nombre/parámetros) y, si sale bien, dispara la conexión real
  // (`onConectar`, implementado por `DashboardAreaPage.jsx`: `builder.conectarFuenteBD()` + revela
  // el asistente si sale bien). `onConectar` devuelve `{ok}`: con `ok:true` se cierra el modal como
  // antes; con `ok:false` el modal NO se cierra todavía, pasa a mostrar `errorConexion` (ver abajo)
  // — recién "Aceptar" ahí cierra. El error de acá (`error`, distinto de `errorConexion`) es solo
  // el de GUARDAR la configuración en sí (nombre/parámetro inválido, sin permiso).
  const conectar = async (e) => {
    e.preventDefault()
    setConectando(true)
    setError('')
    try {
      await dashboardLayoutService.actualizarFuenteBD(dashboardId, {
        tipo, nombre: nombre.trim(),
        parametros: tipo === 'procedimiento' && fechaCorte ? { [nombreParametroFinal]: fechaCorte } : {},
        fechaFormato,
        frecuenciaActualizacion: frecuencia,
      })
      const resultado = await onConectar()
      if (resultado?.ok) {
        onHide()
      } else {
        setErrorConexion(MENSAJE_ERROR_CONEXION)
      }
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo guardar la configuración.')
    } finally {
      setConectando(false)
    }
  }

  const aceptarErrorConexion = () => {
    setErrorConexion('')
    onHide()
  }

  const coincideConfirmacionBorrado = confirmacionBorrado === dashboardNombre

  const cancelarBorrado = () => {
    setConfirmandoBorrado(false)
    setConfirmacionBorrado('')
    setErrorBorrado('')
  }

  const borrarDatos = async () => {
    setBorrando(true)
    setErrorBorrado('')
    try {
      await onDatosBorrados(confirmacionBorrado)
      onHide()
    } catch (err) {
      setErrorBorrado(err.response?.data?.mensaje || 'No se pudieron borrar los datos.')
    } finally {
      setBorrando(false)
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Conectar vista de base de datos</Modal.Title>
      </Modal.Header>
      {errorConexion ? (
        <>
          <Modal.Body>
            <span className="d-block text-danger" role="alert">{errorConexion}</span>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={aceptarErrorConexion}>Aceptar</Button>
          </Modal.Footer>
        </>
      ) : confirmandoBorrado ? (
        <>
          <Modal.Body>
            {errorBorrado && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem' }}>{errorBorrado}</Alert>}
            <p className="mb-2">
              Esta acción borra el archivo cargado, el histórico de cargas, la conexión a base de
              datos configurada y los componentes de Zona Personal de este dashboard/pestaña — y lo
              deja como recién creado, con datos de ejemplo. No se puede deshacer.
            </p>
            <p className="mb-2">Para confirmar, escribí exactamente el nombre del dashboard:</p>
            <span className="fw-bold d-block mb-2">{dashboardNombre}</span>
            <Form.Control
              value={confirmacionBorrado}
              onChange={(e) => setConfirmacionBorrado(e.target.value)}
              disabled={borrando}
              autoFocus
              aria-label="Confirmar nombre del dashboard"
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={cancelarBorrado} disabled={borrando} type="button">Cancelar</Button>
            <Button variant="danger" disabled={!coincideConfirmacionBorrado || borrando} onClick={borrarDatos}>
              {borrando ? <Spinner size="sm" animation="border" className="me-2" /> : null}
              Borrar todo
            </Button>
          </Modal.Footer>
        </>
      ) : (
        <Form onSubmit={conectar}>
          <Modal.Body>
            {cargando ? (
              <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>
            ) : (
              <>
                {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem' }}>{error}</Alert>}
                <p className="chart-panel__subtitle">
                  Elegí qué vista o procedimiento almacenado de la base de datos externa trae los
                  datos de este dashboard/pestaña. Al confirmar, se conecta y pasa directo al
                  asistente de columnas, igual que con un archivo Excel.
                </p>
                <Form.Group className="mb-3" controlId="fuente-bd-tipo">
                  <Form.Label>Tipo de fuente</Form.Label>
                  <Form.Select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={conectando}>
                    <option value={SIN_FUENTE}>Elegí un tipo…</option>
                    <option value="vista">Vista</option>
                    <option value="procedimiento">Procedimiento almacenado</option>
                  </Form.Select>
                </Form.Group>
                {tipo !== SIN_FUENTE && (
                  <Form.Group controlId="fuente-bd-nombre">
                    <Form.Label>Nombre {tipo === 'vista' ? 'de la vista' : 'del procedimiento'}</Form.Label>
                    <Form.Control
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      placeholder="Ej. dbo.sp_Reporte_Seguimiento_Cartera"
                      disabled={conectando}
                      isInvalid={nombre.trim().length > 0 && !nombreValido}
                      autoFocus
                    />
                    <Form.Control.Feedback type="invalid">
                      Solo letras, números y guion bajo, con un punto opcional para el esquema (ej.
                      "dbo.mi_vista").
                    </Form.Control.Feedback>
                  </Form.Group>
                )}
                {tipo !== SIN_FUENTE && (
                  <Form.Group className="mb-3" controlId="fuente-bd-frecuencia">
                    <Form.Label>Actualización automática</Form.Label>
                    <Form.Select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} disabled={conectando}>
                      <option value={SIN_FRECUENCIA}>Manual (solo al hacer clic en "Conectar")</option>
                      <option value="semanal">Semanal — todos los domingos</option>
                      <option value="mensual">Mensual — mismo día del mes</option>
                    </Form.Select>
                    <Form.Text>
                      {frecuencia === SIN_FRECUENCIA && 'Sin automatizar: este dashboard solo se actualiza cuando alguien conecta a mano.'}
                      {frecuencia === 'semanal' && 'Se reconecta sola cada domingo, sin intervención — nunca en día hábil, para no saturar la base de datos.'}
                      {frecuencia === 'mensual' && (
                        diaMensualAnclado
                          ? `Se reconecta sola el día ${diaMensualAnclado} de cada mes, sin intervención.`
                          : `Se reconecta sola el día ${new Date().getDate()} de cada mes (hoy), a partir de ahora, sin intervención.`
                      )}
                    </Form.Text>
                  </Form.Group>
                )}
                {tipo === 'procedimiento' && (
                  <Form.Group className="mb-2" controlId="fuente-bd-fecha-corte">
                    <Form.Label className="mb-1">Parámetro del procedimiento (opcional)</Form.Label>
                    <p className="chart-panel__subtitle mb-2" style={{ fontSize: '0.8rem' }}>
                      Si el procedimiento exige una fecha de corte, seleccionala acá. Se envía como
                      un único parámetro con nombre y formato configurables — ambos quedan guardados
                      como punto de partida para la próxima vez, pero conviene revisar la fecha en
                      cada conexión.
                    </p>
                    <Form.Label className="mb-1" style={{ fontSize: '0.85rem' }}>Nombre del parámetro (opcional)</Form.Label>
                    <Form.Control
                      className="mb-1"
                      value={nombreParametro}
                      onChange={(e) => setNombreParametro(e.target.value)}
                      placeholder={NOMBRE_PARAMETRO_POR_DEFECTO}
                      disabled={conectando}
                      isInvalid={nombreParametro.trim().length > 0 && !nombreParametroValido}
                      aria-label="Nombre del parámetro"
                    />
                    <Form.Control.Feedback type="invalid">
                      Solo letras, números y guion bajo, sin espacios ni el "@" (se agrega solo).
                    </Form.Control.Feedback>
                    <Form.Text className="d-block mb-2" style={{ fontSize: '0.72rem' }}>
                      Si se completa, se usa tal cual; en blanco se envía como "{NOMBRE_PARAMETRO_POR_DEFECTO}".
                    </Form.Text>
                    <Form.Control
                      type="date"
                      value={fechaCorte}
                      onChange={(e) => setFechaCorte(e.target.value)}
                      disabled={conectando}
                      aria-label={nombreParametroFinal}
                    />
                    <Form.Label className="mb-1 mt-2">Formato de envío</Form.Label>
                    <Form.Select
                      size="sm"
                      value={fechaFormato}
                      onChange={(e) => setFechaFormato(e.target.value)}
                      disabled={conectando}
                      aria-label="Formato de envío de FechaCorte"
                    >
                      {OPCIONES_FORMATO_FECHA.map((opcion) => (
                        <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>
                      ))}
                    </Form.Select>
                    <Form.Text style={{ fontSize: '0.72rem' }}>
                      Cómo se le envía la fecha al procedimiento — cambialo solo si el procedimiento
                      espera el parámetro en un formato de texto distinto al ISO.
                    </Form.Text>
                  </Form.Group>
                )}
              </>
            )}
          </Modal.Body>
          <Modal.Footer>
            {onDatosBorrados && (
              <Button
                variant="outline-danger"
                size="sm"
                className="me-auto"
                onClick={() => setConfirmandoBorrado(true)}
                disabled={cargando || conectando}
                type="button"
              >
                Borrar todos los datos
              </Button>
            )}
            <Button variant="outline-secondary" onClick={onHide} disabled={conectando} type="button">Cancelar</Button>
            <Button variant="primary" type="submit" disabled={cargando || conectando || !nombreValido || !nombreParametroValido}>
              {conectando ? <Spinner size="sm" animation="border" className="me-2" /> : null}
              Conectar
            </Button>
          </Modal.Footer>
        </Form>
      )}
    </Modal>
  )
}
