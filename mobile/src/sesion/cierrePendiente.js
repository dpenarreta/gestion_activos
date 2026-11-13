import * as Notifications from "expo-notifications";

import { almacen } from "../api/almacen";
import { api } from "../api/api";

/**
 * Cerrar sesión sin red (observación O-A de la auditoría, 12/11/2026).
 *
 * Si el servidor no recibió el logout, la Session sigue viva y el push
 * seguiría llegando hasta 7 días. Se hacen dos cosas:
 *
 * 1. **Localmente, `unregisterForNotificationsAsync`.** El SDK 58 no lo
 *    documenta (`@docsMissing`); en su código nativo:
 *    - iOS llama a `unregisterForRemoteNotifications()`, que es local y sirve
 *      sin red;
 *    - Android llama a `FirebaseMessaging.deleteToken()`, que necesita red y
 *      sin ella falla.
 *
 *    No rompe el siguiente login: `getExpoPushTokenAsync` vuelve a pedir el
 *    token del dispositivo (`registerForRemoteNotifications` o
 *    `FirebaseMessaging.getToken`), que se registra de nuevo. En Android sale
 *    un token nuevo; el viejo lo desactiva el servidor con
 *    `DeviceNotRegistered` (CA-11).
 * 2. **Una baja pendiente** `{refresh, token}` en el almacén seguro, que se
 *    envía en cuanto hay red: al abrir la app, al volver al frente y al
 *    iniciar sesión, antes de registrar el dispositivo. Con el refresh se pide
 *    un access, se da de baja el token y se hace el logout de esa sesión. Un
 *    401 del refresh significa que la sesión ya terminó en el servidor: no
 *    queda nada que hacer.
 */

export async function dejarDeRecibirPushLocalmente() {
  try {
    await Notifications.unregisterForNotificationsAsync?.();
  } catch {
    // Android sin red: queda la baja pendiente.
  }
}

export async function guardarCierrePendiente({ refresh, token }) {
  if (!refresh && !token) return;
  await almacen.guardarCierrePendiente({ refresh: refresh || null, token: token || null });
}

function esTemporal(error) {
  const status = error?.response?.status;
  return !status || status >= 500 || status === 429;
}

let enCurso = null;

/**
 * Envía la baja pendiente, si hay una. Nunca lanza. Devuelve `nada`, `hecho`,
 * `ya_cerrada` (el refresh respondió 401) o `temporal` (sin red; se queda).
 */
export function procesarCierrePendiente() {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    const pendiente = almacen.cierrePendiente();
    if (!pendiente) return "nada";
    if (!pendiente.refresh) {
      await almacen.guardarCierrePendiente(null);
      return "nada";
    }
    let tokens;
    try {
      tokens = await api.post(
        "/auth/token/refresh/",
        { refresh: pendiente.refresh },
        { sinToken: true },
      );
    } catch (error) {
      if (esTemporal(error)) return "temporal";
      await almacen.guardarCierrePendiente(null);
      return "ya_cerrada";
    }
    // El refresh rota: se guarda el nuevo antes de seguir, o el siguiente
    // intento usaría uno ya gastado (y el backend revoca por reutilizarlo).
    const nuevo = { ...pendiente, refresh: tokens.refresh || pendiente.refresh };
    await almacen.guardarCierrePendiente(nuevo);
    const opciones = { sinRenovar: true, access: tokens.access };
    try {
      // Si el teléfono ya registró ese mismo token para la sesión nueva (en
      // iOS suele repetirse), darlo de baja apagaría los avisos de la nueva.
      if (nuevo.token && nuevo.token !== almacen.pushToken()) {
        await api.post("/notificaciones/dispositivos/baja/", { token: nuevo.token }, opciones);
        await almacen.guardarCierrePendiente({ ...nuevo, token: null });
      }
      await api.post("/auth/logout/", { refresh: nuevo.refresh }, opciones);
    } catch (error) {
      if (esTemporal(error)) return "temporal";
    }
    await almacen.guardarCierrePendiente(null);
    return "hecho";
  })()
    .catch(() => "temporal")
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}
