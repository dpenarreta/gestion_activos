import { vi } from "vitest";

/*
 * Datos de prueba del Escritorio, con la forma exacta de las respuestas de
 * `/api/v1/escritorio/` (ver `apps.escritorio.serializers` y
 * `services.resumen_de_acceso` / `services.hoy`).
 */

const op = (pares) => pares.map(([value, label]) => ({ value, label }));

export const ME = {
  user_id: 1,
  permissions: ["escritorio.acceder"],
  can_convert_to_task: true,
  unread_notes: 1,
  settings: {
    max_replies: 2,
    archive_retention_days: 15,
    trash_retention_hours: 48,
    snooze_presets_minutes: [15, 30, 60, 1440],
  },
  attachment: {
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
  },
  choices: {
    note_priority: op([
      ["INFORMACION", "Información"],
      ["RECORDATORIO", "Recordatorio"],
      ["IMPORTANTE", "Importante"],
      ["URGENTE", "Urgente"],
    ]),
    note_color: op([
      ["AMARILLO", "Amarillo"],
      ["ROSADO", "Rosado"],
      ["CELESTE", "Celeste"],
      ["VERDE", "Verde"],
      ["NARANJA", "Naranja"],
      ["LILA", "Lila"],
    ]),
    reminder_priority: op([
      ["BAJA", "Baja"],
      ["MEDIA", "Media"],
      ["ALTA", "Alta"],
      ["URGENTE", "Urgente"],
    ]),
    reminder_status: op([
      ["PENDIENTE", "Pendiente"],
      ["COMPLETADO", "Completado"],
    ]),
    reminder_repeat: op([
      ["UNA_VEZ", "Una vez"],
      ["DIARIO", "Diario"],
      ["SEMANAL", "Semanal"],
      ["MENSUAL", "Mensual"],
    ]),
  },
};

export const ME_SIN_TAREAS = { ...ME, can_convert_to_task: false };

export function persona(extra = {}) {
  return {
    id: 2,
    name: "Luis",
    full_name: "Luis Pérez",
    role: "ANALISTA_CC",
    role_label: "Analista Clima y Cultura",
    ...extra,
  };
}

export const ANA = persona({ id: 1, name: "Ana", full_name: "Ana Ruiz" });
export const LUIS = persona();

export function nota(extra = {}) {
  return {
    id: 20,
    message: "Revise el informe de asistencia.",
    priority: "IMPORTANTE",
    priority_label: "Importante",
    color: "AMARILLO",
    read: false,
    read_at: null,
    pinned: false,
    archived: false,
    archived_at: null,
    created_at: "2026-11-05T15:00:00Z",
    sender: LUIS,
    recipient: ANA,
    is_mine: false,
    reply_count: 0,
    can_reply: true,
    attachment: null,
    converted_to_reminder_id: null,
    converted_at: null,
    ...extra,
  };
}

export const NOTAS = [
  nota(),
  nota({
    id: 21,
    message: "Gracias por la ayuda.",
    priority: "INFORMACION",
    priority_label: "Información",
    color: "CELESTE",
    read: true,
    pinned: true,
    reply_count: 1,
    attachment: {
      name: "acta.pdf",
      mime: "application/pdf",
      size: 2048,
      viewer: "pdf",
      url: "/escritorio/notes/21/attachment/",
    },
  }),
];

export function recordatorio(extra = {}) {
  return {
    id: 30,
    title: "Enviar el reporte",
    description: "El del mes.",
    due_at: "2099-11-06T15:00:00Z",
    priority: "ALTA",
    priority_label: "Alta",
    status: "PENDIENTE",
    status_label: "Pendiente",
    repeat: "UNA_VEZ",
    repeat_label: "Una vez",
    completed_at: null,
    archived: false,
    archived_at: null,
    converted_to_task_id: null,
    converted_to_task_at: null,
    attachment: null,
    created_at: "2026-11-01T15:00:00Z",
    ...extra,
  };
}

export const RECORDATORIOS = [
  recordatorio(),
  recordatorio({
    id: 31,
    title: "Pagar la cuota",
    due_at: "2020-01-01T15:00:00Z",
    priority: "URGENTE",
    repeat: "MENSUAL",
  }),
  recordatorio({
    id: 32,
    title: "Revisar contratos",
    status: "COMPLETADO",
    status_label: "Completado",
    completed_at: "2026-11-04T15:00:00Z",
  }),
];

export const HOY = {
  pending_notes: [
    {
      id: 20,
      message: "Revise el informe de asistencia.",
      priority: "IMPORTANTE",
      color: "AMARILLO",
      pinned: false,
      created_at: "2026-11-05T15:00:00Z",
      sender_name: "Luis",
    },
  ],
  today_reminders: [
    {
      id: 31,
      title: "Pagar la cuota",
      due_at: "2026-11-06T13:00:00Z",
      priority: "URGENTE",
      overdue: true,
    },
  ],
  upcoming_tasks: [
    {
      id: 7,
      title: "Cerrar nómina",
      end_date: "2026-11-08T00:00:00Z",
      priority: "ALTA",
      status: "PENDIENTE",
    },
  ],
  recent_projects: null,
};

export function errorApi(status, message, code = "error", details = null) {
  const err = new Error(message);
  err.response = { status, data: { error: { code, message, details } } };
  return err;
}

export function servicioFalso(me = ME) {
  return {
    yo: vi.fn().mockResolvedValue(me),
    hoy: vi.fn().mockResolvedValue(HOY),
    buscar: vi.fn().mockResolvedValue({
      notes: [nota()],
      reminders: [recordatorio()],
    }),
    notas: vi.fn().mockResolvedValue(NOTAS),
    crearNota: vi
      .fn()
      .mockImplementation(async ({ message }) =>
        nota({ id: 99, message, is_mine: true, recipient: LUIS, sender: ANA }),
      ),
    destinatarios: vi.fn().mockResolvedValue([LUIS]),
    sinLeer: vi.fn().mockResolvedValue({ unread: 0 }),
    obtenerNota: vi.fn().mockResolvedValue(nota()),
    accionDeNota: vi.fn().mockImplementation(async (id, action) => {
      const base = NOTAS.find((n) => n.id === id) ?? nota({ id });
      const cambio = {
        read: { read: true },
        pin: { pinned: true },
        unpin: { pinned: false },
        archive: { archived: true },
        unarchive: { archived: false },
      }[action];
      return { ...base, ...cambio };
    }),
    eliminarNota: vi.fn().mockResolvedValue({}),
    respuestas: vi.fn().mockResolvedValue([]),
    responder: vi.fn().mockImplementation(async (id, message) => ({
      id: 500,
      message,
      author: ANA,
      created_at: "2026-11-06T15:00:00Z",
    })),
    historialDeNota: vi.fn().mockResolvedValue([
      {
        id: 1,
        action: "CREATED",
        action_label: "Creado",
        user: LUIS,
        metadata: {},
        created_at: "2026-11-05T15:00:00Z",
      },
    ]),
    convertirEnRecordatorio: vi.fn().mockResolvedValue({
      reminder_id: 40,
      reminder_title: "Revise el informe de asistencia.",
      reminder: recordatorio({ id: 40 }),
    }),
    recordatorios: vi.fn().mockResolvedValue(RECORDATORIOS),
    crearRecordatorio: vi
      .fn()
      .mockImplementation(async (datos) => recordatorio({ id: 98, ...datos })),
    obtenerRecordatorio: vi.fn().mockResolvedValue(recordatorio()),
    editarRecordatorio: vi.fn().mockImplementation(async (id, cambios) => ({
      ...recordatorio(),
      ...cambios,
    })),
    accionDeRecordatorio: vi
      .fn()
      .mockImplementation(async (id, action, dueAt) => {
        const base = RECORDATORIOS.find((r) => r.id === id) ?? recordatorio();
        const cambio = {
          complete: { status: "COMPLETADO" },
          postpone: { due_at: dueAt, status: "PENDIENTE" },
          reopen: { status: "PENDIENTE", ...(dueAt ? { due_at: dueAt } : {}) },
          archive: { archived: true },
          unarchive: { archived: false },
        }[action];
        return { ...base, ...cambio };
      }),
    eliminarRecordatorio: vi.fn().mockResolvedValue({}),
    historialDeRecordatorio: vi.fn().mockResolvedValue([]),
    convertirEnTarea: vi
      .fn()
      .mockResolvedValue({ task_id: 77, task_title: "Enviar el reporte" }),
  };
}
