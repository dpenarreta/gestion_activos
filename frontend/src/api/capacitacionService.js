import { apiClient } from "./client";

const BASE = "/capacitacion/";

/** Onboarding y capacitación: el plan de cada persona, los materiales con sus
 * evaluaciones y los resultados. */
export const capacitacionService = {
  // --- Mi onboarding -----------------------------------------------------
  miOnboarding() {
    return apiClient.get(`${BASE}mi-onboarding/`).then((r) => r.data);
  },
  marcarVisto(id) {
    return apiClient
      .post(`${BASE}mi-onboarding/${id}/visto/`)
      .then((r) => r.data);
  },
  archivo(id) {
    return apiClient
      .get(`${BASE}mi-onboarding/${id}/archivo/`, { responseType: "blob" })
      .then((r) => r.data);
  },
  evaluacion(id) {
    return apiClient
      .get(`${BASE}mi-onboarding/${id}/evaluacion/`)
      .then((r) => r.data);
  },
  /** `respuestas`: `{ pregunta_id: respuesta }` según el tipo de cada
   * pregunta; `tiempoAgotado`, cuando el reloj llegó a cero. */
  responder(id, respuestas, tiempoAgotado = false) {
    return apiClient
      .post(`${BASE}mi-onboarding/${id}/responder/`, {
        respuestas,
        tiempo_agotado: tiempoAgotado,
      })
      .then((r) => r.data);
  },
  /** Lo respondido hasta ahora en una evaluación con tiempo límite. */
  guardarBorrador(id, respuestas) {
    return apiClient
      .post(`${BASE}mi-onboarding/${id}/borrador/`, { respuestas })
      .then((r) => r.data);
  },
  // --- Gestión -----------------------------------------------------------
  materiales() {
    return apiClient.get(`${BASE}materiales/`).then((r) => r.data);
  },
  guardarMaterial(id, campos, archivo) {
    const datos = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null) datos.append(clave, valor);
    });
    if (archivo) datos.append("archivo", archivo);
    const peticion = id
      ? apiClient.patch(`${BASE}materiales/${id}/`, datos)
      : apiClient.post(`${BASE}materiales/`, datos);
    return peticion.then((r) => r.data);
  },
  eliminarMaterial(id) {
    return apiClient.delete(`${BASE}materiales/${id}/`);
  },
  preguntas(id) {
    return apiClient
      .get(`${BASE}materiales/${id}/preguntas/`)
      .then((r) => r.data);
  },
  guardarPreguntas(id, preguntas) {
    return apiClient
      .put(`${BASE}materiales/${id}/preguntas/`, { preguntas })
      .then((r) => r.data);
  },
  // --- Resultados --------------------------------------------------------
  resultados() {
    return apiClient.get(`${BASE}resultados/`).then((r) => r.data);
  },
  personas(q) {
    return apiClient
      .get(`${BASE}asignar/`, { params: { q } })
      .then((r) => r.data);
  },
  asignar(usuarios, dias) {
    return apiClient
      .post(`${BASE}asignar/`, { usuarios, dias })
      .then((r) => r.data);
  },
  devolverIntentos(usuario, material) {
    return apiClient
      .post(`${BASE}devolver-intentos/`, { usuario, material })
      .then((r) => r.data);
  },
};
