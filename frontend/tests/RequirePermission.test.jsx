import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RequirePermission } from "../src/components/common/RequirePermission/RequirePermission";

const mockUseAuth = vi.fn();
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <Routes>
        <Route path="/login" element={<div>pantalla de login</div>} />
        <Route path="/403" element={<div>acceso denegado</div>} />
        <Route
          path="/admin/users"
          element={
            <RequirePermission permission="usuarios.ver">
              <div>panel de usuarios</div>
            </RequirePermission>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequirePermission", () => {
  it("no renderiza nada mientras se inicializa la sesión", () => {
    mockUseAuth.mockReturnValue({ isInitializing: true, isAuthenticated: false, user: null });
    const { container } = renderWithRouter();
    expect(container).toBeEmptyDOMElement();
  });

  it("redirige a /login si no hay sesión", () => {
    mockUseAuth.mockReturnValue({ isInitializing: false, isAuthenticated: false, user: null });
    renderWithRouter();
    expect(screen.getByText(/pantalla de login/i)).toBeInTheDocument();
  });

  it("redirige a /403 si el usuario no tiene el permiso", () => {
    mockUseAuth.mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      user: { permissions: ["roles.ver"] },
    });
    renderWithRouter();
    expect(screen.getByText(/acceso denegado/i)).toBeInTheDocument();
  });

  it("muestra el contenido si el usuario tiene el permiso", () => {
    mockUseAuth.mockReturnValue({
      isInitializing: false,
      isAuthenticated: true,
      user: { permissions: ["usuarios.ver"] },
    });
    renderWithRouter();
    expect(screen.getByText(/panel de usuarios/i)).toBeInTheDocument();
  });
});
