import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El formulario de un rol, con su selector de permisos.
 *
 * Un rol es lo que decide qué ve y qué puede hacer cada persona, así que el
 * guardado se confirma y la confirmación dice cuántos permisos van: es la
 * única oportunidad de notar que se están concediendo cuarenta en vez de
 * cuatro, o que un «seleccionar todo» del módulo entró sin querer.
 */

const obtener = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();
const catalogo = vi.fn();

vi.mock("../src/api/rolesService", () => ({
  rolesService: {
    get: (...args) => obtener(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
  },
}));

vi.mock("../src/api/permissionsService", () => ({
  permissionsService: { catalog: (...args) => catalogo(...args) },
}));

const { RoleForm } = await import("../src/pages/Admin/Roles/RoleForm");

const CATALOGO = {
  activos: {
    label: "Activos",
    description: "Inventario de equipos",
    permissions: {
      "activos.ver": "Ver activos",
      "activos.crear": "Registrar activos",
      "activos.dar_baja": "Dar de baja",
    },
  },
  mantenimientos: {
    label: "Mantenimientos",
    description: "Bitácora de intervenciones",
    permissions: {
      "mantenimientos.ver": "Ver la bitácora",
    },
  },
};

/** Deja ver a dónde navega el formulario al crear el rol. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar(id = null) {
  return render(
    <MemoryRouter
      initialEntries={[id ? `/admin/roles/${id}` : "/admin/roles/new"]}
    >
      <Routes>
        <Route path="/admin/roles/new" element={<RoleForm />} />
        <Route path="/admin/roles/:id" element={<RoleForm />} />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * El bloque de un módulo del catálogo.
 *
 * Se llega por su casilla y no por el texto: el nombre del módulo aparece
 * también como opción del filtro de arriba.
 */
function modulo(etiqueta) {
  return screen.getByLabelText(etiqueta).closest(".permissions-module");
}

beforeEach(() => {
  vi.clearAllMocks();
  catalogo.mockResolvedValue(CATALOGO);
  obtener.mockResolvedValue({
    id: 5,
    name: "Técnico de TI",
    permission_codenames: ["activos.ver", "activos.crear"],
  });
  crear.mockResolvedValue({ id: 9 });
  actualizar.mockResolvedValue({});
});

// --- El catálogo de permisos ------------------------------------------------

describe("El selector de permisos", () => {
  it("agrupa los permisos por módulo y dice qué cubre cada uno", async () => {
    pintar();

    expect(await screen.findByLabelText("Activos")).toBeInTheDocument();
    expect(modulo("Activos")).toHaveTextContent("Inventario de equipos");
    expect(modulo("Activos")).toHaveTextContent("Ver activos");
    expect(modulo("Activos")).toHaveTextContent("activos.ver");
  });

  it("dice cuántos van sobre el total, no solo cuáles están marcados", async () => {
    /* Es el número que permite notar que se están concediendo cuarenta
       permisos en vez de cuatro. */
    pintar();

    expect(
      await screen.findByText("0 de 4 permisos seleccionados"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Ver activos/));

    expect(
      screen.getByText("1 de 4 permisos seleccionados"),
    ).toBeInTheDocument();
  });

  it("la casilla del módulo enciende y apaga todo el módulo de una vez", async () => {
    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.click(screen.getByLabelText("Activos"));

    expect(
      screen.getByText("3 de 4 permisos seleccionados"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Activos"));
    expect(
      screen.getByText("0 de 4 permisos seleccionados"),
    ).toBeInTheDocument();
  });

  it("con parte del módulo marcada, su casilla queda a medias", async () => {
    /* Ni marcada ni vacía: marcada haría creer que el módulo entero está
       concedido. */
    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.click(screen.getByLabelText(/Ver activos/));

    expect(screen.getByLabelText("Activos")).toHaveProperty(
      "indeterminate",
      true,
    );
    expect(screen.getByLabelText("Activos")).not.toBeChecked();
  });

  it("buscar filtra los permisos sin perder de vista el módulo", async () => {
    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.change(screen.getByPlaceholderText("Buscar permiso"), {
      target: { value: "baja" },
    });

    expect(screen.getByText(/Dar de baja/)).toBeInTheDocument();
    expect(screen.queryByText(/Ver la bitácora/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mantenimientos")).not.toBeInTheDocument();
  });

  it("el filtro de módulo deja ver uno solo", async () => {
    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.change(screen.getByDisplayValue("Todos los módulos"), {
      target: { value: "mantenimientos" },
    });

    expect(screen.getByText(/Ver la bitácora/)).toBeInTheDocument();
    expect(screen.queryByText(/Ver activos/)).not.toBeInTheDocument();
  });

  it("si el catálogo no carga, lo dice", async () => {
    catalogo.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el catálogo de permisos."),
    ).toBeInTheDocument();
  });
});

// --- Guardar ----------------------------------------------------------------

describe("Guardar un rol", () => {
  it("pregunta antes, diciendo cuántos permisos concede", async () => {
    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.change(screen.getByLabelText("Nombre del rol"), {
      target: { value: "Consulta" },
    });
    fireEvent.click(screen.getByLabelText(/Ver activos/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText(/Se guardará el rol "Consulta" con 1 permiso/),
    ).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("cancelar no guarda nada", async () => {
    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.change(screen.getByLabelText("Nombre del rol"), {
      target: { value: "Consulta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(crear).not.toHaveBeenCalled();
  });

  it("confirmado, se crea con los permisos elegidos y se abre su ficha", async () => {
    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.change(screen.getByLabelText("Nombre del rol"), {
      target: { value: "Consulta" },
    });
    fireEvent.click(screen.getByLabelText(/Ver activos/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toEqual({
      name: "Consulta",
      permission_codenames: ["activos.ver"],
    });
    // Se queda en la ficha del rol recién creado, ya en modo edición, en vez
    // de salir al listado: lo normal después de crearlo es seguir ajustándolo.
    expect(await screen.findByText("Editar rol")).toBeInTheDocument();
    await waitFor(() => expect(obtener).toHaveBeenCalledWith("9"));
  });

  it("si el servidor lo rechaza, lo dice y cierra la pregunta", async () => {
    crear.mockRejectedValue({
      response: {
        data: {
          error: { message: "No puede conceder permisos que no tiene." },
        },
      },
    });

    pintar();

    await screen.findByLabelText("Activos");
    fireEvent.change(screen.getByLabelText("Nombre del rol"), {
      target: { value: "Consulta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("No puede conceder permisos que no tiene."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Destino:/)).not.toBeInTheDocument();
  });
});

// --- Editar -----------------------------------------------------------------

describe("Editar un rol", () => {
  it("llega con sus permisos ya marcados", async () => {
    pintar(5);

    expect(await screen.findByText("Editar rol")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre del rol")).toHaveValue(
        "Técnico de TI",
      ),
    );
    expect(screen.getByLabelText(/Ver activos/)).toBeChecked();
    expect(screen.getByLabelText(/Dar de baja/)).not.toBeChecked();
    expect(
      screen.getByText("2 de 4 permisos seleccionados"),
    ).toBeInTheDocument();
  });

  it("guarda sobre el rol abierto, no crea otro", async () => {
    pintar(5);

    await screen.findByText("Editar rol");
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre del rol")).toHaveValue(
        "Técnico de TI",
      ),
    );
    fireEvent.click(screen.getByLabelText(/Dar de baja/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][0]).toBe("5");
    expect(actualizar.mock.calls[0][1].permission_codenames).toContain(
      "activos.dar_baja",
    );
    expect(crear).not.toHaveBeenCalled();
  });

  it("quitar un permiso lo saca de lo que se envía", async () => {
    /* Retirar un acceso es tan importante como concederlo, y es el caso que
       una prueba de «se guardó bien» no distingue. */
    pintar(5);

    await screen.findByText("Editar rol");
    await waitFor(() =>
      expect(screen.getByLabelText(/Ver activos/)).toBeChecked(),
    );
    fireEvent.click(screen.getByLabelText(/Ver activos/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][1].permission_codenames).not.toContain(
      "activos.ver",
    );
  });

  it("el módulo completo se marca cuando lo están todos sus permisos", async () => {
    obtener.mockResolvedValue({
      id: 5,
      name: "Todo activos",
      permission_codenames: [
        "activos.ver",
        "activos.crear",
        "activos.dar_baja",
      ],
    });

    pintar(5);

    await screen.findByText("Editar rol");
    await waitFor(() => expect(screen.getByLabelText("Activos")).toBeChecked());
    expect(within(modulo("Activos")).getByLabelText("Activos")).toHaveProperty(
      "indeterminate",
      false,
    );
  });
});
