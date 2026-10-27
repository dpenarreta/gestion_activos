import { Button, Modal } from 'react-bootstrap'

/** Confirmación accesible reutilizable — evita `window.confirm` (sección 16/22). */
export default function ConfirmModal({ show, title, children, onConfirm, onCancel, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', confirmVariant = 'danger' }) {
  return (
    <Modal
      backdrop="static"
      show={show}
      onHide={onCancel}
      centered
      aria-live="assertive"
      className="modal--sobre"
      backdropClassName="modal-backdrop--sobre"
    >
      <Modal.Header closeButton closeLabel="Cerrar">
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      <Modal.Footer>
        {/* La opción segura recibe el foco: Enter no descarta ni borra nada. */}
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <Button variant="outline-secondary" onClick={onCancel} autoFocus>{cancelLabel}</Button>
        <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
      </Modal.Footer>
    </Modal>
  )
}
