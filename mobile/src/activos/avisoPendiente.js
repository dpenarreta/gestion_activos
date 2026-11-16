/**
 * El resultado de un alta para la pantalla que se abre después (US-022,
 * Tanda B): tras registrar un mantenimiento o una solicitud se va a su
 * detalle, que dice «Mantenimiento registrado» y, si a alguien no le llegó
 * el correo, a quién. Viaja en memoria y no en los parámetros de la ruta: un
 * enlace profundo no puede inventar ese texto. Se toma una sola vez.
 */
const pendientes = new Map();

/** `clave`: «mantenimiento-ID» o «solicitud-ID». */
export function dejarResultado(clave, resultado) {
  if (clave && resultado) pendientes.set(clave, resultado);
}

/** Al cerrar sesión (LOPDP): nada de una cuenta pasa a la siguiente. */
export function olvidarResultados() {
  pendientes.clear();
}

/** `{texto, aviso}` o `null`, una sola vez. */
export function tomarResultado(clave) {
  const resultado = pendientes.get(clave) ?? null;
  pendientes.delete(clave);
  return resultado;
}
