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

function aplicar() {
  if (typeof document === "undefined") return;
  document.title = [tituloDePantalla, nombreDelSitio]
    .filter(Boolean)
    .join(" · ");
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
