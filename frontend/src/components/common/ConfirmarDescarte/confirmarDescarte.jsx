import { createRoot } from "react-dom/client";

import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";

export const TITULO_DESCARTE = "¿Descartar los cambios?";
export const MENSAJE_DESCARTE =
  "Los cambios que no guardó en esta ventana se perderán.";

let pendiente = null;

/**
 * Pregunta antes de cerrar una ventana con datos sin guardar (27/10/2026: con
 * Escape, la X o «Cancelar» se perdía lo escrito sin aviso). Se abre sola,
 * fuera del árbol de quien la pide, para que ninguna ventana tenga que
 * pintarla. Devuelve una promesa: `true` si se eligió descartar.
 */
export function confirmarDescarte() {
  if (pendiente) return pendiente;
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  const raiz = createRoot(contenedor);
  pendiente = new Promise((resolve) => {
    const terminar = (descartar) => {
      pendiente = null;
      resolve(descartar);
      // Desmontar fuera del manejador del clic que lo pidió.
      setTimeout(() => {
        raiz.unmount();
        contenedor.remove();
      });
    };
    raiz.render(
      <ConfirmDialog
        isOpen
        title={TITULO_DESCARTE}
        message={MENSAJE_DESCARTE}
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        cancelClassName="btn-outline-secondary"
        confirmVariant="danger"
        onConfirm={() => terminar(true)}
        onCancel={() => terminar(false)}
      />,
    );
  });
  return pendiente;
}
