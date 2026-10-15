/**
 * Cómo se nombran y se pintan los avisos de la Matriz (§12): lo comparten la
 * pestaña Recordatorios del período y la de Configuración.
 */

/** «15 días antes», «1 día antes», «Día del vencimiento». */
export function textoDeAnticipacion(dias) {
  if (dias === 0) return "Día del vencimiento";
  return dias === 1 ? "1 día antes" : `${dias} días antes`;
}

/** La programación de cada anticipación (§12.5). */
export const SITUACION_PROGRAMADA = {
  programado: { texto: "Programado", clase: "mz-pill--neutral" },
  enviado: { texto: "Enviado", clase: "mz-pill--ok" },
  fallido: { texto: "Fallido", clase: "mz-pill--bad" },
  no_enviado: { texto: "No enviado", clase: "mz-pill--warn" },
  suspendido: { texto: "Suspendido", clase: "mz-pill--neutral" },
};

/** El estado de una notificación (§4.11). */
export const ESTADO_DE_NOTIFICACION = {
  enviado: { texto: "Enviado", clase: "mz-pill--ok" },
  fallido: { texto: "Fallido", clase: "mz-pill--bad" },
  reintentado: { texto: "Reintentado", clase: "mz-pill--neutral" },
};
