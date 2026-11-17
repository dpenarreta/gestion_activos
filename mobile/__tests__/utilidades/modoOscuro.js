/**
 * Ayudas para probar las pantallas en modo oscuro (US-026). No es una suite
 * (`testMatch` solo toma `*.test.js`).
 */
import { act, render } from "@testing-library/react-native";
import { Appearance, StyleSheet } from "react-native";

import { ProveedorDeApariencia } from "../../src/tema/apariencia";
import { paletaClara, paletaOscura } from "../../src/tema/colores";

const CLAVE = "ilce_apariencia";

/** Los colores de la paleta clara que no existen en la oscura: si alguno se
 * ve en modo oscuro, algo quedó fijo en claro (CA-5). */
export const COLORES_SOLO_CLAROS = (() => {
  const oscuros = new Set(Object.values(paletaOscura).map((c) => c.toUpperCase()));
  return new Set(Object.values(paletaClara).map((c) => c.toUpperCase()).filter((c) => !oscuros.has(c)));
})();

/** Guarda «oscuro» en el teléfono (el doble de SecureStore) y monta `ui`
 * dentro del proveedor real, esperando a que lea lo guardado. */
export async function renderEnOscuro(ui, opciones) {
  require("expo-secure-store").__datos.set(CLAVE, "oscuro");
  const resultado = await render(<ProveedorDeApariencia>{ui}</ProveedorDeApariencia>, opciones);
  await act(async () => {});
  return resultado;
}

/** Deja el teléfono sin elección guardada y sin el modo impuesto. */
export function olvidarApariencia() {
  require("expo-secure-store").__datos.delete(CLAVE);
  try {
    Appearance.setColorScheme?.("unspecified");
  } catch {
    // Sin el módulo nativo no hay nada que quitar.
  }
}

/** Todos los colores de los estilos y de las props de color del árbol. */
export function coloresDelArbol(arbol) {
  const encontrados = [];
  const visitar = (nodo) => {
    if (!nodo || typeof nodo !== "object") return;
    if (Array.isArray(nodo)) {
      nodo.forEach(visitar);
      return;
    }
    const props = nodo.props ?? {};
    const estilo = StyleSheet.flatten(props.style) ?? {};
    for (const [clave, valor] of Object.entries(estilo)) {
      if (/color$/i.test(clave) && typeof valor === "string") encontrados.push({ clave, valor, tipo: nodo.type });
    }
    for (const clave of ["color", "placeholderTextColor", "tintColor", "progressBackgroundColor"]) {
      if (typeof props[clave] === "string") encontrados.push({ clave, valor: props[clave], tipo: nodo.type });
    }
    visitar(nodo.children);
  };
  visitar(arbol);
  return encontrados;
}

/** Los colores claros fijos que quedaron en el árbol (debe ser `[]`). */
export function coloresClarosEn(arbol) {
  return coloresDelArbol(arbol).filter(({ valor }) => COLORES_SOLO_CLAROS.has(valor.toUpperCase()));
}
