/*
 * Colores, prioridades, repeticiones, ajustes y límites del Escritorio. Las
 * opciones son las del servidor (`apps.escritorio.models`); sus etiquetas
 * llegan en `escritorio/me/` (`choices`) y aquí solo se suman el tono y el
 * ícono (el color nunca va solo: cada semáforo dice su texto).
 */
import { RUTA_GESTION_HUMANA } from "../../../modulos/permisosGestionHumana";

export const RUTA_ESCRITORIO = `${RUTA_GESTION_HUMANA}/escritorio`;
export const RUTA_TAREAS = `${RUTA_GESTION_HUMANA}/tareas`;
export const RUTA_PROYECTOS = `${RUTA_GESTION_HUMANA}/proyectos`;

export const MENSAJE_MAX = 500;
export const TITULO_MAX = 150;
export const DESCRIPCION_MAX = 5000;

/**
 * Los colores de la nota (como en Nexo, el post-it). En el CSS cada uno es un
 * fondo pastel en el tema claro y uno muy oscuro en el oscuro, elegidos para
 * que el texto de la identidad (`--mz-ink`, `--mz-ink-soft` y
 * `--mz-ink-faint`) quede por encima de 4,5:1 en los dos temas. Los botones
 * van en una banda de fondo neutro, no sobre el color.
 */
export const COLORES = [
  { id: "AMARILLO", texto: "Amarillo" },
  { id: "ROSADO", texto: "Rosado" },
  { id: "CELESTE", texto: "Celeste" },
  { id: "VERDE", texto: "Verde" },
  { id: "NARANJA", texto: "Naranja" },
  { id: "LILA", texto: "Lila" },
];
export const claseDeColor = (color) =>
  `ed-color--${String(color || "AMARILLO").toLowerCase()}`;

export const PRIORIDADES_NOTA = [
  {
    id: "INFORMACION",
    texto: "Información",
    tono: "neutral",
    icono: "info-circle",
  },
  { id: "RECORDATORIO", texto: "Recordatorio", tono: "info", icono: "bell" },
  {
    id: "IMPORTANTE",
    texto: "Importante",
    tono: "warn",
    icono: "exclamation-triangle",
  },
  {
    id: "URGENTE",
    texto: "Urgente",
    tono: "bad",
    icono: "exclamation-octagon",
  },
];

export const PRIORIDADES_RECORDATORIO = [
  { id: "BAJA", texto: "Baja", tono: "neutral", icono: "reception-1" },
  { id: "MEDIA", texto: "Media", tono: "info", icono: "reception-2" },
  { id: "ALTA", texto: "Alta", tono: "warn", icono: "reception-3" },
  {
    id: "URGENTE",
    texto: "Urgente",
    tono: "bad",
    icono: "exclamation-octagon",
  },
];

export const ESTADOS_RECORDATORIO = [
  { id: "PENDIENTE", texto: "Pendiente", tono: "neutral", icono: "circle" },
  { id: "COMPLETADO", texto: "Completado", tono: "ok", icono: "check2-circle" },
];

export const REPETICIONES = [
  { id: "UNA_VEZ", texto: "Una vez" },
  { id: "DIARIO", texto: "Diario" },
  { id: "SEMANAL", texto: "Semanal" },
  { id: "MENSUAL", texto: "Mensual" },
];

/** La prioridad de la nota que hereda el recordatorio (`NOTA_A_RECORDATORIO`
 * del servidor), para proponerla en el formulario. */
export const NOTA_A_RECORDATORIO = {
  INFORMACION: "BAJA",
  RECORDATORIO: "MEDIA",
  IMPORTANTE: "ALTA",
  URGENTE: "URGENTE",
};

/** Lo que `me/` dice de los ajustes, por si aún no llegó (los de Nexo). */
export const AJUSTES_POR_DEFECTO = {
  max_replies: 2,
  archive_retention_days: 15,
  trash_retention_hours: 48,
  snooze_presets_minutes: [15, 30, 60, 1440],
};

/**
 * Las opciones con la etiqueta del servidor si llegó (`choices` de `me/`) y
 * el tono y el ícono de aquí.
 */
export function conEtiquetas(locales, delServidor) {
  return locales.map((o) => ({
    ...o,
    texto: delServidor?.find((s) => s.value === o.id)?.label ?? o.texto,
  }));
}

export const buscarOpcion = (lista, id) =>
  lista.find((o) => o.id === id) ?? {
    id,
    texto: id,
    tono: "neutral",
    icono: "circle",
  };

/** Un atajo de posponer en palabras: «15 minutos», «1 hora», «Mañana a esta
 * hora». */
export function textoDePosponer(minutos) {
  const n = Number(minutos) || 0;
  if (n === 1440) return "Mañana a esta hora";
  if (n % 1440 === 0) return `${n / 1440} días`;
  if (n === 60) return "1 hora";
  if (n % 60 === 0) return `${n / 60} horas`;
  return `${n} minutos`;
}

/** El instante `minutos` después de ahora, en ISO. */
export const dentroDe = (minutos, ahora = Date.now()) =>
  new Date(ahora + minutos * 60 * 1000).toISOString();

/** Pendiente y con el vencimiento ya pasado. */
export function vencido(recordatorio, ahora = Date.now()) {
  return (
    recordatorio.status === "PENDIENTE" &&
    new Date(recordatorio.due_at).getTime() < ahora
  );
}

/** «Le queda 1 respuesta», «Le quedan 2 respuestas». */
export function respuestasRestantes(restantes) {
  return restantes === 1
    ? "Le queda 1 respuesta en esta nota."
    : `Le quedan ${restantes} respuestas en esta nota.`;
}

export const nombreDe = (persona) =>
  persona ? persona.full_name || persona.name || `#${persona.id}` : "—";

/** El id del botón «Abrir» de la nota: el foco vuelve ahí al cerrarla. */
export const idDeNota = (id) => `ed-nota-${id}`;
