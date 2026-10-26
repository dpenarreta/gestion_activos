import {
  PERMISOS_CONFIGURACION,
  RUTAS_CONFIGURACION,
} from "../ConfiguracionMarco/seccionesConfiguracion";
import { MODULO_POR_DEFECTO } from "../../../modulos/modulos";
import {
  PERMISOS_INSTITUCIONAL,
  RUTA_INSTITUCIONAL,
} from "../../../modulos/permisosInstitucional";
import { PERMISOS_MATRIZ } from "../../../modulos/permisosMatriz";
import {
  PERMISOS_DASHBOARDS,
  RUTA_DASHBOARDS,
} from "../../../modulos/permisosDashboards";
import { RUTA_SOPORTE } from "../../../modulos/permisosSoporte";
import {
  PERMISOS_ORDENES,
  RUTA_ORDENES,
} from "../../../modulos/permisosOrdenes";
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
        // Cargar es crear: con solo ver, la pantalla respondería 403.
        permission: "activos.crear",
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
  // --- Órdenes de trabajo -------------------------------------------------
  {
    id: "ordenes-panel",
    modulo: "sedes",
    name: "Panel",
    icon: "speedometer2",
    path: `${RUTA_ORDENES}/panel`,
    permission: PERMISOS_ORDENES,
  },
  {
    id: "ordenes-lista",
    modulo: "sedes",
    name: "Órdenes de trabajo",
    icon: "tools",
    // La ficha y el alta cuelgan del listado, así que también lo marcan.
    path: `${RUTA_ORDENES}/lista`,
    permission: PERMISOS_ORDENES,
  },
  // --- Mesa de ayuda -------------------------------------------------------
  {
    id: "soporte-bandeja",
    modulo: "soporte",
    name: "Bandeja",
    icon: "inbox",
    path: `${RUTA_SOPORTE}/bandeja`,
    // Sin permiso (21/10/2026): toda persona ve ahí sus solicitudes; lo del
    // equipo (su bandeja, la cola, todos) lo decide cada pestaña.
    // La ficha de un ticket se abre desde la bandeja: la marca a ella.
    rutas: [`${RUTA_SOPORTE}/tickets`],
  },
  {
    id: "soporte-todos",
    modulo: "soporte",
    name: "Todos los tickets",
    icon: "list-task",
    path: `${RUTA_SOPORTE}/todos`,
    permission: "soporte.ver_todos",
  },
  {
    id: "soporte-horario",
    modulo: "soporte",
    name: "Mi horario",
    icon: "calendar-week",
    path: `${RUTA_SOPORTE}/mi-horario`,
    permission: "soporte.atender",
  },
  {
    id: "soporte-horas",
    modulo: "soporte",
    name: "Horas fuera de horario",
    icon: "moon-stars",
    path: `${RUTA_SOPORTE}/horas`,
    permission: ["soporte.atender", "soporte.aprobar_horas"],
  },
  {
    id: "soporte-formulario",
    modulo: "soporte",
    name: "Formulario",
    icon: "ui-checks",
    path: `${RUTA_SOPORTE}/formulario`,
    permission: "soporte.formulario",
  },
  // --- Institucional ------------------------------------------------------
  {
    // Sin permiso: es a donde entra toda persona al iniciar sesión.
    id: "institucional-inicio",
    modulo: "institucional",
    name: "Inicio",
    icon: "house",
    path: `${RUTA_INSTITUCIONAL}/inicio`,
    // «Gestionar noticias» y «Gestionar calendario» cuelgan del Inicio.
    rutas: [
      `${RUTA_INSTITUCIONAL}/noticias`,
      `${RUTA_INSTITUCIONAL}/calendario`,
    ],
  },
  {
    id: "institucional-organigrama",
    modulo: "institucional",
    name: "Organigrama",
    icon: "diagram-3",
    path: `${RUTA_INSTITUCIONAL}/organigrama`,
    // Lo ve quien tenga cualquiera de los permisos del organigrama. La
    // estructura (y su pestaña de asignación de cargos) no va en el menú: se
    // abre con el botón «Editar estructura» del organigrama, que también pide
    // su permiso.
    permission: PERMISOS_INSTITUCIONAL,
    rutas: [`${RUTA_INSTITUCIONAL}/estructura`],
  },
  {
    // Sin permiso: cada persona pide sus permisos y aprueba lo que le toca;
    // configurar los flujos cuelga de aquí (con su permiso).
    id: "institucional-permisos",
    modulo: "institucional",
    name: "Solicitud de permisos",
    icon: "calendar-check",
    path: `${RUTA_INSTITUCIONAL}/permisos`,
    permission: ["licencias.solicitar", "licencias.ver_todas"],
    // Cuántas solicitudes tiene por aprobar quien entra.
    insignia: "por_aprobar",
    rutas: [`${RUTA_INSTITUCIONAL}/permisos`],
  },
  {
    // Sin permiso: toda persona pide proyectos con su plantilla llena y
    // atiende los que le tocan; configurar los tipos cuelga de aquí.
    id: "institucional-proyectos",
    modulo: "institucional",
    name: "Solicitud de proyectos",
    icon: "kanban",
    path: `${RUTA_INSTITUCIONAL}/proyectos`,
    // Cuántas solicitudes tiene por atender quien entra.
    insignia: "proyectos_por_atender",
    rutas: [`${RUTA_INSTITUCIONAL}/proyectos`],
  },
  {
    // Sin permiso: cada persona ve sus días de vacaciones.
    id: "institucional-vacaciones",
    modulo: "institucional",
    name: "Mis vacaciones",
    icon: "sun",
    path: `${RUTA_INSTITUCIONAL}/vacaciones`,
  },
  {
    // Sin permiso: el plan de capacitación de cada persona (empresa, área y
    // cargo) con sus evaluaciones.
    id: "institucional-onboarding",
    modulo: "institucional",
    name: "Mi onboarding",
    icon: "mortarboard",
    path: `${RUTA_INSTITUCIONAL}/onboarding`,
    insignia: "onboarding",
  },
  {
    // Un grupo (21/10/2026): consultar el propio rol y, para Talento Humano,
    // las observaciones. Antes eran dos entradas sueltas y, como la dirección
    // de las observaciones empieza por la del rol, al abrirlas quedaban las
    // dos marcadas.
    id: "institucional-rol-pagos",
    modulo: "institucional",
    name: "Rol de pagos",
    icon: "cash-coin",
    // Quien no atiende observaciones ve directo «Consultar rol de pagos»: un
    // grupo de una sola entrada es un clic de más.
    aplanarSiUno: true,
    permission: [
      "roles_pago.consultar",
      "roles_pago.habilitar",
      "roles_pago.historial",
      "roles_pago.configurar",
      "roles_pago.observaciones",
      "roles_pago.descarga_masiva",
    ],
    children: [
      {
        // El código sale de la sesión; ver pide aceptar los términos y la
        // contraseña. Talento Humano consulta otros con `consultar_todos`.
        id: "institucional-rol-pagos-consultar",
        name: "Consultar rol de pagos",
        icon: "cash-coin",
        path: `${RUTA_INSTITUCIONAL}/rol-pagos`,
        // Solo esta dirección: las observaciones cuelgan de ella y no deben
        // marcarla.
        exacto: true,
        // Quien está habilitado consulta el suyo; nómina entra a sus
        // herramientas (historial, textos, habilitados) desde la misma pantalla.
        permission: [
          "roles_pago.consultar",
          "roles_pago.habilitar",
          "roles_pago.historial",
          "roles_pago.configurar",
          "roles_pago.descarga_masiva",
        ],
        // Las correcciones de Talento Humano que esperan su confirmación.
        insignia: "rol_por_confirmar",
      },
      {
        // Talento Humano: las observaciones de las personas a su rol.
        id: "institucional-observaciones-rol",
        name: "Observaciones",
        icon: "chat-left-dots",
        path: `${RUTA_INSTITUCIONAL}/rol-pagos/observaciones`,
        permission: "roles_pago.observaciones",
        insignia: "observaciones_rol",
      },
    ],
  },
  {
    // Sin permiso: toda persona lee los códigos y reglamentos de la empresa.
    id: "institucional-codigos",
    modulo: "institucional",
    name: "Códigos de conducta",
    icon: "journal-text",
    path: `${RUTA_INSTITUCIONAL}/codigos`,
    // La gestión no va en el menú: se abre con su botón, con su permiso.
    rutas: [`${RUTA_INSTITUCIONAL}/codigos`],
  },
  {
    // Sin permiso: toda persona envía sugerencias o reporta errores; quien
    // tiene `sugerencias.gestionar` ve y responde todos en la misma pantalla.
    id: "institucional-sugerencias",
    modulo: "institucional",
    name: "Sugerencias y errores",
    icon: "chat-square-heart",
    path: `${RUTA_INSTITUCIONAL}/sugerencias`,
    permission: ["sugerencias.reportar", "sugerencias.gestionar"],
    // Los reportes nuevos; el servidor devuelve 0 a quien no los gestiona.
    insignia: "sugerencias",
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
  return filterByPermission(delModulo, permissions).map((item) =>
    item.aplanarSiUno && item.children?.length === 1
      ? { ...item.children[0], modulo: item.modulo }
      : item,
  );
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

/** Los módulos en los que la persona tiene algún permiso de verdad: sin
 * contar Institucional por su «Inicio», que es de todos. */
export function modulosConPermiso(permissions = []) {
  return [
    ...new Set(
      filterByPermission(
        conPermiso(ADMIN_MENU.filter((item) => item.modulo !== "comun")),
        permissions,
      ).map((item) => item.modulo),
    ),
  ];
}

/** Las opciones que exigen algún permiso (sin las que vería cualquiera).
 * Sirve para saber si alguien tiene permisos de verdad (la pantalla de inicio
 * y el 403). */
export function conPermiso(items) {
  return items.filter((item) => item.permission || item.children?.length);
}
