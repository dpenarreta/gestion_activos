import { crearSelector, descartarTemporal, tamanoLegible, TEXTO_SIN_PERMISO_CAMARA } from "../adjuntos/seleccion";

/**
 * El documento de respaldo de un permiso (US-010, CA-6): una foto, una imagen
 * de la galería o un PDF. La app avisa antes de enviar si pasa de 10 MB o no
 * es PDF, JPG ni PNG; el servidor vuelve a comprobarlo, incluida la firma del
 * contenido (`NuevaSolicitudSerializer.validate_adjunto`).
 *
 * Desde la US-011 (12/11/2026) la selección y la validación viven en
 * `src/adjuntos/seleccion.js`, compartidas con el chat; aquí quedan las
 * reglas de los permisos y los mismos nombres de siempre.
 */
export const TAMANO_MAXIMO = 10 * 1024 * 1024;

export const TIPOS_PERMITIDOS = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export const TEXTO_DEMASIADO_GRANDE =
  "El documento pesa más de 10 MB. Elija otro o tome la foto de nuevo.";
export const TEXTO_TIPO_NO_PERMITIDO = "Adjunte un PDF o una imagen (JPG o PNG).";
export { TEXTO_SIN_PERMISO_CAMARA, descartarTemporal, tamanoLegible };

const selector = crearSelector({
  tipos: TIPOS_PERMITIDOS,
  tamanoMaximo: TAMANO_MAXIMO,
  textos: { demasiadoGrande: TEXTO_DEMASIADO_GRANDE, tipoNoPermitido: TEXTO_TIPO_NO_PERMITIDO },
  tiposDelSelector: ["application/pdf"],
  tipoDelSelectorSinDecir: "application/pdf",
});

/** `{archivo}` o `{error}` (sin el tamaño, como antes). */
export function validarArchivo(datos) {
  const { archivo, error } = selector.validarArchivo(datos);
  return error ? { error } : { archivo };
}

export const tomarFoto = async () => sinTamano(await selector.tomarFoto());
export const elegirImagen = async () => sinTamano(await selector.elegirImagen());
export const elegirPdf = async () => sinTamano(await selector.elegirDocumento());

function sinTamano(resultado) {
  if (!resultado || !resultado.error) return resultado;
  return { error: resultado.error };
}
