import { apiClient } from "./client";

const BASE = "/matriz";

/** API del módulo Matriz de obligaciones (backend `apps.matriz`). */
export const matrizService = {
  /** Empresas donde la cuenta puede entrar a la Matriz, con su rol y sus
   * capacidades en cada una. */
  misEmpresas() {
    return apiClient.get(`${BASE}/empresas/mias/`).then((res) => res.data);
  },
};

/** Áreas y entidades de control: catálogos compartidos por las empresas. */
export function catalogoMatrizService(tipo) {
  const url = `${BASE}/catalogos/${tipo}/`;
  return {
    list: () => apiClient.get(url).then((res) => res.data),
    create: (datos) => apiClient.post(url, datos).then((res) => res.data),
    update: (id, datos) =>
      apiClient.patch(`${url}${id}/`, datos).then((res) => res.data),
    remove: (id) => apiClient.delete(`${url}${id}/`),
  };
}
