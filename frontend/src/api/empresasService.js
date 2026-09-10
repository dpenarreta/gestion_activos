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
  list(params = {}) {
    return apiClient.get(EMPRESAS, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${EMPRESAS}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(EMPRESAS, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient
      .patch(`${EMPRESAS}${id}/`, payload)
      .then((res) => res.data);
  },
};
