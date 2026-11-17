/**
 * El usuario con el que se entró, recordado en este equipo por 30 días
 * (17/11/2026, pedido del usuario). Solo el identificador —usuario, correo
 * o código de empleado—, nunca la contraseña. Cada ingreso vuelve a contar
 * los 30 días; cerrar sesión no lo borra. Sin almacenamiento disponible
 * (navegación privada, bloqueado) no hace nada.
 */

const CLAVE = "intranet.usuario_recordado";
export const DIAS_RECORDADO = 30;
const DURACION_MS = DIAS_RECORDADO * 24 * 60 * 60 * 1000;

export function leerUsuarioRecordado(ahora = Date.now()) {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) || "null");
    if (!guardado?.usuario || typeof guardado.vence !== "number") return "";
    if (guardado.vence <= ahora) {
      localStorage.removeItem(CLAVE);
      return "";
    }
    return String(guardado.usuario);
  } catch {
    return "";
  }
}

export function recordarUsuario(usuario, ahora = Date.now()) {
  const limpio = String(usuario ?? "").trim();
  if (!limpio) return;
  try {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({ usuario: limpio, vence: ahora + DURACION_MS }),
    );
  } catch {
    // Sin almacenamiento: simplemente no se recuerda.
  }
}

export function olvidarUsuario() {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // Nada que borrar.
  }
}
