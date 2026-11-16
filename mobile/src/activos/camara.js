import { requireOptionalNativeModule } from "expo";

/**
 * La cámara del escáner (US-022, CA-11), solo si el binario la trae.
 *
 * `expo-camera` es un módulo nativo: la app de desarrollo instalada en los
 * teléfonos antes del 16/11/2026 no lo tiene hasta recompilarla, y en ella
 * `import "expo-camera"` lanza al cargar (`requireNativeModule`) y tumbaría
 * toda la app. Por eso se pregunta antes con `requireOptionalNativeModule`
 * (devuelve `null` en vez de lanzar) y el paquete se carga con un `require`
 * diferido. Sin cámara, el escáner se queda con «Escribir el código a mano»
 * (CA-12).
 *
 * Devuelve `{CameraView, useCameraPermissions}` o `null`. Se resuelve una
 * vez: el binario no cambia mientras la app está abierta.
 */
let resuelta;

export function camaraDisponible() {
  if (resuelta !== undefined) return resuelta;
  try {
    if (!requireOptionalNativeModule("ExpoCamera")) {
      resuelta = null;
      return resuelta;
    }
    const modulo = require("expo-camera");
    resuelta =
      modulo?.CameraView && modulo?.useCameraPermissions
        ? { CameraView: modulo.CameraView, useCameraPermissions: modulo.useCameraPermissions }
        : null;
  } catch {
    resuelta = null;
  }
  return resuelta;
}

/** Para las pruebas: vuelve a preguntar. */
export function olvidarCamara() {
  resuelta = undefined;
}
