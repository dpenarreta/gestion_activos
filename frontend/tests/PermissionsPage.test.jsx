import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionsPage } from "../src/pages/Admin/Permissions/PermissionsPage";

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

describe("PermissionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muestra el catálogo de permisos agrupado por módulo, de solo lectura", async () => {
    render(
      <MemoryRouter>
        <PermissionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Ver usuarios")).toBeInTheDocument();
    expect(screen.getByText("usuarios.ver")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
