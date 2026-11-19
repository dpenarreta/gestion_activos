import { COLORES_DE_MODULO, COLORES_DE_MODULO_OSCURO } from "../tema/familias";

// Los colores de cada módulo están en `tema/familias.js` (US-026: los
// hexadecimales, en `src/tema`); aquí, a qué familia va cada notificación.
export { COLORES_DE_MODULO, COLORES_DE_MODULO_OSCURO };

/** De qué familia es cada clave de módulo del backend
 * (`apps/notificaciones/modulos.py`, MODULOS). */
const FAMILIA = {
  licencias: "permisos",
  procesos: "institucional",
  capacitacion: "institucional",
  privacidad: "institucional",
  dashboards: "dashboards",
  soporte: "soporte",
  novedades: "gestionHumana",
  tareas: "gestionHumana",
  proyectos: "gestionHumana",
  llamados: "gestionHumana",
  kpi: "gestionHumana",
  mejora_continua: "gestionHumana",
  escritorio: "gestionHumana",
  matriz: "matriz",
  ordenes: "ordenes",
  activos: "activos",
  solicitudes: "activos",
  mantenimientos: "activos",
  alertas: "activos",
  chat: "chat",
  descargas: "auditoria",
};

/** Los colores de una notificación según su módulo (`modulo`, o el prefijo
 * de su `tipo`). `oscuro` (US-026): los del modo oscuro. */
export function coloresDe(notificacion, oscuro = false) {
  const clave =
    notificacion?.modulo || String(notificacion?.tipo ?? "").split(".")[0];
  const mapa = oscuro ? COLORES_DE_MODULO_OSCURO : COLORES_DE_MODULO;
  return mapa[FAMILIA[clave]] ?? mapa.sistema;
}

/**
 * Los mismos colores para los íconos del resto de la app (16/11/2026, a
 * pedido del usuario: «aplica los nuevos colores a todos los iconos»): la
 * familia por su nombre (`institucional`, `soporte`, `chat`…).
 */
export function coloresDeFamilia(familia, oscuro = false) {
  const mapa = oscuro ? COLORES_DE_MODULO_OSCURO : COLORES_DE_MODULO;
  return mapa[familia] ?? mapa.sistema;
}
