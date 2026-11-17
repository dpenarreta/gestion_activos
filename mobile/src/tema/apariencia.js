import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";

import { almacen } from "../api/almacen";
import { fijarPaletaActiva, paletaClara, paletaOscura } from "./colores";
import { crearControles } from "./controles";

/**
 * Modo claro y modo oscuro de la app (US-026, 17/11/2026). Como en la web
 * (`AppearanceContext.jsx`): Claro, Oscuro o Sistema, y por defecto Sistema,
 * que sigue al teléfono y cambia en vivo cuando el teléfono cambia
 * (`useColorScheme`). La elección se guarda en el teléfono (`almacen`).
 *
 * Las pantallas leen los colores con `useColores()` y crean sus estilos con
 * `useEstilos(fabrica)`: la fábrica recibe `(colores, CONTROLES)` y se
 * ejecuta una sola vez por modo (se guarda en memoria), así que cambiar de
 * modo no recrea los estilos en cada render.
 */

/** Las tres opciones, en el orden del menú, con su ícono: sol, luna y
 * automático. */
export const OPCIONES_DE_APARIENCIA = [
  { id: "claro", texto: "Claro", icono: "white-balance-sunny" },
  { id: "oscuro", texto: "Oscuro", icono: "weather-night" },
  { id: "sistema", texto: "Sistema", icono: "brightness-auto" },
];

export const PREFERENCIA_POR_DEFECTO = "sistema";

export function esPreferenciaValida(valor) {
  return OPCIONES_DE_APARIENCIA.some((o) => o.id === valor);
}

export function opcionDeApariencia(preferencia) {
  return OPCIONES_DE_APARIENCIA.find((o) => o.id === preferencia) ?? OPCIONES_DE_APARIENCIA[2];
}

/** El modo que se ve: el elegido o, con Sistema, el del teléfono. */
export function esquemaDe(preferencia, esquemaDelTelefono) {
  if (preferencia === "claro" || preferencia === "oscuro") return preferencia;
  return esquemaDelTelefono === "dark" ? "oscuro" : "claro";
}

const PALETAS = { claro: paletaClara, oscuro: paletaOscura };
const CONTROLES_POR_ESQUEMA = { claro: crearControles(paletaClara), oscuro: crearControles(paletaOscura) };

function valorDe(preferencia, esquema, elegir, lista) {
  return {
    preferencia,
    esquema,
    oscuro: esquema === "oscuro",
    colores: PALETAS[esquema],
    controles: CONTROLES_POR_ESQUEMA[esquema],
    elegir,
    lista,
  };
}

// Sin proveedor (las pruebas de cada pantalla, que no lo montan): la clara,
// como hasta ahora.
const AparienciaContext = createContext(valorDe(PREFERENCIA_POR_DEFECTO, "claro", () => {}, true));

/**
 * Lo nativo sigue el modo elegido (CA-6): los `Alert`, los selectores de fecha
 * de Android y el teclado. Con Sistema se quita la imposición.
 */
function fijarEsquemaNativo(preferencia) {
  try {
    Appearance.setColorScheme?.(
      preferencia === "oscuro" ? "dark" : preferencia === "claro" ? "light" : "unspecified",
    );
  } catch {
    // Si la plataforma no lo permite, lo propio de la app igual cambia.
  }
}

/**
 * El fondo raíz de la app (lo que se ve detrás de las pantallas y de la barra
 * de navegación de Android mientras no hay nada pintado encima), en el color
 * de fondo del modo (US-026, ronda QA).
 */
function fijarFondoRaiz(color) {
  try {
    SystemUI.setBackgroundColorAsync(color)?.catch?.(() => {});
  } catch {
    // Sin el módulo nativo (o en una plataforma que no lo permite), nada.
  }
}

export function ProveedorDeApariencia({ children }) {
  const esquemaDelTelefono = useColorScheme();
  const [preferencia, setPreferencia] = useState(PREFERENCIA_POR_DEFECTO);
  const [lista, setLista] = useState(false);

  useEffect(() => {
    let vigente = true;
    almacen
      .leerApariencia()
      .then((guardada) => {
        if (vigente && esPreferenciaValida(guardada)) setPreferencia(guardada);
      })
      .catch(() => {
        // Sin lo guardado, Sistema.
      })
      .finally(() => {
        if (vigente) setLista(true);
      });
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => {
    fijarEsquemaNativo(preferencia);
  }, [preferencia]);

  const elegir = useCallback((nueva) => {
    if (!esPreferenciaValida(nueva)) return;
    setPreferencia(nueva);
    almacen.guardarApariencia(nueva).catch(() => {
      // No se pudo guardar: se ve igual hasta cerrar la app.
    });
  }, []);

  const esquema = esquemaDe(preferencia, esquemaDelTelefono);
  useEffect(() => {
    fijarFondoRaiz(PALETAS[esquema].fondo);
  }, [esquema]);
  // Antes de pintar a los hijos: los tonos de estado (`paletaActiva`) ya
  // salen en el modo nuevo.
  fijarPaletaActiva(PALETAS[esquema]);
  useEffect(() => () => fijarPaletaActiva(paletaClara), []);

  const valor = useMemo(() => valorDe(preferencia, esquema, elegir, lista), [preferencia, esquema, elegir, lista]);
  return <AparienciaContext.Provider value={valor}>{children}</AparienciaContext.Provider>;
}

/** `{ preferencia, esquema, oscuro, colores, controles, elegir, lista }`. */
export function useApariencia() {
  return useContext(AparienciaContext);
}

/** La paleta del modo que se ve. */
export function useColores() {
  return useContext(AparienciaContext).colores;
}

/** Los estilos de los controles (`tema/controles.js`) del modo que se ve. */
export function useControles() {
  return useContext(AparienciaContext).controles;
}

const estilosEnMemoria = new WeakMap();

/**
 * Los estilos de una pantalla en el modo que se ve. `fabrica(colores,
 * CONTROLES)` devuelve lo de `crearEstilos`; se llama una vez por modo y por
 * fábrica (debe estar fuera del componente para no recrearse).
 */
export function useEstilos(fabrica) {
  const { esquema, colores, controles } = useContext(AparienciaContext);
  let porEsquema = estilosEnMemoria.get(fabrica);
  if (!porEsquema) {
    porEsquema = {};
    estilosEnMemoria.set(fabrica, porEsquema);
  }
  if (!porEsquema[esquema]) porEsquema[esquema] = fabrica(colores, controles);
  return porEsquema[esquema];
}
