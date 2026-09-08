import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RolesList } from "../src/pages/Admin/Roles/RolesList";

const ROLES = [{ id: 1, name: "Editor", permission_codenames: ["usuarios.ver"] }];

vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: vi.fn(() => Promise.resolve(ROLES)), remove: vi.fn(() => Promise.resolve()) },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <RolesList />
    </MemoryRouter>
  );
}

describe("RolesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista los roles existentes", async () => {
    renderPage();
    expect(await screen.findByText("Editor")).toBeInTheDocument();
  });

  it("muestra el breadcrumb Administración > Roles", async () => {
    renderPage();
    await screen.findByText("Editor");
    expect(screen.getByText("Administración")).toBeInTheDocument();
    expect(screen.getAllByText("Roles").length).toBeGreaterThan(0);
  });
});
