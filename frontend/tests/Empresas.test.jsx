import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Las empresas del grupo: la administración de la separación por empresa.
 *
 * Dos cosas se prueban aquí porque su ausencia no se nota hasta que ya hizo
 * daño: que una empresa sin usuarios asignados se señale —nadie la ve, y desde
 * fuera parece que el sistema perdió los datos— y que el alta advierta que
 * crear la segunda empresa vuelve obligatoria la asignación, con lo que las
 * cuentas sin empresa dejan de ver información de golpe.
 */

const listar = vi.fn();
const obtener = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();

vi.mock("../src/api/empresasService", () => ({
  empresasService: {
    list: (...args) => listar(...args),
    get: (...args) => obtener(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { EmpresasList } =
  await import("../src/pages/Admin/Empresas/EmpresasList");
const { EmpresaForm } = await import("../src/pages/Admin/Empresas/EmpresaForm");

const EMPRESAS = [
  {
    id: 1,
    nombre: "LaarCourier",
    codigo: "LC",
    identificacion: "1790012345001",
    usuarios: 9,
    activa: true,
  },
  {
    id: 2,
    nombre: "LaarSeguridad",
    codigo: "LS",
    identificacion: "",
    usuarios: 0,
    activa: true,
  },
];

/** Deja ver a dónde vuelve el formulario tras guardar. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintarListado() {
  return render(
    <MemoryRouter>
      <EmpresasList />
    </MemoryRouter>,
  );
}

function pintarFormulario(id = null) {
  return render(
    <MemoryRouter
      initialEntries={[id ? `/admin/empresas/${id}` : "/admin/empresas/new"]}
    >
      <Routes>
        <Route path="/admin/empresas/new" element={<EmpresaForm />} />
        <Route path="/admin/empresas/:id" element={<EmpresaForm />} />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listar.mockResolvedValue({ results: EMPRESAS, count: 2 });
  obtener.mockResolvedValue({ ...EMPRESAS[0], usuarios: 9 });
  crear.mockResolvedValue({ id: 3 });
  actualizar.mockResolvedValue({ id: 1 });
});

// --- El listado -------------------------------------------------------------

describe("El listado de empresas", () => {
  it("las muestra con su código y su identificación", async () => {
    pintarListado();

    const fila = (await screen.findByText("LaarCourier")).closest("tr");
    expect(fila).toHaveTextContent("LC");
    expect(fila).toHaveTextContent("1790012345001");
  });

  it("señala la empresa que no ve nadie", async () => {
    /* Sin usuarios asignados no se puede entrar a ella: su inventario existe y
       es invisible, lo que desde fuera parece una pérdida de datos. */
    pintarListado();

    await screen.findByText("LaarSeguridad");
    const fila = screen.getByText("LaarSeguridad").closest("tr");
    expect(fila).toHaveTextContent("Sin usuarios");

    expect(screen.getByText("LaarCourier").closest("tr")).not.toHaveTextContent(
      "Sin usuarios",
    );
  });

  it("explica qué cambia al cambiar de empresa en el menú", async () => {
    pintarListado();

    expect(
      await screen.findByText(/Cambiar de empresa en el selector del menú/),
    ).toBeInTheDocument();
  });

  it("sin permiso de edición se consulta, no se crea", async () => {
    pintarListado();

    await screen.findByText("LaarCourier");
    expect(
      screen.queryByRole("link", { name: "Nueva empresa" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Ver" })).toHaveLength(2);
  });

  it("con permiso aparecen el alta y la edición", async () => {
    permisos.add("empresas.editar");

    pintarListado();

    await screen.findByText("LaarCourier");
    expect(
      screen.getByRole("link", { name: "Nueva empresa" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Editar" })[0]).toHaveAttribute(
      "href",
      "/admin/empresas/1",
    );
  });

  it("la búsqueda se envía al confirmar", async () => {
    pintarListado();

    await screen.findByText("LaarCourier");
    const campo = screen.getByLabelText("Buscar empresas");
    fireEvent.change(campo, { target: { value: "seguridad" } });
    fireEvent.submit(campo.closest("form"));

    await waitFor(() =>
      expect(listar.mock.calls.at(-1)[0]).toMatchObject({ q: "seguridad" }),
    );
  });

  it("vacío y error se dicen, no se dejan en blanco", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });

    pintarListado();

    expect(
      await screen.findByText("Sin empresas registradas"),
    ).toBeInTheDocument();
  });

  it("si el listado falla lo dice", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintarListado();

    expect(
      await screen.findByText("No se pudo cargar el listado de empresas."),
    ).toBeInTheDocument();
  });
});

// --- El formulario ----------------------------------------------------------

describe("Crear o editar una empresa", () => {
  it("el alta advierte lo que cambia al existir una segunda empresa", async () => {
    /* Mientras hay una sola, todas las cuentas trabajan en ella sin membresía.
       Crear la segunda vuelve obligatoria la asignación: quien no la tenga se
       queda sin ver nada, y sin este aviso nadie lo ve venir. */
    permisos.add("empresas.editar");

    pintarFormulario();

    expect(
      await screen.findByText(/la asignación pasa a ser obligatoria/),
    ).toBeInTheDocument();
  });

  it("editando, ese aviso ya no viene al caso", async () => {
    permisos.add("empresas.editar");

    pintarFormulario(1);

    await screen.findByText("Editar empresa");
    expect(
      screen.queryByText(/la asignación pasa a ser obligatoria/),
    ).not.toBeInTheDocument();
  });

  it("una empresa no se borra: se desactiva, y lo dice", async () => {
    /* Es la dueña de todo lo registrado; borrarla dejaría el inventario
       huérfano. */
    permisos.add("empresas.editar");

    pintarFormulario();

    expect(
      await screen.findByText(/Desactivarla la saca del selector sin borrar/),
    ).toBeInTheDocument();
  });

  it("al editar dice cuánta gente trabaja ahí antes de desactivarla", async () => {
    permisos.add("empresas.editar");

    pintarFormulario(1);

    expect(
      await screen.findByText(/Hoy trabajan aquí 9 usuario\(s\)/),
    ).toBeInTheDocument();
  });

  it("sin permiso se consulta, pero no se cambia nada", async () => {
    pintarFormulario(1);

    await screen.findByText("Editar empresa");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toBeDisabled());
    expect(screen.getByLabelText("Código")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Guardar" }),
    ).not.toBeInTheDocument();
  });

  it("el alta crea y vuelve al listado", async () => {
    permisos.add("empresas.editar");

    pintarFormulario();

    await screen.findByText("Nueva empresa");
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "LaarCargo" },
    });
    fireEvent.change(screen.getByLabelText("Código"), {
      target: { value: "LG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      nombre: "LaarCargo",
      codigo: "LG",
      activa: true,
    });
    expect(
      await screen.findByText("Destino: /admin/empresas"),
    ).toBeInTheDocument();
  });

  it("editar guarda sobre la empresa abierta, no crea otra", async () => {
    permisos.add("empresas.editar");

    pintarFormulario(1);

    await screen.findByText("Editar empresa");
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveValue("LaarCourier"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][0]).toBe("1");
    expect(crear).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza el guardado, lo dice con su motivo", async () => {
    permisos.add("empresas.editar");
    crear.mockRejectedValue({
      response: { data: { error: { message: "Ese código ya está en uso." } } },
    });

    pintarFormulario();

    await screen.findByText("Nueva empresa");
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "LaarCargo" },
    });
    fireEvent.change(screen.getByLabelText("Código"), {
      target: { value: "LC" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Ese código ya está en uso."),
    ).toBeInTheDocument();
  });

  it("si la empresa no carga lo dice", async () => {
    obtener.mockRejectedValue(new Error("404"));

    pintarFormulario(1);

    expect(
      await screen.findByText("No se pudo cargar la empresa."),
    ).toBeInTheDocument();
  });
});
