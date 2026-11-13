import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Si el sistema pide menos movimiento («Reducir movimiento» en iOS, «Quitar
 * animaciones» en Android). Lo que se desplaza solo va entonces sin animar
 * (US-016, H-16). Escucha los cambios mientras la app está abierta.
 */
export function useMenosMovimiento() {
  const [menos, setMenos] = useState(false);
  useEffect(() => {
    let vigente = true;
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.() ?? false)
      .then((valor) => {
        if (vigente) setMenos(Boolean(valor));
      })
      .catch(() => {});
    const suscripcion = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (valor) =>
      setMenos(Boolean(valor)),
    );
    return () => {
      vigente = false;
      suscripcion?.remove?.();
    };
  }, []);
  return menos;
}
