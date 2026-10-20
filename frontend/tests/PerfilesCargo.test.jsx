import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El perfil de cada cargo: se escribe en Editar estructura → Perfiles de
 * cargo y lo ve en «Mi perfil» quien ocupa el cargo.
 */

const servicio = { perfilCargo: vi.fn(), guardarPerfilCargo: vi.fn() };
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));
const herramientas = { catalogo: vi.fn() };
vi.mock("../src/api/herramientasService", () => ({
  herramientasService: herramientas,
}));

const { PerfilesCargo } =
  await import("../src/pages/Institucional/PerfilesCargo");
const { MiCargo } = await import("../src/pages/MisDatos/MiCargo");

const DATOS = {
  unidades: [{ id: 1, nombre: "Cartera" }],
  cargos: [
    { id: 7, nombre: "Gestor de cobranzas", unidad: 1, perfil: "parcial" },
    { id: 8, nombre: "Jefe de cartera", unidad: 1, perfil: "completo" },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("Perfiles de cargo", () => {
  it("lista los cargos por unidad con su estado y guarda el perfil", async () => {
    servicio.perfilCargo.mockResolvedValue({
      objetivo: "Cobrar",
      funciones: ["Gestionar cartera"],
      competencias: [],
      kpis: [],
      herramientas: [1],
    });
    herramientas.catalogo.mockResolvedValue([
      { id: 1, nombre: "Claude", tipo: "externa", activa: true },
      { id: 3, nombre: "Zimbra", tipo: "interna", activa: true },
      { id: 4, nombre: "Vieja", tipo: "interna", activa: false },
    ]);
    servicio.guardarPerfilCargo.mockResolvedValue({});
    const onGuardado = vi.fn();
    render(<PerfilesCargo datos={DATOS} onGuardado={onGuardado} />);
    expect(
      screen.getByText(/1 de 2 cargos con su perfil completo/),
    ).toBeInTheDocument();
    expect(screen.getByText("A medias")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar perfil de Gestor de cobranzas",
      }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Perfil de «Gestor de cobranzas»",
    });
    const funciones = await within(ventana).findByLabelText("Funciones");
    expect(funciones).toHaveValue("Gestionar cartera");
    fireEvent.change(funciones, {
      target: { value: "Gestionar cartera\nNegociar acuerdos" },
    });
    fireEvent.change(
      within(ventana).getByLabelText("KPIs o métricas de medición"),
      { target: { value: "Recuperación ≥ 90 %" } },
    );
    // Las herramientas que necesita el cargo (solo las activas del catálogo).
    expect(
      await within(ventana).findByRole("checkbox", { name: "Claude" }),
    ).toBeChecked();
    expect(
      within(ventana).queryByRole("checkbox", { name: "Vieja" }),
    ).toBeNull();
    fireEvent.click(within(ventana).getByRole("checkbox", { name: "Zimbra" }));
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar perfil" }),
    );
    await waitFor(() =>
      expect(servicio.guardarPerfilCargo).toHaveBeenCalledWith(7, {
        objetivo: "Cobrar",
        funciones: "Gestionar cartera\nNegociar acuerdos",
        competencias: "",
        kpis: "Recuperación ≥ 90 %",
        herramientas: [1, 3],
      }),
    );
    expect(onGuardado).toHaveBeenCalled();
  });
});

describe("Mi cargo en «Mi perfil»", () => {
  it("sin cargo no aparece", () => {
    const { container } = render(<MiCargo perfil={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("muestra el objetivo, las funciones, las competencias y los KPIs", () => {
    render(
      <MiCargo
        perfil={{
          cargo: { id: 7, nombre: "Gestor de cobranzas" },
          objetivo: "Asegurar la cobranza",
          funciones: ["Gestionar cartera", "Negociar acuerdos"],
          competencias: ["Negociación"],
          kpis: ["Recuperación ≥ 90 %"],
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Mi cargo: Gestor de cobranzas/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Asegurar la cobranza")).toBeInTheDocument();
    expect(screen.getByText("Negociar acuerdos")).toBeInTheDocument();
    expect(screen.getByText("Negociación")).toBeInTheDocument();
    expect(screen.getByText("Recuperación ≥ 90 %")).toBeInTheDocument();
  });

  it("si el cargo aún no tiene perfil, lo dice", () => {
    render(
      <MiCargo
        perfil={{
          cargo: { id: 7, nombre: "Gestor" },
          objetivo: "",
          funciones: [],
          competencias: [],
          kpis: [],
        }}
      />,
    );
    expect(screen.getByText(/todavía no se ha cargado/)).toBeInTheDocument();
  });
});
