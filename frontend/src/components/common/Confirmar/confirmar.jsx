import { createRoot } from "react-dom/client";

import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";

let pendiente = null;

/**
 * Pide confirmación antes de una acción que no tiene vuelta atrás (borrar,
 * deshabilitar, rechazar…). Se abre sola, fuera del árbol de quien la pide,
 * así cualquier pantalla la usa con una línea:
 *
 *     if (!(await confirmar({ titulo: "¿Borrar «X»?", accion: "Borrar" }))) return;
 *
 * Devuelve una promesa: `true` si se confirmó. El foco empieza en la opción
 * segura (cancelar) y Escape cancela (auditoría UX/UI, 28/10/2026). Si ya
 * hay una pregunta abierta, la nueva espera a que se responda esa.
 */
export function confirmar({
  titulo,
  mensaje = "Esta acción no se puede deshacer.",
  accion = "Confirmar",
  cancelar = "Cancelar",
  peligro = true,
}) {
  // Una pregunta a la vez: la siguiente se abre cuando se responde la actual.
  if (pendiente) {
    return pendiente.then(() =>
      confirmar({ titulo, mensaje, accion, cancelar, peligro }),
    );
  }
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  const raiz = createRoot(contenedor);
  pendiente = new Promise((resolve) => {
    const terminar = (si) => {
      pendiente = null;
      resolve(si);
      // Desmontar fuera del manejador del clic que lo pidió.
      setTimeout(() => {
        raiz.unmount();
        contenedor.remove();
      });
    };
    raiz.render(
      <ConfirmDialog
        isOpen
        title={titulo}
        message={mensaje}
        confirmLabel={accion}
        cancelLabel={cancelar}
        cancelClassName="btn-outline-secondary"
        confirmVariant={peligro ? "danger" : "primary"}
        onConfirm={() => terminar(true)}
        onCancel={() => terminar(false)}
      />,
    );
  });
  return pendiente;
}
