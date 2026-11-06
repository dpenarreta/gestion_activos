import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RolesPanel } from "../src/pages/Admin/Roles/RolesPanel";

const ROLES = [
  {
    id: 1,
    name: "Editor",
    permission_codenames: ["usuarios.ver"],
    cargo: null,
  },
  {
    id: 2,
    name: "Jefe TI",
    permission_codenames: [],
    cargo: {
      id: 3,
      nombre: "Jefe TI",
      unidad: "Tecnología",
      empresa: "LaarCourier",
    },
  },
];

vi.mock("../src/api/rolesService", () => ({
  rolesService: {
    list: vi.fn(() => Promise.resolve(ROLES)),
    remove: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: () => true,
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <RolesPanel />
    </MemoryRouter>,
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

  it("el rol de un cargo del organigrama se marca y no se ofrece eliminarlo", async () => {
    renderPanel();
    const nombre = await screen.findByText("Jefe TI");
    const fila = nombre.closest("tr");
    expect(fila).toHaveTextContent(/Cargo del organigrama de LaarCourier/);
    expect(fila.querySelector("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Eliminar / })).toHaveLength(
      1,
    );
    // El botón dice qué rol elimina (revisión final UX/UI, 28/10/2026).
    expect(
      screen.getByRole("button", { name: "Eliminar Editor" }),
    ).toBeInTheDocument();
  });

  it("el buscador filtra en cada tecla, sin tildes ni mayúsculas", async () => {
    renderPanel();
    await screen.findByText("Editor");
    const campo = screen.getByRole("searchbox", { name: "Buscar roles" });
    fireEvent.change(campo, { target: { value: "EDITÓR" } });
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.queryByText("Jefe TI")).toBeNull();
  });

  it("filtra por tipo: solo los de un cargo del organigrama", async () => {
    renderPanel();
    await screen.findByText("Editor");
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de rol" }), {
      target: { value: "cargo" },
    });
    expect(screen.getByText("Jefe TI")).toBeInTheDocument();
    expect(screen.queryByText("Editor")).toBeNull();
  });

  it("sin coincidencias lo dice y limpiar devuelve el foco al buscador", async () => {
    renderPanel();
    await screen.findByText("Editor");
    const campo = screen.getByRole("searchbox", { name: "Buscar roles" });
    fireEvent.change(campo, { target: { value: "zzz" } });
    expect(screen.getByText("Sin resultados para «zzz».")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(campo).toHaveValue("");
    expect(campo).toHaveFocus();
    expect(screen.getByText("Editor")).toBeInTheDocument();
  });
});
