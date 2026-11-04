/**
 * Gestión Humana · Control Operativo de Novedades (portado de Nexo,
 * 04/11/2026). El menú se filtra con los permisos del catálogo
 * (`novedades.*`); lo fino (el ámbito por supervisor, lo que cada rol
 * operativo puede o no, las excepciones individuales) lo decide el servidor en
 * `GET novedades/me/` y cada pantalla lo respeta. Ocultar una entrada nunca es
 * la barrera: el servidor vuelve a autorizar cada petición.
 */
export const RUTA_GESTION_HUMANA = "/admin/gestion-humana";

export const ACCEDER = "novedades.acceder";
export const HISTORIAL = "novedades.historial_ver";
export const CONSOLIDADO = "novedades.consolidado_ver";
export const DEPURAR = "novedades.depurar";
export const ADMINISTRAR = "novedades.administrar";
export const PERMISOS = "novedades.permisos_gestionar";
export const INGRESOS = "novedades.ingresos_ver";
export const SALIDAS = "novedades.salidas_ver";

/** Lo que abre alguna pantalla del módulo (las rutas lo exigen igual). */
export const PERMISOS_GESTION_HUMANA = [
  ACCEDER,
  INGRESOS,
  SALIDAS,
  ADMINISTRAR,
  PERMISOS,
];

/** Los códigos del módulo tal como los usa `GET novedades/me/`. */
export const PERM = {
  acceder: ACCEDER,
  colaboradores: "novedades.colaboradores_gestionar",
  registrar: "novedades.registrar",
  consolidado: CONSOLIDADO,
  historial: HISTORIAL,
  importar: "novedades.importar",
  exportar: "novedades.exportar",
  cerrar: "novedades.cerrar_periodo",
  corregir: "novedades.corregir_cerrado",
  administrar: ADMINISTRAR,
  permisos: PERMISOS,
  depurar: DEPURAR,
  diasEditar: "novedades.dias_editar",
};
