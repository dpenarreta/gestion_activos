import { useRef } from "react";

import { useModalA11y } from "../../../hooks/useModalA11y";
import { Button } from "../Button/Button";
import "./ConfirmDialog.css";

/**
 * Modal de confirmación controlado (sin lógica de negocio propia): el
 * llamador decide qué pasa al confirmar/cancelar. Implementación
 * autocontenida sobre `useModalA11y` (foco/Escape/backdrop/scroll-lock),
 * sin depender de un sistema de modal compuesto separado.
 */
export function ConfirmDialog({ isOpen, title, message, isLoading, onConfirm, onCancel }) {
  const triggerRef = useRef(null);
  const { panelRef, handleBackdropClick, requestClose } = useModalA11y({
    isOpen,
    onRequestClose: onCancel,
    triggerRef,
  });

  if (!isOpen) {
    return null;
  }

  return (
    // El cierre por click en el backdrop es un atajo solo de mouse — el
    // equivalente accesible por teclado es Escape (ver useModalA11y) y el
    // botón "Cancelar" explícito más abajo.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="confirm-dialog__backdrop" onClick={handleBackdropClick}>
      <div
        ref={panelRef}
        className="confirm-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
      >
        <div className="confirm-dialog__header">
          <h5 id="confirm-dialog-title" className="mb-0">
            {title}
          </h5>
        </div>
        <div className="confirm-dialog__body">
          <p className="mb-0">{message}</p>
        </div>
        <div className="confirm-dialog__footer">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => requestClose()}
          >
            Cancelar
          </button>
          <Button variant="primary" isLoading={isLoading} onClick={onConfirm}>
            Confirmar
          </Button>
        </div>
      </div>
    </div>
  );
}
