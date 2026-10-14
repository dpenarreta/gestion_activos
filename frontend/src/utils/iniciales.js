/**
 * Las iniciales de un nombre, para el glifo de la marca y los avatares de la
 * identidad base: «Gestión de Activos» → «GA», «Ana María Pérez» → «AM».
 *
 * Se saltan las palabras cortas en minúscula («de», «la», «y»): con ellas,
 * «Gestión de Activos» daría «GD», que no dice nada.
 */
export function iniciales(texto) {
  const valor = String(texto || "").trim();
  const palabras = valor
    .split(/\s+/)
    .filter((palabra) => palabra.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(palabra));
  const letras = palabras.map((palabra) => palabra[0]).join("");
  return (letras || valor[0] || "?").slice(0, 2).toUpperCase();
}
