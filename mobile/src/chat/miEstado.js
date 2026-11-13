import { aIso, deHora, fechaCorta } from "../utils/fechas";

/**
 * «Mi estado» en el chat (US-011, CA-8), con las opciones y las reglas de
 * `MiEstado.jsx` de la web y de `chat/estados.py`:
 *
 * - disponible, almuerzo (dura sus minutos desde ahora), en reunión y no
 *   disponible (con una hora «hasta» opcional);
 * - vacaciones (desde y hasta; se proponen las de su solicitud) y fuera de
 *   la oficina (último día obligatorio, hasta 6 meses): son ausencias, así
 *   que piden quién aprueba por usted, que se guarda ANTES del estado;
 * - el horario de almuerzo (hora y minutos, de 10 a 180).
 */
export const ESTADOS = [
  { clave: "disponible", nombre: "Disponible" },
  { clave: "almuerzo", nombre: "Almuerzo" },
  { clave: "reunion", nombre: "En reunión" },
  { clave: "no_disponible", nombre: "No disponible" },
  { clave: "vacaciones", nombre: "Vacaciones" },
  { clave: "fuera_oficina", nombre: "Fuera de la oficina" },
];

export const AUSENCIAS = ["vacaciones", "fuera_oficina"];
export const DIAS_MAXIMOS_FUERA = 180;
export const ALMUERZO_MINIMO = 10;
export const ALMUERZO_MAXIMO = 180;

/** La fecha local («AAAA-MM-DD») de un momento ISO o de hoy. Una fecha sola
 * se deja como viene: `new Date` la leería en UTC (en Ecuador, el día
 * anterior). */
export function fechaLocal(valor) {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const fecha = valor ? new Date(valor) : new Date();
  if (Number.isNaN(fecha.getTime())) return "";
  return aIso(fecha);
}

/** Hoy más `dias`, como «AAAA-MM-DD» local. */
export function enDias(dias, desde = new Date()) {
  const fecha = new Date(desde);
  fecha.setDate(fecha.getDate() + dias);
  return aIso(fecha);
}

/** Lo que falta o está mal en el último día de «Fuera de la oficina». */
export function errorDeRegreso(regreso, hoy = fechaLocal(), maximo = enDias(DIAS_MAXIMOS_FUERA)) {
  if (!regreso) return "Indique hasta cuándo estará fuera de la oficina.";
  if (regreso < hoy) return "Elija como último día hoy o una fecha posterior.";
  if (regreso > maximo) return "Elija una fecha dentro de los próximos 6 meses.";
  return null;
}

/** Lo que falta o está mal en las fechas de las vacaciones. */
export function erroresDeVacaciones(desde, hasta) {
  const errores = {};
  if (!desde) errores.vacaciones_desde = "Indique desde cuándo estará de vacaciones.";
  if (!hasta) errores.vacaciones_hasta = "Indique hasta cuándo estará de vacaciones.";
  else if (desde && hasta < desde) errores.vacaciones_hasta = "«Hasta» no puede ser antes de «Desde».";
  return errores;
}

/** «HH:MM» de hoy → el momento ISO para «hasta». */
export function horaDeHoy(hhmm, base = new Date()) {
  if (!hhmm) return null;
  return deHora(hhmm, base).toISOString();
}

/** Si ahora cae dentro de su horario de almuerzo (para ofrecer «Salir a
 * almorzar»). */
export function enHoraDeAlmuerzo(inicio, minutos, ahora = new Date()) {
  if (!inicio) return false;
  const [h, m] = inicio.split(":").map(Number);
  const desde = h * 60 + m;
  const actual = ahora.getHours() * 60 + ahora.getMinutes();
  return actual >= desde && actual < desde + (Number(minutos) || 60);
}

/** «Fechas de su solicitud de vacaciones aprobada: del 16/11/2026 al
 * 20/11/2026. Confírmelas o cámbielas.» */
export function textoVacacionesSugeridas(sugeridas) {
  if (!sugeridas) return "";
  return `Fechas de su solicitud de vacaciones ${
    sugeridas.aprobada ? "aprobada" : "pendiente de aprobación"
  }: del ${fechaCorta(sugeridas.desde)} al ${fechaCorta(sugeridas.hasta)}. Confírmelas o cámbielas.`;
}

/** «DD/MM» de una fecha o un momento. */
export function diaYMes(valor) {
  const fecha = fechaLocal(valor);
  if (!fecha) return "";
  const [, m, d] = fecha.split("-");
  return `${d}/${m}`;
}

/** Quien cambia su estado avisa a quien lo muestra («Cuenta» y la pestaña
 * «Chat»), sin pasar por la navegación. */
const oyentes = new Set();

export function escucharMiEstado(oyente) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function avisarMiEstado(datos) {
  for (const oyente of oyentes) {
    try {
      oyente(datos);
    } catch {
      // Un oyente que falla no frena a los demás.
    }
  }
}
