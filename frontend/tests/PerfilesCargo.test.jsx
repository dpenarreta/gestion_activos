import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOTIVO, darMotivo } from "./motivo";

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
    // Cada lista se escribe fila por fila: Enter agrega la siguiente.
    const funcion = await within(ventana).findByLabelText(
      "Funciones: función 1",
    );
    expect(funcion).toHaveValue("Gestionar cartera");
    fireEvent.keyDown(funcion, { key: "Enter" });
    const segunda = within(ventana).getByLabelText("Funciones: función 2");
    await waitFor(() => expect(segunda).toHaveFocus());
    fireEvent.change(segunda, { target: { value: "Negociar acuerdos" } });
    fireEvent.change(
      within(ventana).getByLabelText(
        "KPIs o métricas de medición: KPI o métrica 1",
      ),
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
    await darMotivo();
    await waitFor(() =>
      expect(servicio.guardarPerfilCargo).toHaveBeenCalledWith(
        7,
        {
          objetivo: "Cobrar",
          funciones: ["Gestionar cartera", "Negociar acuerdos"],
          competencias: [],
          kpis: ["Recuperación ≥ 90 %"],
          herramientas: [1, 3],
        },
        MOTIVO,
      ),
    );
    expect(onGuardado).toHaveBeenCalled();
  });
});

describe("Listas del perfil, fila por fila", () => {
  async function abrir(funciones) {
    servicio.perfilCargo.mockResolvedValue({
      objetivo: "",
      funciones,
      competencias: [],
      kpis: [],
      herramientas: [],
    });
    herramientas.catalogo.mockResolvedValue([]);
    servicio.guardarPerfilCargo.mockResolvedValue({});
    render(<PerfilesCargo datos={DATOS} onGuardado={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar perfil de Gestor de cobranzas",
      }),
    );
    return screen.findByRole("dialog", {
      name: "Perfil de «Gestor de cobranzas»",
    });
  }

  function valores(ventana) {
    return within(within(ventana).getByRole("group", { name: "Funciones" }))
      .getAllByRole("textbox")
      .map((c) => c.value);
  }

  it("se reordena, se quita y pegar varias líneas crea una fila por línea", async () => {
    const ventana = await abrir(["Cobrar", "Llamar", "Visitar"]);
    await within(ventana).findByLabelText("Funciones: función 1");

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Subir función 3" }),
    );
    expect(valores(ventana)).toEqual(["Cobrar", "Visitar", "Llamar"]);
    expect(
      within(ventana).getByRole("button", { name: "Subir función 1" }),
    ).toBeDisabled();

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Quitar función 1" }),
    );
    expect(valores(ventana)).toEqual(["Visitar", "Llamar"]);

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Agregar función" }),
    );
    fireEvent.paste(within(ventana).getByLabelText("Funciones: función 3"), {
      clipboardData: {
        getData: () => "1. Negociar\n- Registrar acuerdos\n\n• Reportar",
      },
    });
    expect(valores(ventana)).toEqual([
      "Visitar",
      "Llamar",
      "Negociar",
      "Registrar acuerdos",
      "Reportar",
    ]);

    // Retroceso en una fila vacía la quita; las vacías no se guardan.
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Agregar función" }),
    );
    fireEvent.keyDown(within(ventana).getByLabelText("Funciones: función 6"), {
      key: "Backspace",
    });
    expect(valores(ventana)).toHaveLength(5);
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Agregar función" }),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar perfil" }),
    );
    await darMotivo();
    await waitFor(() =>
      expect(servicio.guardarPerfilCargo).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          funciones: [
            "Visitar",
            "Llamar",
            "Negociar",
            "Registrar acuerdos",
            "Reportar",
          ],
        }),
        MOTIVO,
      ),
    );
  });

  it("una lista vacía empieza con una fila para escribir", async () => {
    const ventana = await abrir([]);
    const fila = await within(ventana).findByLabelText("Funciones: función 1");
    expect(fila).toHaveValue("");
    // Quitar la única fila deja otra vacía.
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Quitar función 1" }),
    );
    expect(valores(ventana)).toEqual([""]);
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
    // Cada lista sale numerada, en su orden.
    const funciones = screen.getByText("Negociar acuerdos").closest("ol");
    expect(funciones).not.toBeNull();
    expect(
      within(funciones)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Gestionar cartera", "Negociar acuerdos"]);
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
