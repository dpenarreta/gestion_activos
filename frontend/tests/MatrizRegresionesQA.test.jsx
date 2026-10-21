import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Regresiones de la ronda de pruebas funcionales de la Matriz (15 de octubre
 * de 2026): cada caso fija un defecto que apareció contra el sistema completo.
 */

const svc = {
  misEmpresas: vi.fn(),
  periodo: vi.fn(),
  historial: vi.fn(),
  periodos: vi.fn(),
  editarSeguimiento: vi.fn(),
  crearObligacion: vi.fn(),
  catalogos: vi.fn(),
  personas: vi.fn(),
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

const { RequiereRolMatriz } =
  await import("../src/pages/Matriz/RequiereRolMatriz");
const { ObligacionFormModal } =
  await import("../src/pages/Matriz/ObligacionFormModal");
const { MatrizObligacionesPage } =
  await import("../src/pages/Matriz/MatrizObligacionesPage");
const { useUltimaPeticion } = await import("../src/hooks/useUltimaPeticion");

const EMPRESA = {
  id: 1,
  nombre: "LaarCourier",
  zona_horaria: "America/Guayaquil",
  roles: [],
  capacidades: ["matriz.editar"],
};

const DETALLE = {
  id: 1,
  codigo: "OBL-0001",
  etiqueta: "Octubre 2026",
  area: "Contabilidad",
  entidad: "SRI",
  responsable: { id: 7, nombre: "Ana Pérez", email: "" },
  prioridad: "media",
  vence_en: "2026-10-28T22:00:00Z",
  etapa: "en_preparacion",
  avance: 25,
  cerrado: false,
  estado: { group: "en_progreso", label: "En preparación" },
  obligacion: {
    id: 1,
    nombre: "Declaración de IVA",
    tipo: "regulatoria",
    periodicidad: "mensual",
    area_nombre: "Contabilidad",
    entidad_nombre: "SRI",
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
  aprobador: null,
  observaciones: "",
  recordatorios_suspendidos: false,
  acciones: ["edit"],
};

function pintar(elemento, ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="*" element={elemento} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.misEmpresas.mockResolvedValue({ empresas: [EMPRESA] });
  svc.periodos.mockResolvedValue({
    count: 0,
    results: [],
    next: null,
    previous: null,
  });
  svc.historial.mockResolvedValue([]);
  svc.catalogos.mockResolvedValue({
    areas: [{ id: 1, nombre: "Contabilidad" }],
    entidades: [{ id: 1, nombre: "SRI" }],
    sedes: [],
    tipos: [{ valor: "regulatoria", nombre: "Regulatoria" }],
    periodicidades: [
      { valor: "mensual", nombre: "Mensual" },
      { valor: "anual", nombre: "Anual" },
    ],
    prioridades: [{ valor: "media", nombre: "Media" }],
    etapas: [],
  });
  svc.personas.mockResolvedValue([
    { id: 7, nombre: "Ana Pérez", email: "" },
    { id: 8, nombre: "Beto Ruiz", email: "" },
  ]);
});

describe("Sin rol de la Matriz", () => {
  it("las pantallas del módulo explican qué falta en vez de «No encontrado»", async () => {
    svc.misEmpresas.mockResolvedValue({ empresas: [] });
    pintar(
      <RequiereRolMatriz>
        <p>contenido</p>
      </RequiereRolMatriz>,
    );
    expect(
      await screen.findByText(
        "No tiene un rol de la Matriz en la empresa activa.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("contenido")).toBeNull();
  });

  it("con rol, muestra la pantalla", async () => {
    pintar(
      <RequiereRolMatriz>
        <p>contenido</p>
      </RequiereRolMatriz>,
    );
    expect(await screen.findByText("contenido")).toBeInTheDocument();
  });
});

describe("Nueva obligación", () => {
  it("el mes de una anual no viaja si se cambió a otra periodicidad", async () => {
    svc.crearObligacion.mockResolvedValue({ id: 3 });
    pintar(<ObligacionFormModal onCerrar={vi.fn()} onCreada={vi.fn()} />);

    const periodicidad = await screen.findByLabelText("Periodicidad");
    await waitFor(() =>
      expect(
        within(periodicidad).getAllByRole("option").length,
      ).toBeGreaterThan(1),
    );
    fireEvent.change(periodicidad, { target: { value: "anual" } });
    fireEvent.change(screen.getByLabelText("Mes de vencimiento"), {
      target: { value: "5" },
    });
    fireEvent.change(periodicidad, { target: { value: "mensual" } });
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "IVA" },
    });
    fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Entidad de control"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Evidencia esperada"), {
      target: { value: "Formulario" },
    });
    fireEvent.change(screen.getByLabelText("Responsable"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear obligación" }));

    await waitFor(() => expect(svc.crearObligacion).toHaveBeenCalled());
    expect(svc.crearObligacion.mock.calls[0][0]).not.toHaveProperty(
      "mes_vencimiento",
    );
  });
});

describe("La regla de crear sin «ver todas»", () => {
  it("se explica en el alta y propone a uno mismo como responsable", async () => {
    svc.catalogos.mockResolvedValue({
      ...(await svc.catalogos()),
      reglas: { solo_propias: true, yo: 7 },
    });
    pintar(<ObligacionFormModal onCerrar={vi.fn()} onCreada={vi.fn()} />);

    expect(
      await screen.findByText(/tiene que figurar en una de las dos/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Responsable")).toHaveValue("7"),
    );
  });

  it("sin la regla, no hay nota ni responsable propuesto", async () => {
    svc.catalogos.mockResolvedValue({
      ...(await svc.catalogos()),
      reglas: { solo_propias: false, yo: 7 },
    });
    pintar(<ObligacionFormModal onCerrar={vi.fn()} onCreada={vi.fn()} />);

    await waitFor(() => expect(svc.personas).toHaveBeenCalled());
    await screen.findAllByRole("option", { name: "Ana Pérez" });
    expect(
      screen.queryByText(/tiene que figurar en una de las dos/),
    ).toBeNull();
    expect(screen.getByLabelText("Responsable")).toHaveValue("");
  });
});

describe("Ceder el período", () => {
  it("si deja de ser suyo, el panel lo dice en vez de mostrar un error", async () => {
    svc.periodo.mockResolvedValue(DETALLE);
    svc.editarSeguimiento.mockResolvedValue({ ...DETALLE, visible: false });
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones?periodo=1");

    const panel = await screen.findByRole("dialog");
    fireEvent.click(
      await within(panel).findByRole("button", { name: /Editar seguimiento/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Guardar" }));

    expect(
      await within(panel).findByText(/ya no está entre los suyos/),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("alert")).toBeNull();
    // No se intentó recargar un período que ya no se puede ver.
    expect(svc.periodo).toHaveBeenCalledTimes(1);
  });
});

describe("Listados con filtros", () => {
  it("solo cuenta la respuesta de la última petición", () => {
    const { result } = renderHook(() => useUltimaPeticion());
    let primera;
    let segunda;
    act(() => {
      primera = result.current();
      segunda = result.current();
    });
    expect(primera()).toBe(false);
    expect(segunda()).toBe(true);
  });
});
