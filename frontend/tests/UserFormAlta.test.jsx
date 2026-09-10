import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COURIER = { id: 1, nombre: "LaarCourier", codigo: "LC", activa: true };
const SEGURIDAD = {
  id: 3,
  nombre: "LaarSeguridad",
  codigo: "LS",
  activa: true,
};
const ROLES = [
  { id: 10, name: "Soporte TI" },
  { id: 11, name: "Solo consulta" },
];

const listarEmpresas = vi.fn();
const listarRoles = vi.fn();
const crear = vi.fn(() => Promise.resolve({ id: 7 }));

vi.mock("../src/api/empresasService", () => ({
  empresasService: { list: (...args) => listarEmpresas(...args) },
}));

vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: (...args) => listarRoles(...args) },
}));

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    create: (...args) => crear(...args),
    get: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => "3",
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { UserForm } = await import("../src/pages/Admin/Users/UserForm");

function pintar() {
  return render(
    <MemoryRouter>
      <UserForm />
    </MemoryRouter>,
  );
}

function rellenarDatosMinimos() {
  fireEvent.change(screen.getByLabelText("Nombre de usuario"), {
    target: { value: "nueva" },
  });
  fireEvent.change(screen.getByLabelText("Correo"), {
    target: { value: "nueva@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: "Sup3r-Secr3t!" },
  });
}

describe("Alta de usuario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.clear();
    permisos.add("empresas.asignar");
    listarEmpresas.mockResolvedValue({ results: [COURIER, SEGURIDAD] });
    listarRoles.mockResolvedValue(ROLES);
  });

  it("ofrece un desplegable con los roles que se pueden asignar", async () => {
    pintar();

    const rol = await screen.findByLabelText("Rol");
    expect(
      screen.getByRole("option", { name: "Soporte TI" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Solo consulta" }),
    ).toBeInTheDocument();
    // Nace vacío a propósito: elegir es una decisión, no un valor por defecto.
    expect(rol).toHaveValue("");
  });

  // Dar de alta a alguien es, casi siempre, darlo de alta donde uno está.
  it("propone la empresa en la que se está trabajando", async () => {
    pintar();

    expect(await screen.findByLabelText("Empresa")).toHaveValue("3");
  });

  it("crea la cuenta ya dentro de su empresa y con su rol", async () => {
    pintar();

    fireEvent.change(await screen.findByLabelText("Rol"), {
      target: { value: "10" },
    });
    rellenarDatosMinimos();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "nueva",
          empresas: [{ empresa_id: 3, roles: [10], es_predeterminada: true }],
        }),
      ),
    );
  });

  it("con una sola empresa no pregunta cuál, solo el rol", async () => {
    listarEmpresas.mockResolvedValue({ results: [COURIER] });

    pintar();

    expect(await screen.findByLabelText("Rol")).toBeInTheDocument();
    expect(screen.queryByLabelText("Empresa")).not.toBeInTheDocument();
  });

  // Crear una cuenta y decidir qué información ve son dos poderes distintos.
  it("sin el permiso de asignar no se pregunta empresa ni rol", async () => {
    permisos.clear();

    pintar();
    rellenarDatosMinimos();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].empresas).toBeUndefined();
    expect(listarEmpresas).not.toHaveBeenCalled();
  });
});
