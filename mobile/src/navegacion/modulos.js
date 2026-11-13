/**
 * El catálogo de la navegación de la app (US-016, 13/11/2026): los MÓDULOS
 * van en las pestañas de arriba y las FUNCIONALIDADES del módulo activo en la
 * barra flotante de abajo, como la app de Uber. Las pestañas, la barra y los
 * enlaces salen de aquí: un módulo nuevo es una entrada más, a la derecha
 * (decisión del usuario).
 *
 * Estructura (decisión del usuario, 13/11/2026, ronda 1): Institucional ·
 * Chat · Mesa de ayuda · Matriz de obligaciones (US-019). El Inicio ya no es
 * un módulo: es la primera funcionalidad de Institucional y donde se entra
 * por defecto.
 *
 * Es código puro (sin React) para poder probarlo solo. Las reglas de
 * visibilidad son las de antes de esta historia; el acceso efectivo lo sigue
 * decidiendo el servidor.
 *
 * El `contexto` que reciben `visible` e `insignia` lo arma
 * `useContextoDeNavegacion` con lo que ya había en la app:
 *
 * ```
 * {
 *   permisos: [...usuario.permissions],
 *   licencias: { porAprobar, puedeSolicitar, cargado },   // useResumenPermisos
 *   chat: { totalNoLeidos },                               // useTotalNoLeidos
 *   soporte: { delEquipo, noEsDelEquipo, misPendientes, asignados, aprobaciones },
 *   vistas: { institucional: "por_aprobar", mesa: "bandeja", chat: "grupos" }, // el parámetro de cada ruta
 * }
 * ```
 *
 * Un módulo puede tener varias pantallas de `(tabs)` (`pantallas`):
 * Institucional son el Inicio (`index`, ruta `/`) y los permisos
 * (`permisos`, `/permisos?seccion=`). Cada funcionalidad:
 * - `tipo: "vista"` cambia el contenido sin apilar pantallas: va a su
 *   `pantalla` (la del módulo si no dice otra) con sus `params`;
 * - `tipo: "accion"` abre otra pantalla del Stack (`ruta`), con su cabecera
 *   y «Volver».
 */
import { tieneAccesoALaMatriz } from "../matriz/formato";
import { esDelEquipo, rutaDeAltaPropia } from "../soporte/formato";

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

function permisosDe(contexto) {
  return contexto?.permisos ?? [];
}

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** La Bandeja: quien es del equipo por sus permisos, salvo que `bandeja/`
 * haya respondido 403 en esta empresa (US-014, CA-1). */
export function veLaBandeja(contexto) {
  const soporte = contexto?.soporte ?? {};
  const delEquipo = soporte.delEquipo ?? esDelEquipo(permisosDe(contexto));
  return Boolean(delEquipo) && !soporte.noEsDelEquipo;
}

/**
 * «Por aprobar» solo para quien aprueba (CA-6): con algo pendiente, con
 * `licencias.ver_por_aprobar` (Gestión Humana ve todo lo pendiente) o si un
 * aviso lleva a ella. La lista solo trae lo pendiente, así que quien no
 * tiene nada que aprobar no pierde nada.
 */
export function veLasPorAprobar(contexto) {
  const licencias = contexto?.licencias ?? {};
  return (
    (Number(licencias.porAprobar) || 0) > 0 ||
    permisosDe(contexto).includes("licencias.ver_por_aprobar") ||
    contexto?.vistas?.institucional === "por_aprobar"
  );
}

/** La Matriz de obligaciones, con cualquier permiso `matriz.*` en la empresa
 * activa, como el menú de la web (US-019, CA-1). Al cambiar de empresa la
 * app vuelve a leer los permisos y se reevalúa. */
export function veLaMatriz(contexto) {
  return tieneAccesoALaMatriz(permisosDe(contexto));
}

export const MODULOS = Object.freeze([
  {
    id: "institucional",
    texto: "Institucional",
    icono: "office-building-outline",
    // La primera es la de entrada (Atrás en Android vuelve a ella, CA-9).
    pantallas: ["index", "permisos"],
    pantalla: "index",
    pathnames: ["/", "/permisos"],
    parametro: "seccion",
    vistaPorDefecto: () => "inicio",
    dichoDeLaInsignia: (n) => `${n} por aprobar`,
    funcionalidades: [
      {
        id: "inicio",
        texto: "Inicio",
        icono: "home-outline",
        tipo: "vista",
        pantalla: "index",
        params: {},
      },
      {
        id: "mias",
        texto: "Solicitud de permisos",
        icono: "file-document-outline",
        tipo: "vista",
        pantalla: "permisos",
        params: { seccion: "mias" },
      },
      {
        // Solo para quien aprueba, justo tras «Solicitud de permisos»
        // (confirmado por el usuario, 13/11/2026).
        id: "por_aprobar",
        texto: "Por aprobar",
        // H-13: el portapapeles queda para las aprobaciones de tickets.
        icono: "calendar-check-outline",
        tipo: "vista",
        pantalla: "permisos",
        params: { seccion: "por_aprobar" },
        visible: veLasPorAprobar,
        insignia: (c) => c?.licencias?.porAprobar,
        dichoDeLaInsignia: (n) => `${n} por aprobar`,
      },
      {
        id: "vacaciones",
        texto: "Consulta de vacaciones",
        icono: "white-balance-sunny",
        tipo: "vista",
        pantalla: "permisos",
        params: { seccion: "vacaciones" },
      },
    ],
  },
  {
    id: "chat",
    texto: "Chat",
    icono: "chat-processing-outline",
    pantallas: ["chat"],
    pantalla: "chat",
    pathnames: ["/chat"],
    parametro: "vista",
    vistaPorDefecto: () => "conversaciones",
    // CA-7: «Chat, 3 sin leer».
    dichoDeLaInsignia: (n) => `${n} sin leer`,
    funcionalidades: [
      {
        id: "conversaciones",
        texto: "Conversaciones",
        icono: "forum-outline",
        tipo: "vista",
        // Sin `vista`: todas las conversaciones (`/chat`, como siempre).
        params: { vista: undefined },
        insignia: (c) => c?.chat?.totalNoLeidos,
        dichoDeLaInsignia: (n) => plural(n, "mensaje sin leer", "mensajes sin leer"),
      },
      {
        id: "nuevo",
        texto: "Nuevo mensaje",
        icono: "message-plus-outline",
        tipo: "accion",
        ruta: "/chat/nuevo",
      },
      {
        // La misma lista filtrada en el teléfono a los grupos (sin API nueva).
        id: "grupos",
        texto: "Mis grupos",
        icono: "account-group-outline",
        tipo: "vista",
        params: { vista: "grupos" },
      },
      {
        id: "mi_estado",
        texto: "Mi estado",
        icono: "account-clock-outline",
        tipo: "accion",
        ruta: "/chat/mi-estado",
      },
    ],
  },
  {
    id: "mesa",
    texto: "Mesa de ayuda",
    icono: "headset",
    pantallas: ["soporte"],
    pantalla: "soporte",
    pathnames: ["/soporte"],
    parametro: "vista",
    // La Bandeja es la de entrada para quien la puede ver; los demás, a sus
    // tickets (decisión del usuario, 13/11/2026).
    vistaPorDefecto: (c) => (veLaBandeja(c) ? "bandeja" : "mis"),
    dichoDeLaInsignia: (n) => plural(n, "pendiente", "pendientes"),
    funcionalidades: [
      {
        id: "bandeja",
        texto: "Bandeja",
        // WCAG 2.5.3: el nombre accesible empieza por lo que se ve.
        dicho: "Bandeja del equipo",
        icono: "inbox-outline",
        tipo: "vista",
        params: { vista: "bandeja" },
        visible: veLaBandeja,
        insignia: (c) => c?.soporte?.asignados,
        dichoDeLaInsignia: (n) => plural(n, "asignado a usted", "asignados a usted"),
      },
      {
        id: "mis",
        texto: "Mis tickets",
        icono: "ticket-outline",
        tipo: "vista",
        params: { vista: "mis" },
        insignia: (c) => c?.soporte?.misPendientes,
        dichoDeLaInsignia: (n) => `${n} ${n === 1 ? "necesita" : "necesitan"} algo de usted`,
      },
      {
        // Solo para quien aprueba, justo tras «Mis tickets» (confirmado por
        // el usuario, 13/11/2026).
        id: "aprobaciones",
        texto: "Aprobaciones",
        icono: "clipboard-check-outline",
        tipo: "vista",
        params: { vista: "aprobaciones" },
        // Si hay alguna pendiente, o si un aviso lleva a ellas (US-014).
        visible: (c) => (Number(c?.soporte?.aprobaciones) || 0) > 0 || c?.vistas?.mesa === "aprobaciones",
        insignia: (c) => c?.soporte?.aprobaciones,
        dichoDeLaInsignia: (n) => plural(n, "pendiente", "pendientes"),
      },
      {
        id: "nuevo",
        texto: "Nuevo ticket",
        icono: "plus-circle-outline",
        tipo: "accion",
        ruta: "/soporte/nuevo",
        visible: (c) => rutaDeAltaPropia(permisosDe(c)) !== null,
      },
      {
        id: "registrar",
        texto: "Registrar",
        dicho: "Registrar ticket a nombre de otra persona",
        icono: "phone-plus-outline",
        tipo: "accion",
        ruta: "/soporte/registrar",
        visible: (c) => permisosDe(c).includes("soporte.registrar") && !c?.soporte?.noEsDelEquipo,
      },
    ],
  },
  {
    // US-019 (13/11/2026): después de la Mesa de ayuda, con «Bandeja» por
    // defecto y «Calendario». El detalle y los ajustes rápidos se abren desde
    // ellas, en el Stack (`/matriz/periodo/ID`).
    id: "matriz",
    texto: "Matriz de obligaciones",
    icono: "book-check-outline",
    pantallas: ["matriz"],
    pantalla: "matriz",
    pathnames: ["/matriz"],
    parametro: "vista",
    vistaPorDefecto: () => "bandeja",
    funcionalidades: [
      {
        id: "bandeja",
        texto: "Bandeja",
        dicho: "Bandeja de la Matriz",
        icono: "view-grid-outline",
        tipo: "vista",
        params: { vista: "bandeja" },
        visible: veLaMatriz,
      },
      {
        id: "calendario",
        texto: "Calendario",
        dicho: "Calendario de vencimientos",
        icono: "calendar-month-outline",
        tipo: "vista",
        params: { vista: "calendario" },
        visible: veLaMatriz,
      },
    ],
  },
]);

export function moduloPorId(id) {
  return MODULOS.find((m) => m.id === id) ?? null;
}

/** El módulo de una pantalla de `(tabs)` («index» y «permisos» son de
 * Institucional). */
export function moduloDePantalla(pantalla, catalogo = MODULOS) {
  return catalogo.find((m) => m.pantallas.includes(pantalla)) ?? null;
}

/** La pantalla de `(tabs)` de una funcionalidad. */
export function pantallaDe(funcionalidad, modulo = moduloPorId(funcionalidad.modulo)) {
  return funcionalidad.pantalla ?? modulo?.pantalla;
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function esVisible(funcionalidad, contexto) {
  return typeof funcionalidad.visible === "function" ? Boolean(funcionalidad.visible(contexto)) : true;
}

export function insigniaDe(funcionalidad, contexto) {
  return typeof funcionalidad.insignia === "function" ? numero(funcionalidad.insignia(contexto)) : 0;
}

/** Lo que dice el lector de pantalla: lo visible primero (WCAG 2.5.3) y,
 * con insignia, el número. */
export function nombreAccesible(funcionalidad, cuenta = 0) {
  const base = funcionalidad.dicho ?? funcionalidad.texto;
  if (!cuenta) return base;
  const dicho = funcionalidad.dichoDeLaInsignia ? funcionalidad.dichoDeLaInsignia(cuenta) : String(cuenta);
  return `${base}, ${dicho}`;
}

/** Las funcionalidades que la persona puede usar en un módulo, con su
 * insignia. */
export function funcionalidadesVisibles(modulo, contexto) {
  if (!modulo) return [];
  return modulo.funcionalidades
    .filter((f) => esVisible(f, contexto))
    .map((f) => ({ ...f, modulo: modulo.id, cuenta: insigniaDe(f, contexto) }));
}

/**
 * Los módulos con su pestaña (CA-1, CA-6 y CA-7): sin funcionalidades
 * visibles, el módulo no se muestra. La insignia es la suma de las de sus
 * funcionalidades visibles. `catalogo` se recibe para probarlo con un módulo
 * ficticio.
 */
export function modulosVisibles(contexto, catalogo = MODULOS) {
  return catalogo
    .map((m) => {
      const funcionalidades = funcionalidadesVisibles(m, contexto);
      const cuenta = funcionalidades.reduce((suma, f) => suma + f.cuenta, 0);
      return { ...m, funcionalidadesVisibles: funcionalidades, cuenta };
    })
    .filter((m) => m.funcionalidadesVisibles.length > 0);
}

/** El nombre accesible de la pestaña de un módulo: «Chat, 3 sin leer». */
export function nombreAccesibleDelModulo(modulo) {
  if (!modulo.cuenta || !modulo.dichoDeLaInsignia) return modulo.texto;
  return `${modulo.texto}, ${modulo.dichoDeLaInsignia(modulo.cuenta)}`;
}

/**
 * La funcionalidad marcada en la barra (CA-8). `ruta`: la ruta activa de
 * `(tabs)` (`{ name, params }`). Se elige entre las vistas de ESA pantalla:
 * la que pide el parámetro (`seccion` o `vista`); si no vale o no se ve, la
 * de por defecto del módulo si es de esa pantalla, o la primera de ella.
 */
export function vistaActiva(modulo, ruta, contexto) {
  if (!modulo) return null;
  const pantalla = ruta?.name ?? modulo.pantalla;
  const vistas = modulo.funcionalidades.filter((f) => f.tipo === "vista" && pantallaDe(f, modulo) === pantalla);
  if (vistas.length === 0) return null;
  const pedida = modulo.parametro ? primero(ruta?.params?.[modulo.parametro]) : undefined;
  const conPedida = { ...contexto, vistas: { ...(contexto?.vistas ?? {}), [modulo.id]: pedida } };
  const valida = vistas.find(
    (f) => pedida !== undefined && f.params?.[modulo.parametro] === pedida && esVisible(f, conPedida),
  );
  if (valida) return valida.id;
  const visibles = vistas.filter((f) => esVisible(f, contexto));
  const porDefecto = modulo.vistaPorDefecto ? modulo.vistaPorDefecto(contexto) : null;
  if (visibles.some((f) => f.id === porDefecto)) return porDefecto;
  // Sin parámetro, la vista de la pantalla que no lo lleva (Conversaciones);
  // si no, la primera.
  const sinParametro = visibles.find((f) => f.params?.[modulo.parametro] === undefined);
  return (sinParametro ?? visibles[0] ?? vistas[0]).id;
}

/** Las rutas de los módulos: llevan a una pestaña de arriba, no a una
 * pantalla del Stack. */
export function esRutaDeModulo(ruta) {
  const texto = typeof ruta === "string" ? ruta : ruta?.pathname;
  if (typeof texto !== "string") return false;
  const camino = texto.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  return MODULOS.some((m) => m.pathnames.includes(camino));
}

/** La vista abierta de cada módulo, leída de los parámetros de sus rutas en
 * el estado de las pestañas (la barra y la cabecera, O-2). */
export function vistasDelEstado(state) {
  const vistas = {};
  for (const m of MODULOS) {
    if (!m.parametro) continue;
    const ruta = state?.routes?.find((r) => m.pantallas.includes(r.name) && r.params?.[m.parametro] !== undefined);
    vistas[m.id] = primero(ruta?.params?.[m.parametro]);
  }
  return vistas;
}
