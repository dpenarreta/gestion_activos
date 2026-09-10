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
 * El catálogo de tipos de dispositivo y lo que cada tipo declara de sus
 * equipos.
 *
 * El `codigo` es el dato delicado: entra en el código de barras de cada activo
 * de ese tipo. Y las características son lo que impide que «RAM», «Ram» y
 * «Memoria RAM» sean tres cosas distintas en equipos del mismo modelo, así que
 * se administran aquí, dentro del tipo al que pertenecen.
 */

const listar = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();
const listarCaracteristicas = vi.fn();
const crearCaracteristica = vi.fn();
const actualizarCaracteristica = vi.fn();
const quitarCaracteristica = vi.fn();

vi.mock("../src/api/activosService", () => ({
  tiposDispositivoService: {
    list: (...args) => listar(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
  },
  caracteristicasService: {
    list: (...args) => listarCaracteristicas(...args),
    create: (...args) => crearCaracteristica(...args),
    update: (...args) => actualizarCaracteristica(...args),
    remove: (...args) => quitarCaracteristica(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { TiposDispositivoList } =
  await import("../src/pages/Admin/Activos/TiposDispositivoList");

const TIPOS = [
  {
    id: 1,
    codigo: "LAP",
    nombre: "Laptop",
    descripcion: "Equipos portátiles",
    total_activos: 9,
    tiene_politica: true,
    activo: true,
  },
  {
    id: 2,
    codigo: "FAX",
    nombre: "Fax",
    descripcion: "",
    total_activos: 0,
    tiene_politica: false,
    activo: false,
  },
];

const CARACTERISTICAS = [
  {
    id: 11,
    nombre: "RAM",
    dato: "entero",
    unidad: "GB",
    obligatoria: true,
    orden: 1,
    opciones: [],
    activa: true,
  },
  {
    id: 12,
    nombre: "Lector de DVD",
    dato: "booleano",
    unidad: "",
    obligatoria: false,
    orden: 2,
    opciones: [],
    activa: false,
  },
];

function pintar() {
  return render(
    <MemoryRouter>
      <TiposDispositivoList />
    </MemoryRouter>,
  );
}

/** Abre el diálogo de edición del primer tipo y espera a que cargue. */
async function abrirEdicion() {
  await screen.findByText("Laptop");
  fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
  await screen.findByText("Editar tipo de dispositivo");
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listar.mockResolvedValue({ results: TIPOS, count: 2 });
  listarCaracteristicas.mockResolvedValue({ results: CARACTERISTICAS });
  crear.mockResolvedValue({ id: 3 });
  actualizar.mockResolvedValue({ id: 1 });
  crearCaracteristica.mockImplementation((datos) =>
    Promise.resolve({ id: 13, activa: true, opciones: [], ...datos }),
  );
  actualizarCaracteristica.mockImplementation((id, datos) =>
    Promise.resolve({ ...CARACTERISTICAS[0], id, ...datos }),
  );
  quitarCaracteristica.mockResolvedValue({});
});

// --- El catálogo ------------------------------------------------------------

describe("El catálogo de tipos", () => {
  it("muestra el código, que es el que entra en las etiquetas", async () => {
    pintar();

    const fila = (await screen.findByText("Laptop")).closest("tr");
    expect(fila).toHaveTextContent("LAP");
    expect(fila).toHaveTextContent("Equipos portátiles");
  });

  it("los activos de un tipo llevan al inventario ya filtrado", async () => {
    pintar();

    await screen.findByText("Laptop");
    expect(screen.getByRole("link", { name: "9" })).toHaveAttribute(
      "href",
      "/admin/activos?tipo=1",
    );
  });

  it("sin activos de ese tipo no hay enlace a ninguna parte", async () => {
    pintar();

    await screen.findByText("Fax");
    expect(screen.queryByRole("link", { name: "0" })).not.toBeInTheDocument();
  });

  it("dice si el tipo se rige por su política o por la global", async () => {
    pintar();

    await screen.findByText("Laptop");
    expect(screen.getByText("Laptop").closest("tr")).toHaveTextContent(
      "Propia",
    );
    expect(screen.getByText("Fax").closest("tr")).toHaveTextContent(
      "Usa la global",
    );
  });

  it("sin permiso se consulta, no se edita", async () => {
    pintar();

    await screen.findByText("Laptop");
    expect(
      screen.queryByRole("button", { name: "Nuevo tipo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
  });

  it("vacío y error se dicen", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el catálogo de tipos."),
    ).toBeInTheDocument();
  });
});

// --- El diálogo del tipo ----------------------------------------------------

describe("Crear o editar un tipo", () => {
  beforeEach(() => permisos.add("activos.editar"));

  it("el código solo admite letras y dígitos: va dentro del código de barras", async () => {
    pintar();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo tipo" }));

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByLabelText("Código")).toHaveAttribute(
      "pattern",
      "[A-Za-z0-9]+",
    );
    expect(
      within(dialogo).getByText(/forma parte del código de barras/),
    ).toBeInTheDocument();
  });

  it("al editar advierte que cambiar el código no renumera lo emitido", async () => {
    /* Los activos ya registrados conservan su etiqueta impresa: esperar que se
       renumeren solos dejaría el inventario descuadrado contra las etiquetas
       físicas. */
    pintar();
    const dialogo = await abrirEdicion();

    expect(
      within(dialogo).getByText(/no renumera los activos ya registrados/),
    ).toBeInTheDocument();
  });

  it("el alta crea y recarga el catálogo", async () => {
    pintar();

    await screen.findByText("Laptop");
    const llamadasPrevias = listar.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Nuevo tipo" }));

    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nombre"), {
      target: { value: "Servidor" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Código"), {
      target: { value: "SRV" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      nombre: "Servidor",
      codigo: "SRV",
      activo: true,
    });
    await waitFor(() =>
      expect(listar.mock.calls.length).toBeGreaterThan(llamadasPrevias),
    );
  });

  it("un tipo nuevo todavía no puede describirse", async () => {
    /* Una característica cuelga del tipo: hasta que el tipo exista no hay de
       qué colgarla. */
    pintar();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo tipo" }));

    await screen.findByRole("dialog");
    expect(
      screen.queryByText("Características de este tipo"),
    ).not.toBeInTheDocument();
    expect(listarCaracteristicas).not.toHaveBeenCalled();
  });

  it("si el servidor lo rechaza, el diálogo conserva lo escrito", async () => {
    crear.mockRejectedValue({
      response: { data: { error: { message: "Ese código ya existe." } } },
    });

    pintar();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo tipo" }));

    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nombre"), {
      target: { value: "Servidor" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Código"), {
      target: { value: "LAP" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("Ese código ya existe."),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Nombre")).toHaveValue("Servidor");
  });
});

// --- Lo que el tipo declara de sus equipos ----------------------------------

describe("Las características del tipo", () => {
  beforeEach(() => permisos.add("activos.editar"));

  it("se piden las de ese tipo y se dice para qué sirven", async () => {
    pintar();
    const dialogo = await abrirEdicion();

    await waitFor(() =>
      expect(listarCaracteristicas).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 1 }),
      ),
    );
    expect(
      within(dialogo).getByText(/es lo que se pide al registrar un equipo/),
    ).toBeInTheDocument();
    expect(await within(dialogo).findByText("RAM")).toBeInTheDocument();
  });

  it("cada una dice qué tipo de dato es y si es obligatoria", async () => {
    pintar();
    await abrirEdicion();

    const fila = (await screen.findByText("RAM")).closest("tr");
    expect(fila).toHaveTextContent("Número entero");
    expect(fila).toHaveTextContent("GB");
    expect(fila).toHaveTextContent("Sí");
  });

  it("una que ya no se pide se distingue de una vigente", async () => {
    /* Se conserva porque los equipos antiguos la tienen capturada; quitarla
       sin más perdería ese dato. */
    pintar();
    await abrirEdicion();

    const fila = (await screen.findByText("Lector de DVD")).closest("tr");
    expect(fila).toHaveTextContent("Ya no se pide");
    expect(
      within(fila).getByRole("button", { name: "Volver a pedir" }),
    ).toBeInTheDocument();
  });

  it("dejar de pedir una no la borra", async () => {
    pintar();
    await abrirEdicion();

    await screen.findByText("RAM");
    const fila = screen.getByText("RAM").closest("tr");
    fireEvent.click(
      within(fila).getByRole("button", { name: "Dejar de pedir" }),
    );

    await waitFor(() =>
      expect(actualizarCaracteristica).toHaveBeenCalledWith(11, {
        activa: false,
      }),
    );
    expect(quitarCaracteristica).not.toHaveBeenCalled();
  });

  it("una lista muestra las opciones que admite", async () => {
    listarCaracteristicas.mockResolvedValue({
      results: [
        {
          id: 14,
          nombre: "Sistema",
          dato: "lista",
          unidad: "",
          obligatoria: false,
          orden: 1,
          opciones: ["Windows 11", "Ubuntu 22.04"],
          activa: true,
        },
      ],
    });

    pintar();
    await abrirEdicion();

    expect(
      await screen.findByText("Windows 11 · Ubuntu 22.04"),
    ).toBeInTheDocument();
  });

  it("las opciones se escriben una por línea y viajan como lista", async () => {
    /* Elegir un separador —coma, punto y coma— rompería con cualquier valor
       que lo contenga. */
    pintar();
    const dialogo = await abrirEdicion();

    await within(dialogo).findByText("RAM");
    fireEvent.change(within(dialogo).getByLabelText("Característica"), {
      target: { value: "Sistema" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Dato"), {
      target: { value: "lista" },
    });
    fireEvent.change(
      await within(dialogo).findByLabelText("Opciones admitidas"),
      { target: { value: "Windows 11\n  Ubuntu 22.04  \n\n" } },
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir" }));

    await waitFor(() => expect(crearCaracteristica).toHaveBeenCalled());
    expect(crearCaracteristica.mock.calls[0][0]).toMatchObject({
      tipo: 1,
      nombre: "Sistema",
      dato: "lista",
      opciones: ["Windows 11", "Ubuntu 22.04"],
    });
  });

  it("añadir una característica no guarda ni cierra el tipo", async () => {
    /* El formulario de características vive dentro del diálogo del tipo:
       confundir los dos envíos cerraría el diálogo en mitad del trabajo, justo
       cuando se están declarando varias seguidas. */
    pintar();
    const dialogo = await abrirEdicion();

    await within(dialogo).findByText("RAM");
    fireEvent.change(within(dialogo).getByLabelText("Característica"), {
      target: { value: "Procesador" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir" }));

    await waitFor(() => expect(crearCaracteristica).toHaveBeenCalled());
    expect(actualizar).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("las que no viajan de a una: solo se envía la nueva", async () => {
    /* Añadir «Resolución» a las cámaras no debe reenviar las otras cinco ni
       arriesgarse a pisarlas. */
    pintar();
    const dialogo = await abrirEdicion();

    await within(dialogo).findByText("RAM");
    fireEvent.change(within(dialogo).getByLabelText("Característica"), {
      target: { value: "Procesador" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir" }));

    await waitFor(() => expect(crearCaracteristica).toHaveBeenCalledTimes(1));
    expect(crearCaracteristica.mock.calls[0][0]).toMatchObject({
      nombre: "Procesador",
    });
    // Y la nueva aparece sin volver a pedir la lista entera.
    expect(await within(dialogo).findByText("Procesador")).toBeInTheDocument();
    expect(listarCaracteristicas).toHaveBeenCalledTimes(1);
  });

  it("si no se pueden cargar, lo dice", async () => {
    listarCaracteristicas.mockRejectedValue(new Error("500"));

    pintar();
    await abrirEdicion();

    expect(
      await screen.findByText("No se pudieron cargar las características."),
    ).toBeInTheDocument();
  });

  it("si el servidor rechaza la nueva, lo dice", async () => {
    crearCaracteristica.mockRejectedValue({
      response: {
        data: { error: { message: "Ya existe «RAM» en este tipo." } },
      },
    });

    pintar();
    const dialogo = await abrirEdicion();

    await within(dialogo).findByText("RAM");
    fireEvent.change(within(dialogo).getByLabelText("Característica"), {
      target: { value: "RAM" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir" }));

    expect(
      await screen.findByText("Ya existe «RAM» en este tipo."),
    ).toBeInTheDocument();
  });
});
