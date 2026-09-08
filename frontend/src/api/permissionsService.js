import { apiClient } from "./client";

export const permissionsService = {
  catalog() {
    return apiClient.get("/admin/permissions/").then((res) => res.data);
  },
};
