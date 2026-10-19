/** Lo que abre el módulo Institucional: ver, armar o asignar el organigrama. */
export const PERMISOS_INSTITUCIONAL = [
  "institucional.ver",
  "institucional.editar",
  "institucional.asignar",
];

/** El prefijo de las rutas del módulo. */
export const RUTA_INSTITUCIONAL = "/admin/institucional";

/** Los de «Gestionar documentos» (códigos de conducta), uno por pestaña.
 * Leer los códigos no pide ninguno. */
export const PERMISOS_CODIGOS = [
  "codigos.publicar",
  "codigos.acuerdo",
  "codigos.ver_aceptaciones",
];
