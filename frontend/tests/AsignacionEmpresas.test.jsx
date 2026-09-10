import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COURIER = { id: 1, nombre: "LaarCourier", codigo: "LC", activa: true };
const SEGURIDAD = {
  id: 2,
  nombre: "LaarSeguridad",
  codigo: "LS",
  activa: true,
};

const list = vi.fn();
const get = vi.fn();
const assignEmpresas = vi.fn(() => Promise.resolve({}));

vi.mock("../src/api/empresasService", () => ({
  empresasService: { list: (...args) => list(...args) },
}));

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    get: (...args) => get(...args),
    assignEmpresas: (...args) => assignEmpresas(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { AsignacionEmpresas } =
  await import("../src/pages/Admin/Empresas/AsignacionEmpresas");

describe("Asignación de empresas a un usuario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.clear();
    permisos.add("empresas.ver");
    permisos.add("empresas.asignar");
    list.mockResolvedValue({ results: [COURIER, SEGURIDAD] });
    get.mockResolvedValue({
      empresas: [{ id: 1, nombre: "LaarCourier", es_predeterminada: true }],
    });
  });

  it("marca las empresas que el usuario ya tiene", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    const courier = await screen.findByRole("checkbox", {
      name: "Asignar LaarCourier",
    });
    expect(courier).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    ).not.toBeChecked();
  });

  it("asigna una segunda empresa conservando la predeterminada", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    const seguridad = await screen.findByRole("checkbox", {
      name: "Asignar LaarSeguridad",
    });
    fireEvent.click(seguridad);
    fireEvent.click(screen.getByRole("button", { name: /Guardar empresas/ }));

    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [1, 2], 1),
    );
  });

  // AC-EMP-010: ver a quién se asignó qué no es poder cambiarlo.
  it("sin el permiso de asignar, muestra pero no deja tocar", async () => {
    permisos.delete("empresas.asignar");

    render(<AsignacionEmpresas usuarioId="7" />);

    const courier = await screen.findByRole("checkbox", {
      name: "Asignar LaarCourier",
    });
    expect(courier).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Guardar empresas/ }),
    ).not.toBeInTheDocument();
  });

  it("sin el permiso de ver empresas no dibuja nada", async () => {
    permisos.clear();

    const { container } = render(<AsignacionEmpresas usuarioId="7" />);

    expect(container).toBeEmptyDOMElement();
    expect(list).not.toHaveBeenCalled();
  });

  // AC-EMP-017: con una sola empresa la asignación todavía no decide nada.
  it("avisa de que con una sola empresa la asignación no decide", async () => {
    list.mockResolvedValue({ results: [COURIER] });

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(await screen.findByText(/Hay una sola empresa/)).toBeInTheDocument();
  });
});
