import { useEffect, useState } from "react";

/**
 * Si se cumple una consulta de medios (`(max-width: 880px)`, `(pointer:
 * coarse)`…), y se vuelve a pintar cuando cambia. Fuera del navegador o sin
 * `matchMedia`, `false` (auditoría UX/UI, fase 3, 28/10/2026).
 */
export function cumpleConsulta(consulta) {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.(consulta)?.matches)
  );
}

export function useMediaQuery(consulta) {
  const [cumple, setCumple] = useState(() => cumpleConsulta(consulta));
  useEffect(() => {
    const medio = window.matchMedia?.(consulta);
    setCumple(Boolean(medio?.matches));
    if (!medio?.addEventListener) return undefined;
    const alCambiar = () => setCumple(medio.matches);
    medio.addEventListener("change", alCambiar);
    return () => medio.removeEventListener("change", alCambiar);
  }, [consulta]);
  return cumple;
}

/** El corte en el que las listas cambian la tabla por tarjetas (el mismo de
 * `identidad-puente.css`: `.mz-table-wrap--con-tarjetas + .mz-cards`). */
export const ANCHO_DE_TARJETAS = "(max-width: 880px)";

/**
 * Si la lista se ve en tarjetas. Las tarjetas se dibujan solo entonces: la
 * Matriz las dibuja siempre y las oculta por CSS, pero en una lista con
 * acciones eso duplica cada botón en el documento (auditoría UX/UI, fase 3,
 * 28/10/2026).
 */
export function useVistaDeTarjetas() {
  return useMediaQuery(ANCHO_DE_TARJETAS);
}
