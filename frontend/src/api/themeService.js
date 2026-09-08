import { apiClient } from "./client";

export const themeService = {
  // Pública — el login/registro también deben pintarse con la marca configurada.
  getCurrent() {
    return apiClient.get("/theme/current/").then((res) => res.data);
  },
  getAdmin() {
    return apiClient.get("/admin/theme/").then((res) => res.data);
  },
  update(payload) {
    return apiClient.patch("/admin/theme/", payload).then((res) => res.data);
  },
  reset() {
    return apiClient.post("/admin/theme/reset/").then((res) => res.data);
  },
  getOptions() {
    return apiClient.get("/admin/theme/options/").then((res) => res.data);
  },
};
