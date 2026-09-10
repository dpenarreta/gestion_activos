import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COURIER = { id: 1, nombre: "LaarCourier", codigo: "LC", activa: true };
const SEGURIDAD = {
  id: 2,
  nombre: "LaarSeguridad",
  codigo: "LS",
  activa: true,
};
const ROLES = [
  { id: 10, name: "Soporte TI" },
  { id: 11, name: "Solo consulta" },
];

const list = vi.fn();
const get = vi.fn();
const assignEmpresas = vi.fn(() => Promise.resolve({}));
const assignRoles = vi.fn(() => Promise.resolve({}));
const listarRoles = vi.fn();

vi.mock("../src/api/empresasService", () => ({
  empresasService: { list: (...args) => list(...args) },
}));

vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: (...args) => listarRoles(...args) },
}));

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    get: (...args) => get(...args),
    assignEmpresas: (...args) => assignEmpresas(...args),
    assignRoles: (...args) => assignRoles(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { AsignacionEmpresas } =
  await import("../src/pages/Admin/Empresas/AsignacionEmpresas");

describe("Asignación de empresas y roles a un usuario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.clear();
    permisos.add("empresas.ver");
    permisos.add("empresas.asignar");
    permisos.add("usuarios.editar");
    list.mockResolvedValue({ results: [COURIER, SEGURIDAD] });
    listarRoles.mockResolvedValue(ROLES);
    get.mockResolvedValue({
      roles: [],
      empresas: [
        {
          id: 1,
          nombre: "LaarCourier",
          es_predeterminada: true,
          roles: [{ id: 10, name: "Soporte TI" }],
        },
      ],
    });
  });

  it("marca las empresas del usuario y el rol que tiene en cada una", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByRole("checkbox", { name: "Asignar LaarCourier" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText("Soporte TI", { selector: "#rol-1-10" }),
    ).toBeChecked();
  });

  // AC-EMP-018: el mismo usuario, distinto poder en cada empresa.
  it("guarda un rol distinto por empresa", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    );
    fireEvent.click(
      screen.getByLabelText("Solo consulta", { selector: "#rol-2-11" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Guardar empresas y roles/ }),
    );

    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [10], es_predeterminada: true },
        { empresa_id: 2, roles: [11], es_predeterminada: false },
      ]),
    );
  });

  it("los roles de una empresa no asignada no se pueden tocar", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByLabelText("Soporte TI", { selector: "#rol-2-10" }),
    ).toBeDisabled();
  });

  it("al superusuario no le avisa: se salta los permisos", async () => {
    get.mockResolvedValue({ roles: [], is_superuser: true, empresas: [] });

    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    );

    expect(screen.queryByText(/Sin rol aquí/)).not.toBeInTheDocument();
  });

  it("avisa si una empresa queda asignada sin ningún rol", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    );

    expect(await screen.findByText(/Sin rol aquí/)).toBeInTheDocument();
  });

  it("los roles globales se guardan por su propio camino", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByLabelText("Soporte TI", {
        selector: "#rol-global-10",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Guardar empresas y roles/ }),
    );

    await waitFor(() => expect(assignRoles).toHaveBeenCalledWith("7", [10]));
  });

  // AC-EMP-010: ver a quién se asignó qué no es poder cambiarlo.
  it("sin el permiso de asignar, muestra pero no deja tocar las empresas", async () => {
    permisos.delete("empresas.asignar");
    permisos.delete("usuarios.editar");

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByRole("checkbox", { name: "Asignar LaarCourier" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Guardar empresas y roles/ }),
    ).not.toBeInTheDocument();
  });

  it("sin el permiso de ver empresas no dibuja nada", async () => {
    permisos.clear();

    const { container } = render(<AsignacionEmpresas usuarioId="7" />);

    expect(container).toBeEmptyDOMElement();
    expect(list).not.toHaveBeenCalled();
  });

  // Sin `roles.ver` el catálogo no se lee, pero las empresas sí se asignan.
  it("se degrada la columna de roles si no se puede leer el catálogo", async () => {
    listarRoles.mockRejectedValue(new Error("403"));

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByText(/No se pudo leer el catálogo de roles/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Asignar LaarCourier" }),
    ).toBeEnabled();
  });

  // AC-EMP-017: con una sola empresa la asignación todavía no decide nada.
  it("avisa de que con una sola empresa la asignación no decide", async () => {
    list.mockResolvedValue({ results: [COURIER] });

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(await screen.findByText(/Hay una sola empresa/)).toBeInTheDocument();
  });
});
