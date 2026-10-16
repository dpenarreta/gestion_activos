import { useState } from 'react'
import { Alert, Button } from 'react-bootstrap'
import { PERMISOS, usePermisos } from '../../hooks/usePermisos'
import ConfirmModal from './ConfirmModal'

export default function EditModeToolbar({
  modoEdicion, vistaPrevia, cargando, hayCambiosSinGuardar,
  onActivarEdicion, onGuardar, onCancelar, onAlternarVistaPrevia, onRestablecer,
  activarBoton = 'Editar dashboard',
  restablecerBoton = 'Restablecer diseño',
  restablecerTitulo = 'Restablecer visibilidad de componentes',
  restablecerDescripcion = 'Esta acción vuelve a mostrar cualquier componente que hayas ocultado, para todos los usuarios. No se puede deshacer (aunque queda registrada en el historial).',
}) {
  const permisos = usePermisos()
  const [confirmando, setConfirmando] = useState(null) // 'cancelar' | 'restablecer' | null

  if (!permisos.tiene(PERMISOS.DASHBOARD_VIEW)) return null

  if (!modoEdicion) {
    if (!permisos.tiene(PERMISOS.DASHBOARD_EDIT)) return null
    return (
      <Button variant="outline-primary" size="sm" onClick={onActivarEdicion}>
        {activarBoton}
      </Button>
    )
  }

  const pedirCancelar = () => {
    if (hayCambiosSinGuardar()) setConfirmando('cancelar')
    else onCancelar()
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
      <Button size="sm" variant="primary" onClick={onGuardar} disabled={cargando}>
        Guardar cambios
      </Button>

      <ConfirmModal
        show={confirmando === 'cancelar'}
        title="Descartar cambios sin guardar"
        confirmLabel="Descartar cambios"
        onConfirm={() => { setConfirmando(null); onCancelar() }}
        onCancel={() => setConfirmando(null)}
      >
        Tienes cambios sin guardar. Al confirmar se restaurará la última configuración guardada.
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
