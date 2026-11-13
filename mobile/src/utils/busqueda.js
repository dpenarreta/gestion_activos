/**
 * Las reglas de los buscadores de personas (auditoría UX, H-05): el del
 * reemplazo en una ausencia y el de «Nuevo mensaje».
 */

/** Con menos letras la lista sería toda la empresa. */
export const MINIMO_BUSQUEDA = 2;
/** Más de 8 nombres no se leen de un vistazo: se pide afinar. */
export const MAXIMO_RESULTADOS = 8;
export const TEXTO_MINIMO_BUSQUEDA = `Escriba al menos ${MINIMO_BUSQUEDA} letras del nombre.`;
export const TEXTO_HAY_MAS = "Hay más coincidencias: escriba más del nombre.";

/** Lo que se anuncia al terminar una búsqueda: «Nadie coincide con «x».»,
 * «Una persona encontrada.», «5 personas encontradas.» o, con más de 8,
 * «12 personas encontradas; se muestran 8. Hay más…». */
export function textoDeResultados(cantidad, consulta = "") {
  if (cantidad === 0) return consulta ? `Nadie coincide con «${consulta}».` : "No hay personas para elegir.";
  if (cantidad === 1) return "Una persona encontrada.";
  if (cantidad > MAXIMO_RESULTADOS) {
    return `${cantidad} personas encontradas; se muestran ${MAXIMO_RESULTADOS}. ${TEXTO_HAY_MAS}`;
  }
  return `${cantidad} personas encontradas.`;
}
