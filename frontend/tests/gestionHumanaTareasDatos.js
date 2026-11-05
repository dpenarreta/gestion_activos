/*
 * Datos de prueba de Tareas y Equipo (Gestión Humana), con la forma exacta
 * del backend (`apps/tasks`, snake_case). Las fechas de las tareas llegan en
 * la hora de Ecuador, como las serializa el servidor
 * (`TIME_ZONE=America/Guayaquil`): la medianoche UTC del 1 de agosto es
 * `2026-07-31T19:00:00-05:00`.
 */
import { vi } from "vitest";

export const YO = 1;

export const ME = {
  permissions: ["tareas.acceder"],
  role: "ASISTENTE_GH",
  roles: ["ASISTENTE_GH"],
  has_cargo: true,
  team_size: 0,
  is_admin: false,
};

export const LIDER = {
  ...ME,
  permissions: [
    "tareas.acceder",
    "tareas.validar",
    "tareas.regularizar",
    "tareas.cerrar_mes",
    "equipo.ver",
  ],
  role: "JEFE_NACIONAL",
  roles: ["JEFE_NACIONAL"],
  team_size: 2,
};

const persona = (id, nombre, apellido, rol = "ASISTENTE_GH") => ({
  id,
  username: `${nombre.toLowerCase()}`,
  first_name: nombre,
  last_name: apellido,
  email: `${nombre.toLowerCase()}@grupolaar.com`,
  roles: [{ id: 10, name: rol }],
});

export const YO_PERSONA = persona(YO, "Ana", "Pérez");
export const OTRA = persona(2, "Luis", "Mora", "ANALISTA_CC");

export function tarea(extra = {}) {
  return {
    id: 101,
    title: "Informe mensual",
    description: "",
    type: "FIJA",
    status: "PENDIENTE",
    priority: "ALTA",
    frequency: "MENSUAL",
    start_date: "2026-10-31T19:00:00-05:00",
    end_date: "2026-11-14T19:00:00-05:00",
    estimated_hours: 6.5,
    real_hours: 0,
    target_time_validated: null,
    end_date_approval_status: "PENDIENTE",
    progress: 0,
    color: "",
    corrected: false,
    archived_month: null,
    assigned_to: YO_PERSONA,
    created_by: YO_PERSONA,
    comment_count: 0,
    has_unread_comments: false,
    created_at: "2026-11-01T10:00:00-05:00",
    updated_at: "2026-11-01T10:00:00-05:00",
    ...extra,
  };
}

export const TAREAS = [
  tarea(),
  tarea({
    id: 102,
    title: "Seguimiento de vacantes",
    type: "SEGUIMIENTO",
    status: "EN_PROGRESO",
    priority: "MEDIA",
    frequency: "SEMANAL",
    progress: 40,
    comment_count: 2,
    has_unread_comments: true,
  }),
];

export const MOTIVOS = [
  {
    id: 1,
    key: "REUNION",
    label: "Reunión",
    description: "",
    is_active: true,
    is_archived: false,
    archived_at: null,
    assigned_roles: ["ASISTENTE_GH"],
  },
  {
    id: 2,
    key: "SOLO_JEFES",
    label: "Solo jefes",
    description: "",
    is_active: true,
    is_archived: false,
    archived_at: null,
    assigned_roles: ["JEFE_NACIONAL"],
  },
];

export const OBJETIVO = {
  estimated_hours: 6.5,
  target_time_validated: null,
  target_time_validated_at: null,
  validated_by: null,
  is_validated: false,
  official_target: 6.5,
  real_hours: 0,
  deviation: { hours: -6.5, pct: -100 },
  can_validate: false,
  audit_history: [],
  historical_deviation: { available: false, reason: "Sin historial." },
};

export const FECHA_FIN = {
  end_date: "2026-11-14T19:00:00-05:00",
  end_date_approval_status: "PENDIENTE",
  end_date_approved_at: null,
  approved_by: null,
  can_validate: false,
  audit_history: [],
};

export const EQUIPO = [
  {
    id: 2,
    name: "Luis Mora",
    email: "l***@grupolaar.com",
    role: "ANALISTA_CC",
    tasks: { total: 3, completed: 1, in_progress: 1, pending: 1 },
    last_activity_at: null,
  },
];

export const VISTA_CIERRE = {
  year: 2026,
  month: 10,
  already_closed: false,
  total: 5,
  completed: 3,
  pending: 1,
  in_progress: 1,
  continued_active: 2,
  to_duplicate: 4,
  cutoff_date: "2026-10-31",
  closure_type: "NORMAL",
  calendar_days_total: 31,
  calendar_days_considered: 31,
  working_days_considered: 22,
  working_hours_considered: 140,
  pending_closures: [{ year: 2026, month: 10 }],
};

/** Un error de la API con la forma del contrato uniforme. */
export function errorApi(status, message, code = "error", details = null) {
  const err = new Error(message);
  err.response = { status, data: { error: { code, message, details } } };
  return err;
}

/** El servicio falso, con respuestas por defecto. */
export function servicioFalso() {
  return {
    yo: vi.fn().mockResolvedValue(ME),
    asignables: vi.fn().mockResolvedValue([
      {
        id: YO,
        name: "Ana Pérez",
        email: "ana@grupolaar.com",
        role: "ASISTENTE_GH",
      },
      {
        id: 2,
        name: "Luis Mora",
        email: "luis@grupolaar.com",
        role: "ANALISTA_CC",
      },
    ]),
    ajustes: vi.fn().mockResolvedValue({
      retroactive_window_business_days: 2,
      horas_efectivas_dia: 6.5,
      horas_esperadas_mes: 140,
      first_comment_role: null,
      retroactive_notify_users: [],
    }),
    guardarAjustes: vi.fn(),
    listar: vi.fn().mockResolvedValue(TAREAS),
    obtener: vi.fn().mockResolvedValue(TAREAS[0]),
    crear: vi.fn(),
    actualizar: vi.fn(),
    eliminar: vi.fn().mockResolvedValue({}),
    corregirArchivada: vi.fn(),
    comentarios: vi.fn().mockResolvedValue([]),
    comentar: vi.fn(),
    actividades: vi.fn().mockResolvedValue([]),
    registrarActividad: vi.fn(),
    registrarRetroactiva: vi.fn(),
    editarActividad: vi.fn(),
    eliminarActividad: vi.fn(),
    comentariosDeActividad: vi.fn().mockResolvedValue([]),
    comentarActividad: vi.fn(),
    agendaDelDia: vi.fn().mockResolvedValue([]),
    motivos: vi.fn().mockResolvedValue(MOTIVOS),
    crearMotivo: vi.fn(),
    actualizarMotivo: vi.fn(),
    tiempoObjetivo: vi.fn().mockResolvedValue(OBJETIVO),
    validarTiempoObjetivo: vi.fn(),
    fechaFin: vi.fn().mockResolvedValue(FECHA_FIN),
    decidirFechaFin: vi.fn(),
    pendientes: vi.fn(),
    validarEnBloque: vi.fn(),
    aprobarFechasEnBloque: vi.fn(),
    vistaPreviaDelCierre: vi.fn().mockResolvedValue(VISTA_CIERRE),
    cerrarMes: vi.fn(),
    repositorio: vi.fn().mockResolvedValue([]),
    repositorioDelMes: vi.fn().mockResolvedValue([]),
    importar: vi.fn(),
    descargarPlantilla: vi.fn(),
    equipo: vi.fn().mockResolvedValue(EQUIPO),
    tareasDe: vi.fn().mockResolvedValue([]),
  };
}
