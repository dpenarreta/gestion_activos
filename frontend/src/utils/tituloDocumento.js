/*
 * El título de la pestaña: «Pantalla · Nombre del sitio» (auditoría UX/UI,
 * fase 3, 28/10/2026). Antes todas las pestañas decían solo el nombre del
 * sitio y, con varias abiertas, no había cómo distinguirlas.
 *
 * Lo fijan dos partes que no se conocen: el tema (el nombre del sitio, que
 * puede llegar o cambiar en cualquier momento) y el shell de `/admin` (la
 * pantalla). Las dos pasan por aquí, así que el orden en que lo hagan no
 * importa: ninguna pisa lo que puso la otra.
 */
let nombreDelSitio = "";
let tituloDePantalla = "";
// El título propio de una pantalla (la ficha de un ticket: su número) gana
// sobre el del menú mientras esa pantalla esté abierta (auditoría UX/UI,
// 30/10/2026: todas las fichas se llamaban «Bandeja»).
let tituloPropio = "";
const oyentes = new Set();

function aplicar() {
  if (typeof document === "undefined") return;
  document.title = [tituloPropio || tituloDePantalla, nombreDelSitio]
    .filter(Boolean)
    .join(" · ");
}

/** Lo fija una pantalla; `null` al salir, para volver al del menú. */
export function fijarTituloPropio(titulo) {
  tituloPropio = titulo || "";
  aplicar();
  oyentes.forEach((oyente) => oyente(tituloPropio));
}

/** Para la barra superior: avisa cuando cambia el título propio. */
export function suscribirTituloPropio(oyente) {
  oyentes.add(oyente);
  oyente(tituloPropio);
  return () => oyentes.delete(oyente);
}

export function fijarNombreDelSitio(nombre) {
  nombreDelSitio = nombre || "";
  aplicar();
}

/** `null` o vacío para volver a solo el nombre del sitio. */
export function fijarTituloDePantalla(titulo) {
  tituloDePantalla = titulo || "";
  aplicar();
}
