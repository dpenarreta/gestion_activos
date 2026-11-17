import { TONOS } from "../soporte/formato";
import { aIso, fechaCorta } from "../utils/fechas";
import { transicionesDeSolicitud } from "./formato";

/**
 * Las solicitudes de equipos en la app (US-022, Tanda B, 16/11/2026): «Mis
 * solicitudes» (CA-18), «Nueva solicitud» (CA-19) y «Recibidas» (CA-20), con
 * las reglas de `backend/apps/solicitudes/` (`models.py`, `services.py`,
 * `serializers.py`) y los textos de `SolicitudForm.jsx` y
 * `SolicitudDetalle.jsx` de la web. Es código puro.
 *
 * Quién mueve qué lo decide el servidor (`SolicitudService.cambiar_estado`);
 * aquí solo se decide qué se ofrece, para no mostrar botones que van a ser
 * rechazados.
 */

// --- Estados y prioridades ----------------------------------------------------------

/** `Solicitud.Estado`, con su texto, su tono y su ícono (CA-23). */
export const ESTADOS_DE_SOLICITUD = {
  pendiente: { texto: "Pendiente", tono: "aviso", icono: "clock-outline" },
  en_gestion: { texto: "En gestión", tono: "info", icono: "progress-clock" },
  comprada: { texto: "Comprada", tono: "info", icono: "cart-check" },
  entregada: { texto: "Entregada", tono: "bien", icono: "check-circle-outline" },
  rechazada: { texto: "Rechazada", tono: "mal", icono: "close-circle-outline" },
  cancelada: { texto: "Cancelada", tono: "neutro", icono: "cancel" },
};

export const FINALES = ["entregada", "rechazada", "cancelada"];

export function estadoDeSolicitud(estado, textoDeLaApi) {
  const conocido = ESTADOS_DE_SOLICITUD[estado];
  if (!conocido) return { texto: textoDeLaApi || estado || "Sin estado", icono: "label-outline", ...TONOS.neutro };
  return { ...conocido, ...TONOS[conocido.tono] };
}

/** `Solicitud.Prioridad`. */
export const PRIORIDADES = [
  { valor: "baja", texto: "Baja" },
  { valor: "media", texto: "Media" },
  { valor: "alta", texto: "Alta" },
];

// Getters: los tonos salen del modo que se ve (US-026).
const TONO_DE_PRIORIDAD = {
  get alta() {
    return { ...TONOS.mal, icono: "chevron-double-up" };
  },
  // UX H-16: «Media» es lo normal; no se pinta como un aviso.
  get media() {
    return { ...TONOS.neutro, icono: "equal" };
  },
  get baja() {
    return { ...TONOS.neutro, icono: "chevron-double-down" };
  },
};

/** «Prioridad: Alta», con su tono e ícono. */
export function prioridadDe(solicitud) {
  const texto = solicitud?.prioridad_display || PRIORIDADES.find((p) => p.valor === solicitud?.prioridad)?.texto;
  if (!texto) return null;
  return { texto: `Prioridad: ${texto}`, ...(TONO_DE_PRIORIDAD[solicitud.prioridad] ?? TONOS.neutro) };
}

/** `Solicitud.Clase`. */
export const CLASES = [
  { valor: "dispositivo", texto: "Un dispositivo" },
  { valor: "componente", texto: "Un componente o repuesto" },
];

// --- Listas (CA-18, CA-20) ----------------------------------------------------------

/** Abiertas (lo que sigue vivo, por defecto) o todas. */
export const FILTROS_DE_SOLICITUDES = [
  { clave: "abiertas", texto: "Abiertas", params: { abiertas: "true" } },
  { clave: "todas", texto: "Todas", params: {} },
];

export function filtroDeSolicitudes(clave) {
  return FILTROS_DE_SOLICITUDES.find((f) => f.clave === clave) ?? FILTROS_DE_SOLICITUDES[0];
}

/** `ambito`: «mias» o «recibidas». */
export function parametrosDeSolicitudes({ ambito, filtro, q, pagina = 1 }) {
  const params = { ambito: ambito === "recibidas" ? "recibidas" : "mias", ...filtroDeSolicitudes(filtro).params, page: pagina };
  const texto = String(q ?? "").trim();
  if (texto) params.q = texto;
  return params;
}

/** «12/11/2026» del día en que se pidió (en la hora del teléfono), o `null`. */
export function fechaDePedido(s) {
  const fecha = new Date(s?.created_at);
  if (!s?.created_at || Number.isNaN(fecha.getTime())) return null;
  return fechaCorta(aIso(fecha));
}

export function cuantasSolicitudes(n) {
  const total = Number(n) || 0;
  return `${total} ${total === 1 ? "solicitud" : "solicitudes"}`;
}

/** «2 × Laptop — con 32 GB». */
export function queSePide(s) {
  const que = s?.lo_que_se_pide || s?.detalle || "Solicitud sin detalle";
  const cantidad = Number(s?.cantidad);
  return Number.isFinite(cantidad) && cantidad > 1 ? `${cantidad} × ${que}` : que;
}

/** Lo que dice el lector de pantalla de una fila. `ambito`: en «Recibidas»
 * importa quién la pidió; en «Mis solicitudes», quién la gestiona. */
export function nombreDeFilaSolicitud(s, ambito = "mias") {
  return [
    `Solicitud ${s?.id}`,
    queSePide(s),
    `Estado: ${estadoDeSolicitud(s?.estado, s?.estado_display).texto}`,
    prioridadDe(s)?.texto,
    ambito === "recibidas" ? `Pidió: ${s?.solicitante_nombre || "—"}` : `Encargado: ${s?.encargado_nombre || "—"}`,
    s?.fecha_necesaria ? `Se necesita para el ${fechaCorta(s.fecha_necesaria)}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

// --- Detalle: lo que se puede hacer (CA-18, CA-20) ----------------------------------

/** Los pasos del encargado, con las palabras de la web. */
export const PASOS = {
  en_gestion: { texto: "Tomarla", icono: "account-arrow-right-outline", variante: "primario" },
  comprada: { texto: "Marcar como comprada", icono: "cart-check", variante: "primario" },
  entregada: { texto: "Marcar como entregada", icono: "package-variant-closed-check", variante: "primario" },
  rechazada: { texto: "Rechazar", icono: "close-circle-outline", variante: "peligro", exigeNota: true },
  cancelada: { texto: "Cancelar la solicitud", icono: "cancel", variante: "secundario" },
};

export const TEXTO_NOTA_OBLIGATORIA =
  "Un rechazo lleva motivo: es lo único que le llega a quien pidió como explicación de por qué no.";

function lista(permisos) {
  return Array.isArray(permisos) ? permisos : [];
}

/**
 * Qué se ofrece en el detalle: `{pasos: [estado], cancelar}`.
 *
 * - Mover hacia adelante o rechazar: quien administra compras, o el
 *   encargado con `solicitudes.gestionar` (`puede_gestionarla`).
 * - Cancelar: quien la pidió o quien administra, mientras el estado lo
 *   permita (pendiente o en gestión, como la web y el servidor).
 * - Solo las transiciones válidas del estado actual (CA-20).
 */
export function accionesDeSolicitud(s, { usuarioId, permisos } = {}) {
  const p = lista(permisos);
  const validas = transicionesDeSolicitud(s?.estado);
  const administra = p.includes("solicitudes.administrar");
  const esMia = usuarioId !== undefined && usuarioId !== null && String(s?.solicitante) === String(usuarioId);
  const esEncargado = usuarioId !== undefined && usuarioId !== null && String(s?.encargado) === String(usuarioId);
  const gestiona = administra || (esEncargado && p.includes("solicitudes.gestionar"));
  return {
    pasos: gestiona ? validas.filter((e) => e !== "cancelada") : [],
    cancelar: validas.includes("cancelada") && (esMia || administra),
  };
}

/** La pregunta antes de cada paso. */
export function confirmacionDelPaso(estado, s) {
  const que = queSePide(s);
  switch (estado) {
    case "en_gestion":
      return { titulo: "¿Tomar la solicitud?", texto: `Pasa a «En gestión»: ${que}. Quien la pidió recibe el aviso.` };
    case "comprada":
      return { titulo: "¿Marcar como comprada?", texto: `${que}. Quien la pidió recibe el aviso.` };
    case "entregada":
      return { titulo: "¿Marcar como entregada?", texto: `${que}. El recorrido de la solicitud termina aquí.` };
    case "rechazada":
      return { titulo: "Rechazar la solicitud", texto: `${que}. Escriba el motivo: es lo que le llega a quien la pidió.` };
    case "cancelada":
      return {
        titulo: "¿Cancelar la solicitud?",
        texto: `${que}. Una solicitud cancelada no se reabre: si vuelve a hacer falta, se pide de nuevo.`,
      };
    default:
      return { titulo: "¿Cambiar el estado?", texto: que };
  }
}

/** Lo que se anuncia tras el paso. */
export function resultadoDelPaso(estado) {
  const nombre = ESTADOS_DE_SOLICITUD[estado]?.texto ?? estado;
  return `Solicitud ${String(nombre).toLowerCase()}.`;
}

/** Un valor de las especificaciones, para leerlo. */
export function valorDeEspecificacion(valor) {
  if (valor === true) return "Sí";
  if (valor === false) return "No";
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return fechaCorta(valor);
  return String(valor);
}

/** El aviso de la respuesta (`aviso.sin_correo`): a quién no le llegó el
 * correo. `null` si no hay nada que decir. */
export function textoDelAvisoDeSolicitud(aviso, { creada = false } = {}) {
  const sin = Array.isArray(aviso?.sin_correo) ? aviso.sin_correo.filter(Boolean) : [];
  if (sin.length === 0) return null;
  const nombres = sin.join(", ");
  return creada
    ? `No se pudo avisar por correo a ${nombres}: su cuenta no tiene dirección registrada. La verá igual en sus «Solicitudes recibidas», pero conviene avisarle.`
    : `No se pudo avisar por correo a ${nombres}: su cuenta no tiene dirección registrada.`;
}

// --- Nueva solicitud (CA-19) --------------------------------------------------------

export const LARGO_DETALLE = 200;
export const MAXIMA_CANTIDAD = 32767;

export function valoresDeSolicitud() {
  return {
    clase: "dispositivo",
    tipo_dispositivo: "",
    componente: "",
    detalle: "",
    especificaciones: {},
    cantidad: "1",
    prioridad: "media",
    fecha_necesaria: "",
    encargado: "",
    justificacion: "",
  };
}

export function hayCambiosEnLaSolicitud(valores) {
  const iniciales = valoresDeSolicitud();
  return (
    Object.keys(iniciales).some((c) => c !== "especificaciones" && String(iniciales[c]) !== String(valores[c] ?? "")) ||
    Object.keys(valores.especificaciones ?? {}).length > 0
  );
}

/** Las características del tipo elegido (solo los dispositivos del catálogo
 * las traen), en su orden. */
export function caracteristicasDe(catalogo, valores) {
  if (valores?.clase !== "dispositivo" || !valores.tipo_dispositivo) return [];
  const tipo = (catalogo?.tipos_dispositivo ?? []).find((t) => String(t.id) === String(valores.tipo_dispositivo));
  return [...(tipo?.caracteristicas ?? [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

/** El valor de una característica como lo valida el servidor
 * (`CaracteristicaTipo.normalizar`): número, entero, sí/no, lista, fecha o
 * texto. Devuelve `{valor}` o `{error}`; vacío es `{valor: undefined}`. */
export function especificacionDe(caracteristica, crudo) {
  if (crudo === undefined || crudo === null || crudo === "") return { valor: undefined };
  switch (caracteristica.dato) {
    case "booleano":
      return { valor: crudo === true || crudo === "true" };
    case "numero": {
      const limpio = String(crudo).trim().replace(",", ".");
      if (!/^-?\d+(\.\d+)?$/.test(limpio)) return { error: `«${caracteristica.nombre}» es un número.` };
      return { valor: Number(limpio) };
    }
    case "entero": {
      const limpio = String(crudo).trim();
      if (!/^-?\d+$/.test(limpio)) return { error: `«${caracteristica.nombre}» es un número entero.` };
      return { valor: Number(limpio) };
    }
    case "lista":
      if (!(caracteristica.opciones ?? []).includes(crudo)) return { error: `Elija una opción de «${caracteristica.nombre}».` };
      return { valor: crudo };
    default: {
      const texto = String(crudo).trim();
      return { valor: texto || undefined };
    }
  }
}

/** Revisa lo que el servidor también revisa (CA-19). Devuelve `{campo:
 * texto}`; los de las características van en `especificaciones: {nombre:
 * texto}`. */
export function validarSolicitud(valores, catalogo, hoy) {
  const errores = {};
  const esDispositivo = valores.clase === "dispositivo";
  const delCatalogo = esDispositivo ? valores.tipo_dispositivo : valores.componente;
  const detalle = String(valores.detalle ?? "").trim();
  if (!delCatalogo && !detalle) {
    errores[esDispositivo ? "tipo_dispositivo" : "componente"] =
      "Elija algo del catálogo o describa qué necesita en «Detalle».";
    errores.detalle = "Describa qué necesita, si no está en el catálogo.";
  }
  if (detalle.length > LARGO_DETALLE) errores.detalle = `El detalle llega hasta ${LARGO_DETALLE} caracteres.`;
  const cantidad = String(valores.cantidad ?? "").trim();
  if (!/^\d{1,5}$/.test(cantidad) || Number(cantidad) < 1 || Number(cantidad) > MAXIMA_CANTIDAD) {
    errores.cantidad = "Indique una cantidad de al menos 1.";
  }
  if (valores.fecha_necesaria && hoy && valores.fecha_necesaria < hoy) {
    errores.fecha_necesaria = "La fecha en que se necesita no puede haber pasado.";
  }
  if (!valores.encargado) errores.encargado = "Elija a quién le llega la solicitud.";
  if (!String(valores.justificacion ?? "").trim()) errores.justificacion = "Explique para qué hace falta.";
  const especificaciones = {};
  for (const c of caracteristicasDe(catalogo, valores)) {
    const { valor, error } = especificacionDe(c, valores.especificaciones?.[c.nombre]);
    if (error) especificaciones[c.nombre] = error;
    else if (c.obligatoria && (valor === undefined || valor === "")) {
      especificaciones[c.nombre] = `«${c.nombre}» es obligatoria para este tipo de equipo.`;
    }
  }
  if (Object.keys(especificaciones).length) errores.especificaciones = especificaciones;
  return errores;
}

/** El cuerpo de `POST solicitudes/`. Solo uno de tipo o componente, según la
 * clase (el modelo rechaza los dos). */
export function cuerpoDeSolicitud(valores, catalogo) {
  const esDispositivo = valores.clase === "dispositivo";
  const especificaciones = {};
  for (const c of caracteristicasDe(catalogo, valores)) {
    const { valor } = especificacionDe(c, valores.especificaciones?.[c.nombre]);
    if (valor !== undefined) especificaciones[c.nombre] = valor;
  }
  return {
    clase: esDispositivo ? "dispositivo" : "componente",
    tipo_dispositivo: esDispositivo && valores.tipo_dispositivo ? Number(valores.tipo_dispositivo) : null,
    componente: !esDispositivo && valores.componente ? Number(valores.componente) : null,
    detalle: String(valores.detalle ?? "").trim(),
    especificaciones,
    cantidad: Number(String(valores.cantidad).trim()) || 1,
    prioridad: valores.prioridad,
    fecha_necesaria: valores.fecha_necesaria || null,
    encargado: Number(valores.encargado),
    justificacion: String(valores.justificacion ?? "").trim(),
  };
}

/** Los errores 400 de `especificaciones` (`{nombre: texto}` o una lista). */
export function erroresDeEspecificaciones(error) {
  const detalles = error?.response?.data?.error?.details ?? error?.response?.data;
  const valor = detalles && typeof detalles === "object" ? detalles.especificaciones : undefined;
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const resultado = {};
  for (const [nombre, texto] of Object.entries(valor)) {
    resultado[nombre] = Array.isArray(texto) ? texto.filter((t) => typeof t === "string").join(" ") : String(texto);
  }
  return resultado;
}
