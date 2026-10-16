import {
  PERMISOS_CONFIGURACION,
  RUTAS_CONFIGURACION,
} from "../ConfiguracionMarco/seccionesConfiguracion";
import { MODULO_POR_DEFECTO } from "../../../modulos/modulos";
import { PERMISOS_MATRIZ } from "../../../modulos/permisosMatriz";
import {
  PERMISOS_DASHBOARDS,
  RUTA_DASHBOARDS,
} from "../../../modulos/permisosDashboards";
import { PERMISOS_AUDITORIA } from "../AuditoriaMarco/AuditoriaMarco";
import { PERMISOS_REPORTES } from "../ReportesMarco/ReportesMarco";

// En su propio módulo: Configuración también lo usa, y este archivo ya
// importa de Configuración (sería una importación circular).
export { PERMISOS_MATRIZ };

/**
 * Árbol del Menú Administrativo — estático, no configurable desde el
 * backend. Hoy son 4 entradas fijas; cada módulo de negocio que se agregue
 * suma su entrada aquí sin tocar `AdminSidebar`/`AdminMenuItem`/
 * `AdminMenuGroup` (que solo consumen esta forma de datos, sin saber de
 * dónde viene).
 *
 * Cada item: { id, name, icon, path?, permission, rutas?, children? }.
 * `permission` (un código o una lista, de la que basta uno) filtra la entrada
 * completa (y sus hijos) si el usuario no lo tiene; `rutas`, otras direcciones
 * que también la marcan como activa — la
 * autorización real siempre la valida el backend, esto es solo para no
 * mostrar opciones inalcanzables.
 */
export const ADMIN_MENU = [
  {
    id: "panel",
    modulo: "activos",
    name: "Panel principal",
    icon: "speedometer2",
    path: "/admin/dashboard",
    permission: "activos.ver",
  },
  {
    // Arriba, junto al panel: es la pantalla desde la que se decide qué hacer
    // hoy, y esconderla dentro de un submenú la volvería opcional.
    id: "alertas",
    modulo: "activos",
    name: "Alertas",
    icon: "bell",
    path: "/admin/alertas",
    permission: "alertas.ver",
  },
  {
    id: "activos",
    modulo: "activos",
    name: "Activos",
    icon: "pc-display",
    permission: "activos.ver",
    children: [
      {
        id: "activos-inventario",
        name: "Inventario",
        icon: "list-ul",
        path: "/admin/activos",
      },
      {
        id: "activos-importar",
        name: "Carga masiva",
        icon: "file-earmark-excel",
        path: "/admin/activos/importar",
      },
      {
        id: "activos-escaner",
        name: "Escáner",
        icon: "upc-scan",
        path: "/admin/activos/escaner",
      },
      {
        // Encima de los tipos: la categoría es el nivel de arriba, y el orden
        // del menú es lo que lo explica sin tener que escribirlo.
        id: "activos-categorias",
        name: "Categorías",
        icon: "tags",
        path: "/admin/activos/categorias",
      },
      {
        id: "activos-tipos",
        name: "Tipos de dispositivo",
        icon: "tags",
        path: "/admin/activos/tipos",
      },
    ],
  },
  {
    id: "mantenimientos",
    modulo: "activos",
    name: "Mantenimientos",
    icon: "tools",
    permission: "mantenimientos.ver",
    children: [
      {
        id: "mantenimientos-bitacora",
        name: "Bitácora",
        icon: "journal-text",
        path: "/admin/mantenimientos",
      },
      {
        id: "mantenimientos-componentes",
        name: "Componentes",
        icon: "cpu",
        path: "/admin/mantenimientos/componentes",
      },
    ],
  },
  {
    // Debajo de mantenimientos y antes de renovación: el orden sigue el ciclo
    // del equipo —se inventaría, se repara, se pide el reemplazo—, y una
    // solicitud es casi siempre la consecuencia de lo de arriba.
    id: "solicitudes",
    modulo: "activos",
    name: "Solicitudes",
    icon: "cart-plus",
    permission: "solicitudes.ver",
    children: [
      {
        id: "solicitudes-mias",
        name: "Mis solicitudes",
        icon: "person-lines-fill",
        path: "/admin/solicitudes/mias",
      },
      {
        id: "solicitudes-recibidas",
        name: "Solicitudes recibidas",
        icon: "inbox",
        path: "/admin/solicitudes/recibidas",
      },
      {
        // Con su propio permiso: hay cuentas que consultan solicitudes y no
        // las hacen, y ofrecerles el formulario las llevaría a un 403.
        id: "solicitudes-nueva",
        name: "Realizar solicitud",
        icon: "plus-circle",
        path: "/admin/solicitudes/nueva",
        permission: "solicitudes.crear",
      },
    ],
  },
  {
    id: "renovacion",
    modulo: "activos",
    name: "Renovación",
    icon: "arrow-repeat",
    permission: "politicas.ver",
    children: [
      {
        id: "renovacion-sugerencias",
        name: "Sugerencias",
        icon: "exclamation-triangle",
        path: "/admin/renovacion/sugerencias",
      },
      {
        id: "renovacion-politicas",
        name: "Políticas",
        icon: "sliders",
        path: "/admin/politicas",
      },
    ],
  },
  // --- Matriz de obligaciones -------------------------------------------
  //
  // Sus permisos salen de los roles generales y de los de la empresa activa,
  // como los de cualquier módulo.
  {
    id: "matriz-resumen",
    modulo: "matriz",
    name: "Resumen",
    icon: "grid-1x2",
    path: "/admin/matriz/resumen",
    permission: PERMISOS_MATRIZ,
  },
  {
    id: "matriz-obligaciones",
    modulo: "matriz",
    name: "Matriz de obligaciones",
    icon: "building",
    path: "/admin/matriz/obligaciones",
    permission: PERMISOS_MATRIZ,
    // El contador de lo incumplido o que vence hoy (§15.1), que pinta el
    // menú lateral con `counts.attention` del resumen.
    insignia: "atencion",
  },
  {
    id: "matriz-calendario",
    modulo: "matriz",
    name: "Calendario",
    icon: "calendar3",
    path: "/admin/matriz/calendario",
    permission: PERMISOS_MATRIZ,
  },
  {
    id: "matriz-documentos",
    modulo: "matriz",
    name: "Documentos",
    icon: "folder2-open",
    path: "/admin/matriz/documentos",
    permission: PERMISOS_MATRIZ,
  },
  // --- Dashboards ---------------------------------------------------------
  //
  // Un solo listado: cada dashboard se abre desde ahí y sus pestañas viven
  // dentro de él.
  {
    id: "dashboards-lista",
    modulo: "dashboards",
    name: "Dashboards",
    icon: "bar-chart-line",
    path: RUTA_DASHBOARDS,
    permission: PERMISOS_DASHBOARDS,
    rutas: [RUTA_DASHBOARDS],
  },
  // --- General: igual en todos los módulos --------------------------------
  //
  // Reportes, configuración, usuarios y roles son del sistema, no de un
  // módulo: van en el bloque «General» al pie del menú.
  {
    // Uno solo, con una pestaña por asunto (ver `ReportesMarco`).
    id: "reportes",
    modulo: "comun",
    name: "Reportes",
    icon: "file-earmark-bar-graph",
    path: "/admin/reportes",
    permission: PERMISOS_REPORTES,
    rutas: ["/admin/reportes"],
  },
  {
    // Fuera de Configuración, como Reportes: es de todo el sistema y se
    // consulta a menudo. Sistema y Matriz, en pestañas (ver `AuditoriaMarco`).
    id: "auditoria",
    modulo: "comun",
    name: "Auditoría",
    icon: "shield-check",
    path: "/admin/auditoria",
    permission: PERMISOS_AUDITORIA,
    rutas: ["/admin/auditoria"],
  },
  {
    // Una sola entrada, como en la Matriz: lo que contiene —empresas,
    // usuarios, roles, permisos, catálogos, notificaciones, identidad visual
    // y respaldos— se elige con las pestañas de la propia pantalla (ver
    // `ConfiguracionMarco`). Como grupos desplegables ocupaban medio menú con
    // cosas que se abren de vez en cuando.
    //
    // `permission` es una lista: basta con poder abrir una sección para ver
    // la entrada. `rutas` son las direcciones de esas secciones, que conservan
    // las suyas, para que la entrada se marque estando en cualquiera de ellas.
    id: "configuracion",
    modulo: "comun",
    name: "Configuración",
    icon: "gear",
    path: "/admin/configuracion",
    permission: PERMISOS_CONFIGURACION,
    rutas: RUTAS_CONFIGURACION,
  },
];

function esVisible(permission, permissions) {
  if (!permission) return true;
  // Una lista se cumple con cualquiera de sus permisos (ver «Configuración»).
  if (Array.isArray(permission)) {
    return permission.some((codigo) => permissions.includes(codigo));
  }
  return permissions.includes(permission);
}

/**
 * Un hijo sin `permission` propio hereda el del grupo —así funcionaban todas
 * las entradas hasta ahora—, y el que lo declara se filtra por el suyo. El
 * grupo se muestra si le queda algún hijo visible: «Configuración» tiene que
 * aparecer para quien solo administra empresas, aunque no pueda tocar la
 * identidad institucional.
 *
 * Baja por todo el árbol y no solo un nivel: un subgrupo que mirara solo a sus
 * hijos directos dejaría los de más abajo heredando el permiso del abuelo, y se
 * los enseñaría a quien no puede abrirlos.
 */
function filterByPermission(items, permissions, heredado = undefined) {
  return items
    .map((item) => {
      const propio = item.permission ?? heredado;
      if (!item.children) {
        return esVisible(propio, permissions) ? item : null;
      }
      const children = filterByPermission(item.children, permissions, propio);
      return children.length > 0 ? { ...item, children } : null;
    })
    .filter(Boolean);
}

/**
 * El menú de un módulo, filtrado por los permisos del usuario autenticado:
 * sus entradas más las comunes (Configuración).
 */
export function getVisibleAdminMenu(
  permissions = [],
  modulo = MODULO_POR_DEFECTO,
) {
  const delModulo = ADMIN_MENU.filter(
    (item) => item.modulo === modulo || item.modulo === "comun",
  );
  return filterByPermission(delModulo, permissions);
}

/** Los módulos en los que la persona tiene algo que abrir, sin contar lo
 * común: un módulo cuya única entrada fuera Configuración no se ofrece. */
export function modulosConAcceso(permissions = []) {
  const modulos = new Set(
    filterByPermission(
      ADMIN_MENU.filter((item) => item.modulo !== "comun"),
      permissions,
    ).map((item) => item.modulo),
  );
  return [...modulos];
}
