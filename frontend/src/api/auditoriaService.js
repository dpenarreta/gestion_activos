import { apiClient } from "./client";

const AUDITORIA = "/admin/audit-logs/";

export const auditoriaService = {
  list(params) {
    return apiClient.get(AUDITORIA, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${AUDITORIA}${id}/`).then((res) => res.data);
  },
  // El archivo lo arma el servidor con los mismos filtros del listado, así que
  // lo que se descarga es lo que se está viendo, no «todo el registro».
  exportar(params) {
    return apiClient
      .get(`${AUDITORIA}export/`, { params, responseType: "blob" })
      .then((res) => res.data);
  },
};
