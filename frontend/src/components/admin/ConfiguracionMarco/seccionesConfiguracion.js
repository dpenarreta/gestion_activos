import { matchesPath } from "../AdminSidebar/adminMenuTree";
import { PERMISOS_MATRIZ } from "../../../modulos/permisosMatriz";

/**
 * Las secciones de Configuración, en el orden de sus pestañas.
 *
 * Como en la Matriz, Configuración es **una sola entrada del menú** y lo que
 * contiene se elige con pestañas: empresas, usuarios y roles (con permisos),
 * catálogos, notificaciones, identidad visual, respaldos y auditoría. Antes eran dos grupos
 * desplegables —«Usuarios y roles» y «Configuración», este con un tercer nivel
 * para los catálogos de Organización— que ocupaban medio menú con cosas que se
 * abren de vez en cuando, y dejaban el inventario, que es lo diario, empujado
 * hacia abajo.
 *
 * Cada sección conserva su dirección de siempre (`/admin/users`,
 * `/admin/empresas`…): los enlaces guardados y las pruebas siguen valiendo, y
 * lo único que cambia es el marco que las rodea. `rutas` son los prefijos que
 * pertenecen a la sección —su listado, su alta y sus fichas—; gana el más
 * largo, para que `/admin/roles/permisos` sea «Permisos» y no «Roles».
 *
 * `subsecciones` dibuja una segunda fila cuando la sección agrupa varias
 * pantallas hermanas.
 */
export const SECCIONES_CONFIGURACION = [
  {
    // Primera: es lo que hay que crear antes que nada en un despliegue nuevo,
    // porque todo lo demás cuelga de una empresa.
    id: "empresas",
    // Una sola empresa (23/10/2026): sus datos, no un listado.
    nombre: "Empresa",
    path: "/admin/empresas",
    permission: "empresas.ver",
    rutas: ["/admin/empresas"],
  },
  {
    // Una sola pestaña (21/10/2026): quién entra, con qué rol y qué permite
    // cada rol se administran juntos. Cada apartado conserva su permiso.
    id: "usuarios",
    nombre: "Usuarios y roles",
    path: "/admin/users",
    permission: ["usuarios.ver", "roles.ver", "permisos.ver"],
    rutas: ["/admin/users", "/admin/roles"],
    subsecciones: [
      { nombre: "Usuarios", path: "/admin/users", permission: "usuarios.ver" },
      { nombre: "Roles", path: "/admin/roles", permission: "roles.ver" },
      {
        // El catálogo de permisos solo se consulta —se asigna al editar un
        // rol—, pero tiene su propio permiso y su propia pantalla.
        nombre: "Permisos",
        path: "/admin/roles/permisos",
        permission: "permisos.ver",
      },
    ],
  },
  {
    id: "catalogos",
    nombre: "Catálogos",
    path: "/admin/organizacion/sedes",
    // Los del inventario (organización) y los de la Matriz (áreas y
    // entidades de control) tienen permisos distintos: cada apartado declara
    // el suyo y la sección aparece con cualquiera.
    permission: ["organizacion.ver", "catalogos.ver"],
    rutas: ["/admin/organizacion", "/admin/catalogos"],
    subsecciones: [
      {
        nombre: "Sedes",
        path: "/admin/organizacion/sedes",
        permission: "organizacion.ver",
      },
      {
        nombre: "Proveedores",
        path: "/admin/organizacion/proveedores",
        permission: "organizacion.ver",
      },
      // Junto a proveedores porque es la distinción que hay que ver al lado:
      // al proveedor se le compró el equipo, y el concesionario es su dueño.
      {
        nombre: "Concesionarios",
        path: "/admin/organizacion/concesionarios",
        permission: "organizacion.ver",
      },
      {
        nombre: "Empleados",
        path: "/admin/organizacion/empleados",
        permission: "organizacion.ver",
      },
      // Al final de los del inventario: se usa al arrancar y de vez en
      // cuando, no todos los días.
      {
        nombre: "Carga masiva",
        path: "/admin/catalogos/carga",
        permission: "organizacion.ver",
      },
      // Los de la Matriz, compartidos por todas las empresas.
      {
        // Se llamaban «Áreas» y se confundían con las del organigrama.
        nombre: "Temas de la Matriz",
        path: "/admin/catalogos/areas",
        permission: "catalogos.ver",
      },
      {
        nombre: "Entidades de control",
        path: "/admin/catalogos/entidades-control",
        permission: "catalogos.ver",
      },
    ],
  },
  {
    // Todos los avisos del sistema en un solo sitio: por dónde sale el correo,
    // las alertas del inventario y los recordatorios de la Matriz. Cada
    // apartado con su permiso; la sección aparece con cualquiera.
    id: "notificaciones",
    nombre: "Notificaciones",
    path: "/admin/configuracion/notificaciones",
    permission: [
      "configuracion.ver",
      "notificaciones.configurar",
      ...PERMISOS_MATRIZ,
    ],
    rutas: [
      "/admin/configuracion/notificaciones",
      "/admin/configuracion/recordatorios",
    ],
    subsecciones: [
      {
        nombre: "Correo del sistema",
        path: "/admin/configuracion/notificaciones",
        permission: "configuracion.ver",
      },
      {
        // Todos los correos del sistema: editar su diseño, ver sus
        // variables y previsualizarlos.
        nombre: "Plantillas de correo",
        path: "/admin/configuracion/notificaciones/plantillas",
        permission: "configuracion.ver",
      },
      {
        nombre: "Alertas del inventario",
        path: "/admin/configuracion/notificaciones/alertas",
        permission: "notificaciones.configurar",
      },
      {
        // Por empresa, como todo lo de la Matriz: la ve cualquiera con algún
        // permiso del módulo, y la pantalla dice si puede cambiarla.
        nombre: "Recordatorios de la Matriz",
        path: "/admin/configuracion/recordatorios",
        permission: PERMISOS_MATRIZ,
      },
    ],
  },
  {
    id: "identidad",
    nombre: "Identidad visual",
    path: "/admin/configuracion/identidad",
    permission: "configuracion.ver",
    rutas: [
      "/admin/configuracion/identidad",
      "/admin/configuracion/colores-tipografia",
      "/admin/configuracion/apariencia",
    ],
    subsecciones: [
      { nombre: "Identidad", path: "/admin/configuracion/identidad" },
      {
        nombre: "Colores y tipografía",
        path: "/admin/configuracion/colores-tipografia",
      },
      { nombre: "Apariencia", path: "/admin/configuracion/apariencia" },
    ],
  },
  {
    // Encender y apagar módulos de la empresa: apagado no lo ve nadie,
    // salvo el superusuario y quien tiene este permiso.
    id: "modulos",
    nombre: "Módulos",
    path: "/admin/configuracion/modulos",
    permission: "configuracion.modulos",
    rutas: ["/admin/configuracion/modulos"],
  },
  {
    // La ventana destacada que ve toda persona al entrar al sistema.
    id: "aviso-inicio",
    nombre: "Aviso al iniciar sesión",
    path: "/admin/configuracion/aviso-inicio",
    permission: "configuracion.aviso_inicio",
    rutas: ["/admin/configuracion/aviso-inicio"],
  },
  {
    // La mesa de ayuda de la empresa: su equipo, qué atiende cada quien, los
    // plazos y las respuestas predefinidas.
    id: "soporte",
    nombre: "Mesa de ayuda",
    path: "/admin/configuracion/soporte",
    permission: "soporte.configurar",
    rutas: ["/admin/configuracion/soporte"],
    subsecciones: [
      { nombre: "Equipo", path: "/admin/configuracion/soporte" },
      {
        nombre: "Categorías y casos",
        path: "/admin/configuracion/soporte/categorias",
      },
      { nombre: "SLA", path: "/admin/configuracion/soporte/sla" },
      {
        nombre: "Horario y metas",
        path: "/admin/configuracion/soporte/horario",
      },
      {
        nombre: "Respuestas predefinidas",
        path: "/admin/configuracion/soporte/respuestas",
      },
    ],
  },
  {
    // La plantilla con la que nace todo dashboard nuevo: es de
    // todas las empresas, por eso vive aquí y no en el módulo.
    id: "plantilla-dashboards",
    nombre: "Plantilla de dashboards",
    path: "/admin/configuracion/plantilla-dashboards",
    permission: "configuracion.ver",
    rutas: ["/admin/configuracion/plantilla-dashboards"],
  },
  {
    id: "respaldos",
    nombre: "Respaldos",
    path: "/admin/configuracion/respaldos",
    permission: "configuracion.ver",
    rutas: ["/admin/configuracion/respaldos"],
  },
];

/** Todos los prefijos de Configuración, para marcar su entrada del menú. */
export const RUTAS_CONFIGURACION = [
  "/admin/configuracion",
  ...SECCIONES_CONFIGURACION.flatMap((seccion) => seccion.rutas),
];

/** Los permisos que dan acceso a alguna sección: con uno basta para ver la
 * entrada «Configuración». */
export const PERMISOS_CONFIGURACION = [
  ...new Set(SECCIONES_CONFIGURACION.flatMap((seccion) => seccion.permission)),
];

function tiene(permisos, permission) {
  if (!permission) return true;
  const lista = Array.isArray(permission) ? permission : [permission];
  return lista.some((codigo) => permisos.includes(codigo));
}

/**
 * Las secciones que la persona puede abrir, cada una con solo sus apartados
 * permitidos y apuntando al primero de ellos: quien solo ve los catálogos de
 * la Matriz entra a «Catálogos» por «Áreas», no por un departamento que le
 * respondería 403.
 */
export function seccionesVisibles(permisos = []) {
  return SECCIONES_CONFIGURACION.filter((seccion) =>
    tiene(permisos, seccion.permission),
  ).map((seccion) => {
    if (!seccion.subsecciones) return seccion;
    const subsecciones = seccion.subsecciones.filter((sub) =>
      tiene(permisos, sub.permission),
    );
    return {
      ...seccion,
      subsecciones,
      path: subsecciones[0]?.path ?? seccion.path,
    };
  });
}

/** La sección a la que pertenece una ruta, o `null` si no es de Configuración. */
export function seccionDeRuta(pathname) {
  let mejor = null;
  let largo = 0;
  for (const seccion of SECCIONES_CONFIGURACION) {
    for (const ruta of seccion.rutas) {
      if (matchesPath(ruta, pathname) && ruta.length > largo) {
        mejor = seccion;
        largo = ruta.length;
      }
    }
  }
  return mejor;
}

/** La subsección activa: la de prefijo más largo que coincida. */
export function subseccionDeRuta(seccion, pathname) {
  return (seccion?.subsecciones ?? [])
    .filter((sub) => matchesPath(sub.path, pathname))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
