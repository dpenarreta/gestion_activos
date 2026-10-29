/**
 * Un archivo que llega por la API y se muestra desde un blob (`URL.createObjectURL`).
 *
 * La dirección de un blob es del mismo origen que el sistema: si el blob dice
 * ser `text/html` o `image/svg+xml` y alguien lo abre en una pestaña (con el
 * enlace de la miniatura o con «Abrir imagen en otra pestaña»), corre como una
 * página del sistema, con la sesión de quien lo abre. El tipo lo decidía el
 * servidor con lo que había declarado el navegador de quien lo subió
 * (auditoría de seguridad, 29/10/2026). Aquí se fija a una lista corta: lo que
 * no está en ella no se abre ni se muestra, solo se puede descargar.
 */

/** Los únicos tipos con los que un blob se muestra o se abre en otra pestaña. */
export const TIPOS_QUE_SE_ABREN = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const POR_EXTENSION = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
});

/** El tipo que corresponde a la extensión de `nombre`, o `null`. */
export function tipoPorNombre(nombre) {
  const extension = /\.([a-z0-9]+)$/i.exec(nombre ?? "")?.[1]?.toLowerCase();
  return (extension && POR_EXTENSION[extension]) || null;
}

function tipoDelBlob(blob) {
  const tipo = (blob?.type ?? "").split(";")[0].trim().toLowerCase();
  return TIPOS_QUE_SE_ABREN.includes(tipo) ? tipo : null;
}

/**
 * El mismo contenido con un tipo de la lista, o `null` si no lo hay.
 *
 * Con `nombre`, manda la extensión (la validó el servidor al subirlo) y no el
 * tipo que trae el blob; sin él, se usa el del blob solo si está en la lista.
 */
export function blobQueSePuedeAbrir(blob, nombre) {
  if (!blob) return null;
  const tipo = nombre ? tipoPorNombre(nombre) : tipoDelBlob(blob);
  if (!tipo) return null;
  return new Blob([blob], { type: tipo });
}

/** Igual, solo para imágenes (miniaturas, capturas, fotos). */
export function blobDeImagen(blob, nombre) {
  const seguro = blobQueSePuedeAbrir(blob, nombre);
  return seguro && seguro.type.startsWith("image/") ? seguro : null;
}
