import { apiClient } from "./client";

const BASE = "/llamados/";

/** Una lista llega como arreglo o paginada (`{results}`): las dos valen. */
export function comoLista(datos) {
  if (Array.isArray(datos)) return datos;
  if (Array.isArray(datos?.results)) return datos.results;
  return [];
}

const datos = (res) => res.data;
const lista = (res) => comoLista(res.data);

/** Solo viajan los filtros con valor. */
function sinVacios(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined,
    ),
  );
}

/**
 * Llamados de atención de Gestión Humana (US-013). Contrato:
 * `/api/v1/llamados/`. El servidor vuelve a autorizar cada petición
 * (`llamados.*`; un jefe solo ve y pide lo de su equipo): ocultar un botón
 * aquí nunca es la barrera.
 */
export const llamadosService = {
  // --- Causas y niveles (escribir exige `llamados.configurar`) -------------
  causas(params) {
    return apiClient
      .get(`${BASE}causas/`, { params: sinVacios(params) })
      .then(lista);
  },
  causa(id) {
    return apiClient.get(`${BASE}causas/${id}/`).then(datos);
  },
  /** `campos` lleva `niveles` anidados, como los devuelve el servidor. */
  crearCausa(campos) {
    return apiClient.post(`${BASE}causas/`, campos).then(datos);
  },
  editarCausa(id, campos) {
    return apiClient.patch(`${BASE}causas/${id}/`, campos).then(datos);
  },
  /** Solo se borra lo que nunca se usó; lo demás se desactiva. */
  borrarCausa(id) {
    return apiClient.delete(`${BASE}causas/${id}/`).then(datos);
  },
  /** Las variables de las plantillas: `[{ clave, descripcion, ejemplo }]`. */
  variables() {
    return apiClient.get(`${BASE}variables/`).then(lista);
  },

  // --- Emitir y solicitar ---------------------------------------------------
  /** A quién puede dirigirse quien entra (`q` filtra por nombre). */
  personas(q = "", modo = "") {
    return apiClient
      .get(`${BASE}personas/`, { params: sinVacios({ q, modo }) })
      .then(lista);
  },
  /** Nivel propuesto, historial de la persona en la causa y monto sugerido.
   * Depende de la fecha del hecho (el plazo de reincidencia se cuenta hasta
   * ella) y del modo: `solicitar` no trae historial. */
  propuesta(persona, causa, { fechaHecho, modo } = {}) {
    return apiClient
      .get(`${BASE}propuesta/`, {
        params: sinVacios({
          persona,
          causa,
          fecha_hecho: fechaHecho,
          modo,
        }),
      })
      .then(datos);
  },
  /** La plantilla con datos de ejemplo, como la envía el servidor:
   * `{ asunto?, texto, html, desconocidas: [] }`. Se pinta el `texto`. */
  vistaPrevia(asunto, cuerpo) {
    return apiClient
      .post(`${BASE}vista-previa/`, { asunto, cuerpo })
      .then(datos);
  },
  /** Filtros: persona, causa, nivel, estado, desde, hasta. */
  llamados(filtros) {
    return apiClient
      .get(`${BASE}llamados/`, { params: sinVacios(filtros) })
      .then(lista);
  },
  llamado(id) {
    return apiClient.get(`${BASE}llamados/${id}/`).then(datos);
  },
  /** Emite (con `llamados.emitir`) o solicita (con `llamados.solicitar`): lo
   * decide el servidor por los permisos. Va como formulario por el adjunto. */
  crear(campos, adjunto) {
    const cuerpo = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null && valor !== "") {
        cuerpo.append(clave, valor);
      }
    });
    if (adjunto) cuerpo.append("adjunto", adjunto);
    return apiClient.post(`${BASE}llamados/`, cuerpo).then(datos);
  },
  /** `campos`: nivel, nivel_esperado, justificacion_cambio, monto, descripcion
   * (opcionales). Con `nivel_esperado` desactualizado responde 409
   * `propuesta_cambio`. */
  confirmar(id, campos = {}) {
    return apiClient
      .post(`${BASE}llamados/${id}/confirmar/`, sinVacios(campos))
      .then(datos);
  },
  rechazar(id, motivo) {
    return apiClient
      .post(`${BASE}llamados/${id}/rechazar/`, { motivo })
      .then(datos);
  },
  /** Vuelve a enviar el correo de un llamado emitido (`puede.reenviar`):
   * responde el llamado con su `correo` actualizado. */
  reenviarCorreo(id) {
    return apiClient.post(`${BASE}llamados/${id}/reenviar-correo/`).then(datos);
  },
  anular(id, motivo) {
    return apiClient
      .post(`${BASE}llamados/${id}/anular/`, { motivo })
      .then(datos);
  },

  // --- Mi perfil ---------------------------------------------------------------
  mios() {
    return apiClient.get(`${BASE}mios/`).then(lista);
  },
};
