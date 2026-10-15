import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Matriz de obligaciones, fase 4: los recordatorios —la pestaña del período,
 * la vista previa del correo, el reenvío, los reintentos— y su configuración
 * por empresa.
 *
 * Cobertura de AC-MTZ-037 a AC-MTZ-046 (lo que se ve en pantalla).
 */

const svc = {
  misEmpresas: vi.fn(),
  periodo: vi.fn(),
  historial: vi.fn(),
  documentos: vi.fn(),
  recordatorios: vi.fn(),
  enviarRecordatorio: vi.fn(),
  vistaPrevia: vi.fn(),
  configuracionRecordatorios: vi.fn(),
  guardarConfiguracionRecordatorios: vi.fn(),
  notificaciones: vi.fn(),
  reintentarNotificacion: vi.fn(),
  documentosResumen: vi.fn(),
};

vi.mock("../src/api/matrizService", () => ({
  matrizService: new Proxy(
    {},
    {
      get:
        (_, nombre) =>
        (...a) =>
          svc[nombre](...a),
    },
  ),
  catalogoMatrizService: () => ({}),
}));

vi.mock("../src/api/client", async (original) => ({
  ...(await original()),
  getEmpresaActiva: () => "1",
}));

const { DocumentosMatriz } =
  await import("../src/pages/Matriz/DocumentosMatriz");
const { ConfiguracionRecordatoriosPage } =
  await import("../src/pages/Matriz/ConfiguracionRecordatoriosPage");
const { textoDeAnticipacion } =
  await import("../src/pages/Matriz/avisosMatriz");

const DETALLE = {
  id: 1,
  codigo: "OBL-0001",
  etiqueta: "Octubre 2026",
  area: "Contabilidad y Tributario",
  entidad: "Servicio de Rentas Internas (SRI)",
  responsable: { id: 7, nombre: "Ana Pérez", email: "ana@laar.com" },
  prioridad: "alta",
  vence_en: "2026-10-28T22:00:00Z",
  etapa: "en_preparacion",
  avance: 25,
  cerrado: false,
  estado: {
    group: "en_progreso",
    group_label: "En progreso",
    label: "En preparación",
    stage: "en_preparacion",
    days_remaining: 13,
  },
  obligacion: {
    id: 1,
    nombre: "Declaración de IVA",
    tipo: "regulatoria",
    periodicidad: "mensual",
    area_nombre: "Contabilidad y Tributario",
    entidad_nombre: "Servicio de Rentas Internas (SRI)",
    evidencia_esperada: "Formulario 104",
    descripcion: "",
    fundamento_legal: "",
    fundamento_url: "",
  },
  empresa: { id: 1, nombre: "LaarCourier", zona_horaria: "America/Guayaquil" },
  sede: null,
  fecha_inicio: "2026-09-28",
  fecha_preparacion: "2026-10-23",
  suplente: { id: 8, nombre: "Beto Ruiz", email: "beto@laar.com" },
  supervisor: null,
  aprobador: null,
  observaciones: "",
  recordatorios_suspendidos: false,
  acciones: ["send_reminder"],
};

const FALLIDA = {
  id: 31,
  periodo: {
    id: 1,
    codigo: "OBL-0001",
    etiqueta: "Octubre 2026",
    obligacion: "Declaración de IVA",
  },
  tipo: "recordatorio",
  tipo_nombre: "Recordatorio",
  anticipacion: 15,
  destinatario: { id: 7, nombre: "Ana Pérez", email: "ana@laar.com" },
  correo: "ana@laar.com",
  programada_para: "2026-10-13",
  estado: "fallido",
  intentos: 1,
  ultimo_error: "SMTP no responde",
  enviado_en: null,
  created_at: "2026-10-13T13:00:00Z",
  reintento_de: null,
  disparado_por: "Sistema",
};

const RECORDATORIOS = {
  suspended: false,
  can_send: true,
  schedule: [
    {
      offset_days: 15,
      kind: "recordatorio",
      date: "2026-10-13",
      time: "08:00",
      status: "fallido",
    },
    {
      offset_days: 7,
      kind: "recordatorio",
      date: "2026-10-21",
      time: "08:00",
      status: "programado",
    },
    {
      offset_days: 0,
      kind: "vencimiento",
      date: "2026-10-28",
      time: "08:00",
      status: "programado",
    },
  ],
  notifications: [FALLIDA],
};

const CONFIG = {
  offsets: [15, 7, 3, 1, 0],
  send_time: "08:00",
  copy_backup: true,
  escalation_enabled: true,
  escalation_days: 2,
  escalation_repeat_days: 0,
  can_edit: true,
};

function empresa(capacidades) {
  return {
    id: 1,
    nombre: "LaarCourier",
    zona_horaria: "America/Guayaquil",
    roles: ["Matriz · Administrador"],
    capacidades,
  };
}

function pintar(elemento, ruta = "/admin/matriz/documentos?periodo=1") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="*" element={elemento} />
      </Routes>
    </MemoryRouter>,
  );
}

async function abrirRecordatorios(extra = {}) {
  svc.periodo.mockResolvedValue({ ...DETALLE, ...extra });
  pintar(<DocumentosMatriz />);
  const [panel] = await screen.findAllByRole("dialog");
  fireEvent.click(
    await within(panel).findByRole("tab", { name: "Recordatorios" }),
  );
  await within(panel).findByText("Programación");
  return panel;
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.misEmpresas.mockResolvedValue({
    empresas: [
      empresa(["matriz.configurar", "matriz.ver_auditoria", "matriz.recordar"]),
    ],
  });
  svc.historial.mockResolvedValue([]);
  svc.documentosResumen.mockResolvedValue({ with_evidence: [], pending: [] });
  svc.recordatorios.mockResolvedValue(RECORDATORIOS);
  svc.configuracionRecordatorios.mockResolvedValue(CONFIG);
  svc.notificaciones.mockResolvedValue({
    count: 1,
    next: null,
    previous: null,
    results: [FALLIDA],
  });
  svc.vistaPrevia.mockImplementation((_, kind) =>
    Promise.resolve({
      to:
        kind === "escalamiento"
          ? ["sara@laar.com"]
          : ["ana@laar.com", "beto@laar.com"],
      subject:
        kind === "escalamiento"
          ? "Escalamiento: obligación vencida — Declaración de IVA (Octubre 2026)"
          : "Recordatorio de vencimiento — Declaración de IVA (Octubre 2026)",
      text: "",
      html: "<p>Estimado(a) Ana Pérez</p>",
    }),
  );
});

describe("La pestaña Recordatorios del período (§15.4)", () => {
  it("muestra la programación con su estado y el historial de avisos", async () => {
    const panel = await abrirRecordatorios();

    expect(within(panel).getByText("15 días antes")).toBeInTheDocument();
    expect(within(panel).getByText("Día del vencimiento")).toBeInTheDocument();
    expect(within(panel).getAllByText("Programado")).toHaveLength(2);
    expect(within(panel).getByText("SMTP no responde")).toBeInTheDocument();
    expect(svc.recordatorios).toHaveBeenCalledWith(1);
  });

  it("reintentar un aviso fallido llama al servidor y recarga", async () => {
    svc.reintentarNotificacion.mockResolvedValue({});
    const panel = await abrirRecordatorios();

    fireEvent.click(within(panel).getByRole("button", { name: /Reintentar/ }));

    await waitFor(() =>
      expect(svc.reintentarNotificacion).toHaveBeenCalledWith(31),
    );
    await waitFor(() => expect(svc.recordatorios).toHaveBeenCalledTimes(2));
  });

  it("sin permiso de recordar no ofrece reenviar ni reintentar", async () => {
    svc.recordatorios.mockResolvedValue({ ...RECORDATORIOS, can_send: false });
    const panel = await abrirRecordatorios({ acciones: [] });

    expect(
      within(panel).queryByRole("button", { name: /Reintentar/ }),
    ).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: /Reenviar recordatorio/ }),
    ).toBeNull();
  });

  it("un período cerrado dice que sus recordatorios están suspendidos", async () => {
    svc.recordatorios.mockResolvedValue({
      ...RECORDATORIOS,
      suspended: true,
      can_send: false,
    });
    const panel = await abrirRecordatorios({ cerrado: true, acciones: [] });

    expect(
      within(panel).getByText(
        "Los recordatorios de este período están suspendidos.",
      ),
    ).toBeInTheDocument();
  });

  it("reenviar pide confirmación, envía y avisa", async () => {
    svc.enviarRecordatorio.mockResolvedValue([]);
    const panel = await abrirRecordatorios();

    const [boton] = within(panel).getAllByRole("button", {
      name: /Reenviar recordatorio/,
    });
    fireEvent.click(boton);
    expect(svc.enviarRecordatorio).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(svc.enviarRecordatorio).toHaveBeenCalledWith(1));
    expect(
      await within(panel).findByText("Recordatorio enviado."),
    ).toBeInTheDocument();
  });

  it("la vista previa muestra para, asunto y el cuerpo aislado", async () => {
    const panel = await abrirRecordatorios();

    fireEvent.click(
      within(panel).getByRole("button", { name: /Vista previa del correo/ }),
    );
    expect(
      await screen.findByText(
        "Recordatorio de vencimiento — Declaración de IVA (Octubre 2026)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("ana@laar.com, beto@laar.com")).toBeInTheDocument();
    expect(screen.getByTitle("Cuerpo del correo")).toHaveAttribute(
      "sandbox",
      "",
    );

    fireEvent.click(screen.getByRole("button", { name: "Escalamiento" }));
    expect(await screen.findByText("sara@laar.com")).toBeInTheDocument();
    expect(svc.vistaPrevia).toHaveBeenLastCalledWith(1, "escalamiento");
  });
});

describe("Configuración → Recordatorios (§15.9)", () => {
  it("guarda las anticipaciones, la hora y el escalamiento", async () => {
    svc.guardarConfiguracionRecordatorios.mockImplementation((datos) =>
      Promise.resolve({ ...CONFIG, ...datos }),
    );
    pintar(
      <ConfiguracionRecordatoriosPage />,
      "/admin/configuracion/recordatorios",
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Quitar 15 días antes" }),
    );
    expect(
      screen.queryByRole("button", { name: "Quitar Día del vencimiento" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Días antes del vencimiento"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Agregar/ }));
    fireEvent.change(screen.getByLabelText("Hora de envío"), {
      target: { value: "07:30" },
    });
    fireEvent.change(screen.getByLabelText("Repetir cada (días)"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(svc.guardarConfiguracionRecordatorios).toHaveBeenCalledWith({
        offsets: [10, 7, 3, 1, 0],
        send_time: "07:30",
        copy_backup: true,
        escalation_enabled: true,
        escalation_days: 2,
        escalation_repeat_days: 3,
      }),
    );
    expect(
      await screen.findByText("Configuración guardada."),
    ).toBeInTheDocument();
  });

  it("una anticipación fuera de rango no se agrega", async () => {
    pintar(
      <ConfiguracionRecordatoriosPage />,
      "/admin/configuracion/recordatorios",
    );

    fireEvent.change(
      await screen.findByLabelText("Días antes del vencimiento"),
      {
        target: { value: "95" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /Agregar/ }));

    expect(screen.getByText("Entre 1 y 90 días.")).toBeInTheDocument();
  });

  it("sin «configurar» se consulta pero no se cambia", async () => {
    svc.configuracionRecordatorios.mockResolvedValue({
      ...CONFIG,
      can_edit: false,
    });
    pintar(
      <ConfiguracionRecordatoriosPage />,
      "/admin/configuracion/recordatorios",
    );

    expect(
      await screen.findByText(/cambiarla exige el permiso/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Hora de envío")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  it("el historial de la empresa filtra por estado y reintenta", async () => {
    svc.reintentarNotificacion.mockResolvedValue({});
    pintar(
      <ConfiguracionRecordatoriosPage />,
      "/admin/configuracion/recordatorios",
    );

    fireEvent.click(await screen.findByRole("button", { name: "Fallidas" }));
    await waitFor(() =>
      expect(svc.notificaciones).toHaveBeenLastCalledWith({
        page: 1,
        status: "fallido",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Reintentar/ }));
    await waitFor(() =>
      expect(svc.reintentarNotificacion).toHaveBeenCalledWith(31),
    );
  });

  it("sin «ver_auditoria» no pide el historial", async () => {
    svc.misEmpresas.mockResolvedValue({
      empresas: [empresa(["matriz.crear"])],
    });
    pintar(
      <ConfiguracionRecordatoriosPage />,
      "/admin/configuracion/recordatorios",
    );

    expect(
      await screen.findByText(/El historial de la empresa lo ven/),
    ).toBeInTheDocument();
    expect(svc.notificaciones).not.toHaveBeenCalled();
  });
});

describe("El enlace de los correos", () => {
  it("cambia a la empresa del aviso y se quita de la dirección", async () => {
    const { tomarEmpresaDeLaDireccion } =
      await vi.importActual("../src/api/client");
    window.history.pushState(
      {},
      "",
      "/admin/matriz/obligaciones?periodo=3&empresa=2",
    );

    tomarEmpresaDeLaDireccion();

    expect(localStorage.getItem("gestion_activos_empresa")).toBe("2");
    expect(window.location.search).toBe("?periodo=3");
  });

  it("los nombres de las anticipaciones", () => {
    expect(textoDeAnticipacion(0)).toBe("Día del vencimiento");
    expect(textoDeAnticipacion(1)).toBe("1 día antes");
    expect(textoDeAnticipacion(15)).toBe("15 días antes");
  });
});
