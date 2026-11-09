/*
 * Derechos sobre datos personales (LOPDP): rutas, tipos, estados y sus
 * reglas, para rotular. Lo que se puede hacer lo decide el servidor
 * (`apps.privacidad.services.TRANSICIONES`); aquí solo sirve para ofrecer los
 * botones que tienen sentido y adelantar lo que el servidor rechazaría.
 */

export const PERMISO_VER = "privacidad.ver";
export const PERMISO_ATENDER = "privacidad.atender";
export const PERMISOS_PRIVACIDAD = [PERMISO_VER, PERMISO_ATENDER];

export const RUTA_BANDEJA = "/admin/privacidad/solicitudes";
export const rutaDeSolicitud = (id) => `${RUTA_BANDEJA}/${id}`;
/** El aviso de consentimiento y quién lo aceptó. */
export const RUTA_CONSENTIMIENTO = "/admin/privacidad/consentimiento";
/** La sección del perfil a la que llegan los avisos del titular. */
export const SECCION_MIS_DERECHOS = "mis-derechos";
export const RUTA_MIS_DERECHOS = `/admin/perfil?seccion=${SECCION_MIS_DERECHOS}`;

/** El id del enlace de cada fila de la bandeja: el foco vuelve ahí. */
export const idFilaSolicitud = (id) => `pv-solicitud-${id}`;

/** Los mismos topes del modelo (`DESCRIPCION_MAX`, `RESPUESTA_MAX`). */
export const DESCRIPCION_MAX = 2000;
export const RESPUESTA_MAX = 4000;

/** El plazo de la ley si `me/` todavía no llegó (el del servidor manda). */
export const PLAZO_POR_DEFECTO = 15;

/**
 * Cada tipo con lo que significa en palabras de todos los días. Los textos
 * los validará el asesor legal (ver `docs/derechos-sobre-datos.md`). La
 * «rectificación» de la ley se dice siempre «corrección». `accion` es el
 * botón de su tarjeta en «Sus derechos».
 */
export const TIPOS = [
  {
    id: "ACCESO",
    accion: "Pedir acceso a mis datos",
    texto: "Acceso a mis datos",
    icono: "eye",
    explicacion:
      "Saber qué datos personales suyos guarda la empresa en la intranet y para qué los usa.",
  },
  {
    id: "RECTIFICACION",
    accion: "Pedir corrección de mis datos",
    texto: "Corrección de mis datos",
    icono: "pencil-square",
    explicacion:
      "Corregir o completar un dato suyo que está mal, desactualizado o incompleto.",
  },
  {
    id: "ELIMINACION",
    accion: "Pedir eliminación de mis datos",
    texto: "Eliminación de mis datos",
    icono: "trash3",
    explicacion:
      "Pedir que se borren datos suyos que ya no hace falta guardar.",
  },
];
export const TIPO = Object.fromEntries(TIPOS.map((t) => [t.id, t]));

/** Cada estado con su texto e ícono: el color nunca va solo. */
export const ESTADOS = [
  {
    id: "PENDIENTE",
    texto: "Pendiente",
    tono: "warn",
    icono: "hourglass-split",
  },
  {
    id: "EN_PROCESO",
    texto: "En proceso",
    tono: "info",
    icono: "arrow-repeat",
  },
  { id: "RESUELTA", texto: "Resuelta", tono: "ok", icono: "check2-circle" },
  { id: "RECHAZADA", texto: "Rechazada", tono: "bad", icono: "x-octagon" },
];
export const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.id, e]));

/** Cerradas: ya tienen respuesta. Se pueden reabrir. */
export const FINALES = new Set(["RESUELTA", "RECHAZADA"]);

/** A dónde puede pasar cada estado (la misma tabla del servidor). */
export const TRANSICIONES = {
  PENDIENTE: ["EN_PROCESO", "RESUELTA", "RECHAZADA"],
  EN_PROCESO: ["RESUELTA", "RECHAZADA"],
  RESUELTA: ["EN_PROCESO"],
  RECHAZADA: ["EN_PROCESO"],
};

/** La respuesta es obligatoria al cerrar y al reabrir. */
export function exigeRespuesta(desde, hacia) {
  return FINALES.has(hacia) || FINALES.has(desde);
}

/** El nombre del botón de cada paso, que dice lo que hace. */
export function textoDelPaso(desde, hacia) {
  if (FINALES.has(desde) && hacia === "EN_PROCESO") return "Reabrir";
  return {
    EN_PROCESO: "Pasar a «En proceso»",
    RESUELTA: "Marcar como resuelta",
    RECHAZADA: "Rechazar",
  }[hacia];
}

export const textoDeEstado = (id, label) =>
  label || ESTADO[id]?.texto || id || "—";
export const textoDeTipo = (id, label) => TIPO[id]?.texto || label || id || "—";

/** «quedan 3 días», «vence hoy», «venció hace 2 días». */
export function textoDeDiasRestantes(dias) {
  if (dias === null || dias === undefined) return "";
  if (dias > 1) return `quedan ${dias} días`;
  if (dias === 1) return "queda 1 día";
  if (dias === 0) return "vence hoy";
  const pasados = Math.abs(dias);
  return pasados === 1 ? "venció hace 1 día" : `venció hace ${pasados} días`;
}
