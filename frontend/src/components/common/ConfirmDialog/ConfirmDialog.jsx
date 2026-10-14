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
export function ConfirmDialog({
  isOpen,
  title,
  message,
  isLoading,
  onConfirm,
  onCancel,
  confirmLabel = "Confirmar",
  // `danger` para lo que no tiene vuelta atrás (borrar): el botón rojo es lo
  // último que se ve antes de confirmar, y un azul neutro lo disimularía.
  confirmVariant = "primary",
}) {
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
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="mz-modal mz-modal--confirmar"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="confirm-dialog-title">{title}</h3>
        </div>
        <div className="mz-panel-body">
          <p className="mb-0">{message}</p>
        </div>
        <div className="mz-panel-foot">
          <button
            type="button"
            className="btn btn-cancelar btn-sm"
            onClick={() => requestClose()}
          >
            Cancelar
          </button>
          <Button
            variant={confirmVariant}
            isLoading={isLoading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
