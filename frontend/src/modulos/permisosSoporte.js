/** Lo que abre el módulo de Mesa de ayuda: atender, ver todo, coordinar o
 * registrar tickets en nombre de otros. */
export const PERMISOS_SOPORTE = [
  "soporte.atender",
  "soporte.ver_todos",
  "soporte.asignar",
  "soporte.registrar",
];

/** Para quien no es del equipo (09/11/2026). Ninguno de los dos hace a nadie
 * parte del equipo, por eso no están en `PERMISOS_SOPORTE`:
 * - ver sus tickets en la bandeja, solo en «Mis solicitudes»; */
export const PERMISO_MESA_MIS_TICKETS = "soporte.mesa_mis_tickets";
/** - crear un ticket a su nombre desde la Mesa («Pedir ayuda (a mi nombre)»).
 * «Soporte TI», en la barra superior, sigue con `soporte.crear`. */
export const PERMISO_MESA_CREAR = "soporte.mesa_crear";

/** El prefijo de las rutas del módulo. */
export const RUTA_SOPORTE = "/admin/soporte";
