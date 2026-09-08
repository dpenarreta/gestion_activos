import { apiClient } from "./client";

export const rolesService = {
  list() {
    return apiClient.get("/admin/roles/").then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`/admin/roles/${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post("/admin/roles/", payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`/admin/roles/${id}/`, payload).then((res) => res.data);
  },
  remove(id) {
    return apiClient.delete(`/admin/roles/${id}/`).then((res) => res.data);
  },
  permissionsCatalog() {
    return apiClient.get("/admin/roles/permissions-catalog/").then((res) => res.data);
  },
};
