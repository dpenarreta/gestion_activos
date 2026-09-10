import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SelectorEmpresa } from "../src/components/admin/AdminSidebar/SelectorEmpresa";

const COURIER = { id: 1, nombre: "LaarCourier", codigo: "LC", activa: true };
const SEGURIDAD = {
  id: 2,
  nombre: "LaarSeguridad",
  codigo: "LS",
  activa: true,
};

const mias = vi.fn();
const setEmpresaActiva = vi.fn();

vi.mock("../src/api/empresasService", () => ({
  empresasService: { mias: (...args) => mias(...args) },
}));

vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => "1",
  setEmpresaActiva: (...args) => setEmpresaActiva(...args),
}));

describe("SelectorEmpresa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-EMP-016: un desplegable de un solo elemento no elige nada.
  it("con una sola empresa muestra el nombre pero no un desplegable", async () => {
    mias.mockResolvedValue({ empresas: [COURIER], activa: COURIER });

    render(<SelectorEmpresa isCollapsed={false} />);

    expect(await screen.findByText("LaarCourier")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("con dos empresas deja elegir entre ellas", async () => {
    mias.mockResolvedValue({ empresas: [COURIER, SEGURIDAD], activa: COURIER });

    render(<SelectorEmpresa isCollapsed={false} />);

    const selector = await screen.findByRole("combobox", { name: "Empresa" });
    expect(selector).toHaveValue("1");
    expect(
      screen.getByRole("option", { name: "LaarSeguridad" }),
    ).toBeInTheDocument();
  });

  // Cambiar de empresa cambia de dónde salen los datos, no una vista: se
  // guarda la elección antes de recargar para que la recarga ya la use.
  it("al cambiar de empresa guarda la elección", async () => {
    mias.mockResolvedValue({ empresas: [COURIER, SEGURIDAD], activa: COURIER });
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload },
      writable: true,
    });

    render(<SelectorEmpresa isCollapsed={false} />);
    const selector = await screen.findByRole("combobox", { name: "Empresa" });
    fireEvent.change(selector, { target: { value: "2" } });

    await waitFor(() => expect(setEmpresaActiva).toHaveBeenCalledWith("2"));
    expect(reload).toHaveBeenCalled();
  });

  it("sin empresas no dibuja nada", async () => {
    mias.mockResolvedValue({ empresas: [], activa: null });

    const { container } = render(<SelectorEmpresa isCollapsed={false} />);

    await waitFor(() => expect(mias).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
