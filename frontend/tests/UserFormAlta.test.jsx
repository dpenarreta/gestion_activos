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
    // US-018: la tarjeta «Mientras no está» de la ficha.
    reemplazo: () =>
      Promise.resolve({
        modo: "jefe",
        persona: null,
        jefe: null,
        ausencia: null,
      }),
    guardarReemplazo: () => Promise.resolve({}),
  },
}));

vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => "3",
}));

// La ficha avisa al salir con cambios sin guardar (auditoría UX/UI, fase 2).
const marcarSinGuardar = vi.fn();
vi.mock("../src/context/UnsavedChangesContext", () => ({
  useUnsavedChanges: () => ({
    setIsDirty: marcarSinGuardar,
    guardedNavigate: vi.fn(),
  }),
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

// El desplegable de rol existe desde el principio, deshabilitado mientras
// cargan los roles: se espera a que tenga opciones antes de elegir.
async function rolListo() {
  await screen.findByRole("option", { name: "Soporte TI" });
  return screen.getByLabelText(/^Rol/);
}

function rellenarDatosMinimos() {
  fireEvent.change(screen.getByLabelText(/^Nombres/), {
    target: { value: "Nueva" },
  });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), {
    target: { value: "Peñarreta" },
  });
  fireEvent.change(screen.getByLabelText(/^Correo/), {
    target: { value: "nueva@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/Contraseña inicial/), {
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

    const rol = await screen.findByLabelText(/^Rol/);
    expect(
      screen.getByRole("option", { name: "Soporte TI" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Solo consulta" }),
    ).toBeInTheDocument();
    // Nace vacío a propósito: elegir es una decisión, no un valor por defecto.
    expect(rol).toHaveValue("");
  });

  /* Los de cargo eran la mayoría del catálogo y el servidor los descarta si
     se envían a mano: no se ofrecen, y el resto va por orden alfabético
     (06/11/2026). */
  it("ofrece los roles por orden alfabético y sin los de cargo", async () => {
    listarRoles.mockResolvedValue([
      ...ROLES,
      {
        id: 30,
        name: "Jefe de bodega",
        cargo: { id: 4, nombre: "Jefe de bodega", empresa: "LaarSeguridad" },
      },
      { id: 12, name: "Auditor" },
    ]);
    pintar();

    const rol = await screen.findByLabelText(/^Rol/);
    await waitFor(() =>
      expect(
        [...rol.querySelectorAll("option")].map((o) => o.textContent),
      ).toEqual([
        "Seleccione un rol",
        "Auditor",
        "Solo consulta",
        "Soporte TI",
      ]),
    );
  });

  // Dar de alta a alguien es, casi siempre, darlo de alta donde uno está.
  it("propone la empresa en la que se está trabajando", async () => {
    pintar();

    expect(await screen.findByLabelText(/^Empresa/)).toHaveValue("3");
  });

  it("crea la cuenta ya dentro de su empresa y con su rol", async () => {
    pintar();

    fireEvent.change(await rolListo(), {
      target: { value: "10" },
    });
    rellenarDatosMinimos();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Nueva",
          last_name: "Peñarreta",
          empresas: [{ empresa_id: 3, roles: [10], es_predeterminada: true }],
        }),
      ),
    );
  });

  it("con una sola empresa no pregunta cuál, solo el rol", async () => {
    listarEmpresas.mockResolvedValue({ results: [COURIER] });

    pintar();

    expect(await screen.findByLabelText(/^Rol/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Empresa/)).not.toBeInTheDocument();
  });

  // Crear una cuenta y decidir qué información ve son dos poderes distintos.
  it("sin el permiso de asignar no se pregunta empresa ni rol", async () => {
    permisos.clear();

    pintar();
    rellenarDatosMinimos();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].empresas).toBeUndefined();
    expect(listarEmpresas).not.toHaveBeenCalled();
  });

  // El nombre de usuario ya no se escribe: sale del nombre de la persona.
  it("muestra el nombre de usuario que le va a tocar, sin tildes ni eñes", async () => {
    pintar();

    fireEvent.change(await screen.findByLabelText(/^Nombres/), {
      target: { value: "Diego" },
    });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), {
      target: { value: "Peñarreta" },
    });

    const usuario = screen.getByLabelText("Nombre de usuario");
    expect(usuario).toHaveValue("dpenarreta");
    expect(usuario).toHaveAttribute("readonly");
  });

  it("no manda el nombre de usuario: lo compone el backend", async () => {
    pintar();

    fireEvent.change(await rolListo(), {
      target: { value: "10" },
    });
    rellenarDatosMinimos();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].username).toBeUndefined();
  });

  /* Sin la burbuja del navegador: el error va bajo el campo, como el resto
     del formulario, y el foco a él (auditoría UX/UI, 06/11/2026). */
  it("sin rol no crea la cuenta: marca el campo y lo enfoca", async () => {
    pintar();

    const rol = await screen.findByLabelText(/^Rol/);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Empresa/)).toHaveValue("3"),
    );
    expect(rol).not.toHaveAttribute("required");
    expect(rol).toHaveAttribute("aria-required", "true");
    rellenarDatosMinimos();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(
      await screen.findByText("Elija el rol con el que entra esta persona."),
    ).toBeInTheDocument();
    expect(rol).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(rol).toHaveFocus());
    expect(crear).not.toHaveBeenCalled();

    fireEvent.change(rol, { target: { value: "10" } });
    expect(
      screen.queryByText("Elija el rol con el que entra esta persona."),
    ).not.toBeInTheDocument();
  });

  it("volver a «Seleccione un rol» deja la cuenta sin rol, no con el 0", async () => {
    pintar();

    const rol = await rolListo();
    fireEvent.change(rol, { target: { value: "10" } });
    fireEvent.change(rol, { target: { value: "" } });
    rellenarDatosMinimos();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(
      await screen.findByText("Elija el rol con el que entra esta persona."),
    ).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  // Auditoría UX/UI, 06/11/2026: durante la carga decía «No hay roles».
  it("mientras cargan los roles lo dice, sin el falso «No hay roles»", async () => {
    listarRoles.mockReturnValue(new Promise(() => {}));
    pintar();

    const rol = await screen.findByLabelText(/^Rol/);
    expect(rol).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "Cargando roles…" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No hay roles creados/)).not.toBeInTheDocument();
  });

  it("sin roles creados, una vez cargado, lo avisa", async () => {
    listarRoles.mockResolvedValue([]);
    pintar();

    expect(
      await screen.findByText(/No hay roles creados todavía/),
    ).toBeInTheDocument();
  });

  /* La empresa la propone el sistema: abrir el alta y salir sin tocar nada
     no pide confirmación (auditoría UX/UI, 06/11/2026). */
  it("la empresa propuesta no cuenta como cambio sin guardar; el rol sí", async () => {
    pintar();

    const rol = await rolListo();
    expect(screen.getByLabelText(/^Empresa/)).toHaveValue("3");
    expect(marcarSinGuardar).toHaveBeenLastCalledWith(false);

    fireEvent.change(rol, { target: { value: "10" } });
    expect(marcarSinGuardar).toHaveBeenLastCalledWith(true);
  });

  it("cambiar a otra empresa sí cuenta como cambio sin guardar", async () => {
    pintar();

    await rolListo();
    fireEvent.change(screen.getByLabelText(/^Empresa/), {
      target: { value: "1" },
    });
    expect(marcarSinGuardar).toHaveBeenLastCalledWith(true);
  });

  it("valida todos los obligatorios a la vez y enfoca el primero", async () => {
    pintar();

    await rolListo();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(await screen.findByText("Escriba los nombres.")).toBeInTheDocument();
    expect(screen.getByText("Escriba los apellidos.")).toBeInTheDocument();
    expect(screen.getByText("Escriba el correo.")).toBeInTheDocument();
    expect(
      screen.getByText("Elija el rol con el que entra esta persona."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/^Nombres/)).toHaveFocus(),
    );
    expect(crear).not.toHaveBeenCalled();
  });

  it("con una sola empresa no repite el título «Rol» sobre la etiqueta", async () => {
    listarEmpresas.mockResolvedValue({ results: [COURIER] });
    pintar();

    await screen.findByLabelText(/^Rol/);
    expect(
      screen.queryByRole("heading", { name: "Rol" }),
    ).not.toBeInTheDocument();
  });
});
