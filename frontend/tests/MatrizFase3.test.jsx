import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Matriz de obligaciones, fase 3: la evidencia y el cierre del período —cargar,
 * ver, rechazar y eliminar PDF; enviar, validar y devolver; cambiar la fecha—
 * y la vista Documentos.
 *
 * Cobertura de AC-MTZ-026 a AC-MTZ-036.
 */

const svc = {
  misEmpresas: vi.fn(),
  periodo: vi.fn(),
  historial: vi.fn(),
  documentos: vi.fn(),
  cargarEvidencia: vi.fn(),
  archivo: vi.fn(),
  rechazarDocumento: vi.fn(),
  eliminarDocumento: vi.fn(),
  enviar: vi.fn(),
  validar: vi.fn(),
  devolver: vi.fn(),
  cambiarVencimiento: vi.fn(),
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

vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => "1",
}));

const { DocumentosMatriz } =
  await import("../src/pages/Matriz/DocumentosMatriz");
const { CargarEvidenciaModal, problemaDelArchivo } =
  await import("../src/pages/Matriz/CargarEvidenciaModal");
const { CambiarFechaModal } =
  await import("../src/pages/Matriz/CambiarFechaModal");

const ESTADO = {
  group: "en_progreso",
  group_label: "En progreso",
  label: "En preparación",
  stage: "en_preparacion",
  is_due_today: false,
  is_late: false,
  days_overdue: null,
  days_remaining: 13,
};

function fila(id, nombre, documentos_validos = 0) {
  return {
    id,
    codigo: `OBL-000${id}`,
    etiqueta: "Octubre 2026",
    obligacion: { id, nombre },
    area: "Contabilidad y Tributario",
    entidad: "Servicio de Rentas Internas (SRI)",
    responsable: { id: 7, nombre: "Ana Pérez" },
    prioridad: "alta",
    vence_en: "2026-10-28T22:00:00Z",
    etapa: "en_preparacion",
    avance: 25,
    cerrado: false,
    estado: ESTADO,
    documentos_validos,
  };
}

const DETALLE = {
  ...fila(1, "Declaración de IVA"),
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
  suplente: null,
  supervisor: null,
  aprobador: { id: 9, nombre: "Sara Ruiz", email: "sara@laar.com" },
  observaciones: "",
  recordatorios_suspendidos: false,
  acciones: ["edit", "upload", "submit"],
};

const VALIDO = {
  id: 11,
  nombre_original: "formulario-104.pdf",
  version: 2,
  tamano: 250_000,
  estado: "valido",
  created_at: "2026-10-10T15:00:00Z",
  subido_por: { id: 7, nombre: "Ana Pérez" },
  rechazado_por: null,
  motivo_rechazo: "",
};

const RECHAZADO = {
  ...VALIDO,
  id: 10,
  version: 1,
  estado: "rechazado",
  rechazado_por: { id: 9, nombre: "Sara Ruiz" },
  motivo_rechazo: "Falta la firma del contador.",
};

function Ruta() {
  const { pathname, search } = useLocation();
  return <p data-testid="ruta">{`${pathname}${search}`}</p>;
}

function pintar(elemento, ruta = "/admin/matriz/documentos") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              {elemento}
              <Ruta />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** El panel del período abierto: el primer diálogo de la pantalla. */
async function abrirPanel(acciones = DETALLE.acciones, extra = {}) {
  svc.periodo.mockResolvedValue({ ...DETALLE, acciones, ...extra });
  pintar(<DocumentosMatriz />, "/admin/matriz/documentos?periodo=1");
  const [panel] = await screen.findAllByRole("dialog");
  await within(panel).findByText("Formulario 104");
  return panel;
}

function pdf(nombre, bytes = 1000) {
  const archivo = new File(["%PDF-1.4"], nombre, { type: "application/pdf" });
  Object.defineProperty(archivo, "size", { value: bytes });
  return archivo;
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.misEmpresas.mockResolvedValue({
    empresas: [{ id: 1, zona_horaria: "America/Guayaquil" }],
  });
  svc.historial.mockResolvedValue([]);
  svc.documentos.mockResolvedValue([VALIDO, RECHAZADO]);
  svc.documentosResumen.mockResolvedValue({
    with_evidence: [fila(2, "Aportes al IESS", 3)],
    pending: [fila(1, "Declaración de IVA")],
  });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:visor");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  delete globalThis.URL.createObjectURL;
  delete globalThis.URL.revokeObjectURL;
});

describe("La vista Documentos (§15.7)", () => {
  it("separa los expedientes con evidencia de los pendientes", async () => {
    pintar(<DocumentosMatriz />);

    expect(await screen.findByText("Aportes al IESS")).toBeInTheDocument();
    expect(screen.getByText("3 documentos")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Pendientes de evidencia · 1/ }),
    ).toBeInTheDocument();
  });

  it("una fila abre el período en el panel lateral", async () => {
    svc.periodo.mockResolvedValue(DETALLE);
    pintar(<DocumentosMatriz />);

    fireEvent.click(await screen.findByText("Declaración de IVA"));

    expect(screen.getByTestId("ruta")).toHaveTextContent("periodo=1");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("Las acciones del período (§8.10)", () => {
  it("muestra solo los botones que el servidor permite", async () => {
    const panel = await abrirPanel(["submit"]);

    expect(
      within(panel).getByRole("button", { name: /Enviar a validación/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /Validar y finalizar/ }),
    ).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: /Cambiar fecha/ }),
    ).toBeNull();
  });

  it("enviar pide confirmación, llama al servidor y avisa", async () => {
    svc.enviar.mockResolvedValue({});
    const panel = await abrirPanel(["submit"]);

    fireEvent.click(
      within(panel).getByRole("button", { name: /Enviar a validación/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(svc.enviar).toHaveBeenCalledWith(1));
    expect(
      await within(panel).findByText("Enviado a validación."),
    ).toBeInTheDocument();
    expect(svc.periodo).toHaveBeenCalledTimes(2);
  });

  it("validar pide confirmación antes de cerrar", async () => {
    svc.validar.mockResolvedValue({});
    const panel = await abrirPanel(["validate", "return"]);

    fireEvent.click(
      within(panel).getByRole("button", { name: /Validar y finalizar/ }),
    );
    expect(svc.validar).not.toHaveBeenCalled();
    const dialogo = screen
      .getAllByRole("dialog")
      .find((d) => within(d).queryByText(/No se puede reabrir/));
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Validar y finalizar" }),
    );

    await waitFor(() => expect(svc.validar).toHaveBeenCalledWith(1));
  });

  it("devolver exige un motivo de al menos 10 caracteres", async () => {
    svc.devolver.mockResolvedValue({});
    const panel = await abrirPanel(["validate", "return"]);

    fireEvent.click(within(panel).getByRole("button", { name: /Devolver/ }));
    const motivo = await screen.findByLabelText("Qué hay que corregir");
    const modal = motivo.closest("[role=dialog]");
    const boton = within(modal).getByRole("button", { name: "Devolver" });

    fireEvent.change(motivo, { target: { value: "corto" } });
    expect(boton).toBeDisabled();

    fireEvent.change(motivo, {
      target: { value: "Falta el anexo de retenciones." },
    });
    fireEvent.click(boton);

    await waitFor(() =>
      expect(svc.devolver).toHaveBeenCalledWith(
        1,
        "Falta el anexo de retenciones.",
      ),
    );
  });

  it("el error del servidor se muestra en el panel", async () => {
    svc.enviar.mockRejectedValue({
      response: {
        data: { detail: "El período no tiene evidencia válida." },
      },
    });
    const panel = await abrirPanel(["submit"]);

    fireEvent.click(
      within(panel).getByRole("button", { name: /Enviar a validación/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));

    expect(
      await within(panel).findByText("El período no tiene evidencia válida."),
    ).toBeInTheDocument();
  });
});

describe("Los documentos del período (§15.4)", () => {
  it("lista los válidos y los rechazados con su motivo", async () => {
    const panel = await abrirPanel();

    fireEvent.click(within(panel).getByRole("tab", { name: "Documentos" }));

    expect(await within(panel).findByText("Válidos")).toBeInTheDocument();
    expect(
      within(panel).getByText(/Falta la firma del contador\./),
    ).toBeInTheDocument();
    expect(svc.documentos).toHaveBeenCalledWith(1);
  });

  it("sin permiso de rechazar, no ofrece el botón", async () => {
    const panel = await abrirPanel(["upload"]);
    fireEvent.click(within(panel).getByRole("tab", { name: "Documentos" }));

    await within(panel).findByText("Válidos");
    expect(
      within(panel).queryByRole("button", {
        name: "Rechazar formulario-104.pdf",
      }),
    ).toBeNull();
  });

  it("rechazar una evidencia pide el motivo y la manda", async () => {
    svc.rechazarDocumento.mockResolvedValue({});
    const panel = await abrirPanel(["validate", "reject_document"]);
    fireEvent.click(within(panel).getByRole("tab", { name: "Documentos" }));

    fireEvent.click(
      await within(panel).findByRole("button", {
        name: "Rechazar formulario-104.pdf",
      }),
    );
    fireEvent.change(await screen.findByLabelText("Motivo del rechazo"), {
      target: { value: "El formulario no corresponde al mes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() =>
      expect(svc.rechazarDocumento).toHaveBeenCalledWith(
        11,
        "El formulario no corresponde al mes.",
      ),
    );
  });

  it("eliminar un rechazado pide confirmación", async () => {
    svc.eliminarDocumento.mockResolvedValue({});
    const panel = await abrirPanel();
    fireEvent.click(within(panel).getByRole("tab", { name: "Documentos" }));

    fireEvent.click(
      await within(panel).findByRole("button", {
        name: "Eliminar formulario-104.pdf",
      }),
    );
    expect(svc.eliminarDocumento).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(svc.eliminarDocumento).toHaveBeenCalledWith(10));
  });

  it("el visor muestra el PDF pedido con la sesión", async () => {
    svc.archivo.mockResolvedValue(new Blob(["%PDF-1.4"]));
    const panel = await abrirPanel();
    fireEvent.click(within(panel).getByRole("tab", { name: "Documentos" }));

    fireEvent.click(
      await within(panel).findByRole("button", {
        name: "Ver formulario-104.pdf",
      }),
    );

    const visor = await screen.findByTitle("formulario-104.pdf");
    expect(visor).toHaveAttribute("src", "blob:visor");
    expect(svc.archivo).toHaveBeenCalledWith(11);
  });
});

describe("Cargar evidencia (§15.5)", () => {
  it("la validación previa rechaza lo que no es PDF y lo que pesa demasiado", () => {
    expect(problemaDelArchivo(pdf("acta.pdf"))).toBeNull();
    expect(problemaDelArchivo(pdf("acta.docx"))).toMatch(/Solo se aceptan/);
    expect(problemaDelArchivo(pdf("grande.pdf", 11 * 1024 * 1024))).toMatch(
      /10 MB/,
    );
  });

  it("sube los válidos uno a uno y muestra el error del que falla", async () => {
    svc.cargarEvidencia.mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce({
      response: { data: { detail: "El archivo no es un PDF válido." } },
    });
    const onCargado = vi.fn();
    render(
      <CargarEvidenciaModal
        periodo={DETALLE}
        onCerrar={() => {}}
        onCargado={onCargado}
      />,
    );

    fireEvent.change(screen.getByLabelText("Archivos PDF de evidencia"), {
      target: {
        files: [pdf("bueno.pdf"), pdf("falso.pdf"), pdf("notas.txt")],
      },
    });
    expect(
      screen.getByText(/Solo se aceptan archivos PDF/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cargar 2 archivos" }));

    expect(
      await screen.findByText("El archivo no es un PDF válido."),
    ).toBeInTheDocument();
    expect(svc.cargarEvidencia).toHaveBeenCalledTimes(2);
    expect(svc.cargarEvidencia.mock.calls[0][1].name).toBe("bueno.pdf");
    expect(onCargado).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Listo" })).toBeInTheDocument();
  });
});

describe("Cambiar la fecha de vencimiento (§15.5)", () => {
  it("exige justificación y manda fecha, hora y motivo", async () => {
    svc.cambiarVencimiento.mockResolvedValue(DETALLE);
    const onGuardado = vi.fn();
    render(
      <CambiarFechaModal
        periodo={DETALLE}
        onCerrar={() => {}}
        onGuardado={onGuardado}
      />,
    );

    expect(screen.getByText(/no puede eliminarse/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nueva fecha"), {
      target: { value: "2026-11-05" },
    });
    const boton = screen.getByRole("button", { name: "Cambiar fecha" });
    expect(boton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Justificación"), {
      target: { value: "Prórroga publicada por el SRI." },
    });
    fireEvent.click(boton);

    await waitFor(() =>
      expect(svc.cambiarVencimiento).toHaveBeenCalledWith(1, {
        due_date: "2026-11-05",
        due_time: "17:00",
        reason: "Prórroga publicada por el SRI.",
      }),
    );
    expect(onGuardado).toHaveBeenCalled();
  });
});
