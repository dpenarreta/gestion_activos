import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cargosParaElegir,
  nombreComparable,
  ocupanteSinCuentaPara,
} from "../src/pages/Admin/Users/cargosDelAlta";

/*
 * Ficha del usuario, tarjeta Roles: su cargo en el organigrama y el rol que le
 * da, en solo lectura, con el enlace a Asignación de cargos (09/11/2026). Y la
 * lógica del alta que decide qué se dice de cada cargo.
 */

const organigrama = vi.fn();
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: { organigrama: (...args) => organigrama(...args) },
}));
vi.mock("../src/context/UnsavedChangesContext", () => ({
  useUnsavedChanges: () => ({ guardedNavigate: vi.fn() }),
}));
const mias = vi.fn();
vi.mock("../src/api/empresasService", () => ({
  empresasService: { mias: (...args) => mias(...args) },
}));
const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { CargoDelUsuario } =
  await import("../src/pages/Admin/Users/CargoDelUsuario");

const DATOS = {
  unidades: [{ id: 1, nombre: "Cartera" }],
  cargos: [
    {
      id: 50,
      nombre: "Jefe de Cartera",
      unidad: 1,
      jefe: null,
      activo: true,
      vacantes: 0,
      rol: { id: 90, nombre: "Jefe de Cartera · Cartera" },
      ocupantes: [{ id: 7, nombre: "Sara Marroquín" }],
    },
  ],
};

function pintar(usuarioId = "7") {
  return render(
    <MemoryRouter>
      <CargoDelUsuario usuarioId={usuarioId} nombre="Sara Marroquín" />
    </MemoryRouter>,
  );
}

describe("Cargo en la ficha del usuario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.clear();
    organigrama.mockResolvedValue(DATOS);
    mias.mockResolvedValue({ multiempresa: false, activa: null });
  });

  it("dice su cargo y el rol que le da, con el enlace para cambiarlo", async () => {
    permisos.add("institucional.asignar");
    pintar();

    expect(
      await screen.findByText(/le da el rol Jefe de Cartera · Cartera/),
    ).toHaveTextContent(
      "Cargo: Jefe de Cartera · Cartera (le da el rol Jefe de Cartera · Cartera).",
    );
    expect(
      screen.getByRole("link", { name: "Cambiar en Asignación de cargos" }),
    ).toHaveAttribute(
      "href",
      `/admin/institucional/estructura?pestana=asignaciones&buscar=${encodeURIComponent("Sara Marroquín")}`,
    );
  });

  it("sin cargo lo dice; quien solo ve el organigrama no tiene enlace", async () => {
    permisos.add("institucional.ver");
    pintar("8");

    expect(
      await screen.findByText("Sin cargo en el organigrama."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // Con varias empresas se dice de cuál: en otra puede tener cargo.
  it("con varias empresas nombra la de la pestaña", async () => {
    permisos.add("institucional.ver");
    mias.mockResolvedValue({
      multiempresa: true,
      activa: { id: 1, nombre: "LaarCourier" },
    });
    pintar("8");

    expect(
      await screen.findByText("Sin cargo en el organigrama de LaarCourier."),
    ).toBeInTheDocument();
  });

  it("sin permisos del organigrama no consulta nada", () => {
    pintar();
    expect(organigrama).not.toHaveBeenCalled();
    expect(screen.queryByText(/Cargo/)).not.toBeInTheDocument();
  });
});

describe("Lógica del cargo en el alta", () => {
  it("compara nombres sin tildes, mayúsculas ni espacios de más", () => {
    expect(nombreComparable("  Sara  Fernanda MARROQUÍN ")).toBe(
      "sara fernanda marroquin",
    );
  });

  it("solo ofrece los activos y distingue gemelos por su jefe", () => {
    const lista = cargosParaElegir({
      unidades: [{ id: 1, nombre: "Cartera" }],
      cargos: [
        { id: 1, nombre: "Jefe", unidad: 1, activo: true, ocupantes: [] },
        { id: 2, nombre: "Gestor", unidad: 1, jefe: 1, activo: true },
        { id: 3, nombre: "Gestor", unidad: 1, jefe: 4, activo: true },
        { id: 4, nombre: "Supervisor", unidad: 1, activo: false },
      ],
    });
    expect(lista.map((c) => c.etiqueta)).toEqual([
      "Gestor · Cartera (reporta a Jefe)",
      "Gestor · Cartera (reporta a Supervisor)",
      "Jefe · Cartera",
    ]);
  });

  it("distingue el ocupante sin cuenta igual del solo parecido", () => {
    const cargo = { sinCuenta: ["Sara Fernanda Marroquín García"] };
    expect(
      ocupanteSinCuentaPara(cargo, "sara fernanda marroquin garcia"),
    ).toEqual({ tipo: "reemplaza", nombre: "Sara Fernanda Marroquín García" });
    expect(ocupanteSinCuentaPara(cargo, "Sara Marroquín")?.tipo).toBe(
      "parecido",
    );
    expect(ocupanteSinCuentaPara(cargo, "Sara López")).toBeNull();
    expect(ocupanteSinCuentaPara(null, "Sara")).toBeNull();
  });
});
