import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MOTIVO, darMotivo } from "./motivo";

/*
 * Niveles jerárquicos por cargo (27/10/2026): Gerencia General › Gerencia de
 * Área › Jefatura › Coordinación › Operativo de área › Asistente de área.
 * Se ven en el organigrama y se eligen al crear o editar un cargo.
 */

const servicio = {
  organigrama: vi.fn(),
  crear: vi.fn(),
  actualizar: vi.fn(),
  eliminar: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: ["institucional.ver", "institucional.editar"] },
  }),
}));
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: () => ({ hasPermission: () => true }),
}));

const { OrganigramaPage } =
  await import("../src/pages/Institucional/OrganigramaPage");
const { EstructuraPage } =
  await import("../src/pages/Institucional/EstructuraPage");

const NIVELES_CARGO = [
  ["gerencia_general", "Gerencia General"],
  ["gerencia_area", "Gerencia de Área"],
  ["jefatura", "Jefatura"],
  ["coordinacion", "Coordinación"],
  ["operativo", "Operativo de área"],
  ["asistente", "Asistente de área"],
].map(([valor, nombre], orden) => ({ valor, nombre, orden }));

const ORGANIGRAMA = {
  niveles_cargo: NIVELES_CARGO,
  niveles: [{ id: 1, nombre: "Área", orden: 1 }],
  unidades: [
    {
      id: 11,
      nombre: "TI",
      nivel: 1,
      padre: null,
      departamento: null,
      activa: true,
    },
  ],
  cargos: [
    {
      id: 20,
      nombre: "Jefe TI",
      unidad: 11,
      jefe: null,
      plazas: 1,
      nivel: "jefatura",
      activo: true,
      ocupantes: [],
      vacantes: 1,
    },
    {
      id: 21,
      nombre: "Asistente de Sistemas",
      unidad: 11,
      jefe: 20,
      plazas: 1,
      nivel: "asistente",
      activo: true,
      ocupantes: [],
      vacantes: 1,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  servicio.organigrama.mockResolvedValue(ORGANIGRAMA);
});

const pintar = (elemento) => render(<MemoryRouter>{elemento}</MemoryRouter>);

describe("Niveles jerárquicos por cargo", () => {
  it("el organigrama muestra el nivel de cada cargo, en el árbol y en la lista", async () => {
    pintar(<OrganigramaPage />);
    const ti = await screen.findByRole("region", { name: "TI" });
    expect(within(ti).getByText("Jefatura")).toBeInTheDocument();
    expect(within(ti).getByText("Asistente de área")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Lista/ }));
    expect(
      within(screen.getByRole("region", { name: "TI" })).getByText("Jefatura"),
    ).toBeInTheDocument();
  });

  it("la tabla de cargos dice el nivel y se cambia al editar", async () => {
    servicio.actualizar.mockResolvedValue({});
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    expect(
      screen.getByRole("columnheader", { name: "Nivel jerárquico" }),
    ).toBeInTheDocument();
    const fila = screen.getByText("Asistente de Sistemas").closest("tr");
    expect(within(fila).getByText("Asistente de área")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Editar Asistente de Sistemas" }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Editar cargo: Asistente de Sistemas",
    });
    const nivel = within(ventana).getByLabelText("Nivel jerárquico");
    expect(nivel).toHaveValue("asistente");
    fireEvent.change(nivel, { target: { value: "operativo" } });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await darMotivo();
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(
        "cargos",
        21,
        expect.objectContaining({ nivel: "operativo" }),
        MOTIVO,
      ),
    );
  });

  it("la pestaña «Niveles jerárquicos» lista los seis niveles con sus cargos", async () => {
    pintar(<EstructuraPage />);
    const pestana = await screen.findByRole("tab", {
      name: /Niveles jerárquicos/,
    });
    expect(pestana).not.toHaveTextContent("(");
    const tabla = within(
      screen.getByRole("region", {
        name: "Niveles jerárquicos de los cargos",
      }),
    ).getByRole("table");
    const filas = within(tabla).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(6);
    expect(filas[0]).toHaveTextContent("Gerencia General");
    expect(filas[2]).toHaveTextContent("Jefatura");
    expect(filas[2]).toHaveTextContent("Jefe TI");
    expect(filas[5]).toHaveTextContent("Asistente de Sistemas");
    // Los niveles de unidad siguen debajo, con su propio botón.
    expect(
      screen.getByRole("heading", { name: "Niveles de unidad" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Agregar nivel de unidad" }),
    ).toBeInTheDocument();
  });

  it("un cargo nuevo puede dejar el nivel según su nombre", async () => {
    servicio.crear.mockResolvedValue({});
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar cargo" }));
    expect(screen.getByLabelText("Nivel jerárquico")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Coordinador TI" },
    });
    fireEvent.change(screen.getByLabelText("Unidad"), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await darMotivo();
    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    // Sin nivel elegido, no se envía: lo decide el servidor por el nombre.
    expect(servicio.crear.mock.calls[0][1]).not.toHaveProperty("nivel");
  });
});

describe("El organigrama solo muestra lo vigente", () => {
  it("un cargo desactivado no aparece ni cuenta", async () => {
    servicio.organigrama.mockResolvedValue({
      ...ORGANIGRAMA,
      cargos: [
        ...ORGANIGRAMA.cargos,
        {
          id: 22,
          nombre: "Cargo Retirado",
          unidad: 11,
          jefe: 20,
          plazas: 1,
          nivel: "operativo",
          activo: false,
          ocupantes: [],
          vacantes: 1,
        },
      ],
    });
    pintar(<OrganigramaPage />);
    await screen.findByRole("region", { name: "TI" });
    expect(screen.queryByText("Cargo Retirado")).toBeNull();
    expect(screen.getByText(/1 unidades · 2 cargos/)).toBeInTheDocument();
  });

  it("si el jefe quedó inactivo, el cargo cuelga del primer jefe vigente", async () => {
    const retirado = {
      id: 22,
      nombre: "Cargo Retirado",
      unidad: 11,
      jefe: 20,
      plazas: 1,
      nivel: "coordinacion",
      activo: false,
      ocupantes: [],
      vacantes: 1,
    };
    servicio.organigrama.mockResolvedValue({
      ...ORGANIGRAMA,
      cargos: [
        ...ORGANIGRAMA.cargos,
        retirado,
        { ...retirado, id: 23, nombre: "Analista", jefe: 22, activo: true },
      ],
    });
    pintar(<OrganigramaPage />);
    await screen.findByRole("region", { name: "TI" });
    fireEvent.click(screen.getByRole("radio", { name: /Lista/ }));
    const analista = screen.getByText("Analista").closest("li, article, div");
    expect(
      within(analista.parentElement).getByText(/Reporta a Jefe TI/),
    ).toBeInTheDocument();
  });
});
