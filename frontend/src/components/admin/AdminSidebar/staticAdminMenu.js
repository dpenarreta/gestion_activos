/**
 * Árbol del Menú Administrativo — estático, no configurable desde el
 * backend. Hoy son 4 entradas fijas; cada módulo de negocio que se agregue
 * suma su entrada aquí sin tocar `AdminSidebar`/`AdminMenuItem`/
 * `AdminMenuGroup` (que solo consumen esta forma de datos, sin saber de
 * dónde viene).
 *
 * Cada item: { id, name, icon, path?, permission, children? }. `permission`
 * filtra la entrada completa (y sus hijos) si el usuario no lo tiene — la
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
    // Va justo después del panel: es la pantalla desde la que se decide qué
    // hacer hoy, y esconderla dentro de un submenú la volvería opcional.
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
    id: "organizacion",
    name: "Organización",
    icon: "diagram-3",
    permission: "organizacion.ver",
    children: [
      {
        id: "organizacion-departamentos",
        name: "Departamentos",
        icon: "building",
        path: "/admin/organizacion/departamentos",
      },
      {
        id: "organizacion-sedes",
        name: "Sedes",
        icon: "buildings",
        path: "/admin/organizacion/sedes",
      },
      {
        id: "organizacion-proveedores",
        name: "Proveedores",
        icon: "truck",
        path: "/admin/organizacion/proveedores",
      },
      {
        id: "organizacion-empleados",
        name: "Empleados",
        icon: "person-badge",
        path: "/admin/organizacion/empleados",
      },
      {
        // Al final del grupo: se usa una vez al arrancar y de vez en cuando,
        // no todos los días como los catálogos de arriba.
        id: "organizacion-carga",
        name: "Carga de catálogos",
        icon: "file-earmark-arrow-up",
        path: "/admin/catalogos/carga",
      },
    ],
  },
  {
    // Usuarios y roles son un mismo asunto —quién entra y qué puede hacer—,
    // y se consultan juntos: al revisar por qué alguien no ve una pantalla,
    // se salta de su ficha al rol y viceversa. El catálogo de permisos no es
    // una entrada propia: vive como pestaña dentro de Roles, que es donde
    // efectivamente se asignan (ver pages/Admin/Roles/RolesPage.jsx).
    id: "accesos",
    name: "Usuarios y roles",
    icon: "people",
    permission: "usuarios.ver",
    children: [
      {
        id: "accesos-usuarios",
        name: "Usuarios",
        icon: "person",
        path: "/admin/users",
      },
      {
        id: "accesos-roles",
        name: "Roles y permisos",
        icon: "shield-lock",
        path: "/admin/roles",
      },
    ],
  },
  {
    id: "configuracion",
    name: "Configuración",
    icon: "gear",
    permission: "configuracion.ver",
    children: [
      {
        // Primero de la lista: es lo que hay que crear antes que nada en un
        // despliegue nuevo, porque todo lo demás cuelga de una empresa.
        id: "configuracion-empresas",
        name: "Empresas",
        icon: "buildings",
        path: "/admin/empresas",
        permission: "empresas.ver",
      },
      {
        id: "configuracion-identidad",
        name: "Identidad",
        icon: "image",
        path: "/admin/configuracion/identidad",
      },
      {
        id: "configuracion-colores",
        name: "Colores y tipografía",
        icon: "palette",
        path: "/admin/configuracion/colores-tipografia",
      },
      {
        id: "configuracion-apariencia",
        name: "Apariencia",
        icon: "circle-half",
        path: "/admin/configuracion/apariencia",
      },
    ],
  },
];

function esVisible(permission, permissions) {
  return !permission || permissions.includes(permission);
}

/**
 * Un hijo sin `permission` propio hereda el del grupo —así funcionaban todas
 * las entradas hasta ahora—, y el que lo declara se filtra por el suyo. El
 * grupo se muestra si le queda algún hijo visible: «Configuración» tiene que
 * aparecer para quien solo administra empresas, aunque no pueda tocar la
 * identidad institucional.
 */
function filterByPermission(items, permissions) {
  return items
    .map((item) => {
      if (!item.children) {
        return esVisible(item.permission, permissions) ? item : null;
      }
      const children = item.children.filter((child) =>
        esVisible(child.permission ?? item.permission, permissions),
      );
      return children.length > 0 ? { ...item, children } : null;
    })
    .filter(Boolean);
}

/** Filtra el árbol completo por los permisos del usuario autenticado. */
export function getVisibleAdminMenu(permissions = []) {
  return filterByPermission(ADMIN_MENU, permissions);
}
