import { vi } from "vitest";

/*
 * Datos de prueba de Reuniones, con la forma exacta de las respuestas de
 * `/api/v1/reuniones/` (ver `apps.reuniones.serializers` y
 * `services.resumen_de_acceso`).
 */

export const ME = {
  user_id: 1,
  permissions: ["reuniones.acceder", "reuniones.crear"],
  can_create: true,
  can_manage: false,
  statuses: [
    { value: "PROGRAMADA", label: "Programada" },
    { value: "EN_CURSO", label: "En curso" },
    { value: "FINALIZADA", label: "Finalizada" },
  ],
  limits: {
    title: 255,
    description: 5000,
    summary: 20000,
    password: 50,
    url: 1000,
    duration_max: 1440,
    invitees_max: 200,
  },
};

export const ME_INVITADO = {
  ...ME,
  permissions: ["reuniones.acceder"],
  can_create: false,
};

export const ME_ADMIN = {
  ...ME,
  permissions: ["reuniones.acceder", "reuniones.administrar"],
  can_manage: true,
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
    ...extra,
  };
}

export const ANA = persona({
  id: 1,
  username: "ana",
  name: "Ana",
  full_name: "Ana Ruiz",
  role_label: "Jefa Nacional",
});
export const LUIS = persona();
export const MARTA = persona({
  id: 3,
  username: "marta",
  name: "Marta",
  full_name: "Marta Ríos",
  role_label: null,
});

export function reunion(extra = {}) {
  return {
    id: 10,
    title: "Revisión semanal",
    description: "Avance de los indicadores.\nPendientes.",
    host: ANA,
    meeting_date: "2026-11-20T15:00:00Z",
    duration: 45,
    ends_at: "2026-11-20T15:45:00Z",
    timing: "UPCOMING",
    join_url: "https://zoom.us/j/123",
    join_password: "clave-1",
    status: "PROGRAMADA",
    status_label: "Programada",
    otter_invited: false,
    otter_summary: null,
    otter_transcript_url: null,
    created_at: "2026-11-01T15:00:00Z",
    updated_at: "2026-11-01T15:00:00Z",
    invitees: [
      { id: 100, user: LUIS, attended: false },
      { id: 101, user: MARTA, attended: true },
    ],
    is_host: true,
    can_edit: true,
    ...extra,
  };
}

export const REUNIONES = [
  reunion(),
  reunion({
    id: 11,
    title: "Comité en curso",
    timing: "IN_PROGRESS",
    status: "EN_CURSO",
    status_label: "En curso",
    host: LUIS,
    is_host: false,
    can_edit: false,
  }),
  reunion({
    id: 12,
    title: "Cierre de octubre",
    timing: "PAST",
    status: "FINALIZADA",
    status_label: "Finalizada",
    meeting_date: "2026-10-30T15:00:00Z",
    ends_at: "2026-10-30T16:00:00Z",
  }),
];

export function errorApi(status, message, code = "error", details = null) {
  const err = new Error(message);
  err.response = { status, data: { error: { code, message, details } } };
  return err;
}

export function servicioFalso(me = ME) {
  return {
    yo: vi.fn().mockResolvedValue(me),
    invitables: vi.fn().mockResolvedValue([LUIS, MARTA]),
    listar: vi.fn().mockResolvedValue(REUNIONES),
    obtener: vi.fn().mockResolvedValue(reunion()),
    crear: vi
      .fn()
      .mockImplementation(async (datos) =>
        reunion({ id: 99, title: datos.title }),
      ),
    editar: vi.fn().mockImplementation(async (id, cambios) => ({
      ...reunion(),
      ...cambios,
      ...(cambios.status
        ? {
            status_label: {
              PROGRAMADA: "Programada",
              EN_CURSO: "En curso",
              FINALIZADA: "Finalizada",
            }[cambios.status],
          }
        : {}),
    })),
    eliminar: vi.fn().mockResolvedValue({}),
    marcarAsistencia: vi.fn().mockImplementation(async (id, marcas) => ({
      ...reunion(),
      invitees: reunion().invitees.map((i) => {
        const marca = marcas.find((m) => m.user_id === i.user.id);
        return marca ? { ...i, attended: marca.attended } : i;
      }),
    })),
  };
}
