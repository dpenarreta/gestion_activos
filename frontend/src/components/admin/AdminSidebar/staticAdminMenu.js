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
import {
  PERMISO_MESA_CREAR,
  PERMISO_MESA_MIS_TICKETS,
  PERMISOS_SOPORTE,
  RUTA_SOPORTE,
} from "../../../modulos/permisosSoporte";
import {
  NOVA_CHAT,
  NOVA_CONOCIMIENTO_GESTIONAR,
  NOVA_CONOCIMIENTO_VER,
} from "../../../modulos/permisosGestionHumana";
import {
  ACCEDER as GH_ACCEDER,
  ADMINISTRAR as GH_ADMINISTRAR,
  CONSOLIDADO as GH_CONSOLIDADO,
  DEPURAR as GH_DEPURAR,
  HISTORIAL as GH_HISTORIAL,
  INGRESOS as GH_INGRESOS,
  PERMISOS as GH_PERMISOS,
  RUTA_GESTION_HUMANA,
  SALIDAS as GH_SALIDAS,
  EQUIPO_VER as GH_EQUIPO_VER,
  TAREAS_ACCEDER as GH_TAREAS_ACCEDER,
  TAREAS_ADMINISTRAR as GH_TAREAS_ADMINISTRAR,
  TAREAS_CERRAR_MES as GH_TAREAS_CERRAR_MES,
  TAREAS_REGULARIZAR as GH_TAREAS_REGULARIZAR,
  TAREAS_VALIDAR as GH_TAREAS_VALIDAR,
  PROYECTOS_ACCEDER as GH_PROYECTOS_ACCEDER,
  KPI_ACCEDER as GH_KPI_ACCEDER,
  KPI_EQUIPO as GH_KPI_EQUIPO,
  KPI_EJECUTIVO as GH_KPI_EJECUTIVO,
  KPI_ADMINISTRAR as GH_KPI_ADMINISTRAR,
  RIESGO_VER as GH_RIESGO_VER,
  PERMISOS_INFORMES as GH_PERMISOS_INFORMES,
  PERMISOS_MEJORA_CONTINUA as GH_PERMISOS_MEJORA,
  PERMISOS_REUNIONES as GH_PERMISOS_REUNIONES,
  ESCRITORIO_ACCEDER as GH_ESCRITORIO_ACCEDER,
} from "../../../modulos/permisosGestionHumana";
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
 * Cada item: { id, name, icon, path?, permission, requiere?, rutas?, children? }.
 * `requiere` (opcional): un código que además hace falta (`permission` Y
 * `requiere`), para las entradas que dependen de dos permisos a la vez.
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
    // La del equipo (su bandeja, la cola, todos; cada pestaña según sus
    // permisos). Quien no es del equipo entra por «Mis tickets».
    // La ficha de un ticket se abre desde la bandeja: la marca a ella.
    permission: PERMISOS_SOPORTE,
    rutas: [`${RUTA_SOPORTE}/tickets`],
  },
  {
    // La bandeja solo en «Mis tickets»: lo que la persona creó, con «Ver
    // sus tickets en la Mesa de ayuda» (09/11/2026). Quien es del equipo ya
    // la tiene como pestaña de «Bandeja» y no la ve repetida (`salvoCon`).
    // Es de todo empleado (todos los roles lo traen): no hace de alguien
    // «una cuenta con permisos» para la pantalla de 403 (ver `conPermiso`).
    // «Mis tickets» y no «Mis solicitudes», que es de Activos y con el mismo
    // ícono (auditoría UX/UI, 09/11/2026).
    id: "soporte-mis-solicitudes",
    modulo: "soporte",
    name: "Mis tickets",
    icon: "ticket-perforated",
    path: `${RUTA_SOPORTE}/bandeja?vista=creados`,
    rutas: [`${RUTA_SOPORTE}/bandeja`],
    permission: PERMISO_MESA_MIS_TICKETS,
    salvoCon: PERMISOS_SOPORTE,
    deTodoEmpleado: true,
  },
  {
    // Un ticket a su nombre, con el formulario de «Soporte TI», pero con su
    // propio permiso: «Crear tickets en la Mesa de ayuda» (09/11/2026).
    // Es de todo empleado (todos los roles lo traen): no hace de alguien
    // «una cuenta con permisos» para la pantalla de 403 (ver `conPermiso`).
    // El mismo nombre que el botón de la bandeja y el título del formulario
    // (auditoría UX/UI, 09/11/2026).
    id: "soporte-nuevo",
    modulo: "soporte",
    name: "Pedir ayuda a su nombre",
    icon: "plus-lg",
    path: `${RUTA_SOPORTE}/nuevo`,
    permission: PERMISO_MESA_CREAR,
    deTodoEmpleado: true,
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
  // --- Gestión Humana ----------------------------------------------------
  //
  // Dos secciones: Control operativo (Novedades) y Tareas y equipo. Quien
  // solo tiene una entrada de una sección la ve directa (`aplanarSiUno`).
  {
    id: "gh-control-operativo",
    modulo: "gestion_humana",
    name: "Control operativo",
    icon: "clipboard-data",
    aplanarSiUno: true,
    children: [
      // Cada pestaña de Nexo es una entrada. El menú mira los permisos del
      // catálogo; lo que depende del rol operativo (el Supervisor no consulta
      // el historial de registros aunque tenga `historial_ver`, por ejemplo)
      // lo dice `GET novedades/me/` dentro de la pantalla.
      {
        id: "gh-dias",
        modulo: "gestion_humana",
        name: "Días laborados",
        icon: "calendar3",
        path: `${RUTA_GESTION_HUMANA}/dias-laborados`,
        permission: GH_ACCEDER,
      },
      {
        id: "gh-horas",
        modulo: "gestion_humana",
        name: "Horas extras",
        icon: "clock-history",
        path: `${RUTA_GESTION_HUMANA}/horas-extras`,
        permission: GH_ACCEDER,
      },
      {
        id: "gh-colaboradores",
        modulo: "gestion_humana",
        name: "Colaboradores",
        icon: "people",
        path: `${RUTA_GESTION_HUMANA}/colaboradores`,
        permission: GH_ACCEDER,
      },
      {
        id: "gh-historial",
        modulo: "gestion_humana",
        name: "Historial de registros",
        icon: "journal-text",
        path: `${RUTA_GESTION_HUMANA}/historial`,
        // El historial es del Asistente de Operaciones y del Administrador; el
        // Supervisor tiene `historial_ver` solo para el Repositorio mensual
        // (`access.can_view_event_history`). El menú no conoce el rol operativo:
        // pide además el consolidado o administrar, que el Supervisor no tiene
        // de partida (ver el informe: una excepción que se lo conceda haría
        // visible la entrada, y la pantalla le explica que no le corresponde).
        permission: [GH_CONSOLIDADO, GH_ADMINISTRAR],
        requiere: GH_HISTORIAL,
      },
      {
        id: "gh-repositorio",
        modulo: "gestion_humana",
        name: "Repositorio mensual",
        icon: "archive",
        path: `${RUTA_GESTION_HUMANA}/repositorio`,
        permission: GH_HISTORIAL,
      },
      {
        // El Jefe de Operaciones la trabaja; el Administrador la consulta.
        id: "gh-depuradas",
        modulo: "gestion_humana",
        name: "Horas depuradas",
        icon: "funnel",
        path: `${RUTA_GESTION_HUMANA}/horas-depuradas`,
        permission: [GH_DEPURAR, GH_ADMINISTRAR],
      },
      {
        // Con sus propios permisos: no exige el acceso al resto del módulo.
        id: "gh-movimientos",
        modulo: "gestion_humana",
        name: "Ingresos y salidas",
        icon: "arrow-left-right",
        path: `${RUTA_GESTION_HUMANA}/ingresos-salidas`,
        permission: [GH_INGRESOS, GH_SALIDAS],
      },
      {
        // Permisos por rol, excepciones, plazos y destinatarios de correos: el
        // administrador del módulo.
        id: "gh-configuracion",
        modulo: "gestion_humana",
        name: "Configuración del módulo",
        icon: "sliders",
        path: `${RUTA_GESTION_HUMANA}/configuracion`,
        permission: [GH_PERMISOS, GH_ADMINISTRAR],
      },
    ],
  },
  {
    // Tareas y Equipo (fase 2a, portado de Nexo). Cada entrada exige además
    // `tareas.acceder`, que el servidor pide en toda petición de `/tasks/`.
    // El ámbito (de quién son las tareas, quién es de su equipo) lo decide
    // el organigrama en el servidor.
    id: "gh-tareas-equipo",
    modulo: "gestion_humana",
    name: "Tareas y equipo",
    icon: "kanban",
    aplanarSiUno: true,
    children: [
      {
        // Kanban, Tabla, Gantt y Repositorio son pestañas de la pantalla.
        id: "gh-tareas",
        modulo: "gestion_humana",
        name: "Tareas",
        icon: "kanban",
        path: `${RUTA_GESTION_HUMANA}/tareas`,
        permission: GH_TAREAS_ACCEDER,
      },
      {
        id: "gh-equipo",
        modulo: "gestion_humana",
        name: "Equipo",
        icon: "diagram-3",
        path: `${RUTA_GESTION_HUMANA}/equipo`,
        permission: GH_EQUIPO_VER,
        requiere: GH_TAREAS_ACCEDER,
      },
      {
        // Proyectos (fase 2b): no depende de Tareas; el servidor exige
        // `proyectos_gh.acceder` en toda petición de `/projects/`.
        id: "gh-proyectos",
        modulo: "gestion_humana",
        name: "Proyectos",
        icon: "folder2-open",
        path: `${RUTA_GESTION_HUMANA}/proyectos`,
        permission: GH_PROYECTOS_ACCEDER,
      },
      {
        // Mejora continua: ideas de mejora de procesos. No depende de
        // Tareas; el servidor pide uno de los tres `mejora_continua.*`. El
        // detalle (`mejora-continua/<id>`, destino de los avisos) cuelga de
        // aquí.
        id: "gh-mejora-continua",
        modulo: "gestion_humana",
        name: "Mejora continua",
        icon: "lightbulb",
        path: `${RUTA_GESTION_HUMANA}/mejora-continua`,
        permission: GH_PERMISOS_MEJORA,
      },
      {
        // Reuniones: no depende de Tareas; el servidor pide uno de los tres
        // `reuniones.*`. El detalle (`reuniones/<id>`, destino de los
        // avisos) cuelga de aquí.
        id: "gh-reuniones",
        modulo: "gestion_humana",
        name: "Reuniones",
        icon: "camera-video",
        path: `${RUTA_GESTION_HUMANA}/reuniones`,
        permission: GH_PERMISOS_REUNIONES,
      },
      {
        // Escritorio: notas y recordatorios personales. La insignia cuenta
        // las notas sin leer (`escritorio/notes/unread-count/`).
        id: "gh-escritorio",
        modulo: "gestion_humana",
        name: "Escritorio",
        icon: "sticky",
        path: `${RUTA_GESTION_HUMANA}/escritorio`,
        permission: GH_ESCRITORIO_ACCEDER,
        insignia: "notas_sin_leer",
      },
      {
        // Con `validar`, las de su equipo; con `regularizar`, toda la
        // empresa y las acciones en bloque.
        id: "gh-tiempo-objetivo",
        modulo: "gestion_humana",
        name: "Validaciones",
        icon: "stopwatch",
        path: `${RUTA_GESTION_HUMANA}/tiempo-objetivo`,
        permission: [GH_TAREAS_VALIDAR, GH_TAREAS_REGULARIZAR],
        requiere: GH_TAREAS_ACCEDER,
      },
      {
        id: "gh-cierre-mes",
        modulo: "gestion_humana",
        name: "Cierre de mes",
        icon: "calendar-check",
        path: `${RUTA_GESTION_HUMANA}/cierre-de-mes`,
        permission: GH_TAREAS_CERRAR_MES,
        requiere: GH_TAREAS_ACCEDER,
      },
      {
        // Ajustes con vigencia y el catálogo de motivos de registro de horas.
        id: "gh-ajustes-tareas",
        modulo: "gestion_humana",
        name: "Ajustes de tareas",
        icon: "sliders2",
        path: `${RUTA_GESTION_HUMANA}/ajustes-de-tareas`,
        permission: GH_TAREAS_ADMINISTRAR,
        requiere: GH_TAREAS_ACCEDER,
      },
    ],
  },
  {
    // Desempeño (fase 2b, portado de Nexo): el motor de KPI. Cada entrada
    // exige además `kpi.acceder`, que el servidor pide en toda petición de
    // `/analytics/`. De quién se ven los KPI lo decide el organigrama.
    id: "gh-desempeno",
    modulo: "gestion_humana",
    name: "Desempeño",
    icon: "graph-up-arrow",
    aplanarSiUno: true,
    children: [
      {
        id: "gh-mis-kpi",
        modulo: "gestion_humana",
        name: "Mis KPI",
        icon: "person-badge",
        path: `${RUTA_GESTION_HUMANA}/mis-kpi`,
        permission: GH_KPI_ACCEDER,
      },
      {
        // También el destino del aviso de riesgo operativo.
        id: "gh-kpi-equipo",
        modulo: "gestion_humana",
        name: "KPI del equipo",
        icon: "people",
        path: `${RUTA_GESTION_HUMANA}/kpi`,
        // Quien solo ve el riesgo operativo también entra (ve el del equipo).
        permission: [GH_KPI_EQUIPO, GH_RIESGO_VER],
        requiere: GH_KPI_ACCEDER,
      },
      {
        id: "gh-resumen-ejecutivo",
        modulo: "gestion_humana",
        name: "Resumen ejecutivo",
        icon: "clipboard2-data",
        path: `${RUTA_GESTION_HUMANA}/resumen-ejecutivo`,
        permission: GH_KPI_EJECUTIVO,
        requiere: GH_KPI_ACCEDER,
      },
      {
        // Informes ejecutivos (fase 2c): el historial de informes congelados,
        // su generación y el visor imprimible. Sin `requiere`: el servidor
        // no pide `kpi.acceder` en `/informes/`, le basta uno de los tres
        // `informes_gh.*`. El visor (`informes/<id>`) cuelga de aquí.
        id: "gh-informes",
        modulo: "gestion_humana",
        name: "Informes ejecutivos",
        icon: "file-earmark-bar-graph",
        path: `${RUTA_GESTION_HUMANA}/informes`,
        permission: GH_PERMISOS_INFORMES,
      },
      {
        id: "gh-inteligencia-preventiva",
        modulo: "gestion_humana",
        name: "Inteligencia preventiva",
        icon: "shield-check",
        path: `${RUTA_GESTION_HUMANA}/inteligencia-preventiva`,
        permission: GH_RIESGO_VER,
        requiere: GH_KPI_ACCEDER,
      },
      {
        id: "gh-ajustes-kpi",
        modulo: "gestion_humana",
        name: "Ajustes de KPI",
        icon: "sliders2-vertical",
        path: `${RUTA_GESTION_HUMANA}/ajustes-de-kpi`,
        permission: GH_KPI_ADMINISTRAR,
        requiere: GH_KPI_ACCEDER,
      },
    ],
  },
  {
    // Nova, la asistente con IA (09/11/2026; en Nexo, «Asistente»): el chat
    // y su base de conocimiento. Viven en `/admin/nova`, del módulo Gestión
    // Humana (`modulos.js`). El servidor vuelve a autorizar cada petición.
    id: "gh-nova",
    modulo: "gestion_humana",
    name: "Nova",
    icon: "stars",
    aplanarSiUno: true,
    children: [
      {
        id: "gh-nova-chat",
        modulo: "gestion_humana",
        name: "Conversar con Nova",
        icon: "stars",
        path: "/admin/nova",
        permission: NOVA_CHAT,
      },
      {
        id: "gh-nova-conocimiento",
        modulo: "gestion_humana",
        name: "Base de conocimiento",
        icon: "journal-text",
        path: "/admin/nova/conocimiento",
        permission: [NOVA_CONOCIMIENTO_VER, NOVA_CONOCIMIENTO_GESTIONAR],
      },
    ],
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
      "roles_pago.seguimiento",
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
          "roles_pago.seguimiento",
        ],
        // El rol del mes por aceptar (el del aviso al entrar) y las
        // correcciones de Talento Humano que esperan su confirmación.
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
    // Las solicitudes de derechos sobre datos personales (LOPDP), junto a
    // Auditoría: son de toda la intranet, no de un módulo. Solo quien las ve
    // o las atiende; cada persona pide las suyas desde «Mi perfil».
    id: "privacidad",
    modulo: "comun",
    name: "Protección de datos",
    icon: "shield-lock",
    path: "/admin/privacidad/solicitudes",
    permission: ["privacidad.ver", "privacidad.atender"],
    // Las abiertas que ya pasaron su fecha límite.
    insignia: "privacidad_vencidas",
    rutas: ["/admin/privacidad"],
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
      if (item.requiere && !permissions.includes(item.requiere)) return null;
      // `salvoCon`: no se muestra a quien ya tiene alguno de esos permisos
      // (lo tiene por otra entrada, como «Mis solicitudes» dentro de la
      // «Bandeja» del equipo de la Mesa).
      if (item.salvoCon && esVisible(item.salvoCon, permissions)) return null;
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

/** Las opciones que exigen algún permiso (sin las que vería cualquiera, ni
 * las de todo empleado, como «Nuevo ticket» de la Mesa de ayuda). Sirve para
 * saber si alguien tiene permisos de verdad (la pantalla de inicio y el 403). */
export function conPermiso(items) {
  return items.filter(
    (item) =>
      (item.permission && !item.deTodoEmpleado) || item.children?.length,
  );
}
