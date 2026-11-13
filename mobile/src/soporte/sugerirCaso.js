/*
 * Sugerir la categoría y el caso con las palabras de la descripción: la misma
 * lógica que la web (`frontend/src/pages/Soporte/Publico/sugerirCaso.js`,
 * auditoría UX/UI del 30/10/2026), portada a la app en la US-014
 * (13/11/2026). Se describe primero y el sistema propone; la persona elige o
 * cambia la sugerencia.
 *
 * Es una coincidencia simple de raíces de palabras (las primeras cinco
 * letras, sin tildes) entre la descripción y el nombre del caso y de su
 * categoría: pesa más coincidir con el caso.
 *
 * Única diferencia con la web: no usa `String.prototype.normalize`, que
 * Hermes no siempre trae; las tildes se quitan con una tabla (el resultado es
 * el mismo: «Caída» → «caida», «mañana» → «manana»). Si la web cambia esta
 * lógica, hay que sincronizarla aquí (US-014, sección 5).
 */

const VACIAS = new Set([
  "para",
  "como",
  "esta",
  "este",
  "esto",
  "estoy",
  "desde",
  "tengo",
  "tiene",
  "porque",
  "cuando",
  "puedo",
  "puede",
  "pero",
  "sobre",
  "hace",
  "hasta",
  "todo",
  "todos",
  "nada",
  "favor",
  "ayuda",
  "problema",
  "problemas",
  "buenos",
  "buenas",
  "dias",
  "tardes",
  "gracias",
  "mañana",
  "manana",
  "cual",
  "donde",
  "algo",
  "otra",
  "otro",
  "mismo",
  "solo",
  "sale",
]);

const CRITICO = { baja: 1, media: 2, alta: 3, critica: 4 };

/** Lo que hace `normalize("NFD")` + quitar las marcas, para las letras con
 * tilde, diéresis o virgulilla de los idiomas latinos. */
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

/** Las raíces (cinco letras) de las palabras con significado. */
export function raices(texto) {
  return new Set(
    normalizar(texto)
      .split(/[^a-z0-9ñ]+/)
      .filter((p) => p.length >= 4 && !VACIAS.has(p))
      .map((p) => p.slice(0, 5)),
  );
}

/**
 * Hasta `cuantos` casos que se parecen a la descripción, el más parecido
 * primero: `[{ categoria, caso }]`. Vacío si la descripción es muy corta o
 * nada coincide.
 */
export function sugerirCasos(descripcion, categorias, cuantos = 3) {
  const buscadas = raices(descripcion);
  if (buscadas.size === 0) return [];
  const resultados = [];
  for (const categoria of categorias ?? []) {
    const deLaCategoria = raices(`${categoria.nombre} ${categoria.descripcion ?? ""}`);
    for (const caso of categoria.casos ?? []) {
      const delCaso = raices(caso.nombre);
      let delNombre = 0;
      let puntos = 0;
      for (const raiz of buscadas) {
        if (delCaso.has(raiz)) {
          puntos += 2;
          delNombre += 1;
        } else if (deLaCategoria.has(raiz)) puntos += 1;
      }
      // Solo si coincide con el caso mismo: con la categoría sola se
      // proponían casos al azar, a veces el más crítico.
      if (delNombre > 0) resultados.push({ categoria, caso, puntos });
    }
  }
  // Entre iguales, primero el menos crítico: sugerir «Caída general» a quien
  // no puede enviar un correo inflaba la prioridad.
  return resultados
    .sort((a, b) => b.puntos - a.puntos || (CRITICO[a.caso.prioridad] ?? 0) - (CRITICO[b.caso.prioridad] ?? 0))
    .slice(0, cuantos)
    .map(({ categoria, caso }) => ({ categoria, caso }));
}

/** Con menos letras no se sugiere nada (como la web). */
export const MINIMO_PARA_SUGERIR = 12;
