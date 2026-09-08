import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Contador a nivel de módulo (no por instancia): con overlays anidados el
// body debe seguir bloqueado hasta que se cierre el último.
let openModalCount = 0;

function lockBodyScroll() {
  openModalCount += 1;
  document.body.classList.add("modal-a11y-open");
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    document.body.classList.remove("modal-a11y-open");
  }
}

/**
 * Accesibilidad genérica de overlay: foco inicial dentro del panel, trap de
 * Tab/Shift+Tab, cierre con Escape, cierre al hacer click en el backdrop,
 * bloqueo de scroll del body mientras está abierto, y retorno de foco al
 * elemento disparador al cerrar. Reutilizado por el sidebar móvil y por
 * cualquier modal/diálogo del panel administrativo.
 */
export function useModalA11y({
  isOpen,
  onRequestClose,
  closeOnEscape = true,
  closeOnBackdrop = true,
  triggerRef,
  guardClose,
}) {
  const panelRef = useRef(null);
  const guardCloseRef = useRef(guardClose);
  guardCloseRef.current = guardClose;

  const requestGuardedClose = useCallback(() => {
    if (guardCloseRef.current && guardCloseRef.current() === false) {
      return;
    }
    onRequestClose();
  }, [onRequestClose]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    lockBodyScroll();

    const panel = panelRef.current;
    const focusable = panel ? Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)) : [];
    (focusable[0] || panel)?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (closeOnEscape) {
          requestGuardedClose();
        }
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    const trigger = triggerRef?.current;
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleBackdropClick(event) {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      requestGuardedClose();
    }
  }

  return { panelRef, handleBackdropClick, requestClose: requestGuardedClose };
}
