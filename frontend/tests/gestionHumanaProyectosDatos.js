/*
 * Datos de prueba de Proyectos (Gestión Humana), con la forma exacta del
 * backend (`apps/projects`, snake_case). Las fechas son medianoche UTC del
 * día elegido, como las guarda el servidor.
 */
import { vi } from "vitest";

export const YO = 1;

const persona = (id, nombre, apellido, rol = "ASISTENTE_GH") => ({
  id,
  username: nombre.toLowerCase(),
  first_name: nombre,
  last_name: apellido,
  email: `${nombre.toLowerCase()}@grupolaar.com`,
  roles: [{ id: 10, name: rol }],
});

export const ANA = persona(YO, "Ana", "Pérez");
export const LUIS = persona(2, "Luis", "Mora", "ANALISTA_CC");
export const SOFIA = persona(3, "Sofía", "Ruiz", "COORDINADOR_ZS");

export const ME = {
  permissions: ["proyectos_gh.acceder", "proyectos_gh.crear"],
  can_create: true,
  can_supervise: false,
  is_admin: false,
};

export const ME_LECTOR = {
  permissions: ["proyectos_gh.acceder"],
  can_create: false,
  can_supervise: false,
  is_admin: false,
};

export function proyecto(extra = {}) {
  return {
    id: 10,
    name: "Plan de bienestar 2027",
    description: "Programa anual de bienestar laboral.",
    status: "EN_EJECUCION",
    priority: "ALTA",
    area: "Clima y cultura",
    tags: ["bienestar", "2027"],
    start_date: "2026-11-01T00:00:00Z",
    target_date: "2026-12-15T00:00:00Z",
    target_time_hours: 40,
    real_hours: 6.5,
    completed_at: null,
    responsible: ANA,
    created_by: ANA,
    participant_count: 2,
    phase_count: 1,
    comment_count: 0,
    document_count: 1,
    created_at: "2026-11-01T15:00:00Z",
    updated_at: "2026-11-02T15:00:00Z",
    ...extra,
  };
}

export function fase(extra = {}) {
  return {
    id: 50,
    name: "Diagnóstico",
    status: "EN_PROGRESO",
    responsible: LUIS,
    start_date: "2026-11-01T00:00:00Z",
    target_date: "2026-11-20T00:00:00Z",
    progress: 40,
    notes: "",
    target_time_hours: 10,
    order: 1,
    registered_minutes: 150,
    participants: [{ id: 2, name: "Luis" }],
    ...extra,
  };
}

export function detalle(extra = {}) {
  return {
    ...proyecto(),
    observations: "Coordinar con Talento.",
    participants: [
      { id: 100, user: ANA, added_by: ANA, added_at: "2026-11-01T15:00:00Z" },
      { id: 101, user: LUIS, added_by: ANA, added_at: "2026-11-01T15:00:00Z" },
    ],
    phases: [fase()],
    last_activity: {
      author_name: "Luis",
      created_at: "2026-11-02T15:00:00Z",
    },
    activity_count: 1,
    can_manage: true,
    can_participate: true,
    can_delete: true,
    ...extra,
  };
}

export function documento(extra = {}) {
  return {
    id: 70,
    category: "PDF",
    file_name: "acta-inicio.pdf",
    mime_type: "application/pdf",
    file_size: 20480,
    version: 1,
    previous_version_id: null,
    activity_id: null,
    uploaded_by: ANA,
    created_at: "2026-11-02T15:00:00Z",
    file_url: "/projects/10/documents/70/file/",
    viewable: true,
    viewer: "pdf",
    ...extra,
  };
}

export const EN_PAPELERA = {
  id: 11,
  name: "Proyecto viejo",
  status: "CANCELADO",
  responsible: { id: 1, name: "Ana Pérez" },
  created_by: { id: 1, name: "Ana Pérez" },
  deleted_at: "2026-11-03T15:00:00Z",
  expires_at: "2026-11-10T15:00:00Z",
  ms_remaining: 3 * 86400000 + 4 * 3600000,
  can_delete: true,
};

export function errorApi(status, message, code = "error", details = null) {
  const err = new Error(message);
  err.response = { status, data: { error: { code, message, details } } };
  return err;
}

export function servicioFalso() {
  return {
    yo: vi.fn().mockResolvedValue(ME),
    miembros: vi.fn().mockResolvedValue([ANA, LUIS, SOFIA]),
    listar: vi.fn().mockResolvedValue([proyecto()]),
    obtener: vi.fn().mockResolvedValue(detalle()),
    crear: vi.fn(),
    actualizar: vi.fn(),
    enviarAPapelera: vi.fn().mockResolvedValue({ success: true }),
    papelera: vi.fn().mockResolvedValue([EN_PAPELERA]),
    restaurar: vi.fn().mockResolvedValue({ success: true }),
    eliminarParaSiempre: vi.fn().mockResolvedValue({ success: true }),
    agregarParticipante: vi.fn(),
    quitarParticipante: vi.fn().mockResolvedValue({ success: true }),
    crearFase: vi.fn(),
    actualizarFase: vi.fn(),
    eliminarFase: vi.fn().mockResolvedValue({ success: true }),
    actividades: vi.fn().mockResolvedValue([]),
    registrarActividad: vi.fn(),
    comentarios: vi.fn().mockResolvedValue([]),
    comentar: vi.fn(),
    historial: vi.fn().mockResolvedValue([]),
    documentos: vi.fn().mockResolvedValue([documento()]),
    subirDocumento: vi.fn(),
  };
}
