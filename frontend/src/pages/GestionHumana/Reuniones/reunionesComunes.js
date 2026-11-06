/*
 * Estados, momentos, límites y conversiones de fecha de Reuniones. Los
 * estados son los del servidor (`apps.reuniones.models.Meeting.Status`): aquí
 * solo sirven para rotular; qué puede hacer cada quien lo dice la reunión
 * (`can_edit`, `is_host`).
 */
import { RUTA_GESTION_HUMANA } from "../../../modulos/permisosGestionHumana";

export const RUTA_REUNIONES = `${RUTA_GESTION_HUMANA}/reuniones`;
export const rutaDeReunion = (id) => `${RUTA_REUNIONES}/${id}`;
/** El id del enlace de la tarjeta: el foco vuelve ahí desde el detalle. */
export const idTarjetaReunion = (id) => `re-reunion-${id}`;

/** Cada estado con su texto e ícono (el color nunca va solo). */
export const ESTADOS = [
  {
    id: "PROGRAMADA",
    texto: "Programada",
    tono: "neutral",
    icono: "calendar-event",
  },
  { id: "EN_CURSO", texto: "En curso", tono: "info", icono: "broadcast" },
  {
    id: "FINALIZADA",
    texto: "Finalizada",
    tono: "ok",
    icono: "check2-circle",
  },
];
export const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.id, e]));

/** El momento lo calcula el servidor por la hora (`timing`), no es el
 * estado: una reunión pasada puede seguir «Programada» si nadie la cerró. */
export const MOMENTO = {
  UPCOMING: { texto: "Próxima", icono: "hourglass-split" },
  IN_PROGRESS: { texto: "En su horario ahora", icono: "record-circle" },
  PAST: { texto: "Ya pasó", icono: "clock-history" },
};

/** Lo que `me/` dice de los límites, por si aún no llegó (los del
 * servidor). */
export const LIMITES_POR_DEFECTO = {
  title: 255,
  description: 5000,
  summary: 20000,
  password: 50,
  url: 1000,
  duration_max: 1440,
  invitees_max: 200,
};

/** Duraciones frecuentes, como atajo junto al campo de minutos. */
export const DURACIONES_SUGERIDAS = [15, 30, 45, 60, 90, 120];

/** «45 min», «1 h», «1 h 30 min». */
export function duracionEnTexto(minutos) {
  const n = Math.max(0, Number(minutos) || 0);
  const horas = Math.floor(n / 60);
  const resto = n % 60;
  if (!horas) return `${resto} min`;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** Hora en Ecuador («14:30»). */
export function hora(iso) {
  if (!iso) return "—";
  const valor = new Date(iso);
  if (Number.isNaN(valor.getTime())) return String(iso);
  return valor.toLocaleTimeString("es-EC", {
    timeZone: "America/Guayaquil",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «jueves, 06/11/2026». */
export function diaLargo(iso) {
  if (!iso) return "—";
  const valor = new Date(iso);
  if (Number.isNaN(valor.getTime())) return String(iso);
  return valor.toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** «jueves, 06/11/2026 · 14:30 a 15:15». */
export function horario(reunion) {
  return `${diaLargo(reunion.meeting_date)} · ${hora(reunion.meeting_date)} a ${hora(reunion.ends_at)}`;
}

const dos = (n) => String(n).padStart(2, "0");

/** ISO del servidor → valor de `<input type="datetime-local">` en la hora
 * del navegador (la de quien programa). */
export function aCampoLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Valor de `datetime-local` → ISO con zona (el navegador lo lee como hora
 * local; el servidor guarda el instante). */
export function deCampoLocal(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * ¿Es un enlace que se puede abrir? Solo `https://` con servidor: lo mismo
 * que exige el servidor (`validar_enlace`). La pantalla nunca pone en un
 * `href` un `javascript:` ni un `http://`, aunque llegara guardado.
 */
export function esEnlaceSeguro(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto || /\s/.test(texto)) return false;
  try {
    const url = new URL(texto);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** El servidor de destino de un enlace («teams.microsoft.com»), para
 * decir adónde lleva antes de abrirlo; vacío si no es un enlace seguro. */
export function dominioDe(valor) {
  if (!esEnlaceSeguro(valor)) return "";
  return new URL(String(valor).trim()).hostname;
}

/** El problema de un enlace escrito, o `null` si sirve (vacío también). */
export function problemaDelEnlace(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  if (!esEnlaceSeguro(texto))
    return "El enlace tiene que empezar con https:// (cópielo completo desde la invitación).";
  return null;
}

export const nombreDe = (persona) =>
  persona ? persona.full_name || persona.name || `#${persona.id}` : "—";
