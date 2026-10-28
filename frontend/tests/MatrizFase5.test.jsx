import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Matriz de obligaciones, fase 5: calendario, reportes, exportaciones,
 * auditoría de la empresa y las áreas de la Matriz en la ficha del usuario.
 *
 * Cobertura de AC-MTZ-047 a AC-MTZ-056 (lo que se ve en pantalla).
 */

const svc = {
  misEmpresas: vi.fn(),
  calendario: vi.fn(),
  reportes: vi.fn(),
  exportar: vi.fn(),
  auditoria: vi.fn(),
  personas: vi.fn(),
  periodo: vi.fn(),
  historial: vi.fn(),
};
const listarAreas = vi.fn();

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
  catalogoMatrizService: () => ({ list: (...a) => listarAreas(...a) }),
}));

vi.mock("../src/api/client", async (original) => ({
  ...(await original()),
  getEmpresaActiva: () => "1",
}));

const listarEmpresas = vi.fn();
const obtenerUsuario = vi.fn();
const assignEmpresas = vi.fn(() => Promise.resolve({}));
vi.mock("../src/api/empresasService", () => ({
  empresasService: { list: (...a) => listarEmpresas(...a) },
}));
vi.mock("../src/api/rolesService", () => ({
  rolesService: {
    list: () =>
      Promise.resolve([{ id: 20, name: "Responsable de cumplimiento" }]),
  },
}));
vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    get: (...a) => obtenerUsuario(...a),
    assignEmpresas: (...a) => assignEmpresas(...a),
    assignRoles: () => Promise.resolve({}),
  },
}));
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codigo) =>
    ["empresas.ver", "empresas.asignar"].includes(codigo),
}));

const { CalendarioMatriz, semanasDelMes } =
  await import("../src/pages/Matriz/CalendarioMatriz");
const { ReportesMatriz } = await import("../src/pages/Matriz/ReportesMatriz");
const { AuditoriaMatriz } = await import("../src/pages/Matriz/AuditoriaMatriz");
const { AsignacionEmpresas } =
  await import("../src/pages/Admin/Empresas/AsignacionEmpresas");

const ZONA = "America/Guayaquil";

function empresa(capacidades = []) {
  return {
    id: 1,
    nombre: "LaarCourier",
    zona_horaria: ZONA,
    roles: [],
    capacidades,
  };
}

function periodo(id, nombre, venceEn, grupo = "en_progreso") {
  return {
    id,
    codigo: `OBL-000${id}`,
    etiqueta: "Octubre 2026",
    obligacion: { id, nombre },
    vence_en: venceEn,
    estado: { group: grupo, label: "En preparación" },
  };
}

function Ruta() {
  const { search } = useLocation();
  return <p data-testid="ruta">{search}</p>;
}

function pintar(elemento, ruta = "/") {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  svc.misEmpresas.mockResolvedValue({
    empresas: [empresa(["matriz.exportar", "matriz.ver_auditoria"])],
  });
  svc.periodo.mockReturnValue(new Promise(() => {}));
  svc.historial.mockResolvedValue([]);
});

describe("El calendario (§15.6)", () => {
  it("arma las semanas de domingo a sábado", () => {
    const dias = semanasDelMes(2026, 10);
    expect(dias[0].iso).toBe("2026-09-27");
    expect(dias.at(-1).iso).toBe("2026-10-31");
    expect(dias).toHaveLength(35);
    expect(dias[0].delMes).toBe(false);
  });

  it("pone cada vencimiento en su día, con «+N más» y el panel al hacer clic", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-15T15:00:00Z"),
    });
    // 28 de octubre a las 17:00 en Guayaquil es el 28 a las 22:00 en UTC.
    svc.calendario.mockResolvedValue({
      periods: [
        periodo(1, "IVA", "2026-10-28T22:00:00Z", "incumplido"),
        periodo(2, "IESS", "2026-10-28T22:00:00Z"),
        periodo(3, "Retenciones", "2026-10-28T22:00:00Z"),
        periodo(4, "Patente", "2026-10-28T22:00:00Z", "finalizado"),
      ],
    });
    pintar(<CalendarioMatriz />);

    expect(await screen.findByText("Octubre 2026")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "IVA" })).toHaveClass(
      "mz-cal-chip--bad",
    );
    expect(screen.queryByRole("button", { name: "Patente" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+1 más" }));
    expect(screen.getByRole("button", { name: "Patente" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "IESS" }));
    expect(screen.getByTestId("ruta")).toHaveTextContent("periodo=2");
    expect(svc.calendario).toHaveBeenCalledWith(2026, 10);
  });

  it("navega entre meses y vuelve a hoy", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-12-15T15:00:00Z"),
    });
    svc.calendario.mockResolvedValue({ periods: [] });
    pintar(<CalendarioMatriz />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Mes siguiente" }),
    );
    await waitFor(() =>
      expect(svc.calendario).toHaveBeenLastCalledWith(2027, 1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    await waitFor(() =>
      expect(svc.calendario).toHaveBeenLastCalledWith(2026, 12),
    );
  });
});

const REPORTE = {
  kpis: {
    on_time_pct: 75,
    late_pct: 25,
    overdue: 2,
    in_progress: 5,
    closed: 4,
    closed_on_time: 3,
    closed_late: 1,
    total: 11,
  },
  by_area: [
    {
      name: "Contabilidad",
      finalizado: 3,
      en_progreso: 1,
      incumplido: 1,
      total: 5,
    },
  ],
  by_entity: [],
};

describe("Reportes (§15.8)", () => {
  it("muestra los indicadores y las barras, y filtra por rango", async () => {
    svc.reportes.mockResolvedValue(REPORTE);
    pintar(<ReportesMatriz />);

    expect(await screen.findByText("75 %")).toBeInTheDocument();
    expect(screen.getByText("3 de 4 cerradas")).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "Contabilidad: 3 finalizados, 1 en progreso, 1 incumplidos",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-01-01" },
    });
    await waitFor(() =>
      expect(svc.reportes).toHaveBeenLastCalledWith({ due_from: "2026-01-01" }),
    );
  });

  it("exporta con los mismos filtros", async () => {
    svc.reportes.mockResolvedValue(REPORTE);
    svc.exportar.mockResolvedValue(new Blob(["x"]));
    globalThis.URL.createObjectURL = vi.fn(() => "blob:archivo");
    globalThis.URL.revokeObjectURL = vi.fn();
    // jsdom no navega: el clic del enlace de descarga solo se registra.
    const clic = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    pintar(<ReportesMatriz />);

    fireEvent.change(await screen.findByLabelText("Hasta"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Excel/ }));

    await waitFor(() =>
      expect(svc.exportar).toHaveBeenCalledWith(
        "reportes",
        { due_to: "2026-12-31" },
        "xlsx",
      ),
    );
    await waitFor(() => expect(clic).toHaveBeenCalled());
    clic.mockRestore();
  });

  it("sin «exportar» no ofrece los archivos", async () => {
    svc.misEmpresas.mockResolvedValue({ empresas: [empresa([])] });
    svc.reportes.mockResolvedValue(REPORTE);
    pintar(<ReportesMatriz />);

    await screen.findByText("75 %");
    expect(screen.queryByRole("button", { name: /Excel/ })).toBeNull();
  });
});

describe("Auditoría de la Matriz (§15.9)", () => {
  it("lista quién hizo qué y filtra por acción", async () => {
    svc.personas.mockResolvedValue([{ id: 7, nombre: "Ana Pérez" }]);
    svc.auditoria.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 1,
          created_at: "2026-10-01T15:00:00Z",
          actor: "Ana Pérez",
          accion: "period.updated",
          descripcion: "Cambio de responsable",
          motivo: "",
          valor_anterior: "Beto",
          valor_nuevo: "Ana Pérez",
          periodo: {
            id: 1,
            codigo: "OBL-0001",
            etiqueta: "Octubre 2026",
            obligacion: "Declaración de IVA",
          },
        },
      ],
    });
    pintar(<AuditoriaMatriz />);

    const fila = (await screen.findByText("Cambio de responsable")).closest(
      "tr",
    );
    expect(within(fila).getByText("Beto → Ana Pérez")).toBeInTheDocument();
    expect(within(fila).getByText("OBL-0001")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Acción"), {
      target: { value: "period.validated" },
    });
    await waitFor(() =>
      expect(svc.auditoria).toHaveBeenLastCalledWith({
        page: 1,
        action: "period.validated",
      }),
    );
  });
});

describe("Las áreas de la Matriz en la ficha del usuario (§8.7)", () => {
  it("se marcan por empresa y viajan al guardar", async () => {
    listarEmpresas.mockResolvedValue({
      results: [{ id: 1, nombre: "LaarCourier", activa: true }],
    });
    listarAreas.mockResolvedValue([
      { id: 5, codigo: "CONT", nombre: "Contabilidad y Tributario" },
      { id: 6, codigo: "TH", nombre: "Talento Humano" },
    ]);
    obtenerUsuario.mockResolvedValue({
      roles: [],
      empresas: [
        {
          id: 1,
          nombre: "LaarCourier",
          es_predeterminada: true,
          roles: [{ id: 20, name: "Responsable de cumplimiento" }],
          areas: [{ id: 5, nombre: "Contabilidad y Tributario" }],
        },
      ],
    });
    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByText(/Temas de la Matriz \(\s*1\s*\)/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Contabilidad y Tributario")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Talento Humano"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar accesos" }));

    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [20], es_predeterminada: true, areas: [5, 6] },
      ]),
    );
  });

  it("sin el catálogo de áreas no se envían y el servidor conserva las que había", async () => {
    listarEmpresas.mockResolvedValue({
      results: [{ id: 1, nombre: "LaarCourier", activa: true }],
    });
    listarAreas.mockRejectedValue(new Error("403"));
    obtenerUsuario.mockResolvedValue({
      roles: [],
      empresas: [
        { id: 1, nombre: "LaarCourier", es_predeterminada: true, roles: [] },
      ],
    });
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Guardar accesos" }),
    );
    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [], es_predeterminada: true },
      ]),
    );
  });
});
