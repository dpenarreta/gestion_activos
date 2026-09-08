import { apiClient } from "./client";

export const adminUsersService = {
  list(params) {
    return apiClient.get("/admin/users/", { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`/admin/users/${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post("/admin/users/", payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`/admin/users/${id}/`, payload).then((res) => res.data);
  },
  enable(id) {
    return apiClient.post(`/admin/users/${id}/enable/`).then((res) => res.data);
  },
  disable(id) {
    return apiClient.post(`/admin/users/${id}/disable/`).then((res) => res.data);
  },
  block(id) {
    return apiClient.post(`/admin/users/${id}/block/`).then((res) => res.data);
  },
  unblock(id) {
    return apiClient.post(`/admin/users/${id}/unblock/`).then((res) => res.data);
  },
  sessions(id) {
    return apiClient.get(`/admin/users/${id}/sessions/`).then((res) => res.data);
  },
  revokeSessions(id) {
    return apiClient.post(`/admin/users/${id}/sessions/revoke/`).then((res) => res.data);
  },
  assignRoles(id, roleIds) {
    return apiClient
      .post(`/admin/users/${id}/roles/`, { role_ids: roleIds })
      .then((res) => res.data);
  },
  assignPermissions(id, permissionCodenames) {
    return apiClient
      .post(`/admin/users/${id}/permissions/`, { permission_codenames: permissionCodenames })
      .then((res) => res.data);
  },
  resetPassword(id, options) {
    return apiClient.post(`/admin/users/${id}/password-reset/`, options).then((res) => res.data);
  },
};
