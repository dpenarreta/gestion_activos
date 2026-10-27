import { useCallback, useEffect, useRef } from "react";

import { confirmarDescarte } from "../components/common/ConfirmarDescarte/confirmarDescarte";
import { vigilarDescarte } from "./vigilarDescarte";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Contador a nivel de módulo (no por instancia): con overlays anidados el
// body debe seguir bloqueado hasta que se cierre el último.
let openModalCount = 0;
// Los overlays abiertos, del más viejo al más nuevo: Escape cierra solo el de
// arriba (27/10/2026: con la ficha abierta sobre el panel del período, un
// Escape cerraba los dos).
const pila = [];

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
 * Tab/Shift+Tab, cierre con Escape, cierre al hacer click en el backdrop
 * (solo si se pide con `closeOnBackdrop`),
 * bloqueo de scroll del body mientras está abierto, y retorno de foco al
 * elemento disparador al cerrar. Reutilizado por el sidebar móvil y por
 * cualquier modal/diálogo del panel administrativo.
 */
export function useModalA11y({
  isOpen,
  onRequestClose,
  closeOnEscape = true,
  // Un clic fuera de la ventana no la cierra: se perdía lo escrito hasta el
  // momento (27/10/2026). Solo el menú lateral del teléfono lo pide.
  closeOnBackdrop = false,
  // Con datos escritos en un formulario de la ventana, Escape, la X y
  // «Cancelar» preguntan antes de descartarlos.
  confirmarAlDescartar = true,
  triggerRef,
  guardClose,
}) {
  const panelRef = useRef(null);
  const vigilanciaRef = useRef(null);
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
    const marca = {};
    pila.push(marca);
    // Quien tenía el foco al abrir lo recupera al cerrar, aunque no se pase
    // `triggerRef`: si no, el foco caía en <body>.
    const anterior = document.activeElement;

    const panel = panelRef.current;
    // Solo lo que de verdad recibe Tab: una grilla con foco itinerante tiene
    // botones con tabindex="-1" que no cuentan (auditoría UX/UI, 27/10/2026:
    // el foco se escapaba de la ventana del calendario).
    const enfocables = () =>
      panel
        ? Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
            (el) => el.tabIndex >= 0 && !el.closest("[inert],[hidden]"),
          )
        : [];
    (enfocables()[0] || panel)?.focus();
    const vigilancia =
      confirmarAlDescartar && panel
        ? vigilarDescarte(panel, { preguntar: confirmarDescarte })
        : null;
    vigilanciaRef.current = vigilancia;

    function handleKeyDown(event) {
      if (pila[pila.length - 1] !== marca) {
        return;
      }
      if (event.key === "Escape") {
        if (!closeOnEscape) return;
        if (vigilancia?.estaSucio()) {
          confirmarDescarte().then((descartar) => {
            if (descartar) {
              vigilancia.olvidar();
              requestGuardedClose();
            }
          });
        } else {
          requestGuardedClose();
        }
        return;
      }
      // Se calculan en cada Tab: los botones que se habilitan después de abrir
      // («Importar» tras simular) también entran en el ciclo.
      const focusable = enfocables();
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
      vigilancia?.desmontar();
      const posicion = pila.indexOf(marca);
      if (posicion >= 0) pila.splice(posicion, 1);
      unlockBodyScroll();
      const destino = trigger ?? anterior;
      if (destino && destino !== document.body && document.contains(destino)) {
        destino.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleBackdropClick(event) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (closeOnBackdrop) {
      requestGuardedClose();
      return;
    }
    // La ventana no se cierra, pero responde (un rebote breve, como el de
    // Bootstrap) y el foco no se queda en <body> (auditoría UX/UI, 27/10/2026).
    const panel = panelRef.current;
    if (!panel) return;
    if (!panel.contains(document.activeElement)) panel.focus();
    panel.classList.remove("mz-modal--rebote");
    // Forzar el reflujo para que la animación vuelva a empezar.
    void panel.offsetWidth;
    panel.classList.add("mz-modal--rebote");
    panel.addEventListener(
      "animationend",
      () => panel.classList.remove("mz-modal--rebote"),
      { once: true },
    );
  }

  // Tras guardar con éxito sin cerrar la ventana: lo escrito ya no se pierde.
  const marcarGuardado = useCallback(
    () => vigilanciaRef.current?.olvidar(),
    [],
  );

  return {
    panelRef,
    handleBackdropClick,
    requestClose: requestGuardedClose,
    marcarGuardado,
  };
}
