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

/*
 * Tareas y Equipo (fase 2a, portado de Nexo). Toda pantalla exige además
 * `tareas.acceder`: el servidor lo pide en cada petición de `/tasks/`. El
 * ámbito (de quién son las tareas, quién es de su equipo) lo decide el
 * organigrama en el servidor; `GET tasks/me/` dice qué puede la persona.
 */
export const TAREAS_ACCEDER = "tareas.acceder";
export const TAREAS_VALIDAR = "tareas.validar";
export const TAREAS_REGULARIZAR = "tareas.regularizar";
export const TAREAS_CERRAR_MES = "tareas.cerrar_mes";
export const TAREAS_ADMINISTRAR = "tareas.administrar";
export const EQUIPO_VER = "equipo.ver";

/*
 * Proyectos (fase 2b, portado de Nexo). Toda petición de `/projects/` exige
 * `proyectos_gh.acceder`; qué proyecto ve y qué puede hacer en él (gestionar,
 * participar, enviarlo a la papelera) lo decide el servidor por proyecto.
 */
export const PROYECTOS_ACCEDER = "proyectos_gh.acceder";
export const PROYECTOS_CREAR = "proyectos_gh.crear";
export const PROYECTOS_SUPERVISAR = "proyectos_gh.supervisar";
export const PROYECTOS_ADMINISTRAR = "proyectos_gh.administrar";

/*
 * Desempeño: KPI, Mis KPI e Inteligencia preventiva (fase 2b, portado de
 * Nexo). Toda petición de `/analytics/` exige `kpi.acceder`; cada pantalla
 * suma el suyo. El ámbito (de quién se ven los KPI) lo decide el organigrama
 * en el servidor.
 */
export const KPI_ACCEDER = "kpi.acceder";
export const KPI_EQUIPO = "kpi.equipo";
export const KPI_EJECUTIVO = "kpi.ejecutivo";
export const KPI_ADMINISTRAR = "kpi.administrar";
export const RIESGO_VER = "inteligencia_preventiva.ver";

/** Lo que abre alguna pantalla del módulo (las rutas lo exigen igual). */
export const PERMISOS_GESTION_HUMANA = [
  ACCEDER,
  INGRESOS,
  SALIDAS,
  ADMINISTRAR,
  PERMISOS,
  TAREAS_ACCEDER,
  PROYECTOS_ACCEDER,
  KPI_ACCEDER,
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
