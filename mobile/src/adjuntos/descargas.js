import { Directory, File, Paths } from "expo-file-system";

import { api } from "../api/api";

/**
 * Descargar un archivo protegido con la sesión (Bearer y `X-Empresa` en la
 * cabecera) a una carpeta propia de la caché, y abrirlo desde ahí. Nació con
 * el documento de un permiso (US-010) y se generalizó para los adjuntos del
 * chat (US-011, 12/11/2026). Nunca se genera un enlace público ni se abre en
 * el navegador.
 *
 * LOPDP: cada carpeta se registra en `CARPETAS_DE_DESCARGAS` y se borra al
 * cerrar sesión (`borrarDescargas`), junto con las copias que dejan la
 * cámara y los selectores de archivos. Desde la US-014 (13/11/2026), también
 * los adjuntos de los tickets de la Mesa de ayuda (`soporte-adjuntos`).
 */
export const CARPETAS_DE_DESCARGAS = ["permisos-documentos", "chat-archivos", "soporte-adjuntos"];

/** Las carpetas de la caché donde `expo-image-picker` y
 * `expo-document-picker` copian lo que se elige. */
export const CARPETAS_DE_SELECTORES = ["ImagePicker", "DocumentPicker"];

export function extensionDe(nombre) {
  const partes = /\.([a-z0-9]+)$/i.exec(nombre ?? "");
  return partes ? partes[1].toLowerCase() : "";
}

export function carpetaDeDescargas(nombre) {
  const directorio = new Directory(Paths.cache, nombre);
  if (!directorio.exists) directorio.create({ intermediates: true, idempotent: true });
  return directorio;
}

/** El estado HTTP de un error de la descarga nativa: el mensaje lo trae
 * («Unable to download a file: response has status: 401» en Android y
 * «response has status 401» en iOS, SDK 58). */
export function estadoDeError(error) {
  if (Number.isFinite(error?.status)) return error.status;
  const partes = /(?:status:?|HTTP)\s*([1-5]\d\d)\b/i.exec(String(error?.message ?? ""));
  return partes ? Number(partes[1]) : null;
}

/**
 * Descarga `url` a `destino` (un `File`) y lo devuelve. Ante un 401 renueva
 * la sesión una vez (`api.conRenovacion`). Lanza un error con `status`.
 */
export async function descargarConSesion(url, destino, { empresa } = {}) {
  return api.conRenovacion(
    async (cabeceras) => {
      try {
        return await File.downloadFileAsync(url, destino, {
          headers: cabeceras,
          idempotent: true,
        });
      } catch (error) {
        // Si la descarga falló a medias, en Android puede quedar el archivo
        // incompleto: se borra.
        try {
          if (destino.exists) destino.delete();
        } catch {
          // Nada que hacer.
        }
        const conEstado = new Error(error?.message || "descarga");
        conEstado.status = estadoDeError(error);
        throw conEstado;
      }
    },
    { empresa },
  );
}

/**
 * Abre un archivo con la app del sistema (`File.preview`, SDK 58): Quick Look
 * en iOS y la app que corresponda al tipo en Android. Lanza `textoSinVisor`
 * si no hay con qué abrirlo.
 */
export async function abrirConElSistema(archivo, { mimeType, titulo, textoSinVisor }) {
  const opciones = { mimeType, title: titulo };
  let puede = true;
  try {
    puede = await File.canPreview(archivo, { mimeType });
  } catch {
    puede = true;
  }
  if (!puede) throw new Error(textoSinVisor);
  try {
    await File.preview(archivo, opciones);
  } catch {
    throw new Error(textoSinVisor);
  }
}

/** Borra un archivo descargado (al cerrar el visor o salir de la pantalla).
 * Nunca lanza. */
export function borrarArchivo(archivo) {
  try {
    if (archivo?.exists) archivo.delete();
  } catch {
    // La caché la limpia también el sistema.
  }
}

/** Al cerrar sesión: nada descargado ni elegido queda en el teléfono. Nunca
 * lanza. */
export function borrarDescargas() {
  for (const nombre of [...CARPETAS_DE_DESCARGAS, ...CARPETAS_DE_SELECTORES]) {
    try {
      const directorio = new Directory(Paths.cache, nombre);
      if (directorio.exists) directorio.delete();
    } catch {
      // La caché la limpia también el sistema.
    }
  }
}
