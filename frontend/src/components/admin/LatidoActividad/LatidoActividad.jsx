import { useEffect } from "react";

import { interaccionService } from "../../../api/interaccionService";

/** Como mucho un latido por minuto. */
export const CADA_MS = 60_000;
const EVENTOS = ["pointerdown", "keydown", "wheel", "touchstart"];

/**
 * El latido de actividad (18/11/2026): cuando la persona hace algo en la
 * pantalla —un clic, una tecla, desplazarse—, se avisa al servidor como mucho
 * una vez por minuto con el título de la pantalla. Con eso el dashboard
 * «Interacción de la plataforma» mide el tiempo de actividad real (no solo la
 * pestaña abierta) y qué funcionalidades se usan. No envía nada de lo que se
 * escribe ni se ve: solo el título de la pantalla.
 */
export function LatidoActividad() {
  useEffect(() => {
    let ultimo = 0;
    function alInteractuar() {
      const ahora = Date.now();
      if (ahora - ultimo < CADA_MS) return;
      if (typeof document !== "undefined" && document.hidden) return;
      ultimo = ahora;
      Promise.resolve()
        .then(() => interaccionService.latido(document.title))
        .catch(() => {});
    }
    EVENTOS.forEach((evento) =>
      window.addEventListener(evento, alInteractuar, { passive: true }),
    );
    return () =>
      EVENTOS.forEach((evento) =>
        window.removeEventListener(evento, alInteractuar),
      );
  }, []);
  return null;
}
