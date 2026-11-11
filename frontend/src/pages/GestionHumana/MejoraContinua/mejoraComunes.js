/*
 * Etapas, impacto y reglas del adjunto de Mejora continua. Las etapas y sus
 * pasos son los del servidor (`apps.mejora_continua.services`): aquí solo
 * sirven para rotular; qué se puede hacer lo dice `allowed_actions`.
 */
import { RUTA_GESTION_HUMANA } from "../../../modulos/permisosGestionHumana";
import {
  formatearMaximoMegabytes,
  formatearMegabytes,
} from "../../../utils/formato";

export const RUTA_MEJORA = `${RUTA_GESTION_HUMANA}/mejora-continua`;
export const rutaDeIdea = (id) => `${RUTA_MEJORA}/${id}`;
/** El id del enlace de la tarjeta: el foco vuelve ahí desde el detalle. */
export const idTarjetaIdea = (id) => `mc-idea-${id}`;

/** Las columnas del tablero, en el orden de Nexo. Cada etapa con su texto
 * (el color nunca va solo) y el tono del semáforo de la identidad. */
export const ETAPAS = [
  { id: "PROPUESTA", texto: "Propuesta", tono: "neutral", icono: "lightbulb" },
  { id: "EN_REVISION", texto: "En revisión", tono: "warn", icono: "search" },
  { id: "APROBADA", texto: "Aprobada", tono: "info", icono: "clipboard-check" },
  {
    id: "EN_DESARROLLO",
    texto: "En desarrollo",
    tono: "info",
    icono: "tools",
  },
  {
    id: "EN_PRUEBAS",
    texto: "En pruebas",
    tono: "info",
    icono: "clipboard2-pulse",
  },
  {
    id: "IMPLEMENTADA",
    texto: "Implementada",
    tono: "ok",
    icono: "check2-circle",
  },
  { id: "RECHAZADA", texto: "Rechazada", tono: "bad", icono: "x-octagon" },
];

export const ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e]));

/** El camino lineal (RECHAZADA es lateral): para rotular «Avanzar a …». */
const CAMINO = ETAPAS.filter((e) => e.id !== "RECHAZADA").map((e) => e.id);

export function etapaSiguiente(actual) {
  const i = CAMINO.indexOf(actual);
  return i >= 0 && i + 1 < CAMINO.length ? CAMINO[i + 1] : null;
}

export function etapaAnterior(actual) {
  const i = CAMINO.indexOf(actual);
  return i > 0 ? CAMINO[i - 1] : null;
}

export const textoDeEtapa = (id) => ETAPA[id]?.texto ?? id;

/** El impacto NO usa los tonos de semáforo (ok/warn/bad son de las etapas:
 * «Impacto alto» en rojo se confundía con «Rechazada»). Va con su texto y un
 * ícono de intensidad; el alto, además, en información. */
export const IMPACTOS = [
  { id: "ALTO", texto: "Alto", tono: "info", icono: "reception-4" },
  { id: "MEDIO", texto: "Medio", tono: "neutral", icono: "reception-2" },
  { id: "BAJO", texto: "Bajo", tono: "neutral", icono: "reception-1" },
];
export const IMPACTO = Object.fromEntries(IMPACTOS.map((i) => [i.id, i]));

export const TITULO_MAX = 255;
export const DESCRIPCION_MAX = 5000;
export const COMENTARIO_MAX = 2000;

/** Lo que `me/` dice del adjunto, por si aún no llegó (los valores de
 * Nexo). */
export const ADJUNTO_POR_DEFECTO = {
  extensions: [
    ".doc",
    ".docx",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".xls",
    ".xlsx",
  ],
  max_bytes: 8 * 1024 * 1024,
};

/** «8 MB», «512 KB». */
export function tamano(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) {
    const mb = n / (1024 * 1024);
    // Coma decimal, como el resto de la interfaz (revisión de US-007).
    return `${mb.toLocaleString("es-EC", { maximumFractionDigits: 1 })} MB`;
  }
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * El problema de un archivo para adjuntar, o `null` si se admite. Adelanta lo
 * que el servidor rechazaría (que además mira la firma del contenido).
 */
export function problemaDelAdjunto(archivo, reglas = ADJUNTO_POR_DEFECTO) {
  if (!archivo) return null;
  const nombre = archivo.name ?? "";
  const punto = nombre.lastIndexOf(".");
  const extension = punto >= 0 ? nombre.slice(punto).toLowerCase() : "";
  const admitidas = (reglas.extensions ?? []).map((e) => e.toLowerCase());
  if (!extension || !admitidas.includes(extension))
    return `Formato no admitido. Use ${listaDeFormatos(admitidas)}.`;
  // El peso con dos decimales y redondeado hacia arriba, como el servidor
  // (US-007, 11/11/2026): con un decimal, 8,01 MB se leía «8.0 MB».
  if (archivo.size > reglas.max_bytes)
    return `El archivo pesa ${formatearMegabytes(archivo.size)}: el máximo es ${formatearMaximoMegabytes(reglas.max_bytes)}.`;
  if (archivo.size === 0) return "El archivo está vacío.";
  return null;
}

/** «.pdf, .png» → «PDF, PNG, … o XLSX». */
export function listaDeFormatos(extensiones) {
  const nombres = extensiones.map((e) => e.replace(/^\./, "").toUpperCase());
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} o ${nombres.at(-1)}`;
}
