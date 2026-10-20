import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Auditoría, en el bloque «General» del menú: una sola pantalla, sin
 * pestañas (20/10/2026); el módulo se elige con un filtro. Se entra con el
 * permiso del registro general o con el del historial de la Matriz.
 */

const sesion = { permisos: [] };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: sesion.permisos },
    isAuthenticated: true,
    isInitializing: false,
  }),
}));

const { AuditoriaInicio, AuditoriaMarco } =
  await import("../src/components/admin/AuditoriaMarco/AuditoriaMarco");

function pintar() {
  return render(
    <MemoryRouter initialEntries={["/admin/auditoria"]}>
      <Routes>
        <Route
          path="/admin/auditoria"
          element={
            <AuditoriaInicio>
              <AuditoriaMarco>
                <p>Auditoría</p>
              </AuditoriaMarco>
            </AuditoriaInicio>
          }
        />
        <Route path="/403" element={<p>Prohibido</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sesion.permisos = [];
});

describe("Auditoría", () => {
  it("es una sola pantalla: no dibuja pestañas", () => {
    sesion.permisos = ["auditoria.ver", "matriz.ver_auditoria"];
    pintar();
    expect(screen.getByText("Auditoría")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("se entra solo con el permiso de la Matriz", () => {
    sesion.permisos = ["matriz.ver_auditoria"];
    pintar();
    expect(screen.getByText("Auditoría")).toBeInTheDocument();
  });

  it("sin ninguno de los dos, 403", () => {
    pintar();
    expect(screen.getByText("Prohibido")).toBeInTheDocument();
  });
});
