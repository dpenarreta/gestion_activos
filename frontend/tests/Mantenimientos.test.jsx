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
 * La bitácora de intervenciones y el catálogo de repuestos.
 *
 * Las dos pantallas tocan el mismo nervio: lo que se registra aquí mueve los
 * contadores del equipo y, con ellos, la sugerencia de renovación. Por eso lo
 * que se prueba es sobre todo lo que el sistema *dice* antes de dejar hacer
 * algo —borrar una intervención recalcula el equipo; cambiar la criticidad de
 * una pieza no reescribe el pasado— y que la exportación se lleve el tramo que
 * se está mirando.
 */

const listarMantenimientos = vi.fn();
const eliminarMantenimiento = vi.fn();
const exportarBitacora = vi.fn();
const listarComponentes = vi.fn();
const crearComponente = vi.fn();
const actualizarComponente = vi.fn();

vi.mock("../src/api/mantenimientosService", () => ({
  mantenimientosService: {
    list: (...args) => listarMantenimientos(...args),
    remove: (...args) => eliminarMantenimiento(...args),
  },
  componentesService: {
    list: (...args) => listarComponentes(...args),
    create: (...args) => crearComponente(...args),
    update: (...args) => actualizarComponente(...args),
  },
}));

vi.mock("../src/api/activosService", () => ({
  exportacionService: {
    mantenimientos: (...args) => exportarBitacora(...args),
  },
}));

const descargar = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...args) => descargar(...args),
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { MantenimientosList } =
  await import("../src/pages/Admin/Mantenimientos/MantenimientosList");
const { ComponentesList } =
  await import("../src/pages/Admin/Mantenimientos/ComponentesList");

const INTERVENCIONES = [
  {
    id: 11,
    activo: 7,
    activo_codigo: "GA-LAP-000007",
    activo_nombre: "Laptop Jefatura TI",
    fecha_intervencion: "2026-07-01",
    tipo: "correctivo",
    tipo_display: "Correctivo",
    responsable: "Tecnomega C.A.",
    tipo_responsable_display: "Proveedor externo",
    descripcion: "Reemplazo de disco",
    costo_total: "125.50",
    componentes: [
      {
        id: 1,
        componente_nombre: "Disco SSD 480 GB",
        cantidad: 1,
        era_critico: true,
      },
    ],
  },
  {
    id: 12,
    activo: 8,
    activo_codigo: "GA-IMP-000008",
    activo_nombre: "Impresora Bodega",
    fecha_intervencion: "2026-08-15",
    tipo: "preventivo",
    tipo_display: "Preventivo",
    responsable: "Jorge Andrade",
    tipo_responsable_display: "Técnico interno",
    descripcion: "Limpieza general",
    costo_total: "0.00",
    componentes: [],
  },
];

const COMPONENTES = [
  {
    id: 21,
    codigo: "SSD480",
    nombre: "Disco SSD 480 GB",
    descripcion: "Unidad de estado sólido",
    es_critico: true,
    activo: true,
  },
  {
    id: 22,
    codigo: "TEC01",
    nombre: "Teclado",
    descripcion: "",
    es_critico: false,
    activo: false,
  },
];

function pintar(Pantalla) {
  return render(
    <MemoryRouter>
      <Pantalla />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listarMantenimientos.mockResolvedValue({
    results: INTERVENCIONES,
    count: 2,
  });
  listarComponentes.mockResolvedValue({ results: COMPONENTES, count: 2 });
  eliminarMantenimiento.mockResolvedValue({});
  crearComponente.mockResolvedValue({ id: 23 });
  actualizarComponente.mockResolvedValue({ id: 21 });
  exportarBitacora.mockResolvedValue(new Blob(["x"]));
});

// --- La bitácora ------------------------------------------------------------

describe("La bitácora de mantenimientos", () => {
  it("cada intervención dice sobre qué equipo fue y quién la hizo", async () => {
    pintar(MantenimientosList);

    const fila = (await screen.findByText("GA-LAP-000007")).closest("tr");
    expect(fila).toHaveTextContent("Laptop Jefatura TI");
    expect(fila).toHaveTextContent("Correctivo");
    expect(fila).toHaveTextContent("Proveedor externo");
    expect(fila).toHaveTextContent("Reemplazo de disco");
  });

  it("el código del equipo lleva a su ficha", async () => {
    pintar(MantenimientosList);

    await screen.findByText("GA-LAP-000007");
    expect(screen.getByText("GA-LAP-000007").closest("a")).toHaveAttribute(
      "href",
      "/admin/activos/7",
    );
  });

  it("marca las piezas que eran críticas cuando se consumieron", async () => {
    /* «era» y no «es»: si la pieza cambia de criticidad después, esta
       intervención conserva la que tenía, que es la que contó. */
    pintar(MantenimientosList);

    const fila = (await screen.findByText("GA-LAP-000007")).closest("tr");
    expect(within(fila).getByText("crítica")).toBeInTheDocument();
    expect(fila).toHaveTextContent("Disco SSD 480 GB ×1");
  });

  it("una intervención sin repuestos no deja la celda ambigua", async () => {
    pintar(MantenimientosList);

    const fila = (await screen.findByText("GA-IMP-000008")).closest("tr");
    expect(fila).toHaveTextContent("—");
  });

  it("sin resultados lo dice", async () => {
    listarMantenimientos.mockResolvedValue({ results: [], count: 0 });

    pintar(MantenimientosList);

    expect(
      await screen.findByText(
        "Sin intervenciones que coincidan con los filtros",
      ),
    ).toBeInTheDocument();
  });

  it("si la bitácora no carga lo dice", async () => {
    listarMantenimientos.mockRejectedValue(new Error("500"));

    pintar(MantenimientosList);

    expect(
      await screen.findByText(
        "No se pudo cargar la bitácora de mantenimientos.",
      ),
    ).toBeInTheDocument();
  });

  it("el rango de fechas se aplica al elegirlo", async () => {
    pintar(MantenimientosList);

    await screen.findByText("GA-LAP-000007");
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });

    await waitFor(() =>
      expect(listarMantenimientos.mock.calls.at(-1)[0]).toMatchObject({
        desde: "2026-07-01",
      }),
    );
  });
});

describe("Quién puede tocar la bitácora", () => {
  it("sin permisos solo se consulta", async () => {
    pintar(MantenimientosList);

    await screen.findByText("GA-LAP-000007");
    expect(
      screen.queryByRole("link", { name: "Registrar mantenimiento" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Eliminar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Exportar/ }),
    ).not.toBeInTheDocument();
    // El catálogo de componentes se consulta desde aquí en cualquier caso.
    expect(
      screen.getByRole("link", { name: "Catálogo de componentes" }),
    ).toBeInTheDocument();
  });

  it("borrar una intervención avisa de lo que arrastra", async () => {
    /* No es una fila más: el contador del equipo y su sugerencia de renovación
       se recalculan, y el borrado queda en auditoría. */
    permisos.add("mantenimientos.editar");

    pintar(MantenimientosList);

    await screen.findByText("GA-LAP-000007");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);

    const aviso = await screen.findByText(/Se eliminará la intervención/);
    expect(aviso).toHaveTextContent("GA-LAP-000007");
    expect(aviso).toHaveTextContent(/sugerencia de renovación se recalcularán/);
    expect(aviso).toHaveTextContent(/bitácora de auditoría/);
  });

  it("confirmado, se elimina y la bitácora se rehace", async () => {
    permisos.add("mantenimientos.editar");

    pintar(MantenimientosList);

    await screen.findByText("GA-LAP-000007");
    const llamadasPrevias = listarMantenimientos.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(eliminarMantenimiento).toHaveBeenCalledWith(11));
    await waitFor(() =>
      expect(listarMantenimientos.mock.calls.length).toBeGreaterThan(
        llamadasPrevias,
      ),
    );
  });

  it("si no se puede eliminar, lo dice", async () => {
    permisos.add("mantenimientos.editar");
    eliminarMantenimiento.mockRejectedValue(new Error("500"));

    pintar(MantenimientosList);

    await screen.findByText("GA-LAP-000007");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("No se pudo eliminar la intervención."),
    ).toBeInTheDocument();
  });

  it("exporta el tramo que se está mirando, no la bitácora entera", async () => {
    permisos.add("mantenimientos.exportar");

    pintar(MantenimientosList);

    await screen.findByText("GA-LAP-000007");
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "correctivo" },
    });
    await waitFor(() =>
      expect(listarMantenimientos.mock.calls.at(-1)[0]).toMatchObject({
        tipo: "correctivo",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));

    await waitFor(() =>
      expect(exportarBitacora).toHaveBeenCalledWith({ tipo: "correctivo" }),
    );
    expect(descargar).toHaveBeenCalledWith(
      expect.any(Blob),
      "bitacora-mantenimientos.xlsx",
    );
  });

  it("si la exportación falla, lo dice", async () => {
    permisos.add("mantenimientos.exportar");
    exportarBitacora.mockRejectedValue(new Error("500"));

    pintar(MantenimientosList);

    fireEvent.click(await screen.findByRole("button", { name: /Exportar/ }));

    expect(
      await screen.findByText("No se pudo exportar la bitácora."),
    ).toBeInTheDocument();
  });
});

// --- El catálogo de repuestos -----------------------------------------------

describe("El catálogo de componentes", () => {
  it("explica para qué sirve marcar una pieza como crítica", async () => {
    /* Es lo que conecta este catálogo con la política de renovación; sin
       decirlo, «crítica» se lee como una etiqueta decorativa. */
    pintar(ComponentesList);

    expect(
      await screen.findByText(/cuentan contra el umbral de sustituciones/),
    ).toBeInTheDocument();
  });

  it("distingue las críticas de las comunes y las de baja", async () => {
    pintar(ComponentesList);

    const critica = (await screen.findByText("Disco SSD 480 GB")).closest("tr");
    expect(within(critica).getByText("Crítica")).toBeInTheDocument();

    const comun = screen.getByText("Teclado").closest("tr");
    expect(within(comun).getByText("Común")).toBeInTheDocument();
    expect(within(comun).getByText("Inactivo")).toBeInTheDocument();
  });

  it("se puede filtrar para ver solo las críticas", async () => {
    pintar(ComponentesList);

    await screen.findByText("Disco SSD 480 GB");
    fireEvent.change(screen.getByLabelText("Filtrar por criticidad"), {
      target: { value: "true" },
    });

    await waitFor(() =>
      expect(listarComponentes.mock.calls.at(-1)[0]).toMatchObject({
        es_critico: "true",
      }),
    );
  });

  it("sin permiso no se crea ni se edita", async () => {
    pintar(ComponentesList);

    await screen.findByText("Disco SSD 480 GB");
    expect(
      screen.queryByRole("button", { name: "Nuevo componente" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
  });

  it("cambiar la criticidad avisa de que no reescribe el pasado", async () => {
    /* Las intervenciones ya registradas conservan la criticidad que la pieza
       tenía al consumirse: sin este aviso se esperaría que los contadores de
       los equipos se movieran solos. */
    permisos.add("mantenimientos.componentes");

    pintar(ComponentesList);

    await screen.findByText("Disco SSD 480 GB");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);

    await screen.findByText("Editar componente");
    expect(
      screen.queryByText(/El cambio rige de aquí en adelante/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Pieza crítica"));

    expect(
      screen.getByText(/El cambio rige de aquí en adelante/),
    ).toBeInTheDocument();
  });

  it("el alta crea y recarga el catálogo", async () => {
    permisos.add("mantenimientos.componentes");

    pintar(ComponentesList);

    await screen.findByText("Disco SSD 480 GB");
    const llamadasPrevias = listarComponentes.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Nuevo componente" }));

    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nombre"), {
      target: { value: "Fuente de poder" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Código"), {
      target: { value: "FTE01" },
    });
    fireEvent.click(within(dialogo).getByLabelText("Pieza crítica"));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(crearComponente).toHaveBeenCalled());
    expect(crearComponente.mock.calls[0][0]).toMatchObject({
      nombre: "Fuente de poder",
      codigo: "FTE01",
      es_critico: true,
      activo: true,
    });
    await waitFor(() =>
      expect(listarComponentes.mock.calls.length).toBeGreaterThan(
        llamadasPrevias,
      ),
    );
  });

  it("editar guarda sobre el componente abierto", async () => {
    permisos.add("mantenimientos.componentes");

    pintar(ComponentesList);

    await screen.findByText("Disco SSD 480 GB");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);

    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(actualizarComponente).toHaveBeenCalled());
    expect(actualizarComponente.mock.calls[0][0]).toBe(21);
    expect(crearComponente).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza el componente, el diálogo conserva lo escrito", async () => {
    permisos.add("mantenimientos.componentes");
    crearComponente.mockRejectedValue({
      response: { data: { error: { message: "Ese código ya existe." } } },
    });

    pintar(ComponentesList);

    await screen.findByText("Disco SSD 480 GB");
    fireEvent.click(screen.getByRole("button", { name: "Nuevo componente" }));

    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nombre"), {
      target: { value: "Fuente de poder" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Código"), {
      target: { value: "SSD480" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("Ese código ya existe."),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Nombre")).toHaveValue(
      "Fuente de poder",
    );
  });

  it("si el catálogo no carga lo dice", async () => {
    listarComponentes.mockRejectedValue(new Error("500"));

    pintar(ComponentesList);

    expect(
      await screen.findByText("No se pudo cargar el catálogo de componentes."),
    ).toBeInTheDocument();
  });
});
