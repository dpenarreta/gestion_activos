import { almacen } from "../api/almacen";

/**
 * El usuario con el que se entró, recordado en este teléfono por 30 días
 * (US-028, CA-5, 17/11/2026), con la misma regla que la web
 * (`frontend/src/utils/usuarioRecordado.js`, commit 5440074):
 *
 * - Solo el identificador (usuario, correo o código de empleado), nunca la
 *   contraseña.
 * - Cada ingreso con «Recordar mi usuario» marcado vuelve a contar los 30
 *   días; desmarcado, lo olvida.
 * - Cerrar sesión no lo borra: el campo sale ya lleno.
 * - Vencido, se borra al leerlo.
 *
 * Va en `expo-secure-store` con lo demás del teléfono (`almacen`), que lo lee
 * al arrancar: la lectura es síncrona y el campo no aparece vacío un instante.
 * Si el almacén falla, simplemente no se recuerda.
 */

export const DIAS_RECORDADO = 30;
const DURACION_MS = DIAS_RECORDADO * 24 * 60 * 60 * 1000;

export function leerUsuarioRecordado(ahora = Date.now()) {
  const guardado = almacen.usuarioRecordado();
  if (!guardado?.usuario || typeof guardado.vence !== "number") return "";
  if (guardado.vence <= ahora) {
    olvidarUsuario();
    return "";
  }
  return String(guardado.usuario);
}

export async function recordarUsuario(usuario, ahora = Date.now()) {
  const limpio = String(usuario ?? "").trim();
  if (!limpio) return;
  try {
    await almacen.guardarUsuarioRecordado({ usuario: limpio, vence: ahora + DURACION_MS });
  } catch {
    // Sin almacén: simplemente no se recuerda.
  }
}

export async function olvidarUsuario() {
  try {
    await almacen.guardarUsuarioRecordado(null);
  } catch {
    // Nada que borrar.
  }
}
