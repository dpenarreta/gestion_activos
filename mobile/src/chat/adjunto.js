import { File } from "expo-file-system";

import {
  abrirConElSistema,
  carpetaDeDescargas,
  descargarConSesion,
  extensionDe,
} from "../adjuntos/descargas";
import { crearSelector } from "../adjuntos/seleccion";
import { chatService } from "../api/servicios";

/**
 * Los adjuntos del chat (US-011, CA-7, 12/11/2026), con los límites del
 * servidor: `TAMANO_MAXIMO_BYTES` (10 MB) y `EXTENSIONES_PERMITIDAS` de
 * `apps/adjuntos/models.py`, que `MensajesView` aplica con `ArchivoGrande` y
 * `validar_archivo` (que además comprueba la firma del contenido). Son los
 * mismos que acepta el selector de la web (`accept` de `Conversacion.jsx`).
 */
export const TAMANO_MAXIMO_CHAT = 10 * 1024 * 1024;
export const LIMITE_MB_CHAT = 10;

export const TIPOS_DEL_CHAT = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Lo mismo que dice el servidor con `ArchivoGrande`: lo que pasa el límite
 * se sugiere enviarlo por correo. */
export const TEXTO_ARCHIVO_GRANDE = `El archivo supera los ${LIMITE_MB_CHAT} MB del chat. Envíelo por correo.`;
export const TEXTO_TIPO_NO_PERMITIDO_CHAT =
  "Ese tipo de archivo no se puede enviar por el chat. Adjunte un PDF, una imagen (JPG, PNG o WEBP) o un documento de Word o Excel (DOCX o XLSX).";

export const TEXTO_ARCHIVO_NO_DISPONIBLE = "El archivo ya no está disponible.";
export const TEXTO_ARCHIVO_FALLO =
  "No se pudo descargar el archivo. Revise su conexión e intente de nuevo.";
export const TEXTO_SIN_APP_PARA_ABRIR =
  "No hay una aplicación para abrir este archivo en este teléfono. Ábralo desde la web.";

const CARPETA = "chat-archivos";

const selector = crearSelector({
  tipos: TIPOS_DEL_CHAT,
  tamanoMaximo: TAMANO_MAXIMO_CHAT,
  textos: { demasiadoGrande: TEXTO_ARCHIVO_GRANDE, tipoNoPermitido: TEXTO_TIPO_NO_PERMITIDO_CHAT },
  nombrePorDefecto: "archivo",
});

export const validarAdjuntoDelChat = selector.validarArchivo;
export const tomarFotoParaElChat = selector.tomarFoto;
export const elegirImagenParaElChat = selector.elegirImagen;
export const elegirArchivoParaElChat = selector.elegirDocumento;

/** La ruta del archivo de un mensaje, solo si es la del contrato
 * (`/chat/archivos/{id}/`): la app no descarga de otro lado. */
export function rutaDeArchivoValida(url) {
  return typeof url === "string" && /^\/chat\/archivos\/\d{1,12}\/$/.test(url);
}

/** El tipo MIME de un adjunto recibido, por su extensión (el servidor lo
 * sirve igual: `tipo_por_extension`). */
export function tipoDeArchivo(nombre) {
  return TIPOS_DEL_CHAT[extensionDe(nombre)] ?? "application/octet-stream";
}

/**
 * Descarga el archivo de un mensaje a `cache/chat-archivos/` con la sesión y
 * devuelve el `File`. Lanza un `Error` con un mensaje para la persona. El
 * servidor responde 400 «El archivo ya no está disponible» cuando pasó la
 * ventana del historial.
 */
export async function descargarArchivoDelChat(mensaje, { empresa } = {}) {
  const archivo = mensaje?.archivo;
  if (!archivo || !rutaDeArchivoValida(archivo.url)) throw new Error(TEXTO_ARCHIVO_NO_DISPONIBLE);
  const extension = extensionDe(archivo.nombre) || "bin";
  const destino = new File(
    carpetaDeDescargas(CARPETA),
    `mensaje-${String(mensaje.id).replace(/\D/g, "")}.${extension}`,
  );
  try {
    return await descargarConSesion(chatService.urlArchivo(archivo.url), destino, { empresa });
  } catch (error) {
    const estado = error?.status ?? error?.response?.status;
    const paraLaPersona = new Error(
      estado === 404 || estado === 400 ? TEXTO_ARCHIVO_NO_DISPONIBLE : TEXTO_ARCHIVO_FALLO,
    );
    paraLaPersona.status = estado;
    throw paraLaPersona;
  }
}

/** Abre un archivo que no es imagen con la app del sistema. */
export function abrirArchivoDelChat(archivo, nombre) {
  return abrirConElSistema(archivo, {
    mimeType: tipoDeArchivo(nombre),
    titulo: nombre,
    textoSinVisor: TEXTO_SIN_APP_PARA_ABRIR,
  });
}
