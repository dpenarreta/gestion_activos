/*
 * Etiquetas, tonos y reglas puras de Proyectos (portadas de Nexo:
 * `components/projects/types.ts` y la lógica de sus pestañas). Sin acceso al
 * servidor. Las fechas de un proyecto y de una fase se guardan como
 * medianoche UTC del día elegido (como las de Tareas): el día se lee con
 * `diaUTC` y se envía con `aMedianocheUTC`.
 */
import { diaUTC, nombreDe, rolLegible } from "../Tareas/tareasComunes";

export const ESTADOS_PROYECTO = [
  "PENDIENTE",
  "PLANIFICACION",
  "EN_EJECUCION",
  "EN_REVISION",
  "SUSPENDIDO",
  "COMPLETADO",
  "CANCELADO",
];

export const ESTADO_PROYECTO = {
  PENDIENTE: "Pendiente",
  PLANIFICACION: "Planificación",
  EN_EJECUCION: "En ejecución",
  EN_REVISION: "En revisión",
  SUSPENDIDO: "Suspendido",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

export const TONO_ESTADO_PROYECTO = {
  PENDIENTE: "mz-pill--neutral",
  PLANIFICACION: "mz-pill--info",
  EN_EJECUCION: "mz-pill--info",
  EN_REVISION: "mz-pill--warn",
  SUSPENDIDO: "mz-pill--warn",
  COMPLETADO: "mz-pill--ok",
  CANCELADO: "mz-pill--bad",
};

/** Los estados con los que se puede crear un proyecto (como en Nexo). */
export const ESTADOS_INICIALES = ["PENDIENTE", "PLANIFICACION", "EN_EJECUCION"];

/** Solo Completado o Cancelado detienen la acumulación de horas. */
export const ESTADOS_CERRADOS = ["COMPLETADO", "CANCELADO"];

export const ESTADOS_FASE = ["PENDIENTE", "EN_PROGRESO", "COMPLETADA"];
export const ESTADO_FASE = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
};
export const TONO_ESTADO_FASE = {
  PENDIENTE: "mz-pill--neutral",
  EN_PROGRESO: "mz-pill--info",
  COMPLETADA: "mz-pill--ok",
};

export const CATEGORIAS_DOCUMENTO = [
  "PDF",
  "WORD",
  "EXCEL",
  "ACTA",
  "CORREO",
  "OTRO",
];

export const CATEGORIA_DOCUMENTO = {
  PDF: "PDF",
  EXCEL: "Excel",
  WORD: "Word",
  CORREO: "Correo",
  ACTA: "Acta",
  OTRO: "Otro",
};

/**
 * Los tipos de archivo que se ofrecen al elegir un documento, en un solo
 * lugar. Es solo una ayuda del selector: quien decide es el servidor, que
 * valida la extensión y la firma del contenido y responde con el motivo
 * (lo que se muestra tal cual). Si el servidor cambia la lista, se cambia
 * aquí.
 */
export const TIPOS_DE_DOCUMENTO = {
  accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx",
  ayuda:
    "PDF, Word, Excel o PowerPoint. Los PDF y las presentaciones se ven dentro del sistema.",
};

export const EVENTO_HISTORIAL = {
  CREADO: "Proyecto creado",
  ACTUALIZADO: "Proyecto actualizado",
  PARTICIPANTE_AGREGADO: "Participante agregado",
  PARTICIPANTE_ELIMINADO: "Participante eliminado",
  RESPONSABLE_CAMBIADO: "Responsable cambiado",
  ESTADO_CAMBIADO: "Cambio de estado",
  FASE_AGREGADA: "Fase agregada",
  FASE_ACTUALIZADA: "Fase actualizada",
  FASE_ELIMINADA: "Fase eliminada",
  COMENTARIO_AGREGADO: "Comentario",
  ACTIVIDAD_REGISTRADA: "Actividad registrada",
  DOCUMENTO_AGREGADO: "Documento agregado",
  ELIMINADO: "Movido a la papelera",
  RESTAURADO: "Restaurado desde la papelera",
};

/** Descripción mínima de una actividad (la misma regla del servidor). */
export const MINIMO_DESCRIPCION = 15;

export const AYUDA_TIEMPO_OBJETIVO =
  "Estimación global de horas para todo el proyecto: nunca se ajusta sola con las horas registradas. Puede afinarla por fase en la pestaña Fases.";

/** El rol de Gestión Humana de una persona (`roles: [{id, name}]`). */
export function rolDe(persona) {
  const rol = persona?.roles?.[0];
  return rolLegible(typeof rol === "string" ? rol : rol?.name);
}

export { nombreDe };

/** Horas registradas / objetivo, en % (tope 100), como en Nexo. */
export function porcentajeEjecutado(proyecto) {
  const objetivo = proyecto?.target_time_hours ?? 0;
  if (objetivo <= 0) return 0;
  return Math.min(
    100,
    Math.round(((proyecto.real_hours ?? 0) / objetivo) * 100),
  );
}

/** «Avance»: el promedio del progreso de las fases o, sin fases, el % de
 * tiempo ejecutado (Nexo, Sprint 2.1 §10). Derivado en el cliente. */
export function avance(proyecto) {
  const fases = proyecto?.phases ?? [];
  if (fases.length) {
    return Math.round(
      fases.reduce((s, f) => s + (f.progress ?? 0), 0) / fases.length,
    );
  }
  return porcentajeEjecutado(proyecto);
}

/** El próximo vencimiento: la fecha objetivo del proyecto o de una fase que
 * todavía no pasó. */
export function proximoVencimiento(proyecto, hoyDia) {
  const candidatos = [
    proyecto?.target_date,
    ...(proyecto?.phases ?? []).map((f) => f.target_date),
  ]
    .filter(Boolean)
    .map(diaUTC)
    .filter((d) => d >= hoyDia)
    .sort();
  return candidatos[0] ?? null;
}

/** Las fases en las que la persona puede registrar: donde es responsable,
 * donde ya registró o las que no tienen responsable (Nexo, Sprint 2.1 §5). */
export function fasesVisibles(fases, actividades, usuarioId) {
  return (fases ?? []).filter(
    (f) =>
      !f.responsible ||
      f.responsible.id === usuarioId ||
      (actividades ?? []).some(
        (a) => a.phase_id === f.id && a.author?.id === usuarioId,
      ),
  );
}

/** «HH:MM» → minutos de duración entre dos horas, o `null`. */
export function duracionEntre(inicio, fin) {
  const partes = (h) => /^(\d{2}):(\d{2})$/.exec(h ?? "");
  const a = partes(inicio);
  const b = partes(fin);
  if (!a || !b) return null;
  const total =
    Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2]));
  return total > 0 ? total : null;
}

/** El día de agrupación de una actividad: su fecha (retroactiva) o el día
 * en que se registró. */
export function diaDeActividad(actividad) {
  return diaUTC(actividad.activity_date ?? actividad.created_at);
}

/** «Vence en 2 d 4 h» / «Vence en 5 h 10 min» / vencido. */
export function tiempoParaPurga(ms) {
  if (!ms || ms <= 0) return "Vencido: pendiente de eliminación automática";
  const horas = Math.floor(ms / 3600000);
  const minutos = Math.floor((ms % 3600000) / 60000);
  if (horas >= 24)
    return `Vence en ${Math.floor(horas / 24)} d ${horas % 24} h`;
  return `Vence en ${horas} h ${minutos} min`;
}

/** «12,5 KB», «1,2 MB». */
export function tamano(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n.toLocaleString("es-EC")} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toLocaleString("es-EC", { maximumFractionDigits: 1 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString("es-EC", { maximumFractionDigits: 1 })} MB`;
}

/** Etiquetas escritas «a, b, c» → lista limpia. */
export function etiquetasDeTexto(texto) {
  return String(texto ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
