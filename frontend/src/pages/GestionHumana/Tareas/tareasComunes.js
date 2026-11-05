/*
 * Etiquetas, formatos y reglas puras de Tareas y Equipo (portadas de Nexo:
 * `lib/timeFormat.ts`, `lib/targetTime.ts`, `lib/endDate.ts`,
 * `lib/businessTime.ts` y `components/tasks/*`). Sin acceso al servidor.
 *
 * Fechas: el inicio y el fin de una tarea se guardan como medianoche UTC del
 * día elegido, y el servidor los devuelve en la hora de Ecuador
 * (`2026-07-31T19:00:00-05:00` es el 1 de agosto). Por eso el día se lee con
 * los getters UTC (`diaUTC`), nunca recortando el texto.
 */

export const ESTADOS = ["PENDIENTE", "EN_PROGRESO", "COMPLETADA"];

export const ESTADO = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
};

export const TONO_ESTADO = {
  PENDIENTE: "mz-pill--neutral",
  EN_PROGRESO: "mz-pill--info",
  COMPLETADA: "mz-pill--ok",
};

export const ICONO_ESTADO = {
  PENDIENTE: "circle",
  EN_PROGRESO: "play-circle",
  COMPLETADA: "check-circle",
};

export const PRIORIDADES = ["ALTA", "MEDIA", "BAJA"];
export const PRIORIDAD = { ALTA: "Alta", MEDIA: "Media", BAJA: "Baja" };
export const TONO_PRIORIDAD = {
  ALTA: "mz-pill--bad",
  MEDIA: "mz-pill--warn",
  BAJA: "mz-pill--neutral",
};
const ORDEN_PRIORIDAD = { ALTA: 0, MEDIA: 1, BAJA: 2 };

export const FRECUENCIAS = [
  "MENSUAL",
  "SEMANAL",
  "DIARIA",
  "QUINCENAL",
  "PUNTUAL",
];
export const FRECUENCIA = {
  MENSUAL: "Mensual",
  SEMANAL: "Semanal",
  DIARIA: "Diaria",
  QUINCENAL: "Quincenal",
  PUNTUAL: "Puntual",
};

export const TIPO = { FIJA: "Fija", SEGUIMIENTO: "Seguimiento" };

/** Máximo de registros de horas de una tarea Fija (el servidor lo exige). */
export const MAXIMO_REGISTROS_FIJA = 2;

/** Estado de la Fecha Fin (decisión del líder). */
export const ESTADO_FECHA_FIN = {
  PENDIENTE: "Pendiente de validación",
  APROBADA: "Fecha aprobada",
  MODIFICADA: "Modificada por el líder",
  RECHAZADA: "Fecha rechazada",
};

export const TONO_FECHA_FIN = {
  PENDIENTE: "mz-pill--warn",
  APROBADA: "mz-pill--ok",
  MODIFICADA: "mz-pill--info",
  RECHAZADA: "mz-pill--bad",
};

export const ICONO_FECHA_FIN = {
  PENDIENTE: "hourglass-split",
  APROBADA: "check-circle",
  MODIFICADA: "pencil",
  RECHAZADA: "x-circle",
};

export const ACCION_FECHA_FIN = {
  PROPUESTA: "Fecha propuesta",
  APROBADA: "Aprobada",
  MODIFICADA: "Modificada",
  RECHAZADA: "Rechazada",
};

/** Motivos del ajuste del Tiempo Objetivo (`TargetTimeAuditLog.Reason`). */
export const MOTIVO_TIEMPO_OBJETIVO = {
  PROCEDIMIENTO_ESTANDAR: "Basado en procedimiento estándar",
  COMPLEJIDAD_DETECTADA: "Complejidad detectada",
  CAMBIO_ALCANCE: "Cambio de alcance",
  REVISION_LIDER: "Revisión del líder",
  OTRO: "Otro",
};

export const AYUDA_TIEMPO_OBJETIVO =
  "Tiempo esperado para completar la actividad en condiciones normales de trabajo. Es un estándar operativo, no una predicción personal.";

/** Los roles de Gestión Humana (`apps.tasks.roles.ROLE_LABEL`). */
export const ROL = {
  "Administrador de Gestión Humana": "Administrador de Gestión Humana",
  JEFE_NACIONAL: "Jefe Nacional",
  COORDINADOR_NACIONAL: "Coordinador Nacional",
  COORDINADOR_ZS: "Coordinador ZS",
  ANALISTA_CC: "Analista Clima y Cultura",
  ANALISTA_SELECCION: "Analista Selección de Personal",
  ASISTENTE_SELECCION: "Asistente de Selección",
  ASISTENTE_GH: "Asistente de Gestión Humana",
  ASISTENTE_GH_ZS: "Asistente GH ZS",
  TRABAJO_SOCIAL: "Trabajo Social",
  ASISTENTE_NOMINA: "Asistente de Nómina",
};

export const ROLES = Object.keys(ROL);

export function rolLegible(rol) {
  if (!rol) return "";
  return ROL[rol] ?? rol;
}

/** Paleta de las tarjetas (`components/tasks/colors.ts`). Es un dato de la
 * tarea, no un color de la interfaz: cada valor tiene su clase en
 * `Tareas.css`. */
export const COLORES = [
  { valor: "blue", nombre: "Azul" },
  { valor: "green", nombre: "Verde" },
  { valor: "purple", nombre: "Morado" },
  { valor: "orange", nombre: "Naranja" },
  { valor: "pink", nombre: "Rosa" },
  { valor: "red", nombre: "Rojo" },
  { valor: "yellow", nombre: "Amarillo" },
  { valor: "gray", nombre: "Gris" },
  { valor: "turquoise", nombre: "Turquesa" },
  { valor: "black", nombre: "Negro" },
];

export function claseDeColor(valor) {
  return COLORES.some((c) => c.valor === valor) ? `gt-color--${valor}` : "";
}

// --- Personas -------------------------------------------------------------

/** El nombre de una persona, venga como `{name}` (Equipo, asignables) o como
 * `{first_name, last_name, username}` (tareas, comentarios, historial). */
export function nombreDe(persona) {
  if (!persona) return "—";
  if (persona.name) return persona.name;
  const completo = `${persona.first_name ?? ""} ${persona.last_name ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
  return completo || persona.username || "—";
}

/** «Sofía Pérez» → «SP». */
export function iniciales(nombre) {
  const partes = String(nombre ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return "?";
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// --- Fechas -----------------------------------------------------------------

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** El día calendario (AAAA-MM-DD) de una fecha de tarea, leído en UTC. */
export function diaUTC(valor) {
  if (!valor) return "";
  const texto = String(valor);
  if (DIA.test(texto)) return texto;
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return texto.slice(0, 10);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** «2026-08-01» → «01/08/2026». */
export function fechaCorta(valor) {
  const dia = diaUTC(valor);
  if (!dia) return "—";
  const [y, m, d] = dia.split("-");
  return `${d}/${m}/${y}`;
}

/** El día elegido en un `<input type="date">`, como lo guarda el servidor. */
export function aMedianocheUTC(dia) {
  return `${dia}T00:00:00Z`;
}

/** Hoy en el navegador (local: a las 19:00 de Ecuador `toISOString()` ya da
 * el día siguiente). */
export function hoy() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

/** Vencida: el día de hoy ya pasó el de su fin y no está completada (el día
 * del fin todavía cuenta como vigente). */
export function vencida(tarea, referencia = hoy()) {
  if (!tarea || tarea.status === "COMPLETADA") return false;
  return referencia > diaUTC(tarea.end_date);
}

/** Días entre dos días AAAA-MM-DD (b − a). */
export function diasEntre(a, b) {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000,
  );
}

/** Un día AAAA-MM-DD más `n` días. */
export function sumarDias(dia, n) {
  const [y, m, d] = dia.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d + n));
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}-${String(f.getUTCDate()).padStart(2, "0")}`;
}

const DIAS_SEMANA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

export function diaDeLaSemana(dia) {
  const [y, m, d] = dia.split("-").map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Los días que admite el registro retroactivo (`retroactive_valid_dates` del
 * servidor): los `ventana` días laborables anteriores a hoy (sin hoy) y, si
 * hoy es lunes o martes, el sábado y el domingo inmediatos. Del más reciente
 * al más antiguo. El servidor lo vuelve a validar.
 */
export function fechasRetroactivas(hoyDia, ventana) {
  const [y, m, d] = hoyDia.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dias = [];
  let cursor = hoyDia;
  while (dias.length < ventana) {
    cursor = sumarDias(cursor, -1);
    const [cy, cm, cd] = cursor.split("-").map(Number);
    const semana = new Date(Date.UTC(cy, cm - 1, cd)).getUTCDay();
    if (semana !== 0 && semana !== 6) dias.push(cursor);
  }
  if (dow === 1 || dow === 2) {
    const lunes = sumarDias(hoyDia, -(dow - 1));
    dias.push(sumarDias(lunes, -1), sumarDias(lunes, -2));
  }
  return [...new Set(dias)].sort().reverse();
}

/** «Septiembre 2026». */
export function mesLargo(year, month) {
  const nombre = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    "es-EC",
    { month: "long", timeZone: "UTC" },
  );
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${year}`;
}

/** «hace 5 min», «hace 3 h», «hace 2 d». */
export function haceCuanto(iso, ahora = Date.now()) {
  if (!iso) return "—";
  const minutos = Math.max(
    0,
    Math.floor((ahora - new Date(iso).getTime()) / 60000),
  );
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

// --- Horas ------------------------------------------------------------------

/** «2 h 30 min», «45 min», «3 h». */
export function duracion(minutos) {
  const total = Math.max(0, Math.round(minutos ?? 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
}

/** Horas decimales (6.75) → «6 h 45 min». */
export function horas(decimal) {
  return duracion(Math.round((decimal ?? 0) * 60));
}

export const AYUDA_HORAS = "Formato HH.MM: 6.30 son 6 h 30 min.";
export const HORAS_INVALIDAS =
  "Use el formato HH.MM (por ejemplo, 6.30 son 6 h 30 min; los minutos van de 00 a 59).";

/** Horas decimales (6.75) → texto HH.MM para un campo («6.45»). */
export function horasATexto(decimal) {
  const total = Math.max(0, Math.round((decimal ?? 0) * 60));
  return `${Math.floor(total / 60)}.${String(total % 60).padStart(2, "0")}`;
}

/** Si el texto es HH.MM válido (con punto o coma; minutos de 00 a 59). */
export function horasValidas(texto) {
  const t = String(texto ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d+(\.\d{2})?$/.test(t)) return false;
  const minutos = t.split(".")[1];
  return minutos === undefined || Number(minutos) <= 59;
}

/** Texto HH.MM («6.45») → horas decimales (6.75). Validar antes. */
export function textoAHoras(texto) {
  const [h, m = "0"] = String(texto).trim().replace(",", ".").split(".");
  return (
    Math.round(((parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60) * 1000) /
    1000
  );
}

/** «HH:MM» → minutos desde la medianoche, o `null`. */
export function minutosDe(hora) {
  const encontrado = /^(\d{2}):(\d{2})$/.exec(hora ?? "");
  if (!encontrado) return null;
  const h = Number(encontrado[1]);
  const m = Number(encontrado[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Si `[a1, a2)` y `[b1, b2)` se cruzan (`ranges_overlap` del servidor). */
export function seSolapan(a1, a2, b1, b2) {
  const [s1, e1, s2, e2] = [a1, a2, b1, b2].map(minutosDe);
  if ([s1, e1, s2, e2].includes(null)) return false;
  return s1 < e2 && s2 < e1;
}

// --- Tiempo Objetivo ----------------------------------------------------------

/** La referencia oficial: el validado si existe; si no, el inicial. */
export function objetivoOficial(tarea) {
  return tarea?.target_time_validated ?? tarea?.estimated_hours ?? 0;
}

export function objetivoValidado(tarea) {
  return (
    tarea?.target_time_validated !== null &&
    tarea?.target_time_validated !== undefined
  );
}

// --- Motivos de registro de horas -------------------------------------------

/** Los motivos que la persona puede usar: activos, sin archivar y asignados a
 * alguno de sus roles (el servidor revisa lo mismo). */
export function motivosElegibles(motivos, roles = []) {
  return (motivos ?? []).filter(
    (m) =>
      m.is_active &&
      !m.is_archived &&
      (m.assigned_roles ?? []).some((r) => roles.includes(r)),
  );
}

export function nombreDelMotivo(motivos, clave) {
  return (motivos ?? []).find((m) => m.key === clave)?.label ?? clave;
}

// --- Orden de listas ----------------------------------------------------------

export function ordenar(tareas, clave, sentido) {
  if (!clave) return tareas;
  const valor = (t) => {
    switch (clave) {
      case "title":
        return t.title.toLowerCase();
      case "priority":
        return ORDEN_PRIORIDAD[t.priority] ?? 9;
      case "frequency":
        return FRECUENCIA[t.frequency] ?? t.frequency;
      case "start_date":
        return diaUTC(t.start_date);
      case "end_date":
        return diaUTC(t.end_date);
      case "objetivo":
        return objetivoOficial(t);
      case "real_hours":
        return t.real_hours ?? 0;
      case "comment_count":
        return t.comment_count ?? 0;
      default:
        return t[clave];
    }
  };
  const factor = sentido === "desc" ? -1 : 1;
  return [...tareas].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    if (va < vb) return -1 * factor;
    if (va > vb) return 1 * factor;
    return 0;
  });
}
