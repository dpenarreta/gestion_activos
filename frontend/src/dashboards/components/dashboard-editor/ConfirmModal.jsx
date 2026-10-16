import { Button, Modal } from 'react-bootstrap'

/** Confirmación accesible reutilizable — evita `window.confirm` (sección 16/22). */
export default function ConfirmModal({ show, title, children, onConfirm, onCancel, confirmLabel = 'Confirmar', confirmVariant = 'danger' }) {
  return (
    <Modal show={show} onHide={onCancel} centered aria-live="assertive">
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel}>Cancelar</Button>
        <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
      </Modal.Footer>
    </Modal>
  )
}
