import { apiClient } from "./client";

const EMPRESAS = "/empresas/";

/**
 * Las empresas del grupo.
 *
 * `mias()` es lo que alimenta el selector del menú y no exige permisos: saber
 * en qué empresa se está trabajando no es administrar empresas. El resto son
 * las operaciones administrativas, y el backend las gobierna con
 * `empresas.ver` / `empresas.editar`.
 */
export const empresasService = {
  mias() {
    return apiClient.get(`${EMPRESAS}mias/`).then((res) => res.data);
  },
  /** Qué módulos están encendidos en la empresa activa. */
  modulos() {
    return apiClient.get(`${EMPRESAS}modulos/`).then((res) => res.data);
  },
  /** Encender o apagar uno (`configuracion.modulos`). */
  cambiarModulo(modulo, activo) {
    return apiClient
      .put(`${EMPRESAS}modulos/`, { modulo, activo })
      .then((res) => res.data);
  },
  list(params = {}) {
    return apiClient.get(EMPRESAS, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${EMPRESAS}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(EMPRESAS, payload).then((res) => res.data);
  },
  /** Quienes trabajan en la empresa: de ahí sale el gerente general. */
  personas(id) {
    return apiClient.get(`${EMPRESAS}${id}/personas/`).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient
      .patch(`${EMPRESAS}${id}/`, payload)
      .then((res) => res.data);
  },
};
