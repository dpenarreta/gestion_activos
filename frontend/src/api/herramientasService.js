import { apiClient } from "./client";

const BASE = "/organizacion/herramientas/";

/** Herramientas y licencias: el catálogo y quién usa cada una. */
export const herramientasService = {
  /** Cada herramienta del catálogo con quiénes la usan. */
  uso() {
    return apiClient.get("/organizacion/herramientas-uso/").then((r) => r.data);
  },
  /** El catálogo (para marcar las herramientas de un cargo). */
  catalogo() {
    return apiClient.get(BASE).then((r) => r.data.results ?? r.data);
  },
  /** Quiénes tienen acceso a la herramienta. */
  usuarios(id) {
    return apiClient.get(`${BASE}${id}/usuarios/`).then((r) => r.data);
  },
  /** Da acceso a una persona (se ve en sus «Mis herramientas»). */
  darAcceso(id, usuario, cuenta = "") {
    return apiClient
      .post(`${BASE}${id}/usuarios/`, { usuario, cuenta })
      .then((r) => r.data);
  },
  quitarAcceso(id, usuario) {
    return apiClient
      .delete(`${BASE}${id}/usuarios/${usuario}/`)
      .then((r) => r.data);
  },
  /** Personas de la empresa para darles acceso. */
  personas(q) {
    return apiClient
      .get(`${BASE}personas/`, { params: { q } })
      .then((r) => r.data);
  },
  crear(datos) {
    return apiClient.post(BASE, datos).then((r) => r.data);
  },
  actualizar(id, datos) {
    return apiClient.patch(`${BASE}${id}/`, datos).then((r) => r.data);
  },
  eliminar(id) {
    return apiClient.delete(`${BASE}${id}/`);
  },
};
