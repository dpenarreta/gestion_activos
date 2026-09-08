import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionsPanel } from "../src/pages/Admin/Permissions/PermissionsPanel";

const CATALOG = {
  usuarios: {
    label: "Usuarios",
    description: "Gestión de usuarios",
    permissions: { "usuarios.ver": "Ver usuarios" },
  },
};

vi.mock("../src/api/permissionsService", () => ({
  permissionsService: { catalog: vi.fn(() => Promise.resolve(CATALOG)) },
}));

describe("PermissionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muestra el catálogo agrupado por módulo, de solo lectura", async () => {
    render(
      <MemoryRouter>
        <PermissionsPanel />
      </MemoryRouter>
    );

    expect(await screen.findByText("Ver usuarios")).toBeInTheDocument();
    expect(screen.getByText("usuarios.ver")).toBeInTheDocument();
    // El catálogo se consulta, no se edita: no debe haber casillas aquí.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
