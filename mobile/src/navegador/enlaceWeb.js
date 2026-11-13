import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";

import { URL_WEB } from "../config/env";

/**
 * Si `ruta` es una ruta interna de la web: empieza por «/», no por «//» (que
 * el navegador lee como otro sitio) y sin «\» ni espacios ni caracteres de
 * control (`/\otro.com` también se abre como otro sitio en los navegadores).
 * El backend ya lo garantiza con `enlace_interno()`; la app lo vuelve a
 * comprobar porque abre lo que recibe (US-009, sección 5).
 */
export function esRutaInterna(ruta) {
  if (typeof ruta !== "string" || ruta.length === 0 || ruta.length > 300) {
    return false;
  }
  if (!ruta.startsWith("/") || ruta.startsWith("//")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\\\s\u0000-\u001f\u007f]/.test(ruta);
}

/** El ID de la empresa de una notificación, venga como número, texto u
 * objeto `{id}`; solo dígitos. */
function idDeEmpresa(empresa) {
  const id = empresa && typeof empresa === "object" ? empresa.id : empresa;
  return id !== undefined && id !== null && /^\d+$/.test(String(id))
    ? String(id)
    : null;
}

/**
 * La URL de la web para una ruta interna, con `?empresa=ID` si se indica
 * (la web lo lee al abrir y cae en esa empresa: `tomarEmpresaDeLaDireccion`).
 * `null` si la ruta no es válida: entonces no hay botón.
 */
export function urlWeb(ruta, { empresa, base = URL_WEB } = {}) {
  if (!esRutaInterna(ruta)) return null;
  const id = idDeEmpresa(empresa);
  if (!id) return `${base}${ruta}`;
  const [sinAncla, ...ancla] = ruta.split("#");
  const separador = sinAncla.includes("?") ? "&" : "?";
  const resto = ancla.length ? `#${ancla.join("#")}` : "";
  return `${base}${sinAncla}${separador}empresa=${id}${resto}`;
}

/** El enlace de una notificación en la web, o `null` si no tiene uno válido. */
export function urlWebDeNotificacion(notificacion, base = URL_WEB) {
  return urlWeb(notificacion?.enlace, { empresa: notificacion?.empresa, base });
}

export const TEXTO_NAVEGADOR_FALLO =
  "No se pudo abrir el navegador del teléfono. Intente de nuevo o abra la intranet desde el navegador.";

/**
 * Abre la URL en el navegador del sistema, donde la persona ya tiene su
 * sesión de la web. Si el sistema no puede, la abre dentro de la app. Si
 * tampoco, lo dice con un `Alert` (salvo `avisarSiFalla: false`, para quien
 * lo muestra en la propia pantalla). Devuelve si se abrió.
 */
export async function abrirEnNavegador(url, { avisarSiFalla = true } = {}) {
  let abierta = false;
  if (url) {
    try {
      await Linking.openURL(url);
      abierta = true;
    } catch {
      try {
        await WebBrowser.openBrowserAsync(url);
        abierta = true;
      } catch {
        abierta = false;
      }
    }
  }
  if (!abierta && avisarSiFalla) {
    Alert.alert("No se pudo abrir", TEXTO_NAVEGADOR_FALLO, [{ text: "Entendido" }]);
  }
  return abierta;
}
