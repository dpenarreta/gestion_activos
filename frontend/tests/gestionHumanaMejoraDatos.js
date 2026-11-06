import { vi } from "vitest";

/*
 * Datos de prueba de Mejora continua, con la forma exacta de las respuestas
 * de `/api/v1/mejora-continua/` (ver `apps.mejora_continua.serializers` y
 * `services.resumen_de_acceso`).
 */

const ADJUNTO = {
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

export const ME = {
  user_id: 1,
  permissions: ["mejora_continua.acceder"],
  can_propose: true,
  can_vote: true,
  can_manage: false,
  sees_all: false,
  innovador: false,
  attachment: ADJUNTO,
};

export const ME_LECTOR = {
  ...ME,
  permissions: ["mejora_continua.ver_todas"],
  can_propose: false,
  can_vote: false,
  sees_all: true,
};

export const ME_GESTOR = {
  ...ME,
  permissions: ["mejora_continua.acceder", "mejora_continua.gestionar"],
  can_manage: true,
  sees_all: true,
};

const ETIQUETA = {
  PROPUESTA: "Propuesta",
  EN_REVISION: "En revisión",
  APROBADA: "Aprobada",
  EN_DESARROLLO: "En desarrollo",
  EN_PRUEBAS: "En pruebas",
  IMPLEMENTADA: "Implementada",
  RECHAZADA: "Rechazada",
};

export function persona(extra = {}) {
  return {
    id: 2,
    username: "luis",
    first_name: "Luis",
    last_name: "Pérez",
    name: "Luis",
    full_name: "Luis Pérez",
    role: "ANALISTA_CC",
    role_label: "Analista Clima y Cultura",
    innovador: false,
    ...extra,
  };
}

export function idea(extra = {}) {
  const status = extra.status ?? "PROPUESTA";
  return {
    id: 10,
    title: "Digitalizar las solicitudes de vacaciones",
    description: "Hoy se llenan en papel.\nSe pierden.",
    impact: "ALTO",
    impact_label: "Alto",
    status,
    status_label: ETIQUETA[status],
    progress: 0,
    author: persona(),
    is_mine: false,
    vote_count: 3,
    voted_by_me: false,
    latest_rejection_comment: null,
    attachment: null,
    created_at: "2026-11-01T15:00:00Z",
    updated_at: "2026-11-01T15:00:00Z",
    ...extra,
  };
}

export const IDEAS = [
  idea(),
  idea({
    id: 11,
    title: "Tablero de clima laboral",
    impact: "MEDIO",
    impact_label: "Medio",
    status: "EN_DESARROLLO",
    status_label: "En desarrollo",
    progress: 40,
    is_mine: true,
    author: persona({ id: 1, name: "Ana", full_name: "Ana Ruiz" }),
    voted_by_me: true,
    vote_count: 5,
  }),
  idea({
    id: 12,
    title: "Encuesta de salida",
    impact: "BAJO",
    impact_label: "Bajo",
    status: "RECHAZADA",
    status_label: "Rechazada",
    latest_rejection_comment: "Ya existe en otro proceso.",
    author: persona({ id: 3, full_name: "Marta Ríos", innovador: true }),
  }),
];

export function detalle(extra = {}) {
  return {
    ...idea(),
    attachment: {
      name: "propuesta.pdf",
      mime: "application/pdf",
      size: 204800,
      viewer: "pdf",
      url: "/mejora-continua/ideas/10/attachment/",
    },
    history: [
      {
        id: 1,
        from_status: "PROPUESTA",
        from_status_label: "Propuesta",
        to_status: "EN_REVISION",
        to_status_label: "En revisión",
        comment: "Revisemos.",
        created_at: "2026-11-02T15:00:00Z",
        changer: persona({ id: 5, full_name: "Jefa Nacional" }),
      },
    ],
    can_manage: false,
    can_vote: true,
    allowed_actions: [],
    ...extra,
  };
}

export function errorApi(status, message, code = "error", details = null) {
  const err = new Error(message);
  err.response = { status, data: { error: { code, message, details } } };
  return err;
}

export function servicioFalso(me = ME) {
  return {
    yo: vi.fn().mockResolvedValue(me),
    listar: vi.fn().mockResolvedValue(IDEAS),
    obtener: vi.fn().mockResolvedValue(detalle()),
    proponer: vi
      .fn()
      .mockImplementation(async ({ title, impact }) =>
        idea({ id: 99, title, impact, is_mine: true, vote_count: 0 }),
      ),
    actualizarAvance: vi.fn(),
    cambiarEtapa: vi.fn(),
    votar: vi.fn().mockResolvedValue({ vote_count: 4, voted_by_me: true }),
    quitarVoto: vi
      .fn()
      .mockResolvedValue({ vote_count: 4, voted_by_me: false }),
  };
}
