/*
 * Derechos sobre datos personales (LOPDP): rutas, tipos, estados y sus
 * reglas, para rotular. Lo que se puede hacer lo decide el servidor
 * (`apps.privacidad.services.TRANSICIONES`); aquí solo sirve para ofrecer los
 * botones que tienen sentido y adelantar lo que el servidor rechazaría.
 */

export const PERMISO_VER = "privacidad.ver";
export const PERMISO_ATENDER = "privacidad.atender";
export const PERMISOS_PRIVACIDAD = [PERMISO_VER, PERMISO_ATENDER];
/** Editar los textos de protección de datos (US-004, 11/11/2026). */
export const PERMISO_TEXTOS = "privacidad.textos";
/** Ver la pestaña «Textos»: quien ve o atiende, y quien los edita. */
export const PERMISOS_VER_TEXTOS = [...PERMISOS_PRIVACIDAD, PERMISO_TEXTOS];
/** La entrada «Protección de datos» del menú: cualquiera de sus pestañas. */
export const PERMISOS_PROTECCION_DE_DATOS = PERMISOS_VER_TEXTOS;

export const RUTA_PROTECCION = "/admin/privacidad";
export const RUTA_BANDEJA = "/admin/privacidad/solicitudes";
export const rutaDeSolicitud = (id) => `${RUTA_BANDEJA}/${id}`;
/** Las rutas que enlaza el servidor (`se_edita_en`, `se_consulta_en`). */
export const RUTA_TEXTOS = "/admin/privacidad/textos";
export const RUTA_ACEPTACIONES = "/admin/privacidad/aceptaciones";
/** Un texto del catálogo abierto en «Textos» (se despliega y se enfoca). */
export const rutaDeTexto = (clave) =>
  `${RUTA_TEXTOS}?texto=${encodeURIComponent(clave)}`;
/** Las aceptaciones de un texto. */
export const rutaDeAceptaciones = (clave) =>
  `${RUTA_ACEPTACIONES}?clave=${encodeURIComponent(clave)}`;
/** La ruta vieja del aviso y su consentimiento (09/11/2026): hoy redirige. */
export const RUTA_CONSENTIMIENTO = "/admin/privacidad/consentimiento";
/** Desde US-004 las personas frente al aviso viven en «Aceptaciones». */
export const RUTA_PERSONAS_DEL_AVISO = `${RUTA_ACEPTACIONES}?clave=aviso_privacidad&vista=personas`;

/** Las pestañas de «Protección de datos», cada una con lo que la abre. */
export const PESTANAS_PROTECCION = [
  {
    key: "solicitudes",
    label: "Solicitudes",
    path: RUTA_BANDEJA,
    permission: PERMISOS_PRIVACIDAD,
  },
  {
    key: "textos",
    label: "Textos",
    path: RUTA_TEXTOS,
    permission: PERMISOS_VER_TEXTOS,
  },
  {
    key: "aceptaciones",
    label: "Aceptaciones",
    path: RUTA_ACEPTACIONES,
    permission: PERMISOS_PRIVACIDAD,
  },
];

/** Las pestañas que puede abrir quien tiene `permisos`. */
export function pestanasDeProteccion(permisos = []) {
  return PESTANAS_PROTECCION.filter((p) =>
    p.permission.some((codigo) => permisos.includes(codigo)),
  );
}

/**
 * Las claves del catálogo de textos (`apps/privacidad/catalogo_textos.py`)
 * que la interfaz lee con `GET textos/<clave>/vigente/`. Son estables: no se
 * renombran.
 */
export const CLAVES_TEXTO = {
  AVISO: "aviso_privacidad",
  TELEFONO: "autorizacion_telefono",
  CUMPLEANOS: "cumpleanos_publico",
  ANIVERSARIO: "aniversario_publico",
  DERECHOS_EXPLICACION: "derechos_explicacion",
  DERECHOS_ACCESO: "derechos_acceso",
  DERECHOS_RECTIFICACION: "derechos_rectificacion",
  DERECHOS_ELIMINACION: "derechos_eliminacion",
  ACUERDO: "acuerdo_confidencialidad",
  ROL_PAGOS_TERMINOS: "rol_pagos_terminos",
  ROL_PAGOS_CORREO: "rol_pagos_correo",
  NOVA_IA: "nova_aviso_ia",
  NOVA_GENERAL: "nova_aviso_general",
  NOVA_TAREAS: "nova_aviso_tareas",
  NOVA_EQUIPO: "nova_aviso_equipo",
  NOVA_COMO_SE_PROTEGEN: "nova_como_se_protegen",
  NOVA_PANEL_DESEMPENO: "nova_panel_desempeno",
};

/**
 * Los textos que la pantalla muestra en una sola línea: la frase de una
 * casilla «Acepto…», la explicación de cada tipo de derecho y los avisos
 * cortos de Nova. El catálogo no trae `formato` (11/11/2026): se decide por
 * clave aquí, y si algún día lo trae, manda el del servidor. El editor los
 * trata como una línea (sin párrafos ni listas, vista previa en línea).
 */
export const CLAVES_DE_UNA_LINEA = new Set([
  CLAVES_TEXTO.CUMPLEANOS,
  CLAVES_TEXTO.ANIVERSARIO,
  CLAVES_TEXTO.DERECHOS_ACCESO,
  CLAVES_TEXTO.DERECHOS_RECTIFICACION,
  CLAVES_TEXTO.DERECHOS_ELIMINACION,
  CLAVES_TEXTO.NOVA_IA,
  CLAVES_TEXTO.NOVA_GENERAL,
  CLAVES_TEXTO.NOVA_TAREAS,
  CLAVES_TEXTO.NOVA_EQUIPO,
]);

export function esDeUnaLinea(entrada) {
  if (entrada?.formato) return entrada.formato === "linea";
  return CLAVES_DE_UNA_LINEA.has(entrada?.clave);
}

/** Un texto de una línea, como lo muestra su pantalla. */
export const enUnaLinea = (texto) =>
  String(texto || "")
    .replace(/\s*\n\s*/g, " ")
    .trim();

/**
 * La explicación de los derechos tal como estaba fija hasta US-004: es el
 * respaldo mientras llega la del servidor (o si no llega). `{plazo}` se
 * reemplaza por los días del plazo.
 */
export const DERECHOS_EXPLICACION_RESPALDO =
  "La Ley Orgánica de Protección de Datos Personales (LOPDP) le da derecho a saber qué datos suyos guarda la empresa, a pedir que los corrijan y a pedir que los borren cuando ya no hacen falta. Aquí puede hacerlo. La empresa debe responderle en un plazo de {plazo} días desde que envía su solicitud.";
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
 * botón de su tarjeta en «Sus derechos». Desde US-004 (11/11/2026) la
 * explicación se edita en «Protección de datos» → «Textos» (`clave`); la de
 * aquí es el respaldo mientras llega la del servidor.
 */
export const TIPOS = [
  {
    id: "ACCESO",
    clave: CLAVES_TEXTO.DERECHOS_ACCESO,
    accion: "Pedir acceso a mis datos",
    texto: "Acceso a mis datos",
    icono: "eye",
    explicacion:
      "Saber qué datos personales suyos guarda la empresa en la intranet y para qué los usa.",
  },
  {
    id: "RECTIFICACION",
    clave: CLAVES_TEXTO.DERECHOS_RECTIFICACION,
    accion: "Pedir corrección de mis datos",
    texto: "Corrección de mis datos",
    icono: "pencil-square",
    explicacion:
      "Corregir o completar un dato suyo que está mal, desactualizado o incompleto.",
  },
  {
    id: "ELIMINACION",
    clave: CLAVES_TEXTO.DERECHOS_ELIMINACION,
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

/**
 * Si el servidor rechazó una aceptación porque el texto cambió mientras se
 * leía: cada pantalla envía la versión que mostró y, si ya no es la vigente,
 * el servidor responde 400 en el campo de la casilla (`acepto`,
 * `acepta_telefono`, `acepto_guardar`) o 409 `texto_cambiado`. Hay que traer
 * el texto nuevo y pedir que se acepte de nuevo (QA-TECH, US-004).
 */
export function esTextoCambiado(err, campo = "acepto") {
  const cuerpo = err?.response?.data?.error;
  return (
    cuerpo?.code === "texto_cambiado" ||
    (err?.response?.status === 400 && Boolean(cuerpo?.details?.[campo]))
  );
}

export const MENSAJE_TEXTO_CAMBIADO =
  "El texto cambió mientras lo leía. Léalo de nuevo y acéptelo.";

/** El mensaje del servidor para la casilla (o el de siempre). */
export function mensajeDeTextoCambiado(err, campo = "acepto") {
  const valor = err?.response?.data?.error?.details?.[campo];
  const mensaje = Array.isArray(valor) ? valor[0] : valor;
  return typeof mensaje === "string" && mensaje
    ? mensaje
    : MENSAJE_TEXTO_CAMBIADO;
}
