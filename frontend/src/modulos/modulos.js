import { RUTAS_CONFIGURACION } from "../components/admin/ConfiguracionMarco/seccionesConfiguracion";

/**
 * Los módulos del sistema: cada uno trae su propio menú lateral.
 *
 * El sistema creció de un solo asunto —el inventario— a varios. En vez de
 * apilar todo en un menú interminable, cada módulo muestra solo sus pantallas
 * y se cambia de uno a otro desde «Módulo activo», arriba en el menú, en el
 * orden de esta lista. Lo general del
 * sistema —Reportes, Auditoría y Configuración, con usuarios, roles y
 * permisos— no es de ningún módulo: aparece en todos, en el bloque «General» del menú.
 *
 * Un módulo se identifica por el prefijo de sus rutas. Las que no son de
 * ninguno (las de Configuración) conservan el módulo desde el que se llegó.
 */
export const MODULOS = [
  {
    // El general: toda persona con sesión entra aquí al iniciar sesión,
    // siempre (19/10/2026), aunque no tenga sus permisos: «Inicio» es de
    // todos; el organigrama, de quien tenga los suyos. No incluye lo del
    // bloque «General» del menú (Reportes, Auditoría, Configuración).
    id: "institucional",
    nombre: "Institucional",
    descripcion: "Organigrama, jerarquías y cargos de la empresa",
    icono: "diagram-3",
    inicio: "/admin/institucional/inicio",
    prefijo: "/admin/institucional",
  },
  {
    id: "dashboards",
    nombre: "Dashboards",
    descripcion: "Los dashboards de cada área o departamento",
    icono: "bar-chart-line",
    inicio: "/admin/dashboards",
    prefijo: "/admin/dashboards",
  },
  {
    id: "soporte",
    nombre: "Mesa de ayuda",
    descripcion: "Tickets de soporte de TI de los empleados",
    icono: "headset",
    inicio: "/admin/soporte/bandeja",
    prefijo: "/admin/soporte",
  },
  {
    id: "matriz",
    nombre: "Matriz de obligaciones",
    descripcion: "Obligaciones, vencimientos y evidencias de cada empresa",
    icono: "journal-check",
    inicio: "/admin/matriz",
    prefijo: "/admin/matriz",
  },
  {
    id: "sedes",
    nombre: "Órdenes de trabajo",
    descripcion: "Órdenes de trabajo de sedes y agencias",
    icono: "buildings",
    inicio: "/admin/ordenes/panel",
    prefijo: "/admin/ordenes",
  },
  {
    id: "activos",
    nombre: "Gestión de Activos",
    descripcion: "Inventario, mantenimientos, solicitudes y renovación",
    icono: "pc-display",
    // `/admin` reparte a la primera pantalla que la persona puede abrir.
    inicio: "/admin",
  },
];

/** El módulo de las rutas sin prefijo propio (las del inventario). */
export const MODULO_POR_DEFECTO = "activos";

/** A donde entra toda persona al iniciar sesión, siempre. */
export const MODULO_DE_ENTRADA = "institucional";
export const RUTA_DE_ENTRADA = "/admin/institucional/inicio";

const CLAVE = "gestion_activos_modulo";

export function moduloPorId(id) {
  return MODULOS.find((modulo) => modulo.id === id) ?? MODULOS[0];
}

/** El módulo al que pertenece una ruta por su prefijo, o `null` si es común. */
export function moduloDeRuta(pathname) {
  const propio = MODULOS.find(
    (modulo) =>
      modulo.prefijo &&
      (pathname === modulo.prefijo ||
        pathname.startsWith(`${modulo.prefijo}/`)),
  );
  if (propio) return propio.id;
  return esRutaComun(pathname) ? null : MODULO_POR_DEFECTO;
}

const RUTAS_COMUNES = [
  ...RUTAS_CONFIGURACION,
  "/admin/reportes",
  "/admin/auditoria",
  "/admin/notificaciones",
  "/admin/aprobaciones",
  "/admin/chat",
  "/admin/ayuda",
  "/admin/mis-datos",
  "/admin/perfil",
];

function esRutaComun(pathname) {
  return RUTAS_COMUNES.some(
    (ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`),
  );
}

/** El último módulo elegido, para las pantallas comunes. */
export function moduloRecordado() {
  try {
    return sessionStorage.getItem(CLAVE) || MODULO_DE_ENTRADA;
  } catch {
    return MODULO_DE_ENTRADA;
  }
}

export function recordarModulo(id) {
  try {
    sessionStorage.setItem(CLAVE, id);
  } catch {
    // Sin almacenamiento, las pantallas comunes vuelven al módulo por
    // defecto: incómodo, pero nada se pierde.
  }
}
