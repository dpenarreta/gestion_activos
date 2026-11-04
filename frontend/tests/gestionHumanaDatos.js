/*
 * Datos de prueba de Gestión Humana (Control Operativo de Novedades), con la
 * forma exacta del backend (`apps/novedades`, snake_case).
 */
import { vi } from "vitest";

export const REGLAS = {
  today: "2026-11-04",
  can_bypass_deadline: false,
  mode: "Horas laborables desde el fin del día de trabajo.",
  worked_days: {
    can_bypass: false,
    hours: 48,
    earliest_open_date: "2026-11-02",
  },
  overtime: { can_bypass: false, hours: 48, earliest_open_date: "2026-11-02" },
};

const BASE_ME = {
  role: null,
  permissions: ["novedades.acceder"],
  is_supervisor: false,
  is_assistant: false,
  national_read: false,
  national_write: false,
  can_view_history: false,
  can_bypass_deadline: false,
  is_jefe: false,
  can_depurate: false,
  can_view_depuration: false,
  is_admin: false,
  can_see_cedula: false,
  current_period: { code: "2026-11", label: "Noviembre 2026", status: "OPEN" },
  current_month: { code: "2026-11", label: "Noviembre 2026" },
  deadline_rules: REGLAS,
  user: { id: 7, name: "Sofía Supervisora" },
};

export const SUPERVISOR = {
  ...BASE_ME,
  role: "SUPERVISOR_OPERACIONES",
  permissions: [
    "novedades.acceder",
    "novedades.colaboradores_gestionar",
    "novedades.registrar",
    "novedades.historial_ver",
    "novedades.cerrar_periodo",
    "novedades.importar",
    "novedades.exportar",
  ],
  is_supervisor: true,
  can_see_cedula: true,
};

export const ASISTENTE = {
  ...BASE_ME,
  role: "ASISTENTE_OPERACIONES",
  permissions: [
    "novedades.acceder",
    "novedades.consolidado_ver",
    "novedades.historial_ver",
    "novedades.exportar",
    "novedades.registrar",
  ],
  is_assistant: true,
  national_read: true,
  can_view_history: true,
  can_bypass_deadline: true,
  user: { id: 8, name: "Andrés Asistente" },
};

export const JEFE = {
  ...BASE_ME,
  role: "JEFE_OPERACIONES",
  permissions: [
    "novedades.acceder",
    "novedades.consolidado_ver",
    "novedades.depurar",
  ],
  is_jefe: true,
  national_read: true,
  can_depurate: true,
  can_view_depuration: true,
  user: { id: 9, name: "Julia Jefa" },
};

export const ADMINISTRADOR = {
  ...BASE_ME,
  permissions: [
    "novedades.acceder",
    "novedades.colaboradores_gestionar",
    "novedades.registrar",
    "novedades.consolidado_ver",
    "novedades.historial_ver",
    "novedades.importar",
    "novedades.exportar",
    "novedades.cerrar_periodo",
    "novedades.corregir_cerrado",
    "novedades.administrar",
    "novedades.permisos_gestionar",
    "novedades.depurar",
    "novedades.dias_editar",
  ],
  national_read: true,
  national_write: true,
  can_view_history: true,
  can_bypass_deadline: true,
  can_view_depuration: true,
  is_admin: true,
  can_see_cedula: true,
  user: { id: 1, name: "Ada Administradora" },
};

export const PERIODOS = [
  {
    code: "2026-11",
    label: "Noviembre 2026",
    start_date: "2026-10-23",
    end_date: "2026-11-22",
    status: "OPEN",
  },
];

export const MESES = [
  {
    code: "2026-11",
    label: "Noviembre 2026",
    start_date: "2026-11-01",
    end_date: "2026-11-30",
    status: "OPEN",
    grace_hours: 48,
    deadline: "2026-12-03T05:00:00Z",
    deadline_label: "miércoles 02/12/2026 23:59",
    remaining_seconds: 0,
    closing_soon: false,
    refresh_in_seconds: 0,
    closed_at: null,
    closed_by: "",
  },
];

export const COLABORADOR = {
  id: 10,
  cedula: "••••••0405",
  full_name: "Ana Pérez",
  codigo_empleado: "",
  empleado_id: null,
  regional: "Sierra",
  area: "Operaciones",
  cargo: "Courier",
  status: "ACTIVE",
  status_label: "Activo",
  supervisor_id: 7,
  supervisor_name: "Sofía Supervisora",
  created_at: "2026-10-01T15:00:00Z",
  updated_at: "2026-10-01T15:00:00Z",
  worked_days_removed_at: null,
  worked_days_removed_by: "",
  worked_days_removed_reason: "",
};

export function matriz(cambios = {}) {
  return {
    period: {
      code: "2026-11",
      label: "Noviembre 2026",
      start_date: "2026-10-23",
      end_date: "2026-11-22",
      status: "OPEN",
      closed_at: null,
      closed_by: "",
    },
    supervisor: { id: 7, name: "Sofía Supervisora" },
    editable: true,
    closable: true,
    columns: [
      {
        date: "2026-11-01",
        day: 1,
        weekday: "Domingo",
        is_weekend: true,
        holiday: "",
        deadline_state: "",
        deadline_label: "",
      },
      {
        date: "2026-11-02",
        day: 2,
        weekday: "Lunes",
        is_weekend: false,
        holiday: "",
        deadline_state: "",
        deadline_label: "miércoles 04/11/2026 23:59",
      },
      {
        date: "2026-11-03",
        day: 3,
        weekday: "Martes",
        is_weekend: false,
        holiday: "",
        deadline_state: "",
        deadline_label: "jueves 05/11/2026 23:59",
      },
      {
        date: "2026-10-30",
        day: 30,
        weekday: "Viernes",
        is_weekend: false,
        holiday: "",
        deadline_state: "late",
        deadline_label: "martes 03/11/2026 23:59",
      },
      {
        date: "2026-10-29",
        day: 29,
        weekday: "Jueves",
        is_weekend: false,
        holiday: "",
        deadline_state: "expired",
        deadline_label: "lunes 02/11/2026 23:59",
      },
    ],
    rows: [
      {
        collaborator_id: 10,
        cedula: "••••••0405",
        full_name: "Ana Pérez",
        cargo: "Courier",
        area: "Operaciones",
        regional: "Sierra",
        status: "ACTIVE",
        is_current_member: true,
        cells: { "2026-11-02": { hours: "8", version: 1 } },
        total_hours: "8",
      },
    ],
    ...cambios,
  };
}

/** Un error de la API con el contrato uniforme del backend. */
export function errorApi(status, message, code = "invalid", details = null) {
  return { response: { status, data: { error: { code, message, details } } } };
}

/** El servicio entero, con respuestas vacías por defecto. */
export function servicioFalso() {
  return {
    yo: vi.fn(),
    supervisores: vi.fn(() => Promise.resolve([])),
    periodos: vi.fn(() => Promise.resolve(PERIODOS)),
    estadoDePeriodos: vi.fn(() => Promise.resolve([])),
    mesesDeHorasExtras: vi.fn(() => Promise.resolve(MESES)),
    matriz: vi.fn(),
    guardarCeldas: vi.fn(),
    resumenDeCierre: vi.fn(),
    cerrarPeriodo: vi.fn(),
    exportarDias: vi.fn(() => Promise.resolve()),
    plantillaDias: vi.fn(() => Promise.resolve()),
    corregirDia: vi.fn(),
    horasExtras: vi.fn(() =>
      Promise.resolve({
        indicators: {
          records: 0,
          overtime_hours: "0",
          saturday_hours: "0",
          supervisors_reporting: 0,
          collaborators_with_records: 0,
        },
        count: 0,
        offset: 0,
        limit: 200,
        records: [],
      }),
    ),
    crearHorasExtras: vi.fn(),
    editarHorasExtras: vi.fn(),
    eliminarHorasExtras: vi.fn(),
    guardarLoteHorasExtras: vi.fn(),
    revisionAntesDeCerrarMes: vi.fn(),
    cerrarMes: vi.fn(),
    exportarHorasExtras: vi.fn(() => Promise.resolve()),
    plantillaHorasExtras: vi.fn(() => Promise.resolve()),
    corregirHorasExtras: vi.fn(),
    colaboradores: vi.fn(() => Promise.resolve([])),
    crearColaborador: vi.fn(),
    editarColaborador: vi.fn(),
    eliminarColaborador: vi.fn(),
    cambiarEstado: vi.fn(),
    retirarDeDias: vi.fn(),
    restaurarEnDias: vi.fn(),
    corregirCedula: vi.fn(),
    reasignar: vi.fn(),
    historialDeColaborador: vi.fn(),
    plantillaColaboradores: vi.fn(() => Promise.resolve()),
    vistaPrevia: vi.fn(),
    confirmarImportacion: vi.fn(),
    cancelarImportacion: vi.fn(() => Promise.resolve()),
    erroresDeImportacion: vi.fn(() => Promise.resolve()),
    historial: vi.fn(() => Promise.resolve({ count: 0, results: [] })),
    repositorio: vi.fn(() => Promise.resolve([])),
    depuracion: vi.fn(),
    crearDepuracion: vi.fn(),
    filasDepuradas: vi.fn(() => Promise.resolve([])),
    guardarDepuradas: vi.fn(),
    historialDepuracion: vi.fn(() => Promise.resolve([])),
    exportarDepuradas: vi.fn(() => Promise.resolve()),
    accesoMovimientos: vi.fn(),
    opcionesMovimientos: vi.fn(() =>
      Promise.resolve({ supervisors: [], cargos: [], statuses: [] }),
    ),
    movimientos: vi.fn(),
    exportarMovimientos: vi.fn(() => Promise.resolve()),
    plazos: vi.fn(),
    guardarPlazos: vi.fn(),
    plazoDeMes: vi.fn(),
    guardarPlazoDeMes: vi.fn(),
    permisosPorRol: vi.fn(),
    cambiarPermisoDeRol: vi.fn(),
    usuariosOperativos: vi.fn(() => Promise.resolve([])),
    permisosEfectivos: vi.fn(),
    excepciones: vi.fn(() => Promise.resolve([])),
    crearExcepcion: vi.fn(),
    revocarExcepcion: vi.fn(),
    destinatarios: vi.fn(),
    crearDestinatario: vi.fn(),
    editarDestinatario: vi.fn(),
    correosEnviados: vi.fn(() => Promise.resolve([])),
    reintentarCorreo: vi.fn(),
    permisosDeMovimientos: vi.fn(() => Promise.resolve([])),
    cambiarPermisoDeMovimientos: vi.fn(),
  };
}
