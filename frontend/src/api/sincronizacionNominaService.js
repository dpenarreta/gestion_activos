import { apiClient } from "./client";

const RUTA = "/nomina/sincronizacion/";

/**
 * Perfiles desde nómina (US-021): la última sincronización con su reporte y
 * «Sincronizar ahora». Las dos piden `usuarios.sincronizar_nomina`.
 *
 * `estado()` → `{configurada, corriendo, ultima, anteriores,
 * inactivas_desde_nomina}`; `ultima` trae `conflictos` y `fuera_de_nomina`.
 * `sincronizar()` → la corrida; 400 `no_configurada`, 409 `en_curso`.
 */
export const sincronizacionNominaService = {
  estado() {
    return apiClient.get(RUTA).then((r) => r.data);
  },
  sincronizar() {
    return apiClient.post(RUTA).then((r) => r.data);
  },
  /** Los empleados de nómina con esos nombres y apellidos, para sugerir el
   * código al crear un usuario (17/11/2026). → `{configurada, resultados}`;
   * cada resultado `{codigo, nombres, apellidos, correo, asignado_a}`. */
  coincidencias(nombres, apellidos) {
    return apiClient
      .get("/nomina/coincidencias/", { params: { nombres, apellidos } })
      .then((r) => r.data);
  },
};
