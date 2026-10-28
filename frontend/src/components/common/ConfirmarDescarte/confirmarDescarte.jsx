import { confirmar } from "../Confirmar/confirmar";

export const TITULO_DESCARTE = "¿Descartar los cambios?";
export const MENSAJE_DESCARTE =
  "Los cambios que no guardó en esta ventana se perderán.";

/**
 * Pregunta antes de cerrar una ventana con datos sin guardar (27/10/2026: con
 * Escape, la X o «Cancelar» se perdía lo escrito sin aviso). Devuelve una
 * promesa: `true` si se eligió descartar.
 */
export function confirmarDescarte() {
  return confirmar({
    titulo: TITULO_DESCARTE,
    mensaje: MENSAJE_DESCARTE,
    accion: "Descartar",
    cancelar: "Seguir editando",
  });
}
