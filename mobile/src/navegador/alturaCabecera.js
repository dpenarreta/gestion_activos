import { useContext } from "react";
// En el SDK 58, React Navigation va dentro de `expo-router` (no hay
// `@react-navigation/elements` instalado). `useHeaderHeight` no se exporta
// en la raíz y lanza un error fuera de una pantalla con cabecera; el contexto
// sí está en `expo-router/build/react-navigation/elements/Header/` (ruta
// permitida por los `exports` del paquete, `./build/*.js`) y se lee sin lanzar.
import { HeaderHeightContext } from "expo-router/build/react-navigation/elements/Header/HeaderHeightContext.js";

import { AlturaCabeceraDeModulosContext } from "../navegacion/EstadoDeModulos";

/** La altura de la cabecera de la pantalla, o 0 si no tiene: el
 * `keyboardVerticalOffset` de un `KeyboardAvoidingView` (revisión UX, M-1).
 * En las pantallas de los módulos (US-016, ronda 2) la cabecera no es de
 * React Navigation: es la de los módulos, que mide su alto. */
export function useAlturaCabecera() {
  const deLaPantalla = useContext(HeaderHeightContext) ?? 0;
  const deLosModulos = useContext(AlturaCabeceraDeModulosContext);
  return Math.max(deLaPantalla, deLosModulos);
}
