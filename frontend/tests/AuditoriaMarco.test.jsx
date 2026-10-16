import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Auditoría, en el bloque «General» del menú: Sistema y Matriz en pestañas,
 * cada una con su permiso, y la dirección de siempre lleva a la que se puede
 * abrir.
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

function pintar(ruta) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          path="/admin/auditoria"
          element={
            <AuditoriaInicio>
              <AuditoriaMarco>
                <p>Auditoría del sistema</p>
              </AuditoriaMarco>
            </AuditoriaInicio>
          }
        />
        <Route
          path="/admin/auditoria/matriz"
          element={
            <AuditoriaMarco>
              <p>Auditoría de la Matriz</p>
            </AuditoriaMarco>
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
  it("con los dos permisos ofrece las dos pestañas y marca la actual", () => {
    sesion.permisos = ["auditoria.ver", "matriz.ver_auditoria"];
    pintar("/admin/auditoria/matriz");

    const pestanas = screen.getAllByRole("link");
    expect(pestanas.map((p) => p.textContent)).toEqual(["Sistema", "Matriz"]);
    expect(screen.getByRole("link", { name: "Matriz" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("con una sola no dibuja pestañas", () => {
    sesion.permisos = ["auditoria.ver"];
    pintar("/admin/auditoria");

    expect(screen.getByText("Auditoría del sistema")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("quien solo ve la de la Matriz entra directo a ella", () => {
    sesion.permisos = ["matriz.ver_auditoria"];
    pintar("/admin/auditoria");

    expect(screen.getByText("Auditoría de la Matriz")).toBeInTheDocument();
  });

  it("sin ninguna, 403", () => {
    pintar("/admin/auditoria");

    expect(screen.getByText("Prohibido")).toBeInTheDocument();
  });
});
