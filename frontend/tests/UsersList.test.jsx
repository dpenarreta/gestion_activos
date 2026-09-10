import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El listado de cuentas.
 *
 * La columna que hace el trabajo es la de empresas: dice a qué organización
 * pertenece cada cuenta y qué rol tiene en cada una. Es la primera pregunta al
 * revisar por qué alguien no ve una pantalla, y abrir ficha por ficha vuelve
 * impracticable esa revisión. Los roles globales van aparte y con el adjetivo
 * puesto: sin él, un guion ahí se leería como que la cuenta no tiene ningún
 * rol en ninguna parte.
 */

const listar = vi.fn();
const deshabilitar = vi.fn();
const habilitar = vi.fn();

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    list: (...args) => listar(...args),
    disable: (...args) => deshabilitar(...args),
    enable: (...args) => habilitar(...args),
  },
}));

const { UsersList } = await import("../src/pages/Admin/Users/UsersList");

const USUARIOS = [
  {
    id: 1,
    username: "acevallos",
    email: "ana@example.com",
    status: "active",
    is_superuser: false,
    roles: [],
    empresas: [
      {
        id: 1,
        nombre: "LaarCourier",
        es_predeterminada: true,
        roles: [{ id: 1, name: "Técnico de TI" }],
      },
      {
        id: 2,
        nombre: "LaarSeguridad",
        es_predeterminada: false,
        roles: [],
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    username: "dpenarreta",
    email: "d@example.com",
    status: "blocked",
    is_superuser: true,
    roles: [{ id: 9, name: "Administrador" }],
    empresas: [],
    created_at: "2026-02-01T00:00:00Z",
  },
];

function pintar() {
  return render(
    <MemoryRouter>
      <UsersList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listar.mockResolvedValue({
    results: USUARIOS,
    count: 2,
    next: null,
    previous: null,
  });
  deshabilitar.mockResolvedValue({});
  habilitar.mockResolvedValue({});
});

describe("El listado de usuarios", () => {
  it("lista las cuentas con su correo y su estado", async () => {
    pintar();

    const fila = (await screen.findByText("acevallos")).closest("tr");
    expect(fila).toHaveTextContent("ana@example.com");
    expect(fila).toHaveTextContent("Activo");
  });

  it("dice en qué empresas trabaja cada cuenta y con qué rol", async () => {
    pintar();

    const fila = (await screen.findByText("acevallos")).closest("tr");
    expect(fila).toHaveTextContent("LaarCourier");
    expect(fila).toHaveTextContent("Técnico de TI");
    expect(fila).toHaveTextContent("Predeterminada");
  });

  it("una empresa sin rol asignado se dice, no se deja en blanco", async () => {
    /* Estar en la empresa sin ningún rol es un estado real y la causa más
       común de «entro pero no veo nada»; en blanco parecería un dato que
       falta por cargar. */
    pintar();

    const fila = (await screen.findByText("acevallos")).closest("tr");
    expect(fila).toHaveTextContent("Sin rol");
  });

  it("una cuenta sin ninguna empresa se distingue de una sin roles", async () => {
    pintar();

    const fila = (await screen.findByText("dpenarreta")).closest("tr");
    expect(fila).toHaveTextContent("Administrador");
    expect(fila).toHaveTextContent("—");
  });

  it("marca a los administradores del sistema", async () => {
    pintar();

    const fila = (await screen.findByText("dpenarreta")).closest("tr");
    expect(fila).toHaveTextContent("Administrador");
  });

  it("mantiene el breadcrumb Administración > Usuarios", async () => {
    pintar();

    await screen.findByText("acevallos");
    expect(screen.getByText("Administración")).toBeInTheDocument();
    expect(screen.getAllByText("Usuarios").length).toBeGreaterThan(0);
  });

  it("la búsqueda se envía al confirmar, no en cada tecla", async () => {
    pintar();

    await screen.findByText("acevallos");
    const campo = screen.getByPlaceholderText(
      "Buscar por nombre, correo o usuario",
    );
    fireEvent.change(campo, { target: { value: "ana" } });
    expect(listar).toHaveBeenCalledTimes(1);

    fireEvent.submit(campo.closest("form"));

    await waitFor(() =>
      expect(listar.mock.calls.at(-1)[0]).toMatchObject({ q: "ana" }),
    );
  });

  it("filtrar por estado vuelve a consultar", async () => {
    pintar();

    await screen.findByText("acevallos");
    fireEvent.change(screen.getByDisplayValue("Todos los estados"), {
      target: { value: "blocked" },
    });

    await waitFor(() =>
      expect(listar.mock.calls.at(-1)[0]).toMatchObject({ status: "blocked" }),
    );
  });

  it("cada cuenta ofrece la acción que le toca según su estado", async () => {
    /* A una cuenta bloqueada se le ofrece habilitar y a una activa,
       deshabilitar: el mismo botón para las dos obligaría a leer el estado
       antes de cada clic. */
    pintar();

    const activa = (await screen.findByText("acevallos")).closest("tr");
    expect(activa).toHaveTextContent("Deshabilitar");
    expect(activa).not.toHaveTextContent("Habilitar");

    const bloqueada = screen.getByText("dpenarreta").closest("tr");
    expect(bloqueada).toHaveTextContent("Habilitar");
  });

  it("deshabilitar rehace el listado, para que el estado no quede viejo", async () => {
    pintar();

    await screen.findByText("acevallos");
    fireEvent.click(screen.getByRole("button", { name: "Deshabilitar" }));

    await waitFor(() => expect(deshabilitar).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("si la acción se rechaza, lo dice con el motivo del servidor", async () => {
    deshabilitar.mockRejectedValue({
      response: {
        data: { error: { message: "No puede deshabilitarse a sí mismo." } },
      },
    });

    pintar();

    await screen.findByText("acevallos");
    fireEvent.click(screen.getByRole("button", { name: "Deshabilitar" }));

    expect(
      await screen.findByText("No puede deshabilitarse a sí mismo."),
    ).toBeInTheDocument();
  });

  it("sin resultados lo dice", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });

    pintar();

    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
  });

  it("si el listado falla lo dice", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el listado de usuarios."),
    ).toBeInTheDocument();
  });

  it("la paginación solo se ofrece cuando hay a dónde ir", async () => {
    pintar();

    await screen.findByText("acevallos");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

  it("con más páginas, pasar de una pide la siguiente", async () => {
    listar.mockResolvedValue({
      results: USUARIOS,
      count: 40,
      next: "http://api/next",
      previous: null,
    });

    pintar();

    await screen.findByText("acevallos");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() =>
      expect(listar.mock.calls.at(-1)[0]).toMatchObject({ page: 2 }),
    );
  });
});
