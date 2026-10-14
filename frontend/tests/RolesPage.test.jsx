import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { UnsavedChangesProvider } from "../src/context/UnsavedChangesContext";
import { RolesPage } from "../src/pages/Admin/Roles/RolesPage";

vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: vi.fn(() => Promise.resolve([])), remove: vi.fn() },
}));

vi.mock("../src/api/permissionsService", () => ({
  permissionsService: { catalog: vi.fn(() => Promise.resolve({})) },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: () => true,
}));

function renderPage(seccion, ruta) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <RolesPage seccion={seccion} />
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

/*
 * Roles y permisos son dos secciones de Configuración, con sus pestañas en el
 * marco (ver ConfiguracionMarco). La página ya no dibuja pestañas propias: dos
 * filas de pestañas para lo mismo harían dudar cuál manda.
 */
describe("RolesPage", () => {
  it("en su ruta muestra los roles, sin pestañas propias", () => {
    renderPage("roles", "/admin/roles");

    expect(
      screen.getByRole("heading", { name: "Roles", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("en la suya muestra el catálogo de permisos", () => {
    renderPage("permisos", "/admin/roles/permisos");

    expect(
      screen.getByRole("heading", { name: "Permisos", level: 2 }),
    ).toBeInTheDocument();
  });
});
