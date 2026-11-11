/**
 * Optimizar imágenes en el navegador antes de subirlas (US-007, 11/11/2026).
 *
 * Una foto de 5 MB para un carrusel que se ve a 1600 px es mucho más grande de
 * lo necesario, y quien la sube no tiene por qué saber reducirla. Subir el
 * límite del servidor solo movería el problema, así que se reduce aquí: el
 * servidor sigue siendo la única regla (5 MB binarios) y esto solo evita que
 * una imagen razonable choque con ella.
 *
 * Sin dependencias: `createImageBitmap` (que respeta la orientación EXIF) y un
 * lienzo (`OffscreenCanvas` si el navegador lo tiene, si no un `<canvas>`).
 */

const MEGABYTE = 1024 * 1024;

/** El límite del servidor para las imágenes (`noticias.TAMANO_MAXIMO_BYTES`). */
export const MAXIMO_BYTES_IMAGEN = 5 * MEGABYTE;

const TIPOS_OPTIMIZABLES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXTENSION_DE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// El formato del peso ya no es solo de imágenes: vive en `formato.js` y se
// reexporta aquí para quien lo importe junto con `optimizarImagen`.
export { formatearMegabytes, formatearMaximoMegabytes } from "./formato";

/**
 * Un lienzo con su contexto 2D, o `null`. Safari 16.0–16.3 tiene
 * `OffscreenCanvas` pero su `getContext("2d")` devuelve `null`: entonces se
 * usa un `<canvas>` (revisión técnica de US-007, 11/11/2026).
 */
function crearLienzo(ancho, alto) {
  if (typeof OffscreenCanvas === "function") {
    try {
      const lienzo = new OffscreenCanvas(ancho, alto);
      const contexto = lienzo.getContext("2d");
      if (contexto) return { lienzo, contexto };
    } catch {
      // Se prueba con un <canvas>.
    }
  }
  if (typeof document === "undefined") return null;
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const contexto = lienzo.getContext("2d");
  return contexto ? { lienzo, contexto } : null;
}

/** Suelta la memoria del lienzo (un <canvas> de 2400 px son ~20 MB) sin
 * esperar al recolector. */
function liberarLienzo(lienzo) {
  try {
    lienzo.width = 0;
    lienzo.height = 0;
  } catch {
    // Algunos lienzos no dejan cambiar la medida; da igual.
  }
}

function aBlob(lienzo, tipo, calidad) {
  if (typeof lienzo.convertToBlob === "function") {
    return lienzo.convertToBlob({ type: tipo, quality: calidad });
  }
  return new Promise((resolver) => lienzo.toBlob(resolver, tipo, calidad));
}

async function leerImagen(archivo) {
  try {
    return await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch (error) {
    // Algún navegador antiguo no acepta las opciones (TypeError); sin ellas la
    // orientación EXIF también se aplica por defecto. Si el fallo es otro (la
    // imagen está dañada), reintentar no serviría.
    if (error instanceof TypeError) return createImageBitmap(archivo);
    throw error;
  }
}

/**
 * Si algún píxel no es opaco. Ante la duda (el navegador no deja leer los
 * píxeles) se da por transparente: un PNG o WebP de más es mejor que un JPEG
 * con el fondo negro.
 */
function tieneTransparencia(contexto, ancho, alto) {
  try {
    const { data } = contexto.getImageData(0, 0, ancho, alto);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function renombrar(nombre, tipo) {
  // El servidor comprueba que la extensión coincida con el contenido: un PNG
  // convertido a JPEG tiene que llamarse .jpg.
  const base = nombre.replace(/\.[^./\\]+$/, "") || "imagen";
  return `${base}${EXTENSION_DE[tipo]}`;
}

/**
 * Reduce la imagen si pesa más de `maxBytes` o su lado mayor pasa de
 * `ladoMaximo`, conservando la proporción.
 *
 * - JPG → JPEG de calidad `calidad`.
 * - PNG o WebP sin transparencia → JPEG; con transparencia → WebP (o PNG si el
 *   navegador no sabe escribir WebP), nunca JPEG con fondo negro.
 * - Si el navegador no puede leerla, o la versión optimizada no pesa menos,
 *   devuelve el original: lo que decide al final es el servidor.
 *
 * @returns {Promise<{archivo: File, optimizada: boolean, antes: number, despues: number}>}
 */
export async function optimizarImagen(
  file,
  { ladoMaximo = 2400, maxBytes = MAXIMO_BYTES_IMAGEN, calidad = 0.85 } = {},
) {
  const sinCambios = {
    archivo: file,
    optimizada: false,
    antes: file?.size ?? 0,
    despues: file?.size ?? 0,
  };
  if (
    !file ||
    !TIPOS_OPTIMIZABLES.has(file.type) ||
    typeof createImageBitmap !== "function"
  ) {
    return sinCambios;
  }

  let imagen;
  try {
    imagen = await leerImagen(file);
  } catch {
    return sinCambios;
  }

  let lienzo = null;
  try {
    const { width, height } = imagen;
    const ladoMayor = Math.max(width, height);
    if (!ladoMayor || (file.size <= maxBytes && ladoMayor <= ladoMaximo)) {
      return sinCambios;
    }

    const escala = Math.min(1, ladoMaximo / ladoMayor);
    const ancho = Math.max(1, Math.round(width * escala));
    const alto = Math.max(1, Math.round(height * escala));
    const creado = crearLienzo(ancho, alto);
    if (!creado) return sinCambios;
    lienzo = creado.lienzo;
    const { contexto } = creado;
    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = "high";
    contexto.drawImage(imagen, 0, 0, ancho, alto);

    const transparente =
      file.type !== "image/jpeg" && tieneTransparencia(contexto, ancho, alto);
    let blob;
    if (!transparente) {
      blob = await aBlob(lienzo, "image/jpeg", calidad);
    } else {
      blob = await aBlob(lienzo, "image/webp", calidad);
      // Sin soporte de WebP, el navegador entrega un PNG en su lugar (o nada).
      if (!blob || blob.type !== "image/webp") {
        blob = await aBlob(lienzo, "image/png");
      }
    }

    if (!blob || !EXTENSION_DE[blob.type] || blob.size >= file.size) {
      return sinCambios;
    }
    const archivo = new File([blob], renombrar(file.name, blob.type), {
      type: blob.type,
      lastModified: Date.now(),
    });
    return {
      archivo,
      optimizada: true,
      antes: file.size,
      despues: archivo.size,
    };
  } catch {
    return sinCambios;
  } finally {
    imagen.close?.();
    if (lienzo) liberarLienzo(lienzo);
  }
}
