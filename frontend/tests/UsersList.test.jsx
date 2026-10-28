import {
  within,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Con varias empresas la columna dice cuál; con una sola, solo los roles.
const modo = { multiempresa: true };
vi.mock("../src/api/empresasService", () => ({
  empresasService: {
    mias: () => Promise.resolve({ empresas: [], activa: null, ...modo }),
  },
}));

// Crear y deshabilitar piden su permiso: aquí, quien administra las cuentas.
vi.mock("../src/hooks/usePermission", () => ({ usePermission: () => true }));

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
    last_login: "2026-03-04T15:30:00Z",
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
    last_login: null,
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

  it("dice cuándo entró cada cuenta por última vez", async () => {
    pintar();

    const fila = (await screen.findByText("acevallos")).closest("tr");
    /* El día exacto no se afirma porque depende del huso del navegador que
       corra la prueba; lo que importa es que sale la fecha de la conexión
       —no la de creación, que es de enero— y que lleva la hora: dos cuentas
       que entraron el mismo día no son el mismo dato cuando se revisa qué
       pasó esta mañana. */
    expect(fila.textContent).toMatch(/\d{2}\/\d{2}\/2026,? \d{2}:\d{2}/);
  });

  it("la cuenta que nunca entró lo dice, en vez de dejarlo en blanco", async () => {
    /* Un guion se lee como un dato que falta por cargar. Aquí no falta nada:
       esa cuenta existe y no ha entrado jamás, que es lo que hay que ver. */
    pintar();

    const fila = (await screen.findByText("dpenarreta")).closest("tr");
    expect(fila).toHaveTextContent("Nunca");
  });

  it("dice en qué empresas trabaja cada cuenta y con qué rol", async () => {
    pintar();

    const fila = (await screen.findByText("acevallos")).closest("tr");
    await waitFor(() => expect(fila).toHaveTextContent("LaarCourier"));
    expect(fila).toHaveTextContent("Técnico de TI");
    expect(fila).toHaveTextContent("Predeterminada");
  });

  it("con una sola empresa la columna son los roles, sin la empresa", async () => {
    modo.multiempresa = false;
    try {
      pintar();
      const fila = (await screen.findByText("acevallos")).closest("tr");
      expect(fila).toHaveTextContent("Técnico de TI");
      expect(fila).not.toHaveTextContent("LaarCourier");
      expect(
        screen.getByRole("columnheader", { name: "Roles" }),
      ).toBeInTheDocument();
    } finally {
      modo.multiempresa = true;
    }
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

  it("marca al superusuario una sola vez", async () => {
    /* Llevaba «Administrador» junto al nombre y «Superusuario (cuenta)» en
       los roles globales: dos marcas para lo mismo (auditoría UX/UI, fase 2). */
    pintar();

    const fila = (await screen.findByText("dpenarreta")).closest("tr");
    expect(within(fila).getAllByText(/Superusuario/)).toHaveLength(1);
    expect(fila.querySelector("td").textContent).toBe("dpenarreta");
  });

  it("cada «Editar» dice de quién es", async () => {
    pintar();

    expect(
      await screen.findByRole("link", { name: "Editar acevallos" }),
    ).toHaveAttribute("href", "/admin/users/1");
  });

  it("el superusuario se marca como tal aunque no tenga roles", async () => {
    /* Es una marca de la cuenta, no un rol: sin la etiqueta parecería una
       cuenta sin permisos. */
    pintar();
    const fila = (await screen.findByText("dpenarreta")).closest("tr");
    expect(fila).toHaveTextContent("Superusuario (cuenta)");
    const otra = screen.getByText("acevallos").closest("tr");
    expect(otra).not.toHaveTextContent("Superusuario");
  });

  it("abre con su encabezado y sin migas de pan", async () => {
    /* La barra superior y el menú ya dicen dónde se está: las migas de pan
       repetían «Administración > Usuarios» encima del título. */
    pintar();

    await screen.findByText("acevallos");
    expect(
      screen.getByRole("heading", { level: 2, name: "Usuarios" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Administración")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /^Deshabilitar a / }));
    // Deshabilitar pide confirmación con el nombre de la persona.
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: /Deshabilitar a acevallos/ }),
      ).getByRole("button", { name: "Deshabilitar" }),
    );

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
    fireEvent.click(screen.getByRole("button", { name: /^Deshabilitar a / }));
    // Deshabilitar pide confirmación con el nombre de la persona.
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: /Deshabilitar a acevallos/ }),
      ).getByRole("button", { name: "Deshabilitar" }),
    );

    expect(
      await screen.findByText("No puede deshabilitarse a sí mismo."),
    ).toBeInTheDocument();
  });

  it("sin cuentas lo dice", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });

    pintar();

    expect(
      await screen.findByText("Todavía no hay usuarios registrados."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Limpiar filtros" }),
    ).not.toBeInTheDocument();
  });

  it("si el filtro no encuentra nada, lo distingue y deja limpiarlo", async () => {
    pintar();

    await screen.findByText("acevallos");
    listar.mockResolvedValue({ results: [], count: 0 });
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
      target: { value: "disabled" },
    });

    expect(
      await screen.findByText("Ningún resultado con estos filtros."),
    ).toBeInTheDocument();

    listar.mockResolvedValue({ results: USUARIOS, count: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    expect(await screen.findByText("acevallos")).toBeInTheDocument();
    expect(listar.mock.calls.at(-1)[0]).not.toHaveProperty("status");
  });

  it("si el listado falla lo dice", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el listado de usuarios."),
    ).toBeInTheDocument();
    // Se puede reintentar sin recargar la página.
    listar.mockResolvedValue({ results: USUARIOS, count: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("acevallos")).toBeInTheDocument();
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

/*
 * En el teléfono (auditoría UX/UI, fase 3, 28/10/2026): ocho columnas a
 * 375 px solo se leían desplazándose de lado. Cada cuenta va en una tarjeta
 * con sus datos clave y sus acciones.
 */
describe("En el teléfono", () => {
  const original = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn((consulta) => ({
      matches: consulta.includes("max-width: 880px"),
      media: consulta,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = original;
  });

  it("cada cuenta es una tarjeta con su estado y sus acciones", async () => {
    pintar();

    const lista = await screen.findByRole("list", { name: "Usuarios" });
    const tarjetas = within(lista).getAllByRole("listitem");
    expect(tarjetas).toHaveLength(2);

    const primera = tarjetas[0];
    expect(within(primera).getByText("acevallos")).toBeInTheDocument();
    expect(within(primera).getByText("Activo")).toBeInTheDocument();
    expect(
      within(primera).getByText("LaarCourier: Técnico de TI"),
    ).toBeInTheDocument();
    expect(
      within(primera).getByRole("link", { name: "Editar acevallos" }),
    ).toHaveAttribute("href", "/admin/users/1");
    expect(
      within(primera).getByRole("button", { name: /^Deshabilitar a / }),
    ).toBeInTheDocument();

    expect(
      within(tarjetas[1]).getByText("Nunca se ha conectado"),
    ).toBeInTheDocument();
    expect(
      within(tarjetas[1]).getByRole("button", { name: /^Habilitar a / }),
    ).toBeInTheDocument();
  });

  it("sin cuentas, el aviso se ve también fuera de la tabla", async () => {
    listar.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar();

    // Una en la tabla (oculta por CSS en el teléfono) y otra sobre las
    // tarjetas.
    expect(
      await screen.findAllByText("Todavía no hay usuarios registrados."),
    ).toHaveLength(2);
    expect(screen.queryByRole("list", { name: "Usuarios" })).toBeNull();
  });
});
