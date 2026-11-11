import { apiClient } from "./client";

const RUTA = "/organizacion/mi-reemplazo/";

/**
 * «¿Quién aprueba por usted mientras no está?» (11/11/2026, US-001): su jefe
 * inmediato u otra persona de la empresa. Es de cada persona y vale para la
 * empresa activa.
 *
 * Respuesta: `{modo: "jefe"|"persona", persona: {id, nombre}|null, jefe:
 * {id, nombre}|null}`.
 */
export const reemplazoService = {
  obtener() {
    return apiClient.get(RUTA).then((r) => r.data);
  },
  /** `{modo, persona_id?}`; 400 con el detalle en `persona_id` o `modo`. */
  guardar(datos) {
    return apiClient.put(RUTA, datos).then((r) => r.data);
  },
};
