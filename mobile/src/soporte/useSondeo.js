import { useEffect, useRef } from "react";

import { useAppActiva, useEnFoco } from "../chat/usePresencia";

/** Como la web (US-014, sección 5): las listas cada 30 s y las fichas cada
 * 10 s. No hay tiempo real en el servidor. */
export const SONDEO_LISTAS_MS = 30_000;
export const SONDEO_FICHAS_MS = 10_000;

/**
 * Repite `consultar` cada `intervalo` mientras la pantalla tiene el foco y la
 * app está en primer plano (el mismo criterio que la presencia del chat).
 * `activo` lo apaga (p. ej., mientras se envía algo o si el ticket no
 * existe). `consultar` va por un ref: cambiarla no reinicia el reloj.
 */
export function useSondeo(consultar, intervalo, activo = true) {
  const appActiva = useAppActiva();
  const enFoco = useEnFoco();
  const funcion = useRef(consultar);
  funcion.current = consultar;
  // QA-TECH: con una consulta en curso (red lenta) no se lanza otra.
  const enCurso = useRef(false);

  useEffect(() => {
    if (!activo || !appActiva || !enFoco) return undefined;
    const reloj = setInterval(() => {
      if (enCurso.current) return;
      enCurso.current = true;
      Promise.resolve()
        .then(() => funcion.current?.())
        .catch(() => {})
        .finally(() => {
          enCurso.current = false;
        });
    }, intervalo);
    return () => clearInterval(reloj);
  }, [activo, appActiva, enFoco, intervalo]);
}
