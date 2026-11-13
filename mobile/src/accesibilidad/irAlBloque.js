import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/** Antes de mover el foco: en Android, que termine el desplazamiento
 * (TalkBack lo pierde si no); en iOS, que VoiceOver termine de leer la
 * `Alerta` con el resumen del error, que se anuncia al aparecer (R-03). */
export const ESPERA_FOCO_ANDROID_MS = 300;
export const ESPERA_FOCO_IOS_MS = 900;

/**
 * Llevar la pantalla (y el lector de pantalla) a un bloque de un formulario
 * (N-06, B6, N-16; ronda 2: O1, R-03 y QA-TECH):
 *
 * - `bloque(nombre)` da `{onLayout}` para el `View` del bloque: su posición
 *   dentro del contenido del `ScrollView`.
 * - `refFoco(nombre)` es la `ref` del control ACCESIBLE del bloque al que va
 *   el foco (el campo, el primer radio, el botón o el encabezado). Sin ella,
 *   solo se desplaza: un `View` contenedor no es un destino útil.
 * - Los dos devuelven siempre el mismo objeto o función por nombre (un `Map`
 *   en un ref), así React no vuelve a llamar las refs en cada render.
 * - `irA(nombre)` desplaza DESPUÉS del siguiente layout (un efecto y
 *   `requestAnimationFrame`): un bloque que acaba de aparecer ya está
 *   medido. Sin nombre, o sin medir, va arriba. Con `{foco: false}` no mueve
 *   el foco; con `{control}`, el foco va a ese `refFoco` y no al del bloque
 *   (p. ej. «Hasta» dentro del bloque de las fechas).
 * - El foco va con `AccessibilityInfo.sendAccessibilityEvent(nodo, "focus")`
 *   (la API vigente; `setAccessibilityFocus` con `findNodeHandle` está
 *   obsoleta). Si falla, no pasa nada: el error también se anuncia aparte.
 */
export function useIrAlBloque(desplazable) {
  const posiciones = useRef({});
  const nodos = useRef({});
  const bloques = useRef(new Map());
  const refs = useRef(new Map());
  const [destino, setDestino] = useState(null);

  const bloque = useCallback((nombre) => {
    if (!bloques.current.has(nombre)) {
      bloques.current.set(nombre, {
        onLayout: (evento) => {
          posiciones.current[nombre] = evento?.nativeEvent?.layout?.y ?? 0;
        },
      });
    }
    return bloques.current.get(nombre);
  }, []);

  const refFoco = useCallback((nombre) => {
    if (!refs.current.has(nombre)) {
      refs.current.set(nombre, (nodo) => {
        nodos.current[nombre] = nodo;
      });
    }
    return refs.current.get(nombre);
  }, []);

  const irA = useCallback((nombre = null, { foco = true, control = nombre } = {}) => {
    // Un objeto nuevo cada vez: ir dos veces al mismo bloque también desplaza.
    setDestino({ nombre, foco, control });
  }, []);

  useEffect(() => {
    if (!destino) return undefined;
    let espera = null;
    const cuadro = requestAnimationFrame(() => {
      const y = destino.nombre ? posiciones.current[destino.nombre] : undefined;
      desplazable.current?.scrollTo?.({ y: y === undefined ? 0 : Math.max(0, y - 12), animated: true });
      if (!destino.nombre || !destino.foco || !nodos.current[destino.control]) return;
      espera = setTimeout(
        () => {
          const nodo = nodos.current[destino.control];
          if (!nodo) return;
          try {
            AccessibilityInfo.sendAccessibilityEvent(nodo, "focus");
          } catch {
            // Sin lector de pantalla o sin nodo: el desplazamiento basta.
          }
        },
        Platform.OS === "android" ? ESPERA_FOCO_ANDROID_MS : ESPERA_FOCO_IOS_MS,
      );
    });
    return () => {
      cancelAnimationFrame(cuadro);
      if (espera) clearTimeout(espera);
    };
  }, [destino, desplazable]);

  return { bloque, refFoco, irA };
}
