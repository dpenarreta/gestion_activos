import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Qué columnas pide la plantilla de carga masiva.
 *
 * Cinco son estructurales —tipo, nombre, serie, área y fecha— y aparecen
 * bloqueadas: sin esos datos no se puede crear un activo, y permitir quitarlas
 * no daría flexibilidad sino un archivo que siempre falla. El resto se activa,
 * se vuelve obligatorio, se renombra y se reordena, y una columna puede pedir
 * un dato que no existe en la base: se guarda dentro de las especificaciones
 * del equipo, sin tocar el esquema.
 */

const listar = vi.fn();
const camposDisponibles = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();
const eliminar = vi.fn();

vi.mock("../src/api/activosService", () => ({
  columnasPlantillaService: {
    list: (...args) => listar(...args),
    camposDisponibles: (...args) => camposDisponibles(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
    remove: (...args) => eliminar(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { ColumnasPlantillaPanel } =
  await import("../src/pages/Admin/Activos/ColumnasPlantillaPanel");

const COLUMNAS = [
  {
    id: 1,
    clave: "numero_serie",
    etiqueta: "Número de serie *",
    ayuda: "Único en todo el inventario.",
    orden: 10,
    activa: true,
    obligatoria: true,
    es_estructural: true,
    es_especificacion: false,
  },
  {
    id: 2,
    clave: "costo_adquisicion",
    etiqueta: "Costo de compra",
    ayuda: "",
    orden: 20,
    activa: true,
    obligatoria: false,
    es_estructural: false,
    es_especificacion: false,
  },
  {
    id: 3,
    clave: "espec:Procesador",
    etiqueta: "Procesador",
    ayuda: "",
    orden: 30,
    activa: false,
    obligatoria: false,
    es_estructural: false,
    es_especificacion: true,
  },
];

const CAMPOS = [
  { clave: "numero_serie", etiqueta: "Número de serie", en_uso: true },
  { clave: "observaciones", etiqueta: "Observaciones", en_uso: false },
];

/** La fila de una columna, por su encabezado. */
function fila(etiqueta) {
  return screen.getByText(etiqueta).closest("tr");
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listar.mockResolvedValue(COLUMNAS);
  camposDisponibles.mockResolvedValue(CAMPOS);
  crear.mockResolvedValue({ id: 4 });
  actualizar.mockResolvedValue({});
  eliminar.mockResolvedValue({});
});

// --- Lo que la tabla dice ---------------------------------------------------

describe("Las columnas de la plantilla", () => {
  it("dice qué llena cada columna del archivo", async () => {
    pintarPanel();

    await screen.findByText("Costo de compra");
    expect(fila("Costo de compra")).toHaveTextContent("costo_adquisicion");
  });

  it("una columna que no existe en la base dice dónde se guardará", async () => {
    /* Es lo que permite pedir un dato nuevo sin cambiar el esquema; sin
       decirlo, parecería una columna como las demás. */
    pintarPanel();

    await screen.findByText("Procesador");
    expect(fila("Procesador")).toHaveTextContent("Especificación");
    expect(fila("Procesador")).toHaveTextContent("Se guarda como «Procesador»");
  });

  it("las imprescindibles se señalan y no se pueden apagar", async () => {
    /* Quitarlas no daría flexibilidad: daría un archivo que siempre falla. */
    permisos.add("activos.editar");

    pintarPanel();

    await screen.findByText("Número de serie *");
    expect(fila("Número de serie *")).toHaveTextContent(
      "Imprescindible para crear el activo",
    );
    expect(screen.getByLabelText("Pedir Número de serie *")).toBeDisabled();
    expect(
      within(fila("Número de serie *")).queryByRole("button", {
        name: "Quitar",
      }),
    ).not.toBeInTheDocument();
  });

  it("una columna apagada no puede ser obligatoria", async () => {
    /* «Obligatoria pero no se pide» no significa nada, y el archivo saldría
       sin ella igual. */
    permisos.add("activos.editar");

    pintarPanel();

    await screen.findByText("Procesador");
    expect(
      screen.getByLabelText("Hacer obligatoria Procesador"),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("Hacer obligatoria Costo de compra"),
    ).toBeEnabled();
  });

  it("sin permiso se consulta, no se cambia nada", async () => {
    pintarPanel();

    await screen.findByText("Costo de compra");
    expect(
      screen.queryByRole("button", { name: "Agregar columna" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pedir Costo de compra")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
  });

  it("si no cargan, lo dice", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintarPanel();

    expect(
      await screen.findByText(
        "No se pudieron cargar las columnas de la plantilla.",
      ),
    ).toBeInTheDocument();
  });
});

// --- Encender, apagar y mover -----------------------------------------------

describe("Cambiar una columna", () => {
  beforeEach(() => permisos.add("activos.editar"));

  it("el interruptor manda solo lo que cambió", async () => {
    pintarPanel();

    await screen.findByText("Costo de compra");
    fireEvent.click(screen.getByLabelText("Pedir Costo de compra"));

    await waitFor(() =>
      expect(actualizar).toHaveBeenCalledWith(2, {
        activa: false,
      }),
    );
  });

  it("reordenar intercambia el orden de dos, no renumera la lista", async () => {
    /* Dos peticiones bastan y no se toca lo que el usuario no movió. */
    pintarPanel();

    await screen.findByText("Costo de compra");
    fireEvent.click(screen.getByLabelText("Bajar Costo de compra"));

    await waitFor(() => expect(actualizar).toHaveBeenCalledTimes(2));
    expect(actualizar.mock.calls[0]).toEqual([2, { orden: 30 }]);
    expect(actualizar.mock.calls[1]).toEqual([3, { orden: 20 }]);
  });

  it("la primera no sube y la última no baja", async () => {
    pintarPanel();

    await screen.findByText("Número de serie *");
    expect(screen.getByLabelText("Subir Número de serie *")).toBeDisabled();
    expect(screen.getByLabelText("Bajar Procesador")).toBeDisabled();
  });

  it("si el cambio se rechaza, lo dice", async () => {
    actualizar.mockRejectedValue(new Error("500"));

    pintarPanel();

    await screen.findByText("Costo de compra");
    fireEvent.click(screen.getByLabelText("Pedir Costo de compra"));

    expect(
      await screen.findByText("No se pudo cambiar la columna."),
    ).toBeInTheDocument();
  });

  it("quitar una columna rehace la lista", async () => {
    pintarPanel();

    await screen.findByText("Costo de compra");
    const llamadasPrevias = listar.mock.calls.length;
    fireEvent.click(
      within(fila("Costo de compra")).getByRole("button", { name: "Quitar" }),
    );

    await waitFor(() => expect(eliminar).toHaveBeenCalledWith(2));
    await waitFor(() =>
      expect(listar.mock.calls.length).toBeGreaterThan(llamadasPrevias),
    );
  });
});

// --- Agregar una columna ----------------------------------------------------

describe("Agregar una columna", () => {
  beforeEach(() => permisos.add("activos.editar"));

  async function abrirAlta() {
    fireEvent.click(
      await screen.findByRole("button", { name: "Agregar columna" }),
    );
    return screen.findByRole("dialog");
  }

  it("solo ofrece los campos que todavía no tienen columna", async () => {
    /* Dos columnas para el mismo campo dejarían el archivo con dos valores
       para un solo dato. */
    pintarPanel();
    const dialogo = await abrirAlta();

    expect(
      within(dialogo).getByRole("option", { name: "Observaciones" }),
    ).toBeInTheDocument();
    expect(
      within(dialogo).queryByRole("option", { name: "Número de serie" }),
    ).not.toBeInTheDocument();
  });

  it("elegir un campo propone su encabezado, sin imponerlo", async () => {
    pintarPanel();
    const dialogo = await abrirAlta();

    fireEvent.change(within(dialogo).getByLabelText("Campo"), {
      target: { value: "observaciones" },
    });

    expect(
      within(dialogo).getByLabelText("Encabezado en la plantilla"),
    ).toHaveValue("Observaciones");
  });

  it("una característica propia viaja con su prefijo", async () => {
    /* Es lo que le dice al backend que ese valor va dentro de las
       especificaciones del equipo y no a una columna de la tabla. */
    pintarPanel();
    const dialogo = await abrirAlta();

    fireEvent.click(
      within(dialogo).getByLabelText(/Una característica propia/),
    );
    fireEvent.change(
      within(dialogo).getByLabelText("Nombre de la característica"),
      { target: { value: "N.º de factura" } },
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      clave: "espec:N.º de factura",
      etiqueta: "N.º de factura",
    });
  });

  it("sin campos libres lo dice y sugiere la salida", async () => {
    camposDisponibles.mockResolvedValue([
      { clave: "numero_serie", etiqueta: "Número de serie", en_uso: true },
    ]);

    pintarPanel();
    const dialogo = await abrirAlta();

    expect(
      within(dialogo).getByText(/Agregue una característica propia/),
    ).toBeInTheDocument();
  });

  it("editar una imprescindible deja cambiar el encabezado, no su carácter", async () => {
    pintarPanel();

    await screen.findByText("Número de serie *");
    fireEvent.click(
      within(fila("Número de serie *")).getByRole("button", { name: "Editar" }),
    );

    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByLabelText("Encabezado en la plantilla"),
    ).toBeEnabled();
    expect(
      within(dialogo).getByLabelText("Se pide en la plantilla"),
    ).toBeDisabled();
    expect(within(dialogo).getByLabelText("Obligatoria")).toBeDisabled();
    expect(
      within(dialogo).getByText(/no se puede desactivar ni volver opcional/),
    ).toBeInTheDocument();
  });

  it("al editar no se cambia qué dato llena la columna", async () => {
    /* Cambiar la clave de una columna existente reinterpretaría en silencio
       los archivos que ya se estaban llenando con ella. */
    pintarPanel();

    await screen.findByText("Costo de compra");
    fireEvent.click(
      within(fila("Costo de compra")).getByRole("button", { name: "Editar" }),
    );

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByLabelText("Campo")).not.toBeInTheDocument();
  });

  it("si el servidor rechaza la columna, el diálogo conserva lo escrito", async () => {
    crear.mockRejectedValue({
      response: { data: { error: { message: "Ese encabezado ya existe." } } },
    });

    pintarPanel();
    const dialogo = await abrirAlta();

    fireEvent.change(within(dialogo).getByLabelText("Campo"), {
      target: { value: "observaciones" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("Ese encabezado ya existe."),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByLabelText("Encabezado en la plantilla"),
    ).toHaveValue("Observaciones");
  });
});

function pintarPanel() {
  return render(<ColumnasPlantillaPanel />);
}
