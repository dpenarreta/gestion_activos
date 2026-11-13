import { AppState } from "react-native";

import { almacen } from "../api/almacen";
import { notificacionesService } from "../api/servicios";
import { conversacionDelEnlace } from "./enlace";

export { conversacionDelEnlace };

/**
 * CA-11 de la US-011 (12/11/2026): con una conversación abierta en primer
 * plano, su push no se muestra (el mensaje ya aparece en la pantalla); los de
 * otras conversaciones y los de otros módulos, sí.
 *
 * El push es genérico (US-009, LOPDP): solo trae `{notificacion_id, modulo,
 * empresa}`, sin la conversación. Decisión: el servidor guarda UNA
 * notificación sin leer por conversación y persona (`chat.services.avisar`
 * la actualiza en lugar de apilar), y su `enlace` es `/admin/chat?c=ID`. Así
 * que la conversación sale de la notificación:
 *
 * 1. Si no hay una conversación abierta, o el push no es del chat, se
 *    muestra sin preguntar nada.
 * 2. Si ya se sabe de qué conversación es esa notificación (memoria de esta
 *    sesión), se compara sin red.
 * 3. Si no, se pide `/notificaciones/{id}/` (con su empresa como `X-Empresa`),
 *    sin marcarla leída, y se lee la conversación del `enlace`. El
 *    manejador tiene 3 s antes de que `expo-notifications` muestre el aviso
 *    igual: se espera como mucho `ESPERA_MAXIMA_MS`, y si no llega a tiempo
 *    o falla, se muestra (mejor un aviso de más que uno perdido).
 *
 * La conversación abierta la registra la pantalla de la conversación al
 * tener el foco y la borra al perderlo o al desmontarse.
 */
export const ESPERA_MAXIMA_MS = 2000;

const MOSTRAR = Object.freeze({
  shouldPlaySound: true,
  shouldSetBadge: true,
  shouldShowBanner: true,
  shouldShowList: true,
});

const CALLAR = Object.freeze({
  shouldPlaySound: false,
  shouldSetBadge: false,
  shouldShowBanner: false,
  shouldShowList: false,
});

let abierta = null;
/** `notificacion_id → id de la conversación`, solo en memoria. */
const conversacionDeNotificacion = new Map();

/** La pantalla de una conversación la registra al tener el foco. Devuelve
 * con qué borrarla (solo si sigue siendo ella). */
export function registrarConversacionAbierta(id, empresa = null) {
  const registro = { id: String(id), empresa: empresa ? String(empresa) : null };
  abierta = registro;
  return () => {
    if (abierta === registro) abierta = null;
  };
}

export function conversacionAbierta() {
  return abierta;
}

/** Al salir del chat (cierre de sesión): nada queda en memoria. */
export function olvidarConversaciones() {
  abierta = null;
  conversacionDeNotificacion.clear();
}

function soloDigitos(valor) {
  return valor !== undefined && valor !== null && /^\d{1,12}$/.test(String(valor)) ? String(valor) : null;
}

function conEspera(promesa, ms) {
  let temporizador;
  const espera = new Promise((resolver) => {
    temporizador = setTimeout(() => resolver(null), ms);
  });
  return Promise.race([promesa, espera]).finally(() => clearTimeout(temporizador));
}

async function conversacionDe(notificacionId, empresa) {
  if (conversacionDeNotificacion.has(notificacionId)) return conversacionDeNotificacion.get(notificacionId);
  const pedida = notificacionesService
    .detalle(notificacionId, { empresa: empresa ?? undefined })
    .then((datos) => {
      const id = conversacionDelEnlace(datos?.enlace);
      if (id) conversacionDeNotificacion.set(notificacionId, id);
      return id;
    })
    .catch(() => null);
  return conEspera(pedida, ESPERA_MAXIMA_MS);
}

/**
 * El comportamiento de un push recibido con la app abierta
 * (`setNotificationHandler`). Nunca lanza.
 */
export async function comportamientoDelAviso(notificacion) {
  try {
    const actual = abierta;
    const datos = notificacion?.request?.content?.data ?? {};
    if (!actual || datos.modulo !== "chat") return MOSTRAR;
    if (AppState.currentState && AppState.currentState !== "active") return MOSTRAR;
    const id = soloDigitos(datos.notificacion_id);
    if (!id) return MOSTRAR;
    const empresaDelPush = soloDigitos(datos.empresa);
    const empresaAbierta = actual.empresa ?? almacen.empresa();
    if (empresaDelPush && empresaAbierta && empresaDelPush !== String(empresaAbierta)) return MOSTRAR;
    const conversacion = await conversacionDe(id, empresaDelPush);
    // Mientras se preguntaba, la persona pudo salir de la conversación.
    return conversacion && abierta && conversacion === abierta.id ? CALLAR : MOSTRAR;
  } catch {
    return MOSTRAR;
  }
}

export const COMPORTAMIENTOS = { MOSTRAR, CALLAR };
