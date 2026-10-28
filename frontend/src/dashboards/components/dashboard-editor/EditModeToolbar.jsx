import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Spinner } from 'react-bootstrap'
import { PERMISOS, usePermisos } from '../../hooks/usePermisos'
import ConfirmModal from './ConfirmModal'
import { useUnsavedChangesOpcional } from '../../../context/UnsavedChangesContext'

export default function EditModeToolbar({
  modoEdicion, vistaPrevia, cargando, hayCambiosSinGuardar,
  onActivarEdicion, onGuardar, onCancelar, onAlternarVistaPrevia, onRestablecer,
  activarBoton = 'Editar dashboard',
  restablecerBoton = 'Restablecer diseño',
  restablecerTitulo = 'Restablecer visibilidad de componentes',
  restablecerDescripcion = 'Esta acción vuelve a mostrar cualquier componente que se haya ocultado, para todos los usuarios. No se puede deshacer (aunque queda registrada en el historial).',
}) {
  const permisos = usePermisos()
  const [confirmando, setConfirmando] = useState(null) // 'cancelar' | 'restablecer' | null

  // Auditoría UX/UI, fase 3, 28/10/2026: «Guardar cambios» no daba ninguna señal. Ahora muestra
  // «Guardando…» con un spinner mientras espera y, al terminar bien, un aviso con role="status".
  // Guardar puede terminar fuera de este botón (si el diseño está bloqueado, se confirma con la
  // contraseña en otro cuadro), así que el éxito se reconoce cuando, tras pedir guardar, el
  // dashboard sale del modo edición; «Cancelar» limpia esa marca para no confundirse con él.
  const [guardando, setGuardando] = useState(false)
  const [avisoGuardado, setAvisoGuardado] = useState('')
  const pidioGuardar = useRef(false)
  const modoEdicionAnterior = useRef(modoEdicion)
  useEffect(() => {
    if (modoEdicionAnterior.current && !modoEdicion && pidioGuardar.current) {
      setAvisoGuardado('Diseño guardado.')
    }
    if (modoEdicion) setAvisoGuardado('')
    pidioGuardar.current = pidioGuardar.current && modoEdicion
    modoEdicionAnterior.current = modoEdicion
  }, [modoEdicion])
  useEffect(() => {
    if (!avisoGuardado) return undefined
    const temporizador = setTimeout(() => setAvisoGuardado(''), 5000)
    return () => clearTimeout(temporizador)
  }, [avisoGuardado])

  // Cerrar o recargar la pestaña con cambios sin guardar pide confirmación al navegador. La app
  // usa `BrowserRouter` (no un router de datos), así que `useBlocker` no está disponible para
  // frenar la navegación interna; esto cubre al menos salir del sitio.
  const hayCambios = useRef(hayCambiosSinGuardar)
  hayCambios.current = hayCambiosSinGuardar
  useEffect(() => {
    if (!modoEdicion) return undefined
    const avisarAlSalir = (evento) => {
      if (!hayCambios.current?.()) return
      evento.preventDefault()
      evento.returnValue = ''
    }
    window.addEventListener('beforeunload', avisarAlSalir)
    return () => window.removeEventListener('beforeunload', avisarAlSalir)
  }, [modoEdicion])

  // Salir por el menú lateral o las pestañas del sistema también pregunta
  // «¿Descartar los cambios?»: el editor le dice al contexto común cómo saber si
  // hay cambios (auditoría UX/UI, fase 3).
  const cambiosSinGuardar = useUnsavedChangesOpcional()
  const registrarVerificador = cambiosSinGuardar?.registrarVerificador
  useEffect(() => {
    if (!modoEdicion || !registrarVerificador) return undefined
    return registrarVerificador(() => Boolean(hayCambios.current?.()))
  }, [modoEdicion, registrarVerificador])

  if (!permisos.tiene(PERMISOS.DASHBOARD_VIEW)) return null

  const regionAviso = (
    <span role="status" className="small text-success">
      {avisoGuardado && <><i className="bi bi-check-circle me-1" aria-hidden="true"></i>{avisoGuardado}</>}
    </span>
  )

  if (!modoEdicion) {
    if (!permisos.tiene(PERMISOS.DASHBOARD_EDIT)) return null
    return (
      <div className="d-flex flex-wrap align-items-center gap-2">
        {regionAviso}
        <Button variant="outline-primary" size="sm" onClick={onActivarEdicion}>
          {activarBoton}
        </Button>
      </div>
    )
  }

  const pedirCancelar = () => {
    pidioGuardar.current = false
    if (hayCambiosSinGuardar()) setConfirmando('cancelar')
    else onCancelar()
  }

  const guardar = async () => {
    pidioGuardar.current = true
    setGuardando(true)
    try {
      await onGuardar()
    } finally {
      setGuardando(false)
    }
  }

  // Antes había en esta barra un campo "Tu nombre (auditoría)" que el usuario tipeaba a mano y
  // viajaba al backend como `changed_by`. Se retiró: el autor del cambio se resuelve ahora del
  // usuario autenticado (`cartera/dashboard_views.py::_etiqueta_actor`), porque un nombre escrito
  // por quien guarda el layout permitía firmar el cambio con el nombre de otra persona — y era
  // esa la atribución que mostraba el historial de versiones.
  return (
    <div className="d-flex flex-wrap align-items-center gap-2" role="toolbar" aria-label="Herramientas de edición del dashboard">
      <Button size="sm" variant="outline-secondary" onClick={onAlternarVistaPrevia}>
        {vistaPrevia ? 'Volver a editar' : 'Vista previa'}
      </Button>
      {permisos.tiene(PERMISOS.DASHBOARD_CONFIGURATION_RESET) && (
        <Button size="sm" variant="outline-danger" onClick={() => setConfirmando('restablecer')} disabled={cargando}>
          {restablecerBoton}
        </Button>
      )}
      <Button size="sm" variant="outline-secondary" onClick={pedirCancelar} disabled={cargando}>
        Cancelar
      </Button>
      <Button size="sm" variant="primary" onClick={guardar} disabled={cargando || guardando}>
        {guardando ? (
          <><Spinner animation="border" size="sm" className="me-1" aria-hidden="true" />Guardando…</>
        ) : 'Guardar cambios'}
      </Button>
      {regionAviso}

      <ConfirmModal
        show={confirmando === 'cancelar'}
        title="Descartar cambios sin guardar"
        confirmLabel="Descartar cambios"
        onConfirm={() => { setConfirmando(null); onCancelar() }}
        onCancel={() => setConfirmando(null)}
      >
        Tiene cambios sin guardar. Al confirmar se restaurará la última configuración guardada.
      </ConfirmModal>

      <ConfirmModal
        show={confirmando === 'restablecer'}
        title={restablecerTitulo}
        confirmLabel="Restablecer"
        onConfirm={() => { setConfirmando(null); onRestablecer() }}
        onCancel={() => setConfirmando(null)}
      >
        <Alert variant="warning" className="mb-0">
          {restablecerDescripcion}
        </Alert>
      </ConfirmModal>
    </div>
  )
}
