/**
 * Poppins, la fuente de la marca LAARCOURIER (auxiliar oficial de Mazzard,
 * Brand Book 2026; la web usa la misma: `branding/0004`). Se cargan 400, 500,
 * 600 y 700 en el layout raíz (`useFonts`), que mantiene la pantalla de
 * carga hasta que están.
 *
 * En React Native una fuente propia no elige su variante por `fontWeight`
 * (Android cae a una negrita sintética o a la del sistema): cada peso es una
 * familia. Por eso los estilos de la app se crean con `crearEstilos`, que a
 * todo estilo con `fontSize` o `fontWeight` le pone la familia del peso más
 * cercano y quita `fontWeight`. Los `Text` anidados heredan la familia.
 *
 * Si Poppins no carga, `usarFuenteDelSistema()` (lo llama el layout raíz
 * antes de pintar ninguna pantalla) quita la familia de todos los estilos y
 * les devuelve su `fontWeight`: la app sigue con la fuente del sistema y no
 * con una familia que no existe (revisión UX, ronda 2).
 *
 * No hay Poppins Italic: los estilos no usan `fontStyle: "italic"`.
 */
export const FUENTES = {
  400: "Poppins_400Regular",
  500: "Poppins_500Medium",
  600: "Poppins_600SemiBold",
  700: "Poppins_700Bold",
};

let conPoppins = true;
/** Cada estilo de texto creado, con su `fontWeight` original. */
const registrados = [];

function pesoNumerico(peso) {
  const n = peso === "bold" ? 700 : peso === "normal" || peso === undefined ? 400 : Number(peso) || 400;
  if (n >= 700) return 700;
  if (n >= 600) return 600;
  if (n >= 500) return 500;
  return 400;
}

/** La familia de Poppins para un `fontWeight` («600», 700, "bold"…), o
 * `undefined` si se usa la fuente del sistema. */
export function familia(peso) {
  return conPoppins ? FUENTES[pesoNumerico(peso)] : undefined;
}

/** Un estilo de texto con la familia que le corresponde. */
export function conFuente(estilo) {
  if (!estilo || typeof estilo !== "object" || estilo.fontFamily) return estilo;
  if (estilo.fontSize === undefined && estilo.fontWeight === undefined) return estilo;
  const { fontWeight, ...resto } = estilo;
  const nuevo = { ...resto };
  if (conPoppins) nuevo.fontFamily = familia(fontWeight);
  else if (fontWeight !== undefined) nuevo.fontWeight = fontWeight;
  registrados.push({ estilo: nuevo, fontWeight });
  return nuevo;
}

/** Los estilos de una pantalla con Poppins en cada estilo de texto. Son
 * objetos simples (lo mismo que devuelve hoy `StyleSheet.create`), para
 * poder volver a la fuente del sistema si Poppins falla. */
export function crearEstilos(estilos) {
  const resultado = {};
  for (const [nombre, estilo] of Object.entries(estilos)) resultado[nombre] = conFuente(estilo);
  return resultado;
}

/** Poppins no cargó: todos los estilos vuelven a la fuente del sistema. */
export function usarFuenteDelSistema() {
  if (!conPoppins) return;
  conPoppins = false;
  for (const { estilo, fontWeight } of registrados) {
    delete estilo.fontFamily;
    if (fontWeight !== undefined) estilo.fontWeight = fontWeight;
  }
}

/** Para las pruebas. */
export function usaPoppins() {
  return conPoppins;
}
