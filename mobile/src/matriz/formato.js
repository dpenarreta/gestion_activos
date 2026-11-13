import { mensajeDeError } from "../api/errores";
import { sinRespuestaClara, TONOS } from "../soporte/formato";
import { diaMesAnio, fechaCorta } from "../utils/fechas";

/**
 * Cómo se dicen y se pintan las cosas de la Matriz de obligaciones en la app
 * (US-019, 13/11/2026), con los mismos textos que la web
 * (`frontend/src/pages/Matriz/formatoMatriz.js`, `ResumenMatriz.jsx`,
 * `PeriodoPanel.jsx`). Es código puro: lo usan el catálogo de la navegación,
 * las pantallas y las pruebas.
 */

// --- Acceso ---------------------------------------------------------------------------

/** Cualquiera de estos abre la Matriz en la empresa activa: los mismos de la
 * web (`frontend/src/modulos/permisosMatriz.js`). Los permisos de
 * `usuario.permissions` ya son los de la empresa activa (roles generales más
 * los de la membresía), y la app los vuelve a leer al cambiar de empresa. */
export const PERMISOS_MATRIZ = [
  "matriz.ver_todas",
  "matriz.crear",
  "matriz.editar",
  "matriz.cambiar_fecha",
  "matriz.cargar",
  "matriz.enviar",
  "matriz.validar",
  "matriz.recordar",
  "matriz.exportar",
  "matriz.ver_auditoria",
  "matriz.configurar",
  "matriz.gestionar_miembros",
];

export function tieneAccesoALaMatriz(permisos = []) {
  return PERMISOS_MATRIZ.some((p) => (permisos ?? []).includes(p));
}

/**
 * La empresa activa entre las de `matriz/empresas/mias/` (`RequiereRolMatriz`
 * de la web): la que coincide con la activa o, si no hay activa, la primera.
 * `null`: no tiene un rol de la Matriz en ella.
 */
export function empresaDeLaMatriz(empresas, activa) {
  const lista = Array.isArray(empresas) ? empresas : [];
  const id = activa === undefined || activa === null ? "" : String(activa);
  return lista.find((e) => String(e.id) === id) ?? (id ? null : (lista[0] ?? null));
}

// --- Acciones -------------------------------------------------------------------------

/** Lo único que hace la app en el detalle (decisión del usuario, 13/11/2026),
 * en el orden de la web. Solo si el servidor lo ofrece en `acciones`. */
export const ACCIONES_EN_LA_APP = [
  { accion: "edit", texto: "Editar seguimiento", icono: "pencil-outline" },
  { accion: "change_due_date", texto: "Cambiar fecha", icono: "calendar-edit" },
  { accion: "remind", texto: "Reenviar recordatorio", icono: "send-outline" },
];

/** Lo que el servidor puede ofrecer y se hace en la web (CA-6): enviar a
 * validación, cargar evidencia, validar, devolver y rechazar evidencias. */
export const ACCIONES_EN_LA_WEB = ["submit", "upload", "validate", "return", "reject_document"];

export function accionesEnLaApp(acciones = []) {
  const lista = Array.isArray(acciones) ? acciones : [];
  return ACCIONES_EN_LA_APP.filter((a) => lista.includes(a.accion));
}

export function hayAccionesEnLaWeb(acciones = []) {
  const lista = Array.isArray(acciones) ? acciones : [];
  return ACCIONES_EN_LA_WEB.some((a) => lista.includes(a));
}

export const TEXTO_ACCIONES_EN_LA_WEB = "Enviar a validación, cargar evidencia y validar se hacen en la web.";

/** Cómo se dice cada acción de la web (H-13, ronda 1): validar y devolver
 * van juntas. */
const NOMBRES_EN_LA_WEB = [
  [["submit"], "enviar a validación"],
  [["upload"], "cargar evidencia"],
  [["validate", "return"], "validar o devolver"],
  [["reject_document"], "rechazar evidencias"],
];

/** H-13 (ronda 1): el aviso nombra solo lo que el servidor ofrece: «Cargar
 * evidencia se hace en la web.», «Enviar a validación y cargar evidencia se
 * hacen en la web.». */
export function textoAccionesEnLaWeb(acciones = []) {
  const lista = Array.isArray(acciones) ? acciones : [];
  const nombres = NOMBRES_EN_LA_WEB.filter(([claves]) => claves.some((c) => lista.includes(c))).map(([, n]) => n);
  if (nombres.length === 0) return "";
  const unidas =
    nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `${unidas.charAt(0).toUpperCase()}${unidas.slice(1)} se ${nombres.length === 1 ? "hace" : "hacen"} en la web.`;
}

/** La obligación en la web: el panel del período (`?periodo=ID`, la misma
 * convención que los correos). La empresa la añade `urlWeb`. */
export function rutaWebDelPeriodo(id) {
  return `/admin/matriz/obligaciones?periodo=${encodeURIComponent(String(id))}`;
}

/** Al menos 10 caracteres de justificación (`MINIMO_MOTIVO` de la web). */
export const MINIMO_MOTIVO = 10;

// --- Mensajes -------------------------------------------------------------------------

export const TEXTO_SIN_ROL =
  "No tiene un rol de la Matriz en la empresa activa. Pida a un administrador que se lo asigne o cambie de empresa en «Cuenta».";
export const TEXTO_NO_DISPONIBLE = "Esta obligación no existe o ya no tiene acceso a ella.";
/** CA-5: sin respuesta del servidor no se sabe si llegó (no hay clave de
 * idempotencia), como en la Mesa de ayuda. */
export const TEXTO_PUEDE_HABERSE_GUARDADO =
  "No hubo respuesta del servidor: puede que sí se haya guardado. Revise el detalle antes de reintentar; lo que escribió se conserva.";
export const TEXTO_YA_NO_ES_SUYO =
  "Seguimiento guardado. El período ya no está entre los suyos: dejó de ser su responsable o suplente.";

/** El error de la Matriz, legible. `envio`: en un guardado, sin respuesta
 * clara se dice que pudo haberse hecho. */
export function mensajeDeMatriz(error, porDefecto, { envio = false } = {}) {
  if (envio && sinRespuestaClara(error)) return TEXTO_PUEDE_HABERSE_GUARDADO;
  return mensajeDeError(error, porDefecto);
}

// --- Fechas en la hora de la empresa ------------------------------------------------

/**
 * Los vencimientos se dicen en la zona horaria de la empresa, no en la del
 * teléfono (`formatoMatriz.js` de la web): una obligación «a las 17:00» es a
 * las 17:00 de donde se cumple. Se usan las partes numéricas de
 * `Intl.DateTimeFormat` («en-US», sin depender de los datos de idioma, que
 * Hermes en Android no siempre trae); si el motor no sabe de zonas, se usa
 * la hora del teléfono (en Ecuador es la misma).
 */
const formateadores = new Map();

function formateador(zona) {
  if (!zona) return null;
  if (formateadores.has(zona)) return formateadores.get(zona);
  let valor = null;
  try {
    valor = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    if (typeof valor.formatToParts !== "function") valor = null;
  } catch {
    valor = null;
  }
  formateadores.set(zona, valor);
  return valor;
}

/** `{anio, mes, dia, hora, minuto}` de un instante en la zona, o `null`. */
export function partesEnZona(valor, zona) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return null;
  const f = formateador(zona);
  if (f) {
    try {
      const p = Object.fromEntries(f.formatToParts(fecha).map((x) => [x.type, x.value]));
      const hora = Number(p.hour) % 24;
      return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora, minuto: Number(p.minute) };
    } catch {
      // Cae a la hora del teléfono.
    }
  }
  return {
    anio: fecha.getFullYear(),
    mes: fecha.getMonth() + 1,
    dia: fecha.getDate(),
    hora: fecha.getHours(),
    minuto: fecha.getMinutes(),
  };
}

function dos(n) {
  return String(n).padStart(2, "0");
}

/** «AAAA-MM-DD» del día de un instante en la zona de la empresa: en qué
 * casilla del calendario cae un vencimiento. */
export function diaEnZona(valor, zona) {
  const p = partesEnZona(valor, zona);
  return p ? `${p.anio}-${dos(p.mes)}-${dos(p.dia)}` : "";
}

/** «13/11/2026» en la zona de la empresa. */
export function fechaEnZona(valor, zona) {
  const p = partesEnZona(valor, zona);
  return p ? diaMesAnio(new Date(p.anio, p.mes - 1, p.dia)) : "—";
}

/** «13/11/2026, 17:00» en la zona de la empresa. */
export function fechaHoraEnZona(valor, zona) {
  const p = partesEnZona(valor, zona);
  return p ? `${diaMesAnio(new Date(p.anio, p.mes - 1, p.dia))}, ${dos(p.hora)}:${dos(p.minuto)}` : "—";
}

/** Una fecha sin hora (AAAA-MM-DD) tal cual, sin moverla de día. */
export function diaCorto(valor) {
  return valor ? fechaCorta(valor) : "—";
}

/**
 * El nombre llano de la zona horaria de la empresa (pedido del usuario,
 * ronda 1, 13/11/2026): «hora de Ecuador» y no «America/Guayaquil». Una zona
 * que no está aquí no se menciona (`null`).
 */
export const ZONAS_CONOCIDAS = {
  "America/Guayaquil": "Ecuador",
  "Pacific/Galapagos": "Galápagos",
  "America/Bogota": "Colombia",
  "America/Lima": "Perú",
  "America/Panama": "Panamá",
  "America/Caracas": "Venezuela",
  "America/Santiago": "Chile",
  "America/Mexico_City": "México",
  "America/New_York": "Nueva York",
  "Europe/Madrid": "España",
};

/** «hora de Ecuador», o `null` si la zona no es conocida. */
export function horaDeLaZona(zona) {
  const nombre = ZONAS_CONOCIDAS[zona];
  return nombre ? `hora de ${nombre}` : null;
}

export const MESES_LARGOS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** «Noviembre 2026». */
export function tituloDelMes(anio, mes) {
  return `${MESES_LARGOS[mes - 1]} ${anio}`;
}

/** Los días de la semana, de domingo a sábado, como el calendario web. */
export const DIAS_SEMANA = [
  { corto: "Dom", largo: "domingo" },
  { corto: "Lun", largo: "lunes" },
  { corto: "Mar", largo: "martes" },
  { corto: "Mié", largo: "miércoles" },
  { corto: "Jue", largo: "jueves" },
  { corto: "Vie", largo: "viernes" },
  { corto: "Sáb", largo: "sábado" },
];

function aIsoUtc(fecha) {
  return `${fecha.getUTCFullYear()}-${dos(fecha.getUTCMonth() + 1)}-${dos(fecha.getUTCDate())}`;
}

/** Las semanas del mes, de domingo a sábado, con los días de los meses
 * vecinos para completar la primera y la última (`semanasDelMes` de la web). */
export function semanasDelMes(anio, mes) {
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  const cursor = new Date(primero);
  cursor.setUTCDate(1 - primero.getUTCDay());
  const dias = [];
  do {
    dias.push({
      iso: aIsoUtc(cursor),
      numero: cursor.getUTCDate(),
      semana: cursor.getUTCDay(),
      delMes: cursor.getUTCMonth() === mes - 1,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (cursor.getUTCMonth() === mes - 1 || cursor.getUTCDay() !== 0);
  const semanas = [];
  for (let i = 0; i < dias.length; i += 7) semanas.push(dias.slice(i, i + 7));
  return semanas;
}

/** El mes anterior o el siguiente. */
export function moverMes({ anio, mes }, delta) {
  const total = anio * 12 + (mes - 1) + delta;
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
}

/** «13 de noviembre de 2026» de «AAAA-MM-DD». */
export function diaLargo(iso) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!partes) return "";
  return `${Number(partes[3])} de ${MESES_LARGOS[Number(partes[2]) - 1].toLowerCase()} de ${partes[1]}`;
}

/** «viernes 13 de noviembre de 2026» (H-07, ronda 1). */
export function diaConSemana(iso) {
  if (!esDiaValido(iso)) return "";
  const [a, m, d] = iso.split("-").map(Number);
  return `${DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()].largo} ${diaLargo(iso)}`;
}

/** Si «AAAA-MM-DD» es un día que existe. */
export function esDiaValido(iso) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!partes) return false;
  const fecha = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
  return aIsoUtc(fecha) === iso;
}

// --- Estados --------------------------------------------------------------------------

/** El tono de cada grupo de estado (§9 de la web: rojo, tomate, verde), con
 * su ícono: el estado nunca se dice solo con color. */
const GRUPOS = {
  incumplido: ["mal", "alert-outline"],
  en_progreso: ["aviso", "clock-outline"],
  finalizado: ["bien", "check-circle-outline"],
};

export function tonoDeGrupo(grupo) {
  const [tono, icono] = GRUPOS[grupo] ?? ["neutro", "label-outline"];
  return { ...TONOS[tono], icono };
}

/** Cuál pesa más en un día del calendario: lo incumplido, luego lo que corre. */
export function grupoMasUrgente(periodos = []) {
  for (const grupo of ["incumplido", "en_progreso", "finalizado"]) {
    if (periodos.some((p) => p?.estado?.group === grupo)) return grupo;
  }
  return null;
}

/** La columna «Días» de la web (`textoDeDias`), en palabras. */
export function textoDeDias(estado) {
  if (!estado) return "";
  if (estado.group === "incumplido") {
    const n = estado.days_overdue;
    return n === 1 ? "1 día de atraso" : `${n} días de atraso`;
  }
  if (estado.group === "finalizado") {
    if (!estado.is_late) return "";
    const n = estado.days_overdue;
    return n === 1 ? "Cerrado con 1 día de atraso" : `Cerrado con ${n} días de atraso`;
  }
  if (estado.is_due_today) return "Vence hoy";
  const n = estado.days_remaining;
  if (n === null || n === undefined) return "";
  return n === 1 ? "Queda 1 día" : `Quedan ${n} días`;
}

export const PRIORIDADES = { alta: "Alta", media: "Media", baja: "Baja" };

export const TIPOS = { regulatoria: "Regulatoria", contractual: "Contractual", interna: "Interna" };

export const PERIODICIDADES = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  bienal: "Bienal (cada 2 años)",
  trienal: "Trienal (cada 3 años)",
  quinquenal: "Quinquenal (cada 5 años)",
  decenal: "Decenal (cada 10 años)",
  unica: "Única",
};

/** El nombre de una fila: nombre, entidad o área, responsable, vencimiento y
 * estado (CA-3), leído de una vez. */
export function nombreDeFila(periodo, zona) {
  const estado = periodo?.estado;
  return [
    periodo?.obligacion?.nombre,
    [periodo?.entidad, periodo?.area].filter(Boolean).join(" · "),
    periodo?.responsable?.nombre ? `Responsable: ${periodo.responsable.nombre}` : "Sin responsable",
    `Vence el ${fechaHoraEnZona(periodo?.vence_en, zona)}`,
    estado ? `Estado: ${estado.label}` : null,
    textoDeDias(estado),
  ]
    .filter(Boolean)
    .join(". ");
}

// --- La Bandeja y las listas ----------------------------------------------------------

/**
 * Las cuatro tarjetas de la Bandeja (CA-2), con los filtros de la web
 * (`ResumenMatriz.jsx`, CA-3). `clave` es el segmento de la ruta de la lista
 * (`/matriz/estado/<clave>`).
 */
export const ESTADOS_DE_LA_BANDEJA = [
  {
    clave: "incumplido",
    titulo: "Incumplidas",
    detalle: () => "Vencidas sin cierre validado",
    cifra: (c) => c?.overdue,
    tono: "mal",
    icono: "alert-outline",
    params: { status: "incumplido" },
  },
  {
    clave: "en_progreso",
    titulo: "En progreso",
    detalle: () => "Abiertas dentro del plazo",
    cifra: (c) => c?.in_progress,
    tono: "aviso",
    icono: "clock-outline",
    params: { status: "en_progreso" },
  },
  {
    clave: "proximas",
    titulo: "Próximas a vencer",
    detalle: () => "En los próximos 7 días",
    cifra: (c) => c?.due_soon,
    tono: "info",
    icono: "timer-sand",
    // El mismo criterio de la web: en progreso, por vencimiento.
    params: { status: "en_progreso", sort: "due" },
    nota: "Todas las que están en progreso, de la que vence antes a la que vence después.",
  },
  {
    clave: "finalizado",
    titulo: "Finalizadas",
    detalle: (c) => `${c?.done_on_time ?? 0} a tiempo · ${c?.done_late ?? 0} fuera de plazo`,
    cifra: (c) => c?.done,
    tono: "bien",
    icono: "check-circle-outline",
    params: { status: "finalizado" },
  },
];

export function estadoDeLaBandeja(clave) {
  return ESTADOS_DE_LA_BANDEJA.find((e) => e.clave === clave) ?? null;
}

/** Lo de escritorio que se abre en el navegador (decisión del usuario,
 * 13/11/2026), con el permiso que lo muestra en la web. */
export const MATRIZ_EN_EL_NAVEGADOR = [
  {
    permisos: PERMISOS_MATRIZ,
    nombre: "Matriz completa: crear, importar, validar",
    ruta: "/admin/matriz/obligaciones",
    icono: "table-large",
  },
  { permisos: PERMISOS_MATRIZ, nombre: "Documentos", ruta: "/admin/matriz/documentos", icono: "folder-open-outline" },
  { permisos: PERMISOS_MATRIZ, nombre: "Reportes", ruta: "/admin/reportes/matriz", icono: "chart-bar" },
  {
    permisos: ["matriz.ver_auditoria"],
    nombre: "Auditoría",
    ruta: "/admin/auditoria?modulo=matriz",
    icono: "history",
  },
  {
    permisos: PERMISOS_MATRIZ,
    nombre: "Configuración de recordatorios",
    ruta: "/admin/configuracion/recordatorios",
    icono: "cog-outline",
  },
];

export function matrizEnElNavegador(permisos = []) {
  return MATRIZ_EN_EL_NAVEGADOR.filter((a) => a.permisos.some((p) => (permisos ?? []).includes(p)));
}

/** «N obligaciones». */
export function cuantas(n) {
  return n === 1 ? "1 obligación" : `${n} obligaciones`;
}
