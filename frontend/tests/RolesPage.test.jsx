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
    </MemoryRouter>
  );
}

describe("RolesPage", () => {
  it("ofrece el catálogo de permisos como pestaña dentro de roles", () => {
    renderPage("roles", "/admin/roles");

    const pestanas = screen.getAllByRole("tab");
    expect(pestanas.map((t) => t.textContent)).toEqual(["Roles", "Catálogo de permisos"]);
    expect(pestanas[0]).toHaveAttribute("aria-selected", "true");
  });

  it("marca la pestaña de permisos como activa en su propia ruta", () => {
    renderPage("permisos", "/admin/roles/permisos");

    const pestanaPermisos = screen.getByRole("tab", { name: "Catálogo de permisos" });
    expect(pestanaPermisos).toHaveAttribute("aria-selected", "true");
  });
});
