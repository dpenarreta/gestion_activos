import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RolesPanel } from "../src/pages/Admin/Roles/RolesPanel";

const ROLES = [{ id: 1, name: "Editor", permission_codenames: ["usuarios.ver"] }];

vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: vi.fn(() => Promise.resolve(ROLES)), remove: vi.fn(() => Promise.resolve()) },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: () => true,
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <RolesPanel />
    </MemoryRouter>
  );
}

describe("RolesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista los roles existentes con su número de permisos", async () => {
    renderPanel();
    expect(await screen.findByText("Editor")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("ofrece crear un rol cuando el usuario tiene el permiso", async () => {
    renderPanel();
    await screen.findByText("Editor");
    expect(screen.getByRole("link", { name: "Nuevo rol" })).toBeInTheDocument();
  });
});
