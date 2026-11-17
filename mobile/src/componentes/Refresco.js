import { RefreshControl } from "react-native";

import { useApariencia } from "../tema/apariencia";

/**
 * El «tirar para actualizar» de las listas (US-026, CA-6): en oscuro, la
 * rueda en el amarillo de la marca sobre la superficie oscura (Android) y la
 * de iOS en la tinta clara; en claro, el negro de la marca sobre blanco. Se
 * usa igual que `RefreshControl` (`refreshControl={<Refresco … />}`): el
 * `ScrollView` le pasa sus props y, en Android, sus hijos.
 *
 * Los colores van SIEMPRE, en los dos modos (prueba en el teléfono,
 * 17/11/2026): si al pasar de oscuro a claro se quita `colors`, React Native
 * le manda a Android una lista vacía y `SwipeRefreshLayout.setColorSchemeColors`
 * revienta con `ArrayIndexOutOfBoundsException` (la app se cerraba al elegir
 * «Claro» con una lista en pantalla).
 */
export function Refresco(props) {
  const { colores, oscuro } = useApariencia();
  const delModo = oscuro
    ? { colors: [colores.acento], progressBackgroundColor: colores.superficie, tintColor: colores.tinta }
    : { colors: [colores.primario], progressBackgroundColor: colores.superficie, tintColor: colores.tintaSuave };
  return <RefreshControl {...delModo} {...props} />;
}
