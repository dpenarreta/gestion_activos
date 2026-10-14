import {
  PERMISOS_CONFIGURACION,
  RUTAS_CONFIGURACION,
} from "../ConfiguracionMarco/seccionesConfiguracion";

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
    name: "Panel principal",
    icon: "speedometer2",
    path: "/admin/dashboard",
    permission: "activos.ver",
  },
  {
    // Arriba, junto al panel: es la pantalla desde la que se decide qué hacer
    // hoy, y esconderla dentro de un submenú la volvería opcional.
    id: "alertas",
    name: "Alertas",
    icon: "bell",
    path: "/admin/alertas",
    permission: "alertas.ver",
  },
  {
    id: "activos",
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
  {
    // Los reportes son transversales: cruzan activos, custodia y
    // mantenimientos, así que no cuelgan de ninguno de los tres.
    id: "reportes",
    name: "Reportes",
    icon: "file-earmark-bar-graph",
    path: "/admin/reportes",
    permission: "reportes.ver",
  },
  {
    // Una sola entrada, como en la Matriz: lo que contiene —empresas,
    // usuarios, roles, permisos, catálogos, identidad visual, respaldos y
    // auditoría— se elige con las pestañas de la propia pantalla (ver
    // `ConfiguracionMarco`). Como grupos desplegables ocupaban medio menú con
    // cosas que se abren de vez en cuando.
    //
    // `permission` es una lista: basta con poder abrir una sección para ver
    // la entrada. `rutas` son las direcciones de esas secciones, que conservan
    // las suyas, para que la entrada se marque estando en cualquiera de ellas.
    id: "configuracion",
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

/** Filtra el árbol completo por los permisos del usuario autenticado. */
export function getVisibleAdminMenu(permissions = []) {
  return filterByPermission(ADMIN_MENU, permissions);
}
