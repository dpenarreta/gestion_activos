/**
 * Texto sin mayúsculas ni tildes, para buscar «nunez» y encontrar «Núñez»
 * (la sugerencia de casos de la Mesa de ayuda y el buscador de los
 * selectores). Vivía en `soporte/sugerirCaso.js`; desde la US-019 (ronda 1,
 * QA-TECH) es común.
 *
 * Hace lo que `normalize("NFD")` más quitar las marcas, para las letras con
 * tilde, diéresis o virgulilla de los idiomas latinos.
 */
const SIN_MARCA = {
  á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ñ: "n", ç: "c", ý: "y", ÿ: "y",
};

export function normalizar(texto) {
  return (texto ?? "").toLowerCase().replace(/[àáâãäåèéêëìíîïñòóôõöùúûüçýÿ]/g, (c) => SIN_MARCA[c] ?? c);
}

