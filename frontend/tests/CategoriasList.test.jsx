import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El catálogo de categorías.
 *
 * La categoría es la naturaleza de lo que se inventaría —hardware, software,
 * mobiliario— y vive un nivel por encima del tipo. Lo que se prueba es que se
 * administre de verdad: que se puedan crear las propias, que desactivar no
 * borre y que el conteo de tipos lleve al inventario de esa categoría, que es
 * la pregunta que trae a esta pantalla.
 */

const listar = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();
const permisos = new Set();

vi.mock("../src/api/activosService", () => ({
  categoriasActivoService: {
    list: (...args) => listar(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
  },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { CategoriasList } =
  await import("../src/pages/Admin/Activos/CategoriasList");

const CATEGORIAS = [
  {
    id: 10,
    nombre: "Hardware",
    descripcion: "Equipos físicos",
    icono: "pc-display",
    activa: true,
    total_tipos: 4,
  },
  {
    id: 11,
    nombre: "Software",
    descripcion: "Licencias y suscripciones",
    icono: "",
    activa: true,
    total_tipos: 0,
  },
];

function pintar() {
  return render(
    <MemoryRouter>
      <CategoriasList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listar.mockResolvedValue({
    results: CATEGORIAS,
    count: 2,
    next: null,
    previous: null,
  });
  crear.mockResolvedValue({});
  actualizar.mockResolvedValue({});
});

describe("El catálogo de categorías", () => {
  it("lista cada categoría con lo que entra en ella", async () => {
    pintar();

    const fila = (await screen.findByText("Software")).closest("tr");
    expect(fila).toHaveTextContent("Licencias y suscripciones");
    expect(fila).toHaveTextContent("Activa");
  });

  it("el conteo de tipos lleva al inventario de esa categoría", async () => {
    /* Es la pregunta que trae aquí: cuánto hay de esto. Verlo sin poder
       abrirlo obligaría a repetir el filtro a mano. */
    pintar();

    const enlace = await screen.findByRole("link", { name: "4" });
    expect(enlace).toHaveAttribute("href", "/admin/activos?categoria=10");
  });

  it("una categoría sin tipos no ofrece enlace a ninguna parte", async () => {
    pintar();

    const fila = (await screen.findByText("Software")).closest("tr");
    expect(fila).toHaveTextContent("0");
    expect(within(fila).queryByRole("link")).not.toBeInTheDocument();
  });

  it("quien no edita no puede crear ni modificar", async () => {
    pintar();
    await screen.findByText("Hardware");

    expect(
      screen.queryByRole("button", { name: "Nueva categoría" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
  });

  it("se crea una categoría propia: eso es poder personalizarlo", async () => {
    permisos.add("activos.editar");
    pintar();
    await screen.findByText("Hardware");

    fireEvent.click(screen.getByRole("button", { name: "Nueva categoría" }));
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Vehículos" },
    });
    fireEvent.change(screen.getByLabelText("Qué entra aquí"), {
      target: { value: "Flota propia" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));

    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: "Vehículos",
          descripcion: "Flota propia",
        }),
      ),
    );
  });

  it("al crear no se ofrece desactivar: aún no existe nada que desactivar", async () => {
    permisos.add("activos.editar");
    pintar();
    await screen.findByText("Hardware");

    fireEvent.click(screen.getByRole("button", { name: "Nueva categoría" }));

    expect(screen.queryByLabelText("Activa")).not.toBeInTheDocument();
  });

  it("desactivar una categoría no la borra", async () => {
    /* Los tipos la referencian: se deja de ofrecer, y los que ya la tienen la
       conservan. */
    permisos.add("activos.editar");
    pintar();
    await screen.findByText("Hardware");

    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    fireEvent.click(screen.getByLabelText("Activa"));
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));

    await waitFor(() =>
      expect(actualizar).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ activa: false }),
      ),
    );
  });

  it("si el servidor rechaza el nombre, lo dice con su motivo", async () => {
    /* «Ya existe la categoría Software» es lo que lleva a corregirlo; un
       «no se pudo guardar» obligaría a adivinar. */
    permisos.add("activos.editar");
    crear.mockRejectedValue({
      response: {
        data: { error: { message: "Ya existe la categoría «Software»." } },
      },
    });
    pintar();
    await screen.findByText("Hardware");

    fireEvent.click(screen.getByRole("button", { name: "Nueva categoría" }));
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "software" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));

    expect(
      await screen.findByText("Ya existe la categoría «Software»."),
    ).toBeInTheDocument();
  });

  it("sin categorías lo dice en vez de dejar la tabla vacía", async () => {
    listar.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar();

    expect(
      await screen.findByText("Sin categorías registradas"),
    ).toBeInTheDocument();
  });
});
