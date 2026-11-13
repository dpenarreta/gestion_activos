import { File } from "expo-file-system";

import {
  abrirConElSistema,
  borrarArchivo,
  borrarDescargas,
  carpetaDeDescargas,
  descargarConSesion,
  estadoDeError,
  extensionDe,
} from "../adjuntos/descargas";
import { licenciasService } from "../api/servicios";

/**
 * El documento de respaldo de una solicitud (US-010, CA-8): se descarga con
 * la sesión (Bearer y `X-Empresa` en la cabecera) a una carpeta propia de la
 * caché de la app y se abre desde ahí. Nunca se genera un enlace público ni
 * se abre en el navegador. Al cerrar sesión se borra la carpeta
 * (`borrarDocumentosDescargados`), junto con las copias que dejan la cámara y
 * los selectores de archivos.
 *
 * Desde la US-011 (12/11/2026) la descarga vive en `src/adjuntos/descargas.js`,
 * compartida con el chat; `borrarDocumentosDescargados` borra también los
 * archivos del chat.
 */
const CARPETA = "permisos-documentos";

export const TEXTO_DOCUMENTO_NO_DISPONIBLE = "El documento ya no está disponible.";
export const TEXTO_DOCUMENTO_FALLO =
  "No se pudo descargar el documento. Revise su conexión e intente de nuevo.";
export const TEXTO_SIN_VISOR =
  "No hay una aplicación para abrir PDF en este teléfono. Instale un visor de PDF o ábralo desde la web.";

export const TEXTO_TIPO_NO_VISIBLE =
  "Este documento no es una imagen ni un PDF y no se puede ver en la app. Ábralo desde la web.";

const IMAGENES = new Set(["jpg", "jpeg", "png"]);

export { borrarArchivo, estadoDeError };

/** `imagen`, `pdf` u `otro`, por la extensión del nombre que da la API. */
export function tipoDeDocumento(nombre) {
  const extension = extensionDe(nombre);
  if (IMAGENES.has(extension)) return "imagen";
  if (extension === "pdf") return "pdf";
  return "otro";
}

/**
 * Descarga el documento de la solicitud `id` y devuelve el `File`. Ante un
 * 401 renueva la sesión una vez (`api.conRenovacion`). Lanza un `Error` con
 * un mensaje para la persona.
 */
export async function descargarDocumento(id, nombre, { empresa } = {}) {
  const extension = extensionDe(nombre) || "bin";
  const destino = new File(
    carpetaDeDescargas(CARPETA),
    `solicitud-${String(id).replace(/\D/g, "")}.${extension}`,
  );
  try {
    return await descargarConSesion(licenciasService.urlAdjunto(id), destino, { empresa });
  } catch (error) {
    const estado = error?.status ?? error?.response?.status;
    const mensaje = estado === 404 ? TEXTO_DOCUMENTO_NO_DISPONIBLE : TEXTO_DOCUMENTO_FALLO;
    const paraLaPersona = new Error(mensaje);
    paraLaPersona.status = estado;
    throw paraLaPersona;
  }
}

/** Abre un PDF con el visor del sistema (`File.preview`, SDK 58). */
export async function abrirPdf(archivo, titulo) {
  return abrirConElSistema(archivo, {
    mimeType: "application/pdf",
    titulo,
    textoSinVisor: TEXTO_SIN_VISOR,
  });
}

/** Al cerrar sesión: nada del documento de un permiso ni de los adjuntos del
 * chat queda en el teléfono. Nunca lanza. */
export function borrarDocumentosDescargados() {
  borrarDescargas();
}
