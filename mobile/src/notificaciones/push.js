import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Alert, Platform } from "react-native";

import { almacen } from "../api/almacen";
import { dispositivosService } from "../api/servicios";
import { projectIdDeEas } from "../config/env";

/**
 * Avisos push (CA-9 y CA-10 de US-009, 12/11/2026).
 *
 * El push es genérico por decisión del usuario (LOPDP): pasa por Expo, FCM y
 * APNs, así que solo trae `{notificacion_id, modulo, empresa}`. El contenido
 * se lee dentro de la app, con sesión. Por lo mismo, el `nombre` del
 * dispositivo es solo el modelo genérico (`Device.modelName`, «Pixel 7»),
 * nunca el nombre que la persona le puso al teléfono (`Device.deviceName`).
 */

/** El canal que usa el servidor (`channelId: "default"`). Android 13+ lo
 * necesita antes de pedir el permiso. */
export const CANAL_ANDROID = "default";

export const TEXTO_ANTES_DE_PEDIR =
  "La app puede avisarle cuando le llegue una notificación nueva. El aviso solo dice " +
  "de qué módulo es; el contenido se ve dentro de la app, con su sesión.";

export const TEXTO_PERMISO_RECHAZADO =
  "Sin el permiso de notificaciones, la app no le avisará cuando llegue algo nuevo. " +
  "Puede ver todo en la pestaña «Avisos» y activar los avisos cuando quiera " +
  "desde «Cuenta» o los ajustes del teléfono.";

const PLATAFORMAS = new Set(["android", "ios"]);

export function nombreGenericoDelDispositivo() {
  const modelo = typeof Device.modelName === "string" ? Device.modelName.trim() : "";
  const nombre = modelo || (Platform.OS === "ios" ? "iPhone" : "Android");
  return nombre.slice(0, 100);
}

async function prepararCanal() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CANAL_ANDROID, {
    name: "Avisos de la intranet",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Explica para qué es el permiso antes de que el sistema lo pida: la
 * pregunta del sistema sale una sola vez y sin contexto (revisión de QA-UX,
 * 12/11/2026). Resuelve `true` si la persona elige «Continuar». */
function explicarAntesDePedir() {
  return new Promise((resolver) => {
    Alert.alert(
      "¿Activar los avisos?",
      TEXTO_ANTES_DE_PEDIR,
      [
        { text: "Ahora no", style: "cancel", onPress: () => resolver(false) },
        { text: "Continuar", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}

/** Lo explica una sola vez por teléfono (CA-9). */
async function explicarRechazoUnaVez() {
  if (almacen.pushExplicado()) return;
  await almacen.marcarPushExplicado();
  Alert.alert("Avisos desactivados", TEXTO_PERMISO_RECHAZADO, [{ text: "Entendido" }]);
}

/** `activado`, `denegado` (o bloqueado) o `sin_decidir`, para «Cuenta». */
export async function estadoDelPermiso() {
  if (!PLATAFORMAS.has(Platform.OS)) return "no_disponible";
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "activado";
    return status === "denied" ? "denegado" : "sin_decidir";
  } catch {
    return "sin_decidir";
  }
}

function haySesion() {
  const { access, refresh } = almacen.tokens();
  return Boolean(access || refresh);
}

/**
 * Registra el dispositivo. Nunca lanza: sin push la app funciona igual.
 *
 * Solo con `pedirPermiso` (tras iniciar sesión o desde «Cuenta») se pregunta
 * a la persona; al abrir la app con la sesión guardada solo se registra si el
 * permiso ya estaba concedido, para no insistir en cada arranque.
 *
 * `explicar: false` salta la explicación previa (el botón de «Cuenta»).
 *
 * Devuelve `{estado}`: `registrado`, `pospuesto` («Ahora no»), `denegado`,
 * `sin_decidir`, `sin_proyecto` (falta el projectId de EAS, ver README),
 * `sin_sesion` (se cerró mientras tanto), `no_disponible` (web) o `error`
 * (Expo Go en Android, sin red…).
 */
export async function registrarDispositivo({ pedirPermiso = false, explicar = true } = {}) {
  if (!PLATAFORMAS.has(Platform.OS)) return { estado: "no_disponible" };
  try {
    await prepararCanal();
    const actual = await Notifications.getPermissionsAsync();
    let concedido = actual.status === "granted";
    if (!concedido) {
      if (!pedirPermiso) {
        return { estado: actual.status === "denied" ? "denegado" : "sin_decidir" };
      }
      if (actual.canAskAgain !== false) {
        // Desde «Activar los avisos» la persona ya lo pidió: no se le
        // pregunta dos veces (`explicar: false`).
        if (explicar && !(await explicarAntesDePedir())) return { estado: "pospuesto" };
        const respuesta = await Notifications.requestPermissionsAsync();
        concedido = respuesta.status === "granted";
      }
      if (!concedido) {
        await explicarRechazoUnaVez();
        return { estado: "denegado" };
      }
    }
    const projectId = projectIdDeEas();
    if (!projectId) {
      if (__DEV__) {
        console.warn(
          "Push: falta el projectId de EAS (EAS_PROJECT_ID). La app sigue sin avisos push.",
        );
      }
      return { estado: "sin_proyecto" };
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!haySesion()) return { estado: "sin_sesion" };
    await dispositivosService.registrar({
      token,
      plataforma: Platform.OS,
      nombre: nombreGenericoDelDispositivo(),
    });
    // Si la sesión se cerró mientras se registraba, no se guarda: el
    // servidor ya lo apagó al revocar la sesión, y un token guardado sin
    // sesión se daría de baja con la cuenta siguiente.
    if (!haySesion()) return { estado: "sin_sesion" };
    await almacen.guardarPushToken(token);
    return { estado: "registrado", token };
  } catch (error) {
    if (__DEV__) console.warn("Push: no se pudo registrar el dispositivo.", error?.message);
    return { estado: "error" };
  }
}

/**
 * Cuando FCM o APNs rotan el token del dispositivo, el de Expo también cambia:
 * se registra de nuevo, sin preguntar nada. Devuelve la suscripción.
 */
export function escucharRotacionDelToken() {
  if (!PLATAFORMAS.has(Platform.OS) || !Notifications.addPushTokenListener) {
    return { remove() {} };
  }
  return Notifications.addPushTokenListener(() => {
    if (haySesion()) registrarDispositivo();
  });
}

/**
 * Da de baja el token de este teléfono y lo olvida. Va ANTES de
 * `/auth/logout/`, porque necesita la sesión.
 *
 * - Al cerrar sesión a mano puede renovar el access una vez: con el access
 *   vencido, sin renovar, la baja fallaba y el push seguía llegando hasta 7
 *   días (revisión de QA, 12/11/2026).
 * - En el cierre forzado por el servidor se llama con `sinRenovar` y el token
 *   anterior; si responde 401 se ignora: el backend ya apagó los
 *   dispositivos de la sesión revocada (CA-12).
 *
 * Devuelve `sin_token`, `ok`, `sin_sesion` (401) o `temporal` (red, 5xx).
 */
export async function darDeBajaDispositivo(opciones) {
  const token = almacen.pushToken();
  if (!token) return "sin_token";
  try {
    await dispositivosService.baja(token, opciones);
    return "ok";
  } catch (error) {
    return error?.response?.status === 401 ? "sin_sesion" : "temporal";
  } finally {
    await almacen.guardarPushToken(null);
  }
}

/** El ID de la notificación de un push tocado, o `null`. */
export function idDeNotificacionDelPush(respuesta) {
  const id = respuesta?.notification?.request?.content?.data?.notificacion_id;
  return id !== undefined && id !== null && /^\d+$/.test(String(id)) ? String(id) : null;
}

/** La empresa de la notificación de un push (`data.empresa`), o `null`. */
export function empresaDelPush(respuesta) {
  const empresa = respuesta?.notification?.request?.content?.data?.empresa;
  return empresa !== undefined && empresa !== null && /^\d+$/.test(String(empresa))
    ? String(empresa)
    : null;
}

/** Para no atender dos veces el mismo toque. */
export function identificadorDelPush(respuesta) {
  return respuesta?.notification?.request?.identifier ?? null;
}
