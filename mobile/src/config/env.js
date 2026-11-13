import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Lo que cambia entre desarrollo y producción. Expo sustituye las variables
 * `EXPO_PUBLIC_*` al compilar el bundle, por eso se leen con el nombre
 * completo (no con `process.env[nombre]`). Sin `.env`, la app apunta a
 * producción (US-009, 12/11/2026).
 */
const API_POR_DEFECTO = "https://intranet.laarcourier.com/api/v1";
const WEB_POR_DEFECTO = "https://intranet.laarcourier.com";

function sinBarraFinal(url) {
  return String(url || "").replace(/\/+$/, "");
}

export const API_URL = sinBarraFinal(
  process.env.EXPO_PUBLIC_API_URL || API_POR_DEFECTO,
);

export const URL_WEB = sinBarraFinal(
  process.env.EXPO_PUBLIC_URL_WEB || WEB_POR_DEFECTO,
);

export const VERSION_APP = Constants.expoConfig?.version ?? "0.0.0";

/**
 * Con este User-Agent el backend nombra la sesión «Intranet LCE · Android/iOS»
 * en «Sesiones» (CA-1). Solo la plataforma: nunca el nombre del teléfono.
 */
export const USER_AGENT = `IntranetLCE/${VERSION_APP} (${
  Platform.OS === "ios" ? "ios" : "android"
})`;

/** El projectId de EAS, necesario para el token push (ver README). */
export function projectIdDeEas() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}
