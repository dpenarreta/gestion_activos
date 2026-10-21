/**
 * El sonido de una notificación nueva (21/10/2026).
 *
 * Se genera con Web Audio —dos notas cortas, como un «ding-dong» suave— en vez
 * de un archivo: no hay nada que descargar ni que se pueda romper. Los
 * navegadores no dejan sonar nada hasta que la persona interactúa con la
 * página, así que el contexto de audio se desbloquea con el primer clic o
 * tecla; si suena antes, simplemente no suena.
 *
 * Cada persona puede silenciarlo desde la campana; la preferencia queda en
 * este navegador.
 */

const CLAVE = "notificaciones.sonido";

let contexto = null;

function obtenerContexto() {
  if (contexto) return contexto;
  const Clase =
    typeof window !== "undefined" &&
    (window.AudioContext || window.webkitAudioContext);
  if (!Clase) return null;
  try {
    contexto = new Clase();
  } catch {
    contexto = null;
  }
  return contexto;
}

/** Se llama una vez: el primer clic o tecla habilita el audio. */
export function prepararSonido() {
  if (typeof window === "undefined") return () => {};
  const desbloquear = () => {
    const ctx = obtenerContexto();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    window.removeEventListener("pointerdown", desbloquear);
    window.removeEventListener("keydown", desbloquear);
  };
  window.addEventListener("pointerdown", desbloquear);
  window.addEventListener("keydown", desbloquear);
  return () => {
    window.removeEventListener("pointerdown", desbloquear);
    window.removeEventListener("keydown", desbloquear);
  };
}

export function sonidoActivado() {
  try {
    return localStorage.getItem(CLAVE) !== "no";
  } catch {
    return true;
  }
}

export function fijarSonido(activado) {
  try {
    localStorage.setItem(CLAVE, activado ? "si" : "no");
  } catch {
    // Sin almacenamiento la preferencia dura lo que la página abierta.
  }
}

function nota(ctx, frecuencia, inicio, duracion) {
  const oscilador = ctx.createOscillator();
  const volumen = ctx.createGain();
  oscilador.type = "sine";
  oscilador.frequency.setValueAtTime(frecuencia, inicio);
  volumen.gain.setValueAtTime(0.0001, inicio);
  volumen.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
  volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  oscilador.connect(volumen).connect(ctx.destination);
  oscilador.start(inicio);
  oscilador.stop(inicio + duracion + 0.05);
}

/** Suena si está activado y el navegador lo permite. Nunca lanza error. */
export function sonarNotificacion() {
  if (!sonidoActivado()) return false;
  const ctx = obtenerContexto();
  if (!ctx || ctx.state === "suspended") return false;
  try {
    const ahora = ctx.currentTime;
    nota(ctx, 880, ahora, 0.35); // La5
    nota(ctx, 660, ahora + 0.18, 0.5); // Mi5
    return true;
  } catch {
    return false;
  }
}
