import { useCallback, useEffect, useRef, useState } from "react";

/** Distancia al borde (px) desde la que la tabla se desplaza sola. */
const ZONA = 48;
/** Velocidad máxima (px por cuadro) al llegar al borde o salir de él. */
const MAXIMO = 22;

function paso(posicion, inicio, fin, zona) {
  const cerca = (distancia) =>
    Math.round(MAXIMO * Math.min(1, (zona - distancia) / zona) ** 2);
  if (posicion < inicio + zona) return -Math.max(1, cerca(posicion - inicio));
  if (posicion > fin - zona) return Math.max(1, cerca(fin - posicion));
  return 0;
}

/** Cuánto desplazar el contenedor en este cuadro según dónde está el puntero. */
export function desplazamiento(puntero, caja) {
  const ancho = caja.right - caja.left;
  const alto = caja.bottom - caja.top;
  return {
    dx:
      ancho > 0
        ? paso(puntero.x, caja.left, caja.right, Math.min(ZONA, ancho / 3))
        : 0,
    dy:
      alto > 0
        ? paso(puntero.y, caja.top, caja.bottom, Math.min(ZONA, alto / 3))
        : 0,
  };
}

/** Las filas destino de un arrastre (sin la de origen), en orden. */
export function filasDestino(desde, hasta) {
  const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i).filter(
    (i) => i !== desde,
  );
}

const siguienteCuadro = (fn) =>
  typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(fn)
    : window.setTimeout(fn, 16);
const cancelarCuadro = (id) =>
  typeof window.cancelAnimationFrame === "function"
    ? window.cancelAnimationFrame(id)
    : window.clearTimeout(id);

/**
 * Arrastrar el cuadrito de la celda activa para copiar su valor a las filas
 * de abajo (o de arriba), como en Excel. Mientras se arrastra no se envía
 * nada: al soltar, `alSoltar({ col, desde, hasta })` aplica las reglas de cada
 * pantalla a cada celda y guarda con su mecanismo habitual. Cerca de un borde
 * la tabla se desplaza sola (el contenedor, nunca la página). Escape o perder
 * el foco de la ventana lo cancelan.
 *
 * Es solo para ratón: con teclado o al tacto se usa «Copiar hacia abajo»
 * (Ctrl+D), que hace lo mismo.
 */
export function useArrastreRelleno({ contenedorRef, alSoltar }) {
  const [arrastre, setArrastre] = useState(null);
  const actual = useRef(null);
  const puntero = useRef(null);
  const cuadro = useRef(null);
  const limpiar = useRef(null);
  const alSoltarRef = useRef(alSoltar);
  alSoltarRef.current = alSoltar;

  const filaEn = useCallback(
    (p) => {
      const contenedor = contenedorRef.current;
      if (!contenedor) return null;
      const caja = contenedor.getBoundingClientRect();
      const x = Math.min(Math.max(p.x, caja.left + 2), caja.right - 2);
      const y = Math.min(Math.max(p.y, caja.top + 2), caja.bottom - 2);
      // La cabecera es fija dentro del contenedor: se toma la primera fila de
      // la pila bajo el punto, no la celda de la cabecera.
      const pila =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(x, y)
          : [];
      for (const elemento of pila) {
        const fila = elemento?.closest?.("[data-fila]");
        if (!fila || !contenedor.contains(fila)) continue;
        const numero = Number(fila.getAttribute("data-fila"));
        if (Number.isFinite(numero)) return numero;
      }
      return null;
    },
    [contenedorRef],
  );

  const reubicar = useCallback(() => {
    if (!actual.current || !puntero.current) return;
    const hasta = filaEn(puntero.current);
    if (hasta !== null && hasta !== actual.current.hasta) {
      actual.current = { ...actual.current, hasta };
      setArrastre(actual.current);
    }
  }, [filaEn]);

  const terminar = useCallback((aplicar) => {
    limpiar.current?.();
    limpiar.current = null;
    if (cuadro.current !== null) cancelarCuadro(cuadro.current);
    cuadro.current = null;
    const fin = actual.current;
    actual.current = null;
    puntero.current = null;
    setArrastre(null);
    if (aplicar && fin && fin.hasta !== fin.desde) alSoltarRef.current(fin);
  }, []);

  const empezar = useCallback(
    (evento, fila, col) => {
      evento.preventDefault();
      evento.stopPropagation();
      terminar(false);
      actual.current = { col, desde: fila, hasta: fila };
      puntero.current = { x: evento.clientX, y: evento.clientY };
      setArrastre(actual.current);
      const alMover = (e) => {
        puntero.current = { x: e.clientX, y: e.clientY };
        reubicar();
      };
      const alSoltarRaton = () => terminar(true);
      const alTeclear = (e) => {
        if (e.key === "Escape") terminar(false);
      };
      const alPerderFoco = () => terminar(false);
      window.addEventListener("mousemove", alMover);
      window.addEventListener("mouseup", alSoltarRaton);
      window.addEventListener("keydown", alTeclear);
      window.addEventListener("blur", alPerderFoco);
      limpiar.current = () => {
        window.removeEventListener("mousemove", alMover);
        window.removeEventListener("mouseup", alSoltarRaton);
        window.removeEventListener("keydown", alTeclear);
        window.removeEventListener("blur", alPerderFoco);
      };
      const bucle = () => {
        const contenedor = contenedorRef.current;
        if (!actual.current || !contenedor || !puntero.current) {
          cuadro.current = null;
          return;
        }
        const { dx, dy } = desplazamiento(
          puntero.current,
          contenedor.getBoundingClientRect(),
        );
        if (dx || dy) {
          const antes = [contenedor.scrollTop, contenedor.scrollLeft];
          contenedor.scrollTop += dy;
          contenedor.scrollLeft += dx;
          if (
            contenedor.scrollTop !== antes[0] ||
            contenedor.scrollLeft !== antes[1]
          )
            reubicar();
        }
        cuadro.current = siguienteCuadro(bucle);
      };
      cuadro.current = siguienteCuadro(bucle);
    },
    [contenedorRef, reubicar, terminar],
  );

  useEffect(() => () => terminar(false), [terminar]);

  const enArrastre = (fila, col) =>
    arrastre !== null &&
    arrastre.col === col &&
    fila >= Math.min(arrastre.desde, arrastre.hasta) &&
    fila <= Math.max(arrastre.desde, arrastre.hasta);

  return { arrastre, empezar, cancelar: () => terminar(false), enArrastre };
}
