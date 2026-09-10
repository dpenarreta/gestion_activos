import { apiClient } from "./client";

/** Las empresas que la cuenta puede ver, y en cuál está trabajando. */
export const empresasService = {
  mias() {
    return apiClient.get("/empresas/mias/").then((res) => res.data);
  },
};
