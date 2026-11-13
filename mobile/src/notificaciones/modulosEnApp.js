/**
 * Qué módulos de las notificaciones ya tienen pantalla en la app, y a cuál
 * llevan (CA-8 de US-009). La clave es `modulo` de la notificación
 * (`backend/apps/notificaciones/modulos.py`); el valor, la ruta de Expo Router
 * o una función que la arma con la notificación.
 *
 * - US-010 (Fase 2, 12/11/2026): `licencias` → Solicitud de permisos y Mis
 *   vacaciones (`rutaDeLicencias`).
 * - US-011 (Fase 3, 12/11/2026): `chat` → la conversación del aviso
 *   (`rutaDeChat`).
 * - US-014 (Fase 4, 13/11/2026): `soporte` → la ficha del ticket, las
 *   aprobaciones o la Mesa de ayuda (`rutaDeSoporte`).
 * - US-019 (Fase 5, 13/11/2026): `matriz` → el detalle de la obligación
 *   (`rutaDeMatriz`); antes iba a la web.
 */
import { conversacionDelEnlace } from "../chat/enlace";

/** El ID de la empresa de una notificación (número, texto u objeto `{id}`),
 * solo dígitos. */
function idDeEmpresa(empresa) {
  const id = empresa && typeof empresa === "object" ? empresa.id : empresa;
  return id !== undefined && id !== null && /^\d{1,12}$/.test(String(id)) ? String(id) : null;
}

/**
 * A dónde lleva un aviso de permisos (CA-12). Los de una solicitud traen el
 * enlace `/admin/institucional/permisos?solicitud=ID` (`licencias.services.
 * _enlace`): van a su detalle, con la empresa de la notificación como
 * `X-Empresa` (B3 de la US-009). El de los fines de semana marcados lleva a
 * `/admin/institucional/vacaciones`: va a «Mis vacaciones». Cualquier otro,
 * o un `solicitud` que no sea solo dígitos, a la pestaña «Permisos».
 */
export function rutaDeLicencias(notificacion) {
  const enlace = typeof notificacion?.enlace === "string" ? notificacion.enlace : "";
  const [ruta, consulta = ""] = enlace.split("#")[0].split("?");
  const parametros = consulta.split("&").map((par) => par.split("="));
  const solicitud = parametros.find(([clave]) => clave === "solicitud")?.[1];
  const empresa = idDeEmpresa(notificacion?.empresa);
  if (ruta === "/admin/institucional/permisos" && solicitud && /^\d{1,12}$/.test(solicitud)) {
    return `/permisos/solicitud/${solicitud}${empresa ? `?empresa=${empresa}` : ""}`;
  }
  if (ruta === "/admin/institucional/vacaciones") {
    // `n` cambia en cada toque, para que la pestaña vuelva a «Mis
    // vacaciones» aunque ya estuviera abierta en otra sección.
    return `/permisos?seccion=vacaciones&n=${Date.now()}${empresa ? `&empresa=${empresa}` : ""}`;
  }
  return "/permisos";
}

/**
 * A dónde lleva un aviso del chat (CA-12 de la US-011). Su enlace es
 * `/admin/chat?c=ID` (`chat.services.enlace`): va a esa conversación, con la
 * empresa de la notificación como `X-Empresa` (B3 de la US-009). Sin una
 * conversación válida, a la pestaña «Chat».
 */
export function rutaDeChat(notificacion) {
  const conversacion = conversacionDelEnlace(notificacion?.enlace);
  const empresa = idDeEmpresa(notificacion?.empresa);
  if (!conversacion) return "/chat";
  return `/chat/conversacion/${conversacion}${empresa ? `?empresa=${empresa}` : ""}`;
}

/**
 * A dónde lleva un aviso de la Mesa de ayuda (CA-19 de la US-014):
 *
 * - `/admin/soporte/tickets/ID` (lo que avisa al equipo: asignado, respuesta
 *   del usuario…) → la ficha del técnico;
 * - `/admin/ayuda/tickets/ID` (lo que avisa a quien pidió, también con
 *   `#encuesta`) → la ficha de quien pide;
 * - `/admin/aprobaciones` → «Aprobaciones»;
 * - cualquier otro → la Mesa de ayuda.
 *
 * Las fichas llevan la empresa de la notificación como `X-Empresa` (B3 de la
 * US-009). El enlace puede venir con la web delante (los de los correos): se
 * toma solo la ruta.
 */
export function rutaDeSoporte(notificacion) {
  const enlace = typeof notificacion?.enlace === "string" ? notificacion.enlace : "";
  const ruta = enlace
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("#")[0]
    .split("?")[0]
    .replace(/\/+$/, "");
  const empresa = idDeEmpresa(notificacion?.empresa);
  const conEmpresa = empresa ? `?empresa=${empresa}` : "";
  const delEquipo = /^\/admin\/soporte\/tickets\/(\d{1,12})$/.exec(ruta);
  if (delEquipo) return `/soporte/ticket/${delEquipo[1]}${conEmpresa}`;
  const propio = /^\/admin\/ayuda\/tickets\/(\d{1,12})$/.exec(ruta);
  if (propio) return `/soporte/mi-ticket/${propio[1]}${conEmpresa}`;
  // `n` cambia en cada toque: la Mesa vuelve a esa vista aunque ya estuviera
  // abierta en otra.
  if (ruta === "/admin/aprobaciones") return `/soporte?vista=aprobaciones&n=${Date.now()}`;
  return "/soporte";
}

/**
 * A dónde lleva un aviso de la Matriz (CA-8 de la US-019). Los recordatorios,
 * los avisos de vencimiento y los escalamientos (`matriz.recordatorios.
 * _enlace`) llevan `/admin/matriz/obligaciones?periodo=ID&empresa=ID`: van al
 * detalle de ese período, con la empresa de la notificación (o la del
 * enlace) como `X-Empresa` (B3 de la US-009). Sin un período válido, a la
 * Bandeja de la Matriz. El enlace puede venir con la web delante.
 */
export function rutaDeMatriz(notificacion) {
  const enlace = typeof notificacion?.enlace === "string" ? notificacion.enlace : "";
  const [camino, consulta = ""] = enlace
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("#")[0]
    .split("?");
  const parametros = Object.fromEntries(
    consulta
      .split("&")
      .filter(Boolean)
      .map((par) => par.split("=")),
  );
  const periodo = parametros.periodo;
  const empresa = idDeEmpresa(notificacion?.empresa) ?? idDeEmpresa(parametros.empresa);
  const ruta = camino.replace(/\/+$/, "");
  if (ruta.startsWith("/admin/matriz") && periodo && /^\d{1,12}$/.test(periodo)) {
    return `/matriz/periodo/${periodo}${empresa ? `?empresa=${empresa}` : ""}`;
  }
  return "/matriz";
}

export const MODULOS_EN_APP = Object.freeze({
  licencias: rutaDeLicencias,
  chat: rutaDeChat,
  soporte: rutaDeSoporte,
  matriz: rutaDeMatriz,
});

/**
 * La ruta de la app para una notificación, o `null` si su módulo aún no está
 * en la app. `mapa` se recibe para probarlo con un módulo ficticio.
 */
export function rutaEnApp(notificacion, mapa = MODULOS_EN_APP) {
  const modulo = notificacion?.modulo;
  if (!modulo || !Object.prototype.hasOwnProperty.call(mapa, modulo)) {
    return null;
  }
  const destino = mapa[modulo];
  const ruta = typeof destino === "function" ? destino(notificacion) : destino;
  return typeof ruta === "string" && ruta.startsWith("/") ? ruta : null;
}
