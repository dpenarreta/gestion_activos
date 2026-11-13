/**
 * Un aviso para la pantalla a la que se vuelve (US-014, CA-15): tras escalar
 * o reasignar un ticket que deja de verse, la ficha vuelve a la bandeja y
 * esta dice «Ticket escalado; ya no está en su bandeja». `router.back()` no
 * lleva parámetros, así que el texto espera aquí hasta que la Mesa lo toma.
 */
let pendiente = null;

export function dejarAviso(texto) {
  pendiente = texto || null;
}

/** El aviso, una sola vez. */
export function tomarAviso() {
  const texto = pendiente;
  pendiente = null;
  return texto;
}
