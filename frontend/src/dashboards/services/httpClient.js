import { apiClient } from "../../api/client";

/*
 * Los servicios del módulo se escribieron contra tres bases (`/api`,
 * `/api/cartera`, `/api/dashboards`) con un cliente propio. Aquí usan el del
 * sistema —token, renovación de la sesión, empresa activa (`X-Empresa`)— y el
 * prefijo se traduce al de la API versionada: `/api/cartera` → `/cartera`.
 */
function traducir(prefijo) {
  return prefijo.replace(/^\/api/, "");
}

export function createApiClient(prefijo) {
  const base = traducir(prefijo);
  const ruta = (url = "") => `${base}${url}`;
  return {
    get: (url, config) => apiClient.get(ruta(url), config),
    delete: (url, config) => apiClient.delete(ruta(url), config),
    post: (url, data, config) => apiClient.post(ruta(url), data, config),
    put: (url, data, config) => apiClient.put(ruta(url), data, config),
    patch: (url, data, config) => apiClient.patch(ruta(url), data, config),
  };
}
