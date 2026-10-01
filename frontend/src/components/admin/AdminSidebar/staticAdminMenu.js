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
      {
        // Aquí y no en Configuración: quien abre la auditoría viene de una
        // pregunta sobre una persona —quién cambió esto, qué tocó fulano— y
        // ese hilo empieza en su ficha o en su rol, que están al lado. Lleva
        // permiso propio para que un auditor sin `usuarios.ver` siga viendo
        // el grupo, con esta entrada sola dentro.
        id: "accesos-auditoria",
        name: "Auditoría",
        icon: "clipboard-data",
        path: "/admin/auditoria",
        permission: "auditoria.ver",
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
      {
        // Aquí y no en un grupo propio: es configuración del sistema, se toca
        // una vez al montarlo y se vuelve cuando alguien pregunta de cuándo se
        // puede volver.
        id: "configuracion-respaldos",
        name: "Respaldos",
        icon: "shield-check",
        path: "/admin/configuracion/respaldos",
      },
      // Al final y como grupo propio, no disuelto entre los de arriba: sus seis
      // catálogos son lo que más se abre de esta sección, y sueltos dejarían
      // «Identidad» y «Apariencia» perdidas en una lista de diez. Los cuatro
      // que ya estaban se quedan donde estaban.
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
            // Justo debajo de proveedores porque es la distinción que hay que ver
            // al lado: al proveedor se le compró el equipo, y el concesionario es
            // su dueño.
            id: "organizacion-concesionarios",
            name: "Concesionarios",
            icon: "box-seam",
            path: "/admin/organizacion/concesionarios",
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
 *
 * Baja por todo el árbol y no solo un nivel: con «Organización» colgando de
 * «Configuración», mirar únicamente a los hijos directos dejaría los seis
 * catálogos sin filtrar —heredando el permiso del abuelo— y se los enseñaría a
 * quien solo puede cambiar los colores del sitio.
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
