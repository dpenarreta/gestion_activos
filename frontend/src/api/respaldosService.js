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
  /** Deja la orden de respaldar ya; la tarea del sistema la cumple en su
   * siguiente pasada. Devuelve la política con `solicitado_en`. */
  /** Los respaldos en disco, del más reciente al más antiguo. */
  archivos() {
    return apiClient.get(`${RESPALDOS}archivos/`).then((res) => res.data);
  },
  /** Borra un respaldo entero (base, adjuntos y manifiesto). El más reciente
   * lo rechaza el servidor con un 409. */
  borrar(marca) {
    return apiClient.delete(
      `${RESPALDOS}archivos/${encodeURIComponent(marca)}/`,
    );
  },
  respaldarAhora() {
    return apiClient.post(`${RESPALDOS}ahora/`).then((res) => res.data);
  },
};
