/*
 * Comparar lo que se escribe en un buscador con el texto de una fila, igual
 * en toda la intranet (búsqueda en vivo, 06/11/2026): sin distinguir tildes
 * ni mayúsculas, y cada palabra en cualquier orden. Así «jose perez» encuentra
 * a «Pérez Andrade, José» y «talento jefe» a «Jefe Nacional de Talento
 * Humano», que es lo que ya hacían el selector de personas y las listas
 * desplegables con buscador.
 */

/** Sin tildes, en minúsculas y sin espacios a los lados. */
export function normalizarBusqueda(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Las palabras de lo escrito, ya normalizadas. */
export function palabrasDeBusqueda(termino) {
  return normalizarBusqueda(termino).split(/\s+/).filter(Boolean);
}

/**
 * ¿Coincide la fila con lo escrito? Cada palabra tiene que aparecer en alguno
 * de los `valores` (o en su unión: «quito norte» encuentra una fila con la
 * ciudad «Quito» y el nombre «Bodega Norte»). Con el término vacío, todo
 * coincide.
 *
 * @param {string} termino lo que se escribió
 * @param {...unknown} valores los textos de la fila donde buscar
 */
export function coincideBusqueda(termino, ...valores) {
  const palabras = palabrasDeBusqueda(termino);
  if (palabras.length === 0) return true;
  const texto = valores.map(normalizarBusqueda).join(" ");
  return palabras.every((palabra) => texto.includes(palabra));
}
