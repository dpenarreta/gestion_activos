import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersList } from "../src/pages/Admin/Users/UsersList";

const USERS = [
  {
    id: 1,
    username: "ana",
    email: "ana@example.com",
    status: "active",
    is_superuser: false,
    roles: [{ id: 1, name: "Editor" }],
    created_at: "2026-01-01T00:00:00Z",
  },
];

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    list: vi.fn(() => Promise.resolve({ results: USERS, count: 1, next: null, previous: null })),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersList />
    </MemoryRouter>
  );
}

describe("UsersList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista los usuarios existentes", async () => {
    renderPage();
    expect(await screen.findByText("ana")).toBeInTheDocument();
  });

  it("muestra el breadcrumb Administración > Usuarios", async () => {
    renderPage();
    await screen.findByText("ana");
    expect(screen.getByText("Administración")).toBeInTheDocument();
    expect(screen.getAllByText("Usuarios").length).toBeGreaterThan(0);
  });
});
