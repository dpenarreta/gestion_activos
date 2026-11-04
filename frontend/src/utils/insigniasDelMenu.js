/** Con este evento una pantalla avisa al menú de que algo pendiente cambió
 * (p. ej. aceptó su rol de pagos), para que las insignias se actualicen
 * enseguida y no al minuto. */
export const EVENTO_INSIGNIAS = "mz-insignias-cambiaron";

export function avisarCambioDeInsignias() {
  window.dispatchEvent(new CustomEvent(EVENTO_INSIGNIAS));
}
