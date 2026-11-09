import { descargarBlob } from "../utils/descargas";
import { apiClient } from "./client";
import { errorDeTareas } from "./tareasService";

const BASE = "/privacidad";

const datos = (r) => r.data;

/** Sin los filtros vacíos: el servidor valida cada uno que llega. */
function limpio(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, valor]) => valor !== "" && valor !== null && valor !== undefined,
    ),
  );
}

/**
 * El error de una llamada de derechos sobre datos personales, en el contrato
 * uniforme `{"error": {"code", "message", "details"}}`. La pantalla decide por
 * `codigo` (`validation_error`, `not_found`, `conflicto`,
 * `transicion_invalida`, `no_es_de_acceso`, `solicitud_cerrada`) o por
 * `estado` (409, 429), nunca por el texto; `campos` trae el primer mensaje de
 * cada campo con error.
 */
export function errorDePrivacidad(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  return errorDeTareas(err, porDefecto);
}

/** El nombre que manda el servidor en `Content-Disposition`. */
function nombreDelArchivo(cabecera, porDefecto) {
  const encontrado = /filename="?([^";]+)"?/i.exec(cabecera ?? "");
  return encontrado?.[1]?.trim() || porDefecto;
}

/**
 * Pide un archivo con la sesión y lo guarda con `descargarBlob`, que además
 * lo anota en el registro de descargas. El servidor ya marcó esta respuesta
 * «sin copia» (`apps.descargas`): el registro guarda la huella, no el archivo
 * con los datos personales.
 *
 * Si falla, el cuerpo llega como blob: se lee para mostrar el mensaje del
 * servidor (p. ej. el 429 dice cuánto esperar).
 */
async function bajar(ruta, formato, porDefecto) {
  try {
    const r = await apiClient.get(ruta, {
      params: { formato },
      responseType: "blob",
    });
    const nombre = nombreDelArchivo(
      r.headers?.["content-disposition"],
      porDefecto,
    );
    descargarBlob(r.data, nombre);
    return nombre;
  } catch (err) {
    const cuerpo = err?.response?.data;
    if (typeof Blob !== "undefined" && cuerpo instanceof Blob) {
      let leido = null;
      try {
        leido = JSON.parse(await cuerpo.text());
      } catch {
        // No era JSON: queda el error tal como llegó.
      }
      if (leido) throw { response: { ...err.response, data: leido } };
    }
    throw err;
  }
}

/**
 * Derechos sobre datos personales (LOPDP). Contrato: `/api/v1/privacidad/`
 * (ver `docs/derechos-sobre-datos.md`).
 *
 * - El titular (toda persona con sesión, sin permiso): sus solicitudes y la
 *   descarga de sus datos.
 * - Quien ve o atiende (`privacidad.ver` / `privacidad.atender`): la bandeja,
 *   el detalle, el cambio de estado y los datos del titular de un ACCESO.
 *
 * El servidor vuelve a autorizar cada petición (una solicitud ajena es 404):
 * ocultar un botón aquí nunca es la barrera.
 */
export const privacidadService = {
  /** `{puede_ver_bandeja, puede_atender, plazo_dias, tipos[], estados[]}`. */
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),

  // --- El titular ---
  misSolicitudes: () => apiClient.get(`${BASE}/mis-solicitudes/`).then(datos),
  miSolicitud: (id) =>
    apiClient.get(`${BASE}/mis-solicitudes/${id}/`).then(datos),
  /** 201 si la crea; 200 con la misma si ya había una abierta idéntica. */
  crearSolicitud: ({ tipo, descripcion }) =>
    apiClient
      .post(`${BASE}/mis-solicitudes/`, { tipo, descripcion })
      .then((r) => ({ solicitud: r.data, creada: r.status === 201 })),
  /** Qué incluye la descarga y qué no, para mostrarlo antes de pedirla. */
  secciones: () => apiClient.get(`${BASE}/mis-datos/secciones/`).then(datos),
  /** `formato`: `json` o `xlsx`. Devuelve el nombre del archivo. */
  descargarMisDatos: (formato) =>
    bajar(`${BASE}/mis-datos/`, formato, `mis-datos.${formato}`),

  // --- Quien ve o atiende ---
  /** Paginada: `{count, next, previous, results, totales{abiertas, vencidas}}`. */
  bandeja: (params = {}) =>
    apiClient
      .get(`${BASE}/solicitudes/`, { params: limpio(params) })
      .then(datos),
  /** Las vencidas, para la insignia del menú (los totales no dependen de los
   * filtros: basta una página de una fila). */
  vencidas: () =>
    apiClient
      .get(`${BASE}/solicitudes/`, { params: { page_size: 1 } })
      .then((r) => r.data?.totales?.vencidas ?? 0),
  solicitud: (id) => apiClient.get(`${BASE}/solicitudes/${id}/`).then(datos),
  /** `estado_esperado` va siempre: si otra persona ya la movió, 409 en vez de
   * moverla dos veces. */
  cambiarEstado: (id, { estado, respuesta, estadoEsperado }) =>
    apiClient
      .post(`${BASE}/solicitudes/${id}/estado/`, {
        estado,
        respuesta: respuesta || "",
        estado_esperado: estadoEsperado,
      })
      .then(datos),
  /** Solo de una solicitud de ACCESO abierta (`puede_descargar_datos`). */
  descargarDatosDelTitular: (id, formato) =>
    bajar(
      `${BASE}/solicitudes/${id}/datos/`,
      formato,
      `datos-del-titular-${id}.${formato}`,
    ),
};
