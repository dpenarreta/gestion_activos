/**
 * Árbol del Menú Administrativo — estático (a diferencia del proyecto
 * original del que se particionó la plantilla base, que lo resolvía vía un
 * sistema de menús configurable en backend). Este template base solo
 * necesita 4 entradas fijas; un proyecto concreto que agregue módulos de
 * negocio puede sumar entradas aquí sin tocar `AdminSidebar`/`AdminMenuItem`/
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
    id: "usuarios",
    name: "Usuarios",
    icon: "people",
    path: "/admin/users",
    permission: "usuarios.ver",
  },
  {
    id: "roles",
    name: "Roles",
    icon: "shield-lock",
    path: "/admin/roles",
    permission: "roles.ver",
  },
  {
    id: "permisos",
    name: "Permisos",
    icon: "key",
    path: "/admin/permissions",
    permission: "permisos.ver",
  },
  {
    id: "configuracion",
    name: "Configuración",
    icon: "gear",
    permission: "configuracion.ver",
    children: [
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

function filterByPermission(items, permissions) {
  return items
    .filter((item) => !item.permission || permissions.includes(item.permission))
    .map((item) => (item.children ? { ...item, children: item.children } : item));
}

/** Filtra el árbol completo por los permisos del usuario autenticado. */
export function getVisibleAdminMenu(permissions = []) {
  return filterByPermission(ADMIN_MENU, permissions);
}
