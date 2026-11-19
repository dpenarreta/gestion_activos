/**
 * El color de cada módulo en las notificaciones, igual que en la app móvil
 * (18/11/2026, pedido del usuario: «que se entiendan tanto en web y en
 * móvil»). La paleta y la familia de cada módulo son las de
 * `mobile/src/tema/familias.js` y `mobile/src/notificaciones/coloresDeModulo.js`;
 * una prueba (`tests/ColoresDeModulo.test.js`) falla si se separan.
 *
 * Los colores van en `CampanaNotificaciones.css`, por familia
 * (`campana-item--<familia>`), en claro y en oscuro.
 */

/** De qué familia es cada clave de módulo del backend
 * (`apps/notificaciones/modulos.py`, MODULOS). */
export const FAMILIA = {
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

/** La familia de color de una notificación según su módulo (`modulo`, o el
 * prefijo de su `tipo`); «sistema» si no es de ninguno conocido. */
export function familiaDe(notificacion) {
  const clave =
    notificacion?.modulo || String(notificacion?.tipo ?? "").split(".")[0];
  return FAMILIA[clave] ?? "sistema";
}
