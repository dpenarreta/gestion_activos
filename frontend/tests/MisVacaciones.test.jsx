import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Institucional → Mis vacaciones: los días pendientes de gozar y, por cada
 * período, cuántos corresponden, cuántos se gozaron y cuántos quedan. Con
 * `vacaciones.ver_todas` se consultan los de otra persona.
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  misVacaciones: vi.fn(),
  personasVacaciones: vi.fn(),
  vacacionesDe: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const { MisVacacionesPage } =
  await import("../src/pages/Institucional/MisVacacionesPage");

function periodo(id, anio, correspondientes, goces) {
  const gozados = goces.reduce((s, g) => s + g.dias, 0);
  return {
    id,
    nombre: `${anio} – ${anio + 1}`,
    desde: `${anio}-03-01`,
    hasta: `${anio + 1}-02-28`,
    correspondientes,
    gozados,
    pendientes: correspondientes - gozados,
    nota: "",
    goces,
  };
}

const MIAS = {
  persona: { id: 1, nombre: "Ana" },
  correspondientes: 46,
  gozados: 23,
  pendientes: 23,
  periodos_con_pendientes: 2,
  periodos: [
    periodo(1, 2023, 15, [
      {
        id: 1,
        desde: "2024-07-01",
        hasta: "2024-07-15",
        dias: 15,
        descripcion: "Vacaciones de verano",
      },
    ]),
    periodo(2, 2024, 15, [
      {
        id: 2,
        desde: "2025-04-14",
        hasta: "2025-04-18",
        dias: 5,
        descripcion: "",
      },
      {
        id: 3,
        desde: "2025-12-29",
        hasta: "2025-12-31",
        dias: 3,
        descripcion: "",
      },
    ]),
    periodo(3, 2025, 16, []),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  servicio.misVacaciones.mockResolvedValue(MIAS);
});

describe("Mis vacaciones", () => {
  it("muestra los días pendientes y en cuántos períodos", async () => {
    render(<MisVacacionesPage />);
    expect(
      await screen.findByText("Días pendientes de gozar"),
    ).toBeInTheDocument();
    expect(screen.getByText("En 2 períodos")).toBeInTheDocument();
    expect(
      screen.queryByText(/Consultar las vacaciones de otra persona/),
    ).toBeNull();
  });

  it("por período: corresponden, gozados y pendientes, con su detalle", async () => {
    render(<MisVacacionesPage />);
    const p2024 = await screen.findByRole("region", {
      name: "Período 2024 – 2025",
    });
    expect(within(p2024).getByText("7 días pendientes")).toBeInTheDocument();
    expect(
      within(p2024).getByRole("progressbar", {
        name: "Gozados del período 2024 – 2025",
      }),
    ).toHaveAttribute("aria-valuenow", "8");
    expect(within(p2024).getAllByRole("row")).toHaveLength(3); // cabecera + 2

    // El período gozado por completo no se muestra; se avisa cuántos hay.
    expect(
      screen.queryByRole("region", { name: "Período 2023 – 2024" }),
    ).toBeNull();
    expect(
      screen.getByText("1 período ya gozado por completo no se muestra."),
    ).toBeInTheDocument();

    const p2025 = screen.getByRole("region", { name: "Período 2025 – 2026" });
    expect(
      within(p2025).getByText("Todavía no ha gozado días de este período."),
    ).toBeInTheDocument();
  });

  it("solo los pendientes, del más reciente al más antiguo", async () => {
    render(<MisVacacionesPage />);
    await screen.findByText("Días pendientes de gozar");
    const nombres = screen
      .getAllByRole("region", { name: /^Período/ })
      .map((r) => r.getAttribute("aria-label"));
    expect(nombres).toEqual(["Período 2025 – 2026", "Período 2024 – 2025"]);
  });

  it("si todo está gozado, lo dice", async () => {
    servicio.misVacaciones.mockResolvedValue({
      ...MIAS,
      pendientes: 0,
      periodos_con_pendientes: 0,
      periodos: [MIAS.periodos[0]],
    });
    render(<MisVacacionesPage />);
    expect(
      await screen.findByText(/todos sus períodos están gozados/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Período/ })).toBeNull();
  });

  it("con permiso se consultan las de otra persona", async () => {
    permisos.lista = ["vacaciones.ver_todas"];
    servicio.personasVacaciones.mockResolvedValue([
      { id: 9, nombre: "Beto Paz", pendientes: 12, periodos: 2 },
    ]);
    servicio.vacacionesDe.mockResolvedValue({
      ...MIAS,
      persona: { id: 9, nombre: "Beto Paz" },
    });
    render(<MisVacacionesPage />);
    fireEvent.click(
      await screen.findByText(/Consultar las vacaciones de otra persona/),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Beto Paz/ }));
    expect(
      await screen.findByRole("heading", { name: "Vacaciones de Beto Paz" }),
    ).toBeInTheDocument();
    expect(servicio.vacacionesDe).toHaveBeenCalledWith(9);
    fireEvent.click(screen.getByRole("button", { name: /Volver a las mías/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Mis vacaciones" }),
      ).toBeInTheDocument(),
    );
  });
});
