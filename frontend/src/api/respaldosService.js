import { apiClient } from "./client";

const RESPALDOS = "/configuracion/respaldos/";

export const respaldosService = {
  /** La política vigente, con cuándo fue el último y cuándo toca el próximo. */
  politica() {
    return apiClient.get(RESPALDOS).then((res) => res.data);
  },
  guardar(payload) {
    return apiClient.patch(RESPALDOS, payload).then((res) => res.data);
  },
};
