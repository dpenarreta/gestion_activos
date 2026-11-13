import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

/**
 * Elegir un archivo para subirlo (una foto, una imagen de la galería o un
 * documento) y validarlo antes de enviar, con las reglas de cada módulo.
 * Nació con el documento de un permiso (US-010) y se generalizó para los
 * adjuntos del chat (US-011, 12/11/2026): cada módulo da sus `reglas`
 * (`crearSelector`), con los mismos límites que su servidor.
 *
 * Las fotos se piden ya comprimidas (`quality`) y, en iOS, en el formato
 * compatible: así la cámara del iPhone entrega JPG y no HEIC, que el servidor
 * no acepta.
 */

const CALIDAD_FOTO = 0.7;

export const TEXTO_SIN_PERMISO_CAMARA =
  "La app no tiene permiso para usar la cámara. Actívelo en los ajustes del teléfono o elija una imagen.";

/** Un tipo que el selector de Android a veces da cuando no sabe cuál es: se
 * decide entonces por la extensión. */
const TIPOS_GENERICOS = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function extensionDe(nombre) {
  const partes = /\.([a-z0-9]+)$/i.exec(nombre ?? "");
  return partes ? partes[1].toLowerCase() : "";
}

const TILDES = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n", Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ü: "U", Ñ: "N" };

/** Sin `normalize`, que Hermes no siempre trae. */
function sinTildes(texto) {
  return texto.replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => TILDES[c]);
}

/** «1,2 MB», «350 KB». */
export function tamanoLegible(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** El tamaño que dice el selector o, si no lo dice, el del archivo. */
function tamanoDe(uri, declarado) {
  if (Number.isFinite(declarado) && declarado > 0) return declarado;
  try {
    return new File(uri).size || 0;
  } catch {
    return 0;
  }
}

/** Borra la copia temporal de un archivo elegido, solo si está en la caché
 * de la app (nunca el original de la galería). */
export function descartarTemporal(uri) {
  try {
    if (!uri || !uri.startsWith(Paths.cache.uri)) return;
    const archivo = new File(uri);
    if (archivo.exists) archivo.delete();
  } catch {
    // La caché la limpia el sistema; no es motivo para molestar.
  }
}

/**
 * Las funciones de selección y validación para unas reglas:
 *
 * - `tipos`: `{extensión: tipo MIME}` que acepta el servidor;
 * - `tamanoMaximo`: en bytes;
 * - `textos`: `{demasiadoGrande, tipoNoPermitido}` para la persona;
 * - `nombrePorDefecto`: si el archivo no trae nombre;
 * - `tiposDelSelector`: los MIME que ofrece el selector de documentos;
 * - `tipoDelSelectorSinDecir`: el tipo de un documento si el selector no lo
 *   dice (el de los permisos solo ofrece PDF).
 */
export function crearSelector({
  tipos,
  tamanoMaximo,
  textos,
  nombrePorDefecto = "documento",
  tiposDelSelector,
  tipoDelSelectorSinDecir = "",
}) {
  const permitidos = new Set(Object.values(tipos));

  /** La extensión que corresponde a un MIME permitido (la primera). */
  function extensionDeTipo(mime) {
    return Object.keys(tipos).find((ext) => tipos[ext] === mime) ?? "";
  }

  /**
   * Normaliza lo elegido a `{uri, name, type, size}` y lo valida. Devuelve
   * `{archivo}` o `{error}`. Manda el tipo que declara el selector; si es
   * genérico o no viene, decide la extensión. El nombre siempre lleva la
   * extensión que corresponde al tipo, porque el servidor decide por ella.
   */
  function validarArchivo({ uri, nombre, tipo, tamano }) {
    if (!uri) return { error: textos.tipoNoPermitido };
    let extension = extensionDe(nombre) || extensionDe(uri);
    let mime = (tipo || "").toLowerCase();
    if (TIPOS_GENERICOS.has(mime) && tipos[extension]) mime = tipos[extension];
    if (!permitidos.has(mime)) return { error: textos.tipoNoPermitido };
    if (tipos[extension] !== mime) extension = extensionDeTipo(mime);
    const size = tamanoDe(uri, tamano);
    if (size > tamanoMaximo) return { error: textos.demasiadoGrande, tamano: size };
    const base = sinTildes(nombre || "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .slice(0, 80);
    return {
      archivo: {
        uri,
        name: `${base || nombrePorDefecto}.${extension}`,
        type: mime,
        size,
      },
    };
  }

  /** Si lo elegido no sirve, su copia en la caché no se queda (revisión
   * técnica de la US-010). */
  function validarYDescartar(datos) {
    const resultado = validarArchivo(datos);
    if (resultado.error) descartarTemporal(datos.uri);
    return resultado;
  }

  function deImagen(resultado) {
    if (!resultado || resultado.canceled) return null;
    const asset = resultado.assets?.[0];
    if (!asset) return null;
    return validarYDescartar({
      uri: asset.uri,
      nombre: asset.fileName || `foto-${Date.now()}.jpg`,
      tipo: asset.mimeType || "image/jpeg",
      tamano: asset.fileSize,
    });
  }

  const opcionesImagen = {
    mediaTypes: ["images"],
    quality: CALIDAD_FOTO,
    allowsEditing: false,
    exif: false,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible ?? "compatible",
  };

  /** `null` si la persona canceló; si no, `{archivo}` o `{error}`. */
  async function tomarFoto() {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso?.granted) return { error: TEXTO_SIN_PERMISO_CAMARA };
    return deImagen(await ImagePicker.launchCameraAsync(opcionesImagen));
  }

  /** La galería no pide permiso: el selector del sistema solo entrega lo que
   * la persona elige. */
  async function elegirImagen() {
    return deImagen(await ImagePicker.launchImageLibraryAsync(opcionesImagen));
  }

  async function elegirDocumento() {
    const resultado = await DocumentPicker.getDocumentAsync({
      type: tiposDelSelector ?? [...permitidos],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!resultado || resultado.canceled) return null;
    const asset = resultado.assets?.[0];
    if (!asset) return null;
    return validarYDescartar({
      uri: asset.uri,
      nombre: asset.name,
      tipo: asset.mimeType || tipoDelSelectorSinDecir,
      tamano: asset.size,
    });
  }

  return { validarArchivo, tomarFoto, elegirImagen, elegirDocumento };
}
