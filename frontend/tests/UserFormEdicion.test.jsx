import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La ficha de una cuenta ya creada.
 *
 * Lo que cambia respecto del alta es lo que ya no se puede tocar: el nombre de
 * usuario se compuso al crearla y es con lo que la persona entra y con lo que
 * aparece en la auditoría, así que cambiarlo rompería el rastro. Y la
 * contraseña no se edita: se restablece, con acciones que expulsan sesiones y
 * mandan correos, de modo que se piden explícitamente y se confirman.
 */

const obtener = vi.fn();
const actualizar = vi.fn();
const crear = vi.fn();
const restablecer = vi.fn();
const asignarEmpresas = vi.fn();
const asignarRoles = vi.fn();
const listarEmpresas = vi.fn();
const listarRoles = vi.fn();

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    get: (...args) => obtener(...args),
    update: (...args) => actualizar(...args),
    create: (...args) => crear(...args),
    resetPassword: (...args) => restablecer(...args),
    assignEmpresas: (...args) => asignarEmpresas(...args),
    assignRoles: (...args) => asignarRoles(...args),
  },
}));

vi.mock("../src/api/empresasService", () => ({
  empresasService: { list: (...args) => listarEmpresas(...args) },
}));

vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: (...args) => listarRoles(...args) },
}));

vi.mock("../src/api/client", () => ({ getEmpresaActiva: () => "1" }));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { UserForm } = await import("../src/pages/Admin/Users/UserForm");

const USUARIO = {
  id: 7,
  username: "acevallos",
  email: "ana@example.com",
  first_name: "Ana",
  last_name: "Cevallos",
  empresas: [],
  roles: [],
  is_superuser: false,
};

function pintar() {
  return render(
    <MemoryRouter initialEntries={["/admin/users/7"]}>
      <Routes>
        <Route path="/admin/users/:id" element={<UserForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Marca una opción de restablecimiento y confirma el diálogo. */
async function ejecutarRestablecimiento(etiqueta) {
  fireEvent.click(screen.getByLabelText(etiqueta));
  fireEvent.click(screen.getByRole("button", { name: "Ejecutar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  obtener.mockResolvedValue(USUARIO);
  actualizar.mockResolvedValue(USUARIO);
  restablecer.mockResolvedValue({});
  listarEmpresas.mockResolvedValue({ results: [] });
  listarRoles.mockResolvedValue([]);
});

describe("Editar una cuenta", () => {
  it("carga lo registrado", async () => {
    pintar();

    expect(await screen.findByText("Editar usuario")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Nombres")).toHaveValue("Ana"),
    );
    expect(screen.getByLabelText("Correo")).toHaveValue("ana@example.com");
  });

  it("el nombre de usuario no cambia, y explica por qué", async () => {
    /* Es con lo que entra y con lo que aparece en la auditoría: cambiarlo
       rompería el rastro de lo que esa cuenta hizo. */
    pintar();

    await screen.findByText("Editar usuario");
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre de usuario")).toHaveValue(
        "acevallos",
      ),
    );
    expect(screen.getByLabelText("Nombre de usuario")).toHaveAttribute(
      "readonly",
    );
    expect(
      screen.getByText(/con lo que aparece en la auditoría/),
    ).toBeInTheDocument();
  });

  it("cambiar el nombre de la persona no renombra la cuenta", async () => {
    /* Un apellido corregido no debe arrastrar el usuario: la propuesta
       automática es solo del alta. */
    pintar();

    await screen.findByText("Editar usuario");
    await waitFor(() =>
      expect(screen.getByLabelText("Nombres")).toHaveValue("Ana"),
    );
    fireEvent.change(screen.getByLabelText("Apellidos"), {
      target: { value: "Cevallos Ruiz" },
    });

    expect(screen.getByLabelText("Nombre de usuario")).toHaveValue("acevallos");
  });

  it("la contraseña no se edita aquí", async () => {
    pintar();

    await screen.findByText("Editar usuario");
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });

  it("guardar actualiza la cuenta abierta, sin crear otra", async () => {
    pintar();

    await screen.findByText("Editar usuario");
    await waitFor(() =>
      expect(screen.getByLabelText("Nombres")).toHaveValue("Ana"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][0]).toBe("7");
    expect(crear).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza el cambio, lo dice con el detalle", async () => {
    /* «Correo ya registrado» dice qué corregir; «no se pudo guardar», no. */
    actualizar.mockRejectedValue({
      response: {
        data: { error: { details: { email: ["Ya está registrado."] } } },
      },
    });

    pintar();

    await screen.findByText("Editar usuario");
    await waitFor(() =>
      expect(screen.getByLabelText("Nombres")).toHaveValue("Ana"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/Ya está registrado/)).toBeInTheDocument();
  });

  it("si la cuenta no carga lo dice", async () => {
    obtener.mockRejectedValue(new Error("404"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el usuario."),
    ).toBeInTheDocument();
  });
});

describe("Restablecer la contraseña de otra persona", () => {
  it("sin el permiso no se ofrece", async () => {
    pintar();

    await screen.findByText("Editar usuario");
    expect(
      screen.queryByText("Restablecer contraseña"),
    ).not.toBeInTheDocument();
  });

  it("sin elegir ninguna opción no se puede ejecutar", async () => {
    /* Ejecutar sin opciones no haría nada y parecería que sí. */
    permisos.add("usuarios.restablecer_password");

    pintar();

    await screen.findByText("Restablecer contraseña");
    expect(screen.getByRole("button", { name: "Ejecutar" })).toBeDisabled();
  });

  it("pregunta antes: las tres acciones son irreversibles", async () => {
    permisos.add("usuarios.restablecer_password");

    pintar();

    await screen.findByText("Restablecer contraseña");
    fireEvent.click(screen.getByLabelText("Cerrar sesiones activas"));
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar" }));

    expect(
      await screen.findByText(/Esta acción no puede deshacerse/),
    ).toBeInTheDocument();
    expect(restablecer).not.toHaveBeenCalled();
  });

  it("confirmada, se manda solo lo que se marcó", async () => {
    permisos.add("usuarios.restablecer_password");

    pintar();

    await screen.findByText("Restablecer contraseña");
    await ejecutarRestablecimiento(
      "Forzar cambio de contraseña en el próximo inicio de sesión",
    );

    await waitFor(() => expect(restablecer).toHaveBeenCalled());
    expect(restablecer.mock.calls[0][1]).toEqual({
      send_link: false,
      force_change_on_next_login: true,
      revoke_sessions: false,
    });
  });

  it("ejecutada, lo confirma y desmarca las casillas", async () => {
    /* Dejarlas marcadas invitaría a ejecutar dos veces lo mismo. */
    permisos.add("usuarios.restablecer_password");

    pintar();

    await screen.findByText("Restablecer contraseña");
    await ejecutarRestablecimiento("Cerrar sesiones activas");

    expect(
      await screen.findByText("La acción se ejecutó correctamente."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Cerrar sesiones activas")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Ejecutar" })).toBeDisabled();
  });

  it("si falla, lo dice con el motivo del servidor", async () => {
    permisos.add("usuarios.restablecer_password");
    restablecer.mockRejectedValue({
      response: {
        data: { error: { message: "El correo del usuario está vacío." } },
      },
    });

    pintar();

    await screen.findByText("Restablecer contraseña");
    await ejecutarRestablecimiento(
      "Enviar enlace de restablecimiento por correo",
    );

    expect(
      await screen.findByText("El correo del usuario está vacío."),
    ).toBeInTheDocument();
  });
});
