import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Dice un texto por el lector de pantalla (VoiceOver o TalkBack).
 *
 * `accessibilityRole="alert"` solo lo lee iOS al aparecer, y no siempre:
 * Android no tiene regiones de alerta y un error que aparece bajo el botón
 * pasaba en silencio (QA-UX, hallazgo crítico, 12/11/2026). Por eso los
 * errores, los avisos y el resultado de una acción se anuncian aparte.
 */
export function anunciar(texto) {
  if (!texto) return;
  try {
    AccessibilityInfo.announceForAccessibility?.(String(texto));
  } catch {
    // Sin lector de pantalla no hay nada que decir.
  }
}

/**
 * Anuncia `texto` cada vez que cambia (y al aparecer). `clave` fuerza un
 * anuncio nuevo con el mismo texto: el mismo error dos veces seguidas es dos
 * avisos, y React junta el «borrar» y el «volver a poner» en un solo render.
 */
export function useAnunciar(texto, activo = true, clave = undefined) {
  useEffect(() => {
    if (activo && texto) anunciar(texto);
  }, [texto, activo, clave]);
}
