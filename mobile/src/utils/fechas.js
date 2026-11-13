/**
 * «hace 5 min», «hace 3 h», «ayer» o la fecha: lo mismo que la campana web
 * (`haceCuanto` en `CampanaNotificaciones.jsx`).
 */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function haceCuanto(fecha, ahora = new Date()) {
  const momento = new Date(fecha);
  if (Number.isNaN(momento.getTime())) return "";
  const minutos = Math.floor((ahora - momento) / 60_000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return "ayer";
  // Sin `toLocaleDateString`: Hermes en Android no siempre trae los datos de
  // idioma y saldría en inglés.
  return `${momento.getDate()} ${MESES[momento.getMonth()]}`;
}

/** Fecha y hora completas para el detalle: «12 nov 2026, 09:05». */
export function fechaCompleta(fecha) {
  const m = new Date(fecha);
  if (Number.isNaN(m.getTime())) return "";
  const hh = String(m.getHours()).padStart(2, "0");
  const mm = String(m.getMinutes()).padStart(2, "0");
  return `${m.getDate()} ${MESES[m.getMonth()]} ${m.getFullYear()}, ${hh}:${mm}`;
}

// --- Fechas de la API (US-010, 12/11/2026) ---------------------------------

const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function dos(n) {
  return String(n).padStart(2, "0");
}

/** «AAAA-MM-DD» de una fecha local (lo que espera la API). */
export function aIso(fecha) {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/** «12/11/2026» de una fecha local: el formato de la web, en un solo sitio
 * (lo usan las fechas de la API, el chat y las notificaciones). */
export function diaMesAnio(fecha) {
  return `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

/** «AAAA-MM-DD» del día local de un momento ISO, o "" si no es válido: dos
 * momentos del mismo día comparten clave (separadores del chat y grupos de
 * la campana). */
export function claveDeDia(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return "";
  return aIso(fecha);
}

/** «HH:MM» de una hora local. */
export function aHora(fecha) {
  return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

/** Una fecha local a partir de «AAAA-MM-DD», sin pasar por UTC: en Ecuador
 * (UTC−5) `new Date("2026-11-12")` es el 11 por la noche. */
export function deIso(iso) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!partes) return null;
  return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
}

/** Una hora local de hoy a partir de «HH:MM». */
export function deHora(hora, base = new Date()) {
  const partes = /^(\d{1,2}):(\d{2})/.exec(hora ?? "");
  const fecha = new Date(base);
  fecha.setSeconds(0, 0);
  if (partes) fecha.setHours(Number(partes[1]), Number(partes[2]));
  return fecha;
}

/** «12/11/2026», como la web (`formatearFecha`). Sin `toLocaleDateString`:
 * Hermes en Android no siempre trae los datos de idioma. */
export function fechaCorta(iso) {
  const fecha = deIso(iso);
  if (!fecha) return iso ? String(iso) : "—";
  return diaMesAnio(fecha);
}

/** «12 de noviembre de 2026»: para el lector de pantalla y los selectores. */
export function fechaLarga(isoOFecha) {
  const fecha = isoOFecha instanceof Date ? isoOFecha : deIso(isoOFecha);
  if (!fecha) return "";
  return `${fecha.getDate()} de ${MESES_LARGOS[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

/** «12/11/2026, 09:05» de un momento con hora (ISO con zona). */
export function fechaYHora(valor) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return "—";
  return `${diaMesAnio(fecha)}, ${aHora(fecha)}`;
}

/**
 * Cuántos días de calendario (en la hora del teléfono) hay entre `valor` y
 * `ahora`: 0 hoy, 1 ayer… `null` si la fecha no es válida. Lo usan los
 * separadores de día del chat y los grupos de las notificaciones (auditoría
 * UX, H-07 y H-23).
 */
export function diasAtras(valor, ahora = new Date()) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return null;
  const inicio = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((inicio(ahora) - inicio(fecha)) / 86400000);
}

/** «Hoy», «Ayer» o «Anteriores»: los grupos de la lista de notificaciones. */
export function grupoDeFecha(valor, ahora = new Date()) {
  const atras = diasAtras(valor, ahora);
  // Una fecha unos segundos adelantada (reloj del teléfono) también es de hoy.
  if (atras !== null && atras <= 0) return "Hoy";
  if (atras === 1) return "Ayer";
  return "Anteriores";
}
