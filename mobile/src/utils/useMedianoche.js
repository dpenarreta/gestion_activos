import { useEffect, useState } from "react";

/** Unos segundos después de la medianoche, para no caer justo en el borde. */
export const SEGUNDOS_TRAS_MEDIANOCHE = 5;

/** Cuánto falta, desde `ahora`, para las 00:00:05 del día siguiente. */
export function msHastaMedianoche(ahora = new Date()) {
  const siguiente = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1, 0, 0, SEGUNDOS_TRAS_MEDIANOCHE);
  return Math.max(1000, siguiente.getTime() - ahora.getTime());
}

/**
 * Un número que sube cada noche a las 00:00:05 (O3, ronda 2 de QA): quien lo
 * usa vuelve a dibujarse y «Hoy» pasa a «Ayer» aunque no llegue nada nuevo
 * ni la persona toque la pantalla. Se programa de a un día y se limpia al
 * desmontar.
 */
export function useMedianoche() {
  const [tic, setTic] = useState(0);
  useEffect(() => {
    const espera = setTimeout(() => setTic((t) => t + 1), msHastaMedianoche());
    return () => clearTimeout(espera);
  }, [tic]);
  return tic;
}
