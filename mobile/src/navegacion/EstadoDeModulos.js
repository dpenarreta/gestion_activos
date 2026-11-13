import { useIsFocused } from "expo-router";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

/**
 * Lo que comparten la cabecera de los módulos y las pestañas (US-016,
 * ronda 2, 13/11/2026).
 *
 * P1 del SM-A075M: con la cabecera como `header` de cada pantalla había una
 * `CabeceraDeModulos` por pantalla montada. Las pantallas sin foco siguen en
 * el árbol nativo y expo-router 58 solo les pone `aria-hidden`
 * (`elements/getUnfocusedScreenProps.js`), sin `pointerEvents`: el toque caía
 * en la cabecera (sin desplazar) de Institucional mientras se veía la del
 * módulo activo. Ahora hay UNA sola cabecera, en el layout de `(tabs)`, fuera
 * de las pantallas.
 *
 * Esa cabecera no está dentro del navegador, así que no recibe `state` ni
 * `navigation`: se los publica la `tabBar` (que sí los recibe) con
 * `PublicarEstadoDeModulos`. Y como las pantallas ya no tienen `header`,
 * React Navigation no mide su alto: la cabecera lo mide y lo da por
 * `AlturaCabeceraDeModulosContext` (lo lee `useAlturaCabecera`).
 */
const EstadoContext = createContext(null);
const PublicarContext = createContext(() => {});
const FijarAlturaContext = createContext(() => {});
export const AlturaCabeceraDeModulosContext = createContext(0);

export function ProveedorDeModulos({ children }) {
  const [estado, setEstado] = useState(null);
  const [altura, setAltura] = useState(0);
  return (
    <PublicarContext.Provider value={setEstado}>
      <FijarAlturaContext.Provider value={setAltura}>
        <EstadoContext.Provider value={estado}>
          <AlturaCabeceraDeModulosContext.Provider value={altura}>{children}</AlturaCabeceraDeModulosContext.Provider>
        </EstadoContext.Provider>
      </FijarAlturaContext.Provider>
    </PublicarContext.Provider>
  );
}

/** `{ state, descriptors }` de las pestañas, o `null` antes del primer
 * pintado. */
export function useEstadoDeModulos() {
  return useContext(EstadoContext);
}

export function useFijarAlturaCabecera() {
  return useContext(FijarAlturaContext);
}

/** Lo pinta la `tabBar` (recibe `state` y `descriptors` de expo-router 58). */
export function PublicarEstadoDeModulos({ state, descriptors }) {
  const publicar = useContext(PublicarContext);
  const valor = useMemo(() => ({ state, descriptors }), [state, descriptors]);
  useEffect(() => {
    publicar(valor);
  }, [publicar, valor]);
  return null;
}

/**
 * El contenido de una pantalla de `(tabs)`: sin el foco no recibe toques ni
 * se lee. Las pantallas sin foco siguen montadas debajo de la activa y, en
 * Android, podían quedarse con los toques (P1 de la ronda 2).
 */
export function SoloConFoco({ children }) {
  const enfocada = useIsFocused();
  return (
    <View
      style={estilos.pantalla}
      pointerEvents={enfocada ? "auto" : "none"}
      accessibilityElementsHidden={!enfocada}
      importantForAccessibility={enfocada ? "auto" : "no-hide-descendants"}
      testID={enfocada ? "pantalla-con-foco" : "pantalla-sin-foco"}
    >
      {children}
    </View>
  );
}

const estilos = { pantalla: { flex: 1 } };
